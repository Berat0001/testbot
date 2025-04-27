/**
 * Intelligent Decision Plugin
 * 
 * This plugin enhances the bot's decision-making capabilities by integrating
 * the minecraft-data library and advanced planning algorithms.
 */

const BasePlugin = require('../basePlugin');
const MinecraftDataIntegration = require('../../utils/minecraftDataIntegration');

class IntelligentDecision extends BasePlugin {
  constructor(bot, config, pluginManager) {
    super('intelligentDecision', bot, config, pluginManager);
    
    this.learningManager = null;
    this.mcDataIntegration = null;
    this.taskQueue = [];
    this.currentTask = null;
    this.lastTaskTime = 0;
    this.taskTimeout = 60000; // 1 minute timeout for tasks
    
    // Configuration
    this.config = {
      enabled: true,
      autonomousMode: true,
      decisionInterval: 30000, // 30 seconds
      taskTimeout: 60000, // 1 minute
      debugMode: true,
      ...config.intelligentDecision
    };
  }
  
  /**
   * Initialize the plugin
   */
  async initialize() {
    this.info('Initializing Intelligent Decision plugin');
    
    try {
      // Find learning manager
      const learningBehavior = this.findLearningBehaviorPlugin();
      if (learningBehavior && learningBehavior.learningManager) {
        this.learningManager = learningBehavior.learningManager;
        this.info('Connected to learning manager');
      } else {
        this.warn('Learning manager not found, some features will be limited');
      }
      
      // Initialize minecraft data integration
      this.mcDataIntegration = new MinecraftDataIntegration(this.bot, this.learningManager);
      this.info(`Minecraft data integration initialized with ${Object.keys(this.mcDataIntegration.blocksByName).length} blocks`);
      
      // Register event handlers
      this.registerEventHandlers();
      
      // Register commands
      this.registerCommands();
      
      // Start decision-making loop if autonomous mode is enabled
      if (this.config.autonomousMode) {
        this.startDecisionLoop();
      }
      
      this.info('Intelligent Decision plugin initialized');
      return true;
    } catch (error) {
      this.error('Error initializing Intelligent Decision plugin:', error);
      return false;
    }
  }
  
  /**
   * Find the LearningBehavior plugin
   */
  findLearningBehaviorPlugin() {
    if (!this.pluginManager) return null;
    
    // Try to find by plugin name
    if (typeof this.pluginManager.getPluginByName === 'function') {
      return this.pluginManager.getPluginByName('learningBehavior');
    }
    
    // Try to access plugins array
    if (this.pluginManager.plugins) {
      return this.pluginManager.plugins.find(p => p.name === 'learningBehavior');
    }
    
    return null;
  }
  
  /**
   * Register event handlers
   */
  registerEventHandlers() {
    try {
      // Listen for block break events (to record experience)
      if (this.bot.on) {
        this.bot.on('playerCollect', this.onPlayerCollect.bind(this));
        this.bot.on('diggingCompleted', this.onDiggingCompleted.bind(this));
        this.bot.on('physicsTick', this.onTick.bind(this));
      }
      
      // Listen for chat messages
      if (this.bot.on) {
        this.bot.on('chat', this.onChat.bind(this));
      }
      
      // Try to listen for state changes
      if (this.bot.stateMachine) {
        if (this.bot.stateMachine.on) {
          this.bot.stateMachine.on('stateChanged', this.onStateChanged.bind(this));
        }
      }
    } catch (error) {
      this.warn('Error registering event handlers:', error);
    }
  }
  
