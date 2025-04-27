/**
 * Plugin Manager
 * 
 * Handles loading, enabling, and disabling behavior plugins for the Minecraft bot.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../bot/logger');

class PluginManager {
  constructor(bot, config) {
    this.bot = bot;
    this.config = config;
    this.plugins = new Map(); // Map of plugin instances by name
    this.pluginConfigs = new Map(); // Map of plugin configs by name
    this.pluginsDir = path.join(__dirname, 'behaviors');
    this.customPluginsDir = path.join(__dirname, 'custom');
    this.loadedPlugins = [];
    this.enabledPlugins = [];
  }

  /**
   * Initialize the plugin manager
   */
  async initialize() {
    logger.info('Initializing plugin manager');
    
    // Ensure plugin directories exist
    this.ensureDirectories();
    
    // Load plugin configurations from config
    this.loadPluginConfigs();
    
    // Discover and load plugins
    await this.discoverPlugins();
    
    // Initialize loaded plugins
    await this.initializePlugins();
    
    logger.info(`Plugin manager initialized. Loaded ${this.loadedPlugins.length} plugins, ${this.enabledPlugins.length} enabled.`);
    return true;
  }

  /**
   * Ensure plugin directories exist
   */
  ensureDirectories() {
    try {
      if (!fs.existsSync(this.pluginsDir)) {
        fs.mkdirSync(this.pluginsDir, { recursive: true });
      }
      
      if (!fs.existsSync(this.customPluginsDir)) {
        fs.mkdirSync(this.customPluginsDir, { recursive: true });
      }
    } catch (error) {
      logger.error(`Error ensuring plugin directories: ${error.message}`);
    }
  }

  /**
   * Load plugin configurations from main config
   */
  loadPluginConfigs() {
    if (!this.config.plugins) {
      logger.warn('No plugin configuration found in config.js');
      return;
    }
    
    // Load configurations for each plugin
    for (const [pluginName, pluginConfig] of Object.entries(this.config.plugins)) {
      this.pluginConfigs.set(pluginName, {
        enabled: pluginConfig.enabled !== false, // Enable by default
        config: pluginConfig
      });
      
      logger.debug(`Loaded config for plugin: ${pluginName}`);
    }
  }

  /**
   * Discover available plugins
   */
  async discoverPlugins() {
    logger.info('Discovering plugins');
    
    // Load core plugins
    await this.loadPluginsFromDirectory(this.pluginsDir);
    
    // Load custom plugins
    await this.loadPluginsFromDirectory(this.customPluginsDir);
  }

  /**
   * Load plugins from a directory
   */
  async loadPluginsFromDirectory(directory) {
    try {
      if (!fs.existsSync(directory)) {
        logger.debug(`Plugin directory does not exist: ${directory}`);
        return;
      }
      
      const files = fs.readdirSync(directory);
      
      for (const file of files) {
        // Only load .js files
        if (!file.endsWith('.js')) continue;
        
        const pluginPath = path.join(directory, file);
        const pluginName = path.basename(file, '.js');
        
        try {
          // Check if plugin is specifically disabled in config
          const pluginConfig = this.pluginConfigs.get(pluginName);
          if (pluginConfig && pluginConfig.enabled === false) {
            logger.info(`Plugin ${pluginName} is disabled in config, skipping`);
            continue;
          }
          
          // Load the plugin
          await this.loadPlugin(pluginName, pluginPath);
        } catch (error) {
          logger.error(`Error loading plugin ${pluginName}: ${error.message}`);
        }
      }
    } catch (error) {
      logger.error(`Error reading plugin directory ${directory}: ${error.message}`);
    }
  }

  /**
   * Load a specific plugin
   */
  async loadPlugin(pluginName, pluginPath) {
    try {
      // Clear the require cache in case we're reloading
      delete require.cache[require.resolve(pluginPath)];
      
      // Load the plugin module
      const PluginClass = require(pluginPath);
      
      // Get plugin config
      const pluginConfig = this.pluginConfigs.get(pluginName)?.config || {};
      
      // Make sure we pass the actual bot instance, not BotManager
      const actualBot = this.bot.bot || this.bot;
      
      // Create plugin instance
      const plugin = new PluginClass(actualBot, pluginConfig, this);
      
      // Check if plugin has required methods
      if (typeof plugin.initialize !== 'function') {
        throw new Error(`Plugin ${pluginName} does not have an initialize method`);
      }
      
      // Store the plugin instance
      this.plugins.set(pluginName, plugin);
      this.loadedPlugins.push(pluginName);
      
      logger.info(`Loaded plugin: ${pluginName}`);
      return true;
    } catch (error) {
      logger.error(`Failed to load plugin ${pluginName}: ${error.message}`);
      return false;
    }
  }

  /**
   * Initialize loaded plugins
   */
  async initializePlugins() {
    logger.info('Initializing plugins');
    
    for (const pluginName of this.loadedPlugins) {
      try {
        const plugin = this.plugins.get(pluginName);
        
        // Get plugin config
        const pluginConfig = this.pluginConfigs.get(pluginName);
        const enabled = pluginConfig ? pluginConfig.enabled !== false : true;
        
        if (enabled) {
          // Initialize plugin
          const success = await plugin.initialize();
          
          if (success) {
            this.enabledPlugins.push(pluginName);
            logger.info(`Initialized plugin: ${pluginName}`);
          } else {
            logger.warn(`Failed to initialize plugin: ${pluginName}`);
          }
        } else {
          logger.info(`Plugin ${pluginName} is disabled, skipping initialization`);
        }
      } catch (error) {
        logger.error(`Error initializing plugin ${pluginName}: ${error.message}`);
      }
    }
  }

  /**
   * Enable a plugin
   */
  async enablePlugin(pluginName) {
    // Check if plugin is loaded
    if (!this.plugins.has(pluginName)) {
      logger.warn(`Cannot enable plugin ${pluginName}: not loaded`);
      return false;
    }
    
    // Check if plugin is already enabled
    if (this.enabledPlugins.includes(pluginName)) {
      logger.debug(`Plugin ${pluginName} is already enabled`);
      return true;
    }
    
    try {
      const plugin = this.plugins.get(pluginName);
      
      // Initialize plugin if not already initialized
      const success = await plugin.initialize();
      
      if (success) {
        this.enabledPlugins.push(pluginName);
        
        // Update plugin config
        if (this.pluginConfigs.has(pluginName)) {
          this.pluginConfigs.get(pluginName).enabled = true;
        } else {
          this.pluginConfigs.set(pluginName, { enabled: true, config: {} });
        }
        
        logger.info(`Enabled plugin: ${pluginName}`);
        return true;
      } else {
        logger.warn(`Failed to initialize plugin: ${pluginName}`);
        return false;
      }
    } catch (error) {
      logger.error(`Error enabling plugin ${pluginName}: ${error.message}`);
      return false;
    }
  }

  /**
   * Disable a plugin
   */
  async disablePlugin(pluginName) {
    // Check if plugin is loaded
    if (!this.plugins.has(pluginName)) {
      logger.warn(`Cannot disable plugin ${pluginName}: not loaded`);
      return false;
    }
    
    // Check if plugin is already disabled
    if (!this.enabledPlugins.includes(pluginName)) {
      logger.debug(`Plugin ${pluginName} is already disabled`);
      return true;
    }
    
    try {
      const plugin = this.plugins.get(pluginName);
      
      // Call shutdown method if available
      if (typeof plugin.shutdown === 'function') {
        await plugin.shutdown();
      }
      
      // Remove from enabled plugins
      const index = this.enabledPlugins.indexOf(pluginName);
      if (index !== -1) {
        this.enabledPlugins.splice(index, 1);
      }
      
      // Update plugin config
      if (this.pluginConfigs.has(pluginName)) {
        this.pluginConfigs.get(pluginName).enabled = false;
      }
      
      logger.info(`Disabled plugin: ${pluginName}`);
      return true;
    } catch (error) {
      logger.error(`Error disabling plugin ${pluginName}: ${error.message}`);
      return false;
    }
  }

  /**
   * Reload a plugin
   */
  async reloadPlugin(pluginName) {
    // Check if plugin is loaded
    if (!this.plugins.has(pluginName)) {
      logger.warn(`Cannot reload plugin ${pluginName}: not loaded`);
      return false;
    }
    
    // Get plugin state
    const wasEnabled = this.enabledPlugins.includes(pluginName);
    const pluginPath = this.findPluginPath(pluginName);
    
    if (!pluginPath) {
      logger.warn(`Cannot reload plugin ${pluginName}: plugin path not found`);
      return false;
    }
    
    // Disable plugin first
    if (wasEnabled) {
      await this.disablePlugin(pluginName);
    }
    
    // Remove plugin from loaded plugins
    const loadedIndex = this.loadedPlugins.indexOf(pluginName);
    if (loadedIndex !== -1) {
      this.loadedPlugins.splice(loadedIndex, 1);
    }
    
    // Remove plugin instance
    this.plugins.delete(pluginName);
    
    // Load plugin again
    const loaded = await this.loadPlugin(pluginName, pluginPath);
    
    if (!loaded) {
      logger.error(`Failed to reload plugin: ${pluginName}`);
      return false;
    }
    
    // Re-enable if it was enabled before
    if (wasEnabled) {
      await this.enablePlugin(pluginName);
    }
    
    logger.info(`Reloaded plugin: ${pluginName}`);
    return true;
  }

  /**
   * Find the file path for a plugin
   */
  findPluginPath(pluginName) {
    // Check core plugins directory
    const corePath = path.join(this.pluginsDir, `${pluginName}.js`);
    if (fs.existsSync(corePath)) {
      return corePath;
    }
    
    // Check custom plugins directory
    const customPath = path.join(this.customPluginsDir, `${pluginName}.js`);
    if (fs.existsSync(customPath)) {
      return customPath;
    }
    
    return null;
  }

  /**
   * Get a plugin instance by name
   */
  getPlugin(pluginName) {
    return this.plugins.get(pluginName);
  }

  /**
   * Check if a plugin is enabled
   */
  isPluginEnabled(pluginName) {
    return this.enabledPlugins.includes(pluginName);
  }

  /**
   * Get list of loaded plugins
   */
  getLoadedPlugins() {
    return [...this.loadedPlugins];
  }

  /**
   * Get list of enabled plugins
   */
  getEnabledPlugins() {
    return [...this.enabledPlugins];
  }

  /**
   * Shutdown all plugins
   */
  async shutdown() {
    logger.info('Shutting down plugins');
    
    for (const pluginName of this.enabledPlugins) {
      try {
        const plugin = this.plugins.get(pluginName);
        
        // Call shutdown method if available
        if (typeof plugin.shutdown === 'function') {
          await plugin.shutdown();
        }
        
        logger.debug(`Shutdown plugin: ${pluginName}`);
      } catch (error) {
        logger.error(`Error shutting down plugin ${pluginName}: ${error.message}`);
      }
    }
    
    this.enabledPlugins = [];
    logger.info('All plugins shut down');
  }
}

module.exports = PluginManager;