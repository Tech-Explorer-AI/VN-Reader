// ============================================================
// VN Reader · tts/router.js
// 路由层：角色名 / 性别 → voiceRef
// ★ 音色优先级：同名专属.txt存在 → 抽签 → 降级 default
// ============================================================

(function () {
    'use strict';
  
    const State = window.VNState;
    const TTSConfig = window.TTSConfig;
  
    const VOICE_POOL_SIZE = 26;
    const FIXED_FOLDERS = ['narrator', 'player', 'other'];
  
    // ---------- 持久化 ----------
    function _getAssignStore() {
      const st = State.get();
      if (!st.ttsVoiceAssign || typeof st.ttsVoiceAssign !== 'object') {
        st.ttsVoiceAssign = { female: {}, male: {} };
      }
      if (!st.ttsVoiceAssign.female) st.ttsVoiceAssign.female = {};
      if (!st.ttsVoiceAssign.male) st.ttsVoiceAssign.male = {};
      return st.ttsVoiceAssign;
    }
  
    function _getModeStore() {
      const st = State.get();
      if (!st.ttsCharacterMode || typeof st.ttsCharacterMode !== 'object') {
        st.ttsCharacterMode = {};
      }
      return st.ttsCharacterMode;
    }
  
    function _persist() {
      try { State.save(); } catch (e) {}
    }
  
    // ---------- 探测缓存 ----------
    const _exactProbe = { female: new Map(), male: new Map() };
  
    async function _probeExactVoice(folder, name) {
      const cache = _exactProbe[folder];
      if (!cache) return false;
      if (cache.has(name)) return cache.get(name);
  
      // ★ 探测 .txt（存在说明有专属音色）
      const cfg = TTSConfig.get();
      const base = (cfg.folderBase || 'assets/voices').replace(/\/+$/, '');
      const url = `${base}/${folder}/${encodeURIComponent(name)}.txt`;
  
      let exists = false;
      try {
        const r = await fetch(url, { method: 'HEAD', cache: 'force-cache' });
        exists = r.ok;
      } catch (e) {
        try {
          const r = await fetch(url, { method: 'GET', cache: 'force-cache' });
          exists = r.ok;
        } catch (e2) { exists = false; }
      }
  
      cache.set(name, exists);
      console.log(`[TTS·Router] 探测 [${folder}] ${name} → ${exists ? '✅ 专属' : '❌ 抽签'}`);
      return exists;
    }
  
    // ---------- 主对象 ----------
    const TTSRouter = {
      async resolve(dialogue) {
        const cfg = TTSConfig.get();
        const base = cfg.folderBase || 'assets/voices';
        const txtBase = base;
  
        const name = dialogue?.character || '旁白';
        const identity = this._resolveIdentity(name, dialogue);
  
        // 旁白/玩家/其他 → 固定 default
        if (FIXED_FOLDERS.includes(identity)) {
          return this._makeRef(identity, 'default', base, txtBase);
        }
  
        // 空名 / 已降级 → default
        const modeStore = _getModeStore();
        if (!name || modeStore[name] === 'fallback') {
          return this._makeRef(identity, 'default', base, txtBase);
        }
  
        // 探测同名
        const hasExact = await _probeExactVoice(identity, name);
        if (hasExact) {
          return this._makeRef(identity, name, base, txtBase, 'exact', name);
        }
  
        // 抽签
        const n = this._assignVoice(identity, name);
        return this._makeRef(identity, String(n), base, txtBase, 'exact', name);
      },
  
      _resolveIdentity(name, dialogue) {
        if (!name || ['旁白', '系统', 'narrator'].includes(name)) return 'narrator';
        if (this._isPlayer(name)) return 'player';
  
        // ★ 性别来源：当前章节的角色表 + 剧本里的 extraInfo
        let gender = '';
  
        // 1. 剧本行自带
        if (dialogue?.extraInfo) {
          gender = String(dialogue.extraInfo).trim();
        }
  
        // 2. 从当前章节角色表查
        if (!gender) {
          const chId = State.get().currentChapterId;
          const ch = chId ? State.getChapter(chId) : null;
          const record = ch?.characters?.find(c => c.name === name);
          if (record?.gender) gender = record.gender;
        }
  
        const g = String(gender).toLowerCase();
        if (g.includes('女') || g.includes('female') || g === 'f') return 'female';
        if (g.includes('男') || g.includes('male') || g === 'm') return 'male';
  
        return 'other';
      },
  
      _assignVoice(folder, name, total = VOICE_POOL_SIZE) {
        const store = _getAssignStore();
        const table = store[folder];
        if (!table) return 1;
  
        if (table[name] !== undefined) return table[name];
  
        const used = new Set(Object.values(table));
        const candidates = [];
        for (let i = 1; i <= total; i++) if (!used.has(i)) candidates.push(i);
  
        let n;
        if (candidates.length > 0) {
          n = candidates[Math.floor(Math.random() * candidates.length)];
        } else {
          n = Math.floor(Math.random() * total) + 1;
          console.warn(`[TTS·Router] ${folder} 池已满，${name} 共用音色 ${n}`);
        }
  
        table[name] = n;
        _persist();
        console.log(`[TTS·Router] 抽签 [${folder}] ${name} → ${n}`);
        return n;
      },
  
      resetVoiceAssign() {
        const store = _getAssignStore();
        const fCount = Object.keys(store.female).length;
        const mCount = Object.keys(store.male).length;
  
        store.female = {};
        store.male = {};
        _exactProbe.female.clear();
        _exactProbe.male.clear();
  
        const modeStore = _getModeStore();
        for (const k of Object.keys(modeStore)) delete modeStore[k];
  
        _persist();
        console.log(`[TTS·Router] 已重置音色 (female ${fCount} / male ${mCount})`);
      },
  
      resetFallback() {
        const modeStore = _getModeStore();
        for (const k of Object.keys(modeStore)) delete modeStore[k];
        _persist();
        console.log('[TTS·Router] 降级标记已重置');
      },
  
      _makeRef(folder, name, base, txtBase, mode = 'default', characterName = null) {
        return {
          ref: `${base}/${folder}/${name}.wav`,
          txt: `${txtBase}/${folder}/${name}.txt`,
          folder,
          name,
          mode,
          characterName,
        };
      },
  
      _makeDefaultRef(folder) {
        const cfg = TTSConfig.get();
        const base = cfg.folderBase || 'assets/voices';
        return this._makeRef(folder, 'default', base, base);
      },
  
      markFallback(characterName) {
        if (!characterName) return;
        const modeStore = _getModeStore();
        modeStore[characterName] = 'fallback';
        _persist();
        console.log(`[TTS·Router] ${characterName} 已降级`);
      },
  
      _isPlayer(name) {
        if (!name) return false;
        const playerName = State.get().player?.name;
        return ['玩家', '我', '主人公', 'player'].includes(name)
          || (playerName && name === playerName);
      },
    };
  
    window.TTSRouter = TTSRouter;
    console.log('[VN Reader·TTS] router.js 已加载');
  })();