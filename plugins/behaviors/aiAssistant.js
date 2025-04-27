/**
 * AI Assistant Plugin
 * 
 * This plugin enhances the bot's capabilities by providing intelligent
 * assistance with a focus on using minecraft-data to understand the
 * game environment better.
 */

const BasePlugin = require('../basePlugin');
const mcData = require('minecraft-data');
const Vec3 = require('vec3');

class AIAssistant extends BasePlugin {
  constructor(bot, config, pluginManager) {
    super('aiAssistant', bot, config, pluginManager);
    
    this.mcData = null;
    this.initialized = false;
    this.version = null;
    this.blocksByName = {};
    this.itemsByName = {};
    this.entityTypes = {};
    this.craftingRecipes = {};
    this.biomes = {};
    
    // Track internal state
    this.lastTask = null;
    this.currentGoal = null;
    this.taskQueue = [];
    this.memories = {};
    
    // Configuration
    this.config = {
      ...config,
      enableAI: true,
      learningRate: 0.1,
      taskTimeout: 60000, // 60 seconds
      maxMemoryItems: 100,
      debugMode: false,
      ...config.aiAssistant
    };
  }
  
  /**
   * Initialize the plugin
   */
  async initialize() {
    this.info('Initializing AI Assistant plugin');
    
    try {
      // Try to get the Minecraft version from various possible locations
      // 1. Check if bot has a version property
      this.version = this.bot.version;
      
      // 2. Check if bot has a server with version
      if (!this.version && this.bot.server && this.bot.server.version) {
        this.version = this.bot.server.version;
      }
      
      // 3. Check if bot has a game property with version
      if (!this.version && this.bot.game && this.bot.game.version) {
        this.version = this.bot.game.version;
      }
      
      // 4. Try to get from connection
      const mcBot = this.bot.bot || this.bot.connection || this.bot;
      if (!this.version && mcBot && mcBot.version) {
        this.version = mcBot.version;
      }
      
      // If still no version, use a fallback
      if (!this.version) {
        this.warn('Could not determine Minecraft version, using fallback');
        this.version = '1.16.5';
      }
      
      // Try to get minecraft-data for this version
      try {
        this.mcData = mcData(this.version);
      } catch (versionError) {
        this.warn(`Error getting minecraft-data for version ${this.version}: ${versionError.message}`);
      }
      
      // If we still don't have mcData, try common versions
      if (!this.mcData) {
        this.warn(`No minecraft-data available for version ${this.version}, trying alternatives`);
        
        // Try a sequence of common versions
        const commonVersions = ['1.16.5', '1.17.1', '1.18.2', '1.19.4', '1.20.1'];
        
        for (const commonVersion of commonVersions) {
          try {
            this.mcData = mcData(commonVersion);
            if (this.mcData) {
              this.info(`Using minecraft-data for version ${commonVersion} as fallback`);
              break;
            }
          } catch (e) {
            // Continue to next version
          }
        }
      }
      
      // If still no minecraft-data, create minimal structure
      if (!this.mcData) {
        this.warn('Could not load minecraft-data for any version, using minimal structure');
        this.mcData = {
          blocks: {},
          items: {},
          blocksArray: [],
          itemsArray: [],
          entitiesArray: [],
          recipes: {},
          biomes: {}
        };
      }
      
      // Index blocks, items, etc. by name for quick lookup
      this.indexGameData();
      
      // Register event handlers
      this.registerEventHandlers();
      
      // Register commands
      this.registerCommands();
      
      this.initialized = true;
      
      // Log some stats about available data
      const blockCount = Object.keys(this.blocksByName).length;
      const itemCount = Object.keys(this.itemsByName).length;
      const recipeCount = Object.keys(this.craftingRecipes).length;
      const biomeCount = Object.keys(this.biomes).length;
      
      this.info(`AI Assistant plugin initialized with ${blockCount} blocks, ${itemCount} items`);
      this.info(`Loaded ${recipeCount} crafting recipes and ${biomeCount} biomes`);
      
      return true;
    } catch (error) {
      this.error('Error initializing AI Assistant plugin:', error);
      return false;
    }
  }
  
  /**
   * Index game data for quick lookup
   */
  indexGameData() {
    if (!this.mcData) {
      this.warn('Cannot index game data - mcData not available');
      return;
    }
    
    // Index blocks
    if (this.mcData.blocksArray) {
      this.mcData.blocksArray.forEach(block => {
        this.blocksByName[block.name] = block;
      });
    }
    
    // Index items
    if (this.mcData.itemsArray) {
      this.mcData.itemsArray.forEach(item => {
        this.itemsByName[item.name] = item;
      });
    }
    
    // Index entity types
    if (this.mcData.entitiesArray) {
      this.mcData.entitiesArray.forEach(entity => {
        this.entityTypes[entity.name] = entity;
      });
    }
    
    // Index recipes
    if (this.mcData.recipes) {
      this.craftingRecipes = this.mcData.recipes;
    }
    
    // Index biomes
    if (this.mcData.biomes) {
      this.biomes = this.mcData.biomes;
    }
  }
  
  /**
   * Register event handlers
   */
  registerEventHandlers() {
    try {
      // Get the bot's raw connection if available
      const mcBot = this.bot.bot || this.bot.connection || this.bot;
      
      // Try different approaches to register events
      if (typeof mcBot.on === 'function') {
        this.info('Using direct bot.on for event registration');
        mcBot.on('physicsTick', this.onTick.bind(this));
        mcBot.on('chat', this.onChat.bind(this));
        mcBot.on('blockUpdate', this.onBlockUpdate.bind(this));
        mcBot.on('chunkColumnLoad', this.onChunkLoad.bind(this));
        mcBot.on('entitySpawn', this.onEntitySpawn.bind(this));
        mcBot.on('entityGone', this.onEntityGone.bind(this));
      } else if (this.bot.getBotManager && typeof this.bot.getBotManager().on === 'function') {
        this.info('Using botManager.on for event registration');
        const botManager = this.bot.getBotManager();
        botManager.on('physicsTick', this.onTick.bind(this));
        botManager.on('chat', this.onChat.bind(this));
        botManager.on('blockUpdate', this.onBlockUpdate.bind(this));
        botManager.on('chunkColumnLoad', this.onChunkLoad.bind(this));
        botManager.on('entitySpawn', this.onEntitySpawn.bind(this));
        botManager.on('entityGone', this.onEntityGone.bind(this));
      } else {
        // Fallback to using the plugin manager's event system
        this.info('Using plugin manager event system');
        if (this.pluginManager && typeof this.pluginManager.on === 'function') {
          this.pluginManager.on('physicsTick', this.onTick.bind(this));
          this.pluginManager.on('chat', this.onChat.bind(this));
          this.pluginManager.on('blockUpdate', this.onBlockUpdate.bind(this));
          this.pluginManager.on('chunkColumnLoad', this.onChunkLoad.bind(this));
          this.pluginManager.on('entitySpawn', this.onEntitySpawn.bind(this));
          this.pluginManager.on('entityGone', this.onEntityGone.bind(this));
        } else {
          this.warn('No suitable event registration method found');
        }
      }
    } catch (error) {
      this.error('Failed to register event handlers:', error);
    }
  }
  
