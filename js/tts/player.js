// ============================================================
// VN Reader · tts/player.js
// 播放层：串行合成 + 串行播放 + 三层降级
// ============================================================

(function () {
    'use strict';
  
    const TTSCore = window.TTSCore;
    const TTSRouter = window.TTSRouter;
    const TTSConfig = window.TTSConfig;
  
    const TTSPlayer = {
      _pipeline: null,
      _currentPlayPromise: null,
  
      startPipeline(dialogues) {
        const cfg = TTSConfig.get();
        if (!cfg.enabled) return;
  
        this.abort();
  
        this._pipeline = {
          dialogues,
          results: new Map(),
          aborted: false,
          synthCursor: 0,
          waiter: null,
        };
  
        console.log(`[TTS·Player] 串行流水线启动: ${dialogues.length} 句`);
        this._runSynthWorker();
      },
  
      async _runSynthWorker() {
        const p = this._pipeline;
        if (!p) return;
  
        for (let i = 0; i < p.dialogues.length; i++) {
          if (p.aborted) break;
          const d = p.dialogues[i];
          try {
            await this._synthOne(d, i);
          } catch (e) {
            console.warn(`[TTS·Player] 第 ${i} 句异常:`, e);
            p.results.set(i, { __error: 'exception' });
          }
          this._notifyWaiter(i);
        }
  
        console.log('[TTS·Player] 流水线全部完成');
        this._notifyWaiter(-1);
      },
  
      async _synthOne(dialogue, index) {
        const p = this._pipeline;
        if (!p || p.aborted) return;
  
        const text = dialogue?.content;
        if (!text) { p.results.set(index, { __error: 'empty' }); return; }
  
        const voiceRef = await TTSRouter.resolve(dialogue);
        const blob = await this._synthWithFallback(text, voiceRef, dialogue);
  
        if (p.aborted) return;
        p.results.set(index, blob || { __error: 'all_failed' });
      },
  
      async _synthWithFallback(text, voiceRef, dialogue) {
        // 尝试 1：原音色
        let blob = await TTSCore.synthesize(text, voiceRef, {});
        if (blob && !blob.__error) return blob;
        console.log(`[TTS·Player] 尝试1失败 (${blob?.__error}): ${voiceRef.ref}`);
  
        // 尝试 2：folder default
        if (voiceRef.mode === 'exact' && voiceRef.characterName) {
          TTSRouter.markFallback(voiceRef.characterName);
          const folderRef = TTSRouter._makeDefaultRef(voiceRef.folder);
          blob = await TTSCore.synthesize(text, folderRef, {});
          if (blob && !blob.__error) return blob;
        }
  
        // 尝试 3：narrator default
        if (voiceRef.folder !== 'narrator') {
          const narratorRef = TTSRouter._makeDefaultRef('narrator');
          blob = await TTSCore.synthesize(text, narratorRef, {});
          if (blob && !blob.__error) return blob;
        }
  
        console.warn(`[TTS·Player] 全部降级失败: "${text.slice(0, 20)}..."`);
        return null;
      },
  
      async playFor(dialogue, index) {
        const cfg = TTSConfig.get();
        if (!cfg.enabled) return;
        if (!this._pipeline) return;
  
        const text = dialogue?.content;
        if (!text) return;
  
        if (this._currentPlayPromise) {
          try { TTSCore.stop(); } catch (e) {}
          this._currentPlayPromise = null;
        }
        if (!this._pipeline || this._pipeline.aborted) return;
  
        let blob = this._pipeline.results.get(index);
        if (blob === undefined) blob = await this._waitForResult(index);
        if (!blob || blob.__error) return;
        if (!this._pipeline || this._pipeline.aborted) return;
  
        const playPromise = TTSCore.playBlob(blob, {});
        this._currentPlayPromise = playPromise;
        try {
          await playPromise;
        } finally {
          if (this._currentPlayPromise === playPromise) this._currentPlayPromise = null;
        }
      },
  
      async waitCurrent() {
        if (this._currentPlayPromise) {
          try { await this._currentPlayPromise; } catch (e) {}
        }
      },
  
      _waitForResult(index, timeoutMs = 60000) {
        return new Promise((resolve) => {
          const p = this._pipeline;
          if (!p) return resolve(null);
          if (p.results.has(index)) return resolve(p.results.get(index));
          if (p.synthCursor > p.dialogues.length) return resolve(null);
  
          let done = false;
          const finish = (v) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            if (p.waiter && p.waiter.index === index && p.waiter.fn === onReady) p.waiter = null;
            resolve(v);
          };
          const onReady = () => { if (p.results.has(index)) finish(p.results.get(index)); };
          p.waiter = { index, fn: onReady };
  
          const timer = setTimeout(() => {
            console.warn(`[TTS·Player] 第 ${index} 句合成超时`);
            finish(null);
          }, timeoutMs);
        });
      },
  
      _notifyWaiter(finishedIndex) {
        const p = this._pipeline;
        if (!p || !p.waiter) return;
        const { index, fn } = p.waiter;
        if (finishedIndex === -1 || finishedIndex === index) fn();
      },
  
      abort() {
        if (this._pipeline) this._pipeline.aborted = true;
        this._pipeline = null;
        this._currentPlayPromise = null;
        TTSCore.abortAll();
      },
  
      stop() { TTSCore.stop(); },
  
      isPreparing() { return !!this._pipeline && !this._pipeline.aborted; },
    };
  
    window.TTSPlayer = TTSPlayer;
    console.log('[VN Reader·TTS] player.js 已加载');
  })();