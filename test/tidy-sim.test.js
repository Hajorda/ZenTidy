// Runs the real mod scripts (core, ai, tidy) against a fake in-memory sidebar.
// Only the Zen adapter (ZTZen) is faked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGlobals } from "./load.js";
import { fixtures } from "./fixtures.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

function makeBrowser({ prefs: initialPrefs = {}, fetchFn } = {}) {
  let nextId = 1;
  const tabs = new Map(); // id -> tab
  const space = { id: "space-1", unpinned: [], folders: [] }; // folders: { id, label, items: [tab] }
  const toasts = [];
  const closedLog = [];
  const reopened = [];
  const prefs = new Map(Object.entries(initialPrefs));
  const observers = new Set();
  const logins = [];
  const listeners = new Map();

  const newTab = (url, title, extra = {}) => {
    const t = { id: `tab-${nextId++}`, url, label: title, pinned: false, selected: false, lastAccessed: nextId, ...extra };
    tabs.set(t.id, t);
    return t;
  };
  const folderOf = (t) => space.folders.find((f) => f.items.includes(t)) || null;
  const detach = (t) => {
    space.unpinned = space.unpinned.filter((x) => x !== t);
    for (const f of space.folders) f.items = f.items.filter((x) => x !== t);
  };
  const unit = (t) => ({ id: t.id, el: t, tabs: [t], url: t.url, title: t.label, openerId: t.openerId || null, lastAccessed: t.lastAccessed, selected: t.selected, busy: false });

  const Zen = {
    supported: true,
    whenReady: async () => {},
    activeSpaceId: () => space.id,
    unpinnedUnits: () => space.unpinned.map(unit),
    spaceFolders: () => space.folders.map((f) => ({ id: f.id, name: f.label, urls: f.items.map((t) => t.url) })),
    getFolder: (id) => space.folders.find((f) => f.id === id) || null,
    getTab: (id) => tabs.get(id) || null,
    itemOf: (t) => t,
    folderOf,
    folderSpace: () => space.id,
    folderItemTabs: (f) => [...f.items],
    folderAllTabs: (f) => [...f.items],
    isEmptyFolder: (f) => f.items.length === 0,
    createFolder(units, name) {
      const f = { id: `folder-${nextId++}`, label: name, items: [] };
      space.folders.unshift(f);
      for (const u of units) {
        detach(u.tabs[0]);
        u.tabs[0].pinned = true;
        f.items.push(u.tabs[0]);
      }
      return f;
    },
    addToFolder(f, u) {
      detach(u.tabs[0]);
      u.tabs[0].pinned = true;
      f.items.push(u.tabs[0]);
    },
    unfolderAndUnpin(t) {
      if (!t.pinned) return;
      detach(t);
      t.pinned = false;
      space.unpinned.unshift(t); // Zen puts unpinned tabs at the top
    },
    placeUnpinned(t, ref) {
      space.unpinned = space.unpinned.filter((x) => x !== t);
      const i = ref ? space.unpinned.indexOf(ref) : -1;
      if (i >= 0) space.unpinned.splice(i, 0, t);
      else space.unpinned.push(t);
    },
    deleteFolder: async (f) => {
      space.folders = space.folders.filter((x) => x !== f);
    },
    closeTab(t) {
      detach(t);
      tabs.delete(t.id);
      closedLog.push(t.url);
    },
    reopenClosed(url) {
      reopened.push(url);
      space.unpinned.unshift(newTab(url, "reopened"));
      return true;
    },
    tabTitleInfo: (t) => ({ id: t.id, url: t.url, title: t.label, staticLabel: t.zenStaticLabel }),
    setTabLabel(t, l) {
      t.zenStaticLabel = l;
      t.label = l;
    },
    restoreTabLabel(t, prev) {
      if (typeof prev === "string") t.zenStaticLabel = t.label = prev;
      else {
        delete t.zenStaticLabel;
        t.label = t.originalLabel;
      }
    },
    toast: (text, opts = {}) => toasts.push({ text, ...opts }),
    setButtonsBusy() {},
    markTidyFolders(ids) {
      for (const f of space.folders) f.tidy = ids.has(f.id);
    },
    ensureSeparatorButtons() {},
    observeSidebar: () => () => {},
    folderMenu: () => null,
    spaceMenu: () => null,
  };

  const Services = {
    prefs: {
      PREF_STRING: 32, PREF_INT: 64, PREF_BOOL: 128, PREF_INVALID: 0,
      getPrefType: (k) => (!prefs.has(k) ? 0 : typeof prefs.get(k) === "boolean" ? 128 : typeof prefs.get(k) === "number" ? 64 : 32),
      getBoolPref: (k) => prefs.get(k),
      getIntPref: (k) => prefs.get(k),
      getStringPref: (k, d) => (prefs.has(k) ? prefs.get(k) : d),
      setStringPref(k, v) {
        prefs.set(k, v);
        for (const o of observers) o.observe();
      },
      addObserver: (k, o) => observers.add(o),
      removeObserver: (k, o) => observers.delete(o),
    },
    logins: {
      searchLoginsAsync: async ({ origin, httpRealm }) => logins.filter((l) => l.origin === origin && l.httpRealm === httpRealm),
      addLoginAsync: async (l) => logins.push(l),
      removeLogin: (l) => logins.splice(logins.indexOf(l), 1),
    },
    prompt: {},
    wm: { getMostRecentWindow: () => win },
  };
  function LoginInfo(origin, action, httpRealm, username, password) {
    Object.assign(this, { origin, httpRealm, username, password });
  }
  const win = {
    addEventListener(t, f) {
      if (!listeners.has(t)) listeners.set(t, new Set());
      listeners.get(t).add(f);
    },
    removeEventListener: (t, f) => listeners.get(t)?.delete(f),
    dispatch(t, ev = {}) {
      for (const f of [...(listeners.get(t) || [])]) f({ type: t, preventDefault() {}, stopPropagation() {}, ...ev });
    },
  };

  const ctx = loadGlobals(["core.uc.js", "ai.uc.js"], {
    window: win, Services, Ci: {}, Components: { Constructor: () => LoginInfo }, AppConstants: { platform: "linux" },
    fetch: fetchFn || (async () => { throw new Error("no network in tests"); }),
  });
  ctx.ZTZen = Zen; // tidy.uc.js runs in this same global, after core and ai
  return {
    ctx, space, tabs, toasts, closedLog, reopened, prefs, logins, win,
    newTab,
    addUnpinned(list) {
      const out = list.map(([url, title, opener], i, arr) => newTab(url, title, { originalLabel: title }));
      list.forEach(([, , opener], i) => {
        if (opener !== undefined) out[i].openerId = out[opener].id;
      });
      space.unpinned.push(...out);
      return out;
    },
    get Tidy() { return win.ZenTidy; },
    lastToast: () => toasts[toasts.length - 1],
  };
}

