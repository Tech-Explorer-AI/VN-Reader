// ============================================================
// VN Reader · main.js
// 启动入口：绑定所有 UI、模块就绪检查
// ============================================================

(function () {
    'use strict';

    const State = window.VNState;

    // ============================================================
    // 简易提示条（章节导入成功等）
    // ============================================================
    const UIManager = {
        _timer: null,
        showText(text, duration = 2000) {
            let el = document.getElementById('vn-toast');
            if (!el) {
                el = document.createElement('div');
                el.id = 'vn-toast';
                el.style.cssText = `
            position: fixed;
            top: 24px;
            left: 50%;
            transform: translateX(-50%) translateY(-20px);
            background: rgba(20,20,30,.95);
            border: 1px solid rgba(120,150,255,.4);
            color: #e0e0e0;
            padding: 12px 22px;
            border-radius: 10px;
            font-size: 13px;
            z-index: 99999;
            opacity: 0;
            transition: all .3s ease;
            pointer-events: none;
            box-shadow: 0 8px 30px rgba(0,0,0,.6);
          `;
                document.body.appendChild(el);
            }

            el.textContent = text;
            el.style.opacity = '1';
            el.style.transform = 'translateX(-50%) translateY(0)';

            if (this._timer) clearTimeout(this._timer);
            this._timer = setTimeout(() => {
                el.style.opacity = '0';
                el.style.transform = 'translateX(-50%) translateY(-20px)';
            }, duration);
        },
    };

    // ============================================================
    // 初始化
    // ============================================================
    function init() {
        console.log('[VN Reader] 启动中…');

        // ---------- 检查依赖 ----------
        const missing = [];
        if (!window.VNState) missing.push('state');
        if (!window.SpriteManager) missing.push('sprites');
        if (!window.VNPlayer) missing.push('vn');
        if (!window.VNChapters) missing.push('chapters');
        if (!window.VNModal) missing.push('modal');

        if (missing.length > 0) {
            console.error('[VN Reader] 缺少模块:', missing);
            document.body.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:center;height:100vh;
            color:#d87d7d;font-family:sans-serif;text-align:center;padding:20px;">
            <div>
              <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
              <div style="font-size:18px;margin-bottom:8px;">模块加载失败</div>
              <div style="font-size:13px;color:#888;">缺失: ${missing.join(', ')}</div>
            </div>
          </div>
        `;
            return;
        }

        // ---------- 初始渲染 ----------
        window.VNChapters.render();

        // ---------- 绑定书架按钮 ----------
        document.getElementById('btn-import-txt').addEventListener('click', () => {
            document.getElementById('vn-file-input').click();
        });

        document.getElementById('vn-file-input').addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (file) {
                await window.VNChapters.importTxt(file);
            }
            e.target.value = '';
        });

        document.getElementById('btn-add-chapter').addEventListener('click', () => {
            window.VNChapters.addManual();
        });

        document.getElementById('btn-open-settings').addEventListener('click', () => {
            if (window.VNSettings) {
                window.VNSettings.open();
            } else {
                // 设置模块未加载时，直接给音乐标记入口
                window.VNChapters.openMusicMarkerConfig();
            }
        });

        // 右键菜单：书架空白区右键 → 打开音乐标记配置
        document.getElementById('vn-bookshelf').addEventListener('contextmenu', (e) => {
            if (e.target.closest('.vn-chapter-card')) return;
            e.preventDefault();
            window.VNChapters.openMusicMarkerConfig();
        });

        // ---------- 保存前提示 ----------
        window.addEventListener('beforeunload', () => {
            State.save(true);
        });

        // ---------- 首次进入提示 ----------
        if (State.get().chapters.length === 0) {
            setTimeout(() => {
                UIManager.showText('👋 点击「📥 导入 TXT」或「➕ 手动加章」开始', 3500);
            }, 600);
        }
        // ★ TTS 初始化
        if (window.TTSManager) {
            try { window.TTSManager.init(); } catch (e) { console.warn('[main] TTS init 失败:', e); }
        }
        console.log('[VN Reader] 就绪');
    }

    // ============================================================
    // 挂载
    // ============================================================
    window.UIManager = UIManager;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    console.log('[VN Reader] main.js 已加载');
})();