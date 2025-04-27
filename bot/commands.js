/**
 * Command System for Minecraft Bot
 * 
 * Handles all chat commands for controlling the bot
 */

const logger = require('./logger');

class CommandSystem {
  constructor(bot, config, botManager) {
    this.bot = bot;
    this.config = config;
    this.botManager = botManager;
    this.commands = this.setupCommands();
  }
  
  /**
   * Set up all available commands
   */
  setupCommands() {
    return {
      // Help and info commands
      'help': {
        description: 'Shows available commands',
        usage: 'help [command]',
        execute: (username, args) => this.handleHelp(username, args),
      },
      'info': {
        description: 'Shows bot information',
        usage: 'info',
        execute: (username) => this.handleInfo(username),
      },
      'status': {
        description: 'Shows current bot status',
        usage: 'status',
        execute: (username) => this.handleStatus(username),
      },
      
      // Movement and location commands
      'come': {
        description: 'Bot comes to your location',
        usage: 'come',
        execute: (username) => this.handleCome(username),
      },
      'follow': {
        description: 'Bot follows you around',
        usage: 'follow [stop]',
        execute: (username, args) => this.handleFollow(username, args),
      },
      'goto': {
        description: 'Bot goes to specified coordinates',
        usage: 'goto <x> <y> <z>',
        execute: (username, args) => this.handleGoto(username, args),
      },
      'explore': {
        description: 'Bot explores the area',
        usage: 'explore [radius]',
        execute: (username, args) => this.handleExplore(username, args),
      },
      
      // Action commands
      'mine': {
        description: 'Bot mines specified block or resource',
        usage: 'mine <block> [amount]',
        execute: (username, args) => this.handleMine(username, args),
      },
      'collect': {
        description: 'Bot collects nearby items',
        usage: 'collect [item]',
        execute: (username, args) => this.handleCollect(username, args),
      },
      'build': {
        description: 'Bot builds a structure',
        usage: 'build <structure> [material]',
        execute: (username, args) => this.handleBuild(username, args),
      },
      'craft': {
        description: 'Bot crafts an item',
        usage: 'craft <item> [amount]',
        execute: (username, args) => this.handleCraft(username, args),
      },
      'attack': {
        description: 'Bot attacks specified entity',
        usage: 'attack <entity>',
        execute: (username, args) => this.handleAttack(username, args),
      },
      'defend': {
        description: 'Bot defends you or itself',
        usage: 'defend [self|owner]',
        execute: (username, args) => this.handleDefend(username, args),
      },
      'equip': {
        description: 'Bot equips the specified item',
        usage: 'equip <item>',
        execute: (username, args) => this.handleEquip(username, args),
      },
      'drop': {
        description: 'Bot drops specified item',
        usage: 'drop <item> [amount]',
        execute: (username, args) => this.handleDrop(username, args),
      },
      'place': {
        description: 'Bot places block at specified position',
        usage: 'place <block> <x> <y> <z>',
        execute: (username, args) => this.handlePlace(username, args),
      },
      'eat': {
        description: 'Bot eats food if available',
        usage: 'eat [food]',
        execute: (username, args) => this.handleEat(username, args),
      },
      
      // Inventory commands
      'inventory': {
        description: 'Shows bot inventory',
        usage: 'inventory',
        execute: (username) => this.handleInventory(username),
      },
      'give': {
        description: 'Bot gives you an item',
        usage: 'give <item> [amount]',
        execute: (username, args) => this.handleGive(username, args),
      },
      
      // State commands
      'state': {
        description: 'Gets or sets the current bot state',
        usage: 'state [new state]',
        execute: (username, args) => this.handleState(username, args),
      },
      'stop': {
        description: 'Stops current activity',
        usage: 'stop',
        execute: (username) => this.handleStop(username),
      },
      
      // Advanced commands
      'exec': {
        description: 'Execute a series of commands',
        usage: 'exec <commands separated by ;>',
        execute: (username, args) => this.handleExec(username, args),
      },
      'say': {
        description: 'Makes the bot say something in chat',
        usage: 'say <message>',
        execute: (username, args) => this.handleSay(username, args),
      },
      'defense': {
        description: 'Set up defensive operations in the area',
        usage: 'defense [radius]',
        execute: (username, args) => this.handleDefenseCommand(username, args),
      },
    };
  }
  
