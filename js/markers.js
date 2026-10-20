// ============================================================
// VN Reader · markers.js
// 从已生成的 VN 脚本中扫描 背景 / 音乐 标记，支持批量改名
// 依赖：state.js
// ============================================================

(function () {
    'use strict';
  
    const Markers = {
      // ---------- 扫描脚本里的标记 ----------
      // 返回 { bg: [{name, count}], music: [{name, count}] }
      scan(script) {
        const bgMap = new Map();
        const musicMap = new Map();
        if (!script) return { bg: [], music: [] };
  
        const lines = script.split('\n');
        for (const line of lines) {
          let m = line.match(/^【背景】\s*(.+)$/);
          if (m) {
            const name = m[1].trim();
            if (!name) continue;
            bgMap.set(name, (bgMap.get(name) || 0) + 1);
            continue;
          }
          m = line.match(/^🎵\s*音乐[:：]\s*(.+)$/) || line.match(/^【音乐】\s*(.+)$/);
          if (m) {
            const name = m[1].trim();
            if (!name) continue;
            musicMap.set(name, (musicMap.get(name) || 0) + 1);
          }
        }
  
        const toArr = (map) => Array.from(map.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count);
  
        return { bg: toArr(bgMap), music: toArr(musicMap) };
      },
  
      // ---------- 批量改名 ----------
      // oldName → newName，只替换整行匹配的标记行
      renameBg(script, oldName, newName) {
        if (!script || !oldName || !newName || oldName === newName) return script;
        const re = new RegExp(`^(【背景】\\s*)${this._escapeRe(oldName)}\\s*$`, 'gm');
        return script.replace(re, `$1${newName}`);
      },
  
      renameMusic(script, oldName, newName) {
        if (!script || !oldName || !newName || oldName === newName) return script;
        // 兼容 🎵 音乐：xxx 和 【音乐】xxx 两种写法
        let out = script.replace(
          new RegExp(`^(🎵\\s*音乐[:：]\\s*)${this._escapeRe(oldName)}\\s*$`, 'gm'),
          `$1${newName}`
        );
        out = out.replace(
          new RegExp(`^(【音乐】\\s*)${this._escapeRe(oldName)}\\s*$`, 'gm'),
          `$1${newName}`
        );
        return out;
      },
  
      // ---------- 删除某标记行 ----------
      removeBg(script, name) {
        const re = new RegExp(`^【背景】\\s*${this._escapeRe(name)}\\s*\\n?`, 'gm');
        return script.replace(re, '');
      },
  
      removeMusic(script, name) {
        let out = script.replace(
          new RegExp(`^🎵\\s*音乐[:：]\\s*${this._escapeRe(name)}\\s*\\n?`, 'gm'), ''
        );
        out = out.replace(
          new RegExp(`^【音乐】\\s*${this._escapeRe(name)}\\s*\\n?`, 'gm'), ''
        );
        return out;
      },
  
      _escapeRe(s) {
        return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      },
    };
  
    window.VNMarkers = Markers;
    console.log('[VN Reader] markers.js 已加载');
  })();