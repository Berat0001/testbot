/**
 * Teleport Commands Plugin
 * 
 * Adds commands for teleporting and waypoint management.
 */

const BasePlugin = require('../basePlugin');
const Vec3 = require('vec3');
const fs = require('fs');
const path = require('path');

class TeleportCommandsPlugin extends BasePlugin {
  constructor(bot, config, pluginManager) {
    super(bot, config, pluginManager);
    
    // Override base properties
    this.name = 'TeleportCommands';
    this.description = 'Adds teleport and waypoint management commands';
    this.version = '1.0.0';
    this.author = 'Replit';
    
    // Plugin-specific properties
    this.waypoints = new Map(); // Map of waypoints
    this.waypointsFile = path.join(process.cwd(), 'waypoints.json'); // File to save waypoints
    this.homeLocation = null; // Home location for quick teleporting
  }

  /**
   * Initialize the plugin
   */
  async initialize() {
    this.info('Initializing Teleport Commands plugin');
    
    // Load waypoints from file
    await this.loadWaypoints();
    
    // Register commands
    this.registerCommands();
    
    this.isEnabled = true;
    this.info('Teleport Commands plugin initialized');
    return true;
  }

  /**
   * Register plugin commands
   */
  registerCommands() {
    try {
      // Get the command handler plugin
      const commandHandler = this.pluginManager.getPlugin('CommandHandler');
      if (!commandHandler) {
        this.warn('CommandHandler plugin not found, cannot register commands');
        return;
      }
      
      // Register commands
      commandHandler.registerCommand('waypoint', {
        description: 'Manage waypoints (save, list, delete)',
        usage: '!waypoint <save|list|delete|goto> [name] [x y z]',
        handler: (username, args) => this.handleWaypointCommand(username, args)
      });
      
      commandHandler.registerCommand('home', {
        description: 'Set home location or teleport to it',
        usage: '!home [set]',
        handler: (username, args) => this.handleHomeCommand(username, args)
      });
      
      commandHandler.registerCommand('tp', {
        description: 'Teleport to coordinates or player',
        usage: '!tp <x y z | player>',
        handler: (username, args) => this.handleTeleportCommand(username, args)
      });
      
      commandHandler.registerCommand('tpr', {
        description: 'Teleport to relative coordinates',
        usage: '!tpr <x> <y> <z>',
        handler: (username, args) => this.handleRelativeTeleportCommand(username, args)
      });
      
      commandHandler.registerCommand('tpup', {
        description: 'Teleport upward by a specified distance',
        usage: '!tpup [distance]',
        handler: (username, args) => this.handleTeleportUpCommand(username, args)
      });
      
      this.info('Registered teleport commands');
    } catch (error) {
      this.error('Error registering teleport commands:', error);
    }
  }

  /**
   * Handle the waypoint command
   */
  handleWaypointCommand(username, args) {
    if (!args || args.length === 0) {
      return '!waypoint <save|list|delete|goto> [name] [x y z]';
    }
    
    const subCommand = args[0].toLowerCase();
    
    switch (subCommand) {
      case 'save':
        return this.handleWaypointSave(username, args.slice(1));
      case 'list':
        return this.handleWaypointList(username);
      case 'delete':
        return this.handleWaypointDelete(username, args.slice(1));
      case 'goto':
        return this.handleWaypointGoto(username, args.slice(1));
      default:
        return `Unknown waypoint command: ${subCommand}. Available: save, list, delete, goto`;
    }
  }

  /**
   * Handle saving a waypoint
   */
  handleWaypointSave(username, args) {
    if (!args || args.length === 0) {
      return 'Usage: !waypoint save <name> [x y z]';
    }
    
    const name = args[0].toLowerCase();
    let position;
    
    // If coordinates are provided, use them
    if (args.length >= 4) {
      const x = parseFloat(args[1]);
      const y = parseFloat(args[2]);
      const z = parseFloat(args[3]);
      
      if (isNaN(x) || isNaN(y) || isNaN(z)) {
        return 'Invalid coordinates. Use numbers only.';
      }
      
      position = new Vec3(x, y, z);
    } else {
      // Use current bot position
      position = this.bot.entity.position.clone();
    }
    
    // Save the waypoint
    this.waypoints.set(name, {
      name,
      position: {
        x: position.x,
        y: position.y,
        z: position.z
      },
      createdBy: username,
      createdAt: new Date().toISOString()
    });
    
    // Save waypoints to file
    this.saveWaypoints();
    
    return `Waypoint '${name}' saved at ${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}`;
  }