  /**
   * Register commands
   */
  registerCommands() {
    // Find command handler
    let commandHandler = null;
    
    if (this.pluginManager) {
      if (typeof this.pluginManager.getPluginByName === 'function') {
        commandHandler = this.pluginManager.getPluginByName('commandHandler');
      } else if (this.pluginManager.plugins) {
        commandHandler = this.pluginManager.plugins.find(p => 
          p.name === 'commandHandler' || p.name === 'CommandHandler'
        );
      }
    }
    
    if (commandHandler && typeof commandHandler.registerCommand === 'function') {
      commandHandler.registerCommand('suggest', this.handleSuggestCommand.bind(this),
        'Get suggestions for next actions',
        'suggest [task]');
      
      commandHandler.registerCommand('execute', this.handleExecuteCommand.bind(this),
        'Execute a suggested task',
        'execute <taskId>');
      
      commandHandler.registerCommand('autonomy', this.handleAutonomyCommand.bind(this),
        'Toggle autonomous decision-making',
        'autonomy [on|off]');
        
      commandHandler.registerCommand('analyze', this.handleAnalyzeCommand.bind(this),
        'Analyze the environment or an item',
        'analyze [target]');
    } else {
      this.warn('Command handler not found, using chat-based commands');
      
      this.chatCommands = {
        'suggest': this.handleSuggestCommand.bind(this),
        'execute': this.handleExecuteCommand.bind(this),
        'autonomy': this.handleAutonomyCommand.bind(this),
        'analyze': this.handleAnalyzeCommand.bind(this)
      };
    }
  }
  
  /**
   * Start the autonomous decision loop
   */
  startDecisionLoop() {
    if (this.decisionLoopInterval) {
      clearInterval(this.decisionLoopInterval);
    }
    
    this.info('Starting autonomous decision loop');
    this.decisionLoopInterval = setInterval(() => {
      this.makeAutonomousDecision();
    }, this.config.decisionInterval);
  }
  
  /**
   * Stop the autonomous decision loop
   */
  stopDecisionLoop() {
    if (this.decisionLoopInterval) {
      clearInterval(this.decisionLoopInterval);
      this.decisionLoopInterval = null;
      this.info('Stopped autonomous decision loop');
    }
  }
  
  /**
   * Handle the suggest command
   */
  handleSuggestCommand(username, args) {
    // Generate suggestions for the next action
    const suggestions = this.getSuggestions();
    
    // Format and send suggestions
    if (suggestions.length === 0) {
      this.bot.chat('No suggestions available at the moment.');
      return;
    }
    
    this.bot.chat(`Here are my suggested actions:`);
    suggestions.forEach((suggestion, index) => {
      setTimeout(() => {
        this.bot.chat(`${index + 1}. ${suggestion.description} (${suggestion.type})`);
      }, index * 500); // Space out messages to avoid chat spam
    });
    
    setTimeout(() => {
      this.bot.chat(`Use "execute <number>" to perform a suggested task.`);
    }, suggestions.length * 500 + 500);
  }
  
  /**
   * Handle the execute command
   */
  handleExecuteCommand(username, args) {
    if (!args.length) {
      this.bot.chat('Please specify which suggestion to execute (number).');
      return;
    }
    
    const taskId = parseInt(args[0]) - 1;
    const suggestions = this.getSuggestions();
    
    if (isNaN(taskId) || taskId < 0 || taskId >= suggestions.length) {
      this.bot.chat(`Invalid task number. Choose between 1 and ${suggestions.length}.`);
      return;
    }
    
    const task = suggestions[taskId];
    this.bot.chat(`Executing task: ${task.description}`);
    
    this.executeTask(task);
  }
  
  /**
   * Handle the autonomy command
   */
  handleAutonomyCommand(username, args) {
    if (!args.length) {
      this.bot.chat(`Autonomous mode is currently ${this.config.autonomousMode ? 'ON' : 'OFF'}.`);
      return;
    }
    
    const setting = args[0].toLowerCase();
    
    if (setting === 'on' || setting === 'true' || setting === 'enable') {
      this.config.autonomousMode = true;
      this.startDecisionLoop();
      this.bot.chat('Autonomous decision-making enabled.');
    } else if (setting === 'off' || setting === 'false' || setting === 'disable') {
      this.config.autonomousMode = false;
      this.stopDecisionLoop();
      this.bot.chat('Autonomous decision-making disabled.');
    } else {
      this.bot.chat(`Unknown setting. Use "on" or "off".`);
    }
  }
  
  /**
   * Handle the analyze command
   */
  handleAnalyzeCommand(username, args) {
    if (!args.length) {
      // Analyze current environment
      this.analyzeEnvironment();
      return;
    }
    
    const target = args[0].toLowerCase();
    
    if (target === 'inventory' || target === 'inv') {
      this.analyzeInventory();
    } else if (target === 'biome') {
      this.analyzeBiome();
    } else if (target === 'block') {
      this.analyzeBlock(args[1]);
    } else if (target === 'item') {
      this.analyzeItem(args[1]);
    } else if (target === 'task') {
      this.analyzeCurrentTask();
    } else {
      // Try to analyze the specified target
      this.analyzeGenericTarget(target);
    }
  }
  
