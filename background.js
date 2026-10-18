"use strict";

const DEFAULT_SETTINGS = {
  enabled: true,
  restoreMetadata: true,
  restoreCollapsed: true,
  forceCollapseOnRestore: false,
  debounceMs: 100
};

const SESSION_KEY = "stg_saved_native_group_v1";
let currentSettings = { ...DEFAULT_SETTINGS };
const syncingWindows = new Set();
const pendingWindows = new Set();
const windowTimers = new Map();
const followUpTimers = new Map();
const liveGroupCache = new Map(); // groupId -> { title, color, collapsed, windowId }

async function cacheLiveGroups() {
  if (!browser.tabGroups) {
    return;
  }
  try {
    const groups = await browser.tabGroups.query({});
    for (const g of groups) {
      liveGroupCache.set(g.id, {
        title: g.title || "",
        color: g.color || "blue",
        collapsed: !!g.collapsed,
        windowId: g.windowId
      });
    }
  } catch (e) {
    console.error("[STG Native Groups Fix] cacheLiveGroups error:", e);
  }
}

async function updateBadge() {
  if (!currentSettings.enabled) {
    await browser.browserAction.setBadgeText({ text: "OFF" });
    await browser.browserAction.setBadgeBackgroundColor({ color: "#64748b" });
  } else {
    await browser.browserAction.setBadgeText({ text: "" });
  }
}

async function applySettings(settings) {
  currentSettings = { ...DEFAULT_SETTINGS, ...settings };
  await updateBadge();

  if (currentSettings.enabled) {
    await cacheLiveGroups();
    const windows = await browser.windows.getAll({ windowTypes: ["normal"] });
    for (const win of windows) {
      scheduleWindowSync(win.id);
    }
  }
  return currentSettings;
}

function scheduleWindowSync(windowId) {
  if (!currentSettings.enabled || windowId === undefined || windowId < 0) {
    return;
  }
  if (windowTimers.has(windowId)) {
    clearTimeout(windowTimers.get(windowId));
  }
  const delay = Math.max(40, Number(currentSettings.debounceMs) || 100);
  windowTimers.set(
    windowId,
    setTimeout(() => {
      windowTimers.delete(windowId);
      runWindowSyncLoop(windowId);
    }, delay)
  );

  // Second pass after STG finishes switching active tab and hiding activeTabGroupToHide
  if (followUpTimers.has(windowId)) {
    clearTimeout(followUpTimers.get(windowId));
  }
  followUpTimers.set(
    windowId,
    setTimeout(() => {
      followUpTimers.delete(windowId);
      runWindowSyncLoop(windowId);
    }, delay + 250)
  );
}

async function runWindowSyncLoop(windowId) {
  if (syncingWindows.has(windowId)) {
    pendingWindows.add(windowId);
    return;
  }
  syncingWindows.add(windowId);
  try {
    do {
      pendingWindows.delete(windowId);
      await syncWindowNativeGroups(windowId);
    } while (pendingWindows.has(windowId));
  } catch (err) {
    console.error("[STG Native Groups Fix] syncWindowNativeGroups error:", err);
  } finally {
    syncingWindows.delete(windowId);
  }
}

