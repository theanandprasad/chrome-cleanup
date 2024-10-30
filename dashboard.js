document.addEventListener('DOMContentLoaded', () => {
  // Initialize all dashboard components
  loadSettings();
  loadWhitelist();
  loadRecentlyClosed();
  loadResourceInsights();
  initializeEventListeners();
  initializeTabNavigation();

  // Set up periodic refresh
  setInterval(loadResourceInsights, 30000); // Refresh every 30 seconds
});

function initializeEventListeners() {
  // Quick Actions
  document.getElementById('instantCleanup').addEventListener('click', handleInstantCleanup);

  // Time Settings
  document.getElementById('applyTimeSettings').addEventListener('click', handleTimeSettings);

  // Whitelist
  document.getElementById('addToWhitelist').addEventListener('click', handleWhitelistAdd);

  // Refresh Insights
  document.getElementById('refreshInsights').addEventListener('click', () => {
    loadResourceInsights();
    showNotification('Resource insights refreshed');
  });
}

// Settings Handlers
async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  
  if (settings?.timeSettings) {
    document.getElementById('customTime').value = settings.timeSettings.value;
    document.getElementById('timeUnit').value = settings.timeSettings.unit;
  }
}

async function handleTimeSettings() {
  const value = parseInt(document.getElementById('customTime').value);
  const unit = document.getElementById('timeUnit').value;
  
  if (!value || value < 1) {
    showNotification('Please enter a valid time period');
    return;
  }

  await updateSettings({
    timeSettings: { value, unit }
  });
  showNotification('Inactivity settings updated');
}

async function updateSettings(newSettings) {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({
    settings: { ...settings, ...newSettings }
  });
}

// Cleanup Handler
async function handleInstantCleanup() {
  const button = document.getElementById('instantCleanup');
  const originalContent = button.innerHTML;
  
  try {
    button.disabled = true;
    button.innerHTML = '<i class="material-icons">hourglass_empty</i> Cleaning...';
    
    const { settings } = await chrome.storage.local.get('settings');
    const result = await chrome.runtime.sendMessage({
      action: 'instantCleanup',
      settings: settings
    });
    
    if (result?.success) {
      showNotification(`Closed ${result.closedCount} inactive tab(s)`);
    } else {
      showNotification('No inactive tabs found');
    }
  } catch (error) {
    console.error('Cleanup failed:', error);
    showNotification('Failed to clean up tabs: ' + error.message);
  } finally {
    button.disabled = false;
    button.innerHTML = originalContent;
    loadResourceInsights();
  }
}

// Resource Insights
async function loadResourceInsights() {
  await Promise.all([
    updateSystemStats(),
    updateTabInsights()
  ]);
}

async function updateSystemStats() {
  try {
    // Get all tabs
    const tabs = await chrome.tabs.query({});
    document.getElementById('tabCount').innerHTML = `
      <i class="material-icons">tab</i>
      Open Tabs: ${tabs.length}
    `;

    // Get Chrome memory info
    const chromeMemory = await getChromeMemoryUsage();
    document.getElementById('memoryUsage').innerHTML = `
      <i class="material-icons">memory</i>
      Chrome Memory: ${formatMemorySize(chromeMemory.total)}
      (${chromeMemory.percentage}% of available)
    `;

    // Update CPU usage based on active tabs
    const activeTabs = tabs.filter(tab => !tab.discarded);
    const estimatedCPU = Math.min(Math.round(activeTabs.length * 3), 100);
    document.getElementById('cpuUsage').innerHTML = `
      <i class="material-icons">speed</i>
      Est. CPU Usage: ${estimatedCPU}%
    `;
  } catch (error) {
    console.error('Error updating system stats:', error);
    document.getElementById('memoryUsage').innerHTML = `
      <i class="material-icons">memory</i>
      Memory Usage: Unable to fetch
    `;
  }
}

