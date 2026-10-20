// ============================================================
// VN Reader · tts/ui.js
// UI 层：TTS 配置面板 + 接入 VN 播放器
// ============================================================

(function () {
    'use strict';
  
    const State = window.VNState;
    const TTSCore = window.TTSCore;
    const TTSRouter = window.TTSRouter;
    const TTSPlayer = window.TTSPlayer;
    const TTSConfig = window.TTSConfig;
  
    // ============================================================
    // TTSManager：初始化 + 打补丁
    // ============================================================
    const TTSManager = {
      init() {
        if (!TTSCore || !TTSPlayer || !TTSConfig) {
          console.warn('[TTS·UI] 依赖未就绪，跳过 init');
          return;
        }
        TTSCore.init();
        this._patchVN();
        this._applyBgmVolume();
        console.log('[TTS·UI] 初始化完成');
      },
  
      _applyBgmVolume() {
        const cfg = TTSConfig.get();
        if (window.TTSDucking) {
          window.TTSDucking.setBaseVolume(cfg.bgmVolume);
        } else if (window.VNMusic?.setVolume) {
          window.VNMusic.setVolume(cfg.bgmVolume);
        }
      },
  
      // ★ VN 播放器已经预留了 __ttsIndex + startPipeline/playFor 接口，
      //   这里只需要确认 patch 存在（防重复）
      _patchVN() {
        const VN = window.VNPlayer;
        if (!VN) return;
        if (VN._ttsPatched) return;
  
        // VNPlayer.play 里已经做了：
        //   - 给 timeline 的 dialogue 挂 __ttsIndex
        //   - 调用 TTSPlayer.startPipeline(dialogues)
        // VNPlayer._showDialogue 里已经做了：
        //   - 调用 TTSPlayer.playFor(dlg, __ttsIndex)
        // 所以这里只挂 skip/stop 时的 abort
        const origSkip = VN.skip?.bind(VN);
        if (origSkip) {
          VN.skip = function () {
            try { TTSPlayer.abort(); } catch (e) {}
            return origSkip();
          };
        }
  
        const origExit = VN.exitToShelf?.bind(VN);
        if (origExit) {
          VN.exitToShelf = function () {
            try { TTSPlayer.abort(); } catch (e) {}
            return origExit();
          };
        }
  
        VN._ttsPatched = true;
        console.log('[TTS·UI] VN 已打补丁（skip/exit abort）');
      },
    };
  
    // ============================================================
    // TTSAppUI：在设置面板里渲染 TTS 区段
    // ============================================================
    const TTSAppUI = {
      // 生成 HTML 片段（供 settings.js 内嵌）
      renderSection() {
        const cfg = TTSConfig.get();
        const cacheSize = TTSCore.getCacheSize();
        const st = State.get();
  
        return `
          <div id="tts-section-root">
            <div style="display:flex;justify-content:space-between;align-items:center;
              margin-bottom:12px;">
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer;
                font-size:13px;color:#ccc;">
                <input type="checkbox" id="tts-enabled" ${cfg.enabled ? 'checked' : ''}>
                启用语音
              </label>
              ${cfg.enabled ? '<span style="font-size:11px;color:#7dd87d;">● 已开启</span>'
                           : '<span style="font-size:11px;color:#666;">○ 已关闭</span>'}
            </div>
  
            <div class="vn-field">
              <label>后端地址</label>
              <input type="text" class="vn-input" id="tts-endpoint"
                value="${this._escapeAttr(cfg.endpoint)}"
                placeholder="http://127.0.0.1:8080">
              <div class="vn-hint">
                audio.cpp 服务地址
              </div>
            </div>
  
            <div class="vn-field">
              <label>TTS 模型</label>
              <input type="text" class="vn-input" id="tts-model"
                value="${this._escapeAttr(cfg.model)}"
                placeholder="omnivoice">
            </div>
  
            <div class="vn-field">
              <label>参考音频目录</label>
              <input type="text" class="vn-input" id="tts-folder"
                value="${this._escapeAttr(cfg.folderBase)}"
                placeholder="assets/voices">
              <div class="vn-hint">
                相对路径。结构：<br>
                <code>assets/voices/narrator/default.wav</code><br>
                <code>assets/voices/male/default.wav</code><br>
                <code>assets/voices/female/default.wav</code><br>
                <code>assets/voices/player/default.wav</code><br>
                同名 <code>.txt</code> 会被 audio.cpp 自动读取
              </div>
            </div>
  
            <div class="vn-field">
              <label>BGM 音量：${Math.round(cfg.bgmVolume * 100)}%（TTS 播放时自动降到 30%）</label>
              <input type="range" id="tts-bgm-vol" min="0" max="1" step="0.05"
                value="${cfg.bgmVolume}" style="width:100%;">
            </div>
  
            <div class="vn-field">
              <label>语音音量：${Math.round(cfg.volume * 100)}%</label>
              <input type="range" id="tts-vol" min="0" max="1" step="0.05"
                value="${cfg.volume}" style="width:100%;">
            </div>
  
            <div class="vn-field">
              <label>语速：${cfg.rate.toFixed(2)}×</label>
              <input type="range" id="tts-rate" min="0.5" max="2" step="0.05"
                value="${cfg.rate}" style="width:100%;">
            </div>
  
            <div class="vn-field">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
                font-size:13px;color:#ccc;">
                <input type="checkbox" id="tts-wait" ${cfg.waitForTTS ? 'checked' : ''}>
                等语音播完再允许"继续"
              </label>
              <div class="vn-hint">
                关闭 = 打字机归打字机，语音归语音（推荐）<br>
                开启 = 每句语音播完才能点击下一句
              </div>
            </div>
  
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
              <button class="vn-btn primary" id="tts-test-btn">🎤 测试合成</button>
              <button class="vn-btn" id="tts-clear-cache">🗑️ 清缓存（${cacheSize}条）</button>
              <button class="vn-btn" id="tts-reset-fallback">🔄 重置角色降级</button>
              <button class="vn-btn" id="tts-reset-voices">🎲 重抽所有音色</button>
            </div>
            <div id="tts-test-result" style="margin-top:10px;font-size:12px;"></div>
          </div>
        `;
      },
  
      // 绑定事件（settings.js 在挂载后调用）
      bindEvents(modal) {
        const self = this;
  
        // 总开关
        const enabledEl = modal.querySelector('#tts-enabled');
        if (enabledEl) {
          enabledEl.onchange = () => {
            self.toggleEnabled(enabledEl.checked);
            // 刷新整个区段（开关状态）
            self._rerenderSection(modal);
          };
        }
  
        // endpoint / model / folder
        const epEl = modal.querySelector('#tts-endpoint');
        if (epEl) epEl.onchange = () => self.setEndpoint(epEl.value);
  
        const mdEl = modal.querySelector('#tts-model');
        if (mdEl) mdEl.onchange = () => self.setModel(mdEl.value);
  
        const foEl = modal.querySelector('#tts-folder');
        if (foEl) foEl.onchange = () => self.setFolderBase(foEl.value);
  
        // 音量
        const bgmEl = modal.querySelector('#tts-bgm-vol');
        if (bgmEl) {
          bgmEl.oninput = () => {
            self.setBgmVolume(parseFloat(bgmEl.value));
            // 更新 label
            const label = bgmEl.previousElementSibling;
            if (label && label.tagName === 'LABEL') {
              label.textContent = `BGM 音量：${Math.round(parseFloat(bgmEl.value) * 100)}%（TTS 播放时自动降到 30%）`;
            }
          };
        }
  
        const volEl = modal.querySelector('#tts-vol');
        if (volEl) {
          volEl.oninput = () => {
            self.setVolume(parseFloat(volEl.value));
            const label = volEl.previousElementSibling;
            if (label && label.tagName === 'LABEL') {
              label.textContent = `语音音量：${Math.round(parseFloat(volEl.value) * 100)}%`;
            }
          };
        }
  
        const rateEl = modal.querySelector('#tts-rate');
        if (rateEl) {
          rateEl.oninput = () => {
            self.setRate(parseFloat(rateEl.value));
            const label = rateEl.previousElementSibling;
            if (label && label.tagName === 'LABEL') {
              label.textContent = `语速：${parseFloat(rateEl.value).toFixed(2)}×`;
            }
          };
        }
  
        // waitForTTS
        const waitEl = modal.querySelector('#tts-wait');
        if (waitEl) waitEl.onchange = () => self.setWaitForTTS(waitEl.checked);
  
        // 测试
        const testBtn = modal.querySelector('#tts-test-btn');
        if (testBtn) {
          testBtn.onclick = async () => {
            const resultEl = modal.querySelector('#tts-test-result');
            testBtn.disabled = true;
            testBtn.textContent = '⏳ 合成中…';
            resultEl.textContent = '';
            resultEl.style.color = '#9ab0ff';
            resultEl.textContent = '正在请求 TTS 后端…';
  
            try {
              const voiceRef = TTSRouter._makeDefaultRef('narrator');
              const blob = await TTSCore.synthesize('你好，这是语音测试。', voiceRef, {});
              if (!blob || blob.__error) {
                resultEl.style.color = '#d87d7d';
                resultEl.textContent = `❌ 合成失败${blob?.status ? ' (HTTP ' + blob.status + ')' : ''}`
                  + (blob?.errText ? `\n${blob.errText.slice(0, 150)}` : '');
              } else {
                resultEl.style.color = '#7dd87d';
                resultEl.textContent = '✅ 合成成功，正在播放…';
                await TTSCore.playBlob(blob, {});
              }
            } catch (e) {
              resultEl.style.color = '#d87d7d';
              resultEl.textContent = `❌ ${e.message}`;
            }
  
            testBtn.disabled = false;
            testBtn.textContent = '🎤 测试合成';
          };
        }
  
        // 清缓存
        const clearBtn = modal.querySelector('#tts-clear-cache');
        if (clearBtn) {
          clearBtn.onclick = () => {
            TTSCore.clearCache();
            window.UIManager?.showText?.('缓存已清空', 1200);
            self._rerenderSection(modal);
          };
        }
  
        // 重置降级
        const fallbackBtn = modal.querySelector('#tts-reset-fallback');
        if (fallbackBtn) {
          fallbackBtn.onclick = () => {
            TTSRouter.resetFallback();
            window.UIManager?.showText?.('降级标记已重置', 1500);
          };
        }
  
        // 重抽所有音色
        const resetVoicesBtn = modal.querySelector('#tts-reset-voices');
        if (resetVoicesBtn) {
          resetVoicesBtn.onclick = () => {
            if (!confirm('重抽所有角色音色？下次播放会重新分配。')) return;
            TTSRouter.resetVoiceAssign();
            window.UIManager?.showText?.('音色已重抽', 1500);
          };
        }
      },
  
      // 局部重渲染（保留 modal 里其他区段）
      _rerenderSection(modal) {
        const old = modal.querySelector('#tts-section-root');
        if (!old) return;
        const wrap = document.createElement('div');
        wrap.innerHTML = this.renderSection();
        const newNode = wrap.firstElementChild;
        old.replaceWith(newNode);
        this.bindEvents(modal);
      },
  
      // ============================================================
      // 设置项
      // ============================================================
      toggleEnabled(v) {
        TTSConfig.set('enabled', !!v);
        if (!v) {
          try { TTSPlayer.abort(); } catch (e) {}
        }
        window.UIManager?.showText?.(v ? '🔊 语音已开启' : '🔇 语音已关闭', 1200);
      },
  
      setEndpoint(v) {
        const val = (v || '').trim().replace(/\/+$/, '');
        TTSConfig.set('endpoint', val);
      },
  
      setModel(v) {
        TTSConfig.set('model', (v || 'omnivoice').trim());
      },
  
      setFolderBase(v) {
        TTSConfig.set('folderBase', (v || 'assets/voices').trim());
      },
  
      setVolume(v) {
        TTSConfig.set('volume', parseFloat(v) || 1.0);
      },
  
      setRate(v) {
        TTSConfig.set('rate', parseFloat(v) || 1.0);
      },
  
      setBgmVolume(v) {
        const val = parseFloat(v) || 0.5;
        TTSConfig.set('bgmVolume', val);
        if (window.TTSDucking) {
          window.TTSDucking.setBaseVolume(val);
        } else if (window.VNMusic?.setVolume) {
          window.VNMusic.setVolume(val);
        }
      },
  
      setWaitForTTS(v) {
        TTSConfig.set('waitForTTS', !!v);
      },
  
      _escapeAttr(s) {
        return String(s ?? '')
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      },
    };
  
    window.TTSManager = TTSManager;
    window.TTSAppUI = TTSAppUI;
  
    console.log('[VN Reader·TTS] ui.js 已加载');
  })();