async function syncWindowNativeGroups(windowId) {
  if (!browser.tabGroups || !currentSettings.enabled) {
    return;
  }

  const tabs = await browser.tabs.query({ windowId });
  const TAB_GROUP_ID_NONE = browser.tabGroups.TAB_GROUP_ID_NONE ?? -1;

  // 1. Group tabs by their current native groupId
  const tabsByGroupId = new Map();
  for (const tab of tabs) {
    if (tab.groupId !== undefined && tab.groupId !== TAB_GROUP_ID_NONE) {
      if (!tabsByGroupId.has(tab.groupId)) {
        tabsByGroupId.set(tab.groupId, []);
      }
      tabsByGroupId.get(tab.groupId).push(tab);
    }
  }

  // When ALL tabs in a native group are hidden (by STG switching groups),
  // save their native group metadata and ungroup them together so the empty header disappears.
  for (const [groupId, groupTabs] of tabsByGroupId.entries()) {
    const allHidden = groupTabs.length > 0 && groupTabs.every(t => t.hidden);
    if (allHidden) {
      let groupInfo = liveGroupCache.get(groupId) || {
        title: "",
        color: "blue",
        collapsed: false
      };
      try {
        const fresh = await browser.tabGroups.get(groupId);
        groupInfo = {
          title: fresh.title || "",
          color: fresh.color || "blue",
          collapsed: !!fresh.collapsed
        };
        liveGroupCache.set(groupId, groupInfo);
      } catch (_) {}

      const savedKey = `ng_${windowId}_${groupId}_${Date.now()}`;
      const sortedGroupTabs = groupTabs.slice().sort((a, b) => a.index - b.index);

      for (let i = 0; i < sortedGroupTabs.length; i++) {
        const t = sortedGroupTabs[i];
        const payload = {
          key: savedKey,
          title: groupInfo.title || "",
          color: groupInfo.color || "blue",
          collapsed: !!groupInfo.collapsed,
          order: i
        };
        await browser.sessions.setTabValue(t.id, SESSION_KEY, payload);
      }

      await browser.tabs.ungroup(sortedGroupTabs.map(t => t.id));
    }
  }

  // 2. Find visible ungrouped tabs that have a saved native group and restore their native group
  const freshTabs = await browser.tabs.query({ windowId });
  const visibleUngrouped = freshTabs.filter(
    t => !t.hidden && !t.pinned && (t.groupId === undefined || t.groupId === TAB_GROUP_ID_NONE)
  );

  const restoreBuckets = new Map();
  for (const tab of visibleUngrouped) {
    const saved = await browser.sessions.getTabValue(tab.id, SESSION_KEY);
    if (saved && saved.key) {
      if (!restoreBuckets.has(saved.key)) {
        restoreBuckets.set(saved.key, { meta: saved, items: [] });
      }
      restoreBuckets.get(saved.key).items.push({
        tabId: tab.id,
        currentIndex: tab.index,
        order: typeof saved.order === "number" ? saved.order : tab.index
      });
    }
  }

  for (const { meta, items } of restoreBuckets.values()) {
    if (items.length > 0) {
      items.sort((a, b) => a.currentIndex - b.currentIndex || a.order - b.order);
      const tabIds = items.map(item => item.tabId);

      const newGroupId = await browser.tabs.group({
        tabIds,
        createProperties: { windowId }
      });

      const updateProps = {};
      if (currentSettings.restoreMetadata) {
        updateProps.title = meta.title || "";
        updateProps.color = meta.color || "blue";
      }
      if (currentSettings.forceCollapseOnRestore) {
        updateProps.collapsed = true;
      } else if (currentSettings.restoreCollapsed) {
        updateProps.collapsed = !!meta.collapsed;
      }

      if (Object.keys(updateProps).length > 0) {
        await browser.tabGroups.update(newGroupId, updateProps);
      }

      liveGroupCache.set(newGroupId, {
        title: updateProps.title ?? (meta.title || ""),
        color: updateProps.color ?? (meta.color || "blue"),
        collapsed: updateProps.collapsed ?? !!meta.collapsed,
        windowId
      });

      for (const tid of tabIds) {
        await browser.sessions.removeTabValue(tid, SESSION_KEY);
      }
    }
  }
}

async function getStats() {
  const tabs = await browser.tabs.query({ currentWindow: true });
  const TAB_GROUP_ID_NONE = browser.tabGroups ? (browser.tabGroups.TAB_GROUP_ID_NONE ?? -1) : -1;
  const activeGroups = new Set();
  const savedHiddenGroups = new Set();

  for (const tab of tabs) {
    if (!tab.hidden && tab.groupId !== undefined && tab.groupId !== TAB_GROUP_ID_NONE) {
      activeGroups.add(tab.groupId);
    }
    if (tab.hidden) {
      const saved = await browser.sessions.getTabValue(tab.id, SESSION_KEY);
      if (saved && saved.key) {
        savedHiddenGroups.add(saved.key);
      }
    }
  }

  return {
    activeGroupsCount: activeGroups.size,
    savedHiddenGroupsCount: savedHiddenGroups.size
  };
}

if (browser.tabGroups) {
  browser.tabGroups.onCreated.addListener(group => {
    liveGroupCache.set(group.id, {
      title: group.title || "",
      color: group.color || "blue",
      collapsed: !!group.collapsed,
      windowId: group.windowId
    });
  });

  browser.tabGroups.onUpdated.addListener(group => {
    liveGroupCache.set(group.id, {
      title: group.title || "",
      color: group.color || "blue",
      collapsed: !!group.collapsed,
      windowId: group.windowId
    });
  });
}

browser.tabs.onUpdated.addListener(
  (tabId, changeInfo, tab) => {
    if (("hidden" in changeInfo || "groupId" in changeInfo) && tab.windowId !== undefined) {
      if ("groupId" in changeInfo && tab.groupId !== undefined && tab.groupId !== -1) {
        cacheLiveGroups();
      }
      scheduleWindowSync(tab.windowId);
    }
  },
  { properties: ["hidden", "groupId"] }
);

browser.tabs.onActivated.addListener(activeInfo => {
  if (activeInfo && activeInfo.windowId !== undefined) {
    scheduleWindowSync(activeInfo.windowId);
  }
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    browser.storage.local.get(DEFAULT_SETTINGS).then(applySettings);
  }
});

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.action === "getStatus") {
    return (async () => {
      const stats = await getStats();
      return {
        settings: currentSettings,
        stats
      };
    })();
  }
  if (msg && msg.action === "syncNow") {
    return (async () => {
      const windows = await browser.windows.getAll({ windowTypes: ["normal"] });
      for (const win of windows) {
        await runWindowSyncLoop(win.id);
      }
      return await getStats();
    })();
  }
  if (msg && msg.action === "resetDefaults") {
    return (async () => {
      await browser.storage.local.set(DEFAULT_SETTINGS);
      return await applySettings(DEFAULT_SETTINGS);
    })();
  }
});

(async function init() {
  const stored = await browser.storage.local.get(null);
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  await browser.storage.local.set(merged);
  await applySettings(merged);
})();