async function getChromeMemoryUsage() {
  const memoryInfo = await chrome.system.memory.getInfo();
  const totalSystemMemory = memoryInfo.capacity;
  
  // Get memory used by Chrome tabs
  const tabs = await chrome.tabs.query({});
  let totalChromeMemory = 0;
  
  // Base memory usage for Chrome (approximate)
  const baseChromeMemory = 250 * 1024 * 1024; // 250MB base
  totalChromeMemory += baseChromeMemory;
  
  // Add memory for each tab
  for (const tab of tabs) {
    totalChromeMemory += estimateTabMemory(tab);
  }

  return {
    total: totalChromeMemory,
    percentage: Math.round((totalChromeMemory / totalSystemMemory) * 100)
  };
}

function formatMemorySize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function estimateTabMemory(tab) {
  // Base memory for a tab
  let memory = 50 * 1024 * 1024; // 50MB base
  
  // Add memory for special cases
  if (tab.active) memory += 20 * 1024 * 1024; // Active tab
  if (tab.audible) memory += 100 * 1024 * 1024; // Audio playing
  if (tab.url) {
    if (tab.url.includes('youtube.com')) memory += 200 * 1024 * 1024;
    else if (tab.url.includes('google.com/maps')) memory += 150 * 1024 * 1024;
    else if (tab.url.includes('mail.google.com')) memory += 100 * 1024 * 1024;
    else if (tab.url.includes('docs.google.com')) memory += 120 * 1024 * 1024;
  }
  
  return memory;
}

async function updateTabInsights() {
  const tabsList = document.getElementById('tabsList');
  try {
    const tabs = await chrome.tabs.query({});
    const processInfo = await getTabsProcessInfo(tabs);
    
    const sortedTabs = tabs
      .sort((a, b) => processInfo[b.id]?.memory - processInfo[a.id]?.memory)
      .slice(0, 5);

    if (sortedTabs.length === 0) {
      tabsList.innerHTML = '<div class="loading">No tabs data available</div>';
      return;
    }

    tabsList.innerHTML = sortedTabs.map(tab => `
      <div class="resource-item" data-tab-id="${tab.id}">
        <div class="resource-info">
          <div class="resource-title" title="${tab.title}">
            ${tab.title}
          </div>
          <div class="resource-stats">
            <span class="memory-usage">
              <i class="material-icons">memory</i>
              ${formatMemory(processInfo[tab.id]?.memory)}
            </span>
            <span class="cpu-usage">
              <i class="material-icons">speed</i>
              ${processInfo[tab.id]?.cpu.toFixed(1)}%
            </span>
          </div>
        </div>
        <div class="resource-actions">
          <button class="icon-button close-tab" title="Close Tab">
            <i class="material-icons">close</i>
          </button>
        </div>
      </div>
    `).join('');

    addTabActionListeners();
  } catch (error) {
    console.error('Error updating tab insights:', error);
    tabsList.innerHTML = '<div class="loading">Error loading tab data</div>';
  }
}

// Whitelist Handlers
async function handleWhitelistAdd() {
  const input = document.getElementById('whitelistInput');
  const domain = input.value.trim();
  
  if (!domain) {
    showNotification('Please enter a domain or URL');
    return;
  }

  try {
    const { settings } = await chrome.storage.local.get('settings');
    if (!settings.whitelist.includes(domain)) {
      settings.whitelist.push(domain);
      await chrome.storage.local.set({ settings });
      loadWhitelist();
      showNotification('Domain added to whitelist');
      input.value = '';
    } else {
      showNotification('Domain already in whitelist');
    }
  } catch (error) {
    console.error('Error adding to whitelist:', error);
    showNotification('Failed to add domain to whitelist');
  }
}

async function loadWhitelist() {
  const container = document.getElementById('whitelistItems');
  const { settings } = await chrome.storage.local.get('settings');
  
  if (!settings.whitelist.length) {
    container.innerHTML = '<div class="loading">No protected domains</div>';
    return;
  }

  container.innerHTML = settings.whitelist.map(domain => `
    <div class="resource-item">
      <div class="resource-info">
        <div class="resource-title">${domain}</div>
      </div>
      <button class="icon-button remove-whitelist" data-domain="${domain}" title="Remove from whitelist">
        <i class="material-icons">delete</i>
      </button>
    </div>
  `).join('');

  addWhitelistActionListeners();
}

