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

const clusterLabels = [
  "nature","faces","objects","abstract","urban","texture","geometry",
  "organic","minimal","vibrant","dark","architectural","water","sky",
  "animals","food","interiors","night","patterns","macro","retro",
  "futuristic","art","technology","travel","sports","fashion","science"
];
const NUM_CLUSTERS = clusterLabels.length;

// ==========================
// SETTINGS PANEL (built in JS)
// ==========================
const settingsHTML = document.getElementById("settings");
settingsHTML.innerHTML = `
  <button class="close-btn" onclick="closeSettings()">✕</button>
  <h2>Settings</h2>
  <label>Google API Key:<br><input id="apiKeyInput" type="text" placeholder="AIza..." /></label>
  <label>Custom Search Engine ID:<br><input id="cxInput" type="text" placeholder="0123456789:abc..." /></label>
  <button onclick="saveSettings()">Save</button>
  <p class="hint">Get keys at <a href="https://console.cloud.google.com/apis/credentials" target="_blank">Google Cloud</a> + <a href="https://programmablesearchengine.google.com/controlpanel/create" target="_blank">Programmable Search</a></p>
`;

function getApiKey() { return localStorage.getItem("googleApiKey") || ""; }
function getCx() { return localStorage.getItem("googleCx") || ""; }

window.openSettings = () => {
  settingsHTML.classList.add("open");
  document.getElementById("apiKeyInput").value = getApiKey();
  document.getElementById("cxInput").value = getCx();
};

window.closeSettings = () => settingsHTML.classList.remove("open");

window.saveSettings = () => {
  localStorage.setItem("googleApiKey", document.getElementById("apiKeyInput").value.trim());
  localStorage.setItem("googleCx", document.getElementById("cxInput").value.trim());
  window.closeSettings();
};

// ==========================
// DRAWER UI
// ==========================
const drawer = document.getElementById("drawer");

function openDrawer(data) {
  selected = data;
  drawer.classList.add("open");
  drawer.innerHTML = `
    <button class="close-btn" onclick="closeDrawer()">✕</button>
    <h2>Image Inspector</h2>
    <img src="${data.url}" />
    <div class="meta">
      ${data.title ? `<p><span>Title:</span> ${data.title}</p>` : ""}
      ${data.snippet ? `<p><span>Snippet:</span> ${data.snippet}</p>` : ""}
      <p><span>Cluster:</span> ${data.clusterLabel}</p>
      <p><span>X:</span> ${Math.round(data.baseX)}</p>
      <p><span>Y:</span> ${Math.round(data.baseY)}</p>
    </div>
  `;
}

window.closeDrawer = () => {
  drawer.classList.remove("open");
  selected = null;
};

// click canvas to close drawer
canvas.addEventListener("pointerdown", () => {
  if (drawer.classList.contains("open")) window.closeDrawer();
});

