// ==========================
// GPU ENGINE (PixiJS)
// ==========================
const canvas = document.getElementById("c");
const app = new PIXI.Application({
  view: canvas,
  resizeTo: window,
  backgroundColor: 0x0b0b0b,
  antialias: true
});

// ==========================
// WORLD CONTAINER
// ==========================
const world = new PIXI.Container();
app.stage.addChild(world);
world.position.set(innerWidth / 2, innerHeight / 2);

// ==========================
// STATE
// ==========================
let nodes = [];
let blurEnabled = false;
let blendEnabled = false;
const LAYOUT_MODE_KEY = "vwallLayoutGrid";

function loadGridModePreference() {
  try {
    const stored = localStorage.getItem(LAYOUT_MODE_KEY);
    if (stored === "0") return false;
    if (stored === "1") return true;
  } catch {
    /* ignore */
  }
  return true; // default: checkerboard
}

function saveGridModePreference() {
  try {
    localStorage.setItem(LAYOUT_MODE_KEY, gridMode ? "1" : "0");
  } catch {
    /* ignore */
  }
}

let gridMode = loadGridModePreference(); // false = sphere, true = checkerboard

window.VWallLayout = {
  isGridMode: () => gridMode,
  isSphereMode: () => !gridMode
};

function syncLayoutBtn() {
  const btn = document.getElementById("layoutBtn");
  if (!btn) return;
  btn.innerText = gridMode ? "Checkerboard" : "Sphere";
  btn.classList.toggle("active", gridMode);
  btn.title = gridMode
    ? "Checkerboard layout (2D grid) — click for sphere"
    : "Sphere layout — click for checkerboard";
}
let dragging = false;
let last = { x: 0, y: 0 };
let selected = null;
let seed = 0;

const CELL_SIZE = 90;
const TILE_SPRITE_PX = 80;
const LOD_DETAIL_ENTER_PX = 148;
const LOD_DETAIL_EXIT_PX = 118;
const MAX_WALL_ITEMS = 20000;
const LAZY_CONCURRENCY_MAX = 24;

function lazyConcurrency() {
  return window.VWallPerfGuard?.getLazyConcurrency?.() ?? LAZY_CONCURRENCY_MAX;
}
const API_CACHE_TTL_MS = 120000;
const apiResultCache = new Map();

const clusterLabels = [
  "nature","faces","objects","abstract","urban","texture","geometry",
  "organic","minimal","vibrant","dark","architectural","water","sky",
  "animals","food","interiors","night","patterns","macro","retro",
  "futuristic","art","technology","travel","sports","fashion","science"
];
const NUM_CLUSTERS = clusterLabels.length;

// ==========================
// MEDIA TYPES (filter + sort)
// ==========================
const MEDIA_TYPES = ["image", "gif", "video", "live", "gsplat", "audio"];

const MEDIA_META = {
  image: { label: "IMG", color: "#3366aa", order: 0, chip: "#3366aa" },
  gif: { label: "GIF", color: "#aa6633", order: 1, chip: "#aa6633" },
  video: { label: "VID", color: "#aa3366", order: 2, chip: "#aa3366" },
  live: { label: "LIVE", color: "#cc3333", order: 3, chip: "#cc3333" },
  gsplat: { label: "3D", color: "#44aa66", order: 4, chip: "#44aa66" },
  audio: { label: "AUD", color: "#9966cc", order: 5, chip: "#9966cc" }
};

window.clusterLabels = clusterLabels;
window.MEDIA_META = MEDIA_META;

const activeMediaTypes = new Set(
  JSON.parse(localStorage.getItem("vwallMediaTypes") || "null") || MEDIA_TYPES
);

function saveMediaFilters() {
  localStorage.setItem("vwallMediaTypes", JSON.stringify([...activeMediaTypes]));
}