  /**
   * Register plugin commands
   */
  registerCommands() {
    try {
      // Find the command handler using different approaches
      let commandHandler = null;
      
      // Method 1: Try to get from plugins list if available
      if (this.pluginManager && typeof this.pluginManager.getPluginByName === 'function') {
        commandHandler = this.pluginManager.getPluginByName('commandHandler');
      }
      
      // Method 2: Try to find in plugins array if available
      if (!commandHandler && this.pluginManager && this.pluginManager.plugins) {
        commandHandler = this.pluginManager.plugins.find(p => 
          p.name === 'commandHandler' || 
          p.name === 'CommandHandler'
        );
      }
      
      // Method 3: Try to get from bot if it has command registration
      if (!commandHandler && this.bot && typeof this.bot.registerCommand === 'function') {
        // Use the bot's own command system
        this.info('Using bot.registerCommand for command registration');
        
        this.bot.registerCommand('analyze', this.handleAnalyzeCommand.bind(this), 
          'Analyze the environment or a specific target', 
          'analyze [target]');
        
        this.bot.registerCommand('find', this.handleFindCommand.bind(this),
          'Find a specific resource or entity', 
          'find <target>');
        
        this.bot.registerCommand('craft', this.handleCraftCommand.bind(this),
          'Craft an item using available resources',
          'craft <item> [amount]');
          
        this.bot.registerCommand('gather', this.handleGatherCommand.bind(this),
          'Gather a specific resource',
          'gather <resource> [amount]');
          
        return;
      }
      
      // Method 4: If we found a command handler, use it
      if (commandHandler && typeof commandHandler.registerCommand === 'function') {
        this.info('Using commandHandler.registerCommand for command registration');
        
        commandHandler.registerCommand('analyze', this.handleAnalyzeCommand.bind(this), 
          'Analyze the environment or a specific target', 
          'analyze [target]');
        
        commandHandler.registerCommand('find', this.handleFindCommand.bind(this),
          'Find a specific resource or entity', 
          'find <target>');
        
        commandHandler.registerCommand('craft', this.handleCraftCommand.bind(this),
          'Craft an item using available resources',
          'craft <item> [amount]');
          
        commandHandler.registerCommand('gather', this.handleGatherCommand.bind(this),
          'Gather a specific resource',
          'gather <resource> [amount]');
      } else {
        // If we couldn't find a command handler, register directly through bot chat
        this.warn('No command handler found, using chat-based commands');
        
        // Listen for chat messages and handle them manually
        // This approach relies on the onChat method to be properly connected
        this.chatCommands = {
          'analyze': this.handleAnalyzeCommand.bind(this),
          'find': this.handleFindCommand.bind(this),
          'craft': this.handleCraftCommand.bind(this),
          'gather': this.handleGatherCommand.bind(this)
        };
      }
    } catch (error) {
      this.error('Error registering commands:', error);
    }
  }
  
  /**
   * Handle the analyze command
   */
  handleAnalyzeCommand(username, args) {
    if (!this.initialized) {
      this.bot.chat('AI assistant is not fully initialized.');
      return;
    }
    
    const target = args[0];
    
    if (!target) {
      // Analyze surroundings
      this.analyzeSurroundings().then(result => {
        this.bot.chat(`Analysis complete: ${result}`);
      });
    } else if (target === 'player') {
      // Analyze nearest player
      const player = this.findNearestPlayer();
      if (player) {
        this.analyzeEntity(player).then(result => {
          this.bot.chat(`Player analysis: ${result}`);
        });
      } else {
        this.bot.chat('No players found nearby.');
      }
    } else if (target === 'inventory') {
      // Analyze inventory
      const inventoryAnalysis = this.analyzeInventory();
      this.bot.chat(`Inventory analysis: ${inventoryAnalysis}`);
    } else if (target === 'biome') {
      // Analyze current biome
      const biomeAnalysis = this.analyzeBiome();
      this.bot.chat(`Biome analysis: ${biomeAnalysis}`);
    } else {
      // Try to find and analyze a specific target
      this.bot.chat(`Searching for ${target}...`);
      
      // See if it's a block
      const blockType = this.findBlockTypeByName(target);
      if (blockType) {
        this.findBlock(blockType).then(block => {
          if (block) {
            this.analyzeBlock(block).then(result => {
              this.bot.chat(`Block analysis: ${result}`);
            });
          } else {
            this.bot.chat(`No ${target} blocks found nearby.`);
          }
        });
        return;
      }
      
      // See if it's an entity
      const entityType = this.findEntityTypeByName(target);
      if (entityType) {
        const entity = this.findNearestEntityByType(entityType);
        if (entity) {
          this.analyzeEntity(entity).then(result => {
            this.bot.chat(`Entity analysis: ${result}`);
          });
        } else {
          this.bot.chat(`No ${target} entities found nearby.`);
        }
        return;
      }
      
      // See if it's an item
      const itemType = this.findItemByName(target);
      if (itemType) {
        const item = this.bot.inventory.items().find(i => i.name === target);
        if (item) {
          this.analyzeItem(item).then(result => {
            this.bot.chat(`Item analysis: ${result}`);
          });
        } else {
          this.bot.chat(`No ${target} items found in inventory.`);
        }
        return;
      }
      
      this.bot.chat(`I don't know how to analyze ${target}.`);
    }
  }
  
  /**
   * Handle the find command
   */
  handleFindCommand(username, args) {
    if (!this.initialized) {
      this.bot.chat('AI assistant is not fully initialized.');
      return;
    }
    
    if (!args.length) {
      this.bot.chat('What should I find? Try "find diamond" or "find zombie"');
      return;
    }
    
    const target = args[0];
    
    // Check if it's a block
    const blockType = this.findBlockTypeByName(target);
    if (blockType) {
      this.bot.chat(`Searching for ${target} blocks...`);
      this.findBlock(blockType).then(block => {
        if (block) {
          const distance = this.bot.entity.position.distanceTo(block.position);
          this.bot.chat(`Found ${target} at (${Math.floor(block.position.x)}, ${Math.floor(block.position.y)}, ${Math.floor(block.position.z)}), ${Math.floor(distance)} blocks away.`);
          
          // Look at the block
          this.bot.lookAt(block.position);
        } else {
          this.bot.chat(`No ${target} blocks found nearby.`);
        }
      });
      return;
    }
    
    // Check if it's an entity
    const entityType = this.findEntityTypeByName(target);
    if (entityType) {
      this.bot.chat(`Searching for ${target} entities...`);
      const entity = this.findNearestEntityByType(entityType);
      if (entity) {
        const distance = this.bot.entity.position.distanceTo(entity.position);
        this.bot.chat(`Found ${target} at (${Math.floor(entity.position.x)}, ${Math.floor(entity.position.y)}, ${Math.floor(entity.position.z)}), ${Math.floor(distance)} blocks away.`);
        
        // Look at the entity
        this.bot.lookAt(entity.position);
      } else {
        this.bot.chat(`No ${target} entities found nearby.`);
      }
      return;
    }
    
    // Check if it's an item
    const itemType = this.findItemByName(target);
    if (itemType) {
      this.bot.chat(`Checking inventory for ${target}...`);
      const item = this.bot.inventory.items().find(i => i.name === target);
      if (item) {
        this.bot.chat(`Found ${item.count} ${target} in inventory.`);
      } else {
        this.bot.chat(`No ${target} items found in inventory. I'll need to craft or gather some.`);
        
        // Check if we can craft it
        const recipe = this.findRecipe(target);
        if (recipe) {
          this.bot.chat(`I know how to craft ${target}. Use "craft ${target}" to make some.`);
        } else {
          this.bot.chat(`I don't know how to get ${target}.`);
        }
      }
      return;
    }
    
    this.bot.chat(`I don't know what "${target}" is.`);
  }
  
