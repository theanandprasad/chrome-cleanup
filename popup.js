document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadWhitelist();
  loadRecentlyClosed();

  // Quick close buttons
  document.querySelectorAll('[data-time]').forEach(button => {
    button.addEventListener('click', () => {
      const days = parseInt(button.dataset.time);
      updateSettings({ 
        timeFrame: days,
        customTime: null // Clear custom time when using quick close
      });
      highlightActiveButton(button);
    });
  });

  // Custom time period
  document.getElementById('applyCustom').addEventListener('click', () => {
    const value = parseInt(document.getElementById('customTime').value);
    const unit = document.getElementById('timeUnit').value;
    
    if (value > 0) {
      updateSettings({
        customTime: { value, unit },
        timeFrame: null // Clear timeFrame when using custom time
      });
      // Clear quick close button highlights
      document.querySelectorAll('[data-time]').forEach(btn => {
        btn.classList.remove('active');
      });
    }
  });

  // Whitelist
  document.getElementById('addToWhitelist').addEventListener('click', addToWhitelist);
});

async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  
  // Update custom time inputs
  if (settings.customTime) {
    document.getElementById('customTime').value = settings.customTime.value;
    document.getElementById('timeUnit').value = settings.customTime.unit;
    // Clear quick close button highlights
    document.querySelectorAll('[data-time]').forEach(btn => {
      btn.classList.remove('active');
    });
  } else if (settings.timeFrame) {
    // Highlight active quick close button
    const activeButton = document.querySelector(`[data-time="${settings.timeFrame}"]`);
    if (activeButton) {
      highlightActiveButton(activeButton);
    }
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
    removeBtn.textContent = '×';
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
    li.textContent = 'No recently closed tabs';
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
    restoreBtn.textContent = 'Restore';
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