function classifyMedia(mime, url, title) {
  const u = (url || "").toLowerCase();
  const t = (title || "").toLowerCase();
  const m = (mime || "").toLowerCase();

  if (/\.(splat|ksplat|ply|spz)(\?|#|$)/i.test(u) || /\b(gaussian\s*splat|gsplat|3d\s*gaussian)\b/.test(t)) {
    return "gsplat";
  }
  if (/\.m3u8(\?|#|$)/i.test(u) || /\b(hls|live\s*stream)\b/.test(u + " " + t)) {
    return "live";
  }
  if (m === "image/gif" || /\.gif(\?|#|$)/i.test(u)) return "gif";
  if (m.startsWith("audio/") || /\.(mp3|ogg|wav|flac|m4a|opus|aac)(\?|#|$)/i.test(u)) return "audio";
  if (m.startsWith("video/") || /\.(mp4|webm|ogv|mov|mkv)(\?|#|$)/i.test(u)) return "video";
  if (m.startsWith("image/")) return "image";
  if (/\.(jpe?g|png|webp|avif)(\?|#|$)/i.test(u)) return "image";
  return "image";
}

function mediaItem(fields) {
  const {
    url,
    title,
    snippet,
    mime,
    mediaType,
    thumbUrl,
    source,
    provider,
    published,
    indexed_on,
    filetype,
    license,
    thumbMaxEdge,
    variantUrls
  } = fields;
  const mt = mediaType || classifyMedia(mime, url, title);
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* ignore */
  }

  /** @type {Record<string, unknown>} */
  const out = {
    url,
    title: title || "",
    snippet: snippet || "",
    mime: mime || "",
    mediaType: mt,
    thumbUrl: thumbUrl || null,
    source: source || "",
    provider: provider || "",
    host,
    published: published || indexed_on || "",
    indexed_on: indexed_on || "",
    filetype: filetype || "",
    license: license || ""
  };

  if (typeof thumbMaxEdge === "number" && Number.isFinite(thumbMaxEdge)) {
    out.thumbMaxEdge = thumbMaxEdge;
  }

  if (Array.isArray(variantUrls) && variantUrls.length) {
    const vs = variantUrls.filter((x) => x?.url && typeof x.url === "string").map((x) => ({
      ...(typeof x.id === "string"
        ? { id: x.id }
        : {}),
      ...(typeof x.role === "string"
        ? { role: x.role }
        : {}),
      url: String(x.url),
      ...(typeof x.maxEdge === "number"
        ? { maxEdge: x.maxEdge }
        : {}),
      ...(typeof x.bytesHint === "number"
        ? { bytesHint: x.bytesHint }
        : {})
    }));
    if (vs.length) out.variantUrls = vs;
  }

  return /** @type {any} */ (out);
}

function acceptsMediaType(mt) {
  return activeMediaTypes.has(mt);
}

function sortItemsByMedia(items) {
  if (window.VWallSort) return VWallSort.sortItems(items, null, MEDIA_META);
  return items;
}

function countByMedia(items) {
  const c = {};
  for (const t of MEDIA_TYPES) c[t] = 0;
  for (const it of items) c[it.mediaType] = (c[it.mediaType] || 0) + 1;
  return c;
}

// ==========================
// OPEN MEDIA SEARCH (no API keys)
// ==========================
const searchStatusEl = document.getElementById("searchStatus");
const searchBtn = document.getElementById("searchBtn");
let searchGen = 0;

function setSearchStatus(msg) {
  if (searchStatusEl) searchStatusEl.textContent = msg || "";
}

async function searchWikimedia(query, maxItems, searchQuery) {
  const results = [];
  let offset = 0;
  const q = searchQuery || query;

  while (results.length < maxItems * 3) {
    const params = new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: q,
      gsrnamespace: "6",
      gsrlimit: "50",
      prop: "imageinfo",
      iiprop: "url|mime|thumburl",
      iiurlwidth: "512",
      format: "json",
      origin: "*"
    });
    if (offset) params.set("gsroffset", String(offset));

    const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`);
    if (!res.ok) break;
    const data = await res.json();
    const pages = data.query?.pages;
    if (!pages) break;

    for (const page of Object.values(pages)) {
      const info = page.imageinfo?.[0];
      if (!info?.url) continue;
      const mime = info.mime || "";
      if (mime === "image/svg+xml") continue;

      const title = (page.title || "").replace(/^File:/, "");
      const mt = classifyMedia(mime, info.url, title);
      if (!acceptsMediaType(mt)) continue;

      const isStream = mt === "video" || mt === "live" || mt === "audio";
      results.push(mediaItem({
        url: info.url,
        thumbUrl: info.thumburl || (mt === "image" || mt === "gif" ? info.url : null),
        title,
        snippet: "Wikimedia Commons",
        mime,
        mediaType: mt,
        source: "wikimedia",
        ...(mt === "image" || mt === "gif"
          ? { thumbMaxEdge: 512 }
          : {})
      }));

      if (results.length >= maxItems) return results;
    }

    if (!data.continue?.gsroffset) break;
    offset = data.continue.gsroffset;
  }

  return results;
}

async function searchOpenverseImages(query, maxItems, opts = {}) {
  const results = [];
  const pageSize = 20;
  let page = 1;
  const maxPages = Math.min(60, Math.ceil(maxItems / pageSize) + 2);
  const source = opts.openverseSource;

  while (results.length < maxItems * 2 && page <= maxPages) {
    const params = new URLSearchParams({
      q: query,
      page: String(page),
      page_size: String(pageSize)
    });
    if (source) params.set("source", source);
    const url = `https://api.openverse.org/v1/images/?${params}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const data = await res.json();
    if (!data.results?.length) break;

    for (const item of data.results) {
      const imgUrl = item.url || item.thumbnail;
      if (!imgUrl) continue;
      const mime = item.filetype ? `image/${item.filetype}` : "";
      const mt = classifyMedia(mime, imgUrl, item.title || "");
      if (!acceptsMediaType(mt)) continue;

      const creator = item.creator || item.creator_name || "";
      results.push(mediaItem({
        url: imgUrl,
        thumbUrl: item.thumbnail || imgUrl,
        title: item.title || "",
        snippet: creator ? `${creator} · Openverse` : "Openverse",
        mime,
        mediaType: mt,
        source: "openverse",
        provider: item.provider || item.source || "openverse",
        published: item.creation_date || item.published_date || "",
        indexed_on: item.indexed_on || "",
        filetype: item.filetype || "",
        license: item.license || ""
      }));
      if (results.length >= maxItems) return results;
    }

    if (page >= (data.page_count || page)) break;
    page++;
  }

  return results;
}

async function searchOpenverseAudio(query, maxItems, opts = {}) {
  if (!acceptsMediaType("audio")) return [];

  const results = [];
  const pageSize = 20;
  let page = 1;
  const maxPages = Math.min(40, Math.ceil(maxItems / pageSize) + 2);
  const source = opts.openverseSource;

  while (results.length < maxItems && page <= maxPages) {
    const params = new URLSearchParams({
      q: query,
      page: String(page),
      page_size: String(pageSize)
    });
    if (source) params.set("source", source);
    const url = `https://api.openverse.org/v1/audio/?${params}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const data = await res.json();
    if (!data.results?.length) break;

    for (const item of data.results) {
      const audioUrl = item.url;
      if (!audioUrl) continue;
      results.push(mediaItem({
        url: audioUrl,
        thumbUrl: item.thumbnail || null,
        title: item.title || "",
        snippet: item.creator ? `${item.creator} · Openverse Audio` : "Openverse Audio",
        mime: item.filetype ? `audio/${item.filetype}` : "audio/mpeg",
        mediaType: "audio",
        source: "openverse",
        provider: item.provider || "openverse",
        indexed_on: item.indexed_on || "",
        filetype: item.filetype || "",
        license: item.license || ""
      }));
      if (results.length >= maxItems) return results;
    }

    if (page >= (data.page_count || page)) break;
    page++;
  }

  return results;
}

const SPECIAL_SEARCHES = {
  gsplat: (q) => `${q} (splat OR ply OR gaussian OR point cloud)`,
  live: (q) => `${q} (live stream OR m3u8 OR webm video)`,
  gif: (q) => `${q} animated gif`
};

async function searchArchiveOrg(siteHost, terms, maxItems) {
  const results = [];
  const parts = [`hostname:${siteHost}`];
  if (terms) parts.push(terms);
  parts.push("mediatype:(image OR movies OR audio OR etree)");
  const q = parts.join(" AND ");
  const rows = Math.min(80, Math.max(maxItems, 20));

  try {
    const params = new URLSearchParams({
      q,
      output: "json",
      rows: String(rows),
      page: "1"
    });
    params.append("fl[]", "identifier,title,description,mediatype");
    const res = await fetch(`https://archive.org/advancedsearch.php?${params}`);
    if (!res.ok) return results;
    const data = await res.json();
    const docs = data.response?.docs || [];

    for (const doc of docs) {
      const id = doc.identifier;
      if (!id) continue;
      const title = doc.title || id;
      const mt =
        doc.mediatype === "movies"
          ? "video"
          : doc.mediatype === "audio" || doc.mediatype === "etree"
            ? "audio"
            : "image";
      if (!acceptsMediaType(mt)) continue;

      const pageUrl = `https://archive.org/details/${id}`;
      const imgUrl = `https://archive.org/services/img/${encodeURIComponent(id)}`;
      const url = mt === "image" ? imgUrl : pageUrl;

      results.push(
        mediaItem({
          url,
          thumbUrl: mt === "image" ? imgUrl : null,
          title: Array.isArray(title) ? title[0] : title,
          snippet: `Internet Archive · ${siteHost}`,
          mime: mt === "image" ? "image/jpeg" : "",
          mediaType: mt,
          source: "archive.org",
          provider: "archive.org"
        })
      );
      if (results.length >= maxItems) break;
    }
  } catch (e) {
    console.warn("Archive.org search failed:", e);
  }

  return results;
}

function cacheKeyForFetch(q, limit, excludeSize, siteHost) {
  return `${q}|${limit}|${[...activeMediaTypes].sort().join(",")}|${excludeSize}|${siteHost || ""}`;
}

function parseSearch(raw) {
  if (window.VWallSearchQuery) return VWallSearchQuery.parseSiteSearchInput(raw);
  return { terms: (raw || "").trim(), siteHost: null, raw, scoped: false };
}

function matchesSite(item, siteHost) {
  if (!siteHost) return true;
  if (window.VWallSearchQuery) return VWallSearchQuery.itemMatchesSite(item, siteHost);
  return true;
}

async function fetchMediaResults(query, limit, opts = {}) {
  const parsed = opts.parsed || parseSearch(query);
  const q = window.VWallSearchQuery
    ? VWallSearchQuery.buildApiQuery(parsed)
    : (parsed.terms || query || "").trim();
  const siteHost = parsed.siteHost || opts.siteHost || null;

  if ((!q && !siteHost) || activeMediaTypes.size === 0) return [];

  const exclude = opts.exclude || new Set();
  const target = Math.min(limit, MAX_WALL_ITEMS);
  const ck = cacheKeyForFetch(q || siteHost, target, exclude.size, siteHost);
  const cached = apiResultCache.get(ck);
  if (cached && Date.now() - cached.t < API_CACHE_TTL_MS) {
    return cached.items.filter((it) => !exclude.has(`${it.mediaType}:${it.url}`));
  }

  const perSource = Math.ceil(target / Math.max(1, activeMediaTypes.size)) + 15;
  const ovSource =
    siteHost && window.VWallSearchQuery
      ? VWallSearchQuery.openverseSourceForHost(siteHost)
      : null;
  const ovOpts = ovSource ? { openverseSource: ovSource } : {};
  const batches = [];

  const useWikimedia =
    !siteHost ||
    (window.VWallSearchQuery && VWallSearchQuery.isWikimediaFamily(siteHost));

  if (useWikimedia) {
    batches.push(searchWikimedia(q, perSource));
  }

  if (activeMediaTypes.has("image") || activeMediaTypes.has("gif") || activeMediaTypes.has("video")) {
    batches.push(searchOpenverseImages(q, perSource, ovOpts));
  }
  if (activeMediaTypes.has("audio")) {
    batches.push(searchOpenverseAudio(q, perSource, ovOpts));
  }
  if (siteHost) {
    batches.push(searchArchiveOrg(siteHost, parsed.terms, perSource));
  }
  for (const type of ["gsplat", "live", "gif"]) {
    if (activeMediaTypes.has(type) && SPECIAL_SEARCHES[type] && useWikimedia) {
      batches.push(searchWikimedia(q, Math.ceil(perSource / 2), SPECIAL_SEARCHES[type](q)));
    }
  }

  const raw = (await Promise.all(batches)).flat();
  const seen = new Set(exclude);
  const merged = [];

  for (const item of raw) {
    const key = `${item.mediaType}:${item.url}`;
    if (seen.has(key)) continue;
    if (!matchesSite(item, siteHost)) continue;
    seen.add(key);
    if (!acceptsMediaType(item.mediaType)) continue;
    merged.push(item);
    if (merged.length >= target) break;
  }

  const sorted = sortItemsByMedia(merged.slice(0, target));
  apiResultCache.set(ck, { t: Date.now(), items: sorted });
  return sorted;
}

function defaultExploreQuery() {
  return clusterLabels[Math.floor(Math.random() * clusterLabels.length)];
}

// ==========================
// DRAWER UI
// ==========================
const drawer = document.getElementById("drawer");

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function drawerPreview(data) {
  const url = escapeHtml(data.url);
  const mt = data.mediaType || "image";

  if (mt === "audio") {
    return `<audio controls src="${url}" crossorigin="anonymous"></audio>`;
  }
  if (mt === "video" || mt === "live") {
    return `<video id="drawerVideo" controls playsinline src="${url}" crossorigin="anonymous"></video>`;
  }
  if (mt === "gsplat") {
    return `<p class="hint">Gaussian splat / point cloud — open in a compatible viewer.</p>`;
  }
  return `<img src="${url}" alt="" crossorigin="anonymous" />`;
}

function formatDrawerMeta(data) {
  if (data.probeMeta && window.VWallMeta) {
    return VWallMeta.formatMetaRows(data.probeMeta, data.mediaType);
  }
  return "";
}

function openPreview(data) {
  if (window.VWallScroll?.useScrollWall()) {
    VWallScroll.openInlinePreview(data);
    return;
  }
  openDrawer(data);
}

function openDrawer(data) {
  selected = data;
  const mt = data.mediaType || "image";
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  document.body.classList.add("detail-open");
  drawer.innerHTML = `
    <div class="detail-backdrop" data-detail-close tabindex="-1"></div>
    <div class="detail-panel">
      <button type="button" class="detail-close" data-detail-close aria-label="Close preview">✕</button>
      <div class="detail-layout">
        <div class="detail-media">${drawerPreview(data)}</div>
        <aside class="detail-meta drawer-meta-lite">
          ${data.title ? `<p id="detailTitle" class="drawer-headline">${escapeHtml(data.title)}</p>` : ""}
          ${data.snippet ? `<p class="drawer-snippet">${escapeHtml(data.snippet)}</p>` : ""}
          <a class="open-link" href="${escapeHtml(data.url)}" target="_blank" rel="noopener">Open original</a>
          <button type="button" class="drawer-tech-toggle" aria-expanded="false">Technical details</button>
          <div id="drawerTech" class="drawer-tech" hidden>
            <div id="drawerMeta" class="preview-meta-body">${formatDrawerMeta(data)}</div>
          </div>
        </aside>
      </div>
    </div>
  `;

  drawer.querySelectorAll("[data-detail-close]").forEach((el) => {
    el.addEventListener("click", () => window.closeDrawer());
  });
  drawer.querySelector(".detail-panel")?.addEventListener("click", (e) => e.stopPropagation());

  const techBtn = drawer.querySelector(".drawer-tech-toggle");
  const techWrap = drawer.querySelector("#drawerTech");
  techBtn?.addEventListener("click", () => {
    const opening = !!techWrap?.hidden;
    if (techWrap) techWrap.hidden = !opening;
    techBtn?.setAttribute("aria-expanded", opening ? "true" : "false");
    techBtn.textContent = opening ? "Hide technical details" : "Technical details";
  });
  if (mt === "live" && data.url.includes(".m3u8") && window.Hls?.isSupported()) {
    const video = document.getElementById("drawerVideo");
    const hls = new Hls();
    hls.loadSource(data.url);
    hls.attachMedia(video);
    data._hls = hls;
  }

  if (!data.probeMeta && window.VWallProbePool) {
    VWallProbePool.probeCached({ url: data.url, mediaType: mt }).then((r) => {
      const probeMeta = r?.meta;
      data.probeMeta = probeMeta;
      const buf = probeMeta?.summary?.buffer_est_bytes;
      if (buf && VWallMetrics) {
        const key = mt === "live" ? "live" : mt === "gif" ? "gif" : mt === "video" ? "video" : null;
        if (key) VWallMetrics.addBuffer(key, buf);
      }
      const el = document.getElementById("drawerMeta");
      if (el && selected === data) {
        el.innerHTML = VWallMeta.formatMetaRows(probeMeta, mt);
      }
    });
  }
}

function destroyDrawerPlayback(data) {
  if (data?._hls) {
    data._hls.destroy();
    data._hls = null;
  }
}

window.closeDrawer = () => {
  destroyDrawerPlayback(selected);
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("detail-open");
  selected = null;
};

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && drawer.classList.contains("open")) window.closeDrawer();
});

// ==========================
// SEMANTIC EMBEDDING
// ==========================
function clusterFromKey(itemKey, fallbackIndex) {
  if (itemKey) {
    let h = 0;
    for (let j = 0; j < itemKey.length; j++) h = (h * 31 + itemKey.charCodeAt(j)) | 0;
    return Math.abs(h) % NUM_CLUSTERS;
  }
  return (fallbackIndex ?? 0) % NUM_CLUSTERS;
}

function semanticEmbed(i, seed, itemKey) {
  const cluster = clusterFromKey(itemKey, i);
  const t = i * 0.3 + (seed || 0);
  const radius = 600 + (i % 11) * 36;
  return {
    x: Math.cos(t) * radius + Math.sin(t * 1.7) * 200,
    y: Math.sin(t * 1.3) * radius + Math.cos(t * 0.9) * 200,
    cluster,
    clusterLabel: clusterLabels[cluster]
  };
}

// ==========================
// LAZY TEXTURE LOADER (incremental — reuses loaded thumbs)
// ==========================
let lazyGen = 0;
let lodUpgradeInFlight = 0;

function lodDetailConcurrency() {
  const t = window.VWallPerfGuard?.getTier?.() ?? 0;
  if (t >= 2) return 1;
  if (t >= 1) return 2;
  return 4;
}


let lazyInFlight = 0;
let lazyQueue = [];
const session = () => window.VWallSession;

function lazyMarkLoaded(entry, ok) {
  const m = VWallMetrics?.wallMetrics;
  if (!m) return;
  if (ok) {
    m.loaded++;
    m.loadedByType[entry.item.mediaType] = (m.loadedByType[entry.item.mediaType] || 0) + 1;
    entry.thumbState = "loaded";
  } else {
    m.failed++;
    entry.thumbState = "failed";
  }
  m.pending = Math.max(0, m.total - m.loaded - m.failed);
  VWallMetrics.render();
  const deskPerf = document.querySelector(".perf-desk-text");
  if (deskPerf && !window.matchMedia("(max-width: 899px), (max-height: 620px)").matches) {
    const s = session()?.stats;
    deskPerf.textContent = `${m.loaded}/${m.total}${s ? ` · ${s.reusedNodes} reuse` : ""}`;
    const perfBtn = document.getElementById("perf");
    if (perfBtn) perfBtn.title = `Metrics · ${m.loaded}/${m.total}`;
  }
}

async function lazyProbeEntry(entry) {
  if (!entry || entry.probeMeta) {
    session()?.bumpStats("skippedProbes");
    return;
  }
  const m = VWallMetrics?.wallMetrics;
  if (m) {
    m.probePending++;
    VWallMetrics.render();
  }
  try {
    const r = await VWallProbePool.probeCached(entry.item);
    entry.probeMeta = r?.meta || null;
    entry.analyzers = r?.analyzers || null;
    if (entry.node) {
      entry.node.probeMeta = entry.probeMeta;
    }
    const buf = entry.probeMeta?.summary?.buffer_est_bytes;
    if (buf) {
      const mt = entry.item.mediaType;
      const key = mt === "live" ? "live" : mt === "gif" ? "gif" : mt === "video" ? "video" : mt === "audio" ? "audio" : null;
      if (key && VWallMetrics) VWallMetrics.addBuffer(key, buf);
    }
  } catch {
    /* ignore */
  } finally {
    if (m) {
      m.probePending = Math.max(0, m.probePending - 1);
      VWallMetrics.render();
    }
  }
}

async function lazyLoadThumb(entry, gen) {
  const item = entry.item;
  const container = entry.node;
  const mt = item.mediaType;
  const needsThumb = ["image", "gif", "video", "live"].includes(mt);

  const ladder = global.VWallLadder?.ensureItemLadder?.(item);
  const fullUrl =
    (ladder?.fullTier && ladder.fullTier()?.url) ||
    item.url ||
    "";
  const previewUrl =
    (ladder?.cheapestPreviewTier && ladder.cheapestPreviewTier()?.url) ||
    item.thumbUrl ||
    (["image", "gif"].includes(mt) ? item.url : null);

  if (entry.thumbState === "loaded" && container._thumbLoaded) {
    session()?.bumpStats("cacheHits");
    lazyMarkLoaded(entry, true);
    if (!entry.probeMeta) lazyProbeEntry(entry);
    return;
  }

  if (!needsThumb || !previewUrl) {
    lazyMarkLoaded(entry, true);
    lazyProbeEntry(entry);
    return;
  }

  entry.thumbState = "loading";
  const thumbAlias = `vwall:${session().key(item)}`;
  try {
    const tex = await PIXI.Assets.load({
      src: previewUrl,
      alias: thumbAlias,
      data: { crossOrigin: "anonymous" }
    });
    if (gen !== lazyGen || !container?.parent) {
      PIXI.Assets.unload(thumbAlias).catch(() => {});
      return;
    }

    container.removeChildren();
    const spr = new PIXI.Sprite(tex);
    fitSpriteToThumbCell(spr, tex);
    const meta = MEDIA_META[mt] || MEDIA_META.image;
    const badge = new PIXI.Text(meta.label, {
      fontFamily: "monospace",
      fontSize: 9,
      fill: 0xffffff
    });
    badge.anchor.set(1, 0);
    badge.x = 38;
    badge.y = -36;
    container.addChild(spr, badge);
    container._displaySprite = spr;
    container._thumbTexture = tex;
    container._thumbAlias = thumbAlias;
    container._thumbPickedUrl = previewUrl;
    container._detailAlias = null;
    container._lod = "thumb";
    container._thumbLoaded = true;
    container._canDetailLod =
      mt === "image" &&
      !!(
        previewUrl &&
        fullUrl &&
        previewUrl !== fullUrl
      );

    lazyMarkLoaded(entry, true);
    lazyProbeEntry(entry);
  } catch {
    if (gen === lazyGen) lazyMarkLoaded(entry, false);
  }
}

function lazyPump(gen) {
  const m = VWallMetrics?.wallMetrics;
  const maxLazy = lazyConcurrency();
  while (lazyInFlight < maxLazy && lazyQueue.length && gen === lazyGen) {
    const job = lazyQueue.shift();
    lazyInFlight++;
    if (m) {
      m.inFlight = lazyInFlight;
      m.pending = lazyQueue.length + lazyInFlight;
      VWallMetrics.render();
    }
    lazyLoadThumb(job.entry, gen).finally(() => {
      lazyInFlight--;
      if (m) m.inFlight = lazyInFlight;
      if (gen === lazyGen) lazyPump(gen);
    });
  }
}

function collectLazyPending(onlyNew = false) {
  const out = [];
  for (const key of session().displayOrder) {
    const e = session().get(key);
    if (!e?.node) continue;
    if (e.thumbState === "loaded" || e.thumbState === "loading") continue;
    if (onlyNew && e.thumbState !== "idle" && e.thumbState !== "failed") continue;
    out.push(e);
  }
  return out;
}

function lazyEnqueuePending(gen, onlyNew = false) {
  if (!onlyNew) {
    lazyQueue = [];
    lazyInFlight = 0;
  }

  const pending = collectLazyPending(onlyNew);

  if (window.VWallStreamLoad?.isDesktopCanvas?.()) {
    VWallStreamLoad.startLazyFeed(
      gen,
      pending,
      (chunk, g) => {
        for (const entry of chunk) lazyQueue.push({ entry });
        lazyPump(g);
      },
      !!onlyNew
    );
    return;
  }

  for (const e of pending) lazyQueue.push({ entry: e });
  lazyPump(gen);
}

function fitSpriteToThumbCell(sprite, texture) {
  const iw = texture?.width || 1;
  const ih = texture?.height || 1;
  const ss = TILE_SPRITE_PX / Math.max(iw, ih);
  sprite.texture = texture;
  sprite.width = iw * ss;
  sprite.height = ih * ss;
  sprite.anchor.set(0.5);
}

function approxSpriteScreenDiameter(sprite) {
  if (!sprite?.texture?.baseTexture || !sprite.parent) return 0;
  const wt = sprite.worldTransform;
  const rw = Math.max(sprite.width || TILE_SPRITE_PX, 1);
  const rh = Math.max(sprite.height || TILE_SPRITE_PX, 1);
  const sx = Math.abs(wt.a) + Math.abs(wt.b);
  const sy = Math.abs(wt.c) + Math.abs(wt.d);
  return Math.max(rw * sx, rh * sy, 1e-6);
}

function downgradeLodTexture(container) {
  if (
    container._lod !== "detail" ||
    !container._displaySprite ||
    !container._thumbTexture
  ) {
    return;
  }
  const alias = container._detailAlias;
  container._lod = "thumb";
  container._detailAlias = null;
  const spr = container._displaySprite;
  spr.texture = container._thumbTexture;
  fitSpriteToThumbCell(spr, container._thumbTexture);
  if (alias) PIXI.Assets.unload(alias).catch(() => {});
}

async function upgradeLodToFullRes(entry, container, lg) {
  const item = entry.item;
  if (
    item.mediaType !== "image" ||
    !container._canDetailLod ||
    !container._displaySprite ||
    !container._thumbTexture
  ) {
    return;
  }
  if (container._lod === "detail" || container._lod === "detail-loading") return;

  container._lod = "detail-loading";
  const alias = `vwall:full:${entry.key}`;
  const lad = global.VWallLadder?.ensureItemLadder?.(item);
  const fullSrc = (lad?.fullTier && lad.fullTier()?.url) || item.url;
  try {
    const tex = await PIXI.Assets.load({
      src: fullSrc,
      alias,
      data: { crossOrigin: "anonymous" }
    });
    if (
      lg !== lazyGen ||
      !container.parent ||
      !container._displaySprite ||
      entry.thumbState !== "loaded"
    ) {
      PIXI.Assets.unload(alias).catch(() => {});
      container._lod = "thumb";
      return;
    }
    const wScale = Math.max(Math.abs(world.scale.x), 1e-6);
    if (TILE_SPRITE_PX * wScale < LOD_DETAIL_ENTER_PX * 0.88) {
      PIXI.Assets.unload(alias).catch(() => {});
      container._lod = "thumb";
      return;
    }
    const spr = container._displaySprite;
    fitSpriteToThumbCell(spr, tex);
    container._detailAlias = alias;
    container._lod = "detail";
  } catch {
    container._lod = "thumb";
  }
}

function runTextureLodSweep() {
  if (!window.VWallStreamLoad?.isDesktopCanvas?.()) return;
  const lg = lazyGen;

  /** @type {{ entry: any, container: PIXI.Container, px: number }[]} */
  const upgrades = [];

  for (let i = 0; i < nodes.length; i++) {
    const container = nodes[i];
    const key = container._sessionKey;
    if (!key || !container._displaySprite || !container._canDetailLod) continue;
    const entry = session().get(key);
    if (!entry || entry.thumbState !== "loaded") continue;

    const px = approxSpriteScreenDiameter(container._displaySprite);

    if (container._lod === "detail") {
      if (px < LOD_DETAIL_EXIT_PX) downgradeLodTexture(container);
      continue;
    }
    if (container._lod === "detail-loading") continue;
    if (container._lod !== "thumb") continue;

    if (px >= LOD_DETAIL_ENTER_PX) upgrades.push({ entry, container, px });
  }

  upgrades.sort((a, b) => b.px - a.px);
  while (
    lodUpgradeInFlight < lodDetailConcurrency() &&
    upgrades.length > 0
  ) {
    const job = upgrades.shift();
    if (!job.container.parent || job.container._lod !== "thumb") continue;
    lodUpgradeInFlight++;
    upgradeLodToFullRes(job.entry, job.container, lg).finally(() => {
      lodUpgradeInFlight = Math.max(0, lodUpgradeInFlight - 1);
    });
  }
}

function layoutPosition(i, n) {
  if (gridMode) {
    const cols = Math.ceil(Math.sqrt(n * 1.6));
    const col = i % cols;
    const row = Math.floor(i / cols);
    const offsetX = row % 2 === 0 ? 0 : CELL_SIZE * 0.5;
    return {
      bx: (col - cols / 2) * CELL_SIZE + offsetX,
      by: (row - cols / 2) * CELL_SIZE * 0.9
    };
  }
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (i / Math.max(n - 1, 1)) * 2;
  const radiusAtY = Math.sqrt(1 - y * y);
  const theta = goldenAngle * i;
  const sphereRadius = 800;
  return {
    bx: Math.cos(theta) * radiusAtY * sphereRadius,
    by: y * sphereRadius
  };
}

function remountScrollWall() {
  if (!window.VWallScroll?.useScrollWall()) return;
  let entries = session().getDisplayEntries(getWallCount());
  entries = sortDisplayEntries(entries);
  entries = applyMetaFilter(entries);
  VWallScroll.mount(entries);
}

function mountWallNode(item, opts = {}) {
  const { entry: e, emb, pos } = item;
  const { bx, by } = pos;

  if (e.node && e.node._thumbLoaded) {
    session().bumpStats("reusedNodes");
    e.node.baseX = bx;
    e.node.baseY = by;
    e.node.x = bx;
    e.node.y = by;
    e.node.cluster = emb.cluster;
    e.node.clusterLabel = emb.clusterLabel;
    e.node.alpha = 1;
    delete e.node._streamFade;
    if (!e.node.parent) world.addChild(e.node);
    nodes.push(e.node);
    return;
  }

  if (e.node) {
    e.node.destroy({ children: true });
  }
  e.node = createWallNode(e.item, bx, by, emb);
  e.node.probeMeta = e.probeMeta;
  if (opts.fadeIn) {
    e.node.alpha = 0;
    e.node._streamFade = true;
  }
  world.addChild(e.node);
  session().bumpStats("newNodes");
  nodes.push(e.node);
}

async function trimDisplayEntries(keepKeys) {
  if (window.VWallScroll?.useScrollWall()) {
    let list = session().getDisplayEntries(getWallCount());
    list = sortDisplayEntries(applyMetaFilter(list));
    list = list.filter((e) => keepKeys.has(e.key));
    session().setDisplayKeys(list.map((e) => e.key));
    VWallScroll.mount(list);
    return;
  }

  for (const [, e] of session().byKey) {
    if (e.node?.parent && !keepKeys.has(e.key)) {
      world.removeChild(e.node);
    }
  }
  nodes = [];
  for (const key of session().displayOrder) {
    if (!keepKeys.has(key)) continue;
    const e = session().get(key);
    if (e?.node?.parent) nodes.push(e.node);
  }
}

async function mountDisplayEntries(entries, opts = {}) {
  const scrollMode = window.VWallScroll?.useScrollWall();
  if (scrollMode) {
    canvas.style.display = "none";
    app.view.style.pointerEvents = "none";
    entries.forEach((e, i) => {
      const emb = semanticEmbed(i, seed, e.key);
      e.item.genre = emb.clusterLabel;
      if (e.node) {
        e.node.cluster = emb.cluster;
        e.node.clusterLabel = emb.clusterLabel;
      }
    });
    if (!opts.extendOnly) VWallScroll.mount(entries);
    else {
      entries.forEach((e, i) => {
        const emb = semanticEmbed((opts.indexOffset ?? 0) + i, seed, e.key);
        e.item.genre = emb.clusterLabel;
      });
      VWallScroll.mount(session().getDisplayEntries(opts.total ?? getWallCount()));
    }
    return;
  }

  canvas.style.display = "block";
  app.view.style.pointerEvents = "auto";
  if (drawer.classList.contains("open")) window.closeDrawer?.();

  const indexOffset = opts.indexOffset ?? 0;
  const total = opts.total ?? entries.length + indexOffset;

  if (!opts.extendOnly) {
    window.VWallStreamLoad?.cancel?.();
    const visible = new Set(entries.map((e) => e.key));
    nodes = [];

    for (const [, e] of session().byKey) {
      if (e.node && !visible.has(e.key) && e.node.parent) {
        world.removeChild(e.node);
      }
    }
  }

  const prepared = entries.map((e, i) => {
    const idx = indexOffset + i;
    const emb = semanticEmbed(idx, seed, e.key);
    e.item.genre = emb.clusterLabel;
    return {
      entry: e,
      emb,
      pos: layoutPosition(idx, total),
      i: idx
    };
  });

  const ready = [];
  const stream = [];
  for (const item of prepared) {
    if (item.entry.node?._thumbLoaded) ready.push(item);
    else stream.push(item);
  }

  for (const item of ready) mountWallNode(item);

  if (stream.length && window.VWallStreamLoad) {
    await VWallStreamLoad.mountInWaves(stream, mountWallNode, gridMode, {
      mountOrder: global.VWallLadder?.ORDER_FIFO ?? "fifo"
    });
  } else if (stream.length) {
    for (const item of stream) mountWallNode(item);
  }
}

window.onStreamMountWave = ({ done, total }) => {
  const el = document.getElementById("searchStatus");
  if (!el || total <= 52) return;
  const base = el.textContent.replace(/\s*·\s*wave\s+\d+\/\d+$/i, "");
  el.textContent = `${base} · wave ${done}/${total}`;
  el.classList.add("show-mobile-status");
};

function getMetaSearchQuery() {
  return document.getElementById("metaSearch")?.value?.trim() || "";
}

function applyMetaFilter(entries) {
  const metaQ = getMetaSearchQuery();
  if (!metaQ || !window.VWallCatalog) return entries;
  const items = entries.map((e) => e.item);
  const filtered = VWallCatalog.filterItems(items, metaQ);
  const keep = new Set(filtered.map((it) => session().key(it)));
  return entries.filter((e) => keep.has(e.key));
}

function sortDisplayEntries(entries) {
  if (window.VWallSort) return VWallSort.sortEntries(entries, null, MEDIA_META);
  return entries;
}

// ==========================
// SYNC UNIVERSE (incremental)
// ==========================
async function syncUniverse(query, opts = {}) {
  const gen = ++searchGen;
  const count = getWallCount();
  let rawInput = (query && query.trim()) || "";
  let parsed = opts.parsed || parseSearch(rawInput);
  if (!rawInput) {
    rawInput = defaultExploreQuery();
    if (!opts.parsed) parsed = parseSearch(rawInput);
  }
  const q = rawInput;
  const searchLabel = window.VWallSearchQuery
    ? VWallSearchQuery.displaySearchLabel(parsed)
    : q;
  const layoutOnly = opts.layoutOnly === true;
  const extendOnly = opts.extendOnly === true;
  const filterOnly = opts.filterOnly === true;
  const queryChanged = q !== session().lastQuery && !filterOnly;
  const incrementalCount =
    extendOnly && !queryChanged && !filterOnly && !layoutOnly;

  session().stats = { cacheHits: 0, reusedNodes: 0, newNodes: 0, skippedProbes: 0 };

  if (layoutOnly) {
    let entries = applyMetaFilter(
      session().getDisplayEntries(session().displayOrder.length)
    );
    entries = sortDisplayEntries(entries);
    session().setDisplayKeys(entries.map((e) => e.key));
    await mountDisplayEntries(entries);
    return;
  }

  if (!incrementalCount) {
    lazyGen++;
    window.VWallStreamLoad?.cancel?.();
  }
  const lazyGenLocal = lazyGen;
  searchBtn.disabled = true;
  const statusQ = parsed.scoped ? searchLabel : q;
  setSearchStatus(
    queryChanged
      ? `Searching “${statusQ}”…`
      : incrementalCount
        ? `Adding more…`
        : `Updating “${statusQ}”…`
  );

  if (activeMediaTypes.size === 0) {
    setSearchStatus("Enable at least one media type");
    searchBtn.disabled = false;
    return;
  }

  session().lastQuery = q;
  let displayKeys = filterOnly ? [] : [...session().displayOrder];
  const keysBeforeFetch = incrementalCount ? new Set(displayKeys) : null;

  if (queryChanged) {
    displayKeys = [];
  }

  if (filterOnly) {
    displayKeys = [...session().byKey.entries()]
      .filter(([, e]) => acceptsMediaType(e.item.mediaType) && e.lastQuery === q)
      .map(([k]) => k)
      .slice(0, count);
  }

  const visibleCount = displayKeys.length;
  const need = filterOnly ? 0 : count - visibleCount;

  if (need > 0 && !filterOnly) {
    try {
      const fetched = await fetchMediaResults(q, need, {
        exclude: session().keys(),
        parsed,
        siteHost: parsed.siteHost
      });
      if (gen !== searchGen) return;
      for (const item of fetched) {
        const key = session().key(item);
        session().touchEntry(key, item);
        if (!displayKeys.includes(key)) displayKeys.push(key);
      }
    } catch (e) {
      console.error("Search failed:", e);
    }
  } else if (need < 0) {
    displayKeys = displayKeys.slice(0, count);
  }

  if (gen !== searchGen) return;

  displayKeys = displayKeys.filter((k) => {
    const e = session().get(k);
    return e && acceptsMediaType(e.item.mediaType);
  });

  session().setDisplayKeys(displayKeys.slice(0, count));
  let entries = session().getDisplayEntries(count);
  if (!incrementalCount) {
    entries = sortDisplayEntries(entries);
    session().setDisplayKeys(entries.map((e) => e.key));
    entries = applyMetaFilter(entries);
  } else {
    entries = applyMetaFilter(entries);
  }

  if (!entries.length) {
    setSearchStatus(`No results for “${q}”`);
    searchBtn.disabled = false;
    return;
  }

  const tallies = countByMedia(entries.map((e) => e.item));
  const s = session().stats;
  const tallyStr = MEDIA_TYPES.filter((t) => tallies[t]).map((t) => `${t}:${tallies[t]}`).join(" ");
  setSearchStatus(`${entries.length} · ${tallyStr} · +${s.newNodes} new · ${s.reusedNodes} reused`);

  if (window.VWallMetrics) {
    const loaded = entries.filter((e) => e.thumbState === "loaded").length;
    if (incrementalCount) {
      const wm = VWallMetrics.wallMetrics;
      wm.total = entries.length;
      wm.pending = Math.max(0, entries.length - wm.loaded - wm.failed);
      for (const t of MEDIA_TYPES) wm.byType[t] = tallies[t] || 0;
    } else {
      VWallMetrics.resetCounts(entries.length, tallies);
      const wm = VWallMetrics.wallMetrics;
      wm.loaded = loaded;
      wm.pending = Math.max(0, entries.length - loaded - wm.failed);
      for (const e of entries) {
        if (e.thumbState === "loaded") {
          wm.loadedByType[e.item.mediaType] = (wm.loadedByType[e.item.mediaType] || 0) + 1;
        }
      }
    }
    VWallMetrics.render();
  }

  if (incrementalCount) {
    const trimKeys = new Set(entries.map((e) => e.key));
    await trimDisplayEntries(trimKeys);
    const newEntries = entries.filter((e) => keysBeforeFetch && !keysBeforeFetch.has(e.key));
    if (newEntries.length) {
      const indexOffset = entries.length - newEntries.length;
      await mountDisplayEntries(newEntries, {
        extendOnly: true,
        indexOffset,
        total: entries.length
      });
    }
    lazyEnqueuePending(lazyGenLocal, true);
    searchBtn.disabled = false;
    return;
  }

  await mountDisplayEntries(entries);
  searchBtn.disabled = false;
  lazyEnqueuePending(lazyGenLocal, need > 0);
}

async function buildUniverse(query, opts) {
  return syncUniverse(query, opts);
}

function hexToPixi(hex) {
  return parseInt(hex.replace("#", ""), 16);
}

function createWallNode(item, bx, by, emb) {
  const meta = MEDIA_META[item.mediaType] || MEDIA_META.image;
  const container = new PIXI.Container();
  container.x = bx;
  container.y = by;
  container.baseX = bx;
  container.baseY = by;
  container.cluster = emb.cluster;
  container.clusterLabel = emb.clusterLabel;
  container.title = item.title;
  container.snippet = item.snippet;
  container.url = item.url;
  container.thumbUrl = item.thumbUrl;
  container.mediaType = item.mediaType;
  container.mime = item.mime;

  const thumb =
    item.thumbUrl ||
    (["image", "gif"].includes(item.mediaType) ? item.url : null);

  const tile = new PIXI.Graphics();
  tile.beginFill(hexToPixi(meta.color), 0.55);
  tile.drawRoundedRect(-40, -40, 80, 80, 10);
  tile.endFill();
  const label = new PIXI.Text(meta.label, {
    fontFamily: "sans-serif",
    fontSize: 16,
    fontWeight: "bold",
    fill: 0xffffff
  });
  label.anchor.set(0.5);
  label.alpha = 0.9;
  const badge = new PIXI.Text(meta.label, {
    fontFamily: "monospace",
    fontSize: 9,
    fill: 0xffffff
  });
  badge.anchor.set(1, 0);
  badge.x = 38;
  badge.y = -36;
  container.addChild(tile, label, badge);
  container._placeholder = true;

  container.blendMode = blendEnabled ? PIXI.BLEND_MODES.ADD : PIXI.BLEND_MODES.NORMAL;
  container.eventMode = "static";
  container.cursor = "pointer";
  container._sessionKey = session().key(item);
  container._lod = "placeholder";
  container._displaySprite = null;
  container._thumbTexture = null;
  container._thumbAlias = null;
  container._detailAlias = null;
  container._canDetailLod = false;
  container.on("pointertap", () =>
    openPreview({
      url: container.url,
      title: container.title,
      snippet: container.snippet,
      mediaType: container.mediaType,
      clusterLabel: container.clusterLabel,
      probeMeta: container.probeMeta
    })
  );

  return container;
}

// ==========================
// SEARCH
// ==========================
window.runSearch = async () => {
  const input = document.getElementById("search");
  const raw = input?.value.trim();
  const parsed = parseSearch(raw);
  if (!raw) {
    setSearchStatus("Enter a search term or https://site.com + query");
    return;
  }
  if (parsed.scoped && !parsed.siteHost) {
    setSearchStatus("Invalid site URL — use https://example.com + terms");
    return;
  }
  if (!parsed.scoped && !parsed.terms) {
    setSearchStatus("Enter a search term");
    return;
  }
  seed++;
  session().displayOrder = [];
  await syncUniverse(raw, { parsed });
  input?.blur();
  window.VWallNav?.closeSheet?.();
};

document.getElementById("search")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    window.runSearch();
  }
});

document.getElementById("searchBtn")?.addEventListener("click", () => window.runSearch());
document.getElementById("layoutBtn")?.addEventListener("click", () => window.toggleLayout());
document.getElementById("blurBtn")?.addEventListener("click", () => window.toggleBlur());
document.getElementById("blendBtn")?.addEventListener("click", () => window.toggleBlend());
document.getElementById("reseedBtn")?.addEventListener("click", () => window.reseed());

// ==========================
// TOGGLES
// ==========================
window.toggleBlur = () => {
  blurEnabled = !blurEnabled;
  document.getElementById("blurBtn").innerText = `Blur: ${blurEnabled ? "ON" : "OFF"}`;
  document.getElementById("blurBtn").classList.toggle("active", blurEnabled);
};

window.toggleBlend = () => {
  blendEnabled = !blendEnabled;
  document.getElementById("blendBtn").innerText = `Blend: ${blendEnabled ? "ON" : "OFF"}`;
  document.getElementById("blendBtn").classList.toggle("active", blendEnabled);
  nodes.forEach(n => {
    n.blendMode = blendEnabled ? PIXI.BLEND_MODES.ADD : PIXI.BLEND_MODES.NORMAL;
  });
};

window.toggleLayout = async () => {
  gridMode = !gridMode;
  saveGridModePreference();
  syncLayoutBtn();
  const q = document.getElementById("search").value.trim() || null;
  await syncUniverse(q, { layoutOnly: true });
};

window.reseed = async () => {
  seed = Math.floor(Math.random() * 1000);
  const q = document.getElementById("search").value.trim() || null;
  await syncUniverse(q, { layoutOnly: true });
};

// ==========================
// CAMERA (PAN + ZOOM)
// ==========================
let scale = 1;
let targetScale = 1;
let lodSweepAcc = 0;

window.addEventListener("wheel", e => {
  targetScale *= e.deltaY > 0 ? 0.9 : 1.1;
  targetScale = Math.max(0.1, Math.min(targetScale, 10));
});

canvas.addEventListener("pointerdown", e => {
  if (e.target === canvas) {
    dragging = true;
    last.x = e.clientX;
    last.y = e.clientY;
  }
});

window.addEventListener("pointerup", () => { dragging = false; });

window.addEventListener("pointermove", e => {
  if (!dragging) return;
  world.x += e.clientX - last.x;
  world.y += e.clientY - last.y;
  last.x = e.clientX;
  last.y = e.clientY;
});

// ==========================
// RENDER LOOP
// ==========================
app.ticker.add(() => {
  if (window.VWallMetrics) VWallMetrics.tickFrame();
  if (window.VWallPerfGuard) VWallPerfGuard.recordFrameDelta();
  if (window.VWallScroll?.useScrollWall()) return;

  scale += (targetScale - scale) * 0.08;
  world.scale.set(scale);

  const guard = window.VWallPerfGuard;
  const animate = guard?.shouldAnimateNodes?.() !== false;
  const driftAmt = guard?.getDrift?.(gridMode) ?? (gridMode ? 3 : 15);
  const useBlur = blurEnabled && !(guard?.shouldAutoDisableBlur?.() && !guard?.isOverride?.());

  if (!animate) {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      n.x = n.baseX;
      n.y = n.baseY;
      n.alpha = 1;
    }
  } else {
    const t = performance.now() * 0.001;

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      n.x = n.baseX + Math.sin(n.cluster * 0.5 + t * 0.5 + i * 0.1) * driftAmt;
      n.y = n.baseY + Math.cos(n.cluster * 0.5 + t * 0.5 + i * 0.1) * driftAmt;

      if (n._streamFade) {
        n.alpha = Math.min(1, n.alpha + 0.12);
        if (n.alpha >= 0.99) delete n._streamFade;
      }

      if (useBlur) {
        const dist = Math.hypot(n.x, n.y);
        const blurA = Math.max(0.15, 1 - dist / 1500);
        n.alpha = n._streamFade ? Math.min(n.alpha, blurA) : blurA;
      } else if (!n._streamFade) {
        n.alpha = 1;
      }
    }
  }

  lodSweepAcc++;
  if (lodSweepAcc >= 22) {
    lodSweepAcc = 0;
    runTextureLodSweep();
  }
});