  /**
   * Handle the craft command
   */
  handleCraftCommand(username, args) {
    if (!this.initialized) {
      this.bot.chat('AI assistant is not fully initialized.');
      return;
    }
    
    if (!args.length) {
      this.bot.chat('What should I craft? Try "craft stick" or "craft torch"');
      return;
    }
    
    const item = args[0];
    const amount = args[1] ? parseInt(args[1], 10) : 1;
    
    if (isNaN(amount) || amount < 1) {
      this.bot.chat('Invalid amount. Please specify a positive number.');
      return;
    }
    
    this.craftItem(item, amount).then(success => {
      if (success) {
        this.bot.chat(`Successfully crafted ${amount} ${item}.`);
      } else {
        this.bot.chat(`Failed to craft ${item}. Missing materials or invalid recipe.`);
      }
    }).catch(error => {
      this.bot.chat(`Error crafting ${item}: ${error.message}`);
    });
  }
  
  /**
   * Handle the gather command
   */
  handleGatherCommand(username, args) {
    if (!this.initialized) {
      this.bot.chat('AI assistant is not fully initialized.');
      return;
    }
    
    if (!args.length) {
      this.bot.chat('What should I gather? Try "gather wood" or "gather stone"');
      return;
    }
    
    const resource = args[0];
    const amount = args[1] ? parseInt(args[1], 10) : 16; // Default to 16
    
    if (isNaN(amount) || amount < 1) {
      this.bot.chat('Invalid amount. Please specify a positive number.');
      return;
    }
    
    this.gatherResource(resource, amount).then(success => {
      if (success) {
        this.bot.chat(`Successfully gathered ${amount} ${resource}.`);
      } else {
        this.bot.chat(`Failed to gather ${resource}. Couldn't find enough or path was blocked.`);
      }
    }).catch(error => {
      this.bot.chat(`Error gathering ${resource}: ${error.message}`);
    });
  }
  
  /**
   * Analyze surroundings
   */
  async analyzeSurroundings() {
    const analysis = {
      blocksNearby: {},
      entitiesNearby: {},
      biome: this.getCurrentBiome(),
      timeOfDay: this.getTimeOfDay(),
      weather: this.getWeather(),
      dangerLevel: this.assessDanger(),
      resourceRichness: this.assessResources()
    };
    
    // Count nearby blocks by type
    const blocks = this.getNearbyBlocks(5); // 5 block radius
    blocks.forEach(block => {
      if (!analysis.blocksNearby[block.name]) {
        analysis.blocksNearby[block.name] = 0;
      }
      analysis.blocksNearby[block.name]++;
    });
    
    // Count nearby entities by type
    const entities = this.getNearbyEntities(16); // 16 block radius
    entities.forEach(entity => {
      const type = entity.name || entity.type || 'unknown';
      if (!analysis.entitiesNearby[type]) {
        analysis.entitiesNearby[type] = 0;
      }
      analysis.entitiesNearby[type]++;
    });
    
    // Generate a summary
    const blockTypes = Object.keys(analysis.blocksNearby).length;
    const entityTypes = Object.keys(analysis.entitiesNearby).length;
    
    let summary = `I'm in a ${analysis.biome} biome during ${analysis.timeOfDay}`;
    
    if (analysis.weather !== 'clear') {
      summary += ` with ${analysis.weather} weather`;
    }
    
    summary += `. There are ${blockTypes} types of blocks and ${entityTypes} types of entities nearby.`;
    
    if (analysis.dangerLevel > 0.6) {
      summary += ` Danger level is high!`;
    } else if (analysis.dangerLevel > 0.3) {
      summary += ` Moderate danger detected.`;
    } else {
      summary += ` Area seems safe.`;
    }
    
    if (analysis.resourceRichness > 0.6) {
      summary += ` This area is rich in resources.`;
    } else if (analysis.resourceRichness > 0.3) {
      summary += ` Some useful resources nearby.`;
    } else {
      summary += ` Few resources in the immediate area.`;
    }
    
    return summary;
  }
  
  /**
   * Analyze a specific block
   */
  async analyzeBlock(block) {
    if (!block) return 'No block to analyze';
    
    const blockData = this.mcData.blocks[block.type];
    if (!blockData) return `Unknown block type: ${block.type}`;
    
    let analysis = `This is ${blockData.displayName || blockData.name}. `;
    
    // Add hardness/tool info
    if (typeof blockData.hardness === 'number') {
      analysis += `Hardness: ${blockData.hardness}. `;
      
      // Suggest tool
      const bestTool = this.getBestToolForBlock(blockData);
      if (bestTool) {
        analysis += `Best mined with ${bestTool}. `;
      }
    }
    
    // Add drops info
    if (blockData.drops && blockData.drops.length) {
      const dropNames = blockData.drops.map(d => {
        const item = this.mcData.items[d];
        return item ? (item.displayName || item.name) : `item #${d}`;
      });
      
      analysis += `Drops: ${dropNames.join(', ')}. `;
    }
    
    // Add usage info if applicable
    const usageInfo = this.getBlockUsageInfo(blockData);
    if (usageInfo) {
      analysis += usageInfo;
    }
    
    return analysis;
  }
  
  /**
   * Analyze a specific entity
   */
  async analyzeEntity(entity) {
    if (!entity) return 'No entity to analyze';
    
    let entityType = entity.type;
    let entityName = entity.name || entity.username || entityType;
    
    let analysis = `This is a ${entityName}. `;
    
    if (entity.type === 'player') {
      // Player analysis
      analysis += `Player health: ${entity.health || 'unknown'}. `;
      
      // Equipment analysis
      if (entity.equipment) {
        const armorNames = entity.equipment.map(item => {
          return item ? (item.displayName || item.name) : 'none';
        }).filter(n => n !== 'none');
        
        if (armorNames.length) {
          analysis += `Wearing: ${armorNames.join(', ')}. `;
        }
      }
    } else {
      // Mob analysis
      const entityData = this.mcData.entities[entity.entityType];
      
      if (entityData) {
        analysis += `${entityData.displayName || entityData.name}. `;
        
        if (entityData.category === 'hostile') {
          analysis += 'This is a hostile mob. ';
        } else if (entityData.category === 'passive') {
          analysis += 'This is a passive mob. ';
        }
      }
      
      // Health if available
      if (typeof entity.health === 'number') {
        analysis += `Health: ${entity.health}. `;
      }
    }
    
    // Distance
    const distance = this.bot.entity.position.distanceTo(entity.position);
    analysis += `Distance: ${Math.floor(distance)} blocks.`;
    
    return analysis;
  }
  
