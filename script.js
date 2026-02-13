// State
let obs = null;
let connected = false;
let currentScene = '';
let sources = [];
let libraryLoaded = false;
let showingSourcesList = false;
let windows = [];
let windowCounter = 0;
let activeWindow = null;
let syncInterval = null;
const TITLEBAR_HEIGHT = 32; // Height of window titlebar

// Elements
const startButton = document.getElementById('start-button');
const startMenu = document.getElementById('start-menu');
const menuOverlay = document.getElementById('menu-overlay');
const settingsPanel = document.getElementById('settings-panel');
const sourcesPanel = document.getElementById('sources-panel');
const statusDisplay = document.getElementById('status-display');
const statusIcon = document.getElementById('status-icon');
const statusTitle = document.getElementById('status-title');
const statusSubtitle = document.getElementById('status-subtitle');
const sceneName = document.getElementById('scene-name');
const connectionStatus = document.querySelector('.status-dot');
const connectBtn = document.getElementById('connect-btn');
const wsAddress = document.getElementById('ws-address');
const wsPassword = document.getElementById('ws-password');
const connectionError = document.getElementById('connection-error');
const sourcesTitle = document.getElementById('sources-title');
const sourcesList = document.getElementById('sources-list');
const emptyState = document.getElementById('empty-state');
const emptyMessage = document.getElementById('empty-message');
const sourcesFooter = document.getElementById('sources-footer');
const addWindowBtn = document.getElementById('add-window-btn');
const sourcesHeader = document.getElementById('sources-header');
const backBtn = document.getElementById('back-btn');
const mainContent = document.getElementById('main-content');
const windowTabs = document.getElementById('window-tabs');

// Calculate GCD for grid sizing
function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

function updateGridSize() {
  // Use full browser source dimensions (don't subtract taskbar)
  const width = window.innerWidth;
  const height = window.innerHeight;
  
  // Find GCD - this will give us a grid that tiles perfectly
  let gridSize = gcd(width, height);
  
  // Only adjust if GCD is unreasonably small or large
  // If too small (< 20), use a multiple of GCD
  if (gridSize < 20) {
    const multiplier = Math.ceil(20 / gridSize);
    gridSize *= multiplier;
  }
  // If too large (> 200), use a divisor of GCD
  else if (gridSize > 200) {
    // Find largest divisor of gridSize that's <= 200
    for (let divisor = 2; divisor <= gridSize; divisor++) {
      if (gridSize % divisor === 0 && gridSize / divisor <= 200) {
        gridSize = gridSize / divisor;
        break;
      }
    }
  }
  
  // Update the grid
  mainContent.style.backgroundSize = `${gridSize}px ${gridSize}px`;
  mainContent.style.backgroundImage = `
    repeating-linear-gradient(
      0deg,
      rgba(255, 255, 255, 0.08) 0px,
      rgba(255, 255, 255, 0.08) 2px,
      transparent 2px,
      transparent ${gridSize}px
    ),
    repeating-linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.08) 0px,
      rgba(255, 255, 255, 0.08) 2px,
      transparent 2px,
      transparent ${gridSize}px
    )
  `;
  
  console.log(`Grid size: ${gridSize}px (browser source: ${width}x${height}, raw GCD: ${gcd(width, height)})`);
}

// Update grid on load and resize
window.addEventListener('resize', updateGridSize);
window.addEventListener('load', updateGridSize);
updateGridSize();

// Check if library is loaded
function checkLibrary() {
  if (typeof OBSWebSocket !== 'undefined') {
    libraryLoaded = true;
    connectBtn.textContent = 'Connect';
    connectBtn.disabled = false;
    console.log('OBS WebSocket library loaded');
  } else {
    setTimeout(checkLibrary, 100);
  }
}
checkLibrary();

// Clock
function updateClock() {
  const now = new Date();
  document.getElementById('clock-time').textContent = now.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  document.getElementById('clock-date').textContent = now.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}
updateClock();
setInterval(updateClock, 1000);

// Start Menu
function toggleStartMenu() {
  const isOpen = startMenu.classList.contains('open');
  
  if (isOpen) {
    closeStartMenu();
  } else {
    openStartMenu();
  }
}

