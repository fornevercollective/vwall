/**
 * Right-hand metrics panel — FPS, lazy-load progress, per-type buffer estimates.
 */
(function (global) {
  const wallMetrics = {
    fps: 0,
    memMB: 0,
    total: 0,
    loaded: 0,
    failed: 0,
    pending: 0,
    inFlight: 0,
    byType: { image: 0, gif: 0, video: 0, live: 0, gsplat: 0, audio: 0 },
    loadedByType: { image: 0, gif: 0, video: 0, live: 0, gsplat: 0, audio: 0 },
    bufferBytes: { video: 0, live: 0, gif: 0, audio: 0 },
    probePending: 0
  };

  const ids = {
    fps: "mFps",
    mem: "mMem",
    load: "mLoad",
    queue: "mQueue",
    types: "mTypes",
    buffer: "mBuffer",
    probe: "mProbe",
    cache: "mCache"
  };

  function fmtBytes(n) {
    if (!n) return "0";
    if (n < 1048576) return `${(n / 1024).toFixed(0)}K`;
    return `${(n / 1048576).toFixed(1)}M`;
  }

  function setHealth(el, fps, memMB) {
    if (!el) return;
    let color = "#c44";
    if (fps >= 50 && memMB < 800) color = "#4c4";
    else if (fps >= 28 && memMB < 1600) color = "#cc4";
    el.style.color = color;
    el.style.borderColor = color;
  }

  function render() {
    const m = wallMetrics;
    const pct = m.total ? Math.round((m.loaded / m.total) * 100) : 0;

    const el = (id) => document.getElementById(id);
    if (el(ids.fps)) el(ids.fps).textContent = `${m.fps} fps`;
    if (el(ids.mem)) el(ids.mem).textContent = m.memMB ? `${m.memMB} MB` : "—";
    if (el(ids.load)) el(ids.load).textContent = `${m.loaded}/${m.total} (${pct}%)`;
    if (el(ids.queue)) {
      el(ids.queue).textContent = `q ${m.pending} · ${m.inFlight} active · ${m.failed} fail`;
    }
    if (el(ids.types)) {
      const parts = ["image", "gif", "video", "live", "gsplat", "audio"]
        .filter((t) => m.byType[t])
        .map((t) => `${t.slice(0, 3)} ${m.loadedByType[t] || 0}/${m.byType[t]}`);
      el(ids.types).textContent = parts.join(" · ") || "—";
    }
    if (el(ids.buffer)) {
      el(ids.buffer).textContent =
        `vid ${fmtBytes(m.bufferBytes.video)} · live ${fmtBytes(m.bufferBytes.live)} · gif ${fmtBytes(m.bufferBytes.gif)} · aud ${fmtBytes(m.bufferBytes.audio)}`;
    }
    if (el(ids.probe)) {
      el(ids.probe).textContent = m.probePending ? `meta ${m.probePending} pending` : "meta ok";
    }
    if (el(ids.cache)) {
      const s = global.VWallSession?.stats;
      el(ids.cache).textContent = s
        ? `hit ${s.cacheHits} · reuse ${s.reusedNodes} · skip ${s.skippedProbes}`
        : "—";
    }

    setHealth(el(ids.fps), m.fps, m.memMB);
  }

  function resetCounts(total, byType) {
    wallMetrics.total = total;
    wallMetrics.loaded = 0;
    wallMetrics.failed = 0;
    wallMetrics.pending = total;
    wallMetrics.inFlight = 0;
    wallMetrics.byType = { ...byType };
    wallMetrics.loadedByType = { image: 0, gif: 0, video: 0, live: 0, gsplat: 0, audio: 0 };
    wallMetrics.bufferBytes = { video: 0, live: 0, gif: 0, audio: 0 };
    wallMetrics.probePending = 0;
    render();
  }

  function tickFrame() {
    wallMetrics.frameCount = (wallMetrics.frameCount || 0) + 1;
  }

  function tickFps() {
    const now = performance.now();
    if (!wallMetrics.lastFpsTime) wallMetrics.lastFpsTime = now;
    const dt = now - wallMetrics.lastFpsTime;
    if (dt >= 500) {
      wallMetrics.fps = Math.round((wallMetrics.frameCount || 0) / (dt / 1000));
      wallMetrics.frameCount = 0;
      wallMetrics.lastFpsTime = now;
    }
    if (performance.memory) {
      wallMetrics.memMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
    }
    render();
  }

  function setMetricsCollapsed(collapsed) {
    const panel = document.getElementById("metricsPanel");
    const toggle = document.getElementById("perf");
    const inner = document.getElementById("metricsCollapse");
    if (!panel) return;

    panel.classList.toggle("collapsed", collapsed);
    panel.hidden = collapsed;
    panel.setAttribute("aria-hidden", collapsed ? "true" : "false");
    if (toggle) {
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      toggle.title = collapsed ? "Show metrics panel" : "Hide metrics panel";
    }
    if (inner) {
      inner.textContent = collapsed ? "▸" : "▾";
      inner.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }

    try {
      localStorage.setItem("vwallMetricsCollapsed", collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  function toggleMetricsPanel() {
    const panel = document.getElementById("metricsPanel");
    if (!panel) return;
    setMetricsCollapsed(!panel.classList.contains("collapsed"));
  }

  function initMetricsPanelToggle() {
    const panel = document.getElementById("metricsPanel");
    if (!panel) return;

    const stored = localStorage.getItem("vwallMetricsCollapsed");
    const collapsed = stored === "1";
    setMetricsCollapsed(collapsed);

    document.getElementById("perf")?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMetricsPanel();
    });

    document.getElementById("metricsCollapse")?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMetricsPanel();
    });
  }

  global.VWallMetrics = {
    wallMetrics,
    resetCounts,
    render,
    tickFrame,
    tickFps,
    setMetricsCollapsed,
    toggleMetricsPanel,
    addBuffer(type, bytes) {
      if (wallMetrics.bufferBytes[type] != null && bytes) {
        wallMetrics.bufferBytes[type] += bytes;
      }
    }
  };

  setInterval(tickFps, 500);
  initMetricsPanelToggle();
})(window);