  /**
   * Analyze inventory contents
   */
  analyzeInventory() {
    const items = this.bot.inventory.items();
    
    if (!items.length) {
      return 'Inventory is empty.';
    }
    
    // Group items by name
    const itemCounts = {};
    items.forEach(item => {
      const name = item.name;
      if (!itemCounts[name]) {
        itemCounts[name] = 0;
      }
      itemCounts[name] += item.count;
    });
    
    // Convert to array for sorting
    const itemList = Object.entries(itemCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
    
    // Categorize items
    const tools = itemList.filter(item => this.isTool(item.name));
    const blocks = itemList.filter(item => this.isBlock(item.name) && !tools.find(t => t.name === item.name));
    const resources = itemList.filter(item => !tools.find(t => t.name === item.name) && !blocks.find(b => b.name === item.name));
    
    // Generate summary
    let summary = `Inventory contains ${items.length} items. `;
    
    if (tools.length) {
      summary += `Tools: ${tools.map(t => `${t.name} (${t.count})`).join(', ')}. `;
    }
    
    if (blocks.length) {
      const totalBlocks = blocks.reduce((sum, b) => sum + b.count, 0);
      summary += `${totalBlocks} blocks of ${blocks.length} types. `;
    }
    
    if (resources.length) {
      const totalResources = resources.reduce((sum, r) => sum + r.count, 0);
      summary += `${totalResources} resources of ${resources.length} types.`;
    }
    
    return summary;
  }
  
  /**
   * Analyze current biome
   */
  analyzeBiome() {
    const biome = this.getCurrentBiome();
    const biomeData = this.getBiomeData(biome);
    
    if (!biomeData) {
      return `Current biome: ${biome}. No additional data available.`;
    }
    
    let analysis = `Current biome: ${biomeData.name}. `;
    
    // Temperature and rainfall
    if (typeof biomeData.temperature === 'number') {
      const tempDesc = biomeData.temperature > 0.8 ? 'hot' : 
                       biomeData.temperature > 0.4 ? 'moderate' : 'cold';
      analysis += `Temperature: ${tempDesc}. `;
    }
    
    if (typeof biomeData.rainfall === 'number') {
      const rainDesc = biomeData.rainfall > 0.8 ? 'very wet' : 
                       biomeData.rainfall > 0.4 ? 'moderate rainfall' : 'dry';
      analysis += `Rainfall: ${rainDesc}. `;
    }
    
    // Common resources in this biome
    const biomeResources = this.getBiomeResources(biome);
    if (biomeResources.length) {
      analysis += `Common resources: ${biomeResources.join(', ')}.`;
    }
    
    return analysis;
  }
  
  /**
   * Analyze a specific item
   */
  async analyzeItem(item) {
    if (!item) return 'No item to analyze';
    
    const itemData = this.mcData.items[item.type];
    if (!itemData) return `Unknown item type: ${item.type}`;
    
    let analysis = `This is ${itemData.displayName || itemData.name}. `;
    
    // Tool analysis
    if (this.isTool(item.name)) {
      analysis += `This is a tool. `;
      
      // Tool speed and durability
      if (typeof itemData.maxDurability === 'number') {
        analysis += `Maximum durability: ${itemData.maxDurability}. `;
      }
      
      // What it's good for
      const toolUses = this.getToolUses(item.name);
      if (toolUses) {
        analysis += toolUses;
      }
    }
    
    // Food analysis
    if (this.isFood(item.name)) {
      analysis += `This is food. `;
      
      if (typeof itemData.foodPoints === 'number') {
        analysis += `Restores ${itemData.foodPoints} hunger points. `;
      }
      
      if (typeof itemData.saturation === 'number') {
        analysis += `Saturation: ${itemData.saturation}.`;
      }
    }
    
    // Block analysis if this item places a block
    if (this.isBlock(item.name)) {
      analysis += `This item places a block when used. `;
    }
    
    // Crafting uses
    const craftUses = this.getItemCraftingUses(item.name);
    if (craftUses.length) {
      analysis += `Used to craft: ${craftUses.join(', ')}.`;
    }
    
    return analysis;
  }
  
  /**
   * Find a specific block type nearby
   */
  async findBlock(blockType) {
    if (!blockType) return null;
    
    let blockId;
    
    // Handle different input types
    if (typeof blockType === 'string') {
      // If it's a name, get the ID
      const block = this.findBlockTypeByName(blockType);
      if (!block) return null;
      blockId = block.id;
    } else if (typeof blockType === 'number') {
      // If it's already an ID
      blockId = blockType;
    } else if (typeof blockType === 'object' && blockType.id) {
      // If it's a block object
      blockId = blockType.id;
    } else {
      return null;
    }
    
    // Use mineflayer's findBlock
    try {
      return await this.bot.findBlock({
        matching: blockId,
        maxDistance: 32
      });
    } catch (error) {
      this.warn(`Error finding block: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Find a block type by name
   */
  findBlockTypeByName(name) {
    // Direct match
    if (this.blocksByName[name]) {
      return this.blocksByName[name];
    }
    
    // Partial match
    const lowerName = name.toLowerCase();
    
    // Try exact match with spaces replaced by underscores
    const underscoreName = lowerName.replace(/ /g, '_');
    if (this.blocksByName[underscoreName]) {
      return this.blocksByName[underscoreName];
    }
    
    // Try substring match
    for (const [blockName, block] of Object.entries(this.blocksByName)) {
      if (blockName.includes(lowerName)) {
        return block;
      }
    }
    
    // Last resort: full text search
    for (const [blockName, block] of Object.entries(this.blocksByName)) {
      const words = blockName.split('_');
      if (words.some(word => word === lowerName)) {
        return block;
      }
    }
    
    return null;
  }
  
  /**
   * Find an entity type by name
   */
  findEntityTypeByName(name) {
    // Direct match
    for (const [entityName, entity] of Object.entries(this.entityTypes)) {
      if (entityName.toLowerCase() === name.toLowerCase()) {
        return entity;
      }
    }
    
    // Partial match
    const lowerName = name.toLowerCase();
    for (const [entityName, entity] of Object.entries(this.entityTypes)) {
      if (entityName.toLowerCase().includes(lowerName)) {
        return entity;
      }
    }
    
    return null;
  }
  
  /**
   * Find an item by name
   */
  findItemByName(name) {
    // Direct match
    if (this.itemsByName[name]) {
      return this.itemsByName[name];
    }
    
    // Partial match
    const lowerName = name.toLowerCase();
    
    // Try exact match with spaces replaced by underscores
    const underscoreName = lowerName.replace(/ /g, '_');
    if (this.itemsByName[underscoreName]) {
      return this.itemsByName[underscoreName];
    }
    
    // Try substring match
    for (const [itemName, item] of Object.entries(this.itemsByName)) {
      if (itemName.includes(lowerName)) {
        return item;
      }
    }
    
    return null;
  }
  
  /**
   * Find nearest entity by type
   */
  findNearestEntityByType(type) {
    if (!type) return null;
    
    const typeId = typeof type === 'object' ? type.id : type;
    const entityFilter = e => e.entityType === typeId;
    
    return this.bot.nearestEntity(entityFilter);
  }
  
  /**
   * Find the nearest player
   */
  findNearestPlayer() {
    // Filter out self
    const playerFilter = entity => entity.type === 'player' && entity.username !== this.bot.username;
    
    return this.bot.nearestEntity(playerFilter);
  }
  
  /**
   * Get nearby blocks
   */
  getNearbyBlocks(radius = 5) {
    const blocks = [];
    const center = this.bot.entity.position.floored();
    
    for (let x = -radius; x <= radius; x++) {
      for (let y = -radius; y <= radius; y++) {
        for (let z = -radius; z <= radius; z++) {
          const pos = center.offset(x, y, z);
          const block = this.bot.blockAt(pos);
          
          if (block && block.type !== 0) { // Not air
            blocks.push(block);
          }
        }
      }
    }
    
    return blocks;
  }
  
  /**
   * Get nearby entities
   */
  getNearbyEntities(radius = 16) {
    const position = this.bot.entity.position;
    
    return Object.values(this.bot.entities).filter(entity => {
      if (!entity || !entity.position) return false;
      
      const distance = position.distanceTo(entity.position);
      return distance <= radius;
    });
  }
  
  /**
   * Get current biome
   */
  getCurrentBiome() {
    const pos = this.bot.entity.position;
    
    try {
      return this.bot.world.getBiome(pos.x, pos.y, pos.z);
    } catch (error) {
      return 'unknown';
    }
  }
  
  /**
   * Get biome data
   */
  getBiomeData(biomeName) {
    if (!this.biomes) return null;
    
    // Direct match
    for (const [id, biome] of Object.entries(this.biomes)) {
      if (biome.name === biomeName) {
        return biome;
      }
    }
    
    return null;
  }
  
  /**
   * Get biome resources
   */
  getBiomeResources(biomeName) {
    // Define common resources for some biomes
    const biomeResources = {
      'forest': ['wood', 'apple', 'wolf'],
      'jungle': ['wood', 'cocoa', 'ocelot'],
      'taiga': ['wood', 'wolf', 'sweet_berries'],
      'desert': ['sand', 'cactus', 'dead_bush'],
      'plains': ['grass', 'cow', 'horse', 'sheep'],
      'mountain': ['stone', 'coal', 'iron', 'emerald'],
      'ocean': ['fish', 'squid', 'kelp'],
      'swamp': ['lily_pad', 'slime', 'mushroom']
    };
    
    // Match biome name to our predefined list
    for (const [biome, resources] of Object.entries(biomeResources)) {
      if (biomeName.toLowerCase().includes(biome)) {
        return resources;
      }
    }
    
    return [];
  }
  
  /**
   * Get the current time of day
   */
  getTimeOfDay() {
    try {
      const time = this.bot.time.timeOfDay;
      
      if (time >= 0 && time < 6000) {
        return 'early morning';
      } else if (time >= 6000 && time < 12000) {
        return 'daytime';
      } else if (time >= 12000 && time < 18000) {
        return 'evening';
      } else {
        return 'night';
      }
    } catch (error) {
      return 'unknown time';
    }
  }
  
  /**
   * Get the current weather
   */
  getWeather() {
    try {
      if (this.bot.isRaining) {
        return this.bot.thunderState ? 'thunderstorm' : 'rain';
      } else {
        return 'clear';
      }
    } catch (error) {
      return 'unknown';
    }
  }
  
  /**
   * Assess the danger level in the area
   */
  assessDanger() {
    let dangerLevel = 0;
    
    // Time-based danger
    const time = this.bot.time.timeOfDay;
    if (time >= 13000 && time <= 23000) {
      // Nighttime is more dangerous
      dangerLevel += 0.3;
    }
    
    // Weather-based danger
    if (this.bot.isRaining) {
      dangerLevel += 0.1;
    }
    if (this.bot.thunderState) {
      dangerLevel += 0.2;
    }
    
    // Entity-based danger
    const entities = this.getNearbyEntities(16);
    const hostileCount = entities.filter(e => this.isHostileEntity(e)).length;
    
    if (hostileCount > 5) {
      dangerLevel += 0.4;
    } else if (hostileCount > 0) {
      dangerLevel += 0.2 * (hostileCount / 5);
    }
    
    // Cap at 1.0
    return Math.min(1.0, dangerLevel);
  }
  
  /**
   * Assess the resource richness in the area
   */
  assessResources() {
    let resourceScore = 0;
    
    // Block-based resources
    const blocks = this.getNearbyBlocks(8);
    
    // Count valuable blocks
    const oreCount = blocks.filter(b => {
      const name = b.name || '';
      return name.includes('ore') || name.includes('diamond') || name.includes('emerald');
    }).length;
    
    if (oreCount > 5) {
      resourceScore += 0.5;
    } else if (oreCount > 0) {
      resourceScore += 0.1 * (oreCount / 5);
    }
    
    // Count trees and crops
    const woodCount = blocks.filter(b => {
      const name = b.name || '';
      return name.includes('log') || name.includes('wood');
    }).length;
    
    const cropCount = blocks.filter(b => {
      const name = b.name || '';
      return name.includes('crop') || name.includes('wheat') || name.includes('carrot') || name.includes('potato');
    }).length;
    
    if (woodCount > 10) {
      resourceScore += 0.3;
    } else if (woodCount > 0) {
      resourceScore += 0.03 * (woodCount / 10);
    }
    
    if (cropCount > 5) {
      resourceScore += 0.2;
    } else if (cropCount > 0) {
      resourceScore += 0.04 * (cropCount / 5);
    }
    
    // Cap at 1.0
    return Math.min(1.0, resourceScore);
  }
  
  /**
   * Get the best tool for a block
   */
  getBestToolForBlock(block) {
    if (!block) return null;
    
    // Default tool mappings
    const toolMappings = {
      'stone': 'pickaxe',
      'ore': 'pickaxe',
      'coal': 'pickaxe',
      'iron': 'pickaxe',
      'gold': 'pickaxe',
      'diamond': 'pickaxe',
      'dirt': 'shovel',
      'grass': 'shovel',
      'sand': 'shovel',
      'gravel': 'shovel',
      'clay': 'shovel',
      'log': 'axe',
      'wood': 'axe',
      'planks': 'axe',
      'wool': 'shears'
    };
    
    const blockName = block.name || '';
    
    // Check for direct matches
    for (const [material, tool] of Object.entries(toolMappings)) {
      if (blockName.includes(material)) {
        return tool;
      }
    }
    
    return 'hand'; // Default to hand if no specific tool
  }
  
  /**
   * Get block usage info
   */
  getBlockUsageInfo(block) {
    if (!block) return '';
    
    const blockName = block.name || '';
    
    // Special blocks
    if (blockName.includes('crafting_table')) {
      return 'Used for crafting items. ';
    } else if (blockName.includes('furnace')) {
      return 'Used for smelting items. ';
    } else if (blockName.includes('chest')) {
      return 'Used to store items. ';
    } else if (blockName.includes('bed')) {
      return 'Used to sleep through the night and set spawn point. ';
    } else if (blockName.includes('door')) {
      return 'Used as an entrance/barrier. ';
    } else if (blockName.includes('ore')) {
      return 'Valuable resource that can be mined. ';
    } else if (blockName.includes('log') || blockName.includes('wood')) {
      return 'Used for crafting tools, building and fuel. ';
    }
    
    return '';
  }
  
  /**
   * Get tool uses
   */
  getToolUses(itemName) {
    if (!itemName) return '';
    
    const name = itemName.toLowerCase();
    
    if (name.includes('pickaxe')) {
      return 'Effective for mining stone, ores and related blocks. ';
    } else if (name.includes('axe')) {
      return 'Effective for chopping wood and related blocks. ';
    } else if (name.includes('shovel')) {
      return 'Effective for digging dirt, sand, gravel and related blocks. ';
    } else if (name.includes('hoe')) {
      return 'Used for tilling soil for farming. ';
    } else if (name.includes('sword')) {
      return 'Weapon for combat against mobs and players. ';
    } else if (name.includes('shears')) {
      return 'Used for shearing sheep and harvesting specific plants. ';
    }
    
    return '';
  }
  
  /**
   * Get item crafting uses
   */
  getItemCraftingUses(itemName) {
    if (!itemName || !this.craftingRecipes) return [];
    
    const uses = [];
    const itemId = this.findItemByName(itemName)?.id;
    
    if (!itemId) return [];
    
    // Search through recipes for items that use this as an ingredient
    Object.entries(this.craftingRecipes).forEach(([resultName, recipes]) => {
      recipes.forEach(recipe => {
        if (!recipe.inShape && !recipe.ingredients) return;
        
        const isIngredient = recipe.inShape ?
          recipe.inShape.some(row => row && row.some(id => id === itemId)) :
          recipe.ingredients.some(ingredient => ingredient.id === itemId);
        
        if (isIngredient && !uses.includes(resultName)) {
          uses.push(resultName.replace(/_/g, ' '));
        }
      });
    });
    
    return uses.slice(0, 5); // Limit to top 5 to avoid too long responses
  }
  
  /**
   * Check if an item is a tool
   */
  isTool(itemName) {
    if (!itemName) return false;
    const name = itemName.toLowerCase();
    
    const toolKeywords = [
      'pickaxe', 'axe', 'shovel', 'sword', 'hoe', 'shears',
      'helmet', 'chestplate', 'leggings', 'boots', 'bow'
    ];
    
    return toolKeywords.some(keyword => name.includes(keyword));
  }
  
  /**
   * Check if an item is food
   */
  isFood(itemName) {
    if (!itemName) return false;
    const name = itemName.toLowerCase();
    
    const foodKeywords = [
      'apple', 'beef', 'bread', 'chicken', 'fish', 'pork',
      'carrot', 'potato', 'cake', 'melon', 'pumpkin', 'pie',
      'stew', 'soup', 'cookie', 'berry'
    ];
    
    return foodKeywords.some(keyword => name.includes(keyword));
  }
  
  /**
   * Check if an item places a block
   */
  isBlock(itemName) {
    if (!itemName) return false;
    
    // Check if there's a block with the same name
    const normalizedName = itemName.replace('item_', '');
    return this.blocksByName[normalizedName] !== undefined;
  }
  
  /**
   * Check if an entity is hostile
   */
  isHostileEntity(entity) {
    if (!entity) return false;
    
    // Known hostile mob types
    const hostileMobs = [
      'zombie', 'skeleton', 'creeper', 'spider', 'enderman',
      'witch', 'slime', 'phantom', 'drowned', 'husk',
      'pillager', 'vindicator', 'evoker', 'blaze'
    ];
    
    // Check if entity name contains any hostile mob names
    const name = entity.name || entity.username || entity.mobType || entity.type || '';
    
    return hostileMobs.some(mob => name.toLowerCase().includes(mob));
  }
  
  /**
   * Find a recipe for an item
   */
  findRecipe(itemName) {
    if (!itemName || !this.craftingRecipes) return null;
    
    const normalizedName = itemName.toLowerCase().replace(/ /g, '_');
    
    // Direct lookup
    if (this.craftingRecipes[normalizedName]) {
      return this.craftingRecipes[normalizedName][0]; // Return first recipe
    }
    
    // Try to match similar names
    for (const [recipeName, recipes] of Object.entries(this.craftingRecipes)) {
      if (recipeName.includes(normalizedName)) {
        return recipes[0]; // Return first recipe
      }
    }
    
    return null;
  }
  
  /**
   * Craft an item
   */
  async craftItem(itemName, amount = 1) {
    // Ensure we have a recipe for this item
    const recipe = this.findRecipe(itemName);
    if (!recipe) {
      this.bot.chat(`I don't know how to craft ${itemName}.`);
      return false;
    }
    
    try {
      // Check if we need a crafting table
      const requiresCraftingTable = recipe.requiresCraftingTable || 
        (recipe.inShape && recipe.inShape.length > 2) || 
        (recipe.ingredients && recipe.ingredients.length > 4);
      
      if (requiresCraftingTable) {
        // Find a crafting table
        let craftingTable = this.bot.findBlock({
          matching: this.blocksByName['crafting_table']?.id,
          maxDistance: 5
        });
        
        if (!craftingTable) {
          this.bot.chat("I need a crafting table. Let me try to make one.");
          
          // Try to craft a crafting table
          if (!await this.craftItem('crafting_table', 1)) {
            // If we can't craft a crafting table, try to gather wood first
            this.bot.chat("I need wood to make a crafting table.");
            await this.gatherResource('wood', 4);
            
            // Now try again to craft a crafting table
            if (!await this.craftItem('crafting_table', 1)) {
              this.bot.chat("I still can't make a crafting table. Missing materials.");
              return false;
            }
          }
          
          // Place the crafting table
          await this.placeItem('crafting_table');
          
          // Find the newly placed crafting table
          craftingTable = this.bot.findBlock({
            matching: this.blocksByName['crafting_table']?.id,
            maxDistance: 5
          });
          
          if (!craftingTable) {
            this.bot.chat("I couldn't find the crafting table I just placed.");
            return false;
          }
        }
        
        // Use the crafting table
        const craftingTableBlock = this.bot.blockAt(craftingTable.position);
        await this.bot.craft(recipe, amount, craftingTableBlock);
      } else {
        // Craft in inventory
        await this.bot.craft(recipe, amount);
      }
      
      this.bot.chat(`Successfully crafted ${amount} ${itemName}.`);
      return true;
    } catch (error) {
      this.warn(`Error crafting ${itemName}: ${error.message}`);
      this.bot.chat(`Failed to craft ${itemName}: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Gather a specific resource
   */
  async gatherResource(resourceName, amount = 16) {
    // Normalize resource name
    const resource = resourceName.toLowerCase();
    
    // Handle special resource types
    if (resource === 'wood' || resource === 'logs') {
      return await this.gatherWood(amount);
    } else if (resource === 'stone') {
      return await this.gatherStone(amount);
    } else if (resource === 'food') {
      return await this.gatherFood(amount);
    } else if (resource === 'ores' || resource === 'ore') {
      return await this.gatherOres(amount);
    }
    
    // For other resources, try to find the block type
    const blockType = this.findBlockTypeByName(resource);
    if (!blockType) {
      this.bot.chat(`I don't know how to gather ${resource}.`);
      return false;
    }
    
    try {
      // Use mineflayer-collectblock if available
      if (this.bot.collectBlock) {
        this.bot.chat(`Looking for ${resource} to collect...`);
        
        // Find blocks to collect
        const blocks = [];
        let collected = 0;
        
        while (collected < amount) {
          const block = await this.findBlock(blockType);
          
          if (!block) {
            this.bot.chat(`I can't find any more ${resource} nearby.`);
            break;
          }
          
          blocks.push(block);
          collected++;
          
          try {
            await this.bot.collectBlock.collect(block);
            this.bot.chat(`Collected ${resource} (${collected}/${amount})`);
          } catch (error) {
            this.warn(`Failed to collect ${resource}: ${error.message}`);
            break;
          }
        }
        
        return collected > 0;
      } else {
        // Fallback to basic mining
        this.bot.chat(`Looking for ${resource} to mine...`);
        
        let mined = 0;
        while (mined < amount) {
          const block = await this.findBlock(blockType);
          
          if (!block) {
            this.bot.chat(`I can't find any more ${resource} nearby.`);
            break;
          }
          
          try {
            await this.bot.pathfinder.goto(
              new this.bot.pathfinder.goals.GoalGetToBlock(
                block.position.x, block.position.y, block.position.z
              )
            );
            
            await this.bot.dig(block);
            mined++;
            this.bot.chat(`Mined ${resource} (${mined}/${amount})`);
          } catch (error) {
            this.warn(`Failed to mine ${resource}: ${error.message}`);
            break;
          }
        }
        
        return mined > 0;
      }
    } catch (error) {
      this.warn(`Error gathering ${resource}: ${error.message}`);
      this.bot.chat(`Failed to gather ${resource}: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Gather wood
   */
  async gatherWood(amount = 16) {
    this.bot.chat(`Looking for trees to gather ${amount} wood...`);
    
    // Find tree logs
    const woodTypes = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log'];
    
    let gathered = 0;
    let attempts = 0;
    const maxAttempts = 10;
    
    while (gathered < amount && attempts < maxAttempts) {
      attempts++;
      
      // Try each wood type
      let log = null;
      
      for (const woodType of woodTypes) {
        const blockType = this.findBlockTypeByName(woodType);
        if (blockType) {
          log = await this.findBlock(blockType);
          if (log) break;
        }
      }
      
      if (!log) {
        this.bot.chat("I can't find any trees nearby.");
        break;
      }
      
      try {
        // Use collectBlock if available
        if (this.bot.collectBlock) {
          await this.bot.collectBlock.collect(log);
        } else {
          // Fallback to basic mining
          await this.bot.pathfinder.goto(
            new this.bot.pathfinder.goals.GoalGetToBlock(
              log.position.x, log.position.y, log.position.z
            )
          );
          
          await this.bot.dig(log);
        }
        
        gathered++;
        
        if (gathered % 4 === 0 || gathered === amount) {
          this.bot.chat(`Gathered ${gathered}/${amount} wood`);
        }
      } catch (error) {
        this.warn(`Failed to gather wood: ${error.message}`);
        continue;
      }
    }
    
    this.bot.chat(`Finished gathering wood: ${gathered}/${amount} collected`);
    return gathered > 0;
  }
  
  /**
   * Gather stone
   */
  async gatherStone(amount = 16) {
    this.bot.chat(`Looking for stone to gather ${amount}...`);
    
    // Check if we have a pickaxe
    const pickaxe = this.bot.inventory.items().find(item => 
      item.name.includes('pickaxe')
    );
    
    if (!pickaxe) {
      this.bot.chat("I need a pickaxe to mine stone. Let me make one.");
      
      // Try to craft a wooden pickaxe
      const craftSuccess = await this.craftItem('wooden_pickaxe', 1);
      
      if (!craftSuccess) {
        this.bot.chat("I couldn't craft a pickaxe. Let me gather some wood first.");
        await this.gatherWood(4);
        
        // Try again
        if (!await this.craftItem('wooden_pickaxe', 1)) {
          this.bot.chat("I still can't craft a pickaxe. Missing materials.");
          return false;
        }
      }
    }
    
    // Look for stone
    const stoneBlock = this.findBlockTypeByName('stone');
    
    if (!stoneBlock) {
      this.bot.chat("I can't identify stone blocks.");
      return false;
    }
    
    let gathered = 0;
    let attempts = 0;
    const maxAttempts = 10;
    
    while (gathered < amount && attempts < maxAttempts) {
      attempts++;
      
      const stone = await this.findBlock(stoneBlock);
      
      if (!stone) {
        this.bot.chat("I can't find any stone nearby.");
        break;
      }
      
      try {
        // Equip pickaxe
        const pickaxe = this.bot.inventory.items().find(item => 
          item.name.includes('pickaxe')
        );
        
        if (pickaxe) {
          await this.bot.equip(pickaxe, 'hand');
        }
        
        // Mine the stone
        if (this.bot.collectBlock) {
          await this.bot.collectBlock.collect(stone);
        } else {
          await this.bot.pathfinder.goto(
            new this.bot.pathfinder.goals.GoalGetToBlock(
              stone.position.x, stone.position.y, stone.position.z
            )
          );
          
          await this.bot.dig(stone);
        }
        
        gathered++;
        
        if (gathered % 4 === 0 || gathered === amount) {
          this.bot.chat(`Gathered ${gathered}/${amount} stone`);
        }
      } catch (error) {
        this.warn(`Failed to gather stone: ${error.message}`);
        continue;
      }
    }
    
    this.bot.chat(`Finished gathering stone: ${gathered}/${amount} collected`);
    return gathered > 0;
  }
  
  /**
   * Gather food
   */
  async gatherFood(amount = 8) {
    this.bot.chat(`Looking for food to gather ${amount}...`);
    
    // Types of food to look for
    const foodSources = [
      'apple', 'potato', 'carrot', 'wheat', 'melon', 'pumpkin',
      'chicken', 'pig', 'cow', 'sheep'
    ];
    
    let gathered = 0;
    let attempts = 0;
    const maxAttempts = 15;
    
    while (gathered < amount && attempts < maxAttempts) {
      attempts++;
      
      // Try each food source
      let target = null;
      let targetType = '';
      
      for (const foodType of foodSources) {
        // Check if it's a crop or plant
        const blockType = this.findBlockTypeByName(foodType);
        if (blockType) {
          target = await this.findBlock(blockType);
          if (target) {
            targetType = 'block';
            break;
          }
        }
        
        // Check if it's an animal
        const entityType = this.findEntityTypeByName(foodType);
        if (entityType) {
          target = this.findNearestEntityByType(entityType);
          if (target) {
            targetType = 'entity';
            break;
          }
        }
      }
      
      if (!target) {
        this.bot.chat("I can't find any food sources nearby.");
        break;
      }
      
      try {
        if (targetType === 'block') {
          // Gather crop/plant
          if (this.bot.collectBlock) {
            await this.bot.collectBlock.collect(target);
          } else {
            await this.bot.pathfinder.goto(
              new this.bot.pathfinder.goals.GoalGetToBlock(
                target.position.x, target.position.y, target.position.z
              )
            );
            
            await this.bot.dig(target);
          }
        } else if (targetType === 'entity') {
          // Hunt animal
          const sword = this.bot.inventory.items().find(item => 
            item.name.includes('sword')
          );
          
          if (sword) {
            await this.bot.equip(sword, 'hand');
          }
          
          await this.bot.pathfinder.goto(
            new this.bot.pathfinder.goals.GoalNear(
              target.position.x, target.position.y, target.position.z, 2
            )
          );
          
          // Attack until dead
          let attackAttempts = 0;
          while (target.isValid && attackAttempts < 20) {
            try {
              await this.bot.attack(target);
              await new Promise(resolve => setTimeout(resolve, 500));
              attackAttempts++;
            } catch (attackError) {
              break;
            }
          }
        }
        
        gathered++;
        
        if (gathered % 2 === 0 || gathered === amount) {
          this.bot.chat(`Gathered ${gathered}/${amount} food items`);
        }
      } catch (error) {
        this.warn(`Failed to gather food: ${error.message}`);
        continue;
      }
    }
    
    this.bot.chat(`Finished gathering food: ${gathered}/${amount} collected`);
    return gathered > 0;
  }
  
  /**
   * Gather ores
   */
  async gatherOres(amount = 16) {
    this.bot.chat(`Looking for ores to mine ${amount}...`);
    
    // Check if we have a pickaxe
    const pickaxe = this.bot.inventory.items().find(item => 
      item.name.includes('pickaxe')
    );
    
    if (!pickaxe) {
      this.bot.chat("I need a pickaxe to mine ores. Let me make one.");
      
      // Try to craft a pickaxe
      const craftSuccess = await this.craftItem('stone_pickaxe', 1);
      
      if (!craftSuccess) {
        this.bot.chat("I couldn't craft a stone pickaxe. Let me gather some materials.");
        await this.gatherWood(3);
        await this.gatherStone(3);
        
        // Try again
        if (!await this.craftItem('stone_pickaxe', 1)) {
          this.bot.chat("I still can't craft a pickaxe. Let me try a wooden one.");
          
          if (!await this.craftItem('wooden_pickaxe', 1)) {
            this.bot.chat("I can't craft any pickaxe. Missing materials.");
            return false;
          }
        }
      }
    }
    
    // Types of ores to look for, in order of preference
    const oreTypes = [
      'diamond_ore', 'emerald_ore', 'gold_ore', 'iron_ore', 
      'redstone_ore', 'lapis_ore', 'coal_ore', 'copper_ore'
    ];
    
    let gathered = 0;
    let attempts = 0;
    const maxAttempts = 20;
    
    while (gathered < amount && attempts < maxAttempts) {
      attempts++;
      
      // Try each ore type
      let ore = null;
      
      for (const oreType of oreTypes) {
        const blockType = this.findBlockTypeByName(oreType);
        if (blockType) {
          ore = await this.findBlock(blockType);
          if (ore) break;
        }
      }
      
      if (!ore) {
        this.bot.chat("I can't find any ores nearby. I'll need to dig deeper or explore caves.");
        break;
      }
      
      try {
        // Equip pickaxe
        const pickaxe = this.bot.inventory.items().find(item => 
          item.name.includes('pickaxe')
        );
        
        if (pickaxe) {
          await this.bot.equip(pickaxe, 'hand');
        }
        
        // Mine the ore
        if (this.bot.collectBlock) {
          await this.bot.collectBlock.collect(ore);
        } else {
          await this.bot.pathfinder.goto(
            new this.bot.pathfinder.goals.GoalGetToBlock(
              ore.position.x, ore.position.y, ore.position.z
            )
          );
          
          await this.bot.dig(ore);
        }
        
        gathered++;
        
        if (gathered % 2 === 0 || gathered === amount) {
          this.bot.chat(`Mined ${gathered}/${amount} ores`);
        }
      } catch (error) {
        this.warn(`Failed to mine ore: ${error.message}`);
        continue;
      }
    }
    
    this.bot.chat(`Finished mining ores: ${gathered}/${amount} collected`);
    return gathered > 0;
  }
  
  /**
   * Place an item from inventory
   */
  async placeItem(itemName) {
    // Find the item in inventory
    const item = this.bot.inventory.items().find(i => i.name === itemName);
    
    if (!item) {
      this.bot.chat(`I don't have any ${itemName} in my inventory.`);
      return false;
    }
    
    try {
      // Equip the item
      await this.bot.equip(item, 'hand');
      
      // Find a suitable position to place it
      const pos = this.bot.entity.position;
      
      // Try different offsets around the bot
      const offsets = [
        { x: 1, y: 0, z: 0 },
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 0, z: -1 }
      ];
      
      for (const offset of offsets) {
        const placePos = pos.offset(offset.x, offset.y, offset.z);
        const placeBlock = this.bot.blockAt(placePos);
        
        if (placeBlock.name === 'air') {
          // Find reference block (adjacent solid block)
          const refOffsets = [
            { x: 0, y: -1, z: 0 }, // Below
            { x: 1, y: 0, z: 0 },  // East
            { x: -1, y: 0, z: 0 }, // West
            { x: 0, y: 0, z: 1 },  // South
            { x: 0, y: 0, z: -1 }  // North
          ];
          
          for (const refOffset of refOffsets) {
            const refPos = placePos.offset(refOffset.x, refOffset.y, refOffset.z);
            const refBlock = this.bot.blockAt(refPos);
            
            if (refBlock.name !== 'air') {
              // Face the reference block
              await this.bot.lookAt(refBlock.position);
              
              // Place the block
              await this.bot.placeBlock(refBlock, new Vec3(
                -refOffset.x, -refOffset.y, -refOffset.z
              ));
              
              this.bot.chat(`Placed ${itemName}`);
              return true;
            }
          }
        }
      }
      
      this.bot.chat(`Could not find a suitable position to place ${itemName}.`);
      return false;
    } catch (error) {
      this.warn(`Error placing ${itemName}: ${error.message}`);
      this.bot.chat(`Failed to place ${itemName}: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Remember something in bot's memory
   */
  remember(key, value) {
    // Ensure memory doesn't grow too large
    const memoryKeys = Object.keys(this.memories);
    if (memoryKeys.length >= this.config.maxMemoryItems) {
      // Remove oldest memory
      delete this.memories[memoryKeys[0]];
    }
    
    this.memories[key] = {
      value,
      timestamp: Date.now()
    };
  }
  
  /**
   * Recall something from bot's memory
   */
  recall(key) {
    if (!this.memories[key]) return null;
    return this.memories[key].value;
  }
  
  /**
   * Handle physics tick event
   */
  onTick() {
    // Process task queue
    if (this.taskQueue.length > 0 && !this.currentGoal) {
      const task = this.taskQueue.shift();
      this.executeTask(task);
    }
  }
  
  /**
   * Handle chat event
   */
  onChat(username, message) {
    // Don't respond to self
    if (username === this.bot.username) return;
    
    // Store the last message from this player
    this.remember(`lastMessageFrom_${username}`, message);
    
    // Process message for chat commands if we're using the fallback command system
    if (this.chatCommands) {
      // Check if it's a command (starts with ! or /)
      const commandPrefix = '!';
      
      if (message.startsWith(commandPrefix)) {
        // Extract the command and arguments
        const parts = message.slice(commandPrefix.length).trim().split(/\s+/);
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);
        
        this.info(`Processing chat command: ${command} with args: ${args.join(', ')}`);
        
        // Check if we have a handler for this command
        if (this.chatCommands[command] && typeof this.chatCommands[command] === 'function') {
          try {
            // Execute the command handler
            this.chatCommands[command](username, args);
          } catch (error) {
            this.error(`Error executing command ${command}:`, error);
            this.bot.chat(`Error executing command: ${error.message}`);
          }
        }
      }
    }
  }
  
  /**
   * Handle block update event
   */
  onBlockUpdate(oldBlock, newBlock) {
    // Track interesting block changes
    if (!oldBlock || !newBlock) return;
    
    if (oldBlock.type !== newBlock.type) {
      // Remember where certain valuable blocks were placed
      const valuableBlocks = ['chest', 'crafting_table', 'furnace', 'enchanting_table'];
      
      if (valuableBlocks.some(name => newBlock.name.includes(name))) {
        const pos = newBlock.position;
        this.remember(`${newBlock.name}_location`, { x: pos.x, y: pos.y, z: pos.z });
      }
    }
  }
  
  /**
   * Handle chunk load event
   */
  onChunkLoad(chunkX, chunkZ) {
    // Track explored areas
    const key = `explored_${chunkX}_${chunkZ}`;
    this.remember(key, true);
  }
  
  /**
   * Handle entity spawn event
   */
  onEntitySpawn(entity) {
    // Track interesting entities
    if (this.isHostileEntity(entity)) {
      this.debug(`Detected hostile entity: ${entity.name || entity.type} at ${entity.position}`);
    }
  }
  
  /**
   * Handle entity gone event
   */
  onEntityGone(entity) {
    // Nothing to do here yet
  }
  
  /**
   * Execute a task from the queue
   */
  async executeTask(task) {
    if (!task) return;
    
    this.currentGoal = task;
    this.info(`Executing task: ${task.type}`);
    
    try {
      switch (task.type) {
        case 'goto':
          await this.bot.pathfinder.goto(task.goal);
          break;
        case 'dig':
          await this.bot.dig(task.block);
          break;
        case 'place':
          await this.bot.placeBlock(task.referenceBlock, task.direction);
          break;
        case 'craft':
          await this.craftItem(task.item, task.amount);
          break;
        case 'sleep':
          await new Promise(resolve => setTimeout(resolve, task.timeout));
          break;
        default:
          this.warn(`Unknown task type: ${task.type}`);
      }
    } catch (error) {
      this.error(`Failed to execute task ${task.type}:`, error);
    }
    
    this.currentGoal = null;
  }
  
  /**
   * Add a task to the queue
   */
  addTask(task) {
    this.taskQueue.push(task);
  }
  
  /**
   * Shutdown the plugin
   */
  async shutdown() {
    this.info('Shutting down AI Assistant plugin');
    // Clean up any ongoing tasks
    this.taskQueue = [];
    this.currentGoal = null;
    return true;
  }
}

module.exports = AIAssistant;