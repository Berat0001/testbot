/**
 * Minecraft Bot Web Interface
 * Enhanced with WebSocket for real-time updates
 */

// API endpoints
const API = {
    STATUS: '/api/status',
    CHAT: '/api/chat',
    COMMAND: '/api/command',
    INVENTORY: '/api/inventory',
    POSITION: '/api/position',
    HEALTH: '/api/health'
};

// DOM Elements
const elements = {
    statusBadge: document.getElementById('status-badge'),
    botUsername: document.getElementById('bot-username'),
    botState: document.getElementById('bot-state'),
    botHealth: document.getElementById('bot-health'),
    botFood: document.getElementById('bot-food'),
    botPosition: document.getElementById('bot-position'),
    botServer: document.getElementById('bot-server'),
    inventoryList: document.getElementById('inventory-list'),
    chatMessages: document.getElementById('chat-messages'),
    chatInput: document.getElementById('chat-input'),
    chatSend: document.getElementById('chat-send'),
    connectionStatus: document.getElementById('connection-status'),
    wsStatus: document.getElementById('ws-status'),
    dashboardHealth: document.getElementById('dashboard-health'),
    dashboardFood: document.getElementById('dashboard-food'),
    dashboardPosition: document.getElementById('dashboard-position'),
    buttons: {
        idle: document.getElementById('btn-idle'),
        explore: document.getElementById('btn-explore'),
        mine: document.getElementById('btn-mine'),
        gather: document.getElementById('btn-gather'),
        craft: document.getElementById('btn-craft'),
        follow: document.getElementById('btn-follow'),
        build: document.getElementById('btn-build')
    }
};

// State
let refreshInterval = null;
let isConnected = false;
let ws = null; // WebSocket connection
let wsConnected = false; // WebSocket connected status
let retryCount = 0; // WebSocket retry counter
const maxRetries = 5; // Maximum number of retry attempts
let retryTimeout = null; // WebSocket retry timeout

// Initialize the application
function init() {
    // Set up event listeners
    setupEventListeners();
    
    // Connect WebSocket
    connectWebSocket();
    
    // Load initial data
    refreshData();
    
    // Set up refresh interval as a fallback
    refreshInterval = setInterval(refreshData, 5000);
    
    // Add a message to the chat
    addChatMessage('Web interface initialized');
}

// Connect to WebSocket server
function connectWebSocket() {
    // Close any existing connection
    if (ws) {
        ws.close();
        ws = null;
    }
    
    try {
        // Create WebSocket connection
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        
        addChatMessage(`Connecting to WebSocket...`, true);
        
        ws = new WebSocket(wsUrl);
        
        // WebSocket event handlers
        ws.addEventListener('open', handleWsOpen);
        ws.addEventListener('message', handleWsMessage);
        ws.addEventListener('close', handleWsClose);
        ws.addEventListener('error', handleWsError);
        
        updateWsStatus('connecting');
    } catch (error) {
        console.error('WebSocket connection error:', error);
        updateWsStatus('error', error.message);
        scheduleReconnect();
    }
}

// Handle WebSocket open event
function handleWsOpen(event) {
    wsConnected = true;
    retryCount = 0;
    updateWsStatus('connected');
    addChatMessage('WebSocket connected', true);
    
    // Request initial status
    sendWsMessage({
        type: 'getStatus'
    });
}

// Handle WebSocket message event
function handleWsMessage(event) {
    try {
        const message = JSON.parse(event.data);
        
        if (!message || !message.type) return;
        
        switch (message.type) {
            case 'status':
                handleStatusUpdate(message.data);
                break;
                
            case 'chat':
                handleChatMessage(message.data);
                break;
                
            case 'health':
                handleHealthUpdate(message.data);
                break;
                
            case 'stateChanged':
                handleStateChanged(message.data);
                break;
                
            case 'commandResult':
                handleCommandResult(message.data);
                break;
        }
    } catch (error) {
        console.error('Error parsing WebSocket message:', error);
    }
}

// Handle WebSocket close event
function handleWsClose(event) {
    wsConnected = false;
    updateWsStatus('disconnected');
    
    if (event.wasClean) {
        addChatMessage(`WebSocket connection closed cleanly, code=${event.code}, reason=${event.reason}`, true);
    } else {
        addChatMessage('WebSocket connection lost', true);
    }
    
    scheduleReconnect();
}

