// ============================================================
// VN Reader · markers-ui.js
// 脚本标记校对面板：扫描 → 改名/删除 → 回写脚本
// ============================================================

(function () {
    'use strict';
    const State = window.VNState;
    const Markers = window.VNMarkers;
  
    const UI = {
      open(chapterId) {
        const ch = State.getChapter(chapterId);
        if (!ch) return;
        if (!ch.script || !ch.script.trim()) {
          alert('这一章还没有脚本，先转换再校对');
          return;
        }
  
        // 工作副本，保存时才回写
        let script = ch.script;
        let scanned = Markers.scan(script);
  
        const bodyHTML = `
          <div class="vn-marker-tabs" style="display:flex;gap:8px;margin-bottom:14px;">
            <button class="vn-btn vn-marker-tab active" data-tab="bg">
              🎨 背景（<span id="mk-bg-count">0</span>）
            </button>
            <button class="vn-btn vn-marker-tab" data-tab="music">
              🎵 音乐（<span id="mk-music-count">0</span>）
            </button>
          </div>
  
          <div id="vn-marker-panel-bg">
            <div class="vn-hint" style="margin-bottom:10px;">
              改名会替换脚本里所有同名行；删除会移除所有该标记行。
            </div>
            <div id="mk-bg-list"></div>
          </div>
  
          <div id="vn-marker-panel-music" style="display:none;">
            <div class="vn-hint" style="margin-bottom:10px;">
              改名会替换脚本里所有同名行；删除会移除所有该标记行。
            </div>
            <div id="mk-music-list"></div>
          </div>
        `;
  
        const footerHTML = `
          <button class="vn-btn" id="mk-cancel">取消</button>
          <button class="vn-btn primary" id="mk-save">💾 保存到脚本</button>
        `;
  
        window.VNModal.open({
          title: `🎨 脚本标记校对 · ${ch.title}`,
          bodyHTML,
          footerHTML,
          onMount: (modal) => {
            const bgList = modal.querySelector('#mk-bg-list');
            const musicList = modal.querySelector('#mk-music-list');
            const bgCount = modal.querySelector('#mk-bg-count');
            const musicCount = modal.querySelector('#mk-music-count');
  
            // ---------- 渲染 ----------
            const renderList = (container, items, kind) => {
              if (!items.length) {
                container.innerHTML = `<div class="vn-hint" style="padding:12px;
                  text-align:center;color:#666;">脚本里没有${kind === 'bg' ? '背景' : '音乐'}标记</div>`;
                return;
              }
              container.innerHTML = items.map((it, i) => `
                <div class="vn-marker-row" data-name="${this._escAttr(it.name)}" style="
                  display:flex;align-items:center;gap:8px;padding:8px 10px;
                  background:rgba(255,255,255,.04);border-radius:8px;margin-bottom:6px;">
                  <span style="font-size:12px;color:#888;min-width:36px;text-align:right;">
                    ×${it.count}
                  </span>
                  <input type="text" class="vn-marker-input vn-input" data-idx="${i}"
                    value="${this._escAttr(it.name)}"
                    style="flex:1;padding:6px 10px;font-size:13px;">
                  <button class="vn-marker-del" data-idx="${i}"
                    style="background:none;border:none;cursor:pointer;color:#d87d7d;
                    font-size:15px;padding:2px 6px;">✕</button>
                </div>
              `).join('');
            };
  
            const refresh = () => {
              scanned = Markers.scan(script);
              renderList(bgList, scanned.bg, 'bg');
              renderList(musicList, scanned.music, 'music');
              bgCount.textContent = scanned.bg.length;
              musicCount.textContent = scanned.music.length;
              bindRows();
            };
  
            // ---------- 行内事件 ----------
            const bindRows = () => {
              // 背景
              bgList.querySelectorAll('.vn-marker-input').forEach(inp => {
                inp.onchange = () => {
                  const oldName = inp.closest('.vn-marker-row').dataset.name;
                  const newName = inp.value.trim();
                  if (!newName || newName === oldName) {
                    inp.value = oldName;
                    return;
                  }
                  script = Markers.renameBg(script, oldName, newName);
                  refresh();
                };
              });
              bgList.querySelectorAll('.vn-marker-del').forEach(btn => {
                btn.onclick = () => {
                  const name = btn.closest('.vn-marker-row').dataset.name;
                  if (!confirm(`删除所有【背景】${name} 标记行？`)) return;
                  script = Markers.removeBg(script, name);
                  refresh();
                };
              });
  
              // 音乐
              musicList.querySelectorAll('.vn-marker-input').forEach(inp => {
                inp.onchange = () => {
                  const oldName = inp.closest('.vn-marker-row').dataset.name;
                  const newName = inp.value.trim();
                  if (!newName || newName === oldName) {
                    inp.value = oldName;
                    return;
                  }
                  script = Markers.renameMusic(script, oldName, newName);
                  refresh();
                };
              });
              musicList.querySelectorAll('.vn-marker-del').forEach(btn => {
                btn.onclick = () => {
                  const name = btn.closest('.vn-marker-row').dataset.name;
                  if (!confirm(`删除所有 🎵 音乐：${name} 标记行？`)) return;
                  script = Markers.removeMusic(script, name);
                  refresh();
                };
              });
            };
  
            // ---------- Tab ----------
            modal.querySelectorAll('.vn-marker-tab').forEach(btn => {
              btn.onclick = () => {
                modal.querySelectorAll('.vn-marker-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tab = btn.dataset.tab;
                modal.querySelector('#vn-marker-panel-bg').style.display = tab === 'bg' ? '' : 'none';
                modal.querySelector('#vn-marker-panel-music').style.display = tab === 'music' ? '' : 'none';
              };
            });
  
            // ---------- 取消 / 保存 ----------
            modal.querySelector('#mk-cancel').onclick = () => window.VNModal.close();
            modal.querySelector('#mk-save').onclick = () => {
              State.updateChapter(ch.id, { script });
              window.VNModal.close();
              window.VNChapters?.render?.();
              window.UIManager?.showText?.('✅ 脚本标记已更新', 1500);
            };
  
            refresh();
          },
        });
      },
  
      _escAttr(s) {
        return String(s ?? '')
          .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      },
    };
  
    window.VNMarkersUI = UI;
    console.log('[VN Reader] markers-ui.js 已加载');
  })();