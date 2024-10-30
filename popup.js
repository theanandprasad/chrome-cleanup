document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadWhitelist();
  loadRecentlyClosed();

  // Instant cleanup button handler
  document.getElementById('instantCleanup').addEventListener('click', handleInstantCleanup);

  // Apply time settings
  document.getElementById('applyTimeSettings').addEventListener('click', () => {
    const value = parseInt(document.getElementById('customTime').value);
    const unit = document.getElementById('timeUnit').value;
    
    if (!value || value < 1) {
      showNotification('Please enter a valid time period');
      return;
    }

    updateSettings({
      timeSettings: { value, unit }
    });
    showNotification('Time settings updated');
  });

  // Whitelist handler
  document.getElementById('addToWhitelist').addEventListener('click', addToWhitelist);

  // Resource monitoring toggle
  const resourceAlertsToggle = document.getElementById('enableResourceAlerts');
  resourceAlertsToggle.addEventListener('change', async (e) => {
    await chrome.storage.local.set({ 
      resourceAlerts: e.target.checked 
    });
    showNotification(e.target.checked ? 
      'Resource monitoring enabled' : 
      'Resource monitoring disabled'
    );
  });

  // Load resource monitoring state
  loadResourceInfo();

  // Load resource insights
  loadResourceInsights();

  // Add refresh button handler
  document.getElementById('refreshInsights').addEventListener('click', () => {
    loadResourceInsights();
  });
});

async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  
  // Populate time settings
  if (settings.timeSettings) {
    document.getElementById('customTime').value = settings.timeSettings.value;
    document.getElementById('timeUnit').value = settings.timeSettings.unit;
  }
}

function highlightActiveButton(button) {
  document.querySelectorAll('[data-time]').forEach(btn => {
    btn.classList.remove('active');
  });
  button.classList.add('active');
}

async function updateSettings(newSettings) {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({
    settings: { ...settings, ...newSettings }
  });
  showSavedMessage();
}

function showSavedMessage() {
  const message = document.createElement('div');
  message.className = 'saved-message';
  message.textContent = 'Settings saved!';
  document.body.appendChild(message);
  setTimeout(() => message.remove(), 2000);
}

async function addToWhitelist() {
  const input = document.getElementById('whitelistInput');
  const domain = input.value.trim();
  
  if (!domain) return;

  try {
    // Try to parse as URL to extract hostname
    const url = new URL(domain.startsWith('http') ? domain : `http://${domain}`);
    const hostname = url.hostname;

    const { settings } = await chrome.storage.local.get('settings');
    if (!settings.whitelist.includes(hostname)) {
      settings.whitelist.push(hostname);
      await chrome.storage.local.set({ settings });
      loadWhitelist();
      showSavedMessage();
    }
  } catch (e) {
    // If URL parsing fails, add as-is
    const { settings } = await chrome.storage.local.get('settings');
    if (!settings.whitelist.includes(domain)) {
      settings.whitelist.push(domain);
      await chrome.storage.local.set({ settings });
      loadWhitelist();
      showSavedMessage();
    }
  }
  
  input.value = '';
}

async function removeFromWhitelist(domain) {
  const { settings } = await chrome.storage.local.get('settings');
  settings.whitelist = settings.whitelist.filter(d => d !== domain);
  await chrome.storage.local.set({ settings });
  loadWhitelist();
  showSavedMessage();
}

async function loadWhitelist() {
  const { settings } = await chrome.storage.local.get('settings');
  const container = document.getElementById('whitelistItems');
  container.innerHTML = '';
  
  settings.whitelist.forEach(domain => {
    const li = document.createElement('li');
    li.textContent = domain;
    const removeBtn = document.createElement('span');
    removeBtn.innerHTML = '<i class="material-icons">close</i>';
    removeBtn.className = 'remove-btn';
    removeBtn.onclick = () => removeFromWhitelist(domain);
    li.appendChild(removeBtn);
    container.appendChild(li);
  });
}

async function loadRecentlyClosed() {
  const { recentlyClosed } = await chrome.storage.local.get('recentlyClosed');
  const container = document.getElementById('recentlyClosed');
  container.innerHTML = '';

  if (!recentlyClosed || recentlyClosed.length === 0) {
    const li = document.createElement('li');
    li.innerHTML = '<i class="material-icons">info</i> No recently closed tabs';
    li.className = 'no-tabs';
    container.appendChild(li);
    return;
  }

  recentlyClosed.forEach(tab => {
    const li = document.createElement('li');
    li.className = 'recently-closed-item';
    
    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title;
    
    const restoreBtn = document.createElement('button');
    restoreBtn.innerHTML = '<i class="material-icons">restore</i> Restore';
    restoreBtn.className = 'restore-btn';
    restoreBtn.onclick = () => restoreTab(tab);
    
    li.appendChild(title);
    li.appendChild(restoreBtn);
    container.appendChild(li);
  });
}

