/**
 * Incremental media session — reuse nodes, textures, probes across searches (Bridge-style cache).
 */
(function (global) {
  const MAX_CACHE = 25000;

  class MediaSession {
    constructor() {
      this.byKey = new Map();
      this.displayOrder = [];
      this.lastQuery = "";
      this.cursors = {};
      this.clusterId = "default";
      this.clusters = new Map([["default", { label: "Wall", keys: [] }]]);
      this.stats = { cacheHits: 0, reusedNodes: 0, newNodes: 0, skippedProbes: 0 };
    }

    key(item) {
      return `${item.mediaType}:${item.url}`;
    }

    get(key) {
      return this.byKey.get(key);
    }

    has(key) {
      return this.byKey.has(key);
    }

    keys() {
      return new Set(this.byKey.keys());
    }

    touchEntry(key, item) {
      let e = this.byKey.get(key);
      if (!e) {
        e = {
          key,
          item: { ...item },
          node: null,
          probeMeta: null,
          analyzers: null,
          thumbState: "idle",
          lastQuery: this.lastQuery,
          clusterId: this.clusterId,
          indexed: false
        };
        this.byKey.set(key, e);
        this._evictIfNeeded();
      } else {
        Object.assign(e.item, item);
        e.lastQuery = this.lastQuery;
      }
      return e;
    }

    _evictIfNeeded() {
      if (this.byKey.size <= MAX_CACHE) return;
      const victims = [...this.byKey.entries()]
        .filter(([, e]) => !e.node || e.node.parent === null)
        .sort((a, b) => (a[1].lastUsed || 0) - (b[1].lastUsed || 0));
      for (let i = 0; i < Math.min(500, victims.length); i++) {
        const [k, e] = victims[i];
        if (e.node) {
          e.node.destroy({ children: true });
        }
        this.byKey.delete(k);
      }
    }

    setDisplayKeys(orderedKeys) {
      this.displayOrder = orderedKeys;
    }

    getDisplayEntries(limit) {
      return this.displayOrder
        .slice(0, limit)
        .map((k) => this.byKey.get(k))
        .filter(Boolean);
    }

    bumpStats(kind) {
      if (this.stats[kind] != null) this.stats[kind]++;
    }
  }

  global.VWallSession = new MediaSession();
})(window);
