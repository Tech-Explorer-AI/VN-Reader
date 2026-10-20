// ============================================================
// VN Reader · api.js
// AI 调用统一封装（OpenAI 格式 /v1/chat/completions）
// 兼容：KoboldCpp v1.5x+、LM Studio、Ollama (/v1)、OpenAI、DeepSeek 等
// ============================================================

(function () {
    'use strict';
  
    const State = window.VNState;
  
    const API = {
      _inflight: false,
  
      get isBusy() { return this._inflight; },
  
      // ============================================================
      // 基础调用
      // ============================================================
      async chat(messages, options = {}) {
        if (this._inflight) {
          console.warn('[API] 上一次请求还在进行，拒绝并发');
          throw new Error('上一次请求还在进行中');
        }
  
        const settings = State.get().settings.api;
        const endpoint = (settings.endpoint || '').replace(/\/+$/, '');
        if (!endpoint) throw new Error('未配置 API 地址，请到设置里填写');
  
        const url = `${endpoint}/v1/chat/completions`;
  
        const body = {
          model: settings.model || 'model',
          messages,
          temperature: options.temperature ?? settings.temperature ?? 0.8,
          max_tokens: options.maxTokens ?? settings.maxTokens ?? 4096,
          stream: false,
        };
  
        const headers = { 'Content-Type': 'application/json' };
        if (settings.apiKey) {
          headers['Authorization'] = `Bearer ${settings.apiKey}`;
        }
  
        this._inflight = true;
        const t0 = Date.now();
  
        try {
          console.log(`[API] POST ${url}`, {
            model: body.model,
            msgCount: messages.length,
            maxTokens: body.max_tokens,
          });
  
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), options.timeout ?? 300000);
  
          let resp;
          try {
            resp = await fetch(url, {
              method: 'POST',
              headers,
              body: JSON.stringify(body),
              signal: controller.signal,
            });
          } finally {
            clearTimeout(timeout);
          }
  
          const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  
          if (!resp.ok) {
            let errText = '';
            try { errText = await resp.text(); } catch (e) {}
            console.error(`[API] HTTP ${resp.status}`, errText);
            throw new Error(`HTTP ${resp.status} ${resp.statusText}\n${errText.slice(0, 300)}`);
          }
  
          const json = await resp.json();
  
          // 兼容多种返回结构
          let content = '';
          if (json.choices?.[0]?.message?.content) {
            content = json.choices[0].message.content;
          } else if (json.choices?.[0]?.text) {
            content = json.choices[0].text;
          } else if (typeof json.content === 'string') {
            content = json.content;
          } else if (json.response) {
            content = json.response;
          }
  
          if (!content) {
            console.warn('[API] 返回结构异常:', json);
            throw new Error('AI 返回内容为空');
          }
  
          console.log(`[API] 完成 (${elapsed}s, ${content.length} 字)`);
          return content;
  
        } finally {
          this._inflight = false;
        }
      },
  
      // ============================================================
      // 连通性测试
      // ============================================================
      async test() {
        try {
          const reply = await this.chat([
            { role: 'user', content: '回复"OK"两个字，不要其他内容。' },
          ], { maxTokens: 20 });
          return { ok: true, reply: reply.trim().slice(0, 50) };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      },
  
      // ============================================================
      // 中止（不做用，留接口）
      // ============================================================
      abort() {
        this._inflight = false;
      },
    };
  
    window.VNAPI = API;
    console.log('[VN Reader] api.js 已加载');
  })();