function openStartMenu() {
  startMenu.classList.add('open');
  menuOverlay.classList.add('active');
  startButton.classList.add('active');
  
  if (connected) {
    showSourcesPanel();
    hideSourcesList(); // Reset to show the Add Window button
  } else {
    showSourcesPanel();
  }
}

function closeStartMenu() {
  startMenu.classList.remove('open');
  menuOverlay.classList.remove('active');
  startButton.classList.remove('active');
}

function showSettingsPanel() {
  settingsPanel.classList.add('active');
  sourcesPanel.classList.remove('active');
}

function showSourcesPanel() {
  settingsPanel.classList.remove('active');
  sourcesPanel.classList.add('active');
}

// Connection
async function connectToOBS() {
  if (!libraryLoaded) {
    showError('OBS WebSocket library is still loading...');
    return;
  }

  try {
    if (typeof OBSWebSocket === 'undefined') {
      showError('OBS WebSocket library not loaded. Please refresh the page.');
      return;
    }

    obs = new OBSWebSocket();
    
    const address = wsAddress.value || 'ws://localhost:4455';
    const password = wsPassword.value || undefined;
    
    await obs.connect(address, password);
    
    connected = true;
    hideError();
    updateConnectionStatus();
    
    // Get current scene
    const sceneResponse = await obs.call('GetCurrentProgramScene');
    currentScene = sceneResponse.currentProgramSceneName;
    updateSceneDisplay();
    
    // Listen for scene changes
    obs.on('CurrentProgramSceneChanged', (data) => {
      currentScene = data.sceneName;
      updateSceneDisplay();
      if (startMenu.classList.contains('open')) {
        loadSources();
      }
    });

    // Start 120fps sync loop
    startSyncLoop();

    showSourcesPanel();
    hideSourcesList(); // Show the Add Window button, not the sources list
    
  } catch (error) {
    showError(`Failed to connect: ${error.message}`);
    connected = false;
    updateConnectionStatus();
  }
}

async function disconnect() {
  if (obs) {
    await obs.disconnect();
    obs = null;
  }
  
  // Stop sync loop
  stopSyncLoop();
  
  connected = false;
  currentScene = '';
  sources = [];
  
  // Close all windows
  windows.forEach(w => w.element.remove());
  windows = [];
  windowCounter = 0;
  
  // Clear all tabs
  windowTabs.innerHTML = '';
  
  updateConnectionStatus();
  updateSceneDisplay();
  updateStatusDisplayVisibility();
  showSourcesPanel();
  renderSources();
}

function updateStatusDisplayVisibility() {
  if (windows.length > 0) {
    // Hide status display if any windows exist
    statusDisplay.style.display = 'none';
  } else if (connected) {
    // Hide if connected but no windows
    statusDisplay.style.display = 'none';
  } else {
    // Show if disconnected and no windows
    statusDisplay.style.display = 'flex';
  }
}

function updateConnectionStatus() {
  if (connected) {
    connectionStatus.classList.add('connected');
    statusDisplay.classList.add('connected');
    statusIcon.textContent = '📡';
    statusTitle.textContent = 'Connected to OBS';
    statusSubtitle.textContent = 'Click Start to add windows';
    sourcesFooter.style.display = 'flex';
    addWindowBtn.style.display = 'flex';
  } else {
    connectionStatus.classList.remove('connected');
    statusDisplay.classList.remove('connected');
    statusIcon.textContent = '🎥';
    statusTitle.textContent = 'OBS Studio Control';
    statusSubtitle.textContent = 'Click Start to configure connection';
    sceneName.style.display = 'none';
    sourcesFooter.style.display = 'none';
    addWindowBtn.style.display = 'none';
  }
  updateStatusDisplayVisibility();
}

function updateSceneDisplay() {
  if (connected && currentScene) {
    sceneName.textContent = `Scene: ${currentScene}`;
    sceneName.style.display = 'block';
    sourcesTitle.textContent = `Sources in "${currentScene}"`;
  } else {
    sceneName.style.display = 'none';
    sourcesTitle.textContent = 'OBS Not Connected';
  }
}