async function start(b) {
  const { readFileSync } = await import("node:fs");
  const vm = await import("node:vm");
  vm.runInContext(readFileSync(new URL("../mod/tidy.uc.js", import.meta.url), "utf8"), b.ctx, { filename: "tidy.uc.js" });
  await tick();
  return b;
}

const urls = (list) => list.map((t) => t.url);

test("tidy groups unpinned tabs into named folders, and undo restores everything", async () => {
  const b = await start(makeBrowser());
  const tabs = b.addUnpinned(fixtures[0].tabs);
  const before = urls(b.space.unpinned);

  await b.Tidy.tidy();
  const names = b.space.folders.map((f) => f.label);
  assert.equal(b.space.folders.length, 5, names.join(", "));
  assert.ok(names.some((n) => /lisbon/i.test(n)) && names.includes("MDN") && names.includes("GitHub · zen-browser"), names.join(", "));
  assert.deepEqual(urls(b.space.unpinned), ["https://mail.google.com/mail/u/0/#inbox"], "only the loner stays unpinned");
  assert.ok(b.space.folders.every((f) => f.items.every((t) => t.pinned)));
  assert.ok(b.space.folders.every((f) => f.tidy), "folders are marked as Tidy folders");
  const toast = b.lastToast();
  assert.match(toast.text, /Tidied 15 tabs into 5 folders/);
  assert.equal(toast.button, "Undo");

  await toast.onButton();
  assert.equal(b.space.folders.length, 0, "tidy folders removed");
  assert.deepEqual(urls(b.space.unpinned), before, "original order restored");
  assert.ok(tabs.every((t) => !t.pinned));
  assert.deepEqual(JSON.parse(b.prefs.get("zen.tidy.folders")), []);
});

test("nothing to do: too few tabs, or nothing in common", async () => {
  const b = await start(makeBrowser());
  b.addUnpinned([["https://a.com", "A"]]);
  await b.Tidy.tidy();
  assert.equal(b.lastToast().text, "Nothing to tidy");
  b.addUnpinned(fixtures[3].tabs);
  await b.Tidy.tidy();
  assert.equal(b.lastToast().text, "Nothing to group");
  assert.equal(b.space.folders.length, 0);
});

test("close duplicates (opt-in) keeps the selected copy and undo reopens the rest", async () => {
  const b = await start(makeBrowser({ prefs: { "zen.tidy.close-duplicates": true } }));
  const t = b.addUnpinned([
    ["https://github.com/a/b", "Repo"], ["https://github.com/a/b#readme", "Repo"], ["https://github.com/a/c", "Other"],
    ["https://x.com/1", "X one"], ["https://x.com/1/", "X one again"],
  ]);
  t[1].selected = true;
  await b.Tidy.tidy();
  // github: the selected copy stays; x.com: the more recently used copy stays.
  assert.deepEqual(b.closedLog.sort(), ["https://github.com/a/b", "https://x.com/1"]);
  assert.ok(b.tabs.has(t[1].id), "selected copy kept");
  assert.match(b.lastToast().text, /closed 2 duplicates/);
  await b.lastToast().onButton();
  assert.deepEqual(b.reopened.sort(), ["https://github.com/a/b", "https://x.com/1"]);
});

