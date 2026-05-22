<img width="974" height="788" alt="Screenshot 2026-05-22 at 12 55 28 pm" src="https://github.com/user-attachments/assets/1a3ee1cd-acc8-441d-810d-f4c8607f1a9e" />
# VWall

GPU image wall (PixiJS) with Google Custom Search integration.

## Live site

After GitHub Actions deploys, the app is at:

**https://fornevercollective.github.io/vwall/**

## Local

Open `index.html` in a browser, or serve the repo root:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080/

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