// Utility Functions
function addTabActionListeners() {
  document.querySelectorAll('.close-tab').forEach(button => {
    button.addEventListener('click', async (e) => {
      const tabId = parseInt(e.target.closest('.resource-item').dataset.tabId);
      try {
        await chrome.tabs.remove(tabId);
        loadResourceInsights();
        showNotification('Tab closed');
      } catch (error) {
        console.error('Error closing tab:', error);
        showNotification('Failed to close tab');
      }
    });
  });
}

function addWhitelistActionListeners() {
  document.querySelectorAll('.remove-whitelist').forEach(button => {
    button.addEventListener('click', async () => {
      const domain = button.dataset.domain;
      try {
        const { settings } = await chrome.storage.local.get('settings');
        settings.whitelist = settings.whitelist.filter(d => d !== domain);
        await chrome.storage.local.set({ settings });
        loadWhitelist();
        showNotification('Domain removed from whitelist');
      } catch (error) {
        console.error('Error removing from whitelist:', error);
        showNotification('Failed to remove domain');
      }
    });
  });
}

function showNotification(message) {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.classList.add('fade-out');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

function formatMemory(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

// Resource Estimation Functions
function getTabsProcessInfo(tabs) {
  return tabs.reduce((acc, tab) => ({
    ...acc,
    [tab.id]: {
      memory: estimateTabMemory(tab),
      cpu: estimateTabCPU(tab)
    }
  }), {});
}

function estimateTabCPU(tab) {
  let cpu = 1; // Base: 1%
  
  if (tab.audible) cpu += 5;
  if (tab.url?.includes('youtube.com')) cpu += 10;
  if (tab.url?.includes('google.com/maps')) cpu += 8;
  
  return cpu;
}

// Add this function to dashboard.js
async function loadRecentlyClosed() {
  const container = document.getElementById('recentlyClosed');
  try {
    const { recentlyClosed } = await chrome.storage.local.get('recentlyClosed');
    
    if (!recentlyClosed || recentlyClosed.length === 0) {
      container.innerHTML = '<div class="loading">No recently closed tabs</div>';
      return;
    }

    container.innerHTML = recentlyClosed.map(tab => `
      <div class="resource-item">
        <div class="resource-info">
          <div class="resource-title" title="${tab.title}">${tab.title}</div>
          <div class="resource-stats">
            <span class="timestamp">
              <i class="material-icons">access_time</i>
              ${new Date(tab.timestamp).toLocaleTimeString()}
            </span>
          </div>
        </div>
        <div class="resource-actions">
          <button class="icon-button restore-tab" data-url="${tab.url}" title="Restore Tab">
            <i class="material-icons">restore</i>
          </button>
        </div>
      </div>
    `).join('');

    // Add restore functionality
    document.querySelectorAll('.restore-tab').forEach(button => {
      button.addEventListener('click', async () => {
        try {
          await chrome.tabs.create({ url: button.dataset.url });
          showNotification('Tab restored');
          // Remove from recently closed list
          const { recentlyClosed } = await chrome.storage.local.get('recentlyClosed');
          const updatedList = recentlyClosed.filter(tab => tab.url !== button.dataset.url);
          await chrome.storage.local.set({ recentlyClosed });
          loadRecentlyClosed(); // Refresh the list
        } catch (error) {
          console.error('Error restoring tab:', error);
          showNotification('Failed to restore tab');
        }
      });
    });
  } catch (error) {
    console.error('Error loading recently closed tabs:', error);
    container.innerHTML = '<div class="loading">Error loading recently closed tabs</div>';
  }
}

// Add this to your existing initialization code
function initializeTabNavigation() {
  const tabButtons = document.querySelectorAll('.tab-button');
  
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      // Remove active class from all buttons and panes
      document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
      
      // Add active class to clicked button and corresponding pane
      button.classList.add('active');
      const tabId = button.dataset.tab;
      document.getElementById(tabId).classList.add('active');
    });
  });
} 