// Sources
async function loadSources() {
  if (!obs || !currentScene) return;

  try {
    const response = await obs.call('GetSceneItemList', {
      sceneName: currentScene
    });
    
    sources = response.sceneItems || [];
    renderSources();
  } catch (error) {
    console.error('Failed to load sources:', error);
  }
}

function renderSources() {
  sourcesList.innerHTML = '';
  
  if (!connected) {
    emptyState.innerHTML = `
      <p style="margin: 0 0 15px 0;">Not connected to OBS Studio</p>
      <button class="btn-primary" onclick="showSettingsPanel()">Configure Connection</button>
    `;
    sourcesList.appendChild(emptyState);
    return;
  }
  
  if (sources.length === 0) {
    emptyState.innerHTML = '<p style="margin: 0;">No sources in this scene</p>';
    sourcesList.appendChild(emptyState);
    return;
  }

  sources.forEach(source => {
    const item = document.createElement('div');
    item.className = 'source-item clickable';
    item.onclick = async () => {
      await createWindowFromSource(source);
      hideSourcesList();
      closeStartMenu();
    };
    
    item.innerHTML = `
      <div class="source-checkbox ${source.sceneItemEnabled ? 'enabled' : ''}">
        ${source.sceneItemEnabled ? '✓' : ''}
      </div>
      <div class="source-info">
        <div class="source-name">${source.sourceName}</div>
        <div class="source-type">${source.sourceType}</div>
      </div>
    `;
    
    sourcesList.appendChild(item);
  });
}

function showSourcesList() {
  showingSourcesList = true;
  addWindowBtn.style.display = 'none';
  sourcesHeader.style.display = 'flex';
  loadSources();
}

function hideSourcesList() {
  showingSourcesList = false;
  addWindowBtn.style.display = 'flex';
  sourcesHeader.style.display = 'none';
  sourcesList.innerHTML = '';
}

async function createWindowFromSource(source) {
  if (!obs) return;

  try {
    // Get source transform to get dimensions and position
    const transform = await obs.call('GetSceneItemTransform', {
      sceneName: currentScene,
      sceneItemId: source.sceneItemId
    });

    const sceneItemTransform = transform.sceneItemTransform;
    const width = sceneItemTransform.sourceWidth * sceneItemTransform.scaleX;
    const height = sceneItemTransform.sourceHeight * sceneItemTransform.scaleY;
    
    // OBS position is where the content starts, but window includes titlebar
    // So offset the window Y position by titlebar height
    const obsX = sceneItemTransform.positionX || 100;
    const obsY = sceneItemTransform.positionY || 100;
    const x = obsX;
    const y = obsY - TITLEBAR_HEIGHT;

    // Create window at the offset position
    createFakeWindow(source.sourceName, width, height, source, x, y);

  } catch (error) {
    console.error('Failed to get source dimensions:', error);
    // Fallback to default size and position
    createFakeWindow(source.sourceName, 800, 600, source, 100, 100 - TITLEBAR_HEIGHT);
  }
}

