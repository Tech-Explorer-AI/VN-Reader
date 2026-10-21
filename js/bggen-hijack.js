// ============================================================
// VN Reader · bggen-hijack.js
// 背景图生成功能 · 纯劫持实现
// 不改任何源文件，只包装以下函数：
//   VNState.get / VNPlayer.play / VNPlayer._playDialogue /
//   VNBackground.apply / VNSettings.open / VNChapters._openChapterMenu
// 依赖：state.js, vn.js, chapters.js, settings.js, api.js
// ============================================================

(function () {
    'use strict';

    // 防止重复加载
    if (window.__VN_BgGenHijackLoaded) return;
    window.__VN_BgGenHijackLoaded = true;

    const State = window.VNState;

    // ============================================================
    // 0. 默认配置（写进 state.settings.bgGen，不碰 DEFAULTS）
    // ============================================================
    const BG_GEN_DEFAULTS = {
        enabled: false,
        comfyuiUrl: '127.0.0.1:8188',
        workflowId: 'builtin_qwen',
        promptSource: 'api',          // 'api' | 'kobold' | 'remote'
        promptStyle: 'natural',       // 'natural' | 'clip'
        koboldUrl: 'http://127.0.0.1:5001',
        remoteApiUrl: '',
        remoteApiKey: '',
        remoteModel: '',
        stylePrefix: '',
        negativePrompt: '3DCG, worst quality, low quality, blurry, jpeg artifacts, ' +
            'censored, signature, grayscale, monochrome, simple background, ' +
            'humans, characters, people, 1girl, 1boy, person, face, watermark, text',
        width: 1216,
        height: 832,
    };

    function ensureBgGenSettings() {
        const st = State.get();
        if (!st.settings) st.settings = {};
        if (!st.settings.bgGen) {
            st.settings.bgGen = { ...BG_GEN_DEFAULTS };
        } else {
            for (const k in BG_GEN_DEFAULTS) {
                if (st.settings.bgGen[k] === undefined) st.settings.bgGen[k] = BG_GEN_DEFAULTS[k];
            }
        }
        // 给章节补 bgImages 字段
        if (Array.isArray(st.chapters)) {
            for (const ch of st.chapters) {
                if (!ch.bgImages || typeof ch.bgImages !== 'object') ch.bgImages = {};
            }
        }
    }

    // ============================================================
    // 1. 劫持 VNState.get
    // ============================================================
    const _origGet = State.get.bind(State);
    State.get = function () {
        const s = _origGet();
        // 幂等补默认值（不 save，避免频繁写盘）
        if (s.settings && !s.settings.bgGen) {
            s.settings.bgGen = { ...BG_GEN_DEFAULTS };
        }
        return s;
    };
    // 首次调用补一次
    ensureBgGenSettings();

    // ============================================================
    // 2. IndexedDB 背景图存储
    // ============================================================
    const BGStore = {
        DB_NAME: 'VNReader_BG',
        STORE: 'backgrounds',
        VERSION: 1,
        _db: null,
        _initPromise: null,

        init() {
            if (this._db) return Promise.resolve(this._db);
            if (this._initPromise) return this._initPromise;
            this._initPromise = new Promise((resolve, reject) => {
                const req = indexedDB.open(this.DB_NAME, this.VERSION);
                req.onerror = () => reject(req.error);
                req.onsuccess = () => { this._db = req.result; resolve(this._db); };
                req.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(this.STORE)) {
                        const store = db.createObjectStore(this.STORE, { keyPath: 'id' });
                        store.createIndex('chapterId', 'chapterId', { unique: false });
                        store.createIndex('sceneName', 'sceneName', { unique: false });
                    }
                };
            });
            return this._initPromise;
        },

        async put(record) {
            const db = await this.init();
            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.STORE], 'readwrite');
                const req = tx.objectStore(this.STORE).put(record);
                req.onsuccess = () => resolve(record.id);
                req.onerror = () => reject(req.error);
            });
        },

        async get(id) {
            if (!id) return null;
            const db = await this.init();
            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.STORE], 'readonly');
                const req = tx.objectStore(this.STORE).get(id);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            });
        },

        async delete(id) {
            if (!id) return;
            const db = await this.init();
            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.STORE], 'readwrite');
                const req = tx.objectStore(this.STORE).delete(id);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        },

        async listByChapter(chapterId) {
            const db = await this.init();
            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.STORE], 'readonly');
                const idx = tx.objectStore(this.STORE).index('chapterId');
                const req = idx.getAll(chapterId);
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            });
        },
    };
    window.VNBackgroundStore = BGStore;

    // ============================================================
    // 3. 工作流加载（assets/workflows/）
    // ============================================================
    const WORKFLOW_BASE = 'assets/workflows/';
    const BUILTIN_QWEN = {
        id: 'builtin_qwen',
        name: '内置 · Qwen-Anima',
        isBuiltin: true,
        promptNode: '11', promptField: 'text',
        negativeNode: '12', negativeField: 'text',
        widthNode: '28', heightNode: '28',
        seedNode: '19',
        workflow: {
            "1": { "inputs": { "images": ["8", 0] }, "class_type": "PreviewImage" },
            "8": { "inputs": { "samples": ["19", 0], "vae": ["15", 0] }, "class_type": "VAEDecode" },
            "11": { "inputs": { "text": "", "clip": ["54", 0] }, "class_type": "CLIPTextEncode" },
            "12": { "inputs": { "text": "", "clip": ["54", 0] }, "class_type": "CLIPTextEncode" },
            "15": { "inputs": { "vae_name": "qwen_image_vae.safetensors" }, "class_type": "VAELoader" },
            "19": {
                "inputs": {
                    "seed": 12345, "steps": 8, "cfg": 1,
                    "sampler_name": "er_sde", "scheduler": "simple", "denoise": 1,
                    "model": ["61", 0], "positive": ["11", 0],
                    "negative": ["12", 0], "latent_image": ["28", 0]
                },
                "class_type": "KSampler"
            },
            "28": { "inputs": { "width": 1200, "height": 800, "batch_size": 1 }, "class_type": "EmptyLatentImage" },
            "44": { "inputs": { "unet_name": "anima-base-v1.0.safetensors", "weight_dtype": "default" }, "class_type": "UNETLoader" },
            "54": { "inputs": { "clip_name": "qwen_3_06b_base.safetensors", "type": "qwen_image", "device": "default" }, "class_type": "CLIPLoader" },
            "61": { "inputs": { "lora_name": "Anima\\anima-turbo-lora-v0.2.safetensors", "strength_model": 1, "model": ["44", 0] }, "class_type": "LoraLoaderModelOnly" },
            "62": { "inputs": { "filename_prefix": "VNReader_bg", "images": ["1", 0] }, "class_type": "SaveImage" }
        }
    };

    const WorkflowManager = {
        workflows: [BUILTIN_QWEN],
        _loaded: false,

        async load() {
            if (this._loaded) return;
            this._loaded = true;
            try {
                const resp = await fetch(WORKFLOW_BASE + 'manifest.json', { cache: 'no-cache' });
                if (!resp.ok) return;
                const manifest = await resp.json();
                const files = Array.isArray(manifest.workflows) ? manifest.workflows : [];
                for (const file of files) {
                    try {
                        const r = await fetch(WORKFLOW_BASE + encodeURIComponent(file));
                        if (!r.ok) continue;
                        const wf = await r.json();
                        const detected = this._detect(wf);
                        this.workflows.push({
                            id: 'file_' + file,
                            name: file.replace(/\.json$/i, ''),
                            isBuiltin: false,
                            ...detected,
                            workflow: wf,
                        });
                    } catch (e) {
                        console.warn('[BgGen] 工作流加载失败:', file, e);
                    }
                }
            } catch (e) {
                console.warn('[BgGen] manifest 读取失败:', e.message);
            }
        },

        _detect(wf) {
            const result = {
                promptNode: '11', promptField: 'text',
                negativeNode: null, negativeField: 'text',
                widthNode: null, heightNode: null, seedNode: null,
            };
            let textNodes = [];
            let sampler = null, latent = null;
            for (const [id, node] of Object.entries(wf)) {
                const ct = node.class_type || '';
                if (ct === 'CLIPTextEncode') textNodes.push(id);
                if (ct === 'EmptyLatentImage') latent = id;
                if ((ct === 'KSampler' || ct === 'KSamplerAdvanced') && !sampler) sampler = id;
            }
            if (sampler) {
                const s = wf[sampler].inputs || {};
                if (Array.isArray(s.positive) && s.positive[0]) result.promptNode = String(s.positive[0]);
                if (Array.isArray(s.negative) && s.negative[0]) result.negativeNode = String(s.negative[0]);
                if (s.seed !== undefined) result.seedNode = sampler;
            }
            if (!result.negativeNode && textNodes.length > 1) {
                const other = textNodes.find(t => t !== result.promptNode);
                if (other) result.negativeNode = other;
            }
            if (latent) { result.widthNode = latent; result.heightNode = latent; }
            return result;
        },

        getActive() {
            const cfg = State.get().settings.bgGen || {};
            return this.workflows.find(w => w.id === cfg.workflowId) || this.workflows[0];
        },
    };
    window.VNWorkflowManager = WorkflowManager;

    // ============================================================
    // 4. ComfyUI 通信
    // ============================================================
    const ComfyClient = {
        _uuid() {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0;
                return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
            });
        },

        async generate(promptText) {
            const cfg = State.get().settings.bgGen;
            const wf = WorkflowManager.getActive();
            const workflow = JSON.parse(JSON.stringify(wf.workflow));

            const fullPrompt = (cfg.stylePrefix || '') + promptText;
            if (workflow[wf.promptNode]?.inputs) {
                workflow[wf.promptNode].inputs[wf.promptField || 'text'] = fullPrompt;
            }
            if (wf.negativeNode && workflow[wf.negativeNode]?.inputs) {
                workflow[wf.negativeNode].inputs[wf.negativeField || 'text'] = cfg.negativePrompt || '';
            }
            if (wf.widthNode && workflow[wf.widthNode]?.inputs) {
                if ('width' in workflow[wf.widthNode].inputs) workflow[wf.widthNode].inputs.width = cfg.width;
                if ('height' in workflow[wf.widthNode].inputs) workflow[wf.widthNode].inputs.height = cfg.height;
            }
            if (wf.seedNode && workflow[wf.seedNode]?.inputs?.seed !== undefined) {
                workflow[wf.seedNode].inputs.seed = Math.floor(Math.random() * 2147483647);
            }

            const clientId = this._uuid();
            const promptId = this._uuid();
            const wsUrl = `ws://${cfg.comfyuiUrl}/ws?clientId=${clientId}`;

            return new Promise((resolve, reject) => {
                const ws = new WebSocket(wsUrl);
                const timer = setTimeout(() => {
                    try { ws.close(); } catch (e) { }
                    reject(new Error('生成超时（120s）'));
                }, 120000);

                ws.onopen = async () => {
                    try {
                        const resp = await fetch(`http://${cfg.comfyuiUrl}/prompt`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ prompt: workflow, client_id: clientId, prompt_id: promptId }),
                        });
                        if (!resp.ok) {
                            const txt = await resp.text();
                            throw new Error(`ComfyUI 拒绝 (${resp.status}): ${txt.slice(0, 200)}`);
                        }

                        ws.onmessage = async (event) => {
                            try {
                                const msg = JSON.parse(event.data);
                                if (msg.type === 'executing'
                                    && msg.data.node === null
                                    && msg.data.prompt_id === promptId) {
                                    const urls = await this._fetchImages(promptId, cfg.comfyuiUrl);
                                    clearTimeout(timer);
                                    ws.close();
                                    if (urls.length > 0) resolve(urls[0]);
                                    else reject(new Error('未生成图片'));
                                }
                            } catch (e) { }
                        };
                        ws.onerror = () => {
                            clearTimeout(timer);
                            reject(new Error('WebSocket 错误'));
                        };
                    } catch (e) {
                        clearTimeout(timer);
                        try { ws.close(); } catch (e2) { }
                        reject(e);
                    }
                };
                ws.onerror = () => {
                    clearTimeout(timer);
                    reject(new Error('WebSocket 连接失败，请检查 ComfyUI 是否启动'));
                };
            });
        },

        async _fetchImages(promptId, host) {
            const resp = await fetch(`http://${host}/history/${promptId}`);
            if (!resp.ok) throw new Error('获取历史失败');
            const history = await resp.json();
            const outputs = history[promptId]?.outputs || {};
            const urls = [];
            for (const node of Object.values(outputs)) {
                if (!node.images) continue;
                for (const img of node.images) {
                    const params = new URLSearchParams({
                        filename: img.filename,
                        subfolder: img.subfolder || '',
                        type: img.type || 'output',
                    });
                    const r = await fetch(`http://${host}/view?${params}`);
                    const blob = await r.blob();
                    const dataUrl = await new Promise((res, rej) => {
                        const reader = new FileReader();
                        reader.onload = () => res(reader.result);
                        reader.onerror = rej;
                        reader.readAsDataURL(blob);
                    });
                    urls.push(dataUrl);
                }
            }
            return urls;
        },

        async test() {
            const cfg = State.get().settings.bgGen;
            try {
                const r = await fetch(`http://${cfg.comfyuiUrl}/system_stats`);
                return r.ok;
            } catch (e) { return false; }
        },
    };
    window.VNComfyClient = ComfyClient;

    // ============================================================
    // 5. 提示词生成（章节片段 + 当前场景对话）
    // ============================================================
    const PromptGen = {
        async generate({ chapterTitle, chapterSnippet, sceneBg, sceneMusic, dialogues }) {
            const cfg = State.get().settings.bgGen;
            const isNatural = cfg.promptStyle !== 'clip';

            const dlgText = (dialogues || []).map(d => {
                if (d.isNarrator) return `【旁白】${d.content}`;
                return `【${d.character}】${d.content}`;
            }).join('\n');

            const rules = isNatural
                ? `1. 只画背景/环境，绝对不要出现任何人物、人脸、人影、人形。
  2. 根据「当前场景」和「最近对话」推断：地点类型、室内外、时间、天气、光线、氛围、主要物件。
  3. 不要画对话内容本身（台词提到某个物件不代表要画它特写），只画环境。
  4. 用自然语言英文描述，2-4 句，以 "no people, no characters in the scene" 结尾。
  5. 只输出提示词本身，不要解释、不要引号、不要 markdown。`
                : `1. 只画背景/环境，绝对不要出现任何人物、人脸、人影、人形。
  2. 根据「当前场景」和「最近对话」推断：地点类型、室内外、时间、天气、光线、氛围、主要物件。
  3. 不要画对话内容本身，只画环境。
  4. 输出逗号分隔的英文 CLIP 标签，不要句子，不要解释。
  5. 以 "no humans, masterpiece, best quality" 结尾。`;

            const prompt = `<|im_start|>system
You are an AI art prompt engineer for a visual novel game.
Write an English prompt to generate the BACKGROUND image of the CURRENT SCENE.
<|im_end|>
<|im_start|>user
【Chapter】${chapterTitle || '(unknown)'}
【Chapter Context (for world-building only, NOT to be drawn)】
${chapterSnippet || '(none)'}

【Current Scene】${sceneBg || '(unknown)'}
【Current Mood / Music】${sceneMusic || '(none)'}
【Recent Dialogues (use only to infer environment)】
${dlgText || '(none)'}

【STRICT RULES】
${rules}
Now output the prompt:
<|im_end|>
<|im_start|>assistant
prompt:
`;

            // 调 LLM
            if (cfg.promptSource === 'api') {
                const reply = await window.VNAPI.chat(
                    [{ role: 'user', content: prompt }],
                    { temperature: 0.85, maxTokens: 400 }
                );
                return isNatural ? this._cleanNatural(reply) : this._cleanClip(reply);
            }
            if (cfg.promptSource === 'kobold') {
                const reply = await this._kobold(prompt, cfg);
                return isNatural ? this._cleanNatural(reply) : this._cleanClip(reply);
            }
            if (cfg.promptSource === 'remote') {
                const reply = await this._remote(prompt, cfg);
                return isNatural ? this._cleanNatural(reply) : this._cleanClip(reply);
            }
            throw new Error('未知提示词来源');
        },

        _cleanClip(t) {
            if (!t) return '';
            let s = String(t).trim()
                .replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '')
                .replace(/^["'「『]+/, '').replace(/["'」』]+$/, '')
                .replace(/^(Prompt|Tags|Output|Result)\s*[:：]\s*/i, '')
                .replace(/\s*\n\s*/g, ', ').replace(/,\s*,/g, ',').replace(/\s+/g, ' ');
            return s;
        },

        _cleanNatural(t) {
            if (!t) return '';
            let s = String(t).trim()
                .replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '')
                .replace(/^["'「『]+/, '').replace(/["'」』]+$/, '')
                .replace(/^(Prompt|Output|Result)\s*[:：]\s*/i, '')
                .replace(/\n+/g, ' ').replace(/\s+/g, ' ');
            return s;
        },

        async _kobold(prompt, cfg) {
            const r = await fetch(`${cfg.koboldUrl}/api/v1/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, max_length: 300, temperature: 0.8, top_p: 0.9, rep_pen: 1.1 }),
            });
            if (!r.ok) throw new Error(`Kobold ${r.status}`);
            const d = await r.json();
            return (d.results?.[0]?.text || '').trim();
        },

        async _remote(prompt, cfg) {
            const headers = { 'Content-Type': 'application/json' };
            if (cfg.remoteApiKey) headers['Authorization'] = `Bearer ${cfg.remoteApiKey}`;
            const body = {
                model: cfg.remoteModel,
                max_tokens: 800,
                temperature: 0.8,
                messages: [{ role: 'user', content: prompt }],
                thinking: { type: 'disabled' },
            };
            const r = await fetch(cfg.remoteApiUrl, {
                method: 'POST', headers, body: JSON.stringify(body),
            });
            if (!r.ok) throw new Error(`Remote ${r.status}`);
            const d = await r.json();
            return (d.choices?.[0]?.message?.content || '').trim();
        },
    };

    // ============================================================
    // 6. 主 API
    // ============================================================
    const BackgroundGen = {
        _busy: false,

        async generateForCurrentScene() {
            if (this._busy) {
                window.UIManager?.showText?.('正在生成中，请稍候', 1500);
                return null;
            }
            const VN = window.VNPlayer;
            if (!VN || !VN.playing) {
                window.UIManager?.showText?.('请先开始播放', 1500);
                return null;
            }
            const block = VN._currentSceneBlock;
            if (!block || !block.bg) {
                window.UIManager?.showText?.('当前没有场景背景标记', 1500);
                return null;
            }

            const st = State.get();
            const chapterId = st.currentChapterId;
            const ch = State.getChapter(chapterId);
            if (!ch) return null;

            this._busy = true;
            try {
                window.UIManager?.showText?.('🎨 正在生成背景提示词…', 1500);
                const promptText = await PromptGen.generate({
                    chapterTitle: ch.title,
                    chapterSnippet: (ch.raw || '').slice(0, 800),
                    sceneBg: block.bg,
                    sceneMusic: block.music,
                    dialogues: block.dialogues.slice(-12),
                });
                if (!promptText) throw new Error('提示词为空');
                console.log('[BgGen] 提示词:', promptText);

                window.UIManager?.showText?.('🖼️ 正在绘制…', 1500);
                const dataUrl = await ComfyClient.generate(promptText);
                if (!dataUrl) throw new Error('未返回图片');

                const id = `bg_${chapterId}_${Date.now()}`;
                await BGStore.put({
                    id, dataUrl, prompt: promptText,
                    chapterId, sceneName: block.bg, createdAt: Date.now(),
                });

                // 写回章节
                if (!ch.bgImages) ch.bgImages = {};
                ch.bgImages[block.bg] = { id, prompt: promptText, at: Date.now() };
                State.save();

                // 立即应用
                window.VNBackground.apply(block.bg);

                window.UIManager?.showText?.(`✅ 已生成并应用：${block.bg}`, 2500);
                return { dataUrl, prompt: promptText };
            } catch (e) {
                console.error('[BgGen] 失败:', e);
                window.UIManager?.showText?.(`❌ ${e.message}`, 3500);
                return null;
            } finally {
                this._busy = false;
            }
        },

        async generateForSceneFromScript(chapterId, bgName) {
            const ch = State.getChapter(chapterId);
            if (!ch || !ch.script) throw new Error('没有脚本');

            // 从脚本扫出该背景名之后到下一个【背景】之前的对话
            const lines = ch.script.split('\n');
            let collecting = false;
            const dialogues = [];
            let music = '';
            for (const line of lines) {
                const bgM = line.match(/^【背景】\s*(.+)$/);
                if (bgM) {
                    if (collecting) break;
                    if (bgM[1].trim() === bgName) collecting = true;
                    continue;
                }
                if (!collecting) continue;
                const mMusic = line.match(/^🎵\s*音乐[:：]\s*(.+)$/) || line.match(/^【音乐】\s*(.+)$/);
                if (mMusic) { music = mMusic[1].trim(); continue; }
                const dM = line.match(/^【(.+?)】\s*[:：]\s*(.+)$/);
                if (dM) {
                    const meta = dM[1].split('|').map(s => s.trim());
                    const name = meta[0] || '';
                    const isNarrator = ['旁白', '系统', 'narrator'].includes(name);
                    dialogues.push({
                        character: name,
                        content: dM[2].trim(),
                        isNarrator,
                    });
                }
            }
            if (dialogues.length === 0) throw new Error('该场景没有对话');

            window.UIManager?.showText?.('🎨 正在生成提示词…', 1500);
            const promptText = await PromptGen.generate({
                chapterTitle: ch.title,
                chapterSnippet: (ch.raw || '').slice(0, 800),
                sceneBg: bgName,
                sceneMusic: music,
                dialogues: dialogues.slice(-12),
            });
            if (!promptText) throw new Error('提示词为空');

            window.UIManager?.showText?.('🖼️ 正在绘制…', 1500);
            const dataUrl = await ComfyClient.generate(promptText);
            if (!dataUrl) throw new Error('未返回图片');

            const id = `bg_${chapterId}_${Date.now()}`;
            await BGStore.put({
                id, dataUrl, prompt: promptText,
                chapterId, sceneName: bgName, createdAt: Date.now(),
            });

            if (!ch.bgImages) ch.bgImages = {};
            ch.bgImages[bgName] = { id, prompt: promptText, at: Date.now() };
            State.save();

            window.UIManager?.showText?.(`✅ 已生成：${bgName}`, 2500);
            return { dataUrl, prompt: promptText };
        },

        async getImageForScene(chapterId, bgName) {
            const ch = State.getChapter(chapterId);
            const rec = ch?.bgImages?.[bgName];
            if (!rec?.id) return null;
            const stored = await BGStore.get(rec.id);
            return stored?.dataUrl || null;
        },
    };
    window.VNBackgroundGen = BackgroundGen;

    // ============================================================
    // 7. 劫持 VNPlayer.play：初始化场景块
    // ============================================================
    const VN = window.VNPlayer;
    const _origPlay = VN.play;
    VN.play = async function (scriptText, chapterTitle) {
        this._currentSceneBlock = { bg: '', music: '', dialogues: [] };
        // 预扫描：构建 sceneBlocks 索引，便于反查
        try {
            const parsed = window.VNParser.parse(scriptText);
            this._sceneBlocks = [];
            let cur = { bg: '', music: '', startIdx: 0, endIdx: 0, dialogues: [] };
            for (let i = 0; i < parsed.timeline.length; i++) {
                const it = parsed.timeline[i];
                if (it.type === 'bg') {
                    if (cur.bg || cur.dialogues.length) {
                        cur.endIdx = i - 1;
                        this._sceneBlocks.push(cur);
                    }
                    cur = { bg: it.name, music: '', startIdx: i, endIdx: i, dialogues: [] };
                } else if (it.type === 'music') {
                    cur.music = it.name;
                } else if (it.type === 'dialogue') {
                    cur.dialogues.push(it);
                }
            }
            if (cur.bg || cur.dialogues.length) {
                cur.endIdx = parsed.timeline.length - 1;
                this._sceneBlocks.push(cur);
            }
        } catch (e) {
            this._sceneBlocks = [];
        }

        // 调用原 play
        const r = await _origPlay.call(this, scriptText, chapterTitle);

        // 显示浮动按钮
        const btn = document.getElementById('vn-bg-gen-btn');
        if (btn) {
            const cfg = State.get().settings.bgGen;
            btn.style.display = cfg.enabled ? 'flex' : 'none';
        }
        return r;
    };

    // ============================================================
    // 8. 劫持 _playDialogue：更新当前场景块
    // ============================================================
    const _origPlayDlg = VN._playDialogue;
    VN._playDialogue = async function (d) {
        // 从 _sceneBlocks 反查当前 index 所属 block
        if (this._sceneBlocks && this._sceneBlocks.length) {
            const idx = this.index;
            const block = this._sceneBlocks.find(b => idx >= b.startIdx && idx <= b.endIdx);
            if (block) {
                this._currentSceneBlock = {
                    bg: block.bg,
                    music: block.music,
                    dialogues: block.dialogues.filter(x => this.timeline.indexOf(x) <= idx),
                };
            }
        }
        return await _origPlayDlg.call(this, d);
    };

    // ============================================================
    // 9. 劫持 VNBackground.apply：优先用生成图
    // ============================================================
    const BG = window.VNBackground;
    const _origApply = BG.apply;
    BG.apply = async function (name) {
        if (!name) return _origApply.call(this, name);
        const st = State.get();
        const chapterId = st.currentChapterId;
        if (chapterId) {
            try {
                const dataUrl = await BackgroundGen.getImageForScene(chapterId, name);
                if (dataUrl) {
                    this.current = name;
                    const layer = document.getElementById('vn-bg-layer');
                    if (layer) {
                        const newLayer = document.createElement('div');
                        newLayer.className = 'vn-bg';
                        newLayer.style.cssText = `background-image: url('${dataUrl}')`;
                        layer.appendChild(newLayer);
                        void newLayer.offsetWidth;
                        newLayer.classList.add('show');
                        Array.from(layer.children).forEach(child => {
                            if (child !== newLayer) {
                                child.classList.remove('show');
                                setTimeout(() => child.remove(), 800);
                            }
                        });
                    }
                    return;
                }
            } catch (e) {
                console.warn('[BgGen] 查询生成图失败:', e);
            }
        }
        return _origApply.call(this, name);
    };

    // ============================================================
    // 10. 劫持 VNSettings.open：追加背景生成区块
    // ============================================================
    const Settings = window.VNSettings;
    const _origSettingsOpen = Settings.open;
    Settings.open = function () {
        _origSettingsOpen.call(this);
        // 原 open 是同步的，modal 已经在 DOM 里了
        setTimeout(() => {
            const modal = document.getElementById('vn-modal');
            if (!modal || !modal.classList.contains('active')) return;
            const body = modal.querySelector('.vn-modal-body');
            if (!body) return;
            if (body.querySelector('#bggen-section')) return;

            const cfg = State.get().settings.bgGen;
            const wfs = WorkflowManager.workflows;

            const section = document.createElement('div');
            section.id = 'bggen-section';
            section.style.cssText = 'margin-top:24px;padding-top:16px;border-top:1px solid rgba(255,215,100,.2);';
            section.innerHTML = `
          <div style="font-size:15px;font-weight:bold;color:#ffd76b;margin-bottom:12px;">
            🎨 背景生成
          </div>
  
          <div class="vn-field">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
              <input type="checkbox" id="bggen-enabled" ${cfg.enabled ? 'checked' : ''}>
              启用（剧情右侧显示浮动生成按钮）
            </label>
          </div>
  
          <div class="vn-field">
            <label>ComfyUI 地址</label>
            <input type="text" class="vn-input" id="bggen-comfy-url" value="${escAttr(cfg.comfyuiUrl)}">
            <div class="vn-hint">格式 <code>host:port</code>，需 ComfyUI 开启 CORS（<code>--enable-cors-header</code>）</div>
          </div>
  
          <div class="vn-field">
            <label>工作流</label>
            <select class="vn-select" id="bggen-workflow"></select>
            <div style="display:flex;gap:8px;margin-top:6px;">
              <button class="vn-btn" id="bggen-rescan">🔄 重新扫描</button>
              <button class="vn-btn" id="bggen-test">🔗 测试连接</button>
              <span id="bggen-status" style="font-size:12px;align-self:center;"></span>
            </div>
            <div class="vn-hint">工作流放在 <code>assets/workflows/</code> 下，配 manifest.json 自动加载</div>
          </div>
  
          <div class="vn-field">
            <label>提示词来源</label>
            <select class="vn-select" id="bggen-source">
              <option value="api" ${cfg.promptSource === 'api' ? 'selected' : ''}>用当前 API（推荐）</option>
              <option value="kobold" ${cfg.promptSource === 'kobold' ? 'selected' : ''}>KoboldCPP</option>
              <option value="remote" ${cfg.promptSource === 'remote' ? 'selected' : ''}>远程 API</option>
            </select>
          </div>
  
          <div id="bggen-kobold" style="${cfg.promptSource === 'kobold' ? '' : 'display:none;'}">
            <div class="vn-field">
              <label>KoboldCPP 地址</label>
              <input type="text" class="vn-input" id="bggen-kobold-url" value="${escAttr(cfg.koboldUrl)}">
            </div>
          </div>
  
          <div id="bggen-remote" style="${cfg.promptSource === 'remote' ? '' : 'display:none;'}">
            <div class="vn-field"><label>API URL</label><input type="text" class="vn-input" id="bggen-remote-url" value="${escAttr(cfg.remoteApiUrl)}"></div>
            <div class="vn-field"><label>API Key</label><input type="password" class="vn-input" id="bggen-remote-key" value="${escAttr(cfg.remoteApiKey)}"></div>
            <div class="vn-field"><label>模型</label><input type="text" class="vn-input" id="bggen-remote-model" value="${escAttr(cfg.remoteModel)}"></div>
          </div>
  
          <div class="vn-field">
            <label>提示词风格</label>
            <select class="vn-select" id="bggen-style">
              <option value="natural" ${cfg.promptStyle === 'natural' ? 'selected' : ''}>自然语言（Qwen/Anima/Flux/SD3）</option>
              <option value="clip" ${cfg.promptStyle === 'clip' ? 'selected' : ''}>CLIP 标签（SD1.5/SDXL/Pony）</option>
            </select>
          </div>
  
          <div class="vn-field">
            <label>画风前缀（可选）</label>
            <textarea class="vn-textarea" id="bggen-prefix" style="min-height:50px;">${escHtml(cfg.stylePrefix)}</textarea>
          </div>
  
          <div class="vn-field">
            <label>负面提示词</label>
            <textarea class="vn-textarea" id="bggen-negative" style="min-height:70px;">${escHtml(cfg.negativePrompt)}</textarea>
          </div>
  
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div class="vn-field"><label>宽</label><input type="number" class="vn-input" id="bggen-width" value="${cfg.width}" step="64"></div>
            <div class="vn-field"><label>高</label><input type="number" class="vn-input" id="bggen-height" value="${cfg.height}" step="64"></div>
          </div>
  
          <div class="vn-field">
            <label>已生成背景</label>
            <div class="vn-hint" id="bggen-storage-info">加载中…</div>
            <button class="vn-btn" id="bggen-manage" style="margin-top:6px;">📂 管理</button>
          </div>
        `;

            body.appendChild(section);

            // 填充工作流下拉
            const wfSel = section.querySelector('#bggen-workflow');
            wfs.forEach(w => {
                const opt = document.createElement('option');
                opt.value = w.id;
                opt.textContent = w.name + (w.isBuiltin ? ' (内置)' : '');
                if (w.id === cfg.workflowId) opt.selected = true;
                wfSel.appendChild(opt);
            });

            // 交互
            section.querySelector('#bggen-source').onchange = (e) => {
                section.querySelector('#bggen-kobold').style.display = e.target.value === 'kobold' ? '' : 'none';
                section.querySelector('#bggen-remote').style.display = e.target.value === 'remote' ? '' : 'none';
            };
            section.querySelector('#bggen-rescan').onclick = async () => {
                WorkflowManager._loaded = false;
                WorkflowManager.workflows = [BUILTIN_QWEN];
                await WorkflowManager.load();
                const s2 = section.querySelector('#bggen-workflow');
                s2.innerHTML = '';
                WorkflowManager.workflows.forEach(w => {
                    const opt = document.createElement('option');
                    opt.value = w.id;
                    opt.textContent = w.name + (w.isBuiltin ? ' (内置)' : '');
                    s2.appendChild(opt);
                });
                window.UIManager?.showText?.(`已加载 ${WorkflowManager.workflows.length} 个工作流`, 1500);
            };
            section.querySelector('#bggen-test').onclick = async () => {
                const url = section.querySelector('#bggen-comfy-url').value.trim();
                State.get().settings.bgGen.comfyuiUrl = url;
                State.save();
                const st = section.querySelector('#bggen-status');
                st.textContent = '测试中…';
                st.style.color = '#ffcf80';
                const ok = await ComfyClient.test();
                st.textContent = ok ? '✅ 连接成功' : '❌ 连接失败';
                st.style.color = ok ? '#7dd87d' : '#d87d7d';
            };
            section.querySelector('#bggen-manage').onclick = () => openStorageManager();

            // 刷新存储信息
            refreshStorageInfo(section.querySelector('#bggen-storage-info'));
        }, 50);

        return;
    };

    // 保存配置：劫持 settings 的保存按钮（原保存回调里没有我们字段，这里独立监听）
    document.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'st-save') {
            setTimeout(() => {
                const modal = document.getElementById('vn-modal');
                if (!modal) return;
                const sec = modal.querySelector('#bggen-section');
                if (!sec) return;
                const cfg = State.get().settings.bgGen;
                cfg.enabled = sec.querySelector('#bggen-enabled').checked;
                cfg.comfyuiUrl = sec.querySelector('#bggen-comfy-url').value.trim();
                cfg.workflowId = sec.querySelector('#bggen-workflow').value;
                cfg.promptSource = sec.querySelector('#bggen-source').value;
                cfg.promptStyle = sec.querySelector('#bggen-style').value;
                cfg.stylePrefix = sec.querySelector('#bggen-prefix').value;
                cfg.negativePrompt = sec.querySelector('#bggen-negative').value;
                cfg.width = parseInt(sec.querySelector('#bggen-width').value) || 1216;
                cfg.height = parseInt(sec.querySelector('#bggen-height').value) || 832;
                const koboldUrl = sec.querySelector('#bggen-kobold-url');
                if (koboldUrl) cfg.koboldUrl = koboldUrl.value.trim();
                const remoteUrl = sec.querySelector('#bggen-remote-url');
                if (remoteUrl) cfg.remoteApiUrl = remoteUrl.value.trim();
                const remoteKey = sec.querySelector('#bggen-remote-key');
                if (remoteKey) cfg.remoteApiKey = remoteKey.value;
                const remoteModel = sec.querySelector('#bggen-remote-model');
                if (remoteModel) cfg.remoteModel = remoteModel.value.trim();
                State.save(true);
                console.log('[BgGen] 配置已保存');
            }, 30);
        }
    }, true);

    // ============================================================
    // 11. 劫持 VNChapters._openChapterMenu：加批量生成按钮
    // ============================================================
    const Chapters = window.VNChapters;
    if (Chapters && Chapters._openChapterMenu) {
        const _origOpenMenu = Chapters._openChapterMenu;
        Chapters._openChapterMenu = function (chapterId) {
            const r = _origOpenMenu.call(this, chapterId);
            setTimeout(() => {
                const modal = document.getElementById('vn-modal');
                if (!modal || !modal.classList.contains('active')) return;
                const footer = modal.querySelector('.vn-modal-footer');
                if (!footer || footer.querySelector('#ch-bggen-batch')) return;
                const btn = document.createElement('button');
                btn.className = 'vn-btn';
                btn.id = 'ch-bggen-batch';
                btn.textContent = '🎨 批量背景';
                btn.onclick = async () => {
                    const ch = State.getChapter(chapterId);
                    if (!ch || !ch.script) {
                        alert('还没有脚本');
                        return;
                    }
                    // 从脚本提取所有 bg 名
                    const lines = ch.script.split('\n');
                    const names = [];
                    for (const line of lines) {
                        const m = line.match(/^【背景】\s*(.+)$/);
                        if (m) {
                            const n = m[1].trim();
                            if (n && !names.includes(n)) names.push(n);
                        }
                    }
                    if (names.length === 0) {
                        alert('脚本里没有背景标记');
                        return;
                    }
                    if (!confirm(`为本章 ${names.length} 个场景批量生成背景？\n${names.join('、')}`)) return;

                    window.VNModal.close();
                    window.UIManager?.showText?.(`开始批量生成 ${names.length} 个背景…`, 2500);

                    for (let i = 0; i < names.length; i++) {
                        const name = names[i];
                        if (ch.bgImages?.[name]?.id) {
                            window.UIManager?.showText?.(`[${i + 1}/${names.length}] ${name} 已有，跳过`, 1500);
                            continue;
                        }
                        try {
                            window.UIManager?.showText?.(`[${i + 1}/${names.length}] 生成：${name}`, 2000);
                            await BackgroundGen.generateForSceneFromScript(chapterId, name);
                        } catch (e) {
                            console.error('[BgGen] 批量生成失败:', name, e);
                            window.UIManager?.showText?.(`❌ ${name}: ${e.message}`, 3000);
                        }
                    }
                    window.UIManager?.showText?.(`批量生成完成`, 2500);
                    window.VNChapters.render();
                };
                footer.insertBefore(btn, footer.firstChild);
            }, 60);
            return r;
        };
    }

    // ============================================================
    // 12. 浮动按钮（页面已有则跳过）
    // ============================================================
    function mountFloatingButton() {
        if (document.getElementById('vn-bg-gen-btn')) return;
        const stage = document.getElementById('vn-stage');
        if (!stage) return;
        const btn = document.createElement('button');
        btn.id = 'vn-bg-gen-btn';
        btn.title = 'AI 生成当前场景背景';
        btn.style.cssText = `
        position:absolute;right:16px;top:50%;transform:translateY(-50%);
        z-index:7;width:48px;height:48px;border-radius:50%;
        background:linear-gradient(135deg,#667eea,#764ba2);border:none;color:#fff;
        font-size:20px;cursor:pointer;display:none;
        align-items:center;justify-content:center;
        box-shadow:0 4px 16px rgba(102,126,234,.5);
        transition:transform .2s ease;
      `;
        btn.textContent = '🎨';
        btn.onmouseenter = () => btn.style.transform = 'translateY(-50%) scale(1.08)';
        btn.onmouseleave = () => btn.style.transform = 'translateY(-50%)';
        btn.onclick = (e) => {
            e.stopPropagation();
            const block = window.VNPlayer?._currentSceneBlock;
            if (!block?.bg) {
                window.UIManager?.showText?.('当前没有场景', 1500);
                return;
            }
            if (!confirm(`为场景「${block.bg}」生成背景图？`)) return;
            BackgroundGen.generateForCurrentScene();
        };
        stage.appendChild(btn);
    }

    // ============================================================
    // 13. 存储管理弹窗
    // ============================================================
    async function openStorageManager() {
        const chapterId = State.get().currentChapterId;
        if (!chapterId) return;
        const list = await BGStore.listByChapter(chapterId);
        const modal = document.getElementById('vn-modal');
        if (!modal) return;

        modal.querySelector('.vn-modal-body').innerHTML = `
        <div style="font-size:14px;color:#aaa;margin-bottom:12px;">
          本章已生成 ${list.length} 张背景图
        </div>
        ${list.length === 0 ? '<div style="color:#666;padding:20px;text-align:center;">暂无</div>' : `
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;max-height:60vh;overflow-y:auto;">
            ${list.map(r => `
              <div style="background:rgba(0,0,0,.3);border-radius:8px;padding:8px;">
                <img src="${r.dataUrl}" style="width:100%;height:100px;object-fit:cover;border-radius:6px;display:block;">
                <div style="font-size:11px;color:#9ab0ff;margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escAttr(r.sceneName)}">
                  📍 ${escHtml(r.sceneName)}
                </div>
                <button class="vn-btn danger" data-del="${escAttr(r.id)}" style="width:100%;margin-top:6px;font-size:11px;padding:4px;">🗑️ 删除</button>
              </div>
            `).join('')}
          </div>
        `}
      `;
        modal.querySelectorAll('[data-del]').forEach(btn => {
            btn.onclick = async () => {
                if (!confirm('删除这张背景图？')) return;
                const id = btn.dataset.del;
                await BGStore.delete(id);
                const ch = State.getChapter(chapterId);
                for (const k in ch.bgImages) {
                    if (ch.bgImages[k].id === id) delete ch.bgImages[k];
                }
                State.save(true);
                openStorageManager();
            };
        });
        // 重绑 close
        const closeBtn = modal.querySelector('#vn-modal-close-btn');
        if (closeBtn) closeBtn.onclick = () => window.VNModal.close();
    }

    async function refreshStorageInfo(el) {
        if (!el) return;
        const chapterId = State.get().currentChapterId;
        if (!chapterId) { el.textContent = '（未播放章节）'; return; }
        try {
            const list = await BGStore.listByChapter(chapterId);
            const totalKB = list.reduce((s, r) => s + (r.dataUrl?.length || 0) * 0.75 / 1024, 0);
            el.innerHTML = `本章共 <strong style="color:#9ab0ff;">${list.length}</strong> 张 · 约 <strong style="color:#9ab0ff;">${(totalKB / 1024).toFixed(2)}</strong> MB`;
        } catch (e) {
            el.textContent = '读取失败：' + e.message;
        }
    }

    function escAttr(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function escHtml(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ============================================================
    // 14. 退出播放时隐藏按钮
    // ============================================================
    const _origExit = VN.exitToShelf;
    VN.exitToShelf = function () {
        this._currentSceneBlock = null;
        const btn = document.getElementById('vn-bg-gen-btn');
        if (btn) btn.style.display = 'none';
        return _origExit.call(this);
    };
    // ============================================================
    // 16. 劫持 VNMarkersUI.open：给背景行注入生成/重试/预览/删除
    // ============================================================
    (function hijackMarkersUI() {
        const MUI = window.VNMarkersUI;
        if (!MUI || !MUI.open) return;

        const _origOpen = MUI.open;
        MUI.open = function (chapterId) {
            _origOpen.call(this, chapterId);

            // 原 open 渲染完 modal，延迟注入按钮
            setTimeout(() => injectBgButtons(chapterId), 120);
        };

        // 生成状态缓存：{ [chapterId]: { [bgName]: 'idle'|'busy'|'done'|'fail' } }
        const statusCache = {};

        function getStatus(chapterId, bgName) {
            const ch = State.getChapter(chapterId);
            if (ch?.bgImages?.[bgName]?.id) return 'done';
            return statusCache[chapterId]?.[bgName] || 'idle';
        }

        function setStatus(chapterId, bgName, s) {
            if (!statusCache[chapterId]) statusCache[chapterId] = {};
            statusCache[chapterId][bgName] = s;
        }

        function injectBgButtons(chapterId) {
            const modal = document.getElementById('vn-modal');
            if (!modal || !modal.classList.contains('active')) return;
            const bgPanel = modal.querySelector('#vn-marker-panel-bg');
            if (!bgPanel) return;
            if (bgPanel.querySelector('.vn-bg-gen-actions-bar')) return; // 已注入

            const ch = State.getChapter(chapterId);
            if (!ch) return;

            // 顶部加「一键生成全部」按钮
            const bar = document.createElement('div');
            bar.className = 'vn-bg-gen-actions-bar';
            bar.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;';
            bar.innerHTML = `
        <button class="vn-btn primary" id="vn-bggen-all">🎨 一键生成全部</button>
        <button class="vn-btn" id="vn-bggen-preview-all">🖼️ 预览已生成</button>
      `;
            const listContainer = bgPanel.querySelector('#mk-bg-list');
            if (listContainer && listContainer.parentNode) {
                listContainer.parentNode.insertBefore(bar, listContainer);
            }

            // 每行加操作按钮
            const rows = bgPanel.querySelectorAll('.vn-marker-row');
            rows.forEach(row => {
                const name = row.dataset.name;
                if (!name) return;
                // 防重复
                if (row.querySelector('.vn-bg-gen-actions')) return;

                const actions = document.createElement('div');
                actions.className = 'vn-bg-gen-actions';
                actions.style.cssText = 'display:flex;gap:4px;align-items:center;';

                const status = getStatus(chapterId, name);
                const statusSpan = document.createElement('span');
                statusSpan.className = 'vn-bg-gen-status';
                statusSpan.style.cssText = 'font-size:11px;min-width:52px;text-align:center;';
                updateStatusSpan(statusSpan, status);
                actions.appendChild(statusSpan);

                // 生成/重试按钮
                const genBtn = document.createElement('button');
                genBtn.className = 'vn-btn';
                genBtn.style.cssText = 'padding:4px 8px;font-size:12px;';
                updateGenBtn(genBtn, status);
                genBtn.onclick = () => doGenerate(chapterId, name, genBtn, statusSpan);
                actions.appendChild(genBtn);

                // 预览（有图才显示）
                if (status === 'done') {
                    const prevBtn = document.createElement('button');
                    prevBtn.className = 'vn-btn';
                    prevBtn.style.cssText = 'padding:4px 8px;font-size:12px;';
                    prevBtn.textContent = '🖼️';
                    prevBtn.title = '预览';
                    prevBtn.onclick = () => previewImage(chapterId, name);
                    actions.appendChild(prevBtn);

                    const delBtn = document.createElement('button');
                    delBtn.className = 'vn-btn danger';
                    delBtn.style.cssText = 'padding:4px 8px;font-size:12px;';
                    delBtn.textContent = '🗑️';
                    delBtn.title = '删除这张背景图';
                    delBtn.onclick = () => deleteImage(chapterId, name);
                    actions.appendChild(delBtn);
                }

                row.appendChild(actions);
            });

            // 一键生成
            bar.querySelector('#vn-bggen-all').onclick = async () => {
                const names = [];
                bgPanel.querySelectorAll('.vn-marker-row').forEach(r => {
                    const n = r.dataset.name;
                    if (n) names.push(n);
                });
                if (names.length === 0) {
                    window.UIManager?.showText?.('没有背景标记', 1500);
                    return;
                }
                const todo = names.filter(n => getStatus(chapterId, n) !== 'done');
                if (todo.length === 0) {
                    window.UIManager?.showText?.('所有背景都已生成', 1500);
                    return;
                }
                if (!confirm(`将生成 ${todo.length} 个未生成的背景（已有 ${names.length - todo.length} 个跳过），继续？`)) return;

                for (let i = 0; i < todo.length; i++) {
                    const name = todo[i];
                    const row = bgPanel.querySelector(`.vn-marker-row[data-name="${cssEsc(name)}"]`);
                    if (!row) continue;
                    const gBtn = row.querySelector('.vn-bg-gen-actions button');
                    const sSpan = row.querySelector('.vn-bg-gen-status');
                    if (gBtn && sSpan) {
                        await doGenerate(chapterId, name, gBtn, sSpan);
                    }
                }
                window.UIManager?.showText?.('批量生成完成', 2000);
            };

            bar.querySelector('#vn-bggen-preview-all').onclick = () => {
                previewAll(chapterId);
            };
        }

        function updateStatusSpan(el, status) {
            if (status === 'done') { el.textContent = '✅'; el.style.color = '#7dd87d'; }
            else if (status === 'busy') { el.textContent = '⏳'; el.style.color = '#ffcf80'; }
            else if (status === 'fail') { el.textContent = '❌'; el.style.color = '#d87d7d'; }
            else { el.textContent = '—'; el.style.color = '#666'; }
        }

        function updateGenBtn(btn, status) {
            if (status === 'done') btn.textContent = '🔄 重绘';
            else if (status === 'busy') { btn.textContent = '⏳'; btn.disabled = true; }
            else if (status === 'fail') btn.textContent = '🔄 重试';
            else btn.textContent = '🎨';
        }

        async function doGenerate(chapterId, name, genBtn, statusSpan) {
            if (statusSpan && statusSpan.textContent === '⏳') return;
            setStatus(chapterId, name, 'busy');
            if (genBtn) { updateGenBtn(genBtn, 'busy'); }
            if (statusSpan) updateStatusSpan(statusSpan, 'busy');
            try {
                // 如果已有图，先删旧的（重绘）
                const ch = State.getChapter(chapterId);
                if (ch?.bgImages?.[name]?.id) {
                    try { await BGStore.delete(ch.bgImages[name].id); } catch (e) { }
                    delete ch.bgImages[name];
                    State.save();
                }
                await BackgroundGen.generateForSceneFromScript(chapterId, name);
                setStatus(chapterId, name, 'done');
                if (genBtn) updateGenBtn(genBtn, 'done');
                if (statusSpan) updateStatusSpan(statusSpan, 'done');
                // 重新注入，让预览/删除按钮出现
                setTimeout(() => injectBgButtons(chapterId), 50);
            } catch (e) {
                console.error('[BgGen] 生成失败:', name, e);
                setStatus(chapterId, name, 'fail');
                if (genBtn) { genBtn.disabled = false; updateGenBtn(genBtn, 'fail'); }
                if (statusSpan) updateStatusSpan(statusSpan, 'fail');
                window.UIManager?.showText?.(`❌ ${name}: ${e.message}`, 3000);
            }
        }

        async function previewImage(chapterId, name) {
            const ch = State.getChapter(chapterId);
            const rec = ch?.bgImages?.[name];
            if (!rec?.id) return;
            const stored = await BGStore.get(rec.id);
            if (!stored?.dataUrl) {
                window.UIManager?.showText?.('图片记录丢失', 2000);
                return;
            }
            showPreviewModal(name, stored);
        }

        async function previewAll(chapterId) {
            const ch = State.getChapter(chapterId);
            if (!ch?.bgImages) {
                window.UIManager?.showText?.('本章还没有生成背景', 1500);
                return;
            }
            const entries = Object.entries(ch.bgImages);
            if (entries.length === 0) {
                window.UIManager?.showText?.('本章还没有生成背景', 1500);
                return;
            }
            const items = [];
            for (const [name, rec] of entries) {
                const stored = await BGStore.get(rec.id);
                if (stored?.dataUrl) items.push({ name, ...stored });
            }
            if (items.length === 0) {
                window.UIManager?.showText?.('图片记录丢失', 2000);
                return;
            }
            showGalleryModal(items);
        }

        async function deleteImage(chapterId, name) {
            if (!confirm(`删除背景「${name}」的生成图？`)) return;
            const ch = State.getChapter(chapterId);
            const rec = ch?.bgImages?.[name];
            if (rec?.id) {
                try { await BGStore.delete(rec.id); } catch (e) { }
                delete ch.bgImages[name];
                State.save(true);
            }
            setStatus(chapterId, name, 'idle');
            injectBgButtons(chapterId);
            window.UIManager?.showText?.('已删除', 1500);
        }

        function showPreviewModal(name, stored) {
            // 直接替换 modal body，保留 header
            const modal = document.getElementById('vn-modal');
            if (!modal) return;
            const body = modal.querySelector('.vn-modal-body');
            if (!body) return;
            body.innerHTML = `
        <div style="text-align:center;">
          <div style="font-size:13px;color:#9ab0ff;margin-bottom:8px;">📍 ${escHtml(name)}</div>
          <img src="${stored.dataUrl}" style="max-width:100%;max-height:60vh;border-radius:8px;">
          <div style="font-size:11px;color:#888;margin-top:10px;line-height:1.6;text-align:left;
            background:rgba(0,0,0,.3);padding:10px;border-radius:6px;">
            <strong>提示词：</strong><br>${escHtml(stored.prompt || '')}
          </div>
          <button class="vn-btn" id="vn-bggen-preview-back" style="margin-top:14px;">← 返回配置</button>
        </div>
      `;
            body.querySelector('#vn-bggen-preview-back').onclick = () => {
                // 重新打开配置面板
                const chapterId = State.get().currentChapterId;
                window.VNModal.close();
                setTimeout(() => window.VNMarkersUI.open(chapterId), 80);
            };
        }

        function showGalleryModal(items) {
            const modal = document.getElementById('vn-modal');
            if (!modal) return;
            const body = modal.querySelector('.vn-modal-body');
            if (!body) return;
            body.innerHTML = `
        <div style="font-size:13px;color:#9ab0ff;margin-bottom:12px;">本章已生成 ${items.length} 张背景</div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;max-height:60vh;overflow-y:auto;">
          ${items.map(it => `
            <div style="background:rgba(0,0,0,.3);border-radius:8px;padding:6px;">
              <img src="${it.dataUrl}" style="width:100%;height:100px;object-fit:cover;border-radius:6px;display:block;">
              <div style="font-size:11px;color:#9ab0ff;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escAttr(it.name)}">📍 ${escHtml(it.name)}</div>
            </div>
          `).join('')}
        </div>
        <div style="text-align:center;margin-top:14px;">
          <button class="vn-btn" id="vn-bggen-gallery-back">← 返回配置</button>
        </div>
      `;
            body.querySelector('#vn-bggen-gallery-back').onclick = () => {
                const chapterId = State.get().currentChapterId;
                window.VNModal.close();
                setTimeout(() => window.VNMarkersUI.open(chapterId), 80);
            };
        }

        function cssEsc(s) {
            return String(s).replace(/["\\]/g, '\\$&');
        }
        function escHtml(s) {
            return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
        function escAttr(s) {
            return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }
    })();
    // ============================================================
    // 15. 初始化
    // ============================================================
    function boot() {
        WorkflowManager.load().catch(e => console.warn('[BgGen] 工作流加载失败:', e));
        mountFloatingButton();
        console.log('[BgGen] 劫持模块已就绪');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    console.log('[VN Reader] bggen-hijack.js 已加载');
})();