  /**
   * Analyze the current environment
   */
  analyzeEnvironment() {
    try {
      const pos = this.bot.entity.position;
      const block = this.bot.blockAt(pos.offset(0, -1, 0));
      const biome = this.getCurrentBiome();
      const timeOfDay = this.getTimeOfDay();
      const nearbyEntities = Object.values(this.bot.entities).filter(e => 
        e.position && this.bot.entity.position.distanceTo(e.position) < 20
      );
      
      // Format summary
      let summary = '';
      summary += `Location: (${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`;
      summary += ` in ${biome} biome during ${timeOfDay}.`;
      
      const hostileMobs = nearbyEntities.filter(e => this.isHostileEntity(e)).length;
      const passiveMobs = nearbyEntities.filter(e => this.isPassiveEntity(e)).length;
      const players = nearbyEntities.filter(e => e.type === 'player').length - 1; // Exclude self
      
      if (players > 0) {
        summary += ` ${players} other player${players > 1 ? 's' : ''} nearby.`;
      }
      
      summary += ` ${hostileMobs} hostile and ${passiveMobs} passive mobs around.`;
      
      if (this.bot.isRaining) {
        summary += ` It's raining.`;
      }
      
      // Send analysis to chat
      this.bot.chat(summary);
      
      // Additional details if needed
      if (hostileMobs > 0) {
        this.bot.chat(`Caution: Hostile mobs detected nearby!`);
      }
      
      if (timeOfDay === 'night' && !this.isSheltered()) {
        this.bot.chat(`Warning: It's night time and I'm not sheltered.`);
      }
    } catch (error) {
      this.error('Error analyzing environment:', error);
      this.bot.chat('Error analyzing environment.');
    }
  }
  
  /**
   * Analyze the bot's inventory
   */
  analyzeInventory() {
    try {
      const items = this.bot.inventory.items();
      
      if (items.length === 0) {
        this.bot.chat('Inventory is empty.');
        return;
      }
      
      // Group items by type
      const grouped = {};
      items.forEach(item => {
        const name = item.name;
        if (!grouped[name]) {
          grouped[name] = 0;
        }
        grouped[name] += item.count;
      });
      
      // Categorize items
      const tools = [];
      const blocks = [];
      const resources = [];
      const food = [];
      
      Object.entries(grouped).forEach(([name, count]) => {
        if (this.isToolItem(name)) {
          tools.push(`${name} (${count})`);
        } else if (this.isFoodItem(name)) {
          food.push(`${name} (${count})`);
        } else if (this.isBlockItem(name)) {
          blocks.push(`${name} (${count})`);
        } else {
          resources.push(`${name} (${count})`);
        }
      });
      
      // Send analysis to chat
      this.bot.chat(`Inventory contains ${items.length} item stacks:`);
      
      if (tools.length > 0) {
        setTimeout(() => this.bot.chat(`Tools: ${tools.join(', ')}`), 500);
      }
      
      if (food.length > 0) {
        setTimeout(() => this.bot.chat(`Food: ${food.join(', ')}`), 1000);
      }
      
      if (blocks.length > 0) {
        setTimeout(() => this.bot.chat(`Blocks: ${blocks.join(', ')}`), 1500);
      }
      
      if (resources.length > 0) {
        setTimeout(() => this.bot.chat(`Resources: ${resources.join(', ')}`), 2000);
      }
    } catch (error) {
      this.error('Error analyzing inventory:', error);
      this.bot.chat('Error analyzing inventory.');
    }
  }
  
