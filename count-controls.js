/**
 * Count slider + typed input + increments + personal presets (localStorage).
 */
(function (global) {
  const MIN = 10;
  const MAX = 20000;
  const PRESET_KEY = "vwallCountPresets";

  const BUILTIN = [
    { label: "250", value: 250 },
    { label: "500", value: 500 },
    { label: "1k", value: 1000 },
    { label: "2.5k", value: 2500 },
    { label: "5k", value: 5000 },
    { label: "10k", value: 10000 }
  ];

  function clamp(n) {
    const v = parseInt(n, 10);
    if (!Number.isFinite(v)) return MIN;
    return Math.min(MAX, Math.max(MIN, v));
  }

  function loadPersonal() {
    try {
      const raw = localStorage.getItem(PRESET_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter((p) => p && p.name && p.count) : [];
    } catch {
      return [];
    }
  }

  function savePersonal(list) {
    try {
      localStorage.setItem(PRESET_KEY, JSON.stringify(list));
    } catch {
      /* ignore */
    }
  }

  function initCountControls(onApply) {
    const slider = document.getElementById("countSlider");
    const input = document.getElementById("countInput");
    const presetSelect = document.getElementById("countPresetSelect");
    if (!slider || !input) return;

    let lastCount = clamp(slider.value);
    let applyTimer;

    function syncUi(v) {
      const c = clamp(v);
      slider.value = String(c);
      input.value = String(c);
      return c;
    }

    function scheduleApply(forcedExtend) {
      clearTimeout(applyTimer);
      applyTimer = setTimeout(() => {
        const c = clamp(input.value);
        const extend =
          forcedExtend === true ? true : forcedExtend === false ? false : c > lastCount;
        lastCount = c;
        onApply?.({ extendOnly: extend });
      }, 400);
    }

    function setCount(v, opts = {}) {
      const c = syncUi(v);
      lastCount = c;
      if (opts.apply !== false) {
        onApply?.({ extendOnly: opts.extendOnly ?? false, immediate: opts.immediate });
      }
    }

    function refreshPresetSelect() {
      if (!presetSelect) return;
      const personal = loadPersonal();
      presetSelect.innerHTML = '<option value="">My presets…</option>';
      for (const p of personal) {
        const opt = document.createElement("option");
        opt.value = String(p.count);
        opt.textContent = `${p.name} (${p.count})`;
        opt.dataset.name = p.name;
        presetSelect.appendChild(opt);
      }
    }

    slider.addEventListener("input", () => {
      syncUi(slider.value);
      scheduleApply();
    });

    input.addEventListener("change", () => {
      const c = syncUi(input.value);
      scheduleApply(c > lastCount);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const c = syncUi(input.value);
        lastCount = c;
        onApply?.({ extendOnly: false, immediate: true });
      }
    });

    document.querySelectorAll("[data-count-add]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const add = parseInt(btn.getAttribute("data-count-add"), 10) || 0;
        const c = clamp(parseInt(input.value, 10) + add);
        setCount(c, { extendOnly: true });
        scheduleApply(true);
      });
    });

    document.querySelectorAll("[data-count-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = parseInt(btn.getAttribute("data-count-preset"), 10);
        setCount(v, { extendOnly: v > lastCount });
        scheduleApply(v > lastCount);
      });
    });

    presetSelect?.addEventListener("change", () => {
      const v = presetSelect.value;
      if (!v) return;
      const num = parseInt(v, 10);
      setCount(num, { extendOnly: num > lastCount });
      scheduleApply(num > lastCount);
      presetSelect.value = "";
    });

    document.getElementById("countPresetSave")?.addEventListener("click", () => {
      const c = clamp(input.value);
      const name = prompt("Preset name for count " + c + ":", String(c));
      if (!name?.trim()) return;
      const personal = loadPersonal().filter((p) => p.name !== name.trim());
      personal.push({ name: name.trim(), count: c });
      personal.sort((a, b) => a.count - b.count);
      savePersonal(personal);
      refreshPresetSelect();
      presetSelect.value = String(c);
    });

    refreshPresetSelect();
    syncUi(slider.value);
    lastCount = clamp(slider.value);

    global.VWallCount = { clamp, setCount, getCount: () => clamp(input.value), MIN, MAX };
  }

  global.VWallCountPresets = { BUILTIN, loadPersonal, savePersonal, initCountControls };
})(window);
