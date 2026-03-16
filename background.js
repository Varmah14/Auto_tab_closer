// Tab Reaper - Background Service Worker
// Tracks tab activity and reaps inactive tabs into the vault

const DEFAULT_SETTINGS = {
  inactiveMinutes: 30,
  enabled: true,
  checkIntervalMinutes: 5,
  excludePinned: true,
  excludeAudible: true,
  excludeActiveTab: true,
  notifyOnReap: true
};

let tabLastActive = {}; // tabId -> timestamp

// ─── Init ──────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get('settings');
  if (!existing.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS, vault: [] });
  }
  scheduleAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleAlarm();
});

// ─── Track Tab Activity ────────────────────────────────────────────────────

function markActive(tabId) {
  tabLastActive[tabId] = Date.now();
}

chrome.tabs.onActivated.addListener(({ tabId }) => markActive(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' || changeInfo.audible) {
    markActive(tabId);
  }
});
chrome.tabs.onCreated.addListener((tab) => markActive(tab.id));
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabLastActive[tabId];
});

// ─── Alarm Scheduling ─────────────────────────────────────────────────────

async function scheduleAlarm() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = settings || DEFAULT_SETTINGS;
  await chrome.alarms.clearAll();
  if (s.enabled) {
    chrome.alarms.create('reapCheck', {
      periodInMinutes: s.checkIntervalMinutes
    });
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'reapCheck') {
    await reapInactiveTabs();
  }
});

// ─── Core Reap Logic ──────────────────────────────────────────────────────

async function reapInactiveTabs() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = settings || DEFAULT_SETTINGS;
  if (!s.enabled) return;

  const cutoff = Date.now() - s.inactiveMinutes * 60 * 1000;
  const allTabs = await chrome.tabs.query({});

  // Get active tab per window
  const activeTabIds = new Set();
  if (s.excludeActiveTab) {
    const activeTabs = await chrome.tabs.query({ active: true });
    activeTabs.forEach(t => activeTabIds.add(t.id));
  }

  // Get all tab groups info
  let groupMap = {}; // groupId -> { title, color }
  try {
    const groups = await chrome.tabGroups.query({});
    groups.forEach(g => {
      groupMap[g.id] = { title: g.title || 'Unnamed Group', color: g.color };
    });
  } catch (e) {
    // tabGroups API might not be available
  }

  const toReap = [];

  for (const tab of allTabs) {
    if (s.excludePinned && tab.pinned) continue;
    if (s.excludeAudible && tab.audible) continue;
    if (activeTabIds.has(tab.id)) continue;

    const lastActive = tabLastActive[tab.id] || 0;
    if (lastActive < cutoff) {
      toReap.push(tab);
    }
  }

  if (toReap.length === 0) return;

  // Load vault and append
  const { vault = [] } = await chrome.storage.local.get('vault');
  const now = Date.now();

  const newEntries = toReap.map(tab => {
    const groupInfo = tab.groupId && tab.groupId !== -1
      ? groupMap[tab.groupId] || { title: 'Unknown Group', color: 'grey' }
      : null;

    return {
      id: `${now}-${tab.id}`,
      title: tab.title || 'Untitled',
      url: tab.url || '',
      favIconUrl: tab.favIconUrl || '',
      reaped_at: now,
      groupId: tab.groupId !== -1 ? tab.groupId : null,
      groupName: groupInfo ? groupInfo.title : null,
      groupColor: groupInfo ? groupInfo.color : null,
      windowId: tab.windowId
    };
  });

  const updatedVault = [...newEntries, ...vault];
  await chrome.storage.local.set({ vault: updatedVault });

  // Close the tabs
  const tabIds = toReap.map(t => t.id);
  await chrome.tabs.remove(tabIds);

  // Notify
  if (s.notifyOnReap) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Tab Reaper',
      message: `Reaped ${toReap.length} inactive tab${toReap.length > 1 ? 's' : ''} → stored in vault`
    });
  }
}

// ─── Message Handler (from popup) ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'reapNow') {
    reapInactiveTabs().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === 'updateSettings') {
    chrome.storage.local.set({ settings: msg.settings }).then(() => {
      scheduleAlarm();
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg.action === 'restoreTab') {
    chrome.tabs.create({ url: msg.url }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === 'getStatus') {
    chrome.tabs.query({}).then(tabs => {
      sendResponse({ tabCount: tabs.length, tracked: Object.keys(tabLastActive).length });
    });
    return true;
  }
});
