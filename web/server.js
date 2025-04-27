/**
 * Web Server Module
 * 
 * Provides a web interface for controlling and monitoring the bot.
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const url = require('url');
const { WebSocketServer } = require('ws');
const logger = require('../bot/logger');

// Store the bot instance
let botInstance = null;

// Track server status
let serverStarted = false;

// WebSocket clients
const wsClients = new Set();

// Create HTTP server
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  
  // Handle API endpoints
  if (pathname.startsWith('/api/')) {
    handleApiRequest(req, res, pathname, parsedUrl.query);
    return;
  }
  
  // Serve static files
  serveStaticFile(res, pathname);
});

// Create WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });

// WebSocket connection handler
wss.on('connection', (ws) => {
  // Add client to set
  wsClients.add(ws);
  logger.info(`WebSocket client connected. Total clients: ${wsClients.size}`);
  
  // Send initial status update
  sendStatusUpdate(ws);
  
  // Handle client messages
  ws.on('message', (messageBuffer) => {
    try {
      const message = JSON.parse(messageBuffer.toString());
      handleWsMessage(ws, message);
    } catch (error) {
      logger.error(`Error parsing WebSocket message: ${error.message}`);
    }
  });
  
  // Handle client disconnection
  ws.on('close', () => {
    wsClients.delete(ws);
    logger.info(`WebSocket client disconnected. Total clients: ${wsClients.size}`);
  });
  
  // Handle errors
  ws.on('error', (error) => {
    logger.error(`WebSocket error: ${error.message}`);
    wsClients.delete(ws);
  });
});

// Configure server error handler
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    logger.warn(`Port already in use. Web server not restarted, but bot instance updated.`);
    // The port is in use, but we still want to update the bot instance
    serverStarted = true;
  } else {
    logger.error(`Web server error: ${error.message}`);
  }
});

/**
 * Start the web server
 */
function start(bot, port = 8080) {
  // Update bot instance regardless of server state
  botInstance = bot;
  
  // Setup bot event listeners for WebSocket
  setupBotEvents();
  
  // If server already started, just update the bot instance
  if (serverStarted) {
    logger.info(`Web server already running, updated bot instance`);
    return server;
  }
  
  // Use port 5000 for external access in Replit
  const serverPort = 5000;
  
  try {
    logger.info(`Attempting to start web server on port ${serverPort}...`);
    server.listen(serverPort, '0.0.0.0', () => {
      logger.info(`Web server started on port ${serverPort}`);
      serverStarted = true;
    });
    
    // Make sure we return the server
    return server;
  } catch (error) {
    // If port is already in use, we'll get the error in the 'error' event handler
    if (error.code !== 'EADDRINUSE') {
      logger.error(`Failed to start web server: ${error.message}`);
    }
    
    // Still return server even if there was an error
    return server;
  }
}

/**
 * Handle API requests
 */
function handleApiRequest(req, res, pathname, query) {
  // Set CORS headers to allow requests from any origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // Ensure JSON response
  res.setHeader('Content-Type', 'application/json');
  
  // Check if bot is available
  if (!botInstance) {
    res.writeHead(503);
    res.end(JSON.stringify({ error: 'Bot not initialized' }));
    return;
  }
  
  try {
    // Handle different API endpoints
    switch (pathname) {
      case '/api/status':
        handleStatusRequest(res);
        break;
      
      case '/api/chat':
        handleChatRequest(req, res, query);
        break;
      
      case '/api/command':
        handleCommandRequest(req, res, query);
        break;
      
      case '/api/inventory':
        handleInventoryRequest(res);
        break;
      
      case '/api/position':
        handlePositionRequest(res);
        break;
      
      case '/api/health':
        handleHealthRequest(res);
        break;
      
      default:
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'API endpoint not found' }));
    }
  } catch (error) {
    logger.error(`API error: ${error.message}`);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

/**
 * Handle status request
 */
function handleStatusRequest(res) {
  try {
    // Use the Mineflayer bot instance's connected property
    const actualBot = botInstance.bot;
    const isConnected = actualBot && typeof actualBot.entity !== 'undefined';
    
    const status = {
      online: isConnected,
      username: actualBot ? actualBot.username : 'unknown',
      currentState: botInstance.stateMachine ? 
        (botInstance.stateMachine.currentState ? botInstance.stateMachine.currentState.name : 'unknown') : 
        'unknown',
      server: actualBot && actualBot.game ? (actualBot.game.serverBrand || 'unknown') : 'unknown'
    };
    
    res.writeHead(200);
    res.end(JSON.stringify(status));
  } catch (error) {
    logger.error(`Status request error: ${error.message}`);
    res.writeHead(500);
    res.end(JSON.stringify({ 
      online: false,
      error: 'Error getting bot status' 
    }));
  }
}

/**
 * Handle chat message request
 */
function handleChatRequest(req, res, query) {
  if (req.method !== 'POST' && !query.message) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'Missing message parameter' }));
    return;
  }
  
  // If GET request, use query parameter
  if (req.method === 'GET' && query.message) {
    botInstance.bot.chat(query.message);
    res.writeHead(200);
    res.end(JSON.stringify({ success: true }));
    return;
  }
  
  // If POST request, read body
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });
  
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      if (data.message) {
        botInstance.bot.chat(data.message);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
      } else {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing message parameter' }));
      }
    } catch (error) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  });
}