test("merge into existing folders (opt-in), and undo leaves that folder alone", async () => {
  const b = await start(makeBrowser({ prefs: { "zen.tidy.merge-existing": true } }));
  const existing = { id: "folder-existing", label: "Zen dev", items: [b.newTab("https://github.com/zen-browser/www", "www"), b.newTab("https://github.com/zen-browser/docs", "docs")] };
  existing.items.forEach((t) => (t.pinned = true));
  b.space.folders.push(existing);
  const added = b.addUnpinned([
    ["https://github.com/zen-browser/desktop/issues/1", "Issue 1 · zen-browser/desktop"],
    ["https://github.com/zen-browser/desktop/issues/2", "Issue 2 · zen-browser/desktop"],
    ["https://www.figma.com/design/a", "A – Figma"], ["https://www.figma.com/design/b", "B – Figma"],
  ]);
  await b.Tidy.tidy();
  assert.equal(existing.items.length, 4, "GitHub tabs joined the existing folder");
  assert.equal(b.space.folders.length, 2, "only Figma got a new folder");
  await b.lastToast().onButton();
  assert.equal(existing.items.length, 2, "undo took them back out");
  assert.ok(b.space.folders.includes(existing), "existing folder kept");
  assert.deepEqual(urls(b.space.unpinned), urls(added));
});

test("AI grouping: uses the model's groups, and falls back to local on error", async () => {
  const replies = [];
  const fetchFn = async (url, init) => {
    const r = replies.shift();
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  const b = await start(makeBrowser({ prefs: { "zen.tidy.ai-provider": "anthropic" }, fetchFn }));
  b.logins.push({ origin: "chrome://zen-tidy", httpRealm: "anthropic", username: "api-key", password: "sk-test" });
  b.addUnpinned(fixtures[0].tabs.slice(0, 4));

  replies.push({ status: 200, body: { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ groups: [{ name: "Lisbon trip", tabs: [1, 2, 3, 4] }] }) }] } });
  await b.Tidy.tidy();
  assert.deepEqual(b.space.folders.map((f) => f.label), ["Lisbon trip"]);
  await b.lastToast().onButton();

  replies.push({ status: 401, body: { error: { message: "invalid x-api-key" } } });
  await b.Tidy.tidy();
  assert.equal(b.space.folders.length, 1, "local grouping still tidied");
  assert.match(b.lastToast().text, /API key is missing or wrong; used local grouping/);
});

test("tabs closed while the AI is thinking are skipped", async () => {
  let b;
  const fetchFn = async () => {
    const victim = b.space.unpinned[0];
    b.space.unpinned = b.space.unpinned.filter((t) => t !== victim);
    b.tabs.delete(victim.id);
    return { ok: true, status: 200, json: async () => ({ message: { content: JSON.stringify({ groups: [{ name: "All", tabs: [1, 2, 3] }] }) } }) };
  };
  b = await start(makeBrowser({ prefs: { "zen.tidy.ai-provider": "ollama" }, fetchFn }));
  b.addUnpinned([["https://a.com/1", "a"], ["https://b.com/1", "b"], ["https://c.com/1", "c"]]);
  await b.Tidy.tidy();
  assert.equal(b.space.folders[0].items.length, 2);
});

test("untidy a folder puts its tabs back at the top of unpinned", async () => {
  const b = await start(makeBrowser());
  b.addUnpinned(fixtures[1].tabs);
  await b.Tidy.tidy();
  const docs = b.space.folders.find((f) => f.label === "Google Docs");
  const docTabs = [...docs.items];
  await b.Tidy.untidyFolder(docs);
  assert.ok(!b.space.folders.includes(docs));
  assert.deepEqual(b.space.unpinned.slice(0, 2), docTabs);
  assert.ok(!JSON.parse(b.prefs.get("zen.tidy.folders")).includes(docs.id));
  await b.Tidy.untidyAll("space-1");
  assert.equal(b.space.folders.length, 0);
});

test("tidy titles cleans labels locally and can be undone", async () => {
  const b = await start(makeBrowser());
  const t = b.addUnpinned([["https://www.youtube.com/watch?v=1", "(3) Lo-fi beats - YouTube"], ["https://www.youtube.com/watch?v=2", "Jazz for work - YouTube"]]);
  await b.Tidy.tidy();
  const folder = b.space.folders[0];
  await b.Tidy.tidyTitles(folder);
  assert.deepEqual(t.map((x) => x.label), ["Lo-fi beats", "Jazz for work"]);
  b.lastToast().onButton();
  assert.deepEqual(t.map((x) => x.label), ["(3) Lo-fi beats - YouTube", "Jazz for work - YouTube"]);
});

test("keyboard shortcut runs tidy", async () => {
  const b = await start(makeBrowser());
  b.addUnpinned(fixtures[1].tabs);
  b.win.dispatch("keydown", { ctrlKey: true, altKey: true, shiftKey: false, metaKey: false, code: "KeyY", key: "y" });
  await tick();
  await tick();
  assert.ok(b.space.folders.length > 0);
  const n = b.space.folders.length;
  b.win.dispatch("keydown", { ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, code: "KeyY", key: "y" });
  await tick();
  assert.equal(b.space.folders.length, n, "other key combos ignored");
});
