/**
 * Wall layout sort — resolution, date, EXIF, format/codec, CDN source & region.
 */
(function (global) {
  function summary(entry) {
    return entry?.probeMeta?.summary || entry?.probeMeta?.browser || {};
  }

  function itemOf(entry) {
    return entry?.item || entry;
  }

  function resolutionOf(entry) {
    const s = summary(entry);
    const w = Number(s.width) || 0;
    const h = Number(s.height) || 0;
    return w * h;
  }

  function dateOf(entry) {
    const s = summary(entry);
    const it = itemOf(entry);
    const raw =
      s.format_creation_time ||
      s.creation_time ||
      it.published ||
      it.indexed_on ||
      null;
    if (!raw) return 0;
    const t = Date.parse(String(raw));
    return Number.isFinite(t) ? t : 0;
  }

  function exifKeyOf(entry) {
    const s = summary(entry);
    const it = itemOf(entry);
    return [
      s.make,
      s.model,
      s.lens,
      s.camera,
      s.format_encoder,
      s.encoder,
      it.title
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function formatKeyOf(entry) {
    const s = summary(entry);
    const it = itemOf(entry);
    return [
      it.mediaType,
      it.mime,
      it.filetype,
      s.video_codec,
      s.audio_codec,
      s.pix_fmt,
      s.content_type
    ]
      .filter(Boolean)
      .join("|")
      .toLowerCase();
  }

  function sourceKeyOf(entry) {
    const it = itemOf(entry);
    return (it.source || it.provider || it.host || "").toLowerCase();
  }

  function regionKeyOf(entry) {
    const it = itemOf(entry);
    const host = (it.host || "").toLowerCase();
    if (!host) return "zzz";

    let region = "global";
    const cdnHints = [
      ["wikimedia", "commons"],
      ["upload.wikimedia", "commons"],
      ["staticflickr", "flickr-us"],
      ["flickr", "flickr"],
      ["jamendo", "eu-audio"],
      ["archive.org", "archive"],
      ["cloudfront", "aws-cdn"],
      ["akamai", "akamai"],
      ["fastly", "fastly"]
    ];
    for (const [needle, label] of cdnHints) {
      if (host.includes(needle)) {
        region = label;
        break;
      }
    }

    const parts = host.split(".");
    const tld = parts.length > 1 ? parts[parts.length - 1] : "";
    const sub = parts.length > 2 ? parts[0] : "";
    return `${region}:${tld}:${sub}`;
  }

  function typeOrder(entry, mediaMeta) {
    const mt = itemOf(entry).mediaType || "image";
    return mediaMeta?.[mt]?.order ?? 99;
  }

  function sortList(list, mode, mediaMeta) {
    if (!mode || mode === "mixed") return list;

    const sorted = [...list];
    const cmpStr = (a, b) => a.localeCompare(b);
    const cmpNum = (a, b, dir = -1) => (a - b) * dir;

    switch (mode) {
      case "type":
        sorted.sort((a, b) => typeOrder(a, mediaMeta) - typeOrder(b, mediaMeta));
        break;
      case "resolution":
        sorted.sort((a, b) => cmpNum(resolutionOf(a), resolutionOf(b), -1));
        break;
      case "resolution-asc":
        sorted.sort((a, b) => cmpNum(resolutionOf(a), resolutionOf(b), 1));
        break;
      case "date":
        sorted.sort((a, b) => cmpNum(dateOf(a), dateOf(b), -1));
        break;
      case "date-asc":
        sorted.sort((a, b) => cmpNum(dateOf(a), dateOf(b), 1));
        break;
      case "exif":
        sorted.sort((a, b) => cmpStr(exifKeyOf(a), exifKeyOf(b)));
        break;
      case "format":
        sorted.sort((a, b) => cmpStr(formatKeyOf(a), formatKeyOf(b)));
        break;
      case "source":
        sorted.sort((a, b) => cmpStr(sourceKeyOf(a), sourceKeyOf(b)));
        break;
      case "cdn":
      case "region":
        sorted.sort((a, b) => cmpStr(regionKeyOf(a), regionKeyOf(b)));
        break;
      default:
        break;
    }
    return sorted;
  }

  function currentMode() {
    return document.getElementById("sortMode")?.value || "mixed";
  }

  global.VWallSort = {
    sortList,
    sortEntries: (entries, mode, mediaMeta) => sortList(entries, mode || currentMode(), mediaMeta),
    sortItems: (items, mode, mediaMeta) => sortList(items, mode || currentMode(), mediaMeta),
    resolutionOf,
    dateOf,
    currentMode
  };
})(window);