/**
 * Handle command request
 */
function handleCommandRequest(req, res, query) {
  if (req.method !== 'POST' && !query.command) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'Missing command parameter' }));
    return;
  }
  
  // If GET request, use query parameter
  if (req.method === 'GET' && query.command) {
    const result = executeCommand(query.command);
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, result }));
    return;
  }
  
  // If POST request, read body
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });
  
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      if (data.command) {
        const result = executeCommand(data.command);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, result }));
      } else {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing command parameter' }));
      }
    } catch (error) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  });
}

/**
 * Execute a bot command
 */
function executeCommand(commandStr) {
  if (!botInstance) {
    return { error: 'Bot not available' };
  }
  
  try {
    const parts = commandStr.split(' ');
    const command = parts[0];
    const args = parts.slice(1);
    
    // Special handling for state command (direct state change)
    if (command === 'state' && args.length > 0) {
      let newState = args[0];
      
      // Map frontend state names to actual state names
      const stateNameMap = {
        'mine': 'mining'
        // Add any other mismatches here
      };
      
      // Apply mapping if needed
      if (stateNameMap[newState]) {
        newState = stateNameMap[newState];
      }
      
      // Check if state machine exists
      if (botInstance.stateMachine) {
        // Find available states
        const availableStates = botInstance.stateMachine.states || [];
        const currentState = botInstance.stateMachine.currentState || {};
        logger.info(`Attempting to change state from ${currentState.name || 'unknown'} to ${newState}`);
        
        if (botInstance.changeState) {
          botInstance.changeState(newState);
          return { success: true, message: `State changed to ${newState}` };
        } else {
          // Fallback method to change state if method not available
          if (botInstance.stateMachine.pushState) {
            const stateObj = availableStates.find(s => s.name === newState);
            if (stateObj) {
              // Pop current state if any
              if (botInstance.stateMachine.popState) {
                botInstance.stateMachine.popState();
              }
              
              // Push new state
              botInstance.stateMachine.pushState(stateObj);
              return { success: true, message: `State changed to ${newState}` };
            } else {
              return { error: `State ${newState} not found` };
            }
          }
        }
      }
      
      return { error: 'State machine not initialized' };
    }
    
    // Check for command system
    if (botInstance.commandSystem) {
      return { success: true, result: botInstance.commandSystem.executeCommand('web', command, args) };
    } else if (botInstance.bot && botInstance.bot.chat) {
      // Fallback to direct chat commands
      if (command === 'say' && args.length > 0) {
        const message = args.join(' ');
        botInstance.bot.chat(message);
        return { success: true, message: `Said: ${message}` };
      } else {
        // Send as command
        const commandMessage = '!' + command + (args.length > 0 ? ' ' + args.join(' ') : '');
        botInstance.bot.chat(commandMessage);
        return { success: true, message: `Executed command: ${commandMessage}` };
      }
    }
    
    return { error: 'Command system not available' };
  } catch (error) {
    logger.error(`Command error: ${error.message}`);
    return { error: error.message };
  }
}