// Handle WebSocket error event
function handleWsError(error) {
    wsConnected = false;
    updateWsStatus('error', error.message);
    console.error('WebSocket error:', error);
    addChatMessage(`WebSocket error: ${error.message || 'Unknown error'}`, true);
}

// Send message through WebSocket
function sendWsMessage(message) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.error('WebSocket not connected');
        return false;
    }
    
    try {
        ws.send(JSON.stringify(message));
        return true;
    } catch (error) {
        console.error('Error sending WebSocket message:', error);
        return false;
    }
}

// Schedule WebSocket reconnection
function scheduleReconnect() {
    if (retryTimeout) {
        clearTimeout(retryTimeout);
    }
    
    if (retryCount >= maxRetries) {
        addChatMessage(`Maximum reconnection attempts (${maxRetries}) reached. Please refresh the page.`, true);
        updateWsStatus('failed');
        return;
    }
    
    retryCount++;
    const delay = Math.min(1000 * Math.pow(1.5, retryCount), 10000); // Exponential backoff with 10s max
    
    addChatMessage(`Reconnecting in ${Math.round(delay/1000)} seconds... (Attempt ${retryCount}/${maxRetries})`, true);
    updateWsStatus('reconnecting', `Attempt ${retryCount}/${maxRetries}`);
    
    retryTimeout = setTimeout(() => {
        connectWebSocket();
    }, delay);
}

// Update WebSocket connection status display
function updateWsStatus(status, message = '') {
    if (!elements.wsStatus) return;
    
    let statusText = '';
    let statusClass = '';
    
    switch (status) {
        case 'connected':
            statusText = 'Connected ✓';
            statusClass = 'ws-connected';
            break;
        case 'connecting':
            statusText = 'Connecting...';
            statusClass = 'ws-connecting';
            break;
        case 'disconnected':
            statusText = 'Disconnected';
            statusClass = 'ws-disconnected';
            break;
        case 'reconnecting':
            statusText = `Reconnecting... ${message}`;
            statusClass = 'ws-reconnecting';
            break;
        case 'error':
            statusText = `Error: ${message}`;
            statusClass = 'ws-error';
            break;
        case 'failed':
            statusText = 'Connection failed';
            statusClass = 'ws-failed';
            break;
    }
    
    elements.wsStatus.textContent = statusText;
    elements.wsStatus.className = `ws-status ${statusClass}`;
}

// Set up event listeners
function setupEventListeners() {
    // Chat send button
    elements.chatSend.addEventListener('click', sendChatMessage);
    
    // Chat input enter key
    elements.chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            sendChatMessage();
        }
    });
    
    // Action buttons
    for (const [state, button] of Object.entries(elements.buttons)) {
        button.addEventListener('click', () => {
            changeState(state);
        });
    }
}

// Send a chat message
function sendChatMessage() {
    const message = elements.chatInput.value.trim();
    if (!message) return;
    
    // Clear input
    elements.chatInput.value = '';
    
    // Add message to chat
    addChatMessage(`You: ${message}`, true);
    
    // Check if it's a command
    if (message.startsWith('/')) {
        // Send as command without the slash
        const command = message.substring(1);
        sendCommand(command);
    } else {
        // Try to send via WebSocket first
        if (wsConnected && sendWsMessage({
            type: 'chat',
            data: { message }
        })) {
            // Message sent via WebSocket
        } else {
            // Fallback to REST API
            fetch(API.CHAT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ message })
            })
            .catch(error => {
                console.error('Error sending chat message:', error);
                addChatMessage('Error sending message: ' + error.message, true);
            });
        }
    }
}

// Send a command to the bot
function sendCommand(command) {
    // Try to send via WebSocket first
    if (wsConnected && sendWsMessage({
        type: 'command',
        data: { command }
    })) {
        // Command sent via WebSocket
    } else {
        // Fallback to REST API
        fetch(API.COMMAND, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ command })
        })
        .then(response => response.json())
        .then(data => {
            handleCommandResult(data);
        })
        .catch(error => {
            console.error('Error sending command:', error);
            addChatMessage('Error sending command: ' + error.message, true);
        });
    }
}