  /**
   * Handle listing waypoints
   */
  handleWaypointList(username) {
    if (this.waypoints.size === 0) {
      return 'No waypoints have been saved yet.';
    }
    
    // Format waypoints list
    const waypointsList = Array.from(this.waypoints.values())
      .map(wp => `${wp.name}: (${wp.position.x.toFixed(1)}, ${wp.position.y.toFixed(1)}, ${wp.position.z.toFixed(1)})`)
      .join(', ');
    
    return `Saved waypoints (${this.waypoints.size}): ${waypointsList}`;
  }

  /**
   * Handle deleting a waypoint
   */
  handleWaypointDelete(username, args) {
    if (!args || args.length === 0) {
      return 'Usage: !waypoint delete <name>';
    }
    
    const name = args[0].toLowerCase();
    
    if (!this.waypoints.has(name)) {
      return `Waypoint '${name}' not found.`;
    }
    
    // Delete waypoint
    this.waypoints.delete(name);
    
    // Save waypoints to file
    this.saveWaypoints();
    
    return `Waypoint '${name}' deleted.`;
  }

  /**
   * Handle teleporting to a waypoint
   */
  handleWaypointGoto(username, args) {
    if (!args || args.length === 0) {
      return 'Usage: !waypoint goto <name>';
    }
    
    const name = args[0].toLowerCase();
    
    if (!this.waypoints.has(name)) {
      return `Waypoint '${name}' not found.`;
    }
    
    const waypoint = this.waypoints.get(name);
    
    // Create Vec3 from stored position
    const position = new Vec3(
      waypoint.position.x,
      waypoint.position.y,
      waypoint.position.z
    );
    
    // Teleport to waypoint
    this.teleportTo(position);
    
    return `Teleported to waypoint '${name}'.`;
  }

  /**
   * Handle the home command
   */
  handleHomeCommand(username, args) {
    // If 'set' argument is provided, set home location
    if (args && args.length > 0 && args[0].toLowerCase() === 'set') {
      return this.handleSetHome(username);
    }
    
    // Otherwise, teleport to home if set
    if (!this.homeLocation) {
      return 'Home location not set. Use !home set to set your current location as home.';
    }
    
    // Teleport to home
    this.teleportTo(this.homeLocation);
    
    return 'Teleported to home.';
  }

  /**
   * Handle setting home location
   */
  handleSetHome(username) {
    const position = this.bot.entity.position.clone();
    this.homeLocation = position;
    
    // Save home location in waypoints
    this.waypoints.set('home', {
      name: 'home',
      position: {
        x: position.x,
        y: position.y,
        z: position.z
      },
      createdBy: username,
      createdAt: new Date().toISOString(),
      isHome: true
    });
    
    // Save waypoints to file
    this.saveWaypoints();
    
    return `Home location set to ${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}`;
  }

  /**
   * Handle the teleport command
   */
  handleTeleportCommand(username, args) {
    if (!args || args.length === 0) {
      return 'Usage: !tp <x y z | player>';
    }
    
    // Check if teleporting to coordinates or player
    if (args.length >= 3) {
      // Teleport to coordinates
      const x = parseFloat(args[0]);
      const y = parseFloat(args[1]);
      const z = parseFloat(args[2]);
      
      if (isNaN(x) || isNaN(y) || isNaN(z)) {
        return 'Invalid coordinates. Use numbers only.';
      }
      
      const position = new Vec3(x, y, z);
      this.teleportTo(position);
      
      return `Teleported to ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`;
    } else {
      // Teleport to player
      const playerName = args[0];
      const player = this.bot.players[playerName];
      
      if (!player || !player.entity) {
        return `Player ${playerName} not found or not in range.`;
      }
      
      const position = player.entity.position.clone();
      this.teleportTo(position);
      
      return `Teleported to ${playerName} at ${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}`;
    }
  }

