// ============================================================
// VN Reader · sprites.js
// 立绘管理器：状态 fallback + 随机池抽签 + 玩家立绘
// 依赖：state.js
// ============================================================

(function () {
    'use strict';
  
    const State = window.VNState;
  
    const SpriteManager = {
      basePaths: ['assets/sprites/'],
      playerPaths: ['assets/sprites/玩家/'],
      extensions: ['png', 'webp'],
      randomRange: { min: 1, max: 200 },
      missLimit: 3,
  
      cache: {},
      randomPoolCache: {},
      characterSpriteMap: {},
      _characterType: {},
      _existsCache: {},
      _existsPending: {},
  
      playerSprite: undefined,
      playerAvatar: undefined,
  
      // ============================================================
      // 存在性探测（带缓存，避免重复请求）
      // ============================================================
      exists(url) {
        if (url in this._existsCache) {
          return Promise.resolve(this._existsCache[url]);
        }
        if (url in this._existsPending) {
          return this._existsPending[url];
        }
  
        const p = new Promise(resolve => {
          const img = new Image();
          const timer = setTimeout(() => {
            img.onload = img.onerror = null;
            this._existsCache[url] = false;
            delete this._existsPending[url];
            resolve(false);
          }, 1200);
  
          img.onload = () => {
            clearTimeout(timer);
            this._existsCache[url] = true;
            delete this._existsPending[url];
            resolve(true);
          };
          img.onerror = () => {
            clearTimeout(timer);
            this._existsCache[url] = false;
            delete this._existsPending[url];
            resolve(false);
          };
          img.src = url;
        });
  
        this._existsPending[url] = p;
        return p;
      },
  
      // ============================================================
      // 性别归一化
      // ============================================================
      normalizeGender(g) {
        if (!g) return '默认';
        const s = String(g).toLowerCase();
        if (s.includes('女') || s.includes('female') || s === 'f') return '女';
        if (s.includes('男') || s.includes('male') || s === 'm') return '男';
        return '默认';
      },
  
      _normalizeState(state) {
        if (!state) return '默认';
        return String(state).trim() || '默认';
      },
  
      // ============================================================
      // 角色类型判定：exact | random | none
      // ============================================================
      async _detectCharacterType(name, gender) {
        if (this._characterType[name]) return this._characterType[name];
  
        const stdGender = this.normalizeGender(gender);
  
        // 1. 有专属立绘目录
        const hasExact = await this._hasExactSprite(name, stdGender);
        if (hasExact) {
          this._characterType[name] = 'exact';
          return 'exact';
        }
  
        // 2. 已有随机分配
        const saved = State.get().spriteAssignments?.[name];
        if (saved) {
          this._characterType[name] = 'random';
          return 'random';
        }
  
        // 3. 抽一张
        const picked = await this.pickRandom(stdGender);
        if (picked) {
          const st = State.get();
          if (!st.spriteAssignments) st.spriteAssignments = {};
          st.spriteAssignments[name] = picked;
          State.save();
          this._characterType[name] = 'random';
          return 'random';
        }
  
        // 4. 无立绘
        this._characterType[name] = 'none';
        return 'none';
      },
  
      // 是否有"角色目录"（只看默认，不看状态）
      async _hasExactSprite(name, gender) {
        const folder = this.normalizeGender(gender);
        const dirs = [folder, '默认', ''];
  
        for (const base of this.basePaths) {
          for (const dir of dirs) {
            for (const ext of this.extensions) {
              const dirPart = dir ? `${dir}/` : '';
              // base/女/林青禾.png
              if (await this.exists(`${base}${dirPart}${name}.${ext}`)) return true;
              // base/女/林青禾/默认.png
              if (await this.exists(`${base}${dirPart}${name}/默认.${ext}`)) return true;
            }
          }
        }
        return false;
      },
  
      // ============================================================
      // 精确匹配（带状态 fallback）
      // 查找顺序：
      //   base/性别/名字/状态.ext
      //   base/性别/名字/默认.ext
      //   base/性别/名字.ext
      //   base/默认/名字/状态.ext
      //   base/默认/名字/默认.ext
      //   base/默认/名字.ext
      //   base/名字/状态.ext
      //   base/名字.ext
      // ============================================================
      async findExact(name, gender, state = '默认') {
        const folder = this.normalizeGender(gender);
        const dirs = [folder, '默认', ''];
  
        const states = (state && state !== '默认')
          ? [state, '默认', '']
          : ['默认', ''];
  
        for (const base of this.basePaths) {
          for (const dir of dirs) {
            for (const st of states) {
              for (const ext of this.extensions) {
                const dirPart = dir ? `${dir}/` : '';
                const path = st
                  ? `${base}${dirPart}${name}/${st}.${ext}`
                  : `${base}${dirPart}${name}.${ext}`;
                if (await this.exists(path)) {
                  return path;
                }
              }
            }
          }
        }
        return null;
      },
  
      // ============================================================
      // 随机池
      // ============================================================
      async buildRandomPool(gender) {
        const folder = this.normalizeGender(gender);
  
        if (this.randomPoolCache[folder]) return this.randomPoolCache[folder];
  
        // 探测哪个 base 可用
        let validBase = null;
        for (const base of this.basePaths) {
          // 探前 5 个文件
          for (let i = 1; i <= 5; i++) {
            for (const ext of this.extensions) {
              if (await this.exists(`${base}${folder}/${i}.${ext}`)) {
                validBase = base;
                break;
              }
            }
            if (validBase) break;
          }
          if (validBase) break;
        }
  
        if (!validBase) {
          this.randomPoolCache[folder] = [];
          return [];
        }
  
        // 扫描池
        const pool = [];
        let misses = 0;
        const { min, max } = this.randomRange;
  
        for (let i = min; i <= max; i++) {
          let found = false;
          for (const ext of this.extensions) {
            const path = `${validBase}${folder}/${i}.${ext}`;
            if (await this.exists(path)) {
              pool.push(path);
              found = true;
              break;
            }
          }
  
          if (found) {
            misses = 0;
          } else {
            misses++;
            if (misses >= this.missLimit) break;
          }
        }
  
        console.log(`[Sprites] 随机池 ${folder}: ${pool.length} 张`);
        this.randomPoolCache[folder] = pool;
        return pool;
      },
  
      async pickRandom(gender) {
        const pool = await this.buildRandomPool(gender);
        if (pool.length === 0) return null;
  
        // 排除已分配的
        const assigned = new Set(Object.values(State.get().spriteAssignments || {}));
        const available = pool.filter(p => !assigned.has(p));
  
        if (available.length === 0) {
          // 池子抽干，允许重复
          return pool[Math.floor(Math.random() * pool.length)];
        }
        return available[Math.floor(Math.random() * available.length)];
      },
  
      // ============================================================
      // 主入口：拿一个角色的立绘
      // ============================================================
      async get(name, gender, state = '默认') {
        const stdState = this._normalizeState(state);
        const key = `${name}_${gender}_${stdState}`;
        if (key in this.cache) return this.cache[key];
  
        // 玩家特殊处理
        if (this._isPlayerName(name)) {
          const url = await this.getPlayerSpriteState(stdState);
          this.cache[key] = url;
          return url;
        }
  
        const charType = await this._detectCharacterType(name, gender);
  
        if (charType === 'random') {
          const url = State.get().spriteAssignments?.[name] || null;
          this.cache[key] = url;
          return url;
        }
  
        if (charType === 'none') {
          this.cache[key] = null;
          return null;
        }
  
        // 专属：走状态检索
        let url = await this.findExact(name, gender, stdState);
        if (!url && stdState !== '默认') {
          url = await this.get(name, gender, '默认');
        }
  
        this.cache[key] = url;
        return url;
      },
  
      // 同步查询（只读缓存）
      getCachedSprite(name) {
        if (this.characterSpriteMap[name]) return this.characterSpriteMap[name];
        const prefix = name + '_';
        for (const key in this.cache) {
          if (key === name || key.startsWith(prefix)) {
            return this.cache[key];
          }
        }
        return null;
      },
  
      // ============================================================
      // 玩家立绘
      // ============================================================
      async _findPlayerFile(filename) {
        for (const base of this.playerPaths) {
          for (const ext of this.extensions) {
            const path = `${base}${filename}.${ext}`;
            if (await this.exists(path)) return path;
          }
        }
        return null;
      },
  
      async getPlayerSprite() {
        if (this.playerSprite !== undefined) return this.playerSprite;
        this.playerSprite = await this._findPlayerFile('player');
        return this.playerSprite;
      },
  
      async getPlayerSpriteState(state = '默认') {
        const stdState = this._normalizeState(state);
        if (stdState === '默认') return this.getPlayerSprite();
  
        const cacheKey = `player_${stdState}`;
        if (cacheKey in this.cache) return this.cache[cacheKey];
  
        let url = null;
        for (const base of this.playerPaths) {
          for (const ext of this.extensions) {
            const path = `${base}${stdState}.${ext}`;
            if (await this.exists(path)) { url = path; break; }
          }
          if (url) break;
        }
  
        if (!url) url = await this.getPlayerSprite();
        this.cache[cacheKey] = url;
        return url;
      },
  
      async getPlayerAvatar() {
        if (this.playerAvatar !== undefined) return this.playerAvatar;
        this.playerAvatar = await this._findPlayerFile('头像')
          || await this._findPlayerFile('avatar');
        return this.playerAvatar;
      },
  
      // ============================================================
      // 工具
      // ============================================================
      _isPlayerName(name) {
        return ['玩家', '我', '主人公', 'player'].includes(name)
          || name === State.get().player.name;
      },
  
      // 预热一组角色
      async preloadAll(characters) {
        for (const ch of characters) {
          if (!this._isPlayerName(ch.name) && !this.characterSpriteMap[ch.name]) {
            const url = await this.get(ch.name, ch.gender, '默认');
            if (url) this.characterSpriteMap[ch.name] = url;
          }
        }
      },
  
      // 清空（世界重置用）
      clearCache() {
        this.cache = {};
        this.randomPoolCache = {};
        this.characterSpriteMap = {};
        this._characterType = {};
        this._existsCache = {};
        this._existsPending = {};
        this.playerSprite = undefined;
        this.playerAvatar = undefined;
      },
    };
  
    window.SpriteManager = SpriteManager;
    console.log('[VN Reader] sprites.js 已加载');
  })();