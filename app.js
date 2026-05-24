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
let gridMode = false; // false = sphere, true = checkerboard
let dragging = false;
let last = { x: 0, y: 0 };
let selected = null;
let seed = 0;

const CELL_SIZE = 90;
const MAX_WALL_ITEMS = 20000;
const LAZY_CONCURRENCY = 24;
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
    license
  } = fields;
  const mt = mediaType || classifyMedia(mime, url, title);
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* ignore */
  }
  return {
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
        source: "wikimedia"
      }));

      if (results.length >= maxItems) return results;
    }

    if (!data.continue?.gsroffset) break;
    offset = data.continue.gsroffset;
  }

  return results;
}

async function searchOpenverseImages(query, maxItems) {
  const results = [];
  const pageSize = 20;
  let page = 1;
  const maxPages = Math.min(60, Math.ceil(maxItems / pageSize) + 2);

  while (results.length < maxItems * 2 && page <= maxPages) {
    const url =
      `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}` +
      `&page=${page}&page_size=${pageSize}`;
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

async function searchOpenverseAudio(query, maxItems) {
  if (!acceptsMediaType("audio")) return [];

  const results = [];
  const pageSize = 20;
  let page = 1;
  const maxPages = Math.min(40, Math.ceil(maxItems / pageSize) + 2);

  while (results.length < maxItems && page <= maxPages) {
    const url =
      `https://api.openverse.org/v1/audio/?q=${encodeURIComponent(query)}` +
      `&page=${page}&page_size=${pageSize}`;
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

function cacheKeyForFetch(q, limit, excludeSize) {
  return `${q}|${limit}|${[...activeMediaTypes].sort().join(",")}|${excludeSize}`;
}

async function fetchMediaResults(query, limit, opts = {}) {
  const q = query.trim();
  if (!q || activeMediaTypes.size === 0) return [];

  const exclude = opts.exclude || new Set();
  const target = Math.min(limit, MAX_WALL_ITEMS);
  const ck = cacheKeyForFetch(q, target, exclude.size);
  const cached = apiResultCache.get(ck);
  if (cached && Date.now() - cached.t < API_CACHE_TTL_MS) {
    return cached.items.filter((it) => !exclude.has(`${it.mediaType}:${it.url}`));
  }

  const perSource = Math.ceil(target / Math.max(1, activeMediaTypes.size)) + 15;
  const batches = [searchWikimedia(q, perSource)];

  if (activeMediaTypes.has("image") || activeMediaTypes.has("gif") || activeMediaTypes.has("video")) {
    batches.push(searchOpenverseImages(q, perSource));
  }
  if (activeMediaTypes.has("audio")) {
    batches.push(searchOpenverseAudio(q, perSource));
  }
  for (const type of ["gsplat", "live", "gif"]) {
    if (activeMediaTypes.has(type) && SPECIAL_SEARCHES[type]) {
      batches.push(searchWikimedia(q, Math.ceil(perSource / 2), SPECIAL_SEARCHES[type](q)));
    }
  }

  const raw = (await Promise.all(batches)).flat();
  const seen = new Set(exclude);
  const merged = [];

  for (const item of raw) {
    const key = `${item.mediaType}:${item.url}`;
    if (seen.has(key)) continue;
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
  return '<p class="hint">Probing metadata…</p>';
}

function openDrawer(data) {
  selected = data;
  const mt = data.mediaType || "image";
  const meta = MEDIA_META[mt] || MEDIA_META.image;
  drawer.classList.add("open");
  drawer.innerHTML = `
    <button class="close-btn" onclick="closeDrawer()">✕</button>
    <span class="media-badge" style="background:${meta.color}">${meta.label} · ${mt}</span>
    <h2>Media Inspector</h2>
    ${drawerPreview(data)}
    <div class="meta">
      ${data.title ? `<p><span>Title:</span> ${escapeHtml(data.title)}</p>` : ""}
      ${data.snippet ? `<p><span>Source:</span> ${escapeHtml(data.snippet)}</p>` : ""}
      <p><span>Type:</span> ${mt}</p>
      <div id="drawerMeta">${formatDrawerMeta(data)}</div>
      <p><span>Cluster:</span> ${escapeHtml(data.clusterLabel || "")}</p>
      <a class="open-link" href="${escapeHtml(data.url)}" target="_blank" rel="noopener">Open original</a>
    </div>
  `;

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
  selected = null;
};

// click canvas to close drawer
canvas.addEventListener("pointerdown", () => {
  if (drawer.classList.contains("open")) window.closeDrawer();
});

// ==========================
// SEMANTIC EMBEDDING
// ==========================
function semanticEmbed(i, seed) {
  const t = i * 0.3 + (seed || 0);
  const radius = 600 + Math.random() * 400;
  return {
    x: Math.cos(t) * radius + Math.sin(t * 1.7) * 200,
    y: Math.sin(t * 1.3) * radius + Math.cos(t * 0.9) * 200,
    cluster: Math.floor(Math.random() * NUM_CLUSTERS),
    clusterLabel: clusterLabels[Math.floor(Math.random() * NUM_CLUSTERS)]
  };
}

// ==========================
// LAZY TEXTURE LOADER (incremental — reuses loaded thumbs)
// ==========================
let lazyGen = 0;
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
  const perf = document.getElementById("perf");
  if (perf) {
    const s = session()?.stats;
    perf.textContent = `${m.loaded}/${m.total}${s ? ` · ${s.reusedNodes} reuse` : ""}`;
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
  const thumb = item.thumbUrl || (["image", "gif"].includes(mt) ? item.url : null);

  if (entry.thumbState === "loaded" && container._thumbLoaded) {
    session()?.bumpStats("cacheHits");
    lazyMarkLoaded(entry, true);
    if (!entry.probeMeta) lazyProbeEntry(entry);
    return;
  }

  if (!needsThumb || !thumb) {
    lazyMarkLoaded(entry, true);
    lazyProbeEntry(entry);
    return;
  }

  entry.thumbState = "loading";
  try {
    const tex = await PIXI.Assets.load({
      src: thumb,
      alias: `vwall:${session().key(item)}`,
      data: { crossOrigin: "anonymous" }
    });
    if (gen !== lazyGen || !container?.parent) return;

    container.removeChildren();
    const spr = new PIXI.Sprite(tex);
    spr.width = 80;
    spr.height = 80;
    spr.anchor.set(0.5);
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
    container._thumbLoaded = true;
    lazyMarkLoaded(entry, true);
    lazyProbeEntry(entry);
  } catch {
    if (gen === lazyGen) lazyMarkLoaded(entry, false);
  }
}

function lazyPump(gen) {
  const m = VWallMetrics?.wallMetrics;
  while (lazyInFlight < LAZY_CONCURRENCY && lazyQueue.length && gen === lazyGen) {
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

function lazyEnqueuePending(gen, onlyNew = false) {
  if (!onlyNew) {
    lazyQueue = [];
    lazyInFlight = 0;
  }
  const visible = new Set(session().displayOrder);
  for (const key of session().displayOrder) {
    const e = session().get(key);
    if (!e?.node) continue;
    if (e.thumbState === "loaded" || e.thumbState === "loading") continue;
    if (onlyNew && e.thumbState !== "idle" && e.thumbState !== "failed") continue;
    lazyQueue.push({ entry: e });
  }
  lazyPump(gen);
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

function mountDisplayEntries(entries) {
  const visible = new Set(entries.map((e) => e.key));
  nodes = [];

  entries.forEach((e, i) => {
    const emb = semanticEmbed(i, seed);
    const { bx, by } = layoutPosition(i, entries.length);

    if (e.node && e.node._thumbLoaded) {
      session().bumpStats("reusedNodes");
      e.node.baseX = bx;
      e.node.baseY = by;
      e.node.x = bx;
      e.node.y = by;
      e.node.cluster = emb.cluster;
      e.node.clusterLabel = emb.clusterLabel;
      if (!e.node.parent) world.addChild(e.node);
      nodes.push(e.node);
      return;
    }

    if (e.node) {
      e.node.destroy({ children: true });
    }
    e.node = createWallNode(e.item, bx, by, emb);
    e.node.probeMeta = e.probeMeta;
    world.addChild(e.node);
    session().bumpStats("newNodes");
    nodes.push(e.node);
  });

  for (const [, e] of session().byKey) {
    if (e.node && !visible.has(e.key) && e.node.parent) {
      world.removeChild(e.node);
    }
  }
}

function applyMetaFilter(entries) {
  const metaQ = document.getElementById("metaSearch")?.value?.trim();
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
  const count = parseInt(countSlider.value, 10) || 1000;
  const q = (query && query.trim()) || defaultExploreQuery();
  const layoutOnly = opts.layoutOnly === true;
  const extendOnly = opts.extendOnly === true;
  const filterOnly = opts.filterOnly === true;
  const queryChanged = q !== session().lastQuery && !filterOnly;

  session().stats = { cacheHits: 0, reusedNodes: 0, newNodes: 0, skippedProbes: 0 };

  if (layoutOnly) {
    let entries = applyMetaFilter(
      session().getDisplayEntries(session().displayOrder.length)
    );
    entries = sortDisplayEntries(entries);
    session().setDisplayKeys(entries.map((e) => e.key));
    mountDisplayEntries(entries);
    return;
  }

  lazyGen++;
  const lazyGenLocal = lazyGen;
  searchBtn.disabled = true;
  setSearchStatus(queryChanged ? `Searching “${q}”…` : `Extending “${q}”…`);

  if (activeMediaTypes.size === 0) {
    setSearchStatus("Enable at least one media type");
    searchBtn.disabled = false;
    return;
  }

  session().lastQuery = q;
  let displayKeys = filterOnly ? [] : [...session().displayOrder];

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
      const fetched = await fetchMediaResults(q, need, { exclude: session().keys() });
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
  entries = sortDisplayEntries(entries);
  session().setDisplayKeys(entries.map((e) => e.key));
  entries = applyMetaFilter(entries);

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

  mountDisplayEntries(entries);
  searchBtn.disabled = false;
  lazyEnqueuePending(lazyGenLocal, extendOnly || need > 0);
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
  container.on("pointertap", () => openDrawer(container));

  return container;
}

// ==========================
// SEARCH
// ==========================
window.runSearch = async () => {
  const input = document.getElementById("search");
  const q = input.value.trim();
  if (!q) {
    setSearchStatus("Enter a search term");
    return;
  }
  seed++;
  session().displayOrder = [];
  await syncUniverse(q);
  input.blur();
};

document.getElementById("search").addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    window.runSearch();
  }
});

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
  document.getElementById("layoutBtn").innerText = gridMode ? "Checkerboard" : "Sphere";
  document.getElementById("layoutBtn").classList.toggle("active", gridMode);
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

  scale += (targetScale - scale) * 0.08;
  world.scale.set(scale);

  const t = performance.now() * 0.001;

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const drift = gridMode ? 3 : 15;
    n.x = n.baseX + Math.sin(n.cluster * 0.5 + t * 0.5 + i * 0.1) * drift;
    n.y = n.baseY + Math.cos(n.cluster * 0.5 + t * 0.5 + i * 0.1) * drift;

    if (blurEnabled) {
      const dist = Math.hypot(n.x, n.y);
      n.alpha = Math.max(0.15, 1 - dist / 1500);
    } else {
      n.alpha = 1;
    }
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
  "Search media — images, video, audio, 3D…";
initMediaFilters();
buildUniverse(null);

// ==========================
// COUNT SLIDER
// ==========================
const countSlider = document.getElementById("countSlider");
const countVal = document.getElementById("countVal");
let sliderTimeout;

let lastSliderCount = parseInt(countSlider.value, 10) || 1000;

countSlider.addEventListener("input", () => {
  const v = parseInt(countSlider.value, 10);
  countVal.innerText = v;
  clearTimeout(sliderTimeout);
  sliderTimeout = setTimeout(async () => {
    const q = document.getElementById("search").value.trim() || null;
    const extendOnly = v > lastSliderCount;
    lastSliderCount = v;
    await syncUniverse(q, { extendOnly });
  }, 400);
});