  /**
   * Handle relative teleport command
   */
  handleRelativeTeleportCommand(username, args) {
    if (!args || args.length < 3) {
      return 'Usage: !tpr <x> <y> <z>';
    }
    
    const relX = parseFloat(args[0]);
    const relY = parseFloat(args[1]);
    const relZ = parseFloat(args[2]);
    
    if (isNaN(relX) || isNaN(relY) || isNaN(relZ)) {
      return 'Invalid relative coordinates. Use numbers only.';
    }
    
    const currentPos = this.bot.entity.position;
    const newPos = currentPos.clone().add(new Vec3(relX, relY, relZ));
    
    this.teleportTo(newPos);
    
    return `Teleported ${relX >= 0 ? '+' : ''}${relX.toFixed(1)}, ${relY >= 0 ? '+' : ''}${relY.toFixed(1)}, ${relZ >= 0 ? '+' : ''}${relZ.toFixed(1)} blocks to ${newPos.x.toFixed(1)}, ${newPos.y.toFixed(1)}, ${newPos.z.toFixed(1)}`;
  }

  /**
   * Handle teleport up command
   */
  handleTeleportUpCommand(username, args) {
    let distance = 10; // Default distance
    
    if (args && args.length > 0) {
      const parsed = parseInt(args[0], 10);
      if (!isNaN(parsed) && parsed > 0) {
        distance = parsed;
      }
    }
    
    const currentPos = this.bot.entity.position;
    const newPos = currentPos.clone().add(new Vec3(0, distance, 0));
    
    this.teleportTo(newPos);
    
    return `Teleported ${distance} blocks up to ${newPos.x.toFixed(1)}, ${newPos.y.toFixed(1)}, ${newPos.z.toFixed(1)}`;
  }

  /**
   * Teleport the bot to a position
   */
  teleportTo(position) {
    try {
      // Attempt to use setPosition method if available (creative mode)
      if (typeof this.bot.entity.setPosition === 'function') {
        this.bot.entity.setPosition(position.x, position.y, position.z);
      } else {
        // Otherwise, try using the bot's chat to execute a teleport command
        this.bot.chat(`/tp ${position.x.toFixed(1)} ${position.y.toFixed(1)} ${position.z.toFixed(1)}`);
      }
    } catch (error) {
      this.error('Error teleporting:', error);
      this.bot.chat('Failed to teleport: ' + error.message);
    }
  }

  /**
   * Load waypoints from file
   */
  async loadWaypoints() {
    try {
      // Check if waypoints file exists
      if (fs.existsSync(this.waypointsFile)) {
        // Read and parse waypoints
        const data = await fs.promises.readFile(this.waypointsFile, 'utf8');
        const waypoints = JSON.parse(data);
        
        // Convert to Map
        this.waypoints.clear();
        for (const wp of waypoints) {
          this.waypoints.set(wp.name, wp);
          
          // Set home location if found
          if (wp.isHome) {
            this.homeLocation = new Vec3(wp.position.x, wp.position.y, wp.position.z);
          }
        }
        
        this.info(`Loaded ${this.waypoints.size} waypoints from file`);
      } else {
        this.info('No waypoints file found, starting with empty waypoints');
      }
    } catch (error) {
      this.error('Error loading waypoints:', error);
    }
  }

  /**
   * Save waypoints to file
   */
  async saveWaypoints() {
    try {
      // Convert Map to array for JSON serialization
      const waypoints = Array.from(this.waypoints.values());
      
      // Write to file
      await fs.promises.writeFile(this.waypointsFile, JSON.stringify(waypoints, null, 2), 'utf8');
      
      this.info(`Saved ${waypoints.length} waypoints to file`);
    } catch (error) {
      this.error('Error saving waypoints:', error);
    }
  }

  /**
   * Reload plugin configuration
   */
  reloadConfig() {
    // Reload waypoints
    this.loadWaypoints();
  }

  /**
   * Shutdown the plugin
   */
  async shutdown() {
    this.info('Shutting down Teleport Commands plugin');
    
    // Save waypoints before shutdown
    await this.saveWaypoints();
    
    this.isEnabled = false;
    this.info('Teleport Commands plugin shut down');
    return true;
  }
}

module.exports = TeleportCommandsPlugin;