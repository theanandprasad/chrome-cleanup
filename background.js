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
  whitelist: [],
  timeSettings: {
    value: 1,
    unit: 'weeks'
  }
};

// Utility function to convert time periods to milliseconds
function convertToMilliseconds(value, unit) {
  const conversions = {
    days: value * 24 * 60 * 60 * 1000,
    weeks: value * 7 * 24 * 60 * 60 * 1000,
    months: value * 30 * 24 * 60 * 60 * 1000 // approximating month to 30 days
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
  // Test resource monitoring immediately
  testResourceMonitoring();
});

// Add this temporary test function to background.js
async function testResourceMonitoring() {
  console.log('Testing resource monitoring...');
  await checkResourceUsage();
}

// Message handling
const messageHandlers = {
  async instantCleanup(settings) {
    console.log('Starting instant cleanup');
    try {
      const tabs = await chrome.tabs.query({});
      const currentTime = Date.now();
      let closedCount = 0;
      
      const inactivityThreshold = settings.timeSettings.value * 7 * 24 * 60 * 60 * 1000; // Convert weeks to milliseconds

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

// Reset thresholds to production values
const MEMORY_THRESHOLD = 0.8; // 80% memory usage
const CPU_THRESHOLD = 0.7; // 70% CPU usage
const CHECK_RESOURCE_INTERVAL = 5; // Check every 5 minutes

// Set up resource monitoring alarm
chrome.alarms.create('checkResources', { periodInMinutes: CHECK_RESOURCE_INTERVAL });

// Add this to your existing alarm listener
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkResources') {
    checkResourceUsage();
  }
  // ... your existing alarm handlers
});

async function checkResourceUsage() {
  try {
    // Check memory usage
    const memoryInfo = await chrome.system.memory.getInfo();
    const memoryUsage = (memoryInfo.capacity - memoryInfo.availableCapacity) / memoryInfo.capacity;

    // Check CPU usage
    const cpuInfo = await chrome.system.cpu.getInfo();
    const cpuUsage = cpuInfo.processors.reduce((acc, processor) => 
      acc + processor.usage.user / processor.usage.total, 0) / cpuInfo.numOfProcessors;

    // Get number of open tabs
    const tabs = await chrome.tabs.query({});
    const tabCount = tabs.length;

    if (memoryUsage > MEMORY_THRESHOLD || cpuUsage > CPU_THRESHOLD) {
      const message = createResourceAlert(memoryUsage, cpuUsage, tabCount);
      showResourceNotification(message);
    }
  } catch (error) {
    console.error('Error checking resource usage:', error);
  }
}

function createResourceAlert(memoryUsage, cpuUsage, tabCount) {
  const memoryPercent = Math.round(memoryUsage * 100);
  const cpuPercent = Math.round(cpuUsage * 100);
  
  let message = `High resource usage detected!\n`;
  
  if (memoryUsage > MEMORY_THRESHOLD) {
    message += `Memory usage: ${memoryPercent}%\n`;
  }
  if (cpuUsage > CPU_THRESHOLD) {
    message += `CPU usage: ${cpuPercent}%\n`;
  }
  
  message += `You have ${tabCount} tabs open. Consider cleaning up inactive tabs.`;
  return message;
}

function showResourceNotification(message) {
  const notificationId = `resource_${Date.now()}`;
  
  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: '/icons/icon48.png',
    title: 'Chrome Tab Cleanup Alert',
    message: message,
    buttons: [
      { title: 'Clean Up Now' }
    ],
    priority: 2,
    requireInteraction: true
  });
}

// Add notification button click handler
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  if (notificationId.startsWith('resource_') && buttonIndex === 0) {
    // Get current settings and perform cleanup
    const { settings } = await chrome.storage.local.get('settings');
    const result = await handleInstantCleanup(settings);
    
    if (result.success && result.closedCount > 0) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: '/icons/icon48.png',
        title: 'Cleanup Complete',
        message: `Closed ${result.closedCount} inactive tabs to free up resources.`
      });
    }
  }
});