function createFakeWindow(title, width, height, sourceData, x, y) {
  windowCounter++;
  
  const windowDiv = document.createElement('div');
  windowDiv.className = 'fake-window';
  windowDiv.id = `window-${windowCounter}`;
  
  // Use provided position or fallback to offset position
  if (x === undefined || y === undefined) {
    x = 100 + (windowCounter * 30) % 300;
    y = 100 + (windowCounter * 30) % 200;
  }
  
  windowDiv.style.left = x + 'px';
  windowDiv.style.top = y + 'px';
  windowDiv.style.width = width + 'px';
  windowDiv.style.height = (height + TITLEBAR_HEIGHT) + 'px'; // Add titlebar height
  
  windowDiv.innerHTML = `
    <div class="window-titlebar">
      <div class="window-icon">🪟</div>
      <div class="window-title">${title}</div>
      <div class="window-controls">
        <div class="window-control-btn minimize">−</div>
        <div class="window-control-btn maximize">□</div>
        <div class="window-control-btn close">✕</div>
      </div>
    </div>
    <div class="window-content">
      <div style="text-align: center;">
        <div style="font-size: 32px; margin-bottom: 10px; opacity: 0.3;">📹</div>
        <div>${title}</div>
      </div>
      <div class="window-dimensions">${Math.round(width)} × ${Math.round(height)}</div>
    </div>
  `;
  
  mainContent.appendChild(windowDiv);
  
  // Add to windows array
  const windowObj = {
    id: windowCounter,
    element: windowDiv,
    title: title,
    sourceData: sourceData,
    minimized: false,
    maximized: false,
    isDragging: false,
    originalSize: { width, height: height + TITLEBAR_HEIGHT, x, y }
  };
  windows.push(windowObj);
  
  // Create taskbar tab
  createWindowTab(windowObj);
  
  // Setup dragging
  setupWindowDragging(windowDiv);
  
  // Capture the ID in a closure
  const currentWindowId = windowObj.id;
  
  // Setup controls with proper scoping
  const closeBtn = windowDiv.querySelector('.window-control-btn.close');
  const minimizeBtn = windowDiv.querySelector('.window-control-btn.minimize');
  const maximizeBtn = windowDiv.querySelector('.window-control-btn.maximize');
  
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeWindow(currentWindowId);
  });
  
  minimizeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    minimizeWindow(currentWindowId);
  });
  
  // Maximize button disabled but visible
  maximizeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Maximize disabled
  });
  maximizeBtn.style.opacity = '0.3';
  maximizeBtn.style.cursor = 'not-allowed';
  
  // Focus on click
  windowDiv.addEventListener('mousedown', () => {
    focusWindow(windowDiv);
  });
  
  // Focus immediately
  focusWindow(windowDiv);
  
  // Update status display visibility
  updateStatusDisplayVisibility();
}

function createWindowTab(windowObj) {
  const tab = document.createElement('button');
  tab.className = 'window-tab active';
  tab.id = `tab-${windowObj.id}`;
  
  tab.innerHTML = `
    <span class="window-tab-icon">🪟</span>
    <span class="window-tab-title">${windowObj.title}</span>
  `;
  
  tab.addEventListener('click', () => {
    toggleWindow(windowObj.id);
  });
  
  windowTabs.appendChild(tab);
}

function toggleWindow(windowId) {
  const windowObj = windows.find(w => w.id === windowId);
  if (!windowObj) return;
  
  if (windowObj.minimized) {
    // Restore window
    windowObj.element.style.display = 'flex';
    windowObj.minimized = false;
    updateWindowTab(windowId);
    focusWindow(windowObj.element);
  } else if (windowObj.element.classList.contains('active')) {
    // Minimize if already focused
    minimizeWindow(windowId);
  } else {
    // Focus if not focused
    focusWindow(windowObj.element);
  }
}

function minimizeWindow(windowId) {
  const windowObj = windows.find(w => w.id === windowId);
  if (!windowObj) return;
  
  windowObj.element.style.display = 'none';
  windowObj.minimized = true;
  updateWindowTab(windowId);
}

function maximizeWindow(windowId) {
  const windowObj = windows.find(w => w.id === windowId);
  if (!windowObj) return;
  
  if (windowObj.maximized) {
    // Restore to original size
    windowObj.element.style.width = windowObj.originalSize.width + 'px';
    windowObj.element.style.height = windowObj.originalSize.height + 'px';
    windowObj.element.style.left = windowObj.originalSize.x + 'px';
    windowObj.element.style.top = windowObj.originalSize.y + 'px';
    windowObj.maximized = false;
  } else {
    // Maximize
    windowObj.element.style.width = 'calc(100vw - 16px)';
    windowObj.element.style.height = `calc(100vh - ${48 + TITLEBAR_HEIGHT}px)`; // Subtract taskbar + titlebar
    windowObj.element.style.left = '8px';
    windowObj.element.style.top = '8px';
    windowObj.maximized = true;
  }
}

function updateWindowTab(windowId) {
  const windowObj = windows.find(w => w.id === windowId);
  if (!windowObj) return;
  
  const tab = document.getElementById(`tab-${windowId}`);
  if (!tab) return;
  
  if (windowObj.minimized) {
    tab.classList.add('minimized');
    tab.classList.remove('active');
  } else if (windowObj.element.classList.contains('active')) {
    tab.classList.add('active');
    tab.classList.remove('minimized');
  } else {
    tab.classList.remove('active', 'minimized');
  }
}

