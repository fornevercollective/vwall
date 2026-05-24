/**
 * Adaptive performance — detects overload (FPS / memory / frame time) and throttles
 * count, lazy load, and animations. Turbo override disables limits for power users.
 */
(function (global) {
  const OVERRIDE_KEY = "vwallPerfOverride";
  const TIERS = [
    {
      id: 0,
      label: "full",
      countCap: Infinity,
      lazy: 24,
      probe: 4,
      drift: 15,
      animate: true,
      autoBlurOff: false,
      extendBump: 250
    },
    {
      id: 1,
      label: "reduced",
      countCap: 450,
      lazy: 10,
      probe: 2,
      drift: 4,
      animate: true,
      autoBlurOff: true,
      extendBump: 100
    },
    {
      id: 2,
      label: "critical",
      countCap: 120,
      lazy: 4,
      probe: 1,
      drift: 0,
      animate: false,
      autoBlurOff: true,
      extendBump: 40
    }
  ];

  let tier = 0;
  let override = false;
  let lowStressTicks = 0;
  let highStressTicks = 0;
  let lastFrameMs = 16;
  let frameSpikeStreak = 0;
  let applying = false;

  try {
    override = localStorage.getItem(OVERRIDE_KEY) === "1";
  } catch {
    override = false;
  }

  function currentTier() {
    return TIERS[override ? 0 : tier];
  }

  function capCount(userCount) {
    const cap = currentTier().countCap;
    const n = parseInt(userCount, 10) || 0;
    if (!Number.isFinite(cap)) return n;
    return Math.min(n, cap);
  }

  function recordFrameDelta() {
    const now = performance.now();
    if (!recordFrameDelta.last) recordFrameDelta.last = now;
    const dt = now - recordFrameDelta.last;
    recordFrameDelta.last = now;
    lastFrameMs = dt;
    if (dt > 42) frameSpikeStreak = Math.min(12, frameSpikeStreak + 1);
    else frameSpikeStreak = Math.max(0, frameSpikeStreak - 1);
  }

  function evaluateStress() {
    if (override) return { stressed: false, critical: false };

    const m = global.VWallMetrics?.wallMetrics || {};
    const fps = m.fps ?? 60;
    const mem = m.memMB ?? 0;
    const total = m.total ?? 0;
    const loaded = m.loaded ?? 0;
    const pending = m.pending ?? 0;
    const inFlight = m.inFlight ?? 0;

    const critical =
      fps > 0 && fps < 16 ||
      mem > 2200 ||
      (frameSpikeStreak >= 6 && loaded > 80);

    const stressed =
      critical ||
      (fps > 0 && fps < 26 && loaded > 40) ||
      mem > 1500 ||
      (pending > 120 && inFlight >= 8 && fps < 32) ||
      frameSpikeStreak >= 4;

    return { stressed, critical, fps, mem, total, loaded };
  }

  function setTier(next, reason) {
    if (next === tier || override) return;
    tier = Math.max(0, Math.min(2, next));
    document.body.classList.toggle("perf-tier-reduced", tier === 1);
    document.body.classList.toggle("perf-tier-critical", tier === 2);
    document.body.classList.toggle("perf-guard-active", tier > 0);
    updateUi();
    global.onPerfTierChange?.(tier, currentTier(), reason);
  }

  function tickGuard() {
    if (override) {
      updateUi();
      return;
    }

    const { stressed, critical } = evaluateStress();

    if (critical || stressed) {
      highStressTicks++;
      lowStressTicks = 0;
    } else {
      lowStressTicks++;
      highStressTicks = Math.max(0, highStressTicks - 1);
    }

    if (highStressTicks >= 2) {
      if (critical) setTier(Math.min(2, tier + 1), "critical");
      else if (tier < 1) setTier(1, "stressed");
      highStressTicks = 0;
    }

    if (tier > 0 && lowStressTicks >= 8) {
      setTier(tier - 1, "recovered");
      lowStressTicks = 0;
    }

    updateUi();
  }

  function updateUi() {
    const btn = document.getElementById("perfOverrideBtn");
    const status = document.getElementById("mPerfGuard");
    const t = currentTier();

    if (btn) {
      btn.textContent = override ? "Turbo: ON" : "Turbo: OFF";
      btn.classList.toggle("active", override);
      btn.title = override
        ? "Auto limits off — you may see lag on heavy loads"
        : "Enable full count & motion even when the machine is struggling";
    }

    if (status) {
      if (override) {
        status.textContent = "turbo · no auto limits";
      } else if (tier === 0) {
        status.textContent = "auto · full quality";
      } else {
        status.textContent = `auto · ${t.label} (≤${t.countCap} items)`;
      }
    }

    const perf = document.getElementById("perf");
    if (perf && !override && tier > 0) {
      perf.dataset.perfTier = t.label;
    } else if (perf) {
      delete perf.dataset.perfTier;
    }
  }

  function setOverride(on) {
    override = !!on;
    try {
      localStorage.setItem(OVERRIDE_KEY, override ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (override) {
      tier = 0;
      document.body.classList.remove("perf-tier-reduced", "perf-tier-critical");
      document.body.classList.remove("perf-guard-active");
    }
    document.body.classList.toggle("perf-turbo", override);
    updateUi();
    global.onPerfTierChange?.(tier, currentTier(), override ? "turbo-on" : "turbo-off");
  }

  function isOverride() {
    return override;
  }

  function initPerfGuard() {
    document.getElementById("perfOverrideBtn")?.addEventListener("click", () => {
      setOverride(!override);
    });
    document.body.classList.toggle("perf-turbo", override);
    document.body.classList.toggle("perf-guard-active", tier > 0 && !override);
    updateUi();
    setInterval(tickGuard, 500);
  }

  global.VWallPerfGuard = {
    initPerfGuard,
    capCount,
    currentTier,
    getLazyConcurrency: () => currentTier().lazy,
    getProbeConcurrency: () => currentTier().probe,
    getDrift: (gridMode) => (gridMode ? Math.min(3, currentTier().drift) : currentTier().drift),
    shouldAnimateNodes: () => currentTier().animate,
    shouldAutoDisableBlur: () => !override && currentTier().autoBlurOff,
    getExtendBump: () => currentTier().extendBump,
    recordFrameDelta,
    isOverride,
    setOverride,
    getTier: () => tier
  };

  initPerfGuard();
})(window);
