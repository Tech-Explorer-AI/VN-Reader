// ============================================================
// VN Reader · converter.js
// 章节 → VN 脚本转换
// 依赖：state.js, api.js, chapters.js
// ============================================================

(function () {
    'use strict';
  
    const State = window.VNState;
    const API = window.VNAPI;
  
    const Converter = {
      // ============================================================
      // 主入口
      // ============================================================
      async convertChapter(chapterId) {
        const ch = State.getChapter(chapterId);
        if (!ch) {
          alert('章节不存在');
          return;
        }
  
        if (!ch.raw || !ch.raw.trim()) {
          alert('这一章还没有原文');
          return;
        }
  
        if (State.get().chapters.some(c => c.converting)) {
          alert('有章节正在转换中，请稍候');
          return;
        }
  
        if (!window.VNModal) {
          alert('模态框模块未加载');
          return;
        }
  
        this._showConvertDialog(ch);
      },
  
      // ============================================================
      // 转换对话框
      // ============================================================
      _showConvertDialog(ch) {
        const st = State.get();
        const musicList = st.settings.musicMarkers || [];
        const hasScript = !!(ch.script && ch.script.trim());
  
        const bodyHTML = `
          <div class="vn-field">
            <label>章节</label>
            <div style="font-size:13px;color:#ddd;padding:8px 12px;
              background:rgba(0,0,0,.3);border-radius:6px;">
              ${window.VNChapters._escape(ch.title)}
              <span style="color:#666;margin-left:8px;">（${ch.raw.length} 字）</span>
            </div>
          </div>
  
          <div class="vn-field">
            <label>可选音乐列表（${musicList.length} 个）</label>
            <div style="font-size:12px;color:#9ab0ff;line-height:1.8;
              padding:8px 12px;background:rgba(120,150,255,.08);border-radius:6px;
              word-break:break-all;">
              ${musicList.length > 0
                ? musicList.map(m => `🎵 ${m}`).join(' · ')
                : '<span style="color:#d87d7d;">⚠️ 未配置，AI 将不输出音乐标记</span>'}
            </div>
            <div class="vn-hint">
              AI 会从里选。可在书架右键修改。
            </div>
          </div>
  
          ${hasScript ? `
            <div class="vn-field">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;
                font-size:13px;color:#ffcf80;">
                <input type="checkbox" id="cv-force-overwrite">
                覆盖已有脚本（当前 ${ch.script.length} 字）
              </label>
              <div class="vn-hint">
                不勾选的话取消转换，已经有的脚本会保留
              </div>
            </div>
          ` : ''}
  
          <div id="cv-progress" style="display:none;margin-top:16px;padding:12px;
            background:rgba(120,150,255,.08);border:1px solid rgba(120,150,255,.25);
            border-radius:8px;">
            <div style="font-size:13px;color:#9ab0ff;margin-bottom:8px;" id="cv-progress-text">
              准备中…
            </div>
            <div style="height:4px;background:rgba(255,255,255,.1);border-radius:2px;overflow:hidden;">
              <div id="cv-progress-bar"
                style="height:100%;width:0%;background:linear-gradient(90deg,#667eea,#764ba2);
                border-radius:2px;transition:width .3s;"></div>
            </div>
          </div>
        `;
  
        const footerHTML = `
          <button class="vn-btn" id="cv-cancel-btn">取消</button>
          <button class="vn-btn primary" id="cv-start-btn">🤖 开始转换</button>
        `;
  
        window.VNModal.open({
          title: '🤖 AI 转换章节',
          bodyHTML,
          footerHTML,
          onMount: (modal) => {
            const startBtn = modal.querySelector('#cv-start-btn');
            const cancelBtn = modal.querySelector('#cv-cancel-btn');
            const progressBox = modal.querySelector('#cv-progress');
            const progressText = modal.querySelector('#cv-progress-text');
            const progressBar = modal.querySelector('#cv-progress-bar');
  
            let cancelled = false;
  
            const setProgress = (text, pct) => {
              progressBox.style.display = 'block';
              progressText.textContent = text;
              progressBar.style.width = `${pct}%`;
            };
  
            cancelBtn.onclick = () => {
              cancelled = true;
              window.VNModal.close();
            };
  
            startBtn.onclick = async () => {
              if (hasScript && !modal.querySelector('#cv-force-overwrite').checked) {
                alert('已有脚本。勾选"覆盖已有脚本"再点转换。');
                return;
              }
  
              startBtn.disabled = true;
              startBtn.textContent = '⏳ 转换中…';
              cancelBtn.disabled = true;
  
              try {
                setProgress('正在转换为 VN 脚本…（可能需要 30-90 秒）', 30);
  
                const script = await this.convertToScript(ch, () => cancelled);
  
                if (cancelled) return;
                if (!script) throw new Error('AI 返回内容为空');
  
                setProgress('正在校验脚本…', 85);
  
                const parsed = window.VNParser.parse(script);
                if (parsed.timeline.length === 0) {
                  throw new Error('脚本解析失败（没有对话行），请检查 AI 输出格式');
                }
  
                setProgress('✅ 转换完成', 100);
  
                State.updateChapter(ch.id, {
                  script,
                  convertedAt: Date.now(),
                });
  
                const dialogueCount = parsed.timeline.filter(t => t.type === 'dialogue').length;
  
                setTimeout(() => {
                  window.VNModal.close();
                  window.VNChapters.render();
                  window.UIManager?.showText?.(
                    `✅ 「${ch.title}」转换完成（${dialogueCount} 句）`,
                    2500
                  );
  
                  if (confirm('转换完成，现在播放吗？')) {
                    State.get().currentChapterId = ch.id;
                    State.save();
                    window.VNPlayer.play(script, ch.title);
                  }
                }, 400);
  
              } catch (e) {
                console.error('[Converter] 转换失败:', e);
                setProgress(`❌ 失败：${e.message}`, 100);
                startBtn.disabled = false;
                startBtn.textContent = '🤖 重试';
                cancelBtn.disabled = false;
              }
            };
          },
        });
      },
  
      // ============================================================
      // 转 VN 脚本
      // ============================================================
      async convertToScript(ch, isCancelled) {
        const state = State.get();
        const musicMarkers = state.settings.musicMarkers || [];
        const musicListText = musicMarkers.join('|');
        const hasMusic = musicMarkers.length > 0;
  
        const rawText = ch.raw;
        const isLong = rawText.length > 12000;
  
        const prompt = `你是一个视觉小说剧本改编师。把下面这一章小说改写成 VN 播放脚本。
  
  【章节标题】
  ${ch.title}
  
  ${hasMusic ? `【可选音乐列表】
  [${musicListText}]` : '【音乐】本次不输出音乐标记（未配置音乐列表）'}
  
  【小说原文】
  ${rawText}
  
  ===== 输出格式（严格遵守）=====
  
  【背景】背景图名
  ${hasMusic ? '🎵 音乐：从上面列表选一个' : ''}
  
  【对话】
  【角色名|显示|左|性别|心情】: 台词
  【角色名|显示|中|性别|心情】: 台词
  【角色名|显示|右|性别|心情】: 台词
  【旁白】: 环境描写或心理活动
  
  【背景】新背景名
  ${hasMusic ? '🎵 音乐：从上面列表选一个' : ''}
  【旁白】: 场景切换到新地点后的开场描写
  
  【对话】
  ...
  
  【选项】（可选，2-4 个）
  A. 选项内容
  B. 选项内容
  
  ===== 规则 =====
  
  1. **背景切换**：一章通常有多个场景（比如"教室→走廊→天台"），每次场景变化都写一行 \`【背景】新背景名\`。
     - 背景名用简短中文，比如"学校天台"、"废弃仓库"、"深夜街道"。
     - 如果整章都在同一场景，只在开头写一次【背景】。
     - 不要在对话中间强行切背景，只在场景真正变化时切。
  
  ${hasMusic ? `2. **音乐切换**：每个情绪/氛围变化点写一行 \`🎵 音乐：曲名\`。
     - 曲名必须从【可选音乐列表】里选一个。
     - 一首音乐可以维持多个对话，不要每句都切。
     - **绝对不要输出"欢乐→紧张"这种转变过程，只写目标音乐**，例如：\`🎵 音乐：紧张\`` : '2. **音乐**：本次不输出音乐标记。'}
  
  3. **对话行格式**：\`【角色|显示/隐藏|位置|性别|心情】: 内容\`
     - 每个说话的角色一行，其他角色用"隐藏"（比如三人在场，说话的人"显示"，另外两人"隐藏"）
     - 同一场景最多 3 个立绘槽位（左/中/右），不要超过
     - 位置填"左"、"中"、"右"
     - 性别填"男"、"女"或"未知"
     - **★ 如果原文没有明确说明某角色的性别，必须写"未知"，不要猜测**
     - 心情填：开心、平静、忧郁、愤怒、紧张、惊讶、害羞、悲伤、默认
     - 旁白不填角色名，用 \`【旁白】: 内容\`
     - 心理活动用【旁白】表现，不要写成对话
  
  4. **保留原文**：
     - 保留原文的对白（可以稍微精简，但不要改变意思）
     - 不要编新剧情
     - 不要漏掉关键转折
     - 原文的叙述段落要转成【旁白】或角色内心独白
     - **第一人称"我"的叙述如果是主角视角，改写成【旁白】或"我"这个角色（以【我|...】行呈现）**
  
  5. **长度控制**：
     - 一章输出 20-60 行对话（视原文长度而定）
     - 太长可以合并/压缩次要对话，但不要丢关键情节
     - 太短（<15 行）说明压缩过度了，可以展开一些描写
  
  6. **选项**：只在原文有明显的选择/分岔/悬念时添加，一般 0-2 处。
     - 选项内容要符合原文情境
     - 选项后不要再输出对话
  
  7. **不要输出任何解释、总结、前言**，直接从【背景】开始。
  
  ===== 完整输出示例 =====
  
  【背景】学校天台
  ${hasMusic ? '🎵 音乐：宁静' : ''}
  
  【对话】
  【旁白】: 夕阳把天台的铁栏杆染成橘红色。
  【林青禾|显示|中|女|平静】: 你来了。
  【我|显示|中|男|默认】: 嗯。你说的"重要的事"，是什么？
  【林青禾|显示|中|女|紧张】: 其实……我一直想告诉你。
  【旁白】: 她攥紧了手里的信纸，指节发白。
  ${hasMusic ? '🎵 音乐：紧张' : ''}
  【林青禾|显示|中|女|害羞】: 我喜欢你。
  
  【背景】学校走廊
  【旁白】: 夜色降临，走廊的灯一盏一盏亮起来。
  【陆行舟|显示|左|男|平静】: 你刚从天台下来？
  【我|显示|右|男|默认】: 嗯。
  【陆行舟|显示|左|男|紧张】: 你的脸……很红。
  
  【选项】
  A. 逃回教室。
  B. 镇定地回应他。
  
  ===== 开始转换 =====`;
  
        console.log('[Converter] 提示词长度:', prompt.length);
  
        const reply = await API.chat([
          { role: 'user', content: prompt },
        ], {
          temperature: 0.85,
          maxTokens: isLong ? 8000 : 6000,
        });
  
        if (isCancelled && isCancelled()) {
          throw new Error('用户取消');
        }
  
        return this._cleanScript(reply);
      },
  
      _cleanScript(text) {
        if (!text) return '';
        let clean = text.trim();
        clean = clean.replace(/^```[\w]*\n?/, '').replace(/\n?```\s*$/, '');
        clean = clean.trim();
        clean = clean.replace(/^(好的|以下是|下面是|这是)[^\n]*\n+/, '');
        return clean;
      },
  
      // ============================================================
      // 仅重新转换（不弹对话框）
      // ============================================================
      async reconvert(chapterId) {
        const ch = State.getChapter(chapterId);
        if (!ch) return;
        if (!ch.raw) {
          alert('没有原文');
          return;
        }
  
        window.UIManager?.showText?.('正在重新转换…', 1500);
  
        try {
          const script = await this.convertToScript(ch);
          State.updateChapter(ch.id, { script, convertedAt: Date.now() });
          window.UIManager?.showText?.('✅ 重新转换完成', 2000);
          window.VNChapters.render();
          return script;
        } catch (e) {
          console.error('[Converter] 重新转换失败:', e);
          alert('重新转换失败：' + e.message);
        }
      },
    };
  
    window.Converter = Converter;
    console.log('[VN Reader] converter.js 已加载');
  })();