/**
 * Command Handler Plugin
 * 
 * Handles chat commands and provides a command registration system for other plugins.
 */

const BasePlugin = require('../basePlugin');

class CommandHandlerPlugin extends BasePlugin {
  constructor(bot, config, pluginManager) {
    super(bot, config, pluginManager);
    
    // Override base properties
    this.name = 'CommandHandler';
    this.description = 'Handles chat commands and provides a command system';
    this.version = '1.0.0';
    this.author = 'Replit';
    
    // Plugin-specific properties
    this.commands = new Map(); // Map of commands
    this.commandPrefix = '!'; // Default command prefix
    this.helpCommand = 'help'; // Default help command
    this.ownerCommands = []; // Commands only the owner can use
  }

  /**
   * Initialize the plugin
   */
  async initialize() {
    this.info('Initializing Command Handler plugin');
    
    // Load configuration
    this.loadConfig();
    
    // Register event handlers
    this.registerEvent('chat', this.handleChatMessage);
    this.registerEvent('whisper', this.handleWhisperMessage);
    
    // Register basic commands
    this.registerBasicCommands();
    
    this.isEnabled = true;
    this.info('Command Handler plugin initialized');
    return true;
  }

  /**
   * Load configuration from the plugin config
   */
  loadConfig() {
    // Default config values
    const defaultConfig = {
      commandPrefix: '!',
      helpCommand: 'help',
      ownerOnly: ['reload', 'disable', 'enable', 'reloadconfig'],
      respondToWhispers: true,
      ownerCommands: ['reload', 'disable', 'enable', 'reloadconfig']
    };
    
    // Merge with provided config
    this.config = { ...defaultConfig, ...this.config };
    
    // Update properties from config
    this.commandPrefix = this.config.commandPrefix;
    this.helpCommand = this.config.helpCommand;
    this.ownerCommands = this.config.ownerCommands;
  }

  /**
   * Register basic commands
   */
  registerBasicCommands() {
    // Register help command
    this.registerCommand(this.helpCommand, {
      description: 'Show available commands',
      usage: `${this.commandPrefix}${this.helpCommand} [command]`,
      handler: (username, args) => this.handleHelpCommand(username, args)
    });
    
    // Register plugins command to list plugins
    this.registerCommand('plugins', {
      description: 'List loaded plugins',
      usage: `${this.commandPrefix}plugins`,
      handler: (username, args) => this.handlePluginsCommand(username, args)
    });
    
    // Register reload command
    this.registerCommand('reload', {
      description: 'Reload a plugin',
      usage: `${this.commandPrefix}reload <plugin>`,
      ownerOnly: true,
      handler: (username, args) => this.handleReloadCommand(username, args)
    });
    
    // Register enable command
    this.registerCommand('enable', {
      description: 'Enable a plugin',
      usage: `${this.commandPrefix}enable <plugin>`,
      ownerOnly: true,
      handler: (username, args) => this.handleEnableCommand(username, args)
    });
    
    // Register disable command
    this.registerCommand('disable', {
      description: 'Disable a plugin',
      usage: `${this.commandPrefix}disable <plugin>`,
      ownerOnly: true,
      handler: (username, args) => this.handleDisableCommand(username, args)
    });
    
    // Register reloadconfig command
    this.registerCommand('reloadconfig', {
      description: 'Reload bot configuration',
      usage: `${this.commandPrefix}reloadconfig`,
      ownerOnly: true,
      handler: (username, args) => this.handleReloadConfigCommand(username, args)
    });
  }

  /**
   * Handle chat messages
   */
  handleChatMessage = (username, message) => {
    // Skip messages from the bot itself
    if (username === this.bot.username) return;
    
    // Check if message starts with the command prefix
    if (message.startsWith(this.commandPrefix)) {
      this.handleCommand(username, message.slice(this.commandPrefix.length), false);
    }
  }

  /**
   * Handle whisper messages
   */
  handleWhisperMessage = (username, message) => {
    // Skip messages from the bot itself
    if (username === this.bot.username) return;
    
    // Check if we should respond to whispers
    if (!this.config.respondToWhispers) return;
    
    // Check if message starts with the command prefix
    if (message.startsWith(this.commandPrefix)) {
      this.handleCommand(username, message.slice(this.commandPrefix.length), true);
    } else {
      // For whispers, allow commands without prefix
      this.handleCommand(username, message, true);
    }
  }

