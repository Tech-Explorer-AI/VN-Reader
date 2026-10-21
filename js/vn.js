// ============================================================
// VN Reader · vn.js
// VN 播放器：脚本解析 / 打字机 / 立绘 / 背景 / 音乐 / 选项
// ============================================================

(function () {
  'use strict';

  const State = window.VNState;
  const SpriteManager = window.SpriteManager;

  // ============================================================
  // 脚本解析
  // ============================================================
  const Parser = {
    parse(scriptText) {
      const result = {
        bg: '',
        music: '',
        timeline: [],
        options: [],
      };
      if (!scriptText) return result;

      // 合并"角色行 + 下一行以冒号开头"
      const rawLines = scriptText.split('\n');
      const lines = [];
      for (let i = 0; i < rawLines.length; i++) {
        const cur = rawLines[i].trim();
        if (!cur) continue;

        const isCharLine = /^【.+?】\s*$/.test(cur);
        if (isCharLine && i + 1 < rawLines.length) {
          const next = rawLines[i + 1].trim();
          if (/^[:：]/.test(next)) {
            lines.push(cur + next);
            i++;
            continue;
          }
        }
        lines.push(cur);
      }

      let inOptions = false;

      for (const line of lines) {
        // 背景
        let m = line.match(/^【背景】\s*(.+)$/);
        if (m) {
          const name = m[1].trim();
          if (!result.bg) result.bg = name;
          result.timeline.push({ type: 'bg', name });
          continue;
        }

        // 音乐
        m = line.match(/^🎵\s*音乐[:：]\s*(.+)$/) || line.match(/^【音乐】\s*(.+)$/);
        if (m) {
          const name = m[1].trim();
          if (!result.music) result.music = name;
          result.timeline.push({ type: 'music', name });
          continue;
        }

        // 选项区开始
        if (/^【选项】/.test(line)) {
          inOptions = true;
          continue;
        }

        // 选项行
        if (inOptions) {
          const om = line.match(/^([A-Z])[.、]\s*(.+)$/);
          if (om) {
            result.options.push({ key: om[1], text: om[2].trim() });
          }
          continue;
        }

        // 对话
        const dm = line.match(/^【(.+?)】\s*[:：]\s*(.+)$/);
        if (dm) {
          const meta = dm[1].split('|').map(s => s.trim());
          const name = meta[0] || '';
          const vis = (meta[1] || '显示').includes('隐藏') ? 'hidden' : 'visible';
          const posStr = meta[2] || '中';
          const gender = meta[3] || '';
          const stateName = meta[4] || '';

          let position = 'center';
          if (posStr.includes('左')) position = 'left';
          else if (posStr.includes('右')) position = 'right';

          const isNarrator = ['旁白', '系统', 'narrator'].includes(name);

          result.timeline.push({
            type: 'dialogue',
            character: name,
            visibility: vis,
            position,
            gender,
            state: stateName,
            content: dm[2].trim(),
            isNarrator,
          });
        }
      }

      return result;
    },

    extractCharacters(parsed) {
      const map = new Map();
      for (const item of parsed.timeline) {
        if (item.type !== 'dialogue' || item.isNarrator) continue;
        const key = item.character;
        if (!map.has(key)) {
          map.set(key, {
            name: item.character,
            gender: item.gender,
            states: new Set(),
          });
        }
        if (item.state) map.get(key).states.add(item.state);
      }
      return Array.from(map.values()).map(c => ({
        name: c.name,
        gender: c.gender,
        states: Array.from(c.states),
      }));
    },
  };

  // ============================================================
  // 背景
  // ============================================================
  const BG = {
    basePath: 'assets/bg/',
    cache: {},
    current: null,

    async find(name) {
      if (!name) return null;
      if (name in this.cache) return this.cache[name];

      const exts = ['png', 'jpg', 'jpeg', 'webp'];
      for (const ext of exts) {
        const path = `${this.basePath}${name}.${ext}`;
        if (await this._exists(path)) {
          this.cache[name] = path;
          return path;
        }
      }
      this.cache[name] = null;
      return null;
    },

    _exists(url) {
      return new Promise(resolve => {
        const img = new Image();
        const timer = setTimeout(() => resolve(false), 800);
        img.onload = () => { clearTimeout(timer); resolve(true); };
        img.onerror = () => { clearTimeout(timer); resolve(false); };
        img.src = url;
      });
    },

    async apply(name) {
      if (!name) return;
      if (this.current === name) return;
      this.current = name;

      const layer = document.getElementById('vn-bg-layer');
      if (!layer) return;

      const url = await this.find(name);
      const fallback = State.get().settings.fallbackBg;
      const style = url
        ? `background-image: url('${url}')`
        : `background: ${fallback}`;

      const newLayer = document.createElement('div');
      newLayer.className = 'vn-bg';
      newLayer.style.cssText = style;
      layer.appendChild(newLayer);

      void newLayer.offsetWidth;
      newLayer.classList.add('show');

      Array.from(layer.children).forEach(child => {
        if (child !== newLayer) {
          child.classList.remove('show');
          setTimeout(() => child.remove(), 800);
        }
      });
    },

    clear() {
      const layer = document.getElementById('vn-bg-layer');
      if (layer) layer.innerHTML = '';
      this.current = null;
    },
  };

  // ============================================================
  // 音乐
  // ============================================================
  const Music = {
    basePath: 'assets/music/',
    cache: {},
    _failedMusic: new Set(),
    audio: null,
    current: null,
    baseVolume: 0.5,
    _ready: false,

    init() {
      if (this.audio) return;
      this.audio = new Audio();
      this.audio.loop = true;
      this.audio.volume = this.baseVolume;

      const unlock = () => {
        this._ready = true;
        if (this.current && this.audio.paused) {
          this.audio.play().catch(() => { });
        }
        document.removeEventListener('click', unlock);
        document.removeEventListener('keydown', unlock);
      };
      document.addEventListener('click', unlock);
      document.addEventListener('keydown', unlock);
    },

    setVolume(v) {
      this.baseVolume = Math.max(0, Math.min(1, v));
      if (!window.TTSDucking?.isDucking?.()) {
        if (this.audio) this.audio.volume = this.baseVolume;
      }
    },

    async find(name) {
      if (!name) return null;
      if (name in this.cache) return this.cache[name];

      const exts = ['mp3', 'ogg', 'wav', 'm4a'];
      for (const ext of exts) {
        const path = `${this.basePath}${name}.${ext}`;
        if (await this._exists(path)) {
          this.cache[name] = path;
          return path;
        }
      }
      this.cache[name] = null;
      return null;
    },

    _exists(url) {
      return new Promise(resolve => {
        fetch(url, { method: 'HEAD' })
          .then(r => resolve(r.ok))
          .catch(() => resolve(false));
      });
    },

    async play(name) {
      this.init();
      if (!name) return this.stop();
      if (this.current === name) return;
      if (this._failedMusic.has(name)) return;

      const url = await this.find(name);
      if (!url) {
        console.log('[Music] 未找到:', name);
        this._failedMusic.add(name);
        return;
      }

      this.current = name;
      this.audio.src = url;

      if (this._ready) {
        this.audio.volume = this.baseVolume;
        this.audio.play().catch(() => { });
      }
    },

    stop() {
      if (this.audio) {
        this.audio.pause();
        this.audio.src = '';
      }
      this.current = null;
    },
  };

  // ============================================================
  // VN 播放器
  // ============================================================
  const VN = {
    timeline: [],
    index: 0,
    playing: false,
    isTyping: false,
    _typeTimer: null,
    _typingResolve: null,   // ★ 打字机 Promise 的 resolve
    _currentDialogue: null,
    _clickResolve: null,
    _autoTimer: null,
    _pendingTTS: null,
    _slots: { left: null, center: null, right: null },
    _playerName: '我',
    _pendingOptions: [],

    // ============================================================
    // 播放整段
    // ============================================================
    async play(scriptText, chapterTitle = '') {
      const parsed = Parser.parse(scriptText);

      if (parsed.timeline.length === 0) {
        alert('脚本为空');
        return;
      }

      this.timeline = parsed.timeline;
      this._pendingOptions = parsed.options;
      this.index = 0;
      this.playing = true;
      this.isTyping = false;
      this._typingResolve = null;
      this._clickResolve = null;
      this._currentDialogue = null;
      this._pendingTTS = null;
      this._playerName = State.get().player.name || '我';

      Music.init();
      Music.setVolume(State.get().tts.bgmVolume ?? 0.5);

      document.getElementById('vn-bookshelf').classList.remove('active');
      document.getElementById('vn-stage').classList.add('active');
      document.getElementById('vn-chapter-title').textContent = chapterTitle;

      this.clearSprites();
      BG.clear();
      Music.stop();

      if (parsed.bg) await BG.apply(parsed.bg);
      if (parsed.music) await Music.play(parsed.music);

      // 给 dialogue 挂 tts 索引
      let ttsIdx = 0;
      for (const item of this.timeline) {
        if (item.type === 'dialogue') {
          item.__ttsIndex = ttsIdx++;
        }
      }

      // 启动 TTS 流水线
      if (window.TTSPlayer && State.get().tts.enabled) {
        const dialogues = this.timeline
          .filter(x => x.type === 'dialogue')
          .map(x => ({
            character: x.character,
            content: x.content,
            extraInfo: x.gender,
            __ttsIndex: x.__ttsIndex,
          }));
        try { window.TTSPlayer.startPipeline(dialogues); } catch (e) { }
      }

      await this._runLoop();
    },

    async _runLoop() {
      while (this.playing && this.index < this.timeline.length) {
        const item = this.timeline[this.index];

        if (item.type === 'bg') {
          // 背景切换 = 场景切换 → 清空上一个场景的立绘
          this.clearSprites();
          await BG.apply(item.name);
          this.index++;
          continue;
        }
        if (item.type === 'music') {
          await Music.play(item.name);
          this.index++;
          continue;
        }
        if (item.type === 'dialogue') {
          await this._playDialogue(item);
          this.index++;
          continue;
        }
        this.index++;
      }

      if (this.playing) {
        await this._onFinish();
      }
    },

    async _playDialogue(d) {
      await this._updateSprite(d);
      await this._showDialogue(d);
      await this._waitClick();
    },

    // ============================================================
    // 立绘
    // ============================================================
    async _updateSprite(d) {
      if (d.isNarrator) {
        this._highlightSpeaker(null);
        return;
      }
    
      const isPlayer = this._isPlayer(d.character);
      const isMobile = window.matchMedia('(max-width: 640px)').matches
                    || (window.matchMedia('(max-height: 500px)').matches
                        && window.matchMedia('(orientation: landscape)').matches);
    
      const slotKey = isMobile ? 'center' : d.position;
      const slotEl = document.querySelector(`.vn-sprite-slot[data-pos="${slotKey}"]`);
      if (!slotEl) return;
    
      const currentOccupant = this._slots[slotKey];
      const newState = d.state || '默认';
    
      // ---- 同一个人 & 状态没变：只改显隐/高亮，不动 DOM ----
      if (currentOccupant === d.character) {
        const prevState = slotEl.dataset.spriteState || '默认';
        if (prevState === newState) {
          const img = slotEl.querySelector('img.vn-sprite.is-in, .vn-sprite-placeholder.is-in');
          if (img && d.visibility === 'hidden') {
            this._fadeOutSlot(slotEl);
            this._slots[slotKey] = null;
            slotEl.dataset.characterName = '';
          }
          this._highlightSpeaker(d.character);
          return;
        }
      }
    
      // ---- 拿 URL ----
      let url = null;
      if (isPlayer) url = await SpriteManager.getPlayerSprite(newState);
      else          url = await SpriteManager.get(d.character, d.gender || '默认', newState);
    
      // ★ 关键：如果槽位里已经有这个角色，且新 URL 和当前 <img src> 完全一致，
      //   说明这次"状态变化"其实没换图（玩家缺状态图 fallback 到同一张），
      //   只需要更新 spriteState，不要走淡出淡入。
      if (currentOccupant === d.character) {
        const curImg = slotEl.querySelector('img.vn-sprite.is-in');
        const curSrc = curImg ? curImg.getAttribute('src') : '';
        const newUrl = url || '';
        if (curSrc === newUrl) {
          slotEl.dataset.spriteState = newState;   // 记录新状态，下次真正换图时才能判断
          // 显隐处理
          if (d.visibility === 'hidden') {
            this._fadeOutSlot(slotEl);
            this._slots[slotKey] = null;
            slotEl.dataset.characterName = '';
          } else {
            this._highlightSpeaker(d.character);
          }
          return;
        }
      }
    
      // 隐藏：直接淡出
      if (d.visibility === 'hidden') {
        if (this._slots[slotKey] === d.character) {
          this._fadeOutSlot(slotEl);
          this._slots[slotKey] = null;
          slotEl.dataset.characterName = '';
        }
        slotEl.dataset.spriteState = newState;
        return;
      }
    
      // 预解码
      if (url) {
        try {
          const probe = new Image();
          probe.src = url;
          if (probe.decode) await probe.decode().catch(() => {});
          else await new Promise(r => { probe.onload = r; probe.onerror = r; });
        } catch (e) {}
      }
    
      // ★ 换人（hasOther）→ 顺序切换；同角色真换图 → 交叉淡入
      const hasOther = currentOccupant && currentOccupant !== d.character;
      const oldEls = slotEl.querySelectorAll('img.vn-sprite, .vn-sprite-placeholder');
    
      if (hasOther) {
        oldEls.forEach(el => {
          el.classList.remove('is-in');
          el.classList.add('is-out');
        });
        await new Promise(r => setTimeout(r, 200));
        slotEl.innerHTML = '';
      } else {
        oldEls.forEach(el => {
          el.classList.remove('is-in');
          el.classList.add('is-out');
          setTimeout(() => el.remove(), 380);
        });
      }
    
      let newEl;
      if (url) {
        newEl = document.createElement('img');
        newEl.className = 'vn-sprite';
        newEl.src = url;
        newEl.alt = d.character;
        newEl.title = d.character;
      } else {
        newEl = document.createElement('div');
        newEl.className = 'vn-sprite-placeholder';
        newEl.textContent = d.character;
      }
      slotEl.appendChild(newEl);
    
      requestAnimationFrame(() => {
        requestAnimationFrame(() => newEl.classList.add('is-in'));
      });
    
      slotEl.dataset.characterName = d.character;
      slotEl.dataset.spriteState = newState;
      this._slots[slotKey] = d.character;
    
      this._highlightSpeaker(d.character);
    },

    // ★ 新增：淡出整个槽位（隐藏角色时用）
    _fadeOutSlot(slotEl) {
      const els = slotEl.querySelectorAll('img.vn-sprite, .vn-sprite-placeholder');
      els.forEach(el => {
        el.classList.remove('is-in');
        el.classList.add('is-out');
        setTimeout(() => el.remove(), 380);
      });
    },

    _highlightSpeaker(speakerName) {
      document.querySelectorAll('.vn-sprite-slot').forEach(slot => {
        const name = slot.dataset.characterName;
        const el = slot.querySelector('img.vn-sprite, .vn-sprite-placeholder');
        if (!el) return;

        el.classList.remove('is-speaking', 'is-listening');

        if (!speakerName) return;
        if (name === speakerName) {
          el.classList.remove('hidden-state');
          el.classList.add('is-speaking');
        } else {
          el.classList.add('is-listening');
        }
      });
    },

    // ============================================================
    // 打字机
    // ============================================================
    async _showDialogue(d) {
      const box = document.getElementById('vn-dialogue-box');
      const speakerEl = document.getElementById('vn-speaker');
      const textEl = document.getElementById('vn-text');

      box.classList.add('active');

      if (d.isNarrator) {
        speakerEl.textContent = '';
        speakerEl.className = 'narrator';
        speakerEl.style.display = 'none';
        textEl.className = 'narrator';
      } else {
        const displayName = this._isPlayer(d.character) ? this._playerName : d.character;
        speakerEl.textContent = displayName;
        speakerEl.className = '';
        speakerEl.style.display = '';
        textEl.className = '';
      }

      textEl.textContent = '';
      textEl.classList.add('typing');
      this.isTyping = true;
      this._currentDialogue = d;

      const speed = State.get().settings.textSpeed ?? 30;

      // TTS 并行
      let ttsPromise = null;
      if (window.TTSPlayer && State.get().tts.enabled && d.__ttsIndex !== undefined) {
        const dlg = {
          character: d.character,
          content: d.content,
          extraInfo: d.gender,
        };
        ttsPromise = window.TTSPlayer.playFor(dlg, d.__ttsIndex).catch(() => { });
        this._pendingTTS = ttsPromise;
      }

      // ★ 打字机：存 _typingResolve，允许 advance 强制 resolve
      await new Promise(resolve => {
        this._typingResolve = resolve;

        let i = 0;
        const type = () => {
          if (!this.isTyping) {
            resolve();
            return;
          }
          if (i < d.content.length) {
            textEl.textContent += d.content.charAt(i++);
            this._typeTimer = setTimeout(type, speed);
          } else {
            resolve();
          }
        };
        type();
      });

      this._typingResolve = null;
      this.isTyping = false;
      if (this._typeTimer) {
        clearTimeout(this._typeTimer);
        this._typeTimer = null;
      }
      textEl.classList.remove('typing');

      // waitForTTS：最多等 15 秒
      if (ttsPromise && State.get().tts.waitForTTS) {
        try {
          await Promise.race([
            ttsPromise,
            new Promise(r => setTimeout(r, 15000)),
          ]);
        } catch (e) { }
      }
      this._pendingTTS = null;
    },

    // ============================================================
    // 等点击
    // ============================================================
    _waitClick() {
      return new Promise(resolve => {
        // 防重叠
        if (this._clickResolve) {
          const old = this._clickResolve;
          this._clickResolve = null;
          try { old(); } catch (e) { }
        }
        this._clickResolve = resolve;

        if (State.get().settings.autoAdvance) {
          this._autoTimer = setTimeout(() => {
            this._autoTimer = null;
            if (this._clickResolve === resolve) {
              this._clickResolve = null;
              resolve();
            }
          }, 2200);
        }
      });
    },

    // ============================================================
    // 点击推进
    // ============================================================
    advance() {
      if (!this.playing) return;

      // ★ 打字中 → 立刻补全，并强制 resolve 打字机 Promise
      if (this.isTyping && this._currentDialogue) {
        this.isTyping = false;
        if (this._typeTimer) {
          clearTimeout(this._typeTimer);
          this._typeTimer = null;
        }
        const textEl = document.getElementById('vn-text');
        if (textEl) {
          textEl.classList.remove('typing');
          textEl.textContent = this._currentDialogue.content;
        }
        if (this._typingResolve) {
          const r = this._typingResolve;
          this._typingResolve = null;
          r();
        }
        return;
      }

      // 等点击中 → resolve
      if (this._clickResolve) {
        if (this._autoTimer) {
          clearTimeout(this._autoTimer);
          this._autoTimer = null;
        }
        const r = this._clickResolve;
        this._clickResolve = null;
        r();
      }
    },

    // ============================================================
    // 结束 / 选项
    // ============================================================
    async _onFinish() {
      if (this._pendingOptions && this._pendingOptions.length > 0) {
        this._showOptions(this._pendingOptions);
        return;
      }
      await this._showEndOverlay();
    },

    _showOptions(options) {
      const layer = document.getElementById('vn-options-layer');
      layer.innerHTML = '';
      layer.classList.add('active');

      options.forEach(opt => {
        const btn = document.createElement('div');
        btn.className = 'vn-option';
        btn.innerHTML = `
          <span class="vn-opt-key">${opt.key}</span>
          <span class="vn-opt-text">${this._escape(opt.text)}</span>
        `;
        btn.addEventListener('click', () => {
          layer.classList.remove('active');
          layer.innerHTML = '';
          this._handleChoice(opt);
        });
        layer.appendChild(btn);
      });
    },

    async _handleChoice(opt) {
      await this._showEndOverlay(`你选择了：${opt.key}. ${opt.text}`);
    },

    async _showEndOverlay(extraText = '') {
      const box = document.getElementById('vn-dialogue-box');
      box.classList.add('active');
      document.getElementById('vn-speaker').textContent = '';
      document.getElementById('vn-speaker').style.display = 'none';
      document.getElementById('vn-text').className = 'narrator';
      document.getElementById('vn-text').textContent = extraText
        ? `${extraText}\n\n— 本章完 —`
        : '— 本章完 —';

      await new Promise(resolve => {
        this._clickResolve = () => {
          this._clickResolve = null;
          resolve();
        };
      });

      this.exitToShelf();
    },

    // ============================================================
    // 跳过 / 重播 / 退出
    // ============================================================
    skip() {
      if (!this.playing) return;
      try { window.TTSPlayer?.abort?.(); } catch (e) { }
      this.playing = false;
      this._typingResolve = null;
      this._clickResolve = null;
      if (this._typeTimer) clearTimeout(this._typeTimer);
      this._typeTimer = null;
      this.timeline = [];
      this.index = 0;
      this.exitToShelf();
    },

    replay() {
      const ch = State.getChapter(State.get().currentChapterId);
      if (ch && ch.script) {
        this.play(ch.script, ch.title);
      }
    },

    exitToShelf() {
      this.playing = false;
      this.isTyping = false;
      try { window.TTSPlayer?.abort?.(); } catch (e) { }
      Music.stop();
      BG.clear();
      this.clearSprites();

      const box = document.getElementById('vn-dialogue-box');
      if (box) box.classList.remove('active');
      const opt = document.getElementById('vn-options-layer');
      if (opt) {
        opt.classList.remove('active');
        opt.innerHTML = '';
      }
      document.getElementById('vn-stage').classList.remove('active');
      document.getElementById('vn-bookshelf').classList.add('active');
      if (window.VNChapters) window.VNChapters.render();
    },

    clearSprites() {
      document.querySelectorAll('.vn-sprite-slot').forEach(s => {
        s.innerHTML = '';
        delete s.dataset.characterName;
        delete s.dataset.spriteState;
      });
      this._slots = { left: null, center: null, right: null };
    },

    // ============================================================
    // 工具
    // ============================================================
    _isPlayer(name) {
      if (!name) return false;
      return ['玩家', '我', '主人公', 'player'].includes(name)
        || name === this._playerName;
    },

    _escape(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    },

    showLoading(text = '加载中…') {
      document.getElementById('vn-loading-text').textContent = text;
      document.getElementById('vn-loading').classList.add('active');
    },
    hideLoading() {
      document.getElementById('vn-loading').classList.remove('active');
    },
  };

  // ============================================================
  // 绑定
  // ============================================================
  function bindEvents() {
    // 对话框点击 → 推进
    document.getElementById('vn-dialogue-box').addEventListener('click', () => {
      VN.advance();
    });

    // 舞台点击 → 推进（排除工具条 / 选项 / 加载）
    document.getElementById('vn-stage').addEventListener('click', (e) => {
      if (e.target.closest('#vn-topbar, #vn-options-layer, #vn-loading')) return;
      if (e.target.closest('#vn-dialogue-box')) return;
      VN.advance();
    });

    // ★ 立绘 hover：因立绘本身 pointer-events:none，
    //    用 mousemove 手动算是否落在图片矩形内
    document.getElementById('vn-stage').addEventListener('mousemove', (e) => {
      const imgs = document.querySelectorAll('img.vn-sprite');
      if (imgs.length === 0) return;

      imgs.forEach(img => {
        const r = img.getBoundingClientRect();
        const hover = e.clientX >= r.left && e.clientX <= r.right
          && e.clientY >= r.top && e.clientY <= r.bottom;
        img.classList.toggle('is-hover', hover);
      });
    });

    document.getElementById('vn-stage').addEventListener('mouseleave', () => {
      document.querySelectorAll('img.vn-sprite').forEach(img => {
        img.classList.remove('is-hover');
      });
    });

    // 顶部按钮
    document.getElementById('btn-back-shelf').addEventListener('click', () => {
      if (VN.playing) {
        if (!confirm('退出播放？进度不会保存')) return;
      }
      VN.exitToShelf();
    });
    document.getElementById('btn-skip').addEventListener('click', () => {
      if (confirm('跳过本章？')) VN.skip();
    });
    document.getElementById('btn-replay').addEventListener('click', () => {
      VN.replay();
    });
    document.getElementById('btn-fullscreen').addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => { });
      } else {
        document.exitFullscreen?.();
      }
    });

    // 键盘
    document.addEventListener('keydown', (e) => {
      if (!VN.playing) return;
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault();
        VN.advance();
      }
      if (e.key === 'Escape') {
        VN.exitToShelf();
      }
    });
  }

  // ============================================================
  // 挂载
  // ============================================================
  window.VNParser = Parser;
  window.VNBackground = BG;
  window.VNMusic = Music;
  window.VNPlayer = VN;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindEvents);
  } else {
    bindEvents();
  }

  console.log('[VN Reader] vn.js 已加载');
})();