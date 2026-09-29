// Zen Tidy — every call into Zen/Firefox internals lives here, so a Zen
// update that renames something only needs fixing in this file.
// Checked against zen-browser/desktop @ 13d57d0 (2026-09-29).
//
// Internals relied on:
//   gZenWorkspaces.{activeWorkspace, allStoredTabs, workspaceElement(id).tabsContainer,
//     promiseInitialized, privateWindowOrDisabled}
//   gZenFolders.createFolder(tabs, {label, collapsed, workspaceId}), <zen-folder>.{allItems,
//     addTabs, delete, label, isZenFolder}
//   gBrowser.{pinTab, unpinTab, ungroupTab, removeTab, zenHandleTabMove, _setTabLabel, setTabTitle}
//   tab.{id (Zen sync id), zenStaticLabel, openerTab, owner, lastAccessed}
//   gZenUIManager.showToast / _toastContainer, #zenFolderActions, #zenWorkspaceMoreActions,
//   .pinned-tabs-container-separator, .zen-workspace-close-unpinned-tabs-button
// eslint-disable-next-line no-var
var ZTZen = (() => {
  "use strict";

  const isFolder = (el) => !!el?.isZenFolder;
  const isSplit = (el) => !!el && gBrowser.isTabGroup(el) && el.hasAttribute("split-view-group");
  const skipTab = (t) => t.hasAttribute("zen-empty-tab") || t.hasAttribute("zen-glance-tab") || t.hasAttribute("zen-essential");

  function tabUrl(tab) {
    let spec = "";
    try {
      spec = tab.linkedBrowser?.currentURI?.spec || "";
    } catch { /* lazy browser without a URI */ }
    if ((!spec || spec === "about:blank") && typeof SessionStore !== "undefined") {
      try {
        spec = SessionStore.getLazyTabValue(tab, "url") || spec;
      } catch { /* not lazy */ }
    }
    return spec;
  }

  return {
    get supported() {
      return typeof gZenFolders !== "undefined" && typeof gZenWorkspaces !== "undefined" && !gZenWorkspaces.privateWindowOrDisabled;
    },

    async whenReady() {
      await window.delayedStartupPromise;
      await gZenWorkspaces.promiseInitialized;
    },

    activeSpaceId: () => gZenWorkspaces.activeWorkspace,

    // --- Reading the sidebar ---------------------------------------------------

    // Unpinned items of a space in sidebar order. A split view is one unit.
    unpinnedUnits(spaceId) {
      const container = gZenWorkspaces.workspaceElement(spaceId)?.tabsContainer;
      if (!container) return [];
      const units = [];
      for (const el of container.children) {
        if (gBrowser.isTab(el)) {
          if (el.pinned || skipTab(el) || !el.visible) continue;
          units.push(this.describe(el, [el]));
        } else if (isSplit(el)) {
          const tabs = el.tabs.filter((t) => !skipTab(t));
          if (tabs.length) units.push(this.describe(el, tabs));
        }
      }
      return units;
    },

    describe(el, tabs) {
      const first = tabs[0];
      const opener = first.openerTab || first.owner;
      return {
        id: first.id,
        el,
        tabs,
        url: tabUrl(first),
        title: tabs.map((t) => t.label || "").join(" · "),
        openerId: opener?.id || null,
        lastAccessed: Math.max(...tabs.map((t) => t.lastAccessed || 0)),
        selected: tabs.some((t) => t.selected),
        busy: tabs.some((t) => t.hasAttribute("soundplaying") || t.hasAttribute("pictureinpicture")),
      };
    },

    unitById(spaceId, id) {
      return this.unpinnedUnits(spaceId).find((u) => u.id === id) || null;
    },

    // Top-level folders of a space, for "add to an existing folder".
    spaceFolders(spaceId) {
      const pinned = gZenWorkspaces.workspaceElement(spaceId)?.pinnedTabsContainer;
      if (!pinned) return [];
      return [...pinned.children].filter(isFolder).map((f) => ({
        id: f.id,
        name: f.label || "",
        urls: f.allItems.filter((t) => gBrowser.isTab(t) && !skipTab(t)).map(tabUrl),
      }));
    },

    getFolder(id) {
      const el = id ? document.getElementById(id) : null;
      return isFolder(el) ? el : null;
    },

    getTab(id) {
      const el = id ? document.getElementById(id) : null;
      return el && gBrowser.isTab(el) ? el : null;
    },

    // The movable element for a tab: its split view if it has one.
    itemOf(tab) {
      return isSplit(tab.group) ? tab.group : tab;
    },

    folderOf(tab) {
      let g = tab?.group;
      if (isSplit(g)) g = g.group;
      return isFolder(g) ? g : null;
    },

    folderSpace: (folder) => folder.getAttribute("zen-workspace-id"),

    // One tab per item in a folder (a split view counts once), in order.
    folderItemTabs: (folder) =>
      folder.allItems.flatMap((el) => (gBrowser.isTab(el) ? [el] : isSplit(el) ? [el.tabs[0]] : [])).filter((t) => !skipTab(t)),

    // Every tab directly in a folder, including both halves of split views.
    folderAllTabs: (folder) =>
      folder.allItems.flatMap((el) => (gBrowser.isTab(el) ? [el] : isSplit(el) ? el.tabs : [])).filter((t) => !skipTab(t)),

    isEmptyFolder: (folder) => folder.allItems.every((t) => gBrowser.isTab(t) && t.hasAttribute("zen-empty-tab")),

    // --- Changing the sidebar --------------------------------------------------

    createFolder(units, name, spaceId) {
      // createFolder pins each tab and swaps a split view's tab for its group.
      return gZenFolders.createFolder(units.map((u) => u.tabs[0]), { label: name, collapsed: true, workspaceId: spaceId });
    },

    addToFolder(folder, unit) {
      gBrowser.pinTab(unit.tabs[0]);
      folder.addTabs([this.itemOf(unit.tabs[0])]);
    },

    // Take a unit out of its folder and make it unpinned again.
    unfolderAndUnpin(tab) {
      const item = this.itemOf(tab);
      if (this.folderOf(tab)) gBrowser.ungroupTab(item);
      if (tab.pinned) gBrowser.unpinTab(tab);
    },

    // Put an unpinned item before `ref` (or at the end of the unpinned list).
    placeUnpinned(tab, ref, spaceId) {
      const item = this.itemOf(tab);
      const container = gZenWorkspaces.workspaceElement(spaceId)?.tabsContainer;
      if (!container) return;
      const anchor = ref && ref.parentElement === container ? ref : container.querySelector("#tabbrowser-arrowscrollbox-periphery");
      if (item.nextElementSibling === anchor) return;
      gBrowser.zenHandleTabMove(item, () => container.insertBefore(item, anchor));
    },

    deleteFolder(folder) {
      return folder.delete();
    },

    closeTab(tab) {
      gBrowser.removeTab(tab, { animate: false });
    },

    // Reopen a tab closed by Tidy (most recent match by URL).
    reopenClosed(url) {
      const closed = SessionStore.getClosedTabDataForWindow(window);
      const i = closed.findIndex((c) => {
        const e = c.state?.entries?.[(c.state.index || 1) - 1];
        return e?.url === url;
      });
      if (i >= 0) SessionStore.undoCloseTab(window, i);
      return i >= 0;
    },

    tabTitleInfo: (tab) => ({ id: tab.id, url: tabUrl(tab), title: tab.label || "", staticLabel: tab.zenStaticLabel }),

    setTabLabel(tab, label) {
      tab.zenStaticLabel = label;
      gBrowser._setTabLabel(tab, label, { _zenChangeLabelFlag: true });
    },

    restoreTabLabel(tab, previous) {
      if (typeof previous === "string") {
        this.setTabLabel(tab, previous);
      } else {
        delete tab.zenStaticLabel;
        gBrowser.setTabTitle(tab);
      }
    },

    // --- UI --------------------------------------------------------------------

    // Zen's own toast, with our text and an optional action button.
    toast(text, { button, onButton, timeout = 6000 } = {}) {
      const id = `zen-tidy-toast-${Date.now()}`;
      try {
        const opts = { timeout };
        if (button) opts.button = { id: `${id}-button`, command: () => onButton?.() };
        gZenUIManager.showToast(id, opts);
        const toast = [...gZenUIManager._toastContainer.children].find((c) => c._messageId === id);
        const label = toast?.querySelector("label");
        if (label) {
          label.removeAttribute("data-l10n-id");
          label.textContent = text;
        }
        const btn = toast?.querySelector("button");
        if (btn) btn.setAttribute("label", button);
      } catch (e) {
        console.warn("Zen Tidy: toast failed", e);
        const box = gNotificationBox;
        box.appendNotification(id, { label: text, priority: box.PRIORITY_INFO_MEDIUM },
          button ? [{ label: button, callback: () => void onButton?.() }] : []);
      }
    },

    setButtonsBusy(on) {
      for (const b of document.querySelectorAll(".zen-tidy-button")) b.toggleAttribute("busy", on);
    },

    markTidyFolders(ids) {
      for (const f of document.querySelectorAll("zen-folder")) f.toggleAttribute("zen-tidy", ids.has(f.id));
    },

    // A ✨ button next to Zen's "close unpinned tabs" button, in every space.
    ensureSeparatorButtons(onClick, tooltip) {
      for (const sep of document.querySelectorAll(".pinned-tabs-container-separator")) {
        if (sep.querySelector(".zen-tidy-button")) continue;
        const btn = document.createXULElement("toolbarbutton");
        btn.className = "zen-tidy-button";
        btn.setAttribute("tooltiptext", tooltip);
        btn.addEventListener("command", (e) => {
          const spaceId = sep.closest("[zen-workspace-id]")?.getAttribute("zen-workspace-id");
          onClick(spaceId || gZenWorkspaces.activeWorkspace, e);
        });
        const close = sep.querySelector(".zen-workspace-close-unpinned-tabs-button");
        if (close) close.before(btn);
        else sep.append(btn);
      }
    },

    // Re-run `fn` when spaces are added (their separators are created lazily).
    observeSidebar(fn) {
      let queued = false;
      const mo = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          fn();
        });
      });
      const root = document.getElementById("tabbrowser-tabs") || gBrowser.tabContainer;
      mo.observe(root, { childList: true, subtree: true });
      return () => mo.disconnect();
    },

    folderMenu: () => document.getElementById("zenFolderActions"),
    spaceMenu: () => document.getElementById("zenWorkspaceMoreActions"),

    // Same target resolution Zen uses for its own folder menu items.
    folderFromMenuEvent(event) {
      const menu = this.folderMenu();
      const target = event.target === menu ? (menu.triggerNode ?? event.explicitOriginalTarget) : event.explicitOriginalTarget;
      if (!target) return null;
      if (gBrowser.isTabGroupLabel(target)) return isFolder(target.group) ? target.group : null;
      if (gBrowser.isTabGroupLabel(target.parentElement)) return isFolder(target.parentElement.group) ? target.parentElement.group : null;
      if (isFolder(target.parentElement) && target.classList?.contains("tab-group-label-container")) return target.parentElement;
      return null;
    },

    spaceFromMenuEvent(event) {
      const menu = this.spaceMenu();
      const node = menu?.triggerNode;
      return node?.closest?.("[zen-workspace-id]")?.getAttribute("zen-workspace-id") || gZenWorkspaces.activeWorkspace;
    },
  };
})();