/**
 * Handle inventory request
 */
function handleInventoryRequest(res) {
  try {
    const actualBot = botInstance.bot;
    
    if (!actualBot || !actualBot.inventory) {
      res.writeHead(503);
      res.end(JSON.stringify({ error: 'Bot inventory not available' }));
      return;
    }
    
    const inventory = {
      items: actualBot.inventory.items().map(item => ({
        name: item.name,
        count: item.count,
        slot: item.slot
      }))
    };
    
    res.writeHead(200);
    res.end(JSON.stringify(inventory));
  } catch (error) {
    logger.error(`Inventory request error: ${error.message}`);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Error getting inventory' }));
  }
}

/**
 * Handle position request
 */
function handlePositionRequest(res) {
  try {
    const actualBot = botInstance.bot;
    
    if (!actualBot || !actualBot.entity || !actualBot.entity.position) {
      res.writeHead(503);
      res.end(JSON.stringify({ error: 'Bot position not available' }));
      return;
    }
    
    const position = {
      x: actualBot.entity.position.x,
      y: actualBot.entity.position.y,
      z: actualBot.entity.position.z,
      yaw: actualBot.entity.yaw,
      pitch: actualBot.entity.pitch,
      onGround: actualBot.entity.onGround
    };
    
    res.writeHead(200);
    res.end(JSON.stringify(position));
  } catch (error) {
    logger.error(`Position request error: ${error.message}`);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Error getting position' }));
  }
}

/**
 * Handle health request
 */
function handleHealthRequest(res) {
  try {
    const actualBot = botInstance.bot;
    
    if (!actualBot) {
      res.writeHead(503);
      res.end(JSON.stringify({ error: 'Bot health not available' }));
      return;
    }
    
    const health = {
      health: actualBot.health || 0,
      food: actualBot.food || 0,
      saturation: actualBot.foodSaturation || 0
    };
    
    res.writeHead(200);
    res.end(JSON.stringify(health));
  } catch (error) {
    logger.error(`Health request error: ${error.message}`);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Error getting health' }));
  }
}

/**
 * Serve static files
 */