  /**
   * Analyze the current biome
   */
  analyzeBiome() {
    try {
      const biome = this.getCurrentBiome();
      const biomeData = this.mcDataIntegration.getBiomeByName(biome);
      
      if (!biomeData) {
        this.bot.chat(`Current biome: ${biome}. No additional data available.`);
        return;
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
      
      this.bot.chat(analysis);
      
      // Common resources in this biome
      const biomeResources = this.mcDataIntegration.getBiomeResources ?
                            this.mcDataIntegration.getBiomeResources(biome) :
                            this.getBiomeResources(biome);
                            
      if (biomeResources && biomeResources.length) {
        setTimeout(() => {
          this.bot.chat(`Common resources: ${biomeResources.join(', ')}.`);
        }, 500);
      }
    } catch (error) {
      this.error('Error analyzing biome:', error);
      this.bot.chat('Error analyzing biome.');
    }
  }
  
  /**
   * Analyze a specific block
   */
  analyzeBlock(blockName) {
    try {
      // If no specific block is provided, analyze what we're standing on
      if (!blockName) {
        const pos = this.bot.entity.position;
        const blockBelow = this.bot.blockAt(pos.offset(0, -1, 0));
        blockName = blockBelow.name;
      }
      
      const blockData = this.mcDataIntegration.getBlockByName(blockName);
      
      if (!blockData) {
        this.bot.chat(`I don't know about block type: ${blockName}`);
        return;
      }
      
      let analysis = `Block: ${blockData.displayName || blockData.name}. `;
      
      // Add hardness/tool info
      if (typeof blockData.hardness === 'number') {
        analysis += `Hardness: ${blockData.hardness}. `;
        
        // Suggest tool
        const bestTool = this.getBestToolForBlock(blockData);
        if (bestTool) {
          analysis += `Best mined with ${bestTool}. `;
        }
      }
      
      this.bot.chat(analysis);
      
      // Add drops info
      if (blockData.drops && blockData.drops.length) {
        setTimeout(() => {
          const dropNames = blockData.drops.map(d => {
            const item = this.mcDataIntegration.mcData.items[d];
            return item ? (item.displayName || item.name) : `item #${d}`;
          });
          
          this.bot.chat(`Drops: ${dropNames.join(', ')}.`);
        }, 500);
      }
    } catch (error) {
      this.error('Error analyzing block:', error);
      this.bot.chat('Error analyzing block.');
    }
  }
  
  /**
   * Analyze a specific item
   */
  analyzeItem(itemName) {
    try {
      // If no specific item is provided, analyze held item
      if (!itemName) {
        const heldItem = this.bot.inventory.slots[this.bot.inventory.selectedSlot];
        if (!heldItem) {
          this.bot.chat('Not holding any item.');
          return;
        }
        itemName = heldItem.name;
      }
      
      const itemData = this.mcDataIntegration.getItemByName(itemName);
      
      if (!itemData) {
        this.bot.chat(`I don't know about item: ${itemName}`);
        return;
      }
      
      let analysis = `Item: ${itemData.displayName || itemData.name}. `;
      
      // Tool analysis
      if (this.isToolItem(itemName)) {
        analysis += `This is a tool. `;
        
        // Tool speed and durability
        if (typeof itemData.maxDurability === 'number') {
          analysis += `Maximum durability: ${itemData.maxDurability}. `;
        }
      }
      
      // Food analysis
      if (this.isFoodItem(itemName)) {
        analysis += `This is food. `;
        
        if (typeof itemData.foodPoints === 'number') {
          analysis += `Restores ${itemData.foodPoints} hunger points. `;
        }
      }
      
      this.bot.chat(analysis);
      
      // Crafting info
      const recipes = this.mcDataIntegration.getRecipesForItem(itemName);
      if (recipes && recipes.length > 0) {
        setTimeout(() => {
          this.bot.chat(`This item can be crafted.`);
        }, 500);
      }
    } catch (error) {
      this.error('Error analyzing item:', error);
      this.bot.chat('Error analyzing item.');
    }
  }
  
  /**
   * Analyze the current task
   */
  analyzeCurrentTask() {
    if (!this.currentTask) {
      this.bot.chat('No task is currently being executed.');
      return;
    }
    
    const task = this.currentTask;
    const timeRunning = Date.now() - this.lastTaskTime;
    
    let analysis = `Current task: ${task.description || task.type}. `;
    analysis += `Running for ${Math.floor(timeRunning / 1000)} seconds. `;
    
    if (task.progress) {
      analysis += `Progress: ${Math.floor(task.progress * 100)}%. `;
    }
    
    this.bot.chat(analysis);
    
    // Display task details
    let details = '';
    
    switch (task.type) {
      case 'mine':
        details = `Mining ${task.target || 'blocks'}`;
        if (task.count) details += `, need ${task.count} more`;
        break;
      case 'gather':
        details = `Gathering ${task.target || 'resources'}`;
        if (task.count) details += `, need ${task.count} more`;
        break;
      case 'craft':
        details = `Crafting ${task.item}`;
        if (task.count > 1) details += ` x${task.count}`;
        break;
      case 'build':
        details = `Building ${task.structure || 'structure'}`;
        break;
      case 'explore':
        details = `Exploring ${task.target || 'area'}`;
        if (task.distance) details += ` within ${task.distance} blocks`;
        break;
    }
    
    if (details) {
      setTimeout(() => {
        this.bot.chat(details);
      }, 500);
    }
  }
  
  /**
   * Analyze a generic target (try to figure out what it is)
   */
  analyzeGenericTarget(target) {
    // Try in this order: block, item, biome, entity
    const blockData = this.mcDataIntegration.getBlockByName(target);
    if (blockData) {
      this.analyzeBlock(target);
      return;
    }
    
    const itemData = this.mcDataIntegration.getItemByName(target);
    if (itemData) {
      this.analyzeItem(target);
      return;
    }
    
    const biomeData = this.mcDataIntegration.getBiomeByName(target);
    if (biomeData) {
      this.bot.chat(`${biomeData.name} is a biome in Minecraft.`);
      this.analyzeBiome();
      return;
    }
    
    // Try entity
    const entities = Object.values(this.bot.entities).filter(e => 
      e.name && e.name.toLowerCase().includes(target.toLowerCase())
    );
    
    if (entities.length > 0) {
      const entity = entities[0];
      const distance = this.bot.entity.position.distanceTo(entity.position);
      
      this.bot.chat(`Found ${entity.name} at distance of ${Math.floor(distance)} blocks.`);
      return;
    }
    
    this.bot.chat(`I don't know what "${target}" is.`);
  }
  
  /**
   * Get current biome
   */
  getCurrentBiome() {
    try {
      const pos = this.bot.entity.position;
      return this.bot.world.getBiome(pos.x, pos.y, pos.z) || 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }
  
  /**
   * Get common resources for a biome
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
   * Check if entity is hostile
   */
  isHostileEntity(entity) {
    if (!entity || !entity.name) return false;
    
    const hostileMobs = [
      'zombie', 'skeleton', 'creeper', 'spider', 'enderman',
      'witch', 'slime', 'phantom', 'drowned', 'pillager'
    ];
    
    return hostileMobs.some(mob => entity.name.toLowerCase().includes(mob));
  }
  
  /**
   * Check if entity is passive
   */
  isPassiveEntity(entity) {
    if (!entity || !entity.name) return false;
    
    const passiveMobs = [
      'cow', 'pig', 'sheep', 'chicken', 'rabbit', 
      'horse', 'llama', 'villager', 'cat', 'wolf'
    ];
    
    return passiveMobs.some(mob => entity.name.toLowerCase().includes(mob));
  }
  
  /**
   * Check if bot is in a sheltered location
   */
  isSheltered() {
    try {
      const pos = this.bot.entity.position;
      
      // Check for blocks above (simplistic shelter check)
      for (let y = 1; y <= 4; y++) {
        const block = this.bot.blockAt(pos.offset(0, y, 0));
        if (block && block.type !== 0) { // Not air
          return true;
        }
      }
      
      // Check if we're in a "shelter" structure
      // TODO: Implement shelter tracking
      
      return false;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Check if an item is a tool
   */
  isToolItem(name) {
    const toolKeywords = [
      'pickaxe', 'axe', 'shovel', 'sword', 'hoe', 'shears',
      'helmet', 'chestplate', 'leggings', 'boots', 'bow'
    ];
    
    return toolKeywords.some(keyword => name.includes(keyword));
  }
  
  /**
   * Check if an item is food
   */
  isFoodItem(name) {
    const foodKeywords = [
      'apple', 'beef', 'pork', 'mutton', 'chicken', 'rabbit',
      'bread', 'carrot', 'potato', 'beetroot', 'melon', 'berries',
      'cod', 'salmon', 'cookie', 'cake'
    ];
    
    return foodKeywords.some(keyword => name.includes(keyword));
  }
  
  /**
   * Check if an item is a block
   */
  isBlockItem(name) {
    // Common block keywords
    const blockKeywords = [
      'stone', 'dirt', 'grass', 'log', 'planks', 'sand', 'gravel',
      'ore', 'cobblestone', 'brick', 'glass', 'wool'
    ];
    
    return blockKeywords.some(keyword => name.includes(keyword));
  }
  
  /**
   * Make an autonomous decision
   */
  makeAutonomousDecision() {
    if (!this.config.autonomousMode) return;
    
    try {
      // Check if we're still running a task
      if (this.currentTask) {
        const timeRunning = Date.now() - this.lastTaskTime;
        
        // Abort task if it's taking too long
        if (timeRunning > this.config.taskTimeout) {
          this.info(`Task timeout after ${timeRunning}ms: ${this.currentTask.type}`);
          this.currentTask = null;
        } else {
          return; // Still executing a task
        }
      }
      
      // Get next suggested task
      const suggestions = this.getSuggestions();
      
      if (suggestions.length === 0) {
        this.debug('No suggestions available');
        return;
      }
      
      // Select highest priority suggestion
      const task = suggestions[0];
      
      // Execute the task
      this.info(`Autonomous decision: ${task.description}`);
      
      if (this.config.debugMode) {
        // Check if bot.chat is a function before using it
        if (this.bot && typeof this.bot.chat === 'function') {
          this.bot.chat(`I'm going to ${task.description}`);
        } else {
          this.info(`Debug mode chat: I'm going to ${task.description}`);
        }
      }
      
      this.executeTask(task);
    } catch (error) {
      this.error('Error in autonomous decision-making:', error);
    }
  }
  
  /**
   * Get action suggestions based on current state
   */
  getSuggestions() {
    // Let mcDataIntegration suggest a task
    const suggestedTask = this.mcDataIntegration.suggestNextTask();
    
    // Create a prioritized list of suggestions
    const suggestions = [];
    
    if (suggestedTask) {
      suggestions.push({
        ...suggestedTask,
        description: this.getTaskDescription(suggestedTask),
        priority: 10
      });
    }
    
    // Some fallback suggestions
    if (this.getTimeOfDay() === 'night' && !this.isSheltered()) {
      suggestions.push({
        type: 'build',
        structure: 'shelter',
        reason: 'Night time safety',
        description: 'build a shelter for the night',
        priority: 9
      });
    }
    
    if (this.bot.food !== undefined && this.bot.food < 10) {
      suggestions.push({
        type: 'gather',
        target: 'food',
        reason: 'Low on food',
        description: 'find food to eat',
        priority: 8
      });
    }
    
    // Sort by priority
    return suggestions.sort((a, b) => b.priority - a.priority);
  }
  
  /**
   * Get a human-readable description of a task
   */
  getTaskDescription(task) {
    switch (task.type) {
      case 'mine':
        return `mine ${task.target || 'resources'}${task.count ? ` (${task.count})` : ''}`;
      case 'gather':
        return `gather ${task.target || 'resources'}${task.count ? ` (${task.count})` : ''}`;
      case 'craft':
        return `craft ${task.item}${task.count > 1 ? ` x${task.count}` : ''}`;
      case 'build':
        return `build ${task.structure || 'a structure'}`;
      case 'explore':
        return `explore the ${task.target || 'area'}`;
      case 'eat':
        return `eat some ${task.item || 'food'}`;
      case 'hunt':
        return `hunt for ${task.target || 'animals'}`;
      default:
        return task.description || `perform ${task.type} task`;
    }
  }
  
  /**
   * Execute a task
   */
  executeTask(task) {
    this.currentTask = task;
    this.lastTaskTime = Date.now();
    
    // Execute different tasks based on type
    switch (task.type) {
      case 'mine':
        this.executeMiningTask(task);
        break;
      case 'gather':
        this.executeGatheringTask(task);
        break;
      case 'craft':
        this.executeCraftingTask(task);
        break;
      case 'build':
        this.executeBuildingTask(task);
        break;
      case 'explore':
        this.executeExplorationTask(task);
        break;
      case 'eat':
        this.executeEatingTask(task);
        break;
      default:
        // Try to execute using state machine
        this.executeViaStateMachine(task);
    }
  }
  
  /**
   * Execute a mining task
   */
  executeMiningTask(task) {
    // Change to mining state
    this.changeState('mining');
    
    // If we have a target block, use the mine command
    if (task.target) {
      this.sendCommand(`!mine ${task.target} ${task.count || ''}`);
    }
  }
  
  /**
   * Execute a gathering task
   */
  executeGatheringTask(task) {
    // Gathering could be collecting specific resources
    if (task.target) {
      if (task.target === 'wood' || task.target.includes('log')) {
        // Chop trees
        this.changeState('gather');
        this.sendCommand(`!gather wood ${task.count || ''}`);
      } else if (task.target === 'food') {
        // Look for food
        this.changeState('gather');
        this.sendCommand(`!gather food ${task.count || ''}`);
      } else {
        // General gathering
        this.changeState('gather');
        this.sendCommand(`!gather ${task.target} ${task.count || ''}`);
      }
    } else {
      // Default gathering
      this.changeState('gather');
    }
  }
  
  /**
   * Helper function to safely send chat commands
   */
  sendCommand(command) {
    if (!this.bot || typeof this.bot.chat !== 'function') {
      this.warn(`Cannot send command: ${command} - bot.chat is not available`);
      return false;
    }
    
    try {
      this.bot.chat(command);
      return true;
    } catch (error) {
      this.warn(`Error sending command "${command}": ${error.message}`);
      return false;
    }
  }
  
  /**
   * Execute a crafting task
   */
  executeCraftingTask(task) {
    // Change to appropriate state
    this.changeState('craft');
    
    // If we have a specific item to craft
    if (task.item) {
      this.sendCommand(`!craft ${task.item} ${task.count || 1}`);
    }
  }
  
  /**
   * Execute a building task
   */
  executeBuildingTask(task) {
    // Change to building state
    this.changeState('build');
    
    // If we have a specific structure to build
    if (task.structure) {
      this.sendCommand(`!build ${task.structure}`);
    }
  }
  
  /**
   * Execute an exploration task
   */
  executeExplorationTask(task) {
    // Change to exploration state
    this.changeState('explore');
    
    // If we have a specific target to explore
    if (task.target) {
      this.sendCommand(`!explore ${task.target}`);
    }
  }
  
  /**
   * Execute an eating task
   */
  executeEatingTask(task) {
    if (task.item) {
      this.sendCommand(`!eat ${task.item}`);
    } else {
      this.sendCommand(`!eat`);
    }
  }
  
  /**
   * Execute a task by changing the state machine
   */
  executeViaStateMachine(task) {
    // Map task types to states
    const stateMap = {
      'mine': 'mining',
      'gather': 'gather',
      'craft': 'craft',
      'build': 'build',
      'explore': 'explore',
      'follow': 'follow',
      'combat': 'combat'
    };
    
    const state = stateMap[task.type] || task.type;
    
    // Try to change to the corresponding state
    this.changeState(state);
    
    // Also send command if task has more details
    if (task.target) {
      this.sendCommand(`!${task.type} ${task.target}`);
    }
  }
  
  /**
   * Change the bot's state
   */
  changeState(stateName) {
    try {
      // Use bot's change state function if available
      if (typeof this.bot.changeState === 'function') {
        this.bot.changeState(stateName);
        return true;
      }
      
      // Try via state machine
      if (this.bot.stateMachine && typeof this.bot.stateMachine.changeState === 'function') {
        this.bot.stateMachine.changeState(stateName);
        return true;
      }
      
      // Use command interface
      return this.sendCommand(`!state ${stateName}`);
    } catch (error) {
      this.error(`Error changing state to ${stateName}:`, error);
      return false;
    }
  }
  
  /**
   * Handle player collect event
   */
  onPlayerCollect(collector, collected) {
    if (collector.username !== this.bot.username) return;
    
    // Player collected an item
    try {
      const item = collected.metadata[10]; // Item data
      if (item) {
        const itemName = item.itemId;
        
        // Record in mcDataIntegration
        if (this.mcDataIntegration) {
          this.mcDataIntegration.recordItemCollection(itemName, item.itemCount);
        }
        
        // Also update learning
        if (this.learningManager) {
          this.learningManager.recordExperience({
            type: 'item_collection',
            itemId: itemName,
            count: item.itemCount,
            timestamp: Date.now()
          });
        }
      }
    } catch (error) {
      this.debug(`Error in onPlayerCollect: ${error.message}`);
    }
  }
  
  /**
   * Handle digging completed event
   */
  onDiggingCompleted(block) {
    // Record in mcDataIntegration
    if (this.mcDataIntegration) {
      this.mcDataIntegration.updateLearningFromGathering(block.name, 1);
    }
    
    // Update learning
    if (this.learningManager) {
      this.learningManager.recordExperience({
        type: 'block_mined',
        blockName: block.name,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Handle physics tick
   */
  onTick() {
    // Check if any tasks have completed
    this.checkTaskProgress();
    
    // Record current biome
    try {
      const biome = this.getCurrentBiome();
      if (biome !== 'unknown' && this.mcDataIntegration) {
        this.mcDataIntegration.recordBiomeVisit(biome);
      }
    } catch (error) {
      // Ignore errors
    }
  }
  
  /**
   * Handle chat messages
   */
  onChat(username, message) {
    if (username === this.bot.username) return;
    
    // Check for chatCommands
    if (this.chatCommands) {
      // Commands start with !
      if (message.startsWith('!')) {
        const parts = message.substring(1).split(' ');
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);
        
        if (this.chatCommands[command]) {
          this.chatCommands[command](username, args);
        }
      }
    }
  }
  
  /**
   * Handle state changes
   */
  onStateChanged(oldState, newState) {
    // Update learning if available
    if (this.learningManager) {
      this.learningManager.recordExperience({
        type: 'state_change',
        from: oldState.name,
        to: newState.name,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Check if current task has completed
   */
  checkTaskProgress() {
    if (!this.currentTask) return;
    
    // Check based on task type
    const task = this.currentTask;
    
    switch (task.type) {
      case 'mine':
        this.checkMiningProgress(task);
        break;
      case 'gather':
        this.checkGatheringProgress(task);
        break;
      case 'craft':
        this.checkCraftingProgress(task);
        break;
      // Other task types...
    }
  }
  
  /**
   * Check if mining task has completed
   */
  checkMiningProgress(task) {
    if (!task.target || !task.count) return;
    
    // If bot has collected enough items, task is complete
    const targetItems = this.mcDataIntegration.findItemsInInventory(task.target);
    const count = targetItems.reduce((sum, item) => sum + item.count, 0);
    
    task.progress = Math.min(1, count / task.count);
    
    if (count >= task.count) {
      this.info(`Mining task completed: Collected ${count} ${task.target}`);
      this.currentTask = null;
      
      if (this.config.debugMode) {
        this.sendCommand(`I've collected ${count} ${task.target}.`);
      }
    }
  }
  
  /**
   * Check if gathering task has completed
   */
  checkGatheringProgress(task) {
    if (!task.target || !task.count) return;
    
    // If bot has collected enough items, task is complete
    const targetItems = this.mcDataIntegration.findItemsInInventory(task.target);
    const count = targetItems.reduce((sum, item) => sum + item.count, 0);
    
    task.progress = Math.min(1, count / task.count);
    
    if (count >= task.count) {
      this.info(`Gathering task completed: Collected ${count} ${task.target}`);
      this.currentTask = null;
      
      if (this.config.debugMode) {
        this.sendCommand(`I've gathered ${count} ${task.target}.`);
      }
    }
  }
  
  /**
   * Check if crafting task has completed
   */
  checkCraftingProgress(task) {
    if (!task.item || !task.count) return;
    
    // If bot has crafted the item, task is complete
    const targetItems = this.mcDataIntegration.findItemsInInventory(task.item);
    const count = targetItems.reduce((sum, item) => sum + item.count, 0);
    
    if (count >= task.count) {
      this.info(`Crafting task completed: Crafted ${count} ${task.item}`);
      this.currentTask = null;
      
      if (this.config.debugMode) {
        this.sendCommand(`I've crafted ${count} ${task.item}.`);
      }
    }
  }
  
  /**
   * Shutdown the plugin
   */
  async shutdown() {
    this.info('Shutting down Intelligent Decision plugin');
    
    // Stop the decision loop
    if (this.decisionLoopInterval) {
      clearInterval(this.decisionLoopInterval);
      this.decisionLoopInterval = null;
    }
    
    return true;
  }
}

module.exports = IntelligentDecision;