// ==========================
// RESIZE
// ==========================
window.addEventListener("resize", () => {
  world.position.set(innerWidth / 2, innerHeight / 2);
});

// ==========================
// MEDIA FILTER UI
// ==========================
function initMediaFilters() {
  const bar = document.getElementById("mediaFilters");
  if (!bar) return;

  bar.innerHTML = "";
  for (const type of MEDIA_TYPES) {
    const meta = MEDIA_META[type];
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "media-chip " + (activeMediaTypes.has(type) ? "on" : "off");
    chip.textContent = meta.label;
    chip.style.setProperty("--chip-color", meta.chip);
    chip.title = `Toggle ${type}`;
    chip.addEventListener("click", async () => {
      if (activeMediaTypes.has(type)) {
        if (activeMediaTypes.size <= 1) return;
        activeMediaTypes.delete(type);
        chip.classList.replace("on", "off");
      } else {
        activeMediaTypes.add(type);
        chip.classList.replace("off", "on");
      }
      saveMediaFilters();
      const q = document.getElementById("search").value.trim() || null;
      await syncUniverse(q, { filterOnly: true });
    });
    bar.appendChild(chip);
  }

  document.getElementById("sortMode")?.addEventListener("change", async () => {
    const q = document.getElementById("search").value.trim() || null;
    await syncUniverse(q, { layoutOnly: true });
  });
}

