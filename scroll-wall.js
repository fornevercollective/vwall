/**
 * Mobile scroll wall — 2D infinite scroll, genre rail, inline preview (no drawer).
 */
(function (global) {
  const TILE = 92;
  const EDGE_PX = 280;
  let activeGenre = null;
  let scrollExtendLock = false;
  let selectedKey = null;
  let genreRailShellReady = false;
  let genreRailCollapsed = false;
  let inlineDetailsOpen = false;
  let pullRefreshBusy = false;

  try {
    genreRailCollapsed = localStorage.getItem("vwallGenreRailCollapsed") === "1";
  } catch {
    genreRailCollapsed = false;
  }

  function updateGenreRailSummary() {
    const el = document.getElementById("genreRailSummary");
    if (el) el.textContent = activeGenre || "All";
  }

  function updateGenreRailCollapsed() {
    document.body.classList.toggle("genre-rail-collapsed", genreRailCollapsed);
    const toggle = document.getElementById("genreRailToggle");
    if (toggle) {
      toggle.setAttribute("aria-expanded", genreRailCollapsed ? "false" : "true");
      toggle.title = genreRailCollapsed ? "Show genre tags" : "Hide genre tags";
      const chev = toggle.querySelector(".genre-rail-chevron");
      if (chev) chev.textContent = genreRailCollapsed ? "▸" : "▾";
    }
  }

  function ensureGenreRailShell() {
    if (genreRailShellReady) return;
    genreRailShellReady = true;
    document.getElementById("genreRailToggle")?.addEventListener("click", () => {
      genreRailCollapsed = !genreRailCollapsed;
      try {
        localStorage.setItem("vwallGenreRailCollapsed", genreRailCollapsed ? "1" : "0");
      } catch {
        /* ignore */
      }
      updateGenreRailCollapsed();
    });
    updateGenreRailCollapsed();
    updateGenreRailSummary();
  }

  /** Mobile scroll-wall when narrow OR vertically short (landscape phones / squat windows). */
  const SCROLL_WALL_MQ =
    "(max-width: 899px), (max-height: 620px)";
  function useScrollWall() {
    return global.matchMedia(SCROLL_WALL_MQ).matches;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function previewMediaHtml(data) {
    const url = escapeHtml(data.url);
    const mt = data.mediaType || "image";
    if (mt === "audio") return `<audio controls src="${url}" crossorigin="anonymous" playsinline></audio>`;
    if (mt === "video" || mt === "live") {
      return `<video id="inlinePreviewVideo" controls playsinline src="${url}" crossorigin="anonymous"></video>`;
    }
    if (mt === "gsplat") return `<p class="hint">Open in a Gaussian splat viewer.</p>`;
    return `<img src="${url}" alt="" crossorigin="anonymous" />`;
  }

  function destroyInlinePlayback() {
    const v = document.getElementById("inlinePreviewVideo");
    if (v?._hls) {
      v._hls.destroy();
      v._hls = null;
    }
  }

  function openInlinePreview(data) {
    const panel = document.getElementById("inlinePreview");
    if (!panel) return;
    selectedKey = data.url;
    const mt = data.mediaType || "image";

    destroyInlinePlayback();
    document.body.classList.add("preview-open");
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    panel.innerHTML = `
      <button type="button" class="inline-preview-close" aria-label="Close preview">↓</button>
      <div class="inline-preview-media">${previewMediaHtml(data)}</div>
      <div class="inline-preview-meta">
        ${data.title ? `<p class="preview-title">${escapeHtml(data.title)}</p>` : ""}
        <a class="open-link preview-open-original" href="${escapeHtml(data.url)}" target="_blank" rel="noopener">Open original</a>
        <button type="button" class="inline-preview-details-toggle" aria-expanded="false">Technical details</button>
        <div class="inline-preview-details" hidden>
          <div id="inlinePreviewMeta" class="preview-meta-body"></div>
        </div>
      </div>
    `;

    panel.querySelector(".inline-preview-close")?.addEventListener("click", closeInlinePreview);
    panel.querySelector(".inline-preview-details-toggle")?.addEventListener("click", () => {
      setInlineDetailsOpen(!inlineDetailsOpen);
    });
    setInlineDetailsOpen(false);

    if (mt === "live" && data.url.includes(".m3u8") && global.Hls?.isSupported()) {
      const video = document.getElementById("inlinePreviewVideo");
      const hls = new Hls();
      hls.loadSource(data.url);
      hls.attachMedia(video);
      video._hls = hls;
    }

    if (!data.probeMeta && global.VWallProbePool) {
      global.VWallProbePool.probeCached({
        url: data.url,
        mediaType: mt
      }).then((r) => {
        data.probeMeta = r?.meta;
        const el = document.getElementById("inlinePreviewMeta");
        if (el && selectedKey === data.url && global.VWallMeta) {
          el.innerHTML = global.VWallMeta.formatMetaRows(r.meta, mt);
        }
      });
    } else if (data.probeMeta && global.VWallMeta) {
      const el = document.getElementById("inlinePreviewMeta");
      if (el) el.innerHTML = global.VWallMeta.formatMetaRows(data.probeMeta, mt);
    }
  }

  function closeInlinePreview() {
    destroyInlinePlayback();
    document.body.classList.remove("preview-open");
    const panel = document.getElementById("inlinePreview");
    panel?.classList.remove("open");
    panel?.setAttribute("aria-hidden", "true");
    selectedKey = null;
  }

  function setInlineDetailsOpen(open) {
    const panel = document.getElementById("inlinePreview");
    if (!panel) return;
    inlineDetailsOpen = open;
    const details = panel.querySelector(".inline-preview-details");
    const toggle = panel.querySelector(".inline-preview-details-toggle");
    if (details) details.hidden = !open;
    if (toggle) {
      toggle.textContent = open ? "Hide technical details" : "Technical details";
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }
  }

  function entryPayload(e) {
    const n = e.node;
    return {
      url: e.item.url,
      title: e.item.title,
      snippet: e.item.snippet,
      mediaType: e.item.mediaType,
      clusterLabel: n?.clusterLabel || e.item.genre || "",
      probeMeta: e.probeMeta || n?.probeMeta,
      thumbUrl: e.item.thumbUrl,
      mime: e.item.mime
    };
  }

  function buildTile(e) {
    const item = e.item;
    const mt = item.mediaType;
    const meta = global.MEDIA_META?.[mt] || { label: "?", color: "#444" };
    const genre = e.node?.clusterLabel || e.item.genre || "other";
    const thumb = item.thumbUrl || (["image", "gif"].includes(mt) ? item.url : null);

    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "scroll-tile";
    tile.dataset.key = global.VWallSession?.key(item) || item.url;
    tile.dataset.genre = genre;
    tile.style.setProperty("--tile-accent", meta.color);

    if (thumb) {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = item.title || "";
      img.src = thumb;
      img.crossOrigin = "anonymous";
      tile.appendChild(img);
    } else {
      const ph = document.createElement("span");
      ph.className = "scroll-tile-ph";
      ph.textContent = meta.label;
      tile.appendChild(ph);
    }

    const badge = document.createElement("span");
    badge.className = "scroll-tile-badge";
    badge.textContent = meta.label;
    tile.appendChild(badge);

    tile.addEventListener("click", () => {
      document.querySelectorAll(".scroll-tile.selected").forEach((t) => t.classList.remove("selected"));
      tile.classList.add("selected");
      openInlinePreview(entryPayload(e));
    });

    return tile;
  }

  function isGridLayout() {
    return global.VWallLayout?.isGridMode?.() === true;
  }

  function sortByGenre(entries) {
    return [...entries].sort((a, b) => {
      const ga = a.node?.clusterLabel || a.item.genre || "";
      const gb = b.node?.clusterLabel || b.item.genre || "";
      return ga.localeCompare(gb);
    });
  }

  function mountFlatGrid(wall, items, layoutClass) {
    const grid = document.createElement("div");
    grid.className = `scroll-grid ${layoutClass}`;
    for (const e of items) {
      grid.appendChild(buildTile(e));
    }
    wall.appendChild(grid);
    return grid;
  }

  function mount(entries) {
    const wall = document.getElementById("scrollWall");
    const viewport = document.getElementById("scrollViewport");
    if (!wall || !viewport) return;

    document.body.classList.add("scroll-mode");
    closeInlinePreview();

    const filtered = activeGenre
      ? entries.filter((e) => (e.node?.clusterLabel || e.item.genre) === activeGenre)
      : entries;

    const gridLayout = isGridLayout();
    document.body.classList.toggle("scroll-layout-grid", gridLayout);
    document.body.classList.toggle("scroll-layout-stream", !gridLayout);

    wall.innerHTML = "";
    wall.className = "scroll-wall";
    wall.classList.add(gridLayout ? "scroll-wall-grid" : "scroll-wall-stream");

    const sorted = sortByGenre(filtered);

    if (gridLayout) {
      mountFlatGrid(wall, sorted, "scroll-grid-freeform");
      const cols = Math.max(5, Math.ceil(Math.sqrt(sorted.length * 1.6)));
      const rows = Math.ceil(sorted.length / cols) || 1;
      wall.style.minWidth = `${cols * TILE + 24}px`;
      wall.style.minHeight = `${rows * TILE + 24}px`;
    } else {
      mountFlatGrid(wall, sorted, "scroll-grid-stream");
      wall.style.minWidth = "";
      wall.style.minHeight = "";
    }

    requestAnimationFrame(() => observeScrollEdges(viewport));
  }

  function scrollToGenre(label) {
    const wall = document.getElementById("scrollWall");
    if (!wall || !label) return;
    for (const tile of wall.querySelectorAll(".scroll-tile")) {
      if (tile.dataset.genre === label) {
        tile.scrollIntoView({ behavior: "smooth", block: "start" });
        break;
      }
    }
  }

  function observeScrollEdges(viewport) {
    viewport.onscroll = () => {
      if (scrollExtendLock) return;
      const { scrollTop, scrollLeft, clientHeight, clientWidth, scrollHeight, scrollWidth } =
        viewport;
      const nearBottom = scrollTop + clientHeight >= scrollHeight - EDGE_PX;
      const nearRight = scrollLeft + clientWidth >= scrollWidth - EDGE_PX;
      if (nearBottom || nearRight) {
        scrollExtendLock = true;
        global.onScrollWallExtend?.().finally(() => {
          setTimeout(() => {
            scrollExtendLock = false;
          }, 800);
        });
      }
    };
  }

  function pullRefreshLabel(distance) {
    if (pullRefreshBusy) return "Refreshing…";
    return distance >= 88 ? "Release to refresh" : "Pull to refresh";
  }

  function ensurePullRefreshHint(viewport) {
    if (!viewport || viewport.querySelector(".pull-refresh-hint")) return;
    const hint = document.createElement("div");
    hint.className = "pull-refresh-hint";
    hint.textContent = "Pull to refresh";
    viewport.prepend(hint);
  }

  function resetPullRefreshVisual(vp, hintText) {
    const viewport = vp || document.getElementById("scrollViewport");
    if (!viewport) return;
    viewport.classList.remove("pull-refresh-dragging");
    viewport.classList.remove("pull-refresh-active", "pull-refresh-armed");
    viewport.style.removeProperty("--pull-distance");
    const hint = viewport.querySelector(".pull-refresh-hint");
    if (hint && hintText != null) hint.textContent = hintText;
    else if (hint) hint.textContent = pullRefreshBusy ? "Refreshing…" : "Pull to refresh";
  }

  function refreshCurrentSearch() {
    if (pullRefreshBusy) return;
    pullRefreshBusy = true;
    const input = document.getElementById("search");
    const q = input?.value?.trim() || global.VWallSession?.lastQuery || "";
    if (q && input) input.value = q;
    const done = () => {
      pullRefreshBusy = false;
      resetPullRefreshVisual(null, "Pull to refresh");
    };
    if (q && typeof global.runSearch === "function") {
      Promise.resolve(global.runSearch()).finally(done);
      return;
    }
    global.location.reload();
  }

  function initPullToRefresh() {
    const viewport = document.getElementById("scrollViewport");
    if (!viewport) return;
    ensurePullRefreshHint(viewport);

    let active = false;
    let startY = 0;
    let distance = 0;
    let armed = false;

    viewport.addEventListener("touchstart", (e) => {
      if (!useScrollWall() || pullRefreshBusy) return;
      if (viewport.scrollTop > 0) return;
      if (!e.touches || e.touches.length !== 1) return;
      active = true;
      armed = false;
      distance = 0;
      startY = e.touches[0].clientY;
    }, { passive: true });

    viewport.addEventListener("touchmove", (e) => {
      if (!active || pullRefreshBusy) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) {
        if (
          viewport.classList.contains("pull-refresh-active") ||
          viewport.style.getPropertyValue("--pull-distance")
        ) {
          armed = false;
          distance = 0;
          resetPullRefreshVisual(viewport);
        }
        return;
      }
      distance = Math.min(120, dy * 0.65);
      armed = distance >= 88;
      viewport.classList.add("pull-refresh-dragging", "pull-refresh-active");
      viewport.classList.toggle("pull-refresh-armed", armed);
      viewport.style.setProperty("--pull-distance", `${distance}px`);
      const hint = viewport.querySelector(".pull-refresh-hint");
      if (hint) hint.textContent = pullRefreshLabel(distance);
      e.preventDefault();
    }, { passive: false });

    const endGesture = ({ mayRefresh }) => {
      viewport.classList.remove("pull-refresh-dragging");
      const shouldRefresh = mayRefresh && armed;
      armed = false;
      active = false;
      distance = 0;

      if (shouldRefresh && !pullRefreshBusy) {
        resetPullRefreshVisual(viewport, "Refreshing…");
        refreshCurrentSearch();
        return;
      }
      resetPullRefreshVisual(viewport);
    };

    viewport.addEventListener("touchend", () => {
      if (!active) return;
      endGesture({ mayRefresh: true });
    }, { passive: true });

    viewport.addEventListener("touchcancel", () => {
      if (!active) return;
      endGesture({ mayRefresh: false });
    }, { passive: true });
  }

  function initGenreRail(labels, onGenreChange) {
    ensureGenreRailShell();
    const rail = document.getElementById("genreRail");
    if (!rail) return;

    const render = () => {
      rail.innerHTML = "";
      const all = document.createElement("button");
      all.type = "button";
      all.className = "genre-chip" + (activeGenre === null ? " active" : "");
      all.textContent = "All";
      all.addEventListener("click", () => {
        activeGenre = null;
        render();
        onGenreChange();
      });
      rail.appendChild(all);

      for (const label of labels) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "genre-chip" + (activeGenre === label ? " active" : "");
        chip.textContent = label;
        chip.title = label;
        chip.addEventListener("click", () => {
          activeGenre = activeGenre === label ? null : label;
          render();
          onGenreChange();
          if (activeGenre) scrollToGenre(activeGenre);
        });
        rail.appendChild(chip);
      }
      updateGenreRailSummary();
    };

    render();
  }

  function setActiveGenre(g) {
    activeGenre = g;
  }

  function init() {
    ensureGenreRailShell();
    initPullToRefresh();
    global.matchMedia(SCROLL_WALL_MQ).addEventListener("change", () => {
      document.body.classList.toggle("scroll-mode", useScrollWall());
      if (!useScrollWall()) closeInlinePreview();
    });
    document.body.classList.toggle("scroll-mode", useScrollWall());
  }

  global.VWallScroll = {
    SCROLL_WALL_MQ,
    useScrollWall,
    mount,
    init,
    initGenreRail,
    openInlinePreview,
    closeInlinePreview,
    setActiveGenre,
    getActiveGenre: () => activeGenre,
    scrollToGenre
  };

  init();
})(window);
