/**
 * Base Plugin Class
 * 
 * All behavior plugins should extend this class.
 */

const logger = require('../bot/logger');

class BasePlugin {
  constructor(bot, config, pluginManager) {
    this.bot = bot;
    this.config = config || {};
    this.pluginManager = pluginManager;
    this.isEnabled = false;
    this.name = this.constructor.name;
    this.description = 'A plugin for the Minecraft bot.';
    this.version = '1.0.0';
    this.author = 'Unknown';
    this.dependencies = []; // Array of plugin names this plugin depends on
    this.eventHandlers = new Map(); // Map of event handlers
  }

  /**
   * Initialize the plugin
   * Override this method in your plugin
   */
  async initialize() {
    logger.info(`Initializing plugin: ${this.name}`);
    this.isEnabled = true;
    return true;
  }

  /**
   * Shutdown the plugin
   * Override this method in your plugin to clean up resources
   */
  async shutdown() {
    logger.info(`Shutting down plugin: ${this.name}`);
    this.unregisterAllEvents();
    this.isEnabled = false;
    return true;
  }

  /**
   * Check if all dependencies are available
   */
  checkDependencies() {
    if (!this.dependencies || this.dependencies.length === 0) {
      return true;
    }
    
    for (const dependency of this.dependencies) {
      if (!this.pluginManager.isPluginEnabled(dependency)) {
        logger.warn(`Plugin ${this.name} is missing dependency: ${dependency}`);
        return false;
      }
    }
    
    return true;
  }

  /**
   * Register an event handler
   */
  registerEvent(eventName, handler, once = false) {
    if (!eventName || typeof handler !== 'function') {
      return false;
    }
    
    // Create wrapper function to preserve context
    const boundHandler = (...args) => handler.apply(this, args);
    
    // Store the handler reference for unregistering later
    if (!this.eventHandlers.has(eventName)) {
      this.eventHandlers.set(eventName, []);
    }
    
    this.eventHandlers.get(eventName).push({
      original: handler,
      bound: boundHandler,
      once: once
    });
    
    // Get the actual Mineflayer bot instance
    const botInstance = this.bot.bot ? this.bot.bot : this.bot;
    
    // Check if bot instance has event methods
    if (!botInstance || typeof botInstance.on !== 'function') {
      this.error(`Cannot register event '${eventName}': bot instance does not have event methods`);
      return false;
    }
    
    // Register with bot
    if (once) {
      botInstance.once(eventName, boundHandler);
    } else {
      botInstance.on(eventName, boundHandler);
    }
    
    return true;
  }

  /**
   * Register an event handler that only fires once
   */
  registerOnceEvent(eventName, handler) {
    return this.registerEvent(eventName, handler, true);
  }

  /**
   * Unregister an event handler
   */
  unregisterEvent(eventName, handler) {
    if (!this.eventHandlers.has(eventName)) {
      return false;
    }
    
    const handlers = this.eventHandlers.get(eventName);
    const index = handlers.findIndex(h => h.original === handler);
    
    if (index === -1) {
      return false;
    }
    
    // Get the actual Mineflayer bot instance
    const botInstance = this.bot.bot ? this.bot.bot : this.bot;
    
    // Get the bound handler and remove it
    const { bound } = handlers[index];
    if (botInstance && typeof botInstance.removeListener === 'function') {
      botInstance.removeListener(eventName, bound);
    }
    
    // Remove from our tracking
    handlers.splice(index, 1);
    
    // Clean up if no handlers left
    if (handlers.length === 0) {
      this.eventHandlers.delete(eventName);
    }
    
    return true;
  }

  /**
   * Unregister all event handlers for a specific event
   */
  unregisterEventType(eventName) {
    if (!this.eventHandlers.has(eventName)) {
      return false;
    }
    
    // Get the actual Mineflayer bot instance
    const botInstance = this.bot.bot ? this.bot.bot : this.bot;
    const handlers = this.eventHandlers.get(eventName);
    
    // Unregister all handlers for this event
    if (botInstance && typeof botInstance.removeListener === 'function') {
      for (const { bound } of handlers) {
        botInstance.removeListener(eventName, bound);
      }
    }
    
    // Clear our tracking
    this.eventHandlers.delete(eventName);
    return true;
  }

  /**
   * Unregister all event handlers
   */
  unregisterAllEvents() {
    // Get the actual Mineflayer bot instance
    const botInstance = this.bot.bot ? this.bot.bot : this.bot;
    
    if (botInstance && typeof botInstance.removeListener === 'function') {
      for (const [eventName, handlers] of this.eventHandlers.entries()) {
        for (const { bound } of handlers) {
          botInstance.removeListener(eventName, bound);
        }
      }
    }
    
    this.eventHandlers.clear();
    return true;
  }

  /**
   * Log a message with plugin name prefix
   */
  log(level, message, ...args) {
    const prefix = `[${this.name}]`;
    logger[level](`${prefix} ${message}`, ...args);
  }

  /**
   * Log an info message
   */
  info(message, ...args) {
    this.log('info', message, ...args);
  }

  /**
   * Log a debug message
   */
  debug(message, ...args) {
    this.log('debug', message, ...args);
  }

  /**
   * Log a warning message
   */
  warn(message, ...args) {
    this.log('warn', message, ...args);
  }

  /**
   * Log an error message
   */
  error(message, ...args) {
    this.log('error', message, ...args);
  }

  /**
   * Get a plugin instance by name
   * Convenience method to access other plugins
   */
  getPlugin(pluginName) {
    return this.pluginManager.getPlugin(pluginName);
  }

  /**
   * Get plugin metadata
   */
  getMetadata() {
    return {
      name: this.name,
      description: this.description,
      version: this.version,
      author: this.author,
      dependencies: this.dependencies,
      isEnabled: this.isEnabled
    };
  }
}

module.exports = BasePlugin;