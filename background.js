// Store for recently closed tabs
let recentlyClosed = [];
const MAX_RECENT_TABS = 10;
const UNDO_TIMEOUT = 1000 * 60 * 30; // 30 minutes for undo

// Default settings
const defaultSettings = {
  timeFrame: 7, // days
  whitelist: [],
  customTime: {
    value: 1,
    unit: 'days'
  }
};

// Initialize settings
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ 
    settings: defaultSettings,
    recentlyClosed: []
  });
});

// Set up periodic check
chrome.alarms.create('checkTabs', { periodInMinutes: 5 });
chrome.alarms.create('cleanupRecentlyClosed', { periodInMinutes: 30 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkTabs') {
    checkAndCloseTabs();
  } else if (alarm.name === 'cleanupRecentlyClosed') {
    cleanupRecentlyClosed();
  }
});

// Handle notification button clicks (Undo)
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  if (buttonIndex === 0) { // Undo button
    const tabToRestore = recentlyClosed.find(tab => tab.notificationId === notificationId);
    if (tabToRestore) {
      await chrome.tabs.create({ url: tabToRestore.url });
      recentlyClosed = recentlyClosed.filter(tab => tab.notificationId !== notificationId);
      await chrome.storage.local.set({ recentlyClosed });
    }
  }
});

function convertToMilliseconds(value, unit) {
  const conversions = {
    minutes: value * 60 * 1000,
    hours: value * 60 * 60 * 1000,
    days: value * 24 * 60 * 60 * 1000
  };
  return conversions[unit] || conversions.days;
}

async function checkAndCloseTabs() {
  const { settings } = await chrome.storage.local.get('settings');
  const tabs = await chrome.tabs.query({});
  const currentTime = Date.now();
  
  // Calculate inactivity threshold
  const inactivityThreshold = settings.customTime 
    ? convertToMilliseconds(settings.customTime.value, settings.customTime.unit)
    : convertToMilliseconds(settings.timeFrame, 'days');

  for (const tab of tabs) {
    if (await shouldCloseTab(tab, settings, currentTime, inactivityThreshold)) {
      await closeTab(tab);
    }
  }
}

async function shouldCloseTab(tab, settings, currentTime, inactivityThreshold) {
  // Don't close the active tab
  if (tab.active) return false;

  // Check whitelist
  const url = new URL(tab.url);
  if (settings.whitelist.some(pattern => {
    return url.hostname.includes(pattern) || url.href.includes(pattern);
  })) {
    return false;
  }

  // Check last access time using Chrome History API
  const [history] = await chrome.history.getVisits({ url: tab.url });
  if (!history) return false;

  const lastAccessTime = new Date(history.visitTime).getTime();
  return (currentTime - lastAccessTime) > inactivityThreshold;
}

async function closeTab(tab) {
  const notificationId = `close_${Date.now()}_${tab.id}`;
  
  // Store tab info for potential undo
  const closedTab = {
    url: tab.url,
    title: tab.title,
    timestamp: Date.now(),
    notificationId
  };

  recentlyClosed.unshift(closedTab);

  // Keep only recent tabs
  if (recentlyClosed.length > MAX_RECENT_TABS) {
    recentlyClosed.pop();
  }

  // Update storage
  await chrome.storage.local.set({ recentlyClosed });

  // Close the tab
  await chrome.tabs.remove(tab.id);

  // Show notification
  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: 'Tab Closed',
    message: `Closed inactive tab: ${tab.title}`,
    buttons: [{ title: 'Undo' }],
    requireInteraction: true
  });
}

async function cleanupRecentlyClosed() {
  const currentTime = Date.now();
  recentlyClosed = recentlyClosed.filter(tab => 
    (currentTime - tab.timestamp) < UNDO_TIMEOUT
  );
  await chrome.storage.local.set({ recentlyClosed });
} 