let metaTimeout;
document.getElementById("metaSearch")?.addEventListener("input", () => {
  clearTimeout(metaTimeout);
  metaTimeout = setTimeout(async () => {
    const q = document.getElementById("search").value.trim() || null;
    await syncUniverse(q, { filterOnly: true });
  }, 350);
});

// ==========================
// INIT
// ==========================
document.getElementById("search").placeholder =
  "https://site.com + query · or keywords…";
initMediaFilters();
syncLayoutBtn();

if (window.VWallScroll) {
  VWallScroll.initGenreRail(clusterLabels, remountScrollWall);
  window.onScrollWallExtend = async () => {
    const q = document.getElementById("search").value.trim() || session().lastQuery;
    const current = session().displayOrder.length;
    if (current >= MAX_WALL_ITEMS) return;
    const bump = window.VWallPerfGuard?.getExtendBump?.() ?? 250;
    const next = Math.min(getUserWallCount() + bump, MAX_WALL_ITEMS);
    if (window.VWallCount) VWallCount.setCount(next);
    else {
      const input = document.getElementById("countInput");
      const slider = document.getElementById("countSlider");
      if (input) input.value = String(next);
      if (slider) slider.value = String(next);
    }
    await syncUniverse(q, { extendOnly: true });
  };
  globalThis.matchMedia(
    window.VWallScroll?.SCROLL_WALL_MQ ?? "(max-width: 899px), (max-height: 620px)"
  ).addEventListener("change", async () => {
    let entries = session().getDisplayEntries(getWallCount());
    entries = sortDisplayEntries(entries);
    entries = applyMetaFilter(entries);
    await mountDisplayEntries(entries);
  });
}

