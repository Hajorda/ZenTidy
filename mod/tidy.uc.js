// Zen Tidy — one click groups your unpinned tabs into folders, with undo.
// Needs core.uc.js (ZTCore), ai.uc.js (ZTAI) and zen-adapter.uc.js (ZTZen).
(() => {
  "use strict";
  const Core = ZTCore;
  const AI = ZTAI;
  const Zen = ZTZen;
  if (!Zen.supported) return;

  const P = "zen.tidy.";
  const LOGIN_ORIGIN = "chrome://zen-tidy";
  const log = (...a) => console.log("[Zen Tidy]", ...a);

  // --- Settings (Sine doesn't apply preference defaults, so they live here) ---

  function pref(name, fallback) {
    const key = P + name;
    try {
      switch (Services.prefs.getPrefType(key)) {
        case Services.prefs.PREF_BOOL: return Services.prefs.getBoolPref(key);
        case Services.prefs.PREF_INT: return Services.prefs.getIntPref(key);
        case Services.prefs.PREF_STRING: {
          const v = Services.prefs.getStringPref(key).trim();
          if (v === "") return fallback;
          if (typeof fallback === "number") return Number.isFinite(Number(v)) ? Number(v) : fallback;
          if (typeof fallback === "boolean") return v === "true";
          return v;
        }
      }
    } catch { /* fall through */ }
    return fallback;
  }

  const settings = () => ({
    minGroupSize: Math.max(2, pref("min-group-size", 2)),
    maxFolders: Math.min(20, Math.max(1, pref("max-folders", 6))),
    maxGroupSize: 15,
    mergeExisting: pref("merge-existing", false),
    closeDuplicates: pref("close-duplicates", false),
    provider: pref("ai-provider", "none"),
    model: pref("ai-model", ""),
    baseUrl: pref("ai-base-url", ""),
    auto: pref("auto", false),
    autoThreshold: Math.max(5, pref("auto-threshold", 15)),
    shortcut: pref("shortcut", "accel+alt+Y"),
  });

  // Folders created by Tidy, shared by all windows.
  function tidyFolderIds() {
    try {
      const v = JSON.parse(Services.prefs.getStringPref(P + "folders", "[]"));
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  function setTidyFolderIds(ids) {
    Services.prefs.setStringPref(P + "folders", JSON.stringify([...new Set(ids)]));
  }

  // --- AI key (password manager, never prefs) ------------------------------------

  const LoginInfo = Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Ci.nsILoginInfo, "init");
  async function findKeyLogin(provider) {
    const logins = await Services.logins.searchLoginsAsync({ origin: LOGIN_ORIGIN, httpRealm: provider });
    return logins[0] || null;
  }
  async function getApiKey(provider) {
    return (await findKeyLogin(provider))?.password || "";
  }
  async function setApiKey(provider) {
    const p = AI.PROVIDERS[provider];
    if (!p?.needsKey) {
      Services.prompt.alert(window, "Zen Tidy", "Choose Claude or an OpenAI-compatible provider in Zen Tidy's settings first.");
      return;
    }
    const input = { value: "" };
    const ok = Services.prompt.promptPassword(window, "Zen Tidy", `API key for ${p.label}. It is stored in Zen's password manager.`, input);
    if (!ok) return;
    const old = await findKeyLogin(provider);
    if (old) Services.logins.removeLogin(old);
    if (input.value.trim()) await Services.logins.addLoginAsync(new LoginInfo(LOGIN_ORIGIN, null, provider, "api-key", input.value.trim(), "", ""));
    Zen.toast(input.value.trim() ? "API key saved" : "API key removed", { timeout: 3000 });
  }

  const AI_ERRORS = {
    auth: "the API key is missing or wrong",
    "rate-limit": "rate limited, try again in a minute",
    server: "the AI service had an error",
    "bad-request": "the request was rejected",
    refusal: "the model declined",
    truncated: "the answer was cut off",
    network: "couldn't reach the AI service",
    timeout: "the AI took too long",
    parse: "the AI returned something unreadable",
  };

  async function askAI(request) {
    const s = settings();
    return AI.requestJson({
      provider: s.provider,
      model: s.model,
      baseUrl: s.baseUrl,
      apiKey: AI.PROVIDERS[s.provider]?.needsKey ? await getApiKey(s.provider) : "",
      system: request.system,
      user: request.user,
      schema: request.schema,
    });
  }

  // --- Tidy -------------------------------------------------------------------------

  let running = false;
  let lastUndo = null;
  let lastTidyAt = 0;

  async function tidy(spaceId = Zen.activeSpaceId(), { auto = false } = {}) {
    if (running) return;
    running = true;
    setBusy(true);
    try {
      await doTidy(spaceId, auto);
    } catch (e) {
      console.error("Zen Tidy failed", e);
      Zen.toast("Tidy failed. See the Browser Console for details.");
    } finally {
      running = false;
      setBusy(false);
    }
  }

  async function doTidy(spaceId, auto) {
    const s = settings();
    const opts = { minGroupSize: s.minGroupSize, maxFolders: s.maxFolders, maxGroupSize: s.maxGroupSize };
    let units = Zen.unpinnedUnits(spaceId);
    if (units.length < s.minGroupSize) {
      if (!auto) Zen.toast("Nothing to tidy");
      return;
    }
    // Where each item sat, so undo can put it back: its next neighbour.
    const nextOf = new Map(units.map((u, i) => [u.id, units[i + 1]?.id || null]));

    // 1. Duplicates (optional). Never closes the selected or a playing tab.
    const closed = [];
    if (s.closeDuplicates) {
      const singles = units.filter((u) => u.tabs.length === 1 && !u.busy);
      for (const id of Core.findDuplicates(singles)) {
        const u = singles.find((x) => x.id === id);
        closed.push(u.url);
        Zen.closeTab(u.tabs[0]);
      }
      if (closed.length) units = Zen.unpinnedUnits(spaceId);
    }

    // 2. Decide the groups: AI if configured, local otherwise (and as fallback).
    let plan = null;
    let aiNote = "";
    if (s.provider !== "none") {
      const label = AI.PROVIDERS[s.provider]?.label || s.provider;
      if (!auto) Zen.toast(`Tidying with ${label}…`, { timeout: 3000 });
      try {
        const req = Core.aiGroupRequest(units, opts);
        plan = Core.parseAiGroups(await askAI(req), req.ids, opts);
      } catch (e) {
        aiNote = ` (${label}: ${AI_ERRORS[e.code] || "failed"}; used local grouping)`;
        log("AI grouping failed", e);
      }
    }
    if (!plan) plan = Core.groupTabs(units, opts);

    // The AI call is async: re-read the sidebar and drop anything that changed.
    const current = new Map(Zen.unpinnedUnits(spaceId).map((u) => [u.id, u]));
    const groups = plan.groups
      .map((g) => ({ ...g, units: g.ids.map((id) => current.get(id)).filter(Boolean) }))
      .filter((g) => g.units.length >= s.minGroupSize);
    if (!groups.length) {
      if (!auto || closed.length) Zen.toast(closed.length ? `Closed ${closed.length} duplicate tab${closed.length > 1 ? "s" : ""}. Nothing to group${aiNote}` : `Nothing to group${aiNote}`);
      if (closed.length) lastUndo = { spaceId, moved: [], nextOf, createdFolders: [], closed };
      return;
    }

    // 3. Apply: new folders, or existing ones when "merge" is on.
    const matches = s.mergeExisting ? Core.matchFolders(groups, Zen.spaceFolders(spaceId)) : {};
    const createdFolders = [];
    const moved = [];
    groups.forEach((g, gi) => {
      const existing = matches[gi] ? Zen.getFolder(matches[gi]) : null;
      if (existing) {
        for (const u of g.units) Zen.addToFolder(existing, u);
      } else {
        const folder = Zen.createFolder(g.units, g.name, spaceId);
        createdFolders.push(folder.id);
      }
      for (const u of g.units) moved.push(u.id);
    });
    setTidyFolderIds([...tidyFolderIds(), ...createdFolders]);

    lastUndo = { spaceId, moved, nextOf, createdFolders, closed };
    lastTidyAt = Date.now();
    const folders = groups.length;
    let msg = `Tidied ${moved.length} tabs into ${folders} folder${folders > 1 ? "s" : ""}`;
    if (closed.length) msg += `, closed ${closed.length} duplicate${closed.length > 1 ? "s" : ""}`;
    Zen.toast(msg + aiNote, { button: "Undo", onButton: undo, timeout: 8000 });
    log(msg, groups.map((g) => g.name));
  }

  // --- Undo / untidy -----------------------------------------------------------------

  async function undo() {
    const u = lastUndo;
    if (!u) return;
    lastUndo = null;
    // Take tabs out of folders and unpin them, then restore order back to front,
    // so each item's saved neighbour is already in place.
    const moved = u.moved.map((id) => Zen.getTab(id)).filter(Boolean);
    for (const tab of moved) Zen.unfolderAndUnpin(tab);
    for (const id of [...u.moved].reverse()) {
      const tab = Zen.getTab(id);
      if (!tab) continue;
      const nextTab = Zen.getTab(u.nextOf.get(id));
      Zen.placeUnpinned(tab, nextTab && !nextTab.pinned ? Zen.itemOf(nextTab) : null, u.spaceId);
    }
    for (const id of u.createdFolders) {
      const f = Zen.getFolder(id);
      if (f && Zen.isEmptyFolder(f)) await Zen.deleteFolder(f);
    }
    setTidyFolderIds(tidyFolderIds().filter((id) => !u.createdFolders.includes(id) || Zen.getFolder(id)));
    for (const url of u.closed) Zen.reopenClosed(url);
    Zen.toast("Tidy undone", { timeout: 3000 });
  }

  async function untidyFolder(folder, { quiet = false } = {}) {
    const spaceId = Zen.folderSpace(folder) || Zen.activeSpaceId();
    const tabs = Zen.folderItemTabs(folder);
    // Put them at the top of the unpinned list, in folder order.
    const first = Zen.unpinnedUnits(spaceId)[0];
    const anchor = first ? first.el : null;
    for (const tab of tabs) {
      Zen.unfolderAndUnpin(tab);
      Zen.placeUnpinned(tab, anchor, spaceId);
    }
    const id = folder.id;
    if (Zen.isEmptyFolder(folder)) await Zen.deleteFolder(folder);
    setTidyFolderIds(tidyFolderIds().filter((x) => x !== id));
    if (!quiet) Zen.toast(`Moved ${tabs.length} tab${tabs.length === 1 ? "" : "s"} back to unpinned`, { timeout: 3000 });
  }

  async function untidyAll(spaceId) {
    const folders = tidyFolderIds().map((id) => Zen.getFolder(id))
      .filter((f) => f && (Zen.folderSpace(f) || spaceId) === spaceId);
    for (const f of folders) await untidyFolder(f, { quiet: true });
    Zen.toast(`Untidied ${folders.length} folder${folders.length === 1 ? "" : "s"}`, { timeout: 3000 });
  }

  // --- Tidy titles -----------------------------------------------------------------------

  async function tidyTitles(folder) {
    const tabs = Zen.folderAllTabs(folder);
    if (!tabs.length) return;
    const infos = tabs.map((t) => Zen.tabTitleInfo(t));
    const s = settings();
    let titles = null;
    let note = "";
    if (s.provider !== "none") {
      try {
        const req = Core.aiTitleRequest(infos);
        titles = Core.parseAiTitles(await askAI(req), req.ids);
      } catch (e) {
        note = ` (AI: ${AI_ERRORS[e.code] || "failed"}; cleaned locally)`;
      }
    }
    if (!titles) titles = Core.cleanTitles(infos);
    const before = [];
    for (const info of infos) {
      const t = titles[info.id];
      const tab = Zen.getTab(info.id);
      if (!t || !tab || t === info.title) continue;
      before.push({ id: info.id, previous: info.staticLabel });
      Zen.setTabLabel(tab, t);
    }
    if (!before.length) {
      Zen.toast(`Titles already tidy${note}`, { timeout: 3000 });
      return;
    }
    Zen.toast(`Renamed ${before.length} tab${before.length === 1 ? "" : "s"}${note}`, {
      button: "Undo",
      timeout: 8000,
      onButton: () => before.forEach((b) => {
        const tab = Zen.getTab(b.id);
        if (tab) Zen.restoreTabLabel(tab, b.previous);
      }),
    });
  }

  // --- UI: button, shortcut, menus, badges -----------------------------------------------

  const setBusy = (on) => Zen.setButtonsBusy(on);
  const refreshBadges = () => Zen.markTidyFolders(new Set(tidyFolderIds()));

  function matchesShortcut(e, spec) {
    const parts = String(spec).toLowerCase().split("+").map((x) => x.trim());
    const key = parts.pop();
    const isMac = AppConstants.platform === "macosx";
    const want = {
      ctrl: parts.includes("ctrl") || (!isMac && parts.includes("accel")),
      meta: parts.includes("meta") || parts.includes("cmd") || (isMac && parts.includes("accel")),
      alt: parts.includes("alt"),
      shift: parts.includes("shift"),
    };
    if (e.ctrlKey !== want.ctrl || e.metaKey !== want.meta || e.altKey !== want.alt || e.shiftKey !== want.shift) return false;
    return e.code.toLowerCase() === `key${key}` || e.code.toLowerCase() === `digit${key}` || e.key.toLowerCase() === key;
  }

  function menuItem(id, label, onCommand) {
    const item = document.createXULElement("menuitem");
    item.id = id;
    item.setAttribute("label", label);
    item.addEventListener("command", onCommand);
    return item;
  }

  function initSpaceMenu() {
    const menu = Zen.spaceMenu();
    if (!menu) return log("space menu not found");
    let spaceId = null;
    const sep = document.createXULElement("menuseparator");
    const items = {
      tidy: menuItem("zen-tidy-space-tidy", "Tidy tabs", () => tidy(spaceId)),
      undo: menuItem("zen-tidy-space-undo", "Undo last tidy", () => undo()),
      untidy: menuItem("zen-tidy-space-untidy", "Untidy all Tidy folders", () => untidyAll(spaceId)),
      key: menuItem("zen-tidy-space-key", "Set Tidy AI key…", () => setApiKey(settings().provider)),
    };
    menu.append(sep, ...Object.values(items));
    menu.addEventListener("popupshowing", (e) => {
      if (e.target !== menu) return;
      spaceId = Zen.spaceFromMenuEvent(e);
      items.undo.hidden = !lastUndo;
      items.untidy.hidden = !tidyFolderIds().some((id) => {
        const f = Zen.getFolder(id);
        return f && Zen.folderSpace(f) === spaceId;
      });
      items.key.hidden = !AI.PROVIDERS[settings().provider]?.needsKey;
    });
  }

  function initFolderMenu() {
    const menu = Zen.folderMenu();
    if (!menu) return log("folder menu not found");
    let folder = null;
    const sep = document.createXULElement("menuseparator");
    const untidy = menuItem("zen-tidy-folder-untidy", "Untidy (back to unpinned tabs)", () => folder && untidyFolder(folder));
    const titles = menuItem("zen-tidy-folder-titles", "Tidy tab titles", () => folder && tidyTitles(folder));
    menu.append(sep, untidy, titles);
    menu.addEventListener("popupshowing", (e) => {
      if (e.target !== menu) return;
      folder = Zen.folderFromMenuEvent(e);
      untidy.hidden = !folder || !tidyFolderIds().includes(folder.id);
      titles.hidden = sep.hidden = !folder;
    });
  }

  // --- Auto-tidy ---------------------------------------------------------------------------

  let autoTimer = null;
  function maybeAutoTidy() {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      const s = settings();
      // Only the window you're using acts, so several windows don't all tidy.
      if (Services.wm.getMostRecentWindow("navigator:browser") !== window) return;
      const spaceId = Zen.activeSpaceId();
      const count = Zen.unpinnedUnits(spaceId).length;
      if (Core.shouldAutoTidy({ enabled: s.auto, count, threshold: s.autoThreshold, lastTidyAt, now: Date.now() })) {
        tidy(spaceId, { auto: true });
      }
    }, 20_000);
  }

  // For the Browser Console and tests.
  window.ZenTidy = { tidy, undo, untidyFolder, untidyAll, tidyTitles, setApiKey, settings, get lastUndo() { return lastUndo; } };

  // --- Startup ---------------------------------------------------------------------------------

  Zen.whenReady().then(() => {
    const tooltip = () => `Tidy tabs (${settings().shortcut.replace(/accel/i, AppConstants.platform === "macosx" ? "Cmd" : "Ctrl")})`;
    const ensure = () => {
      Zen.ensureSeparatorButtons((spaceId) => tidy(spaceId), tooltip());
      refreshBadges();
    };
    ensure();
    const stopObserving = Zen.observeSidebar(ensure);
    initSpaceMenu();
    initFolderMenu();

    const onKey = (e) => {
      if (matchesShortcut(e, settings().shortcut)) {
        e.preventDefault();
        e.stopPropagation();
        tidy();
      }
    };
    window.addEventListener("keydown", onKey, true);
    const onTabOpen = () => settings().auto && maybeAutoTidy();
    window.addEventListener("TabOpen", onTabOpen);
    const prefObserver = { observe: refreshBadges };
    Services.prefs.addObserver(P + "folders", prefObserver);

    window.addEventListener("unload", () => {
      stopObserving();
      clearTimeout(autoTimer);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("TabOpen", onTabOpen);
      Services.prefs.removeObserver(P + "folders", prefObserver);
    }, { once: true });
    log("ready");
  }).catch((e) => console.error("Zen Tidy failed to start", e));
})();
