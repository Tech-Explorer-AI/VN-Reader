// ============================================================
// VN Reader · state.js
// 全局状态 + 存档
// ============================================================

(function () {
    'use strict';
  
    const STORAGE_KEY = 'vn_reader_state_v1';
  
    // ---------- 默认配置 ----------
    const DEFAULTS = {
      settings: {
        api: {
          endpoint: 'http://127.0.0.1:5001',
          apiKey: '',
          model: 'koboldcpp',
          temperature: 0.8,
          maxTokens: 4096,
        },
        // ★ 音乐标记列表（玩家可编辑）
        musicMarkers: [
          '欢乐','温馨','紧张','忧伤','意外','辉煌','朝阳','浪漫',
          '宁静','神秘','舒缓','悠扬','希望','思考','振奋','战斗',
          '比赛','演出','训练','结算','日常','空灵','旅途'
        ],
        // ★ 默认背景（找不到图时用纯色）
        fallbackBg: 'linear-gradient(135deg,#1a1a2e,#16213e)',
        textSpeed: 30,        // ms / 字
        autoAdvance: false,   // 自动前进
      },
      tts: {
        enabled: false,
        endpoint: 'http://127.0.0.1:8080',
        model: 'omnivoice',
        volume: 1.0,
        bgmVolume: 0.5,
        rate: 1.0,
        maxTokens: 256,
        cacheLimit: 100,
        folderBase: 'voices',
        waitForTTS: false,
        duckLevel: 0.3,
      },
    };
  
    // ---------- 状态对象 ----------
    const state = {
      // 章节列表
      chapters: [],
      // 当前播放的章节 id
      currentChapterId: null,
      // 玩家（用在剧本里的【玩家】）
      player: {
        name: '我',
        gender: '男',
      },
      // 立绘随机抽签：{ 角色名: 'assets/sprites/女/17.png' }
      spriteAssignments: {},
      // TTS 抽签（结构见 tts/router.js）
      ttsVoiceAssign: { female: {}, male: {} },
      ttsCharacterMode: {},       // 降级标记
      // 设置
      settings: JSON.parse(JSON.stringify(DEFAULTS.settings)),
      tts: JSON.parse(JSON.stringify(DEFAULTS.tts)),
      // 版本号（用于未来升级迁移）
      version: 1,
    };
  
    // ---------- 存档 ----------
    const State = {
      get() { return state; },
  
      // 保存（节流）
      _saveTimer: null,
      save(immediate = false) {
        if (immediate) {
          this._flush();
          return;
        }
        if (this._saveTimer) return;
        this._saveTimer = setTimeout(() => {
          this._saveTimer = null;
          this._flush();
        }, 400);
      },
  
      _flush() {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
          console.warn('[State] 保存失败:', e);
        }
      },
  
      // 加载
      load() {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (!raw) return false;
          const data = JSON.parse(raw);
          if (!data || typeof data !== 'object') return false;
  
          // 合并进 state（浅合并，保留默认值兜底）
          if (Array.isArray(data.chapters)) state.chapters = data.chapters;
          if (typeof data.currentChapterId === 'string') state.currentChapterId = data.currentChapterId;
          if (data.player) Object.assign(state.player, data.player);
          if (data.spriteAssignments) state.spriteAssignments = data.spriteAssignments;
          if (data.ttsVoiceAssign) Object.assign(state.ttsVoiceAssign, data.ttsVoiceAssign);
          if (data.ttsCharacterMode) state.ttsCharacterMode = data.ttsCharacterMode;
          if (data.settings) Object.assign(state.settings, data.settings);
          if (data.settings?.api) Object.assign(state.settings.api, data.settings.api);
          if (data.tts) Object.assign(state.tts, data.tts);
  
          console.log('[State] 已加载', state.chapters.length, '个章节');
          return true;
        } catch (e) {
          console.warn('[State] 加载失败:', e);
          return false;
        }
      },
  
      // 清空
      clear() {
        localStorage.removeItem(STORAGE_KEY);
        location.reload();
      },
  
      // 导出/导入（给"设置"面板用）
      export() {
        return JSON.stringify(state, null, 2);
      },
      import(jsonStr) {
        const data = JSON.parse(jsonStr);
        if (!data || typeof data !== 'object') throw new Error('无效的存档格式');
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        location.reload();
      },
  
      // ---------- 便捷读写 ----------
      getChapter(id) {
        return state.chapters.find(c => c.id === id) || null;
      },
      addChapter(chapter) {
        state.chapters.push(chapter);
        this.save();
        return chapter;
      },
      removeChapter(id) {
        const i = state.chapters.findIndex(c => c.id === id);
        if (i > -1) {
          state.chapters.splice(i, 1);
          if (state.currentChapterId === id) state.currentChapterId = null;
          this.save();
        }
      },
      updateChapter(id, patch) {
        const ch = this.getChapter(id);
        if (!ch) return null;
        Object.assign(ch, patch);
        this.save();
        return ch;
      },
    };
  
    // ---------- 工具 ----------
    State.makeId = () => 'ch_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  
    // ---------- 首次加载自动恢复 ----------
    State.load();
  
    window.VNState = State;
    console.log('[VN Reader] state.js 已加载');
  })();