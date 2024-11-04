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

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
  chrome.storage.local.set({ 
    settings: defaultSettings,
    recentlyClosed: []
  });
});

// Handle extension icon click
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: 'dashboard.html'
  });
});

// Default settings
const defaultSettings = {
  whitelist: [],
  timeSettings: {
    value: 7,
    unit: 'days'
  }
};

// Message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Received message:', request);
  
  if (request.action === 'instantCleanup') {
    handleInstantCleanup(request.settings)
      .then(response => {
        console.log('Sending response:', response);
        sendResponse(response);
      })
      .catch(error => {
        console.error('Cleanup error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Will respond asynchronously
  }
});

// Cleanup functions
async function handleInstantCleanup(settings) {
  try {
    console.log('Starting instant cleanup with settings:', settings);
    const tabs = await chrome.tabs.query({});
    console.log('Found tabs:', tabs.length);
    
    const currentTime = Date.now();
    let closedCount = 0;
    
    // Calculate inactivity threshold
    const inactivityThreshold = settings.timeSettings 
      ? convertToMilliseconds(settings.timeSettings.value, settings.timeSettings.unit)
      : convertToMilliseconds(7, 'days'); // default 7 days

    console.log('Inactivity threshold:', inactivityThreshold / (1000 * 60 * 60), 'hours');

    for (const tab of tabs) {
      console.log(`Checking tab ${tab.id}: ${tab.title}`);
      if (await shouldCloseTab(tab, settings, currentTime, inactivityThreshold)) {
        console.log(`Closing tab ${tab.id}`);
        await closeTab(tab);
        closedCount++;
      }
    }
    
    console.log('Cleanup completed. Closed tabs:', closedCount);
    return { success: true, closedCount };
  } catch (error) {
    console.error('Instant cleanup failed:', error);
    return { success: false, error: error.message };
  }
}

async function shouldCloseTab(tab, settings, currentTime, inactivityThreshold) {
  try {
    // Don't close the active tab
    if (tab.active) {
      console.log(`Tab ${tab.id} is active, skipping`);
      return false;
    }

    // Don't close pinned tabs
    if (tab.pinned) {
      console.log(`Tab ${tab.id} is pinned, skipping`);
      return false;
    }

    // Check whitelist
    if (tab.url && settings.whitelist && settings.whitelist.some(pattern => tab.url.includes(pattern))) {
      console.log(`Tab ${tab.id} is whitelisted, skipping`);
      return false;
    }

    // Get tab's last access time from history
    const historyItems = await chrome.history.getVisits({
      url: tab.url
    });

    // If no history found, consider it as inactive
    if (!historyItems || historyItems.length === 0) {
      console.log(`Tab ${tab.id} has no history, considering for closure`);
      return true;
    }

    // Get the most recent visit
    const lastVisit = historyItems.reduce((latest, current) => {
      return latest.visitTime > current.visitTime ? latest : current;
    });

    const lastAccessTime = new Date(lastVisit.visitTime).getTime();
    const timeSinceLastAccess = currentTime - lastAccessTime;

    console.log(`Tab ${tab.id} last access: ${new Date(lastAccessTime).toLocaleString()}`);
    console.log(`Time since last access: ${timeSinceLastAccess / (1000 * 60 * 60)} hours`);
    console.log(`Inactivity threshold: ${inactivityThreshold / (1000 * 60 * 60)} hours`);

    return timeSinceLastAccess > inactivityThreshold;
  } catch (error) {
    console.error('Error checking tab:', tab.id, error);
    return false;
  }
}

async function closeTab(tab) {
  try {
    // Store tab info for potential undo
    const closedTab = {
      url: tab.url,
      title: tab.title,
      timestamp: Date.now()
    };

    // Get current list of recently closed tabs
    const { recentlyClosed = [] } = await chrome.storage.local.get('recentlyClosed');
    
    // Add new tab to the beginning
    recentlyClosed.unshift(closedTab);
    
    // Keep only recent tabs (limit to 10)
    if (recentlyClosed.length > 10) {
      recentlyClosed.pop();
    }

    // Update storage
    await chrome.storage.local.set({ recentlyClosed });

    // Close the tab
    await chrome.tabs.remove(tab.id);

    return true;
  } catch (error) {
    console.error('Error closing tab:', error);
    return false;
  }
}

function convertToMilliseconds(value, unit) {
  console.log('Converting time:', value, unit);
  const conversions = {
    days: value * 24 * 60 * 60 * 1000,
    weeks: value * 7 * 24 * 60 * 60 * 1000,
    months: value * 30 * 24 * 60 * 60 * 1000 // approximating month to 30 days
  };
  const result = conversions[unit] || conversions.days;
  console.log('Converted to milliseconds:', result);
  return result;
}