// Handle WebSocket status update
function handleStatusUpdate(data) {
    // Update bot status
    updateStatusDisplay(data);
    
    // Update health if available
    if (data.health) {
        updateHealthDisplay(data.health);
    }
    
    // Update position if available
    if (data.position) {
        updatePositionDisplay(data.position);
    }
}

// Handle WebSocket chat message
function handleChatMessage(data) {
    if (!data.username || !data.message) return;
    
    const message = `${data.username}: ${data.message}`;
    addChatMessage(message);
}

// Handle WebSocket health update
function handleHealthUpdate(data) {
    updateHealthDisplay(data);
}

// Handle WebSocket state change
function handleStateChanged(data) {
    if (!data.to) return;
    
    // Update state display
    elements.botState.textContent = data.to;
    
    // Update active button
    const stateMap = {
        'mining': 'mine'
        // Add other state mappings if needed
    };
    
    const uiState = stateMap[data.to] || data.to;
    
    if (elements.buttons[uiState]) {
        // Reset all buttons
        for (const button of Object.values(elements.buttons)) {
            button.classList.remove('active');
        }
        
        // Activate the current state button
        elements.buttons[uiState].classList.add('active');
    }
    
    addChatMessage(`Bot state changed to: ${data.to}`, true);
}

// Handle WebSocket command result
function handleCommandResult(data) {
    if (data.error) {
        addChatMessage(`Command error: ${data.error}`, true);
    } else if (data.result) {
        // Format the result based on its type
        if (typeof data.result === 'object') {
            const resultStr = JSON.stringify(data.result, null, 2);
            addChatMessage(`Command result: ${resultStr}`, true);
        } else {
            addChatMessage(`Command result: ${data.result}`, true);
        }
    } else if (data.message) {
        addChatMessage(`Command result: ${data.message}`, true);
    } else {
        addChatMessage('Command sent successfully', true);
    }
}

// Change the bot's state
function changeState(state) {
    // Reset all buttons
    for (const button of Object.values(elements.buttons)) {
        button.classList.remove('active');
    }
    
    // Activate the selected button
    elements.buttons[state].classList.add('active');
    
    // Send command to change state
    sendCommand(`state ${state}`);
}