  /**
   * Handle a command
   */
  handleCommand(username, message, isWhisper) {
    // Parse command and arguments
    const args = message.trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();
    
    // Find the command
    const command = this.commands.get(commandName);
    
    if (!command) {
      // Unknown command
      if (isWhisper) {
        this.bot.whisper(username, `Unknown command: ${commandName}`);
      }
      return;
    }
    
    // Check if command is owner-only
    if (command.ownerOnly && !this.isOwner(username)) {
      if (isWhisper) {
        this.bot.whisper(username, `You don't have permission to use this command`);
      } else {
        this.bot.chat(`@${username} You don't have permission to use this command`);
      }
      return;
    }
    
    // Execute the command
    try {
      const response = command.handler(username, args);
      
      // Send the response if there is one
      if (response) {
        if (isWhisper) {
          this.bot.whisper(username, response);
        } else {
          this.bot.chat(response);
        }
      }
    } catch (error) {
      this.error(`Error executing command ${commandName}:`, error);
      
      if (isWhisper) {
        this.bot.whisper(username, `Error executing command: ${error.message}`);
      } else {
        this.bot.chat(`@${username} Error executing command: ${error.message}`);
      }
    }
  }

  /**
   * Check if a username is the bot owner
   */
  isOwner(username) {
    return this.pluginManager?.bot?.owner === username;
  }

  /**
   * Register a command
   */
  registerCommand(commandName, options) {
    if (!commandName || typeof commandName !== 'string') {
      this.warn('Invalid command name');
      return false;
    }
    
    commandName = commandName.toLowerCase();
    
    if (!options || typeof options !== 'object') {
      this.warn(`Invalid options for command ${commandName}`);
      return false;
    }
    
    if (typeof options.handler !== 'function') {
      this.warn(`No handler function provided for command ${commandName}`);
      return false;
    }
    
    // Create the command object
    const command = {
      name: commandName,
      description: options.description || `The ${commandName} command`,
      usage: options.usage || `${this.commandPrefix}${commandName}`,
      ownerOnly: options.ownerOnly || false,
      handler: options.handler
    };
    
    // Register the command
    this.commands.set(commandName, command);
    this.debug(`Registered command: ${commandName}`);
    
    return true;
  }

  /**
   * Unregister a command
   */
  unregisterCommand(commandName) {
    if (!commandName || typeof commandName !== 'string') {
      return false;
    }
    
    commandName = commandName.toLowerCase();
    
    if (!this.commands.has(commandName)) {
      return false;
    }
    
    // Don't allow unregistering built-in commands
    if (commandName === this.helpCommand) {
      this.warn('Cannot unregister built-in help command');
      return false;
    }
    
    this.commands.delete(commandName);
    this.debug(`Unregistered command: ${commandName}`);
    
    return true;
  }

  /**
   * Get a command by name
   */
  getCommand(commandName) {
    if (!commandName || typeof commandName !== 'string') {
      return null;
    }
    
    commandName = commandName.toLowerCase();
    return this.commands.get(commandName);
  }

  /**
   * Handle the help command
   */
  handleHelpCommand(username, args) {
    // If no arguments, show list of commands
    if (!args || args.length === 0) {
      const commandList = Array.from(this.commands.keys())
        .map(cmdName => this.commandPrefix + cmdName)
        .join(', ');
      
      return `Available commands: ${commandList} - Use ${this.commandPrefix}${this.helpCommand} <command> for more information`;
    }
    
    // Show help for a specific command
    const commandName = args[0].toLowerCase();
    const command = this.commands.get(commandName);
    
    if (!command) {
      return `Unknown command: ${commandName}`;
    }
    
    return `${command.description}\nUsage: ${command.usage}${command.ownerOnly ? ' (Owner only)' : ''}`;
  }

  /**
   * Handle the plugins command
   */
  handlePluginsCommand(username, args) {
    const loadedPlugins = this.pluginManager.getLoadedPlugins();
    const enabledPlugins = this.pluginManager.getEnabledPlugins();
    
    // Format plugin list
    const pluginList = loadedPlugins.map(pluginName => {
      const isEnabled = enabledPlugins.includes(pluginName);
      return `${pluginName} [${isEnabled ? 'Enabled' : 'Disabled'}]`;
    }).join(', ');
    
    return `Loaded plugins (${loadedPlugins.length}): ${pluginList}`;
  }