  /**
   * Execute a command by name with arguments
   */
  executeCommand(username, command, args) {
    logger.info(`Command received from ${username}: ${command} ${args.join(' ')}`);
    
    if (this.commands[command]) {
      try {
        this.commands[command].execute(username, args);
      } catch (error) {
        logger.error(`Error executing command ${command}:`, error);
        this.bot.chat(`Error executing command: ${error.message}`);
      }
    } else {
      this.bot.chat(`Unknown command: ${command}. Use ${this.config.chat.commandPrefix}help to see available commands.`);
    }
  }
  
  /**
   * Handle the help command
   */
  handleHelp(username, args) {
    if (args.length > 0) {
      // Help for specific command
      const commandName = args[0].toLowerCase();
      const command = this.commands[commandName];
      
      if (command) {
        this.bot.chat(`Command: ${this.config.chat.commandPrefix}${commandName}`);
        this.bot.chat(`Description: ${command.description}`);
        this.bot.chat(`Usage: ${this.config.chat.commandPrefix}${command.usage}`);
      } else {
        this.bot.chat(`Command not found: ${commandName}`);
      }
      
      return;
    }
    
    // General help
    this.bot.chat(`Available commands (use ${this.config.chat.commandPrefix}help <command> for details):`);
    
    // Group commands by category
    const categories = {
      'Info': ['help', 'info', 'status'],
      'Movement': ['come', 'follow', 'goto', 'explore'],
      'Actions': ['mine', 'collect', 'build', 'craft', 'attack', 'defend', 'equip', 'drop', 'place', 'eat'],
      'Inventory': ['inventory', 'give'],
      'State': ['state', 'stop'],
      'Advanced': ['exec', 'say'],
    };
    
    // Send each category and its commands
    for (const [category, commandList] of Object.entries(categories)) {
      this.bot.chat(`---- ${category} ----`);
      this.bot.chat(commandList.map(cmd => this.config.chat.commandPrefix + cmd).join(', '));
    }
  }
  
  /**
   * Handle the info command
   */
  handleInfo(username) {
    this.bot.chat(`I am ${this.bot.username}, a Mineflayer bot.`);
    this.bot.chat(`Position: ${this.bot.entity.position.floored().toString()}`);
    this.bot.chat(`Health: ${this.bot.health.toFixed(1)}, Food: ${this.bot.food}`);
    this.bot.chat(`Current state: ${this.botManager.getState()}`);
    if (this.botManager.owner) {
      this.bot.chat(`My owner is: ${this.botManager.owner}`);
    }
  }
  
  /**
   * Handle the status command
   */
  handleStatus(username) {
    const healthStatus = this.getHealthStatus();
    const inventoryStatus = this.getInventoryStatus();
    const positionStatus = this.getPositionStatus();
    
    this.bot.chat(`Health: ${healthStatus}`);
    this.bot.chat(`Inventory: ${inventoryStatus}`);
    this.bot.chat(`Position: ${positionStatus}`);
    this.bot.chat(`Current state: ${this.botManager.getState()}`);
    
    // Report current target if any
    if (this.botManager.target) {
      this.bot.chat(`Current target: ${this.botManager.target.name || this.botManager.target.username || 'Unknown entity'}`);
    }
  }
  
  /**
   * Get health status text
   */
  getHealthStatus() {
    const health = this.bot.health;
    const food = this.bot.food;
    
    let healthDesc = 'Unknown';
    if (health > 15) healthDesc = 'Good';
    else if (health > 8) healthDesc = 'Injured';
    else if (health > 0) healthDesc = 'Critical';
    
    let foodDesc = 'Unknown';
    if (food > 15) foodDesc = 'Well fed';
    else if (food > 8) foodDesc = 'Hungry';
    else if (food > 0) foodDesc = 'Starving';
    
    return `${healthDesc} (${health.toFixed(1)}/20), Food: ${foodDesc} (${food}/20)`;
  }
  
