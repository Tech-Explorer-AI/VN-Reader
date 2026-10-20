// ============================================================
// VN Reader · auto-next-hijack.js
// 多章连读：一章播完自动接下一章（劫持 VNPlayer._onFinish）
// 依赖：state.js, vn.js
// ============================================================

(function () {
    'use strict';
    if (window.__VN_AutoNextHijackLoaded) return;
    window.__VN_AutoNextHijackLoaded = true;
  
    const State = window.VNState;
    const VN = window.VNPlayer;
    if (!VN) {
      console.warn('[AutoNext] VNPlayer 未加载，跳过');
      return;
    }
  
    // ============================================================
    // 默认配置：settings.autoNextChapter = true
    // ============================================================
    function ensureSetting() {
      const st = State.get();
      if (!st.settings) st.settings = {};
      if (st.settings.autoNextChapter === undefined) {
        st.settings.autoNextChapter = true;
      }
    }
    ensureSetting();
  
    // ============================================================
    // 工具：按书架顺序找下一章
    // ============================================================
    function getNextChapter(currentId) {
      const chapters = State.get().chapters || [];
      const idx = chapters.findIndex(c => c.id === currentId);
      if (idx < 0 || idx >= chapters.length - 1) return null;
      return chapters[idx + 1];
    }
  
    function isReady(ch) {
      return !!(ch && ch.script && ch.script.trim());
    }
  
    // ============================================================
    // 劫持 _onFinish
    // ============================================================
    const _origFinish = VN._onFinish;
    VN._onFinish = async function () {
      // 循环保护：跳过本章时 _onFinish 不该自动连读
      if (this._skippedByUser) {
        this._skippedByUser = false;
        return _origFinish.call(this);
      }
  
      // 1. 有选项 → 优先走选项（选项是分岔，不自动连读）
      if (this._pendingOptions && this._pendingOptions.length > 0) {
        return _origFinish.call(this);
      }
  
      // 2. 关闭了自动连读 → 原逻辑
      const cfg = State.get().settings;
      if (!cfg.autoNextChapter) {
        return _origFinish.call(this);
      }
  
      // 3. 找下一章
      const currentId = State.get().currentChapterId;
      const nextCh = getNextChapter(currentId);
  
      // 4. 没有下一章 → 原逻辑（显示"本章完"）
      if (!nextCh) {
        return _origFinish.call(this);
      }
  
      // 5. 下一章没脚本 → 原逻辑，并提示
      if (!isReady(nextCh)) {
        window.UIManager?.showText?.(
          `下一章「${nextCh.title}」还没有脚本，无法自动连读`,
          2500
        );
        return _origFinish.call(this);
      }
  
      // 6. 弹 toast + 倒计时，允许取消
      const proceed = await showNextChapterToast(nextCh);
      if (!proceed) {
        return _origFinish.call(this);
      }
  
      // 7. 切换到下一章
      console.log('[AutoNext] 自动连读 →', nextCh.title);
  
      // 清掉当前播放状态（模仿 exitToShelf 的清理，但不回书架）
      this.playing = false;
      this.isTyping = false;
      try { window.TTSPlayer?.abort?.(); } catch (e) { }
      window.VNMusic?.stop?.();
      window.VNBackground?.clear?.();
      this.clearSprites?.();
      const box = document.getElementById('vn-dialogue-box');
      if (box) box.classList.remove('active');
  
      // 切章节
      State.get().currentChapterId = nextCh.id;
      State.save();
  
      // 延迟一点，让 UI 过渡自然
      await new Promise(r => setTimeout(r, 300));
  
      // 直接播下一章（VN.play 会重置 timeline、清屏、应用 bg/music）
      this.play(nextCh.script, nextCh.title);
    };
  
    // ============================================================
    // 倒计时 toast，返回 Promise<boolean>
    // ============================================================
    function showNextChapterToast(nextCh) {
      return new Promise(resolve => {
        // 移除旧的
        const old = document.getElementById('vn-autonext-toast');
        if (old) old.remove();
  
        const toast = document.createElement('div');
        toast.id = 'vn-autonext-toast';
        toast.style.cssText = `
          position: fixed;
          bottom: 24px;
          left: 50%;
          transform: translateX(-50%) translateY(20px);
          background: linear-gradient(135deg, rgba(102,126,234,.95), rgba(118,75,162,.95));
          color: #fff;
          padding: 14px 22px;
          border-radius: 12px;
          font-size: 13px;
          z-index: 99999;
          box-shadow: 0 8px 30px rgba(0,0,0,.6);
          display: flex;
          align-items: center;
          gap: 14px;
          opacity: 0;
          transition: all .3s ease;
          pointer-events: auto;
        `;
        toast.innerHTML = `
          <span style="font-size:15px;">📖</span>
          <span>即将进入下一章：<strong>${escapeHtml(nextCh.title)}</strong></span>
          <span class="vn-autonext-countdown" style="font-size:16px;font-weight:700;
            min-width:22px;text-align:center;">3</span>
          <button class="vn-autonext-cancel" style="
            background: rgba(0,0,0,.25);
            border: 1px solid rgba(255,255,255,.3);
            color: #fff;
            padding: 4px 12px;
            border-radius: 6px;
            font-size: 12px;
            cursor: pointer;
            margin-left: 4px;
          ">取消</button>
          <button class="vn-autonext-go" style="
            background: rgba(255,255,255,.2);
            border: 1px solid rgba(255,255,255,.4);
            color: #fff;
            padding: 4px 12px;
            border-radius: 6px;
            font-size: 12px;
            cursor: pointer;
          ">立即</button>
        `;
  
        document.body.appendChild(toast);
        void toast.offsetWidth;
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
  
        const countdownEl = toast.querySelector('.vn-autonext-countdown');
        let remaining = 3;
        let finished = false;
  
        const finish = (proceed) => {
          if (finished) return;
          finished = true;
          clearInterval(timer);
          toast.style.opacity = '0';
          toast.style.transform = 'translateX(-50%) translateY(20px)';
          setTimeout(() => toast.remove(), 300);
          resolve(proceed);
        };
  
        const timer = setInterval(() => {
          remaining--;
          countdownEl.textContent = remaining > 0 ? remaining : '0';
          if (remaining <= 0) {
            finish(true);
          }
        }, 1000);
  
        toast.querySelector('.vn-autonext-cancel').onclick = () => finish(false);
        toast.querySelector('.vn-autonext-go').onclick = () => finish(true);
      });
    }
  
    function escapeHtml(s) {
      return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  
    // ============================================================
    // 跳过本章时，标记"用户主动跳过"，_onFinish 不自动连读
    // ============================================================
    const _origSkip = VN.skip;
    VN.skip = function () {
      this._skippedByUser = true;
      return _origSkip.call(this);
    };
  
    // ============================================================
    // 设置面板里加一个开关（劫持 VNSettings.open，追加到"阅读设置"区）
    // ============================================================
    const Settings = window.VNSettings;
    if (Settings && Settings.open) {
      const _origSettingsOpen = Settings.open;
      Settings.open = function () {
        _origSettingsOpen.call(this);
        setTimeout(() => {
          const modal = document.getElementById('vn-modal');
          if (!modal || !modal.classList.contains('active')) return;
          const body = modal.querySelector('.vn-modal-body');
          if (!body) return;
  
          // 找"阅读设置"区块（含 #st-auto-advance 的那个 .vn-field 的父级）
          const autoAdvanceInput = body.querySelector('#st-auto-advance');
          if (!autoAdvanceInput) return;
          const autoAdvanceField = autoAdvanceInput.closest('.vn-field');
          if (!autoAdvanceField) return;
          if (body.querySelector('#st-auto-next-chapter')) return; // 已注入
  
          const field = document.createElement('div');
          field.className = 'vn-field';
          const checked = State.get().settings.autoNextChapter ? 'checked' : '';
          field.innerHTML = `
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
              <input type="checkbox" id="st-auto-next-chapter" ${checked}>
              自动连读下一章（如果下一章已有脚本）
            </label>
            <div class="vn-hint">
              播完本章后，若书架里下一章已配置脚本，倒计时 3 秒后自动播放；
              本章有选项时不自动连读。
            </div>
          `;
          autoAdvanceField.parentNode.insertBefore(field, autoAdvanceField.nextSibling);
  
          // 保存：劫持原有"保存全部"按钮
          const saveBtn = body.querySelector('#st-save');
          if (saveBtn) {
            // 不覆盖原 onclick，追加监听（原 onclick 已经绑定，用 addEventListener 追加）
            // 但原 onclick 是赋值式，这里只能在保存时读取。
            // 简单做法：在保存按钮上加 data 属性，并在 capture 阶段监听
          }
        }, 60);
  
        // 用 capture 监听保存按钮，确保读取新开关
        if (!window.__vnAutoNextSaveHook) {
          window.__vnAutoNextSaveHook = true;
          document.addEventListener('click', (e) => {
            if (!e.target || e.target.id !== 'st-save') return;
            setTimeout(() => {
              const cb = document.getElementById('st-auto-next-chapter');
              if (!cb) return;
              State.get().settings.autoNextChapter = cb.checked;
              State.save(true);
            }, 30);
          }, true);
        }
      };
    }
  
    console.log('[VN Reader] auto-next-hijack.js 已加载');
  })();