async function restoreTab(tab) {
  await chrome.tabs.create({ url: tab.url });
  const { recentlyClosed } = await chrome.storage.local.get('recentlyClosed');
  const updatedTabs = recentlyClosed.filter(t => t.notificationId !== tab.notificationId);
  await chrome.storage.local.set({ recentlyClosed: updatedTabs });
  loadRecentlyClosed();
}

async function handleInstantCleanup() {
  const button = document.getElementById('instantCleanup');
  button.classList.add('loading');
  button.disabled = true;
  
  try {
    // Check if background script is available
    if (!chrome.runtime.getManifest()) {
      throw new Error('Extension context invalid');
    }

    // Get current settings
    const { settings } = await chrome.storage.local.get('settings');
    
    // Send message with retry logic
    const sendMessageWithRetry = async (retries = 3) => {
      try {
        return await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Request timed out'));
          }, 5000);

          chrome.runtime.sendMessage(
            { action: 'instantCleanup', settings },
            (response) => {
              clearTimeout(timeout);
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(response);
              }
            }
          );
        });
      } catch (error) {
        if (retries > 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          return sendMessageWithRetry(retries - 1);
        }
        throw error;
      }
    };

    const result = await sendMessageWithRetry();
    
    if (result && result.success && result.closedCount > 0) {
      showNotification(`Closed ${result.closedCount} inactive tab(s)`);
    } else if (result && result.success) {
      showNotification('No inactive tabs found');
    } else {
      throw new Error(result.error || 'Failed to clean up tabs');
    }
  } catch (error) {
    console.error('Cleanup failed:', error);
    showNotification('Failed to clean up tabs: ' + error.message);
  } finally {
    button.classList.remove('loading');
    button.disabled = false;
  }
}

function showNotification(message) {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.classList.add('fade-out');
    setTimeout(() => notification.remove(), 300);
  }, 2000);
}

async function loadResourceInfo() {
  // Load toggle state
  const { resourceAlerts } = await chrome.storage.local.get('resourceAlerts');
  document.getElementById('enableResourceAlerts').checked = resourceAlerts ?? true;

  try {
    // Update memory usage
    const memoryInfo = await chrome.system.memory.getInfo();
    const memoryUsage = Math.round(
      ((memoryInfo.capacity - memoryInfo.availableCapacity) / memoryInfo.capacity) * 100
    );
    document.getElementById('memoryUsage').textContent = 
      `Memory Usage: ${memoryUsage}%`;

    // Update CPU usage
    const cpuInfo = await chrome.system.cpu.getInfo();
    const cpuUsage = Math.round(
      (cpuInfo.processors.reduce((acc, processor) => 
        acc + processor.usage.user / processor.usage.total, 0) / cpuInfo.numOfProcessors) * 100
    );
    document.getElementById('cpuUsage').textContent = 
      `CPU Usage: ${cpuUsage}%`;

    // Update tab count
    const tabs = await chrome.tabs.query({});
    document.getElementById('tabCount').textContent = 
      `Open Tabs: ${tabs.length}`;
  } catch (error) {
    console.error('Error loading resource info:', error);
  }
}

async function loadResourceInsights() {
  await Promise.all([
    loadTabInsights(),
    loadExtensionInsights()
  ]);
}

async function loadTabInsights() {
  const tabsList = document.getElementById('tabsList');
  try {
    const tabs = await chrome.tabs.query({});
    const processInfo = await getTabsProcessInfo(tabs);
    
    // Sort tabs by estimated memory usage
    const sortedTabs = tabs.sort((a, b) => {
      const aMemory = processInfo[a.id]?.memory || 0;
      const bMemory = processInfo[b.id]?.memory || 0;
      return bMemory - aMemory;
    });

    // Display top 5 resource-heavy tabs
    tabsList.innerHTML = sortedTabs.slice(0, 5).map(tab => {
      const process = processInfo[tab.id] || { memory: 0, cpu: 0 };
      return `
        <div class="resource-item" data-tab-id="${tab.id}">
          <div class="resource-info">
            <div class="resource-title" title="${tab.title}">${tab.title}</div>
            <div class="resource-stats">
              <span class="memory-usage">Est. Memory: ${formatMemory(process.memory)}</span> | 
              <span class="cpu-usage">Est. CPU: ${process.cpu.toFixed(1)}%</span>
            </div>
          </div>
          <div class="resource-actions">
            <button class="icon-button close-tab" title="Close Tab">
              <i class="material-icons">close</i>
            </button>
          </div>
        </div>
      `;
    }).join('') || '<div class="loading">No tabs data available</div>';

    // Add event listeners for tab actions
    addTabActionListeners();
  } catch (error) {
    console.error('Error loading tab insights:', error);
    tabsList.innerHTML = '<div class="loading">Error loading tab data</div>';
  }
}

