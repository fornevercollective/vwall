/**
 * Media resolution ladder (“data lake” style manifests for multi-URL tiles).
 *
 * Source adapters (Wikimedia, Openverse, CDN, MuStream tiling, IIIF…) can populate
 * `item.variantUrls` with ordered or tagged variants; loaders pick the cheapest tier first
 * then promote (see app.js LOD path for full originals).
 *
 * Shape:
 * @typedef {{
 *   id?: string,
 *   role?: "variant"|"preview"|"full"|"tile"|string,
 *   url: string,
 *   maxEdge?: number|null,
 *   bytesHint?: number|null,
 * }} LadderTierInput
 *
 * @typedef {LadderTierInput & {
 *   id: string,
 *   role: string,
 *   maxEdge?: number|null
 * }} ResolvedLadderTier
 *
 * @typedef {{ tiers: ResolvedLadderTier[], canonicalKey: string }} MediaLadder
 */
(function (global) {
  function ladderFingerprint(item) {
    const v = Array.isArray(item.variantUrls) ? item.variantUrls.map((x) => x.url).join("\n") : "";
    return `${item.mediaType}:${item.url || ""}:${item.thumbUrl || ""}:${v}`;
  }

  /** @param {{ url: string } & Partial<ResolvedLadderTier>} tier */
  function buildLadder(item) {
    const tiers = /** @type {ResolvedLadderTier[]} */ ([]);
    const seen = new Set();

    /** @param {Partial<ResolvedLadderTier>} t */
    const add = (t) => {
      if (!t?.url || seen.has(t.url)) return;
      seen.add(t.url);
      const id =
        typeof t.id === "string"
          ? t.id
          : `t${tiers.length}`;
      const role =
        typeof t.role === "string"
          ? t.role
          : "variant";
      tiers.push({
        id,
        role,
        url: t.url,
        maxEdge: t.maxEdge == null ? null : t.maxEdge,
        bytesHint: t.bytesHint == null ? null : t.bytesHint
      });
    };

    /** @type {LadderTierInput[]} */
    const raw = Array.isArray(item.variantUrls) ? [...item.variantUrls] : [];
    raw.sort(
      (a, b) => (Number(a.maxEdge || 999999) || 999999) - (Number(b.maxEdge || 999999) || 999999)
    );
    for (const v of raw) {
      add({
        id: typeof v.id === "string"
          ? v.id
          : undefined,
        role: typeof v.role === "string"
          ? v.role
          : "variant",
        url: v.url,
        maxEdge:
          typeof v.maxEdge === "number"
            ? v.maxEdge
            : typeof v.width === "number"
              ? Math.max(Number(v.width) || 0, Number(v.height) || 0) || null
              : null
      });
    }

    const main = typeof item.url === "string"
      ? item.url
      : "";
    const thumb = typeof item.thumbUrl === "string"
      ? item.thumbUrl
      : "";

    if (thumb && thumb !== main) {
      const te =
        typeof item.thumbMaxEdge === "number"
          ? item.thumbMaxEdge
          : 512;
      add({
        id: "ingest-thumb",
        role: "preview",
        url: thumb,
        maxEdge: te
      });
    }

    add({
      id: "original",
      role: "full",
      url: main || thumb,
      maxEdge: null
    });

    /** @returns {ResolvedLadderTier | null} */
    function cheapestPreviewTier() {
      const prev = tiers.filter((t) => t.role !== "full" && t.url);
      return prev.length
        ? prev[0]
        : null;
    }

    /** @returns {ResolvedLadderTier | null} */
    function fullTier() {
      return tiers.find((t) => t.role === "full") ?? tiers.at(-1) ?? null;
    }

    /** @returns {ResolvedLadderTier[]} */
    function mipChainAsc() {
      const nonFull = tiers.filter((t) => t.role !== "full" && t.url);
      nonFull.sort(
        (a, b) =>
          (a.maxEdge == null ? 1e12 : Number(a.maxEdge)) -
          (b.maxEdge == null ? 1e12 : Number(b.maxEdge))
      );
      return [...nonFull, ...(tiers.filter((t) => t.role === "full"))].filter(Boolean);
    }

    return {
      tiers,
      canonicalKey: `${item.mediaType || ""}:${main || thumb}`,
      cheapestPreviewTier,
      fullTier,
      mipChainAsc
    };
  }

  /**
   * @param {unknown} item — normalized media row (`url`, optional `thumbUrl`, `thumbMaxEdge`, `variantUrls`)
   * @returns {ReturnType<typeof buildLadder>}
   */
  function ensureItemLadder(item) {
    if (!item || typeof item !== "object") {
      /** @type {any} */
      const empty = { tiers: [], canonicalKey: "" };
      empty.cheapestPreviewTier = () => null;
      empty.fullTier = () => null;
      empty.mipChainAsc = () => [];
      return empty;
    }

    const fp = ladderFingerprint(item);
    /** @type {any} */
    const it = item;
    if (!it.mediaLadder || it._mediaLadderFp !== fp) {
      it.mediaLadder = buildLadder(item);
      it._mediaLadderFp = fp;
    }

    /** @type {any} */
    return it.mediaLadder;
  }

  global.VWallLadder = {
    buildLadder,
    ensureItemLadder,
    ladderFingerprint,
    ORDER_FIFO: /** @type {const} */ ("fifo"),
    ORDER_SPATIAL: /** @type {const} */ ("spatial"),
    /** Roles reserved for ingestion pipes (CDN / IIIF / MuStream raster tiles …) */
    ROLES: ["variant", "preview", "full", "tile", "derivative"]
  };
})(window);
