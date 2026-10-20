// ============================================================
// VN Reader · tts/core.js
// 引擎层：配置 / 缓存 / 后端调用 / 播放 / 中止 / Ducking
// 依赖：state.js
// ============================================================

(function () {
    'use strict';
  
    const State = window.VNState;
  
    // ==================== 配置 ====================
    const TTSConfig = {
      _defaults: {
        enabled: false,
        endpoint: 'http://127.0.0.1:8080',
        model: 'omnivoice',
        volume: 1.0,
        bgmVolume: 0.5,
        rate: 1.0,
        maxTokens: 256,
        cacheLimit: 100,
        folderBase: 'assets/voices',
        waitForTTS: false,
        duckLevel: 0.3,
      },
  
      get() {
        const st = State.get();
        if (!st.tts) st.tts = {};
        for (const [k, v] of Object.entries(this._defaults)) {
          if (st.tts[k] === undefined) st.tts[k] = v;
        }
        return st.tts;
      },
  
      set(key, value) {
        const st = State.get();
        if (!st.tts) st.tts = {};
        st.tts[key] = value;
        State.save();
      },
    };
  
    // ==================== LRU ====================
    class LRUCache {
      constructor(limit = 100) { this.limit = limit; this.map = new Map(); }
      has(k) { return this.map.has(k); }
      get(k) {
        if (!this.map.has(k)) return undefined;
        const v = this.map.get(k); this.map.delete(k); this.map.set(k, v); return v;
      }
      set(k, v) {
        if (this.map.has(k)) this.map.delete(k);
        else if (this.map.size >= this.limit) this.map.delete(this.map.keys().next().value);
        this.map.set(k, v);
      }
      clear() { this.map.clear(); }
      get size() { return this.map.size; }
    }
  
    // ==================== Ducking ====================
    const DuckingManager = {
      _duckFactor: 1.0,
      _ducking: false,
      _baseVolume: null,
      _duckLevel: 0.3,
  
      _getBase() {
        const v = window.TTSConfig?.get?.().bgmVolume;
        return typeof v === 'number' ? v : 0.5;
      },
      _apply() {
        const base = this._baseVolume ?? this._getBase();
        const final = base * this._duckFactor;
        if (window.VNMusic?.setVolume) window.VNMusic.setVolume(final);
        return final;
      },
      setBaseVolume(v) {
        this._baseVolume = typeof v === 'number' ? v : 0.5;
        if (!this._ducking) {
          this._duckFactor = 1.0;
          this._apply();
        }
      },
      duck() {
        if (this._ducking) return;
        this._ducking = true;
        this._duckFactor = this._duckLevel;
        this._apply();
      },
      unduck() {
        if (!this._ducking) return;
        this._ducking = false;
        this._duckFactor = 1.0;
        this._baseVolume = this._getBase();
        this._apply();
      },
      isDucking() { return this._ducking; },
    };
  
    // ==================== Core ====================
    const TTSCore = {
      _cache: null,
      _refTextCache: new Map(),
      _currentAudio: null,
      _currentResolve: null,
      _abortControllers: new Map(),
  
      init() {
        const cfg = TTSConfig.get();
        this._cache = new LRUCache(cfg.cacheLimit);
        console.log('[TTS·Core] 初始化完成, endpoint =', cfg.endpoint);
      },
  
      get endpoint() { return TTSConfig.get().endpoint; },
      get model() { return TTSConfig.get().model; },
  
      async _resolveRefText(voiceRef) {
        if (!voiceRef?.txt) return null;
        const url = voiceRef.txt;
        if (this._refTextCache.has(url)) return this._refTextCache.get(url);
        try {
          const resp = await fetch(url, { cache: 'no-store' });
          if (!resp.ok) return null;
          const text = (await resp.text()).trim();
          if (!text) return null;
          this._refTextCache.set(url, text);
          return text;
        } catch (e) {
          return null;
        }
      },
  
      async synthesize(text, voiceRef, options = {}) {
        if (!text || !voiceRef?.ref) return null;
        const cfg = TTSConfig.get();
        const key = this._makeKey(text, voiceRef, cfg);
        if (this._cache?.has(key)) return this._cache.get(key);
  
        const refText = options.refText ?? await this._resolveRefText(voiceRef);
  
        const ctrl = new AbortController();
        this._abortControllers.set(key, ctrl);
  
        const body = {
          model: cfg.model,
          input: text,
          voice_ref: voiceRef.ref,
          response_format: 'wav',
          max_tokens: cfg.maxTokens,
        };
        if (refText) body.reference_text = refText;
  
        let resp;
        try {
          resp = await fetch(`${cfg.endpoint}/v1/audio/speech`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrl.signal,
          });
        } catch (e) {
          this._abortControllers.delete(key);
          if (e.name === 'AbortError') return { __error: 'aborted', voiceRef };
          console.warn('[TTS·Core] 请求失败:', e);
          return { __error: 'network', voiceRef, message: e.message };
        }
        this._abortControllers.delete(key);
  
        if (!resp.ok) {
          let errText = '';
          try { errText = await resp.text(); } catch (e) {}
          let code = 'server';
          if (/could not open|no such file|not found|missing/i.test(errText)) code = 'file_missing';
          else if (/reference_text/i.test(errText)) code = 'reftext_missing';
          console.warn(`[TTS·Core] 服务端 ${resp.status} (${code}):`, errText.slice(0, 200));
          return { __error: code, status: resp.status, voiceRef, errText };
        }
  
        const blob = await resp.blob();
        this._cache?.set(key, blob);
        return blob;
      },
  
      _makeKey(text, voiceRef, cfg) {
        return `${cfg.model}|${voiceRef.ref}|${text}`;
      },
  
      async playBlob(blob, options = {}) {
        if (!blob || blob.__error) return;
  
        return new Promise((resolve) => {
          this.stop();
  
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
  
          const cfg = TTSConfig.get();
          audio.volume = options.volume ?? cfg.volume;
          audio.playbackRate = options.rate ?? cfg.rate;
  
          this._currentAudio = audio;
          this._currentResolve = resolve;
  
          const ducking = window.TTSDucking;
          const shouldDuck = options.duck !== false;
          if (ducking && shouldDuck) ducking.duck();
  
          const cleanup = () => {
            try { URL.revokeObjectURL(url); } catch (e) {}
            if (this._currentResolve === resolve) {
              this._currentAudio = null;
              this._currentResolve = null;
            }
            if (ducking && shouldDuck) ducking.unduck();
            resolve();
          };
  
          audio.onended = cleanup;
          audio.onerror = () => { console.warn('[TTS·Core] 播放错误'); cleanup(); };
          audio.play().catch(() => { cleanup(); });
        });
      },
  
      async speak(text, voiceRef, options = {}) {
        const blob = await this.synthesize(text, voiceRef, options);
        if (!blob || blob.__error) return false;
        await this.playBlob(blob, options);
        return true;
      },
  
      stop() {
        if (this._currentAudio) {
          try { this._currentAudio.pause(); this._currentAudio.src = ''; } catch (e) {}
          this._currentAudio = null;
        }
        if (this._currentResolve) {
          const r = this._currentResolve;
          this._currentResolve = null;
          try { r(); } catch (e) {}
        }
        window.TTSDucking?.unduck?.();
      },
  
      abortAll() {
        for (const ctrl of this._abortControllers.values()) {
          try { ctrl.abort(); } catch (e) {}
        }
        this._abortControllers.clear();
        this.stop();
      },
  
      clearCache() {
        this._cache?.clear();
        this._refTextCache.clear();
        console.log('[TTS·Core] 缓存已清空');
      },
  
      getCacheSize() { return this._cache?.size ?? 0; },
    };
  
    window.TTSDucking = DuckingManager;
    window.TTSConfig = TTSConfig;
    window.TTSCore = TTSCore;
  
    console.log('[VN Reader·TTS] core.js 已加载');
  })();