  /**
   * Get inventory status text
   */
  getInventoryStatus() {
    const inventory = this.bot.inventory.items();
    if (inventory.length === 0) return 'Empty';
    
    // Count items by category
    const categories = {
      tools: 0,
      weapons: 0,
      armor: 0,
      blocks: 0,
      food: 0,
      resources: 0,
    };
    
    inventory.forEach(item => {
      if (item.name.includes('_sword') || item.name.includes('_axe') && item.name !== 'pickaxe') {
        categories.weapons++;
      } else if (item.name.includes('_pickaxe') || item.name.includes('_shovel') || item.name.includes('_hoe')) {
        categories.tools++;
      } else if (item.name.includes('_helmet') || item.name.includes('_chestplate') || 
                item.name.includes('_leggings') || item.name.includes('_boots')) {
        categories.armor++;
      } else if (this.isEdible(item.name)) {
        categories.food++;
      } else if (this.isBlock(item.name)) {
        categories.blocks++;
      } else {
        categories.resources++;
      }
    });
    
    return `${inventory.length} items (🛠️ ${categories.tools}, ⚔️ ${categories.weapons}, 🛡️ ${categories.armor}, 🧱 ${categories.blocks}, 🍖 ${categories.food}, 📦 ${categories.resources})`;
  }
  
  /**
   * Check if item is edible
   */
  isEdible(itemName) {
    const edibles = ['apple', 'bread', 'beef', 'porkchop', 'chicken', 'mutton', 'rabbit', 'cod', 'salmon', 
      'potato', 'carrot', 'beetroot', 'mushroom_stew', 'suspicious_stew', 'rabbit_stew', 'melon_slice', 
      'cookie', 'pumpkin_pie', 'cake', 'sweet_berries', 'glow_berries', 'honey_bottle'];
    
    return edibles.some(food => itemName.includes(food));
  }
  
  /**
   * Check if item is a block
   */
  isBlock(itemName) {
    const nonBlocks = ['sword', 'axe', 'pickaxe', 'shovel', 'hoe', 'helmet', 'chestplate', 
      'leggings', 'boots', 'apple', 'bread', 'beef', 'porkchop', 'chicken', 'feather', 
      'leather', 'string', 'paper', 'book', 'arrow', 'bone', 'bucket'];
    
    return !nonBlocks.some(type => itemName.includes(type));
  }
  
  /**
   * Get position status text
   */
  getPositionStatus() {
    const pos = this.bot.entity.position.floored();
    let biome = 'Unknown';
    
    try {
      biome = this.bot.blockAt(pos).biome.name;
    } catch (e) {
      // Biome information might not be available
    }
    
    return `X:${pos.x} Y:${pos.y} Z:${pos.z} in ${biome}`;
  }
  
  /**
   * Handle the come command
   */
  handleCome(username) {
    const player = this.bot.players[username];
    
    if (!player || !player.entity) {
      this.bot.chat(`I can't see you, ${username}!`);
      return;
    }
    
    const target = player.entity.position;
    
    this.bot.chat(`Coming to you, ${username}!`);
    
    this.botManager.pathfindingManager.goto(target).then(() => {
      this.bot.chat(`I've arrived, ${username}!`);
    }).catch(err => {
      this.bot.chat(`I couldn't reach you: ${err.message}`);
      logger.error(`Failed to reach ${username}:`, err);
    });
  }
  
  /**
   * Handle the follow command
   */
  handleFollow(username, args) {
    if (args.length > 0 && args[0].toLowerCase() === 'stop') {
      this.bot.chat(`I'll stop following you, ${username}.`);
      this.botManager.owner = null;
      this.botManager.changeState('idle');
      return;
    }
    
    const player = this.bot.players[username];
    
    if (!player || !player.entity) {
      this.bot.chat(`I can't see you, ${username}!`);
      return;
    }
    
    this.bot.chat(`I'll follow you, ${username}!`);
    this.botManager.owner = username;
    
    // Change to follow state
    this.botManager.changeState('follow');
  }
  
  /**
   * Handle the goto command
   */
  handleGoto(username, args) {
    if (args.length < 3) {
      this.bot.chat(`Usage: ${this.config.chat.commandPrefix}goto <x> <y> <z>`);
      return;
    }
    
    const x = parseInt(args[0], 10);
    const y = parseInt(args[1], 10);
    const z = parseInt(args[2], 10);
    
    if (isNaN(x) || isNaN(y) || isNaN(z)) {
      this.bot.chat('Invalid coordinates! Use numbers only.');
      return;
    }
    
    const targetPos = { x, y, z };
    this.bot.chat(`Navigating to ${x}, ${y}, ${z}...`);
    
    this.botManager.pathfindingManager.goto(targetPos).then(() => {
      this.bot.chat(`I've arrived at ${x}, ${y}, ${z}!`);
    }).catch(err => {
      this.bot.chat(`I couldn't reach the destination: ${err.message}`);
      logger.error(`Failed to reach destination:`, err);
    });
  }
  
