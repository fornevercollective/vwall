/**
 * Searchable metadata catalog — EXIF / ffprobe / analyzer facets (Bridge-style filter).
 */
(function (global) {
  const entries = new Map();

  const EXIF_PREFIX = /^(exif|meta|camera|lens|gps|codec|dims|encoder|make|model):/i;

  function itemKey(item) {
    return `${item.mediaType || "image"}:${item.url}`;
  }

  function flattenTags(obj, prefix, out) {
    if (!obj || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj)) {
      if (v == null) continue;
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === "object" && !Array.isArray(v)) flattenTags(v, key, out);
      else out.push(`${key}:${String(v).toLowerCase()}`);
    }
  }

  function indexFromProbe(item, probeMeta, analyzers) {
    const tokens = new Set();
    const add = (s) => {
      if (!s) return;
      String(s)
        .toLowerCase()
        .split(/[\s,;|/]+/)
        .filter((t) => t.length > 1)
        .forEach((t) => tokens.add(t));
    };

    add(item.title);
    add(item.snippet);
    add(item.url);
    add(item.mediaType);
    add(item.source);
    add(item.clusterId);

    const s = probeMeta?.summary;
    if (s) {
      add(s.format_encoder);
      add(s.format_creation_time);
      add(s.video_codec);
      add(s.audio_codec);
      add(s.pix_fmt);
      add(s.fps);
      if (s.width && s.height) {
        tokens.add(`dims:${s.width}x${s.height}`);
        add(`${s.width}x${s.height}`);
      }
      if (s.make) add(s.make);
      if (s.model) add(s.model);
      if (s.camera) add(s.camera);
      if (s.lens) add(s.lens);
      if (s.gps) add(s.gps);
    }

    const fp = probeMeta?.mustream?.ffprobe;
    if (fp?.format?.tags) flattenTags(fp.format.tags, "format", tokens);
    if (Array.isArray(fp?.streams)) {
      fp.streams.forEach((st, i) => {
        if (st.codec_name) tokens.add(`codec:${st.codec_name}`);
        if (st.tags) flattenTags(st.tags, `stream${i}`, tokens);
      });
    }

    const et = probeMeta?.mustream?.exiftool;
    if (Array.isArray(et) && et[0]) flattenTags(et[0], "exif", tokens);

    if (analyzers) {
      for (const [id, r] of Object.entries(analyzers)) {
        tokens.add(`analyzer:${id}`);
        if (r?.note) add(r.note);
        if (r?.match) add(r.match);
      }
    }

    const blob = [...tokens].join(" ");
    entries.set(itemKey(item), { key: itemKey(item), tokens, blob, updated: Date.now() });
    return blob;
  }

  function parseMetaQuery(q) {
    const raw = q.trim().toLowerCase();
    if (!raw) return { mode: "all", terms: [] };
    const terms = [];
    const parts = raw.split(/\s+/);
    for (const p of parts) {
      if (EXIF_PREFIX.test(p)) {
        const [k, ...rest] = p.split(":");
        terms.push({ type: "field", field: k, value: rest.join(":") || "" });
      } else {
        terms.push({ type: "text", value: p });
      }
    }
    return { mode: "filter", terms };
  }

  function matchesEntry(entry, parsed) {
    if (parsed.mode === "all") return true;
    const blob = entry.blob;
    return parsed.terms.every((t) => {
      if (t.type === "text") return blob.includes(t.value);
      const field = t.field.replace(/^exif$/, "exif");
      if (t.value) return blob.includes(`${field}:${t.value}`) || blob.includes(t.value);
      return blob.includes(`${field}:`);
    });
  }

  function filterItems(items, metaQuery) {
    const parsed = parseMetaQuery(metaQuery);
    if (parsed.mode === "all") return items;
    return items.filter((it) => {
      const e = entries.get(itemKey(it));
      return e ? matchesEntry(e, parsed) : false;
    });
  }

  function searchKeysForItem(item) {
    return entries.get(itemKey(item))?.blob || "";
  }

  global.VWallCatalog = {
    entries,
    itemKey,
    indexFromProbe,
    filterItems,
    parseMetaQuery,
    searchKeysForItem
  };
})(window);