function setupWindowDragging(windowElement) {
  const titlebar = windowElement.querySelector('.window-titlebar');
  let isDragging = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;
  let lastSyncTime = 0;
  const syncThrottle = 16; // Sync every ~16ms (60fps) while dragging
  
  titlebar.addEventListener('mousedown', (e) => {
    if (e.target.closest('.window-control-btn')) return;
    
    isDragging = true;
    titlebar.classList.add('grabbing');
    
    // Mark window as dragging
    const windowId = parseInt(windowElement.id.replace('window-', ''));
    const windowObj = windows.find(w => w.id === windowId);
    if (windowObj) {
      windowObj.isDragging = true;
    }
    
    initialX = e.clientX - windowElement.offsetLeft;
    initialY = e.clientY - windowElement.offsetTop;
    
    focusWindow(windowElement);
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    e.preventDefault();
    currentX = e.clientX - initialX;
    currentY = e.clientY - initialY;
    
    windowElement.style.left = currentX + 'px';
    windowElement.style.top = currentY + 'px';
    
    // Throttled sync to OBS while dragging
    const now = performance.now();
    if (now - lastSyncTime >= syncThrottle) {
      lastSyncTime = now;
      const windowId = parseInt(windowElement.id.replace('window-', ''));
      syncWindowPositionToOBSQuiet(windowId); // Quiet version without UI feedback
    }
  });
  
  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      titlebar.classList.remove('grabbing');
      
      // Unmark window as dragging
      const windowId = parseInt(windowElement.id.replace('window-', ''));
      const windowObj = windows.find(w => w.id === windowId);
      if (windowObj) {
        windowObj.isDragging = false;
      }
      
      // Final sync position to OBS with feedback
      syncWindowPositionToOBS(windowId);
    }
  });
}

async function syncWindowPositionToOBS(windowId) {
  if (!obs || !connected) return;
  
  const windowObj = windows.find(w => w.id === windowId);
  if (!windowObj || !windowObj.sourceData) return;
  
  try {
    // Get current window position (top-left of window including titlebar)
    const windowX = parseInt(windowObj.element.style.left);
    const windowY = parseInt(windowObj.element.style.top);
    
    // Convert to OBS position (add titlebar offset since window Y is offset by titlebar)
    const obsX = windowX;
    const obsY = windowY + TITLEBAR_HEIGHT;
    
    // Show syncing indicator
    const dimensionsEl = windowObj.element.querySelector('.window-dimensions');
    const originalText = dimensionsEl.textContent;
    dimensionsEl.textContent = '↻ Syncing...';
    dimensionsEl.style.color = '#0078D4';
    
    // Get current transform from OBS
    const transform = await obs.call('GetSceneItemTransform', {
      sceneName: currentScene,
      sceneItemId: windowObj.sourceData.sceneItemId
    });
    
    const sceneItemTransform = transform.sceneItemTransform;
    
    // Update position in OBS
    await obs.call('SetSceneItemTransform', {
      sceneName: currentScene,
      sceneItemId: windowObj.sourceData.sceneItemId,
      sceneItemTransform: {
        positionX: obsX,
        positionY: obsY,
        rotation: sceneItemTransform.rotation,
        scaleX: sceneItemTransform.scaleX,
        scaleY: sceneItemTransform.scaleY,
        alignment: sceneItemTransform.alignment,
        boundsType: sceneItemTransform.boundsType,
        boundsAlignment: sceneItemTransform.boundsAlignment,
        boundsWidth: sceneItemTransform.boundsWidth,
        boundsHeight: sceneItemTransform.boundsHeight
      }
    });
    
    console.log(`Synced window "${windowObj.title}" position to OBS: (${obsX}, ${obsY})`);
    
    // Show success briefly
    dimensionsEl.textContent = '✓ Synced';
    dimensionsEl.style.color = '#4CAF50';
    
    setTimeout(() => {
      dimensionsEl.textContent = originalText;
      dimensionsEl.style.color = '#aaa';
    }, 1000);
    
  } catch (error) {
    console.error('Failed to sync position to OBS:', error);
    
    // Show error
    const dimensionsEl = windowObj.element.querySelector('.window-dimensions');
    dimensionsEl.textContent = '✕ Sync failed';
    dimensionsEl.style.color = '#ff4444';
    
    setTimeout(() => {
      const width = parseInt(windowObj.element.style.width);
      const height = parseInt(windowObj.element.style.height) - TITLEBAR_HEIGHT;
      dimensionsEl.textContent = `${width} × ${height}`;
      dimensionsEl.style.color = '#aaa';
    }, 2000);
  }
}