  /**
   * Handle the explore command
   */
  handleExplore(username, args) {
    let radius = 100; // Default radius
    
    if (args.length > 0) {
      const parsedRadius = parseInt(args[0], 10);
      if (!isNaN(parsedRadius) && parsedRadius > 0 && parsedRadius <= 500) {
        radius = parsedRadius;
      } else {
        this.bot.chat(`Invalid radius! Using default radius of ${radius}.`);
      }
    }
    
    this.bot.chat(`Exploring with a radius of ${radius} blocks...`);
    this.botManager.changeState('explore');
    this.botManager.explorationBehavior.startExploration(radius);
  }
  
  /**
   * Handle the mine command
   */
  handleMine(username, args) {
    if (args.length === 0) {
      this.bot.chat(`Usage: ${this.config.chat.commandPrefix}mine <block> [amount]`);
      return;
    }
    
    const blockType = args[0].toLowerCase();
    let amount = 1;
    
    if (args.length > 1) {
      const parsedAmount = parseInt(args[1], 10);
      if (!isNaN(parsedAmount) && parsedAmount > 0) {
        amount = parsedAmount;
      }
    }
    
    this.bot.chat(`Searching for ${blockType} to mine (${amount})...`);
    
    // Change to mining state and set target block
    this.botManager.changeState('mining');
    this.botManager.miningBehavior.mineBlock(blockType, amount);
  }
  
  /**
   * Handle the collect command
   */
  handleCollect(username, args) {
    if (args.length === 0) {
      // Collect any nearby items
      this.bot.chat('Collecting nearby items...');
      this.botManager.changeState('gather');
      return;
    }
    
    const itemName = args[0].toLowerCase();
    this.bot.chat(`Looking for ${itemName} to collect...`);
    
    // Change to gather state and set target item
    this.botManager.changeState('gather');
    this.botManager.survivalBehavior.collectItems(itemName);
  }
  
  /**
   * Handle the build command
   */
  handleBuild(username, args) {
    if (args.length < 1) {
      this.bot.chat(`Usage: ${this.config.chat.commandPrefix}build <structure> [material]`);
      return;
    }
    
    const structure = args[0].toLowerCase();
    let material = args.length > 1 ? args[1].toLowerCase() : null;
    
    // Validate the structure type
    const validStructures = ['wall', 'tower', 'house', 'bridge', 'staircase'];
    if (!validStructures.includes(structure)) {
      this.bot.chat(`Unknown structure! Valid options: ${validStructures.join(', ')}`);
      return;
    }
    
    this.bot.chat(`Planning to build a ${structure}${material ? ' using ' + material : ''}...`);
    
    // Change to build state
    this.botManager.changeState('build');
    this.botManager.buildingBehavior.build(structure, material);
  }
  
  /**
   * Handle the craft command
   */
  handleCraft(username, args) {
    if (args.length < 1) {
      this.bot.chat(`Usage: ${this.config.chat.commandPrefix}craft <item> [amount]`);
      return;
    }
    
    const itemName = args[0].toLowerCase();
    let amount = 1;
    
    if (args.length > 1) {
      const parsedAmount = parseInt(args[1], 10);
      if (!isNaN(parsedAmount) && parsedAmount > 0) {
        amount = parsedAmount;
      }
    }
    
    this.bot.chat(`Attempting to craft ${amount}x ${itemName}...`);
    
    // Change to craft state
    this.botManager.changeState('craft');
    this.botManager.craftingBehavior.craftItem(itemName, amount);
  }
  
