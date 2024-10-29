// Ensure background script is active
console.log('Background script loaded');

// Keep service worker alive
const keepAlive = () => {
  chrome.runtime.getPlatformInfo(() => {
    setTimeout(keepAlive, 20000);
  });
};
keepAlive();

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

// Utility function to convert time periods to milliseconds
function convertToMilliseconds(value, unit) {
  const conversions = {
    minutes: value * 60 * 1000,
    hours: value * 60 * 60 * 1000,
    days: value * 24 * 60 * 60 * 1000
  };
  return conversions[unit] || conversions.days;
}

// Initialize settings
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
  chrome.storage.local.set({ 
    settings: defaultSettings,
    recentlyClosed: []
  });
});

// Message handling
const messageHandlers = {
  async instantCleanup(settings) {
    console.log('Starting instant cleanup');
    try {
      const tabs = await chrome.tabs.query({});
      const currentTime = Date.now();
      let closedCount = 0;
      
      const inactivityThreshold = settings.customTime 
        ? convertToMilliseconds(settings.customTime.value, settings.customTime.unit)
        : convertToMilliseconds(settings.timeFrame, 'days');

      for (const tab of tabs) {
        if (await shouldCloseTab(tab, settings, currentTime, inactivityThreshold)) {
          await closeTab(tab);
          closedCount++;
        }
      }
      
      return { success: true, closedCount };
    } catch (error) {
      console.error('Cleanup failed:', error);
      return { success: false, error: error.message };
    }
  }
};

// Message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received:', message);
  
  if (messageHandlers[message.action]) {
    messageHandlers[message.action](message.settings)
      .then(response => {
        console.log('Sending response:', response);
        sendResponse(response);
      })
      .catch(error => {
        console.error('Handler error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Will respond asynchronously
  }
});

async function shouldCloseTab(tab, settings, currentTime, inactivityThreshold) {
  // Don't close the active tab
  if (tab.active) return false;

  // Check whitelist
  if (tab.url && settings.whitelist.some(pattern => tab.url.includes(pattern))) {
    return false;
  }

  try {
    // Get tab's last access time from history
    const [history] = await chrome.history.getVisits({ url: tab.url });
    if (!history) return false;

    const lastAccessTime = new Date(history.visitTime).getTime();
    return (currentTime - lastAccessTime) > inactivityThreshold;
  } catch (error) {
    console.error('Error checking tab history:', error);
    return false;
  }
}

async function closeTab(tab) {
  try {
    // Store tab info for potential undo
    recentlyClosed.unshift({
      url: tab.url,
      title: tab.title,
      timestamp: Date.now()
    });

    // Keep only recent tabs
    if (recentlyClosed.length > MAX_RECENT_TABS) {
      recentlyClosed.pop();
    }

    // Close the tab
    await chrome.tabs.remove(tab.id);

    // Update storage with recently closed tabs
    await chrome.storage.local.set({ recentlyClosed });

    return true;
  } catch (error) {
    console.error('Error closing tab:', error);
    return false;
  }
}