// Quiet version without UI feedback for use during dragging
async function syncWindowPositionToOBSQuiet(windowId) {
  if (!obs || !connected) return;
  
  const windowObj = windows.find(w => w.id === windowId);
  if (!windowObj || !windowObj.sourceData) return;
  
  try {
    // Get current window position
    const windowX = parseInt(windowObj.element.style.left);
    const windowY = parseInt(windowObj.element.style.top);
    
    // Convert to OBS position
    const obsX = windowX;
    const obsY = windowY + TITLEBAR_HEIGHT;
    
    // Get current transform from OBS
    const transform = await obs.call('GetSceneItemTransform', {
      sceneName: currentScene,
      sceneItemId: windowObj.sourceData.sceneItemId
    });
    
    const sceneItemTransform = transform.sceneItemTransform;
    
    // Update position in OBS
    await obs.call('SetSceneItemTransform', {
      sceneName: currentScene,
      sceneItemId: windowObj.sourceData.sceneItemId,
      sceneItemTransform: {
        positionX: obsX,
        positionY: obsY,
        rotation: sceneItemTransform.rotation,
        scaleX: sceneItemTransform.scaleX,
        scaleY: sceneItemTransform.scaleY,
        alignment: sceneItemTransform.alignment,
        boundsType: sceneItemTransform.boundsType,
        boundsAlignment: sceneItemTransform.boundsAlignment,
        boundsWidth: sceneItemTransform.boundsWidth,
        boundsHeight: sceneItemTransform.boundsHeight
      }
    });
    
  } catch (error) {
    // Silently fail during drag
    console.debug('Drag sync error:', error);
  }
}

// Sync windows FROM OBS (update window positions/sizes based on OBS changes)
async function syncWindowsFromOBS() {
  if (!obs || !connected || windows.length === 0) return;
  
  try {
    // Update each window
    for (const windowObj of windows) {
      if (!windowObj.sourceData || windowObj.isDragging) continue;
      
      const transform = await obs.call('GetSceneItemTransform', {
        sceneName: currentScene,
        sceneItemId: windowObj.sourceData.sceneItemId
      });
      
      const sceneItemTransform = transform.sceneItemTransform;
      const obsX = Math.round(sceneItemTransform.positionX);
      const obsY = Math.round(sceneItemTransform.positionY);
      const obsWidth = Math.round(sceneItemTransform.sourceWidth * sceneItemTransform.scaleX);
      const obsHeight = Math.round(sceneItemTransform.sourceHeight * sceneItemTransform.scaleY);
      
      // Get current window values
      const currentX = parseInt(windowObj.element.style.left);
      const currentY = parseInt(windowObj.element.style.top);
      const currentWidth = parseInt(windowObj.element.style.width);
      const currentHeight = parseInt(windowObj.element.style.height) - TITLEBAR_HEIGHT; // Subtract titlebar
      
      // Apply offset: window Y is offset by titlebar height so content aligns with source
      const windowX = obsX;
      const windowY = obsY - TITLEBAR_HEIGHT;
      
      // Only update if changed (avoid unnecessary DOM updates)
      if (windowX !== currentX || windowY !== currentY) {
        windowObj.element.style.left = windowX + 'px';
        windowObj.element.style.top = windowY + 'px';
      }
      
      if (obsWidth !== currentWidth || obsHeight !== currentHeight) {
        windowObj.element.style.width = obsWidth + 'px';
        windowObj.element.style.height = (obsHeight + TITLEBAR_HEIGHT) + 'px';
        
        // Update dimensions display
        const dimensionsEl = windowObj.element.querySelector('.window-dimensions');
        if (dimensionsEl) {
          dimensionsEl.textContent = `${obsWidth} × ${obsHeight}`;
        }
      }
    }
  } catch (error) {
    // Silently fail - source might have been deleted or scene changed
    console.debug('Sync from OBS error:', error);
  }
}