  /**
   * Handle the attack command
   */
  handleAttack(username, args) {
    if (args.length === 0) {
      this.bot.chat(`Usage: ${this.config.chat.commandPrefix}attack <entity>`);
      return;
    }
    
    const targetName = args[0].toLowerCase();
    const entities = this.bot.entities;
    let targetEntity = null;
    
    // Find the closest entity matching the name
    let closestDistance = Infinity;
    
    for (const entity of Object.values(entities)) {
      // Skip entities without a name or type
      if (!entity.name && !entity.username && !entity.type) continue;
      
      const entityName = (entity.name || entity.username || entity.type).toLowerCase();
      if (entityName.includes(targetName)) {
        const distance = entity.position.distanceTo(this.bot.entity.position);
        if (distance < closestDistance) {
          closestDistance = distance;
          targetEntity = entity;
        }
      }
    }
    
    if (!targetEntity) {
      this.bot.chat(`I can't find any ${targetName} nearby.`);
      return;
    }
    
    this.bot.chat(`Attacking ${targetEntity.name || targetEntity.username || targetEntity.type}!`);
    
    // Change to combat state and set target
    this.botManager.changeState('combat');
    this.botManager.combatBehavior.attackEntity(targetEntity);
  }
  
  /**
   * Handle the defend command
   */
  handleDefend(username, args) {
    const defendTarget = args.length > 0 ? args[0].toLowerCase() : 'owner';
    
    if (defendTarget === 'self') {
      this.bot.chat('I will defend myself!');
      this.botManager.combatBehavior.defendSelf();
    } else if (defendTarget === 'owner') {
      // Set the commander as owner if not already set
      if (!this.botManager.owner) {
        this.botManager.owner = username;
      }
      
      this.bot.chat(`I will defend ${this.botManager.owner}!`);
      this.botManager.combatBehavior.defendOwner();
    } else {
      this.bot.chat(`Invalid target! Use 'self' or 'owner'.`);
    }
  }
  
  /**
   * Handle the equip command
   */
  handleEquip(username, args) {
    if (args.length === 0) {
      this.bot.chat(`Usage: ${this.config.chat.commandPrefix}equip <item>`);
      return;
    }
    
    const itemName = args[0].toLowerCase();
    
    // Find item in inventory
    const items = this.bot.inventory.items();
    const item = items.find(i => i.name.toLowerCase().includes(itemName));
    
    if (!item) {
      this.bot.chat(`I don't have any ${itemName} in my inventory.`);
      return;
    }
    
    // Equip item (will go to hand or armor slot as appropriate)
    this.bot.chat(`Equipping ${item.name}...`);
    
    if (item.name.includes('helmet') || item.name.includes('cap')) {
      this.bot.equip(item, 'head')
        .then(() => this.bot.chat(`Equipped ${item.name} on my head!`))
        .catch(err => this.bot.chat(`Failed to equip: ${err.message}`));
    } else if (item.name.includes('chestplate') || item.name.includes('tunic')) {
      this.bot.equip(item, 'torso')
        .then(() => this.bot.chat(`Equipped ${item.name} on my torso!`))
        .catch(err => this.bot.chat(`Failed to equip: ${err.message}`));
    } else if (item.name.includes('leggings') || item.name.includes('pants')) {
      this.bot.equip(item, 'legs')
        .then(() => this.bot.chat(`Equipped ${item.name} on my legs!`))
        .catch(err => this.bot.chat(`Failed to equip: ${err.message}`));
    } else if (item.name.includes('boots')) {
      this.bot.equip(item, 'feet')
        .then(() => this.bot.chat(`Equipped ${item.name} on my feet!`))
        .catch(err => this.bot.chat(`Failed to equip: ${err.message}`));
    } else {
      this.bot.equip(item, 'hand')
        .then(() => this.bot.chat(`Equipped ${item.name} in my hand!`))
        .catch(err => this.bot.chat(`Failed to equip: ${err.message}`));
    }
  }
  
  /**
   * Handle the drop command
   */
  handleDrop(username, args) {
    if (args.length === 0) {
      this.bot.chat(`Usage: ${this.config.chat.commandPrefix}drop <item> [amount]`);
      return;
    }
    
    const itemName = args[0].toLowerCase();
    let amount = null;
    
    if (args.length > 1) {
      const parsedAmount = parseInt(args[1], 10);
      if (!isNaN(parsedAmount) && parsedAmount > 0) {
        amount = parsedAmount;
      }
    }
    
    // Find item in inventory
    const items = this.bot.inventory.items();
    const item = items.find(i => i.name.toLowerCase().includes(itemName));
    
    if (!item) {
      this.bot.chat(`I don't have any ${itemName} in my inventory.`);
      return;
    }
    
    // Drop item
    const count = amount ? Math.min(amount, item.count) : item.count;
    this.bot.chat(`Dropping ${count}x ${item.name}...`);
    
    this.bot.tossStack(item, count)
      .then(() => this.bot.chat(`Dropped ${count}x ${item.name}!`))
      .catch(err => this.bot.chat(`Failed to drop items: ${err.message}`));
  }
  
