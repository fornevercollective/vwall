/**
 * Desktop mosaic mount waves + segmented thumbnail prefetch (FCFS queues).
 */
(function (global) {
  let mountGen = 0;
  let lazyFeedGen = 0;
  let lazyFeedTimer = null;
  let lazyFeedBuffer = [];

  function isDesktopCanvas() {
    return !(global.VWallScroll?.useScrollWall?.());
  }

  function tierConfig() {
    const tier = global.VWallPerfGuard?.getTier?.() ?? 0;
    if (tier >= 2) return { wave: 20, waveMs: 200, lazy: 6, lazyMs: 160 };
    if (tier >= 1) return { wave: 32, waveMs: 140, lazy: 10, lazyMs: 120 };
    return { wave: 52, waveMs: 95, lazy: 18, lazyMs: 90 };
  }

  function flowOrder(prepared, gridMode) {
    const tagged = prepared.map((p) => ({
      ...p,
      dist: p.pos.bx * p.pos.bx + p.pos.by * p.pos.by
    }));
    tagged.sort((a, b) => {
      if (gridMode) {
        if (a.pos.by !== b.pos.by) return a.pos.by - b.pos.by;
        return a.pos.bx - b.pos.bx;
      }
      return a.dist - b.dist;
    });
    return tagged;
  }

  /** Index order FCFS (“rolling shutter / classic linear ingest”). */
  function flowOrderFifo(prepared) {
    return [...prepared].sort((a, b) => a.i - b.i);
  }

  /** @param {'fifo'|'spatial'} mountOrder */
  function orderPreparedForMount(prepared, gridMode, mountOrder) {
    return mountOrder === "spatial"
      ? flowOrder(prepared, gridMode)
      : flowOrderFifo(prepared);
  }

  function cancel() {
    mountGen++;
    lazyFeedGen++;
    if (lazyFeedTimer) {
      clearTimeout(lazyFeedTimer);
      lazyFeedTimer = null;
    }
    lazyFeedBuffer = [];
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function mountInWaves(prepared, mountOne, gridMode, opts = {}) {
    const mountOrder =
      opts.mountOrder ??
      global.VWallLadder?.ORDER_FIFO ??
      "fifo";
    const gen = ++mountGen;
    const { wave, waveMs } = tierConfig();
    const ordered = orderPreparedForMount(prepared, gridMode, mountOrder);
    const total = ordered.length;
    for (let i = 0; i < total; i += wave) {
      if (gen !== mountGen) return;
      const chunk = ordered.slice(i, i + wave);
      for (const item of chunk) {
        mountOne(item, { fadeIn: true });
      }
      global.onStreamMountWave?.({
        done: Math.min(i + chunk.length, total),
        total,
        wave: chunk.length
      });
      if (i + wave < total) await delay(waveMs);
    }
  }

  /** @typedef {(chunk: unknown[], lazyFeedGeneration: number) => void} PushChunk */

  /** Shared pump for chunked FCFS prefetch (preserves parity with buffers already sipping). */
  function thumbFeedPump(pushChunk, gen) {
    if (lazyFeedGen !== gen) return;
    const { lazy, lazyMs } = tierConfig();
    const chunk = lazyFeedBuffer.splice(0, lazy);
    if (chunk.length) pushChunk(chunk, gen);
    if (lazyFeedBuffer.length) lazyFeedTimer = setTimeout(() => thumbFeedPump(pushChunk, gen), lazyMs);
    else lazyFeedTimer = null;
  }

  /** @param append Concatenate pending thumbs without resetting buffers that are still hydrating */
  function startLazyFeed(gen, entries, pushChunk, append = false) {
    lazyFeedGen = gen;
    const incoming = [...(entries || [])];

    if (append && incoming.length && lazyFeedBuffer.length) {
      lazyFeedBuffer.push(...incoming);
      if (!lazyFeedTimer) thumbFeedPump(pushChunk, gen);
      return;
    }

    if (lazyFeedTimer) {
      clearTimeout(lazyFeedTimer);
      lazyFeedTimer = null;
    }
    lazyFeedBuffer = incoming;
    thumbFeedPump(pushChunk, gen);
  }

  global.VWallStreamLoad = {
    isDesktopCanvas,
    flowOrder,
    flowOrderFifo,
    orderPreparedForMount,
    cancel,
    mountInWaves,
    startLazyFeed
  };
})(window);
