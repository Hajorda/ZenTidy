// Zen Tidy — pure logic: grouping, naming, AI prompts and validation.
// No Zen or Firefox APIs here, so it runs in Node tests unchanged.
// eslint-disable-next-line no-var
var ZTCore = (() => {
  "use strict";

  const DEFAULTS = {
    minGroupSize: 2,
    maxGroupSize: 15,
    maxFolders: 6,
    similarity: 0.3,
    openerHubLimit: 8,
  };

  // --- Sites -------------------------------------------------------------------

  // Two-label public suffixes that are common enough to matter here.
  const SECOND_LEVEL = new Set([
    "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "ne.jp", "or.jp",
    "com.br", "com.tr", "org.tr", "gov.tr", "edu.tr", "net.tr", "com.mx", "com.ar", "co.in", "co.kr", "com.cn",
    "com.tw", "com.hk", "co.za", "com.sg", "github.io", "gitlab.io", "vercel.app", "netlify.app", "pages.dev",
    "workers.dev", "herokuapp.com", "blogspot.com", "substack.com", "medium.com", "notion.site",
  ]);

  // Sites whose subdomains are different products (mail.google.com vs docs...).
  const HOST_SCOPED = new Set(["google.com", "microsoft.com", "live.com", "office.com", "apple.com", "atlassian.net", "amazon.com", "mozilla.org", "wikipedia.org", "wikimedia.org", "yahoo.com", "zoho.com"]);

  const KNOWN_LABELS = {
    "github.com": "GitHub", "gitlab.com": "GitLab", "youtube.com": "YouTube", "reddit.com": "Reddit",
    "stackoverflow.com": "Stack Overflow", "wikipedia.org": "Wikipedia", "twitter.com": "X", "x.com": "X",
    "linkedin.com": "LinkedIn", "facebook.com": "Facebook", "instagram.com": "Instagram", "figma.com": "Figma",
    "notion.so": "Notion", "slack.com": "Slack", "amazon.com": "Amazon", "netflix.com": "Netflix",
    "spotify.com": "Spotify", "medium.com": "Medium", "developer.mozilla.org": "MDN", "npmjs.com": "npm",
    "mail.google.com": "Gmail", "calendar.google.com": "Google Calendar", "drive.google.com": "Google Drive",
    "docs.google.com/document": "Google Docs", "docs.google.com/spreadsheets": "Google Sheets",
    "docs.google.com/presentation": "Google Slides", "docs.google.com/forms": "Google Forms",
    "maps.google.com": "Google Maps", "news.ycombinator.com": "Hacker News", "chatgpt.com": "ChatGPT",
    "claude.ai": "Claude", "twitch.tv": "Twitch", "dribbble.com": "Dribbble", "behance.net": "Behance",
    "trello.com": "Trello", "jira.com": "Jira", "vercel.com": "Vercel", "cloudflare.com": "Cloudflare",
  };

  const SEARCH = [
    { host: /(^|\.)google\.[a-z.]+$/, path: /^\/search/, param: "q" },
    { host: /(^|\.)bing\.com$/, path: /^\/search/, param: "q" },
    { host: /(^|\.)duckduckgo\.com$/, path: /^\/?$/, param: "q" },
    { host: /^search\.brave\.com$/, path: /^\/search/, param: "q" },
    { host: /(^|\.)kagi\.com$/, path: /^\/search/, param: "q" },
    { host: /(^|\.)ecosia\.org$/, path: /^\/search/, param: "q" },
    { host: /(^|\.)startpage\.com$/, path: /\/search/, param: "query" },
    { host: /(^|\.)yandex\.[a-z.]+$/, path: /^\/search/, param: "text" },
    { host: /(^|\.)youtube\.com$/, path: /^\/results/, param: "search_query" },
    { host: /(^|\.)perplexity\.ai$/, path: /^\/search/, param: "q" },
  ];

  function registrable(host) {
    const parts = host.split(".");
    if (parts.length <= 2 || /^\d+(\.\d+){3}$/.test(host) || host.includes(":")) return host;
    const last2 = parts.slice(-2).join(".");
    if (SECOND_LEVEL.has(last2)) return parts.slice(-3).join(".");
    return last2;
  }

  // Describes a URL for grouping: which "site bucket" it belongs to, and
  // whether it is a search results page (grouped by its query instead).
  function siteOf(url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return { host: "", site: "", key: "", fine: "", search: null };
    }
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const site = registrable(host);
    for (const s of SEARCH) {
      if (s.host.test(host) && s.path.test(u.pathname)) {
        const q = u.searchParams.get(s.param);
        if (q) return { host, site, key: "", fine: "", search: q };
      }
    }
    const key = HOST_SCOPED.has(site) ? host : site;
    // A finer bucket used when enough tabs share it (e.g. one GitHub org).
    const seg = u.pathname.split("/").filter(Boolean);
    let fine = "";
    if ((site === "github.com" || site === "gitlab.com") && seg[0] && !/^(settings|notifications|pulls|issues|explore|marketplace|search|login|orgs)$/.test(seg[0])) {
      fine = `${site}/${seg[0].toLowerCase()}`;
    } else if (host === "docs.google.com" && seg[0]) {
      fine = `docs.google.com/${seg[0]}`;
    } else if (site === "reddit.com" && seg[0] === "r" && seg[1]) {
      fine = `reddit.com/r/${seg[1].toLowerCase()}`;
    } else if (site === "stackexchange.com") {
      fine = host;
    }
    return { host, site, key, fine, search: null };
  }

  function prettySite(key) {
    if (KNOWN_LABELS[key]) return KNOWN_LABELS[key];
    const m = key.match(/^(github\.com|gitlab\.com)\/(.+)$/);
    if (m) return `${KNOWN_LABELS[m[1]]} · ${m[2]}`;
    const r = key.match(/^reddit\.com\/r\/(.+)$/);
    if (r) return `r/${r[1]}`;
    const host = key.split("/")[0];
    if (KNOWN_LABELS[registrable(host)] && host !== registrable(host)) {
      const sub = host.split(".")[0];
      return `${KNOWN_LABELS[registrable(host)]} ${sub[0].toUpperCase()}${sub.slice(1)}`;
    }
    const label = registrable(host).split(".")[0];
    return label ? label[0].toUpperCase() + label.slice(1) : host;
  }

  // --- Titles --------------------------------------------------------------------

  const SEP_RE = /\s+[-|–—·•:»]\s+/;
  const COUNTER_RE = /^\(\d+\+?\)\s*|^\[\d+\]\s*/;

  // Strip "(3) " counters and a trailing " - Site Name" segment.
  function cleanTitle(title, { host = "", siteSuffixes = null } = {}) {
    let t = String(title || "").replace(COUNTER_RE, "").trim();
    const parts = t.split(SEP_RE);
    if (parts.length > 1) {
      const last = parts[parts.length - 1].trim();
      const norm = last.toLowerCase().replace(/[^a-z0-9]/g, "");
      const hostLabel = registrable(host).split(".")[0].replace(/[^a-z0-9]/g, "");
      const known = (siteSuffixes && siteSuffixes.has(last)) || (hostLabel && norm && (norm.includes(hostLabel) || hostLabel.includes(norm)));
      if (known && last.length <= 40) t = parts.slice(0, -1).join(" - ").trim();
    }
    return t || String(title || "").trim();
  }

  // Trailing title segments shared by 2+ tabs of one site ("… | The Verge").
  function commonSuffixes(units) {
    const bySite = new Map();
    for (const u of units) {
      const parts = String(u.title || "").split(SEP_RE);
      if (parts.length < 2) continue;
      const last = parts[parts.length - 1].trim();
      const k = `${u.site.key}\u0000${last}`;
      bySite.set(k, (bySite.get(k) || 0) + 1);
    }
    const out = new Set();
    for (const [k, n] of bySite) if (n >= 2) out.add(k.split("\u0000")[1]);
    return out;
  }

  // --- Text similarity -------------------------------------------------------------

  const STOP = new Set((
    "a an and are as at be by for from has have how i in is it its of on or that the this to was what when where who why will with you your " +
    "about after all also any can do does get got just more most new not now our out over so some than then there these they up us very we " +
    "my me no yes into vs via per use using used one two " +
    "home page login log sign signin signup welcome official site website online free best top untitled dashboard index view edit " +
    "http https www com org net html php amp " +
    "ve ile için bir bu da de mi ne en çok daha gibi olarak olan ya veya ama her şu nasıl nedir " +
    "der die das und für mit von ist le la les des et pour une el los las por con para"
  ).split(" "));

  function tokenize(text, extraStop) {
    const out = [];
    for (const m of String(text || "").toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
      const w = m[0];
      if (w.length < 2 || STOP.has(w) || (extraStop && extraStop.has(w))) continue;
      if (/^\d+$/.test(w) && w.length !== 4) continue; // keep years, drop other numbers
      out.push(w);
    }
    return out;
  }

  function vectors(docs) {
    const df = new Map();
    for (const toks of docs) for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
    const n = docs.length;
    return docs.map((toks) => {
      const tf = new Map();
      for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
      const v = new Map();
      let norm = 0;
      for (const [t, c] of tf) {
        const w = (1 + Math.log(c)) * (Math.log((n + 1) / ((df.get(t) || 0) + 1)) + 1);
        v.set(t, w);
        norm += w * w;
      }
      norm = Math.sqrt(norm) || 1;
      for (const [t, w] of v) v.set(t, w / norm);
      return v;
    });
  }

  function cosine(a, b) {
    if (a.size > b.size) [a, b] = [b, a];
    let s = 0;
    for (const [t, w] of a) {
      const o = b.get(t);
      if (o) s += w * o;
    }
    return s;
  }

  function centroid(vs) {
    const c = new Map();
    for (const v of vs) for (const [t, w] of v) c.set(t, (c.get(t) || 0) + w);
    let norm = 0;
    for (const w of c.values()) norm += w * w;
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of c) c.set(t, w / norm);
    return c;
  }

  // --- Preparing units ---------------------------------------------------------------
  // A unit is one tab, or one split view (moved as a whole).
  // input: [{ id, url, title, openerId?, lastAccessed?, selected? }]

  function prepare(input) {
    const units = input.map((u) => ({ ...u, site: siteOf(u.url) }));
    const suffixes = commonSuffixes(units);
    const fineCount = new Map();
    for (const u of units) if (u.site.fine) fineCount.set(u.site.fine, (fineCount.get(u.site.fine) || 0) + 1);
    for (const u of units) {
      u.bucket = u.site.search ? "" : u.site.fine && fineCount.get(u.site.fine) >= 2 ? u.site.fine : u.site.key;
      u.clean = u.site.search ? u.site.search : cleanTitle(u.title, { host: u.site.host, siteSuffixes: suffixes });
      u.tokens = tokenize(u.clean);
    }
    return units;
  }

  // --- Grouping (local, no AI) ---------------------------------------------------------

  function groupTabs(input, options = {}) {
    const opt = { ...DEFAULTS, ...options };
    const units = prepare(input);
    const n = units.length;
    const parent = units.map((_, i) => i);
    const size = units.map(() => 1);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const union = (a, b, cap = Infinity) => {
      a = find(a);
      b = find(b);
      if (a === b || size[a] + size[b] > cap) return;
      if (size[a] < size[b]) [a, b] = [b, a];
      parent[b] = a;
      size[a] += size[b];
    };

    // 1. Same site bucket.
    const byBucket = new Map();
    units.forEach((u, i) => {
      if (!u.bucket) return;
      if (byBucket.has(u.bucket)) union(byBucket.get(u.bucket), i);
      else byBucket.set(u.bucket, i);
    });

    // 2. Opener chains (tabs opened from a search or article), skipping hubs.
    const index = new Map(units.map((u, i) => [u.id, i]));
    const children = new Map();
    for (const u of units) if (u.openerId && index.has(u.openerId)) children.set(u.openerId, (children.get(u.openerId) || 0) + 1);
    units.forEach((u, i) => {
      if (!u.openerId || !index.has(u.openerId) || children.get(u.openerId) > opt.openerHubLimit) return;
      union(i, index.get(u.openerId), opt.maxGroupSize);
    });

    // 3. Merge clusters with similar titles (average-linkage on centroids).
    const vecs = vectors(units.map((u) => u.tokens));
    let clusters = new Map();
    units.forEach((u, i) => {
      const r = find(i);
      if (!clusters.has(r)) clusters.set(r, []);
      clusters.get(r).push(i);
    });
    clusters = [...clusters.values()];
    let cents = clusters.map((c) => centroid(c.map((i) => vecs[i])));
    for (;;) {
      let best = null;
      for (let a = 0; a < clusters.length; a++) {
        for (let b = a + 1; b < clusters.length; b++) {
          if (clusters[a].length + clusters[b].length > opt.maxGroupSize) continue;
          const s = cosine(cents[a], cents[b]);
          if (s >= opt.similarity && (!best || s > best.s)) best = { a, b, s };
        }
      }
      if (!best) break;
      clusters[best.a] = clusters[best.a].concat(clusters[best.b]);
      cents[best.a] = centroid(clusters[best.a].map((i) => vecs[i]));
      clusters.splice(best.b, 1);
      cents.splice(best.b, 1);
    }

    // 4. Keep real groups, largest first, in sidebar order within each group.
    const groups = clusters
      .filter((c) => c.length >= opt.minGroupSize)
      .map((c) => c.sort((x, y) => x - y))
      .sort((x, y) => y.length - x.length || x[0] - y[0])
      .slice(0, opt.maxFolders);
    const used = new Set();
    const names = new Map();
    const result = groups.map((c) => {
      const members = c.map((i) => units[i]);
      const name = uniqueName(nameGroup(members, vecs, c), names);
      c.forEach((i) => used.add(i));
      return { name, ids: members.map((u) => u.id), bucket: dominantBucket(members) };
    });
    return { groups: result, leftovers: units.filter((_, i) => !used.has(i)).map((u) => u.id) };
  }

  function dominantBucket(members) {
    const count = new Map();
    for (const m of members) if (m.bucket) count.set(m.bucket, (count.get(m.bucket) || 0) + 1);
    let best = "", bestN = 0;
    for (const [k, c] of count) if (c > bestN) [best, bestN] = [k, c];
    return { key: best, share: members.length ? bestN / members.length : 0 };
  }

  // --- Naming ---------------------------------------------------------------------------

  function titleCase(w) {
    if (/^[a-z]+$/.test(w) && w.length <= 3 && !/[aeiou]/.test(w)) return w.toUpperCase(); // css, npm → CSS, NPM
    return w[0].toLocaleUpperCase() + w.slice(1);
  }

  function nameGroup(members, vecs, idx) {
    const dom = dominantBucket(members);
    if (dom.key && dom.share === 1) {
      // Prefer a title ending every tab shares ("… - Jira") for unknown sites.
      const known = KNOWN_LABELS[dom.key] || /^(github|gitlab)\.com\/|^reddit\.com\/r\//.test(dom.key);
      const ends = members.map((m) => String(m.title || "").split(SEP_RE)).filter((p) => p.length > 1).map((p) => p[p.length - 1].trim());
      if (!known && ends.length === members.length && ends.every((e) => e === ends[0]) && ends[0].length <= 30) return ends[0];
      return prettySite(dom.key);
    }

    // Topic words: the most widely shared word, plus a second one only if
    // most tabs share it too. Words keep their original spelling.
    const score = new Map(), docs = new Map(), spelling = new Map();
    members.forEach((m, k) => {
      const v = vecs[idx[k]];
      for (const [t, w] of v) score.set(t, (score.get(t) || 0) + w);
      for (const t of new Set(m.tokens)) docs.set(t, (docs.get(t) || 0) + 1);
      for (const w of String(m.clean).matchAll(/[\p{L}\p{N}]+/gu)) {
        const low = w[0].toLowerCase();
        if (!spelling.has(low) || (spelling.get(low) === low && w[0] !== low)) spelling.set(low, w[0]);
      }
    });
    const siteWord = new Set(members.map((m) => registrable(m.site.host).split(".")[0]));
    const ranked = [...score.keys()]
      .filter((t) => docs.get(t) >= Math.min(2, members.length) && !/^\d+$/.test(t))
      .sort((a, b) => docs.get(b) - docs.get(a) || siteWord.has(b) - siteWord.has(a) || score.get(b) - score.get(a));
    const words = ranked.slice(0, 1);
    if (ranked[1] && docs.get(ranked[1]) >= Math.max(2, Math.ceil(members.length * 0.6))) words.push(ranked[1]);
    if (words.length) return words.map((t) => spelling.get(t) || t).map((w) => (w === w.toLowerCase() ? titleCase(w) : w)).join(" ");
    if (dom.key && dom.share >= 0.5) return prettySite(dom.key);
    return "Tabs";
  }

  function uniqueName(name, seen) {
    name = name.slice(0, 40).trim() || "Tabs";
    const n = (seen.get(name) || 0) + 1;
    seen.set(name, n);
    return n === 1 ? name : `${name} ${n}`;
  }

  // --- Existing folders ----------------------------------------------------------------------
  // folders: [{ id, name, urls: [] }]. Returns { [groupIndex]: folderId }.

  function matchFolders(groups, folders) {
    const sig = folders.map((f) => {
      const units = prepare(f.urls.map((url, i) => ({ id: String(i), url, title: "" })));
      const dom = dominantBucket(units);
      return { id: f.id, name: normName(f.name), key: units.length >= 2 && dom.share >= 0.5 ? dom.key : "" };
    });
    const out = {};
    groups.forEach((g, gi) => {
      const hit =
        sig.find((f) => f.name && f.name === normName(g.name)) ||
        (g.bucket && g.bucket.share >= 0.6 && g.bucket.key ? sig.find((f) => f.key === g.bucket.key) : null);
      if (hit) out[gi] = hit.id;
    });
    return out;
  }

  const normName = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

  // --- Duplicates -------------------------------------------------------------------------------

  function normUrl(url) {
    try {
      const u = new URL(url);
      u.hash = "";
      let s = u.href;
      if (s.endsWith("/")) s = s.slice(0, -1);
      return s.replace(/^https?:\/\/www\./, "https://").replace(/^http:/, "https:");
    } catch {
      return url;
    }
  }

  // Returns ids to close: keeps the selected, else most recently used, copy.
  function findDuplicates(units) {
    const byUrl = new Map();
    for (const u of units) {
      const k = normUrl(u.url);
      if (!byUrl.has(k)) byUrl.set(k, []);
      byUrl.get(k).push(u);
    }
    const close = [];
    for (const list of byUrl.values()) {
      if (list.length < 2) continue;
      const keep = list.find((u) => u.selected) || [...list].sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
      for (const u of list) if (u !== keep) close.push(u.id);
    }
    return close;
  }

  // --- AI ---------------------------------------------------------------------------------------
  // Tabs are sent as numbered lines with a cleaned title and hostname only.

  const AI_GROUP_SCHEMA = {
    type: "object",
    properties: {
      groups: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            tabs: { type: "array", items: { type: "integer" } },
          },
          required: ["name", "tabs"],
          additionalProperties: false,
        },
      },
    },
    required: ["groups"],
    additionalProperties: false,
  };

  function aiGroupRequest(input, options = {}) {
    const opt = { ...DEFAULTS, ...options };
    const units = prepare(input);
    const lines = units.map((u, i) => `${i + 1}. ${u.clean.slice(0, 120)} (${u.site.host || "no host"})`);
    const system =
      "You organise browser tabs into folders by topic or task. " +
      `Make at most ${opt.maxFolders} groups of ${opt.minGroupSize} to ${opt.maxGroupSize} tabs each. ` +
      "Only group tabs that clearly belong together; leave the rest out. " +
      "Name each group in 1 to 3 words, in the language of its tabs, without emoji. " +
      "Each tab number may appear in at most one group.";
    const user = `Tabs:\n${lines.join("\n")}\n\nReturn the groups as JSON.`;
    return { system, user, schema: AI_GROUP_SCHEMA, ids: units.map((u) => u.id) };
  }

  // Turns the model's JSON into safe groups; anything invalid is dropped.
  function parseAiGroups(data, ids, options = {}) {
    const opt = { ...DEFAULTS, ...options };
    if (!data || !Array.isArray(data.groups)) throw new Error("AI response has no groups");
    const taken = new Set();
    const names = new Map();
    const groups = [];
    for (const g of data.groups) {
      if (!g || !Array.isArray(g.tabs)) continue;
      const members = [];
      for (const n of g.tabs) {
        const i = Number(n) - 1;
        if (!Number.isInteger(i) || i < 0 || i >= ids.length || taken.has(i)) continue;
        taken.add(i);
        members.push(i);
      }
      if (members.length < opt.minGroupSize) {
        members.forEach((i) => taken.delete(i));
        continue;
      }
      const clean = String(g.name || "").replace(/[\u0000-\u001f<>]/g, "").trim();
      groups.push({ name: uniqueName(clean || "Tabs", names), ids: members.sort((a, b) => a - b).map((i) => ids[i]), bucket: { key: "", share: 0 } });
      if (groups.length >= opt.maxFolders) break;
    }
    return { groups, leftovers: ids.filter((_, i) => !taken.has(i)) };
  }

  const AI_TITLE_SCHEMA = {
    type: "object",
    properties: {
      titles: {
        type: "array",
        items: {
          type: "object",
          properties: { tab: { type: "integer" }, title: { type: "string" } },
          required: ["tab", "title"],
          additionalProperties: false,
        },
      },
    },
    required: ["titles"],
    additionalProperties: false,
  };

  function aiTitleRequest(input) {
    const units = prepare(input);
    const lines = units.map((u, i) => `${i + 1}. ${String(u.title || "").slice(0, 160)} (${u.site.host || "no host"})`);
    const system =
      "You shorten browser tab titles. For each tab, write a clear title of at most 4 words, " +
      "in the language of the original, without the site name unless it is the whole point, without emoji.";
    return { system, user: `Tabs:\n${lines.join("\n")}\n\nReturn the titles as JSON.`, schema: AI_TITLE_SCHEMA, ids: units.map((u) => u.id) };
  }

  function parseAiTitles(data, ids) {
    if (!data || !Array.isArray(data.titles)) throw new Error("AI response has no titles");
    const out = {};
    for (const t of data.titles) {
      const i = Number(t?.tab) - 1;
      const title = String(t?.title || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 60);
      if (Number.isInteger(i) && i >= 0 && i < ids.length && title) out[ids[i]] = title;
    }
    return out;
  }

  // Local title cleanup when no AI is configured.
  function cleanTitles(input) {
    const units = prepare(input);
    const out = {};
    for (const u of units) {
      const t = u.site.search ? u.title : u.clean;
      if (t && t !== u.title) out[u.id] = t.slice(0, 60);
    }
    return out;
  }

  // --- Auto-tidy ------------------------------------------------------------------------------------

  function shouldAutoTidy({ enabled, count, threshold, lastTidyAt, now, cooldownMs = 10 * 60_000 }) {
    return !!enabled && count >= threshold && now - (lastTidyAt || 0) >= cooldownMs;
  }

  return {
    DEFAULTS, siteOf, prettySite, registrable, cleanTitle, tokenize, prepare,
    groupTabs, matchFolders, findDuplicates, normUrl,
    aiGroupRequest, parseAiGroups, aiTitleRequest, parseAiTitles, cleanTitles,
    shouldAutoTidy,
  };
})();