function serveStaticFile(res, pathname) {
  // Default to index.html for root path
  const filePath = pathname === '/' ? '/index.html' : pathname;
  
  // Determine file extension
  const ext = path.extname(filePath);
  let contentType = 'text/html';
  
  switch (ext) {
    case '.js':
      contentType = 'text/javascript';
      break;
    case '.css':
      contentType = 'text/css';
      break;
    case '.json':
      contentType = 'application/json';
      break;
    case '.png':
      contentType = 'image/png';
      break;
    case '.jpg':
      contentType = 'image/jpg';
      break;
    case '.ico':
      contentType = 'image/x-icon';
      break;
  }
  
  // Check if file exists in the web directory
  const webDir = path.join(__dirname, 'public');
  const fullPath = path.join(webDir, filePath);
  
  // Prevent directory traversal attacks
  if (!fullPath.startsWith(webDir)) {
    res.writeHead(403);
    res.end('403 Forbidden');
    return;
  }
  
  // Try to serve the file if it exists
  fs.readFile(fullPath, (err, data) => {
    if (err) {
      // If file doesn't exist, serve a simple default page
      res.writeHead(404);
      res.end(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Minecraft Bot Web Interface</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; line-height: 1.6; }
            .container { max-width: 800px; margin: 0 auto; }
            h1 { color: #333; }
            p { margin-bottom: 10px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Minecraft Bot Web Interface</h1>
            <p>The web interface files are not yet created. Available API endpoints:</p>
            <ul>
              <li><code>/api/status</code> - Get bot status</li>
              <li><code>/api/chat?message=hello</code> - Send a chat message</li>
              <li><code>/api/command?command=help</code> - Execute a bot command</li>
              <li><code>/api/inventory</code> - Get inventory contents</li>
              <li><code>/api/position</code> - Get bot position</li>
              <li><code>/api/health</code> - Get bot health and food</li>
            </ul>
          </div>
        </body>
        </html>
      `);
    } else {
      // Serve the file
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
}

// Create the public directory if it doesn't exist
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
  try {
    fs.mkdirSync(publicDir, { recursive: true });
  } catch (error) {
    logger.warn(`Could not create public directory: ${error.message}`);
  }
}

/**
 * Send status update to WebSocket client
 */
function sendStatusUpdate(ws) {
  try {
    if (!botInstance || ws.readyState !== 1) return;
    
    const actualBot = botInstance.bot;
    const isConnected = actualBot && typeof actualBot.entity !== 'undefined';
    
    // Prepare status data
    const statusData = {
      type: 'status',
      data: {
        online: isConnected,
        username: actualBot ? actualBot.username : 'unknown',
        currentState: botInstance.stateMachine ? 
          (botInstance.stateMachine.currentState ? botInstance.stateMachine.currentState.name : 'unknown') : 
          'unknown',
        server: actualBot && actualBot.game ? (actualBot.game.serverBrand || 'unknown') : 'unknown',
        time: new Date().toISOString()
      }
    };
    
    // Add health data if available
    if (isConnected && actualBot) {
      statusData.data.health = {
        health: actualBot.health || 0,
        food: actualBot.food || 0,
        saturation: actualBot.foodSaturation || 0
      };
    }
    
    // Add position data if available
    if (isConnected && actualBot && actualBot.entity && actualBot.entity.position) {
      statusData.data.position = {
        x: actualBot.entity.position.x,
        y: actualBot.entity.position.y,
        z: actualBot.entity.position.z,
        yaw: actualBot.entity.yaw,
        pitch: actualBot.entity.pitch,
        onGround: actualBot.entity.onGround
      };
    }
    
    // Send update to client
    ws.send(JSON.stringify(statusData));
  } catch (error) {
    logger.error(`Error sending status update: ${error.message}`);
  }
}

/**
 * Broadcast message to all connected WebSocket clients
 */
function broadcastMessage(message) {
  wsClients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(JSON.stringify(message));
    }
  });
}

/**
 * Handle WebSocket message
 */
function handleWsMessage(ws, message) {
  if (!message || !message.type) return;
  
  switch (message.type) {
    case 'getStatus':
      sendStatusUpdate(ws);
      break;
      
    case 'command':
      if (message.data && message.data.command) {
        const result = executeCommand(message.data.command);
        ws.send(JSON.stringify({
          type: 'commandResult',
          data: result
        }));
      }
      break;
      
    case 'chat':
      if (message.data && message.data.message && botInstance && botInstance.bot) {
        try {
          botInstance.bot.chat(message.data.message);
          ws.send(JSON.stringify({
            type: 'chatResult',
            data: { success: true }
          }));
        } catch (error) {
          ws.send(JSON.stringify({
            type: 'chatResult',
            data: { success: false, error: error.message }
          }));
        }
      }
      break;
  }
}

/**
 * Setup bot event listeners for WebSocket updates
 */
function setupBotEvents() {
  if (!botInstance || !botInstance.bot) return;
  
  // Chat messages
  if (typeof botInstance.bot.on === 'function') {
    botInstance.bot.on('chat', (username, message) => {
      if (username === botInstance.bot.username) return;
      
      broadcastMessage({
        type: 'chat',
        data: {
          username,
          message,
          timestamp: new Date().toISOString()
        }
      });
    });
    
    // Health updates
    botInstance.bot.on('health', () => {
      broadcastMessage({
        type: 'health',
        data: {
          health: botInstance.bot.health,
          food: botInstance.bot.food,
          saturation: botInstance.bot.foodSaturation
        }
      });
    });
    
    // State changes
    if (botInstance.stateMachine && typeof botInstance.stateMachine.on === 'function') {
      botInstance.stateMachine.on('stateChanged', (oldState, newState) => {
        broadcastMessage({
          type: 'stateChanged',
          data: {
            from: oldState ? oldState.name : 'unknown',
            to: newState ? newState.name : 'unknown'
          }
        });
      });
    }
    
    // Send status updates periodically
    setInterval(() => {
      wsClients.forEach(client => {
        sendStatusUpdate(client);
      });
    }, 3000);
  }
}

module.exports = {
  start
};