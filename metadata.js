/**
 * Media probing for VWall: browser hints + optional MuStream ffprobe bridge.
 * Run locally: `mustream probe-serve` → http://127.0.0.1:18765/v1/probe?url=…
 */
(function (global) {
  const PROBE_BASE =
    global.localStorage.getItem("vwallProbeBase") ||
    global.localStorage.getItem("mustreamProbeBase") ||
    "http://127.0.0.1:18765";

  function fmtBytes(n) {
    if (n == null || !Number.isFinite(n)) return "—";
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
    return `${(n / 1073741824).toFixed(2)} GB`;
  }

  function fmtBitrate(bps) {
    if (bps == null || !Number.isFinite(bps)) return "—";
    if (bps < 1000) return `${Math.round(bps)} bps`;
    if (bps < 1e6) return `${(bps / 1000).toFixed(1)} Kbps`;
    return `${(bps / 1e6).toFixed(2)} Mbps`;
  }

  async function headProbe(url) {
    try {
      const res = await fetch(url, { method: "HEAD", mode: "cors" });
      const len = res.headers.get("content-length");
      const type = res.headers.get("content-type");
      return {
        size_bytes: len ? parseInt(len, 10) : null,
        content_type: type || null
      };
    } catch {
      return {};
    }
  }

  function probeImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () =>
        resolve({
          width: img.naturalWidth,
          height: img.naturalHeight,
          duration_sec: null
        });
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  function probeVideo(url) {
    return new Promise((resolve) => {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.crossOrigin = "anonymous";
      const done = (meta) => {
        v.removeAttribute("src");
        v.load();
        resolve(meta);
      };
      v.onloadedmetadata = () =>
        done({
          width: v.videoWidth,
          height: v.videoHeight,
          duration_sec: Number.isFinite(v.duration) ? v.duration : null
        });
      v.onerror = () => done(null);
      v.src = url;
    });
  }

  function probeAudio(url) {
    return new Promise((resolve) => {
      const a = document.createElement("audio");
      a.preload = "metadata";
      a.crossOrigin = "anonymous";
      const done = (meta) => {
        a.removeAttribute("src");
        a.load();
        resolve(meta);
      };
      a.onloadedmetadata = () =>
        done({
          duration_sec: Number.isFinite(a.duration) ? a.duration : null
        });
      a.onerror = () => done(null);
      a.src = url;
    });
  }

  async function fetchMuStreamFfprobe(url) {
    try {
      const u = `${PROBE_BASE}/v1/probe?url=${encodeURIComponent(url)}`;
      const res = await fetch(u, { mode: "cors" });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  function mergeSummary(browser, head, ms) {
    const s = { ...(browser || {}), ...(head || {}) };
    if (ms?.summary && typeof ms.summary === "object") {
      Object.assign(s, ms.summary);
    }
    if (head?.size_bytes && !s.size_bytes) s.size_bytes = head.size_bytes;
    if (head?.content_type && !s.content_type) s.content_type = head.content_type;

    const br = s.bit_rate || (s.size_bytes && s.duration_sec
      ? (s.size_bytes * 8) / s.duration_sec
      : null);
    if (br && !s.bit_rate) s.bit_rate = br;

    if (!s.buffer_est_bytes) {
      if (s.bit_rate) s.buffer_est_bytes = Math.round((s.bit_rate * 3) / 8);
      else if (s.size_bytes) s.buffer_est_bytes = Math.min(s.size_bytes, 2_500_000);
    }
    return s;
  }

  function extractExifFromFfprobe(ms) {
    const out = {};
    const fp = ms?.ffprobe;
    const tags = fp?.format?.tags;
    if (tags) {
      for (const k of ["make", "model", "creation_time", "encoder", "copyright", "title", "comment"]) {
        const v = tags[k] || tags[k.toUpperCase()];
        if (v) out[k] = v;
      }
    }
    const v0 = fp?.streams?.find((s) => s.codec_type === "video");
    if (v0?.tags) {
      for (const k of ["camera", "lens", "location", "creation_time"]) {
        const v = v0.tags[k];
        if (v) out[k] = v;
      }
    }
    return out;
  }

  async function probeItem(item) {
    const url = item.url;
    const mt = item.mediaType;
    const [head, ms] = await Promise.all([
      headProbe(url),
      fetchMuStreamFfprobe(url)
    ]);

    let browser = null;
    if (mt === "image" || mt === "gif") browser = await probeImage(url);
    else if (mt === "video" || mt === "live") browser = await probeVideo(url);
    else if (mt === "audio") browser = await probeAudio(url);

    const summary = mergeSummary(browser, head, ms);
    const exif = extractExifFromFfprobe(ms);
    Object.assign(summary, exif);

    return {
      browser,
      head,
      mustream: ms,
      summary,
      exif,
      exiftool_skipped: ms?.exiftool_skipped || null
    };
  }

  function formatMetaRows(meta, mediaType) {
    if (!meta?.summary) return "";
    const s = meta.summary;
    const rows = [];
    const push = (k, v) => {
      if (v != null && v !== "" && v !== "—") rows.push(`<p><span>${k}:</span> ${v}</p>`);
    };

    push("Dimensions", s.width && s.height ? `${s.width}×${s.height}` : null);
    push("Duration", s.duration_sec != null ? `${s.duration_sec.toFixed(2)}s` : null);
    push("Size", fmtBytes(s.size_bytes));
    push("Bitrate", fmtBitrate(s.bit_rate));
    push("Buffer est.", fmtBytes(s.buffer_est_bytes));
    push("Video", s.video_codec ? String(s.video_codec).replace(/"/g, "") : null);
    push("Audio", s.audio_codec ? String(s.audio_codec).replace(/"/g, "") : null);
    push("FPS", s.fps || null);
    push("Pixel fmt", s.pix_fmt || null);
    push("Encoder", s.format_encoder || s.encoder || null);
    push("Created", s.format_creation_time || s.creation_time || null);
    push("Camera", s.make && s.model ? `${s.make} ${s.model}` : s.make || s.model || s.camera || null);
    push("Lens", s.lens || null);
    push("GPS", s.gps || s.location || null);

    if (meta.mustream?.error) {
      push("ffprobe", `⚠ ${meta.mustream.error}`);
    } else if (meta.mustream?.ffprobe) {
      push("ffprobe", "ok (MuStream)");
    } else if (mediaType === "video" || mediaType === "live") {
      push("ffprobe", "run `mustream probe-serve` for streams");
    }

    return rows.join("");
  }

  global.VWallMeta = {
    PROBE_BASE,
    probeItem,
    formatMetaRows,
    fmtBytes,
    fmtBitrate
  };
})(window);