async function loadExtensionInsights() {
  const extensionsList = document.getElementById('extensionsList');
  try {
    const extensions = await chrome.management.getAll();
    const enabledExtensions = extensions.filter(ext => ext.enabled);

    extensionsList.innerHTML = enabledExtensions.map(ext => `
      <div class="resource-item" data-extension-id="${ext.id}">
        <div class="resource-info">
          <div class="resource-title" title="${ext.name}">${ext.name}</div>
          <div class="resource-stats">
            ${ext.type} | ${ext.version}
          </div>
        </div>
        <div class="resource-actions">
          <button class="icon-button toggle-extension" title="Toggle Extension">
            <i class="material-icons">power_settings_new</i>
          </button>
        </div>
      </div>
    `).join('') || '<div class="loading">No extensions data available</div>';

    // Add event listeners for extension actions
    addExtensionActionListeners();
  } catch (error) {
    console.error('Error loading extension insights:', error);
    extensionsList.innerHTML = '<div class="loading">Error loading extension data</div>';
  }
}

async function getTabsProcessInfo(tabs) {
  const processInfo = {};
  
  for (const tab of tabs) {
    try {
      // Use a simpler metric based on tab properties
      processInfo[tab.id] = {
        memory: estimateTabMemory(tab), // Estimate based on tab properties
        cpu: estimateTabCPU(tab)        // Estimate based on tab type
      };
    } catch (error) {
      console.error(`Error getting info for tab ${tab.id}:`, error);
    }
  }
  
  return processInfo;
}

// Helper function to estimate tab memory usage
function estimateTabMemory(tab) {
  // Basic estimation based on tab properties
  let baseMemory = 50 * 1024 * 1024; // Base memory: 50MB
  
  // Add memory for media tabs
  if (tab.audible) {
    baseMemory += 100 * 1024 * 1024; // Additional 100MB for audio
  }
  
  // Add memory based on URL type
  if (tab.url) {
    if (tab.url.includes('youtube.com')) {
      baseMemory += 200 * 1024 * 1024; // Additional 200MB for YouTube
    } else if (tab.url.includes('google.com/maps')) {
      baseMemory += 150 * 1024 * 1024; // Additional 150MB for Maps
    }
  }
  
  return baseMemory;
}

// Helper function to estimate tab CPU usage
function estimateTabCPU(tab) {
  // Basic CPU usage estimation
  let cpuUsage = 1; // Base CPU usage: 1%
  
  // Add CPU usage for active media
  if (tab.audible) {
    cpuUsage += 5; // Additional 5% for audio
  }
  
  // Add CPU usage based on URL type
  if (tab.url) {
    if (tab.url.includes('youtube.com')) {
      cpuUsage += 10; // Additional 10% for YouTube
    } else if (tab.url.includes('google.com/maps')) {
      cpuUsage += 8; // Additional 8% for Maps
    }
  }
  
  return cpuUsage;
}

function formatMemory(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function addTabActionListeners() {
  document.querySelectorAll('.close-tab').forEach(button => {
    button.addEventListener('click', async (e) => {
      const tabId = parseInt(e.target.closest('.resource-item').dataset.tabId);
      try {
        await chrome.tabs.remove(tabId);
        loadTabInsights(); // Refresh the list
      } catch (error) {
        console.error('Error closing tab:', error);
      }
    });
  });
}

function addExtensionActionListeners() {
  document.querySelectorAll('.toggle-extension').forEach(button => {
    button.addEventListener('click', async (e) => {
      const extensionId = e.target.closest('.resource-item').dataset.extensionId;
      try {
        const extension = await chrome.management.get(extensionId);
        await chrome.management.setEnabled(extensionId, !extension.enabled);
        loadExtensionInsights(); // Refresh the list
      } catch (error) {
        console.error('Error toggling extension:', error);
      }
    });
  });
}

// Add this to your existing styles.css
const styles = `
.notification {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: #333;
  color: white;
  padding: 8px 16px;
  border-radius: 4px;
  z-index: 1000;
}

.notification.fade-out {
  opacity: 0;
  transition: opacity 0.3s;
}
`; 