// Add a message to the chat
function addChatMessage(message, isSystem = false) {
    const timestamp = new Date().toLocaleTimeString();
    
    const messageElement = document.createElement('div');
    messageElement.className = 'chat-message';
    
    const timestampElement = document.createElement('span');
    timestampElement.className = 'chat-timestamp';
    timestampElement.textContent = `[${timestamp}]`;
    
    const contentElement = document.createElement('span');
    contentElement.className = 'chat-content';
    if (isSystem) {
        contentElement.className += ' system-message';
    }
    contentElement.textContent = message;
    
    messageElement.appendChild(timestampElement);
    messageElement.appendChild(contentElement);
    
    elements.chatMessages.appendChild(messageElement);
    
    // Scroll to bottom
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

// Refresh all data
function refreshData() {
    refreshStatus();
    refreshHealth();
    refreshPosition();
    refreshInventory();
}

// Refresh bot status
function refreshStatus() {
    fetch(API.STATUS)
        .then(response => response.json())
        .then(data => {
            updateStatusDisplay(data);
        })
        .catch(error => {
            console.error('Error fetching status:', error);
            updateConnectionStatus(false);
        });
}

// Refresh bot health
function refreshHealth() {
    if (!isConnected) return;
    
    fetch(API.HEALTH)
        .then(response => response.json())
        .then(data => {
            updateHealthDisplay(data);
        })
        .catch(error => {
            console.error('Error fetching health:', error);
        });
}

// Refresh bot position
function refreshPosition() {
    if (!isConnected) return;
    
    fetch(API.POSITION)
        .then(response => response.json())
        .then(data => {
            updatePositionDisplay(data);
        })
        .catch(error => {
            console.error('Error fetching position:', error);
        });
}

// Refresh bot inventory
function refreshInventory() {
    if (!isConnected) return;
    
    fetch(API.INVENTORY)
        .then(response => response.json())
        .then(data => {
            updateInventoryDisplay(data);
        })
        .catch(error => {
            console.error('Error fetching inventory:', error);
        });
}

// Update status display
function updateStatusDisplay(data) {
    const wasConnected = isConnected;
    isConnected = data.online;
    
    // Update connection status
    updateConnectionStatus(isConnected);
    
    // Update other status information
    elements.botUsername.textContent = data.username || 'Unknown';
    elements.botState.textContent = data.currentState || 'Unknown';
    elements.botServer.textContent = data.server || 'Unknown';
    
    // If we just connected, log it
    if (isConnected && !wasConnected) {
        addChatMessage('Connected to bot', true);
    }
    
    // If we just disconnected, log it
    if (!isConnected && wasConnected) {
        addChatMessage('Disconnected from bot', true);
    }
    
    // Update which state button is active
    if (data.currentState && elements.buttons[data.currentState]) {
        // Reset all buttons
        for (const button of Object.values(elements.buttons)) {
            button.classList.remove('active');
        }
        
        // Activate the current state button
        elements.buttons[data.currentState].classList.add('active');
    }
}

// Update connection status display
function updateConnectionStatus(connected) {
    isConnected = connected;
    
    elements.statusBadge.textContent = connected ? 'Online' : 'Offline';
    elements.statusBadge.className = 'status-badge ' + (connected ? 'online' : '');
    
    // Disable inputs when offline
    elements.chatInput.disabled = !connected;
    elements.chatSend.disabled = !connected;
    
    // Disable action buttons when offline
    for (const button of Object.values(elements.buttons)) {
        button.disabled = !connected;
    }
}

// Update health display
function updateHealthDisplay(data) {
    const health = data.health || 0;
    const food = data.food || 0;
    
    // Update detailed text display
    elements.botHealth.textContent = `${health.toFixed(1)}/20`;
    elements.botFood.textContent = `${food.toFixed(1)}/20`;
    
    // Update dashboard indicators
    if (elements.dashboardHealth) {
        elements.dashboardHealth.textContent = health.toFixed(1);
        
        // Set color based on health level
        if (health < 6) {
            elements.dashboardHealth.style.color = '#f44336'; // Red for low health
        } else if (health < 12) {
            elements.dashboardHealth.style.color = '#ff9800'; // Orange for medium health
        } else {
            elements.dashboardHealth.style.color = '#4caf50'; // Green for high health
        }
    }
    
    if (elements.dashboardFood) {
        elements.dashboardFood.textContent = food.toFixed(1);
        
        // Set color based on food level
        if (food < 6) {
            elements.dashboardFood.style.color = '#f44336'; // Red for low food
        } else if (food < 12) {
            elements.dashboardFood.style.color = '#ff9800'; // Orange for medium food
        } else {
            elements.dashboardFood.style.color = '#4caf50'; // Green for high food
        }
    }
}

// Update position display
function updatePositionDisplay(data) {
    if (data.x !== undefined && data.y !== undefined && data.z !== undefined) {
        const x = data.x.toFixed(1);
        const y = data.y.toFixed(1);
        const z = data.z.toFixed(1);
        
        // Update detailed text display
        elements.botPosition.textContent = `X: ${x}, Y: ${y}, Z: ${z}`;
        
        // Update dashboard indicator
        if (elements.dashboardPosition) {
            elements.dashboardPosition.textContent = `${x}, ${y}, ${z}`;
        }
    } else {
        elements.botPosition.textContent = 'Unknown';
        
        if (elements.dashboardPosition) {
            elements.dashboardPosition.textContent = 'Unknown';
        }
    }
}

// Update inventory display
function updateInventoryDisplay(data) {
    // Clear inventory display
    elements.inventoryList.innerHTML = '';
    
    if (!data.items || data.items.length === 0) {
        const emptyMessage = document.createElement('p');
        emptyMessage.textContent = 'No items in inventory';
        elements.inventoryList.appendChild(emptyMessage);
        return;
    }
    
    // Group items by name
    const itemsByName = {};
    for (const item of data.items) {
        if (!itemsByName[item.name]) {
            itemsByName[item.name] = { count: 0, slots: [] };
        }
        itemsByName[item.name].count += item.count;
        itemsByName[item.name].slots.push(item.slot);
    }
    
    // Create item elements
    for (const [name, info] of Object.entries(itemsByName)) {
        const itemElement = document.createElement('div');
        itemElement.className = 'inventory-item';
        
        // Format name nicely
        const displayName = name
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
        
        itemElement.innerHTML = `
            <div class="inventory-item-name">${displayName}</div>
            <div class="inventory-item-count">${info.count}</div>
        `;
        
        elements.inventoryList.appendChild(itemElement);
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', init);