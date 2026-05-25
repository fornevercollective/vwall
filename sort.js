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

  function framingKeyOf(entry) {
    const s = summary(entry);
    const w = Number(s.width) || 0;
    const h = Number(s.height) || 0;
    if (!w || !h) return "4:unknown";
    const ratio = w / h;
    if (ratio >= 2.1) return "0:ultrawide";
    if (ratio >= 1.35) return "1:landscape";
    if (ratio <= 0.7) return "3:portrait";
    return "2:square";
  }

  function cameraAngleKeyOf(entry) {
    const s = summary(entry);
    const it = itemOf(entry);
    const corpus = [
      s.camera_angle,
      s.viewpoint,
      s.description,
      it.title,
      it.snippet
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!corpus) return "9:unknown";
    if (/(aerial|drone|bird'?s[- ]eye|top[- ]down|overhead)/.test(corpus)) return "0:top";
    if (/(low[- ]angle|worm'?s[- ]eye|upward|from below)/.test(corpus)) return "1:low";
    if (/(high[- ]angle|looking down|from above)/.test(corpus)) return "2:high";
    if (/(close[- ]up|macro|detail shot)/.test(corpus)) return "3:close";
    if (/(wide shot|establishing|panorama|long shot)/.test(corpus)) return "4:wide";
    return "5:neutral";
  }

  function positionKeyOf(entry) {
    const s = summary(entry);
    const it = itemOf(entry);
    const corpus = [
      s.position,
      s.subject_position,
      s.camera_position,
      it.title,
      it.snippet
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!corpus) return "9:unknown";
    if (/(center|centred|centered|middle)/.test(corpus)) return "0:center";
    if (/(left|left-side|left side)/.test(corpus)) return "1:left";
    if (/(right|right-side|right side)/.test(corpus)) return "2:right";
    if (/(foreground|front)/.test(corpus)) return "3:front";
    if (/(background|rear|back)/.test(corpus)) return "4:back";
    return "5:mixed";
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

  function statusOrder(entry) {
    const s = entry?.thumbState;
    if (s === "loaded") return 0;
    if (s === "loading") return 1;
    if (s === "failed") return 3;
    return 2;
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
      case "loaded":
        sorted.sort((a, b) => statusOrder(a) - statusOrder(b));
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
      case "framing":
        sorted.sort((a, b) => cmpStr(framingKeyOf(a), framingKeyOf(b)));
        break;
      case "camera-angle":
        sorted.sort((a, b) => cmpStr(cameraAngleKeyOf(a), cameraAngleKeyOf(b)));
        break;
      case "position":
        sorted.sort((a, b) => cmpStr(positionKeyOf(a), positionKeyOf(b)));
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
