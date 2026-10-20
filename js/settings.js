// ============================================================
// VN Reader · settings.js
// 设置面板：API / 音乐标记 / 玩家 / 阅读 / 存档
// 依赖：state.js, api.js, chapters.js
// ============================================================

(function () {
    'use strict';

    const State = window.VNState;
    const API = window.VNAPI;

    const Settings = {
        open() {
            const st = State.get();
            const cfg = st.settings;
            const api = cfg.api;
            const player = st.player;
            const musicMarkers = cfg.musicMarkers || [];

            const bodyHTML = `
          <!-- ========== API 配置 ========== -->
          <div style="margin-bottom:24px;">
            <div style="font-size:15px;font-weight:bold;color:#ffd76b;
              margin-bottom:12px;padding-bottom:6px;
              border-bottom:1px solid rgba(255,215,100,.2);">
              🔌 API 配置
            </div>
  
            <div class="vn-field">
              <label>API 地址（OpenAI 兼容）</label>
              <input type="text" class="vn-input" id="st-api-endpoint"
                value="${this._escapeAttr(api.endpoint)}"
                placeholder="http://127.0.0.1:5001">
              <div class="vn-hint">
                填写到 <code>/v1</code> 之前的部分。例如：<br>
                • KoboldCpp: <code>http://127.0.0.1:5001</code><br>
                • LM Studio: <code>http://127.0.0.1:1234</code><br>
                • Ollama: <code>http://127.0.0.1:11434</code><br>
                • OpenAI: <code>https://api.openai.com</code><br>
                • DeepSeek: <code>https://api.deepseek.com</code>
              </div>
            </div>
  
            <div class="vn-field">
              <label>API Key（本地模型可留空）</label>
              <input type="password" class="vn-input" id="st-api-key"
                value="${this._escapeAttr(api.apiKey)}"
                placeholder="sk-...">
            </div>
  
            <div class="vn-field">
              <label>模型名</label>
              <input type="text" class="vn-input" id="st-api-model"
                value="${this._escapeAttr(api.model)}"
                placeholder="例如 gpt-4o-mini / deepseek-chat / local-model">
              <div class="vn-hint">
                KoboldCpp 任意填（如 <code>koboldcpp</code>）；OpenAI 填 <code>gpt-4o-mini</code> 等
              </div>
            </div>
  
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="vn-field" style="margin:0;">
                <label>Temperature（创造性）</label>
                <input type="number" class="vn-input" id="st-api-temp"
                  value="${api.temperature}" min="0" max="2" step="0.05">
                <div class="vn-hint">0.7-1.0 适合剧本改编</div>
              </div>
              <div class="vn-field" style="margin:0;">
                <label>Max Tokens（长度上限）</label>
                <input type="number" class="vn-input" id="st-api-max"
                  value="${api.maxTokens}" min="512" max="32000" step="256">
                <div class="vn-hint">一章 4k-8k 通常够</div>
              </div>
            </div>
  
            <div style="margin-top:12px;">
              <button class="vn-btn primary" id="st-test-api">🔗 测试连通性</button>
              <span id="st-test-result" style="margin-left:12px;font-size:12px;"></span>
            </div>
          </div>
  
          <!-- ========== 玩家 ========== -->
          <div style="margin-bottom:24px;">
            <div style="font-size:15px;font-weight:bold;color:#ffd76b;
              margin-bottom:12px;padding-bottom:6px;
              border-bottom:1px solid rgba(255,215,100,.2);">
              👤 玩家信息
            </div>
  
            <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;">
              <div class="vn-field" style="margin:0;">
                <label>玩家名字</label>
                <input type="text" class="vn-input" id="st-player-name"
                  value="${this._escapeAttr(player.name)}" placeholder="我">
              </div>
              <div class="vn-field" style="margin:0;">
                <label>性别</label>
                <select class="vn-select" id="st-player-gender">
                  <option value="男" ${player.gender === '男' ? 'selected' : ''}>男</option>
                  <option value="女" ${player.gender === '女' ? 'selected' : ''}>女</option>
                  <option value="未知" ${player.gender === '未知' ? 'selected' : ''}>未知</option>
                </select>
              </div>
            </div>
            <div class="vn-hint">
              剧本里的 \`【玩家|...】\` 会用这里的名字和性别显示
            </div>
          </div>
  
          <!-- ========== 阅读设置 ========== -->
          <div style="margin-bottom:24px;">
            <div style="font-size:15px;font-weight:bold;color:#ffd76b;
              margin-bottom:12px;padding-bottom:6px;
              border-bottom:1px solid rgba(255,215,100,.2);">
              📖 阅读设置
            </div>
  
            <div class="vn-field">
              <label>文字速度（每字毫秒，越大越慢）</label>
              <input type="range" id="st-text-speed" min="10" max="80" step="5"
                value="${cfg.textSpeed}" style="width:100%;">
              <div style="font-size:12px;color:#888;margin-top:4px;">
                当前：<span id="st-text-speed-val">${cfg.textSpeed}</span>ms
              </div>
            </div>
  
            <div class="vn-field">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                <input type="checkbox" id="st-auto-advance" ${cfg.autoAdvance ? 'checked' : ''}>
                自动前进（每句 2.2 秒后自动播放下一句）
              </label>
            </div>
          </div>
  
          <!-- ========== 音乐标记 ========== -->
          <div style="margin-bottom:24px;">
            <div style="font-size:15px;font-weight:bold;color:#ffd76b;
              margin-bottom:12px;padding-bottom:6px;
              border-bottom:1px solid rgba(255,215,100,.2);">
              🎵 音乐标记
            </div>
  
            <div style="font-size:12px;color:#9ab0ff;line-height:1.8;
              padding:10px 14px;background:rgba(120,150,255,.08);
              border-radius:8px;word-break:break-all;margin-bottom:10px;">
              ${musicMarkers.length > 0
                    ? musicMarkers.map(m => `🎵 ${m}`).join(' · ')
                    : '<span style="color:#888;">未配置</span>'}
            </div>
            <button class="vn-btn" id="st-edit-music">✏️ 编辑音乐标记</button>
          </div>
  
          <!-- ========== TTS ========== -->
            <div style="margin-bottom:24px;">
            <div style="font-size:15px;font-weight:bold;color:#ffd76b;
                margin-bottom:12px;padding-bottom:6px;
                border-bottom:1px solid rgba(255,215,100,.2);">
                🔊 语音（TTS）
            </div>
            <div id="tts-mount-point"></div>
            </div>
  
          <!-- ========== 存档 ========== -->
          <div style="margin-bottom:8px;">
            <div style="font-size:15px;font-weight:bold;color:#ffd76b;
              margin-bottom:12px;padding-bottom:6px;
              border-bottom:1px solid rgba(255,215,100,.2);">
              💾 存档
            </div>
  
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="vn-btn" id="st-export">📤 导出存档（JSON）</button>
              <button class="vn-btn" id="st-import">📥 导入存档</button>
              <button class="vn-btn danger" id="st-reset">🔄 重置全部数据</button>
            </div>
            <input type="file" id="st-import-input" accept=".json" hidden>
            <div class="vn-hint">
              导出后可以备份或换设备。重置会清空所有章节和设置。
            </div>
          </div>
        `;

            const footerHTML = `
          <button class="vn-btn" id="st-cancel">取消</button>
          <button class="vn-btn primary" id="st-save">💾 保存全部</button>
        `;

            window.VNModal.open({
                title: '⚙️ 设置',
                bodyHTML,
                footerHTML,
                onMount: (modal) => {
                    // ★ 挂载 TTS 区段
                    const ttsMount = modal.querySelector('#tts-mount-point');
                    if (ttsMount && window.TTSAppUI) {
                        ttsMount.innerHTML = window.TTSAppUI.renderSection();
                        window.TTSAppUI.bindEvents(modal);
                    } else if (ttsMount) {
                        ttsMount.innerHTML = '<div style="font-size:12px;color:#888;">TTS 模块未加载</div>';
                    }
                    // ---------- 文字速度实时显示 ----------
                    const speedInput = modal.querySelector('#st-text-speed');
                    const speedVal = modal.querySelector('#st-text-speed-val');
                    speedInput.oninput = () => {
                        speedVal.textContent = speedInput.value;
                    };

                    // ---------- 测试 API ----------
                    modal.querySelector('#st-test-api').onclick = async () => {
                        const resultEl = modal.querySelector('#st-test-result');
                        const btn = modal.querySelector('#st-test-api');

                        // 先临时保存当前填写
                        this._saveAPIFromForm(modal);

                        btn.disabled = true;
                        btn.textContent = '⏳ 测试中…';
                        resultEl.textContent = '';

                        const r = await API.test();

                        btn.disabled = false;
                        btn.textContent = '🔗 测试连通性';

                        if (r.ok) {
                            resultEl.style.color = '#7dd87d';
                            resultEl.textContent = `✅ 连通正常，AI 回复：「${r.reply}」`;
                        } else {
                            resultEl.style.color = '#d87d7d';
                            resultEl.textContent = `❌ ${r.error}`;
                        }
                    };

                    // ---------- 编辑音乐标记 ----------
                    modal.querySelector('#st-edit-music').onclick = () => {
                        window.VNModal.close();
                        setTimeout(() => {
                            window.VNChapters.openMusicMarkerConfig();
                        }, 100);
                    };

                    // ---------- 导出 ----------
                    modal.querySelector('#st-export').onclick = () => {
                        const json = State.export();
                        const blob = new Blob([json], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `vn-reader-backup-${new Date().toISOString().slice(0, 10)}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                    };

                    // ---------- 导入 ----------
                    const importInput = modal.querySelector('#st-import-input');
                    modal.querySelector('#st-import').onclick = () => {
                        importInput.click();
                    };
                    importInput.onchange = async () => {
                        const file = importInput.files?.[0];
                        if (!file) return;
                        try {
                            const text = await file.text();
                            if (!confirm('导入会覆盖当前所有数据，继续？')) return;
                            State.import(text);
                        } catch (e) {
                            alert('导入失败：' + e.message);
                        }
                    };

                    // ---------- 重置 ----------
                    modal.querySelector('#st-reset').onclick = () => {
                        if (!confirm('确定重置所有数据？此操作不可撤销！')) return;
                        if (!confirm('再确认一次：所有章节、脚本、设置都会清空')) return;
                        State.clear();
                    };

                    // ---------- 取消 ----------
                    modal.querySelector('#st-cancel').onclick = () => window.VNModal.close();

                    // ---------- 保存 ----------
                    modal.querySelector('#st-save').onclick = () => {
                        // API
                        this._saveAPIFromForm(modal);

                        // 玩家
                        const pname = modal.querySelector('#st-player-name').value.trim();
                        if (pname) State.get().player.name = pname;
                        State.get().player.gender = modal.querySelector('#st-player-gender').value;

                        // 阅读
                        State.get().settings.textSpeed = parseInt(speedInput.value) || 30;
                        State.get().settings.autoAdvance = modal.querySelector('#st-auto-advance').checked;

                        State.save();
                        window.VNModal.close();
                        window.UIManager?.showText?.('✅ 设置已保存', 1500);
                    };
                },
            });
        },

        _saveAPIFromForm(modal) {
            const api = State.get().settings.api;
            api.endpoint = modal.querySelector('#st-api-endpoint').value.trim();
            api.apiKey = modal.querySelector('#st-api-key').value.trim();
            api.model = modal.querySelector('#st-api-model').value.trim();
            api.temperature = parseFloat(modal.querySelector('#st-api-temp').value) || 0.8;
            api.maxTokens = parseInt(modal.querySelector('#st-api-max').value) || 4096;
            State.save();
        },

        _escapeAttr(str) {
            return String(str ?? '')
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        },
    };

    window.VNSettings = Settings;
    console.log('[VN Reader] settings.js 已加载');
})();