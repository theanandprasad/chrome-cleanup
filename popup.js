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