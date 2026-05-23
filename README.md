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

**Sort → By media type** groups results on the wall by type. Click a tile to preview (video/audio/live in the drawer; HLS via hls.js).

Up to **20,000** items via the count slider (lazy-loaded thumbnails). Very large counts are heavy on GPU/RAM.

### Metrics panel (right)

Live **FPS**, memory, load queue, per-type counts, and **buffer estimates** (video / live / gif / audio) while tiles stream in.

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
| `visualwall.html` | Color-sorted grid |
| `focus.html` | Single-image focus view |

The `vidwn/` folder is a local download helper (not deployed to Pages).