// Start 120fps sync loop
function startSyncLoop() {
  if (syncInterval) return; // Already running
  
  // Use requestAnimationFrame for smooth 120fps
  let lastTime = performance.now();
  const targetFPS = 120;
  const frameTime = 1000 / targetFPS;
  
  function syncLoop(currentTime) {
    if (!connected) {
      stopSyncLoop();
      return;
    }
    
    const deltaTime = currentTime - lastTime;
    
    if (deltaTime >= frameTime) {
      syncWindowsFromOBS();
      lastTime = currentTime - (deltaTime % frameTime);
    }
    
    syncInterval = requestAnimationFrame(syncLoop);
  }
  
  syncInterval = requestAnimationFrame(syncLoop);
  console.log('Started 120fps sync loop');
}

// Stop sync loop
function stopSyncLoop() {
  if (syncInterval) {
    cancelAnimationFrame(syncInterval);
    syncInterval = null;
    console.log('Stopped sync loop');
  }
}

function focusWindow(windowElement) {
  // Remove active class from all windows
  document.querySelectorAll('.fake-window').forEach(w => {
    w.classList.remove('active');
  });
  
  // Add active class to clicked window
  windowElement.classList.add('active');
  activeWindow = windowElement;
  
  // Update all tabs
  windows.forEach(w => {
    updateWindowTab(w.id);
  });
  
  // Move corresponding source to top in OBS
  const windowId = parseInt(windowElement.id.replace('window-', ''));
  moveSourceToTop(windowId);
}

async function moveSourceToTop(windowId) {
  if (!obs || !connected) return;
  
  const windowObj = windows.find(w => w.id === windowId);
  if (!windowObj || !windowObj.sourceData) return;
  
  try {
    // Get all scene items to find the highest index
    const sceneItems = await obs.call('GetSceneItemList', {
      sceneName: currentScene
    });
    
    // Move to top (index 0 is the bottom, highest index is the top)
    // So we set it to the last index
    const topIndex = sceneItems.sceneItems.length - 1;
    
    await obs.call('SetSceneItemIndex', {
      sceneName: currentScene,
      sceneItemId: windowObj.sourceData.sceneItemId,
      sceneItemIndex: topIndex
    });
    
    console.log(`Moved source "${windowObj.title}" to top layer (index ${topIndex})`);
    
  } catch (error) {
    console.debug('Failed to move source to top:', error);
  }
}

function closeWindow(windowId) {
  const windowObj = windows.find(w => w.id === windowId);
  if (windowObj) {
    windowObj.element.remove();
    
    // Remove tab
    const tab = document.getElementById(`tab-${windowId}`);
    if (tab) {
      tab.remove();
    }
    
    windows = windows.filter(w => w.id !== windowId);
    
    // Update status display visibility
    updateStatusDisplayVisibility();
  }
}

// Error handling
function showError(message) {
  connectionError.textContent = message;
  connectionError.classList.add('show');
}

function hideError() {
  connectionError.classList.remove('show');
}

// Event Listeners
startButton.addEventListener('click', toggleStartMenu);
menuOverlay.addEventListener('click', closeStartMenu);
connectBtn.addEventListener('click', connectToOBS);
document.getElementById('cancel-settings-btn').addEventListener('click', showSourcesPanel);
document.getElementById('configure-btn')?.addEventListener('click', showSettingsPanel);
document.getElementById('settings-btn').addEventListener('click', showSettingsPanel);
document.getElementById('disconnect-btn').addEventListener('click', disconnect);
addWindowBtn.addEventListener('click', showSourcesList);
backBtn.addEventListener('click', hideSourcesList);

// Allow Enter key to connect
wsPassword.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && libraryLoaded) {
    connectToOBS();
  }
});
