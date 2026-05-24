/**
 * Clustered probe pool — reuses cached metadata, batches parallel ffprobe/browser probes.
 */
(function (global) {
  const cache = new Map();
  const inFlight = new Map();
  const CLUSTER = 4;

  async function probeCached(item, force) {
    const key = global.VWallCatalog?.itemKey(item) || `${item.mediaType}:${item.url}`;
    if (!force && cache.has(key)) {
      global.VWallSession?.bumpStats("skippedProbes");
      return cache.get(key);
    }
    if (inFlight.has(key)) return inFlight.get(key);

    const p = (async () => {
      const meta = await global.VWallMeta.probeItem(item);
      let analyzers = null;
      if (global.VWallAnalyzers) {
        analyzers = await global.VWallAnalyzers.runCluster(item, null, 2);
      }
      cache.set(key, { meta, analyzers });
      if (global.VWallCatalog) {
        global.VWallCatalog.indexFromProbe(item, meta, analyzers);
      }
      return { meta, analyzers };
    })();

    inFlight.set(key, p);
    try {
      return await p;
    } finally {
      inFlight.delete(key);
    }
  }

  async function probeMany(items, onDone) {
    const q = [...items];
    const workers = Array.from({ length: CLUSTER }, async () => {
      while (q.length) {
        const item = q.shift();
        if (!item) break;
        try {
          const r = await probeCached(item);
          onDone?.(item, r);
        } catch {
          onDone?.(item, null);
        }
      }
    });
    await Promise.all(workers);
  }

  global.VWallProbePool = { probeCached, probeMany, cache };
})(window);