buildUniverse(null);

// ==========================
// COUNT CONTROLS
// ==========================
function getUserWallCount() {
  if (window.VWallCount) return VWallCount.getCount();
  const input = document.getElementById("countInput");
  const slider = document.getElementById("countSlider");
  return parseInt(input?.value || slider?.value, 10) || 1000;
}

function getWallCount() {
  const user = getUserWallCount();
  if (window.VWallPerfGuard) return VWallPerfGuard.capCount(user);
  return user;
}

function applyPerfBlurPolicy() {
  const guard = window.VWallPerfGuard;
  if (!guard?.shouldAutoDisableBlur?.() || guard.isOverride()) return;
  if (!blurEnabled) return;
  blurEnabled = false;
  document.getElementById("blurBtn").innerText = "Blur: OFF";
  document.getElementById("blurBtn")?.classList.remove("active");
}

async function applyPerfTierChange(_tier, tierInfo, reason) {
  if (applying) return;
  applying = true;
  try {
    const q = document.getElementById("search")?.value?.trim() || session().lastQuery || null;

    if (reason === "turbo-on") {
      await syncUniverse(q);
      return;
    }

    applyPerfBlurPolicy();
    const cap = getWallCount();
    const order = session().displayOrder;
    if (order.length > cap) {
      session().setDisplayKeys(order.slice(0, cap));
      const q = document.getElementById("search")?.value?.trim() || session().lastQuery || null;
      let entries = session().getDisplayEntries(cap);
      entries = sortDisplayEntries(entries);
      entries = applyMetaFilter(entries);
      await mountDisplayEntries(entries);
      lazyGen++;
      lazyEnqueuePending(lazyGen, false);
    }
    const status = document.getElementById("searchStatus");
    if (status && tierInfo.id > 0 && reason !== "recovered") {
      status.textContent = `Perf ${tierInfo.label}: capped at ${tierInfo.countCap} items — Turbo to override`;
      status.classList.add("show-mobile-status");
    }
  } finally {
    applying = false;
  }
}

window.onPerfTierChange = applyPerfTierChange;

if (window.VWallCountPresets) {
  VWallCountPresets.initCountControls(async (opts) => {
    const q = document.getElementById("search").value.trim() || null;
    await syncUniverse(q, { extendOnly: opts?.extendOnly === true });
  });
}

if (window.VWallNav) VWallNav.initNav();