  /**
   * Handle the reload command
   */
  handleReloadCommand(username, args) {
    if (!args || args.length === 0) {
      return `Usage: ${this.commandPrefix}reload <plugin>`;
    }
    
    const pluginName = args[0];
    
    // Check if plugin exists
    if (!this.pluginManager.getLoadedPlugins().includes(pluginName)) {
      return `Plugin not found: ${pluginName}`;
    }
    
    // Reload the plugin
    this.pluginManager.reloadPlugin(pluginName)
      .then(success => {
        if (success) {
          this.bot.chat(`Plugin ${pluginName} reloaded successfully`);
        } else {
          this.bot.chat(`Failed to reload plugin ${pluginName}`);
        }
      })
      .catch(error => {
        this.error(`Error reloading plugin ${pluginName}:`, error);
        this.bot.chat(`Error reloading plugin ${pluginName}: ${error.message}`);
      });
    
    return `Reloading plugin: ${pluginName}...`;
  }

  /**
   * Handle the enable command
   */
  handleEnableCommand(username, args) {
    if (!args || args.length === 0) {
      return `Usage: ${this.commandPrefix}enable <plugin>`;
    }
    
    const pluginName = args[0];
    
    // Check if plugin exists
    if (!this.pluginManager.getLoadedPlugins().includes(pluginName)) {
      return `Plugin not found: ${pluginName}`;
    }
    
    // Check if plugin is already enabled
    if (this.pluginManager.isPluginEnabled(pluginName)) {
      return `Plugin ${pluginName} is already enabled`;
    }
    
    // Enable the plugin
    this.pluginManager.enablePlugin(pluginName)
      .then(success => {
        if (success) {
          this.bot.chat(`Plugin ${pluginName} enabled successfully`);
        } else {
          this.bot.chat(`Failed to enable plugin ${pluginName}`);
        }
      })
      .catch(error => {
        this.error(`Error enabling plugin ${pluginName}:`, error);
        this.bot.chat(`Error enabling plugin ${pluginName}: ${error.message}`);
      });
    
    return `Enabling plugin: ${pluginName}...`;
  }

  /**
   * Handle the disable command
   */
  handleDisableCommand(username, args) {
    if (!args || args.length === 0) {
      return `Usage: ${this.commandPrefix}disable <plugin>`;
    }
    
    const pluginName = args[0];
    
    // Check if plugin exists
    if (!this.pluginManager.getLoadedPlugins().includes(pluginName)) {
      return `Plugin not found: ${pluginName}`;
    }
    
    // Check if plugin is enabled
    if (!this.pluginManager.isPluginEnabled(pluginName)) {
      return `Plugin ${pluginName} is already disabled`;
    }
    
    // Don't allow disabling CommandHandler itself
    if (pluginName === this.name) {
      return `Cannot disable the CommandHandler plugin`;
    }
    
    // Disable the plugin
    this.pluginManager.disablePlugin(pluginName)
      .then(success => {
        if (success) {
          this.bot.chat(`Plugin ${pluginName} disabled successfully`);
        } else {
          this.bot.chat(`Failed to disable plugin ${pluginName}`);
        }
      })
      .catch(error => {
        this.error(`Error disabling plugin ${pluginName}:`, error);
        this.bot.chat(`Error disabling plugin ${pluginName}: ${error.message}`);
      });
    
    return `Disabling plugin: ${pluginName}...`;
  }

  /**
   * Handle the reloadconfig command
   */
  handleReloadConfigCommand(username, args) {
    // This is a placeholder - the actual config reloading would depend on the implementation
    this.bot.chat('Reloading configuration...');
    
    // Notify plugins to reload their configs
    const loadedPlugins = this.pluginManager.getLoadedPlugins();
    
    for (const pluginName of loadedPlugins) {
      const plugin = this.pluginManager.getPlugin(pluginName);
      
      if (plugin && typeof plugin.reloadConfig === 'function') {
        try {
          plugin.reloadConfig();
        } catch (error) {
          this.error(`Error reloading config for plugin ${pluginName}:`, error);
        }
      }
    }
    
    this.bot.chat('Configuration reloaded');
    return null;
  }

  /**
   * Shutdown the plugin
   */
  async shutdown() {
    this.info('Shutting down Command Handler plugin');
    
    // Unregister all events
    this.unregisterAllEvents();
    
    // Clear commands
    this.commands.clear();
    
    this.isEnabled = false;
    this.info('Command Handler plugin shut down');
    return true;
  }
}

module.exports = CommandHandlerPlugin;