  /**
   * Handle the place command
   */
  handlePlace(username, args) {
    if (args.length < 4) {
      this.bot.chat(`Usage: ${this.config.chat.commandPrefix}place <block> <x> <y> <z>`);
      return;
    }
    
    const blockName = args[0].toLowerCase();
    const x = parseInt(args[1], 10);
    const y = parseInt(args[2], 10);
    const z = parseInt(args[3], 10);
    
    if (isNaN(x) || isNaN(y) || isNaN(z)) {
      this.bot.chat('Invalid coordinates! Use numbers only.');
      return;
    }
    
    // Find the block in inventory
    const items = this.bot.inventory.items();
    const item = items.find(i => i.name.toLowerCase().includes(blockName));
    
    if (!item) {
      this.bot.chat(`I don't have any ${blockName} in my inventory.`);
      return;
    }
    
    // Try to place the block
    const position = { x, y, z };
    this.bot.chat(`Trying to place ${item.name} at ${x}, ${y}, ${z}...`);
    
    this.botManager.buildingBehavior.placeBlock(position, item)
      .then(() => this.bot.chat(`Successfully placed ${item.name}!`))
      .catch(err => this.bot.chat(`Failed to place block: ${err.message}`));
  }
  
  /**
   * Handle the eat command
   */
  handleEat(username, args) {
    let foodName = null;
    
    if (args.length > 0) {
      foodName = args[0].toLowerCase();
    }
    
    this.bot.chat(`Trying to eat${foodName ? ' ' + foodName : ''}...`);
    this.botManager.survivalBehavior.eat(foodName);
  }
  
  /**
   * Handle the inventory command
   */
  handleInventory(username) {
    const items = this.bot.inventory.items();
    
    if (items.length === 0) {
      this.bot.chat('My inventory is empty!');
      return;
    }
    
    this.bot.chat('Inventory contents:');
    
    // Group similar items
    const itemCounts = {};
    
    items.forEach(item => {
      if (itemCounts[item.name]) {
        itemCounts[item.name] += item.count;
      } else {
        itemCounts[item.name] = item.count;
      }
    });
    
    // Convert to array and sort by count
    const sortedItems = Object.entries(itemCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name}: ${count}`);
    
    // Send in chunks to avoid message length limits
    const chunkSize = 5;
    for (let i = 0; i < sortedItems.length; i += chunkSize) {
      const chunk = sortedItems.slice(i, i + chunkSize);
      this.bot.chat(chunk.join(', '));
    }
  }
  
  /**
   * Handle the give command
   */
  handleGive(username, args) {
    if (args.length === 0) {
      this.bot.chat(`Usage: ${this.config.chat.commandPrefix}give <item> [amount]`);
      return;
    }
    
    const itemName = args[0].toLowerCase();
    let amount = 1;
    
    if (args.length > 1) {
      const parsedAmount = parseInt(args[1], 10);
      if (!isNaN(parsedAmount) && parsedAmount > 0) {
        amount = parsedAmount;
      }
    }
    
    // Find the player
    const player = this.bot.players[username];
    
    if (!player || !player.entity) {
      this.bot.chat(`I can't see you, ${username}!`);
      return;
    }
    
    // Find item in inventory
    const items = this.bot.inventory.items();
    const item = items.find(i => i.name.toLowerCase().includes(itemName));
    
    if (!item) {
      this.bot.chat(`I don't have any ${itemName} in my inventory.`);
      return;
    }
    
    // Calculate amount to give
    const count = Math.min(amount, item.count);
    this.bot.chat(`Trying to give you ${count}x ${item.name}...`);
    
