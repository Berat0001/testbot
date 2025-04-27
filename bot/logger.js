/**
 * Logger Module for Minecraft Bot
 * 
 * Handles logging to console and/or file based on configuration
 */

const fs = require('fs');
const path = require('path');

// Default configuration
let config = {
  level: 'info',
  logToConsole: true,
  logToFile: false,
  logFileName: 'minecraft-bot.log',
};

// Log levels and their priorities
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Log file stream
let logStream = null;

/**
 * Initialize the logger with the provided configuration
 */
function init(logConfig) {
  config = { ...config, ...logConfig };
  
  // Initialize log file if needed
  if (config.logToFile) {
    try {
      logStream = fs.createWriteStream(config.logFileName, { flags: 'a' });
      
      logStream.on('error', (err) => {
        console.error(`Error writing to log file: ${err.message}`);
        config.logToFile = false; // Disable file logging on error
      });
      
      // Write separator to indicate new log session
      const timestamp = new Date().toISOString();
      logStream.write(`\n--- Log session started at ${timestamp} ---\n`);
    } catch (err) {
      console.error(`Failed to initialize log file: ${err.message}`);
      config.logToFile = false; // Disable file logging on error
    }
  }
  
  log('info', 'Logger initialized');
}

/**
 * Close the logger and any open resources
 */
function close() {
  if (logStream) {
    const timestamp = new Date().toISOString();
    logStream.write(`\n--- Log session ended at ${timestamp} ---\n`);
    logStream.end();
    logStream = null;
  }
}

/**
 * Format a log message with timestamp and level
 */
function formatLogMessage(level, message) {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
}

/**
 * Write a log message to the appropriate outputs
 */
function log(level, message, ...args) {
  // Skip logging if the level is below the configured level
  if (LOG_LEVELS[level] < LOG_LEVELS[config.level]) {
    return;
  }
  
  // Format any additional arguments
  let fullMessage = message;
  if (args.length > 0) {
    if (args[0] instanceof Error) {
      // Special handling for Error objects
      fullMessage += `: ${args[0].message}`;
      if (level === 'debug' || level === 'error') {
        fullMessage += `\n${args[0].stack}`;
      }
    } else {
      // Try to stringify objects
      const formattedArgs = args.map(arg => {
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg);
          } catch (e) {
            return String(arg);
          }
        }
        return String(arg);
      });
      fullMessage += ` ${formattedArgs.join(' ')}`;
    }
  }
  
  const formattedMessage = formatLogMessage(level, fullMessage);
  
  // Log to console if enabled
  if (config.logToConsole) {
    const consoleMethod = 
      level === 'error' ? console.error :
      level === 'warn' ? console.warn :
      level === 'debug' ? console.debug :
      console.log;
    
    consoleMethod(formattedMessage);
  }
  
  // Log to file if enabled
  if (config.logToFile && logStream) {
    logStream.write(formattedMessage + '\n');
  }
}

// Export the logger functions
module.exports = {
  init,
  close,
  debug: (message, ...args) => log('debug', message, ...args),
  info: (message, ...args) => log('info', message, ...args),
  warn: (message, ...args) => log('warn', message, ...args),
  error: (message, ...args) => log('error', message, ...args),
};
