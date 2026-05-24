/**
 * Site-scoped search: https://example.com + cats  (Google-style site: also supported)
 */
(function (global) {
  function hostFromUrl(url) {
    if (!url) return null;
    try {
      const u = url.startsWith("http") ? url : `https://${url}`;
      return new URL(u).hostname.replace(/^www\./i, "").toLowerCase();
    } catch {
      return null;
    }
  }

  function parseSiteSearchInput(raw) {
    const s = (raw || "").trim();
    if (!s) {
      return { terms: "", siteHost: null, siteUrl: null, raw: s, scoped: false };
    }

    const patterns = [
      /^(https?:\/\/[^\s+]+)\s*\+\s*(.*)$/i,
      /^([a-z0-9][\w.-]*\.[a-z]{2,}(?::\d+)?(?:\/[^\s+]*)?)\s*\+\s*(.*)$/i,
      /^site:([^\s/]+)\s+(.+)$/i
    ];

    for (const re of patterns) {
      const m = s.match(re);
      if (!m) continue;
      let sitePart = m[1];
      const terms = (m[2] || "").trim();
      let siteUrl = sitePart.startsWith("http") ? sitePart : `https://${sitePart}`;
      if (!sitePart.startsWith("http")) {
        siteUrl = `https://${sitePart.replace(/\/.*$/, "")}`;
      }
      const siteHost = hostFromUrl(siteUrl);
      if (siteHost) {
        return { terms, siteHost, siteUrl, raw: s, scoped: true };
      }
    }

    return { terms: s, siteHost: null, siteUrl: null, raw: s, scoped: false };
  }

  function buildApiQuery(parsed) {
    if (!parsed?.siteHost) return (parsed?.terms || parsed?.raw || "").trim();
    if (parsed.terms) return `site:${parsed.siteHost} ${parsed.terms}`;
    return `site:${parsed.siteHost}`;
  }

  function displaySearchLabel(parsed) {
    if (!parsed?.siteHost) return parsed?.terms || parsed?.raw || "";
    if (parsed.terms) return `${parsed.siteHost} + ${parsed.terms}`;
    return parsed.siteHost;
  }

  function itemMatchesSite(item, siteHost) {
    if (!siteHost) return true;
    const h = item.host || hostFromUrl(item.url);
    if (!h) return false;
    const norm = (x) => x.replace(/^www\./i, "").toLowerCase();
    const sh = norm(siteHost);
    const ih = norm(h);
    return ih === sh || ih.endsWith("." + sh);
  }

  function isWikimediaFamily(host) {
    if (!host) return false;
    const h = host.toLowerCase();
    return (
      h.includes("wikimedia.org") ||
      h.endsWith("wikipedia.org") ||
      h === "commons.wikimedia.org"
    );
  }

  /** Openverse catalog sources keyed by site hostname */
  const OPENVERSE_SOURCE_BY_HOST = {
    "flickr.com": "flickr",
    "rawpixel.com": "rawpixel",
    "stocksnap.io": "stocksnap",
    "wordpress.org": "wordpress",
    "sketchfab.com": "sketchfab",
    "thingiverse.com": "thingiverse",
    "openclipart.org": "openclipart",
    "bioacoustica.org": "bioacoustica",
    "eol.org": "eol",
    "phylopic.org": "phylopic",
    "spacex.com": "spacex",
    "svgsilh.com": "svgsilh",
    "wellcomecollection.org": "wellcome"
  };

  function openverseSourceForHost(siteHost) {
    if (!siteHost) return null;
    const h = siteHost.replace(/^www\./i, "").toLowerCase();
    return OPENVERSE_SOURCE_BY_HOST[h] || null;
  }

  global.VWallSearchQuery = {
    hostFromUrl,
    parseSiteSearchInput,
    buildApiQuery,
    displaySearchLabel,
    itemMatchesSite,
    isWikimediaFamily,
    openverseSourceForHost
  };
})(window);