    // First, move to the player
    this.botManager.pathfindingManager.goto(player.entity.position)
      .then(() => {
        // Then toss the item
        return this.bot.tossStack(item, count);
      })
      .then(() => {
        this.bot.chat(`Gave you ${count}x ${item.name}!`);
      })
      .catch(err => {
        this.bot.chat(`Failed to give item: ${err.message}`);
        logger.error('Failed to give item:', err);
      });
  }
  
  /**
   * Handle the state command
   */
  handleState(username, args) {
    if (args.length === 0) {
      // Just report current state
      this.bot.chat(`Current state: ${this.botManager.getState()}`);
      return;
    }
    
    // Try to change state
    const newState = args[0].toLowerCase();
    const validStates = ['idle', 'mining', 'combat', 'gather', 'craft', 'follow', 'build', 'explore'];
    
    if (!validStates.includes(newState)) {
      this.bot.chat(`Invalid state! Valid states: ${validStates.join(', ')}`);
      return;
    }
    
    // Try to change state
    if (this.botManager.changeState(newState)) {
      this.bot.chat(`State changed to: ${newState}`);
    } else {
      this.bot.chat(`Failed to change state to: ${newState}`);
    }
  }
  
  /**
   * Handle the stop command
   */
  handleStop(username) {
    // Cancel path finding
    if (this.bot.pathfinder) {
      this.bot.pathfinder.setGoal(null);
    }
    
    // Cancel current activities
    if (this.botManager.getState() !== 'idle') {
      this.botManager.changeState('idle');
    }
    
    this.bot.clearControlStates();
    this.bot.stopDigging();
    
    this.bot.chat('Stopped all activities.');
  }
  
  /**
   * Handle the exec command
   */
  handleExec(username, args) {
    if (args.length === 0) {
      this.bot.chat(`Usage: ${this.config.chat.commandPrefix}exec <commands separated by ;>`);
      return;
    }
    
    // Join all args and split by semicolon
    const commandString = args.join(' ');
    const commands = commandString.split(';').map(cmd => cmd.trim()).filter(cmd => cmd.length > 0);
    
    if (commands.length === 0) {
      this.bot.chat('No valid commands to execute!');
      return;
    }
    
    this.bot.chat(`Executing ${commands.length} commands...`);
    
    // Execute each command sequentially
    const executeCommands = async () => {
      for (const cmd of commands) {
        // Split into command and args
        const parts = cmd.split(' ');
        const command = parts[0];
        const cmdArgs = parts.slice(1);
        
        this.bot.chat(`Executing: ${cmd}`);
        
        // Execute the command
        if (this.commands[command]) {
          try {
            await this.commands[command].execute(username, cmdArgs);
            // Add a small delay between commands
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (error) {
            this.bot.chat(`Error executing command ${command}: ${error.message}`);
            logger.error(`Error in exec command ${command}:`, error);
            // Continue with next command despite the error
          }
        } else {
          this.bot.chat(`Unknown command in exec: ${command}`);
        }
      }
      
      this.bot.chat('Finished executing all commands!');
    };
    
    executeCommands().catch(err => {
      this.bot.chat(`Error in command execution: ${err.message}`);
      logger.error('Error in exec command:', err);
    });
  }
  
  /**
   * Handle the say command
   */
  handleSay(username, args) {
    if (args.length === 0) {
      this.bot.chat(`Usage: ${this.config.chat.commandPrefix}say <message>`);
      return;
    }
    
    const message = args.join(' ');
    this.bot.chat(message);
  }

  /**
   * Handle the defense command to activate defensive operations
   */
  handleDefenseCommand(username, args) {
    let radius = 16; // Default defensive radius
    
    if (args.length > 0) {
      const parsedRadius = parseInt(args[0], 10);
      if (!isNaN(parsedRadius) && parsedRadius > 0 && parsedRadius <= 50) {
        radius = parsedRadius;
      } else {
        this.bot.chat(`Invalid radius! Using default radius of ${radius} blocks.`);
      }
    }
    
    this.bot.chat(`Initiating defensive operations with perimeter radius of ${radius} blocks...`);
    
    // Find the defense state
    if (this.botManager.changeState('defense')) {
      // Set the defense radius if the state has a setter for it
      if (this.botManager.stateMachine.currentState.defenseRadius !== undefined) {
        this.botManager.stateMachine.currentState.defenseRadius = radius;
      }
      
      this.bot.chat('Defense mode activated! Building fortifications and patrolling the area.');
    } else {
      this.bot.chat('Failed to enter defense mode. Try again later.');
    }
  }
}

module.exports = CommandSystem;
