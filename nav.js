/**
 * Mobile navigation — controls sheet, backdrop, safe-area, body scroll lock.
 */
(function (global) {
  const SHEET_KEY = "vwallSheetOpen";

  function isMobile() {
    return global.matchMedia("(max-width: 899px)").matches;
  }

  function panel() {
    return document.getElementById("controlPanel");
  }

  function backdrop() {
    return document.getElementById("sheetBackdrop");
  }

  function setSheetOpen(open) {
    const p = panel();
    const b = backdrop();
    const btn = document.getElementById("menuBtn");
    if (!p) return;

    p.classList.toggle("open", open);
    p.setAttribute("aria-hidden", open ? "false" : "true");
    b?.classList.toggle("open", open);
    document.body.classList.toggle("sheet-open", open);
    if (btn) {
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.textContent = open ? "Close" : "Controls";
    }
    try {
      localStorage.setItem(SHEET_KEY, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  function toggleSheet() {
    const p = panel();
    if (!p) return;
    setSheetOpen(!p.classList.contains("open"));
  }

  function closeSheet() {
    if (isMobile()) setSheetOpen(false);
  }

  function initNav() {
    const menuBtn = document.getElementById("menuBtn");
    const closeBtn = document.getElementById("sheetClose");
    const b = backdrop();

    menuBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSheet();
    });

    closeBtn?.addEventListener("click", () => setSheetOpen(false));
    b?.addEventListener("click", () => setSheetOpen(false));

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeSheet();
    });

    global.matchMedia("(max-width: 899px)").addEventListener("change", (mq) => {
      if (!mq.matches) setSheetOpen(false);
    });

    const p = panel();
    if (isMobile()) {
      setSheetOpen(localStorage.getItem(SHEET_KEY) === "1");
    } else {
      p?.classList.add("open");
      p?.setAttribute("aria-hidden", "false");
    }
  }

  global.VWallNav = { initNav, closeSheet, isMobile, setSheetOpen };
})(window);
