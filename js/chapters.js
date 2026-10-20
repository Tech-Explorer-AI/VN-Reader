// ============================================================
// VN Reader · chapters.js
// 章节管理：导入 / 分章 / 列表 / 音乐标记配置
// 依赖：state.js, vn.js
// ============================================================

(function () {
    'use strict';
  
    const State = window.VNState;
  
    // ============================================================
    // 模态框工具（供本文件 + 其他模块复用）
    // ============================================================
    const Modal = {
      open({ title, bodyHTML, footerHTML, onMount }) {
        const mask = document.getElementById('vn-modal-mask');
        const modal = document.getElementById('vn-modal');
  
        modal.innerHTML = `
          <div class="vn-modal-header">
            <div class="vn-modal-title">${title}</div>
            <button class="vn-modal-close" id="vn-modal-close-btn">✕</button>
          </div>
          <div class="vn-modal-body">${bodyHTML}</div>
          ${footerHTML ? `<div class="vn-modal-footer">${footerHTML}</div>` : ''}
        `;
  
        mask.classList.add('active');
        modal.classList.add('active');
  
        document.getElementById('vn-modal-close-btn').onclick = () => this.close();
        mask.onclick = () => this.close();
  
        if (onMount) onMount(modal);
      },
  
      close() {
        document.getElementById('vn-modal-mask').classList.remove('active');
        document.getElementById('vn-modal').classList.remove('active');
        document.getElementById('vn-modal').innerHTML = '';
      },
    };
  
    // ============================================================
    // 自动分章
    // ============================================================
    const AutoSplitter = {
      // 优先级依次尝试
      patterns: [
        {
          name: '第X章',
          re: /^第[一二三四五六七八九十百千零两\d]+[章节回卷](?:[^\n]{0,50})?$/gm,
        },
        {
          name: 'Chapter X',
          re: /^Chapter\s+\d+(?:[^\n]{0,50})?$/gmi,
        },
        {
          name: '数字.',
          re: /^\d+[.、]\s+[^\n]{0,50}$/gm,
        },
      ],
  
      /**
       * 返回 [{title, content}]
       */
      split(text) {
        if (!text || !text.trim()) return [];
  
        for (const p of this.patterns) {
          const matches = [...text.matchAll(p.re)];
          if (matches.length >= 2) {
            return this._splitByMatches(text, matches);
          }
        }
  
        // 无匹配 → 单章
        return [{
          title: '全文',
          content: text.trim(),
        }];
      },
  
      _splitByMatches(text, matches) {
        const chapters = [];
        for (let i = 0; i < matches.length; i++) {
          const m = matches[i];
          const title = m[0].trim();
          const start = m.index + m[0].length;
          const end = (i + 1 < matches.length) ? matches[i + 1].index : text.length;
          const content = text.substring(start, end).trim();
          if (content) {
            chapters.push({ title, content });
          }
        }
        return chapters;
      },
    };
  
    // ============================================================
    // 章节管理
    // ============================================================
    const Chapters = {
      // ============================================================
      // 列表渲染
      // ============================================================
      render() {
        const list = document.getElementById('vn-chapter-list');
        if (!list) return;
  
        const chapters = State.get().chapters;
  
        if (chapters.length === 0) {
          list.innerHTML = `
            <div class="vn-empty-hint">
              <span class="vn-big-icon">📖</span>
              书架还空着<br>
              点击 <strong>📥 导入 TXT</strong> 或 <strong>➕ 手动加章</strong> 开始
            </div>
          `;
          return;
        }
  
        list.innerHTML = '';
        chapters.forEach(ch => {
          const card = document.createElement('div');
          card.className = 'vn-chapter-card';
  
          const status = this._getStatus(ch);
          const charCount = (ch.raw || '').length;
          const hasScript = !!(ch.script && ch.script.trim());
  
          card.innerHTML = `
            <div class="vn-ch-status ${status.cls}">${status.text}</div>
            <div class="vn-ch-title">${this._escape(ch.title)}</div>
            <div class="vn-ch-meta">
              <span>📝 ${charCount} 字</span>
              ${ch.characters?.length ? `<span>👥 ${ch.characters.length} 角色</span>` : ''}
              ${hasScript ? `<span>🎬 脚本已就绪</span>` : ''}
            </div>
          `;
  
          card.addEventListener('click', () => this._openChapterMenu(ch.id));
          list.appendChild(card);
        });
      },
  
      _getStatus(ch) {
        if (ch.converting) return { text: '转换中', cls: 'converting' };
        if (ch.script && ch.script.trim()) return { text: '✓ 可播放', cls: 'ready' };
        return { text: '待转换', cls: '' };
      },
  
      // ============================================================
      // 章节菜单
      // ============================================================
      _openChapterMenu(chapterId) {
        const ch = State.getChapter(chapterId);
        if (!ch) return;
  
        const hasScript = !!(ch.script && ch.script.trim());
  
        const bodyHTML = `
          <div class="vn-field">
            <label>章节标题</label>
            <input type="text" class="vn-input" id="ch-title-edit"
              value="${this._escapeAttr(ch.title)}">
          </div>
          <div class="vn-field">
            <label>原文（${(ch.raw || '').length} 字）</label>
            <textarea class="vn-textarea" id="ch-raw-edit" style="min-height:140px;">${this._escape(ch.raw || '')}</textarea>
          </div>
          <div class="vn-field">
            <label>VN 脚本 ${hasScript ? '' : '（还没转换）'}</label>
            <textarea class="vn-textarea" id="ch-script-edit"
              style="min-height:200px;font-family:monospace;font-size:12px;"
              placeholder="【背景】xxx&#10;🎵 音乐：xxx&#10;&#10;【对话】&#10;【角色|显示|中|性别|心情】: 台词&#10;【旁白】: 环境描写&#10;&#10;【选项】&#10;A. 选项一&#10;B. 选项二">${this._escape(ch.script || '')}</textarea>
          </div>
        `;
  
        const footerHTML = `
          <button class="vn-btn" id="ch-save-btn">💾 保存修改</button>
          <button class="vn-btn" id="ch-convert-btn">🤖 AI 转换</button>
          <button class="vn-btn" id="ch-markers-btn" ${hasScript ? '' : 'disabled'}>🎨 场景 & 音乐</button>
          <button class="vn-btn primary" id="ch-play-btn" ${hasScript ? '' : 'disabled'}>▶️ 播放</button>
          <button class="vn-btn danger" id="ch-del-btn">🗑️ 删除</button>
        `;
  
        Modal.open({
          title: `📖 ${this._escape(ch.title)}`,
          bodyHTML,
          footerHTML,
          onMount: (modal) => {
            // 保存
            modal.querySelector('#ch-save-btn').onclick = () => {
              const title = modal.querySelector('#ch-title-edit').value.trim();
              const raw = modal.querySelector('#ch-raw-edit').value;
              const script = modal.querySelector('#ch-script-edit').value;
              State.updateChapter(chapterId, {
                title: title || ch.title,
                raw,
                script,
              });
              Modal.close();
              this.render();
            };
          
            // 播放
            const playBtn = modal.querySelector('#ch-play-btn');
            playBtn.onclick = () => {
              const script = modal.querySelector('#ch-script-edit').value;
              if (!script.trim()) {
                alert('还没有脚本');
                return;
              }
              State.updateChapter(chapterId, { script });
              State.get().currentChapterId = chapterId;
              State.save();
              Modal.close();
              window.VNPlayer.play(script, ch.title);
            };
          
            // AI 转换
            modal.querySelector('#ch-convert-btn').onclick = () => {
              if (!window.Converter) {
                alert('转换模块未加载');
                return;
              }
              Modal.close();
              setTimeout(() => {
                window.Converter.convertChapter(chapterId);
              }, 50);
            };
          
            // ★ 场景 & 音乐校对（放到顶层，和其他按钮并列）
            const markersBtn = modal.querySelector('#ch-markers-btn');
            if (markersBtn) {
              markersBtn.onclick = () => {
                // 先保存当前脚本编辑框内容，避免丢失
                const script = modal.querySelector('#ch-script-edit').value;
                State.updateChapter(chapterId, { script });
                Modal.close();
                setTimeout(() => {
                  window.VNMarkersUI.open(chapterId);
                }, 50);
              };
            }
          
            // 删除
            modal.querySelector('#ch-del-btn').onclick = () => {
              if (!confirm(`确定删除「${ch.title}」？`)) return;
              State.removeChapter(chapterId);
              Modal.close();
              this.render();
            };
          },
        });
      },
  
      // ============================================================
      // 手动加章
      // ============================================================
      addManual() {
        const bodyHTML = `
          <div class="vn-field">
            <label>章节标题</label>
            <input type="text" class="vn-input" id="new-ch-title"
              value="新章节" placeholder="例如：第1章 相遇">
          </div>
          <div class="vn-field">
            <label>原文</label>
            <textarea class="vn-textarea" id="new-ch-raw"
              style="min-height:200px;"
              placeholder="粘贴这一章的小说原文"></textarea>
          </div>
        `;
  
        const footerHTML = `
          <button class="vn-btn" id="new-ch-cancel">取消</button>
          <button class="vn-btn primary" id="new-ch-confirm">创建</button>
        `;
  
        Modal.open({
          title: '➕ 手动加章',
          bodyHTML,
          footerHTML,
          onMount: (modal) => {
            modal.querySelector('#new-ch-cancel').onclick = () => Modal.close();
            modal.querySelector('#new-ch-confirm').onclick = () => {
              const title = modal.querySelector('#new-ch-title').value.trim() || '未命名章节';
              const raw = modal.querySelector('#new-ch-raw').value;
              if (!raw.trim()) {
                alert('原文不能为空');
                return;
              }
              State.addChapter({
                id: State.makeId(),
                title,
                raw: raw.trim(),
                characters: [],
                script: '',
                createdAt: Date.now(),
              });
              Modal.close();
              this.render();
            };
          },
        });
      },
  
      // ============================================================
      // TXT 导入
      // ============================================================
      async importTxt(file) {
        const text = await this._readFile(file);
        if (!text) {
          alert('读取文件失败');
          return;
        }
  
        // 分章
        const pieces = AutoSplitter.split(text);
  
        if (pieces.length === 1) {
          // 单章 → 直接确认
          this._confirmImport([{
            title: pieces[0].title || file.name.replace(/\.txt$/i, ''),
            content: pieces[0].content,
          }], file.name);
          return;
        }
  
        // 多章 → 展示预览让用户确认
        this._showImportPreview(pieces, file.name);
      },
  
      _readFile(file) {
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => resolve(null);
          // 检测编码：默认 utf-8
          reader.readAsText(file, 'utf-8');
        });
      },
  
      _showImportPreview(pieces, filename) {
        let listHTML = '';
        pieces.forEach((p, i) => {
          listHTML += `
            <div style="padding:10px 14px;background:rgba(255,255,255,.04);
              border-radius:8px;margin-bottom:8px;font-size:13px;">
              <div style="color:#7da8ff;font-weight:600;margin-bottom:4px;">
                ${i + 1}. ${this._escape(p.title)}
              </div>
              <div style="color:#888;font-size:12px;line-height:1.5;
                overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;
                -webkit-box-orient:vertical;">
                ${this._escape(p.content.substring(0, 120))}...
              </div>
            </div>
          `;
        });
  
        const bodyHTML = `
          <div class="vn-field">
            <div style="color:#aaa;font-size:13px;margin-bottom:12px;">
              从 <strong>${this._escape(filename)}</strong> 识别到
              <strong style="color:#7da8ff;">${pieces.length}</strong> 个章节。
              确认无误后导入。
            </div>
            <div style="max-height:400px;overflow-y:auto;">${listHTML}</div>
          </div>
        `;
  
        const footerHTML = `
          <button class="vn-btn" id="imp-cancel">取消</button>
          <button class="vn-btn primary" id="imp-confirm">全部导入</button>
        `;
  
        Modal.open({
          title: '📥 导入预览',
          bodyHTML,
          footerHTML,
          onMount: (modal) => {
            modal.querySelector('#imp-cancel').onclick = () => Modal.close();
            modal.querySelector('#imp-confirm').onclick = () => {
              this._confirmImport(pieces, filename);
              Modal.close();
            };
          },
        });
      },
  
      _confirmImport(pieces, filename) {
        const baseTitle = filename.replace(/\.txt$/i, '');
        pieces.forEach(p => {
          State.addChapter({
            id: State.makeId(),
            title: p.title || baseTitle,
            raw: p.content,
            characters: [],
            script: '',
            createdAt: Date.now(),
          });
        });
        this.render();
        window.UIManager?.showText?.(`已导入 ${pieces.length} 章`, 1500);
      },
  
      // ============================================================
      // ★ 音乐标记配置
      // ============================================================
      openMusicMarkerConfig() {
        const current = State.get().settings.musicMarkers || [];
        const text = current.join('|');
  
        const bodyHTML = `
          <div class="vn-field">
            <label>音乐标记列表</label>
            <textarea class="vn-textarea" id="music-marker-input"
              style="min-height:100px;font-family:monospace;"
              placeholder="欢乐|温馨|紧张|忧伤|意外|辉煌|朝阳|浪漫|宁静|神秘">${this._escape(text)}</textarea>
            <div class="vn-hint">
              用 <code>|</code> 分隔。这些标记会嵌入 AI 转换提示词，让 AI 从列表中选一个输出 <code>🎵 音乐：xxx</code>。<br>
              建议 5-30 个，覆盖常用情绪即可。
            </div>
          </div>
          <div class="vn-field">
            <label>预设</label>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="vn-btn" id="preset-default">恢复默认</button>
              <button class="vn-btn" id="preset-minimal">极简（8个）</button>
              <button class="vn-btn" id="preset-rich">丰富（32个）</button>
            </div>
          </div>
        `;
  
        const footerHTML = `
          <button class="vn-btn" id="mm-cancel">取消</button>
          <button class="vn-btn primary" id="mm-save">保存</button>
        `;
  
        const PRESETS = {
          default: [
            '欢乐','温馨','紧张','忧伤','意外','辉煌','朝阳','浪漫',
            '宁静','神秘','舒缓','悠扬','希望','思考','振奋','战斗',
            '比赛','演出','训练','结算','日常','空灵','旅途',
          ],
          minimal: ['欢乐', '温馨', '紧张', '忧伤', '神秘', '战斗', '日常', '空灵'],
          rich: [
            '欢乐','温馨','紧张','忧伤','意外','辉煌','朝阳','浪漫',
            '宁静','神秘','舒缓','悠扬','希望','思考','振奋','战斗',
            '比赛','演出','训练','结算','日常','空灵','旅途',
            '悬疑','悲伤','愤怒','羞涩','神圣','邪恶','孤独','重逢',
            '离别','庆典','雨夜','黎明',
          ],
        };
  
        Modal.open({
          title: '🎵 音乐标记配置',
          bodyHTML,
          footerHTML,
          onMount: (modal) => {
            const input = modal.querySelector('#music-marker-input');
  
            modal.querySelector('#preset-default').onclick = () => {
              input.value = PRESETS.default.join('|');
            };
            modal.querySelector('#preset-minimal').onclick = () => {
              input.value = PRESETS.minimal.join('|');
            };
            modal.querySelector('#preset-rich').onclick = () => {
              input.value = PRESETS.rich.join('|');
            };
  
            modal.querySelector('#mm-cancel').onclick = () => Modal.close();
            modal.querySelector('#mm-save').onclick = () => {
              const list = input.value
                .split('|')
                .map(s => s.trim())
                .filter(Boolean);
  
              if (list.length === 0) {
                alert('至少保留一个标记');
                return;
              }
  
              State.get().settings.musicMarkers = list;
              State.save();
              Modal.close();
              window.UIManager?.showText?.(`已保存 ${list.length} 个音乐标记`, 1500);
            };
          },
        });
      },
  
      // ============================================================
      // 工具
      // ============================================================
      _escape(str) {
        return String(str ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      },
      _escapeAttr(str) {
        return String(str ?? '')
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      },
    };
  
    window.VNModal = Modal;
    window.VNChapters = Chapters;
  
    console.log('[VN Reader] chapters.js 已加载');
  })();