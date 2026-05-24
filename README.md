<img width="974" height="788" alt="Screenshot 2026-05-22 at 12 55 28 pm" src="https://github.com/user-attachments/assets/1a3ee1cd-acc8-441d-810d-f4c8607f1a9e" />
<img width="974" height="786" alt="Screenshot 2026-05-24 at 12 09 13 pm" src="https://github.com/user-attachments/assets/c59df7eb-dd41-4e18-8101-444ccce812d9" />
<img width="974" height="786" alt="Screenshot 2026-05-24 at 12 08 21 pm" src="https://github.com/user-attachments/assets/bdf9ff3a-5567-417f-bfd5-2a89ac9171a5" />
<img width="974" height="786" alt="Screenshot 2026-05-24 at 12 08 04 pm" src="https://github.com/user-attachments/assets/c2c6024c-ea5f-4b30-844b-a850d3b7fb50" />

# VWall

GPU image wall (PixiJS) with open image search (no API keys).

## Live site

After GitHub Actions deploys, the app is at:

**https://fornevercollective.github.io/vwall/**

## Local

Open `index.html` in a browser, or serve the repo root:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080/

## Media search & filters

Search uses public APIs only (no keys): **Wikimedia Commons** + **Openverse** (images + audio).

Header chips filter by type: **image**, **gif**, **video**, **live** (HLS/m3u8), **gsplat** (`.ply` / `.splat`), **audio**.

**Sort → By media type** groups results on the wall by type. Click a tile to preview (desktop: centered lightbox; mobile browse: bottom sheet; HLS via hls.js).

Up to **20,000** items via the count slider (lazy-loaded thumbnails). Very large counts are heavy on GPU/RAM.

### Metrics panel (right)

Live **FPS**, memory, load queue, per-type counts, and **buffer estimates** (video / live / gif / audio) while tiles stream in.

### Incremental session (Bridge-style)

VWall **keeps** loaded thumbnails, probes, and Pixi nodes in a session cache. Raising the count **extends** the wall (only fetches new URLs). Layout / reseed / sort **reposition** without refetching. Status shows `reused` vs `new` counts.

**Desktop wall (Pixi):** thumbnails load first (`thumbUrl`, or the main URL when no separate thumb exists). While you zoom and pan the mosaic, tiles that span enough **screen pixels** and have a distinct full-size URL can **upgrade in place** to the original image (still letterboxed inside the tile), then automatically **unload** that heavier texture again when zoomed back out — similar in spirit to a coarse “overview” atlas with on-demand sharper layers, minus true lightfield mip chains.

**Load order:** new sessions mount tiles roughly **first-come / first-serve** in display sequence (rather than reordering every batch by on-screen proximity). Incremental bumps **append** to the thumbnail pump when work is already in flight so URLs mid-buffer/decode aren’t flushed for no reason (“rolling shutter” / old-internet pacing at scale).

**Resolution ladder (`media-ladder.js`):** ingestion can attach `variantUrls` (array of `{ url, role?, maxEdge?, bytesHint?, id? }`) plus optional `thumbMaxEdge`. Preview picks the **cheapest tier** (`cheapestPreviewTier`); LOD upgrade resolves the **full** tier. That is tooling for manifest-style “data lake” URLs (CDN size ladders, IIIF width tiers, tiled rasters later) until true mip pyramids or server tiling land.

### Metadata search (footer)

Filter **already probed** items:

- `exif:canon` · `camera:nikon` · `codec:hevc` · `dims:1920x1080` · `encoder:lavf`

Runs on ffprobe / EXIF tags indexed as items load. Future: waveform, vectorscope, watermark plugins (`analyzers.js`).

### Analyzer clusters

`probe-pool.js` runs **4-wide** metadata clusters (reuses cache, skips duplicate ffprobe). `analyzers.js` registers waveform / vectorscope / watermark stubs for MuStream integration.

### ffprobe / EXIF (MuStream)

For full stream metadata (codec, HDR hints, bitrate, buffer size, encoder tags — same family as **mustream-desktop** `meta`):

```bash
mustream probe-serve
```

Keeps `http://127.0.0.1:18765/v1/probe?url=…` open; VWall’s inspector merges that with in-browser probes. Override bind: `MUSTREAM_PROBE_BIND=127.0.0.1:18765`.

## GitHub Pages

Pushes to `main` run [.github/workflows/pages.yml](.github/workflows/pages.yml).

In the repo **Settings → Pages**, set **Build and deployment → Source** to **GitHub Actions** (one-time).

## Pages

| File | Description |
|------|-------------|
| `index.html` | Main 3D wall |
| `media-ladder.js` | Multi-URL ladder (`variantUrls`) for previews vs full-res |
| `visualwall.html` | Color-sorted grid |
| `focus.html` | Single-image focus view |

The `vidwn/` folder is a local download helper (not deployed to Pages).