// ==========================
// GOOGLE IMAGE SEARCH
// ==========================
async function googleSearch(query) {
  const apiKey = getApiKey();
  const cx = getCx();
  if (!apiKey || !cx) return null;

  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&searchType=image&q=${encodeURIComponent(query)}&num=100`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.items) {
      return data.items.map(item => ({
        url: item.link,
        title: item.title || "",
        snippet: item.snippet || ""
      }));
    }
  } catch (e) {
    console.error("Search failed:", e);
  }
  return null;
}

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
// BUILD UNIVERSE
// ==========================
async function buildUniverse(query) {
  world.removeChildren();
  nodes = [];

  const count = parseInt(countSlider.value) || 250;

  // Try Google search first
  const searchResults = query ? await googleSearch(query) : null;
  let items;

  if (searchResults) {
    items = searchResults.slice(0, count);
  } else {
    items = Array.from({ length: count }, (_, i) => ({
      url: `https://picsum.photos/300/300?random=${(i + seed * 100) % 10000}`,
      title: "",
      snippet: ""
    }));
  }

  items.forEach((item, i) => {
    const emb = semanticEmbed(i, seed);
    let bx, by;

    if (gridMode) {
      // Checkerboard — perfect rows/columns with alternating offset
      const cols = Math.ceil(Math.sqrt(items.length * 1.6));
      const col = i % cols;
      const row = Math.floor(i / cols);
      const offsetX = (row % 2 === 0) ? 0 : CELL_SIZE * 0.5;
      bx = (col - cols / 2) * CELL_SIZE + offsetX;
      by = (row - cols / 2) * CELL_SIZE * 0.9;
    } else {
      // Sphere — golden spiral projection (Fibonacci sphere)
      const n = items.length;
      const goldenAngle = Math.PI * (3 - Math.sqrt(5));
      const y = 1 - (i / (n - 1)) * 2; // y goes from 1 to -1
      const radiusAtY = Math.sqrt(1 - y * y);
      const theta = goldenAngle * i;
      const sphereRadius = 800;
      bx = Math.cos(theta) * radiusAtY * sphereRadius;
      by = y * sphereRadius;
    }

    const tex = PIXI.Texture.from(item.url);
    const spr = new PIXI.Sprite(tex);

    spr.width = 80;
    spr.height = 80;
    spr.anchor.set(0.5);
    spr.x = bx;
    spr.y = by;
    spr.baseX = bx;
    spr.baseY = by;
    spr.cluster = emb.cluster;
    spr.clusterLabel = emb.clusterLabel;
    spr.title = item.title;
    spr.snippet = item.snippet;
    spr.url = item.url;
    spr.blendMode = blendEnabled ? PIXI.BLEND_MODES.ADD : PIXI.BLEND_MODES.NORMAL;

    spr.eventMode = "static";
    spr.cursor = "pointer";
    spr.on("pointertap", () => openDrawer(spr));

    world.addChild(spr);
    nodes.push(spr);
  });
}

// ==========================
// SEARCH
// ==========================
window.runSearch = async () => {
  const input = document.getElementById("search");
  const q = input.value.trim();
  if (!q) return;
  seed++;
  await buildUniverse(q);
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
  await buildUniverse(q);
};

window.reseed = async () => {
  seed = Math.floor(Math.random() * 1000);
  const q = document.getElementById("search").value.trim() || null;
  await buildUniverse(q);
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
// INIT
// ==========================
buildUniverse(null);

// ==========================
// COUNT SLIDER
// ==========================
const countSlider = document.getElementById("countSlider");
const countVal = document.getElementById("countVal");
let sliderTimeout;

countSlider.addEventListener("input", () => {
  const v = parseInt(countSlider.value);
  countVal.innerText = v;
  clearTimeout(sliderTimeout);
  // debounce: wait 500ms before rebuilding
  sliderTimeout = setTimeout(async () => {
    seed = Math.floor(Math.random() * 1000);
    const q = document.getElementById("search").value.trim() || null;
    await buildUniverse(q);
  }, 500);
});

// ==========================
// PERFORMANCE MONITOR
// ==========================
const perfEl = document.getElementById("perf");
let frameCount = 0;
let lastFpsTime = performance.now();
let fps = 0;
let memMB = 0;

setInterval(() => {
  // FPS
  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime >= 500) {
    fps = Math.round(frameCount / ((now - lastFpsTime) / 1000));
    frameCount = 0;
    lastFpsTime = now;
  }

  // Memory (Chrome only)
  if (performance.memory) {
    memMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
  }

  // Status color
  let color;
  if (fps >= 50 && memMB < 500) {
    color = "#4c4"; // green = good
  } else if (fps >= 30 && memMB < 1000) {
    color = "#cc4"; // yellow = warning
  } else {
    color = "#c44"; // red = danger
  }

  perfEl.style.color = color;
  perfEl.style.borderColor = color;
  perfEl.textContent = `${fps} fps  ${memMB ? memMB + "MB" : "—"}`;
}, 500);
