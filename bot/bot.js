/**
 * Main Minecraft Bot Class
 * 
 * This class integrates all Mineflayer plugins and extensions
 * to create a fully autonomous Minecraft bot.
 */

const mineflayer = require('mineflayer');
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const { GoalBlock, GoalNear, GoalXZ, GoalY, GoalFollow } = require('mineflayer-pathfinder').goals;
const { Movements, goals } = require('mineflayer-pathfinder');
const collectBlock = require('mineflayer-collectblock').plugin;
const pvp = require('mineflayer-pvp').plugin;
const armorManager = require('mineflayer-armor-manager');
const toolPlugin = require('mineflayer-tool').plugin;
const minecraftData = require('minecraft-data');
const inventoryViewer = require('mineflayer-web-inventory');
// Try to load prismarine-viewer, but it's optional
let mineflayerViewer;
try {
  const prismarineViewer = require('prismarine-viewer');
  mineflayerViewer = prismarineViewer.mineflayer;
} catch (e) {
  // prismarine-viewer is optional
  mineflayerViewer = null;
}
const { BotStateMachine, StateTransition, NestedStateMachine } = require('mineflayer-statemachine');
const Vec3 = require('vec3');

// Import command system
const CommandSystem = require('./commands');
const logger = require('./logger');
const constants = require('./constants');

// Import plugin system
const PluginManager = require('../plugins/pluginManager');

// Import behaviors
const MiningBehavior = require('../behaviors/mining');
const CombatBehavior = require('../behaviors/combat');
const SurvivalBehavior = require('../behaviors/survival');
const CraftingBehavior = require('../behaviors/crafting');
const BuildingBehavior = require('../behaviors/building');
const ExplorationBehavior = require('../behaviors/exploration');

// Import states
const IdleState = require('../states/idleState');
const MiningState = require('../states/miningState');
const CombatState = require('../states/combatState');
const GatherState = require('../states/gatherState');
const CraftState = require('../states/craftState');
const FollowState = require('../states/followState');
const BuildState = require('../states/buildState');
const ExploreState = require('../states/exploreState');
const FarmState = require('../states/farmState');
const FishState = require('../states/fishState');
const TradeState = require('../states/tradeState');
const EnchantState = require('../states/enchantState');
const DefenseState = require('../states/defenseState');

// Import utilities
const InventoryManager = require('../utils/inventory');
const PathfindingManager = require('../utils/pathfinding');
const BlockUtils = require('../utils/blockUtils');

class MinecraftBot {
  constructor(config) {
    this.config = config;
    this.bot = null;
    this.mcData = null;
    this.stateMachine = null;
    this.commandSystem = null;
    this.reconnectAttempts = 0;
    this.isReconnecting = false;
    
    // Plugin system
    this.pluginManager = null;
    
    // Behavior managers
    this.miningBehavior = null;
    this.combatBehavior = null;
    this.survivalBehavior = null;
    this.craftingBehavior = null;
    this.buildingBehavior = null;
    this.explorationBehavior = null;
    
    // Utility managers
    this.inventoryManager = null;
    this.pathfindingManager = null;
    this.blockUtils = null;
    
    // State tracking
    this.initialized = false;
    this.owner = null;
    this.target = null;
  }
  
  /**
   * Initialize the bot and all extensions
   */
  async initialize() {
    try {
      // Create the Mineflayer bot
      this.bot = this.createBot();
      logger.info(`Bot created with username: ${this.config.credentials.username}`);
      
      // Set up event handlers
      this.setupEvents();
      
      // Wait for bot to spawn before continuing initialization
      await new Promise((resolve) => {
        if (this.bot.entity) {
          resolve();
        } else {
          this.bot.once('spawn', resolve);
        }
      });
      
      // Initialize extensions and behaviors after bot has spawned
      await this.initializeExtensions(); // Wait for async initialization
      this.initializeBehaviors();
      this.initializeStateMachine();
      this.initializeCommands();
      
      // Initialize plugin system if enabled
      if (this.config.plugins && this.config.plugins.enabled) {
        await this.initializePlugins();
      }
      
      // Mark as initialized
      this.initialized = true;
      logger.info('Bot initialization complete!');
      this.bot.chat('Bot initialized and ready to serve!');
      
      return this;
    } catch (error) {
      logger.error('Failed to initialize bot:', error);
      throw error;
    }
  }
  
  /**
   * Create the Mineflayer bot instance
   */
  createBot() {
    const botOptions = {
      host: this.config.server.host,
      port: this.config.server.port,
      username: this.config.credentials.username,
      password: this.config.credentials.password,
      auth: this.config.server.auth,
      version: this.config.server.version,
      logErrors: true,
      hideErrors: false,
      keepAlive: true,
      checkTimeoutInterval: 30000,
      loadInternalPlugins: true,
      respawn: true,
    };
    
    return mineflayer.createBot(botOptions);
  }
  
  /**
   * Set up event handlers for the bot
   */
  setupEvents() {
    // Core events
    this.bot.on('spawn', () => this.handleSpawn());
    this.bot.on('error', (err) => this.handleError(err));
    this.bot.on('end', () => this.handleDisconnect());
    this.bot.on('kicked', (reason) => this.handleKicked(reason));
    
    // Chat events
    this.bot.on('chat', (username, message) => this.handleChat(username, message));
    this.bot.on('whisper', (username, message) => this.handleWhisper(username, message));
    
    // Game events
    this.bot.on('health', () => this.handleHealthChange());
    this.bot.on('entitySwingArm', (entity) => this.handleEntitySwingArm(entity));
    this.bot.on('death', () => this.handleDeath());
    this.bot.on('playerCollect', (collector, collected) => this.handlePlayerCollect(collector, collected));
    this.bot.on('entityHurt', (entity) => this.handleEntityHurt(entity));
    this.bot.on('entityGone', (entity) => this.handleEntityGone(entity));
    
    // Debug events if debug logging is enabled
    if (this.config.logging.level === 'debug') {
      this.bot.on('path_update', (r) => {
        const path = r.path;
        const status = r.status;
        logger.debug(`Path update: ${status}, path length: ${path.length}`);
      });
      
      this.bot.on('goal_reached', (goal) => {
        logger.debug('Goal reached!');
      });
      
      this.bot.on('blockUpdate', (oldBlock, newBlock) => {
        if (oldBlock && newBlock && oldBlock.type !== newBlock.type) {
          logger.debug(`Block updated from ${oldBlock.name} to ${newBlock.name} at ${newBlock.position}`);
        }
      });
    }
  }
  
  /**
   * Initialize all Mineflayer extensions
   */
  async initializeExtensions() {
    try {
      // Get minecraft data for the specific version
      this.mcData = minecraftData(this.bot.version);
      
      // Register plugins
      this.bot.loadPlugin(pathfinder);
      this.bot.loadPlugin(collectBlock);
      this.bot.loadPlugin(pvp);
      this.bot.loadPlugin(armorManager);
      this.bot.loadPlugin(toolPlugin);
      
      // Load the autoeat plugin (ES Module) dynamically
      try {
        const autoeatModule = await import('mineflayer-auto-eat');
        // Check if autoeatModule and autoeatModule.default exist
        if (autoeatModule && autoeatModule.default && typeof autoeatModule.default.plugin === 'function') {
          const autoeat = autoeatModule.default.plugin;
          this.bot.loadPlugin(autoeat);
          
          // Configure auto-eat after loading it
          if (this.config.autoEat.enabled && this.bot.autoEat) {
            this.bot.autoEat.options = {
              priority: this.config.autoEat.priority,
              startAt: this.config.autoEat.startAt,
              bannedFood: this.config.autoEat.bannedFood,
            };
          }
        } else {
          logger.warn('mineflayer-auto-eat plugin loaded but has an unexpected structure');
        }
      } catch (autoeatError) {
        logger.error('Failed to load mineflayer-auto-eat plugin:', autoeatError);
      }
      
      // Configure pathfinder
      const movements = new Movements(this.bot, this.mcData);
      movements.allowSprinting = true;
      movements.allowParkour = true;
      movements.canDig = true;
      movements.maxDropDown = this.config.movement.avoidFallDistance;
      
      this.bot.pathfinder.setMovements(movements);
      
      // Set up prismarine-viewer if enabled
      if (this.config.viewer.enabled) {
        this.initializeViewer();
      }
      
      // Set up web inventory if enabled
      if (this.config.webInventory.enabled) {
        inventoryViewer(this.bot, { port: this.config.webInventory.port });
        logger.info(`Web inventory server started on port ${this.config.webInventory.port}`);
      }
      
      logger.info('All extensions initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize extensions:', error);
      throw error;
    }
  }
  
  /**
   * Initialize prismarine-viewer
   */
  initializeViewer() {
    try {
      // Check if mineflayerViewer is available - we might not have loaded it
      if (!mineflayerViewer) {
        logger.warn('Prismarine-viewer module not available, viewer will not be initialized.');
        logger.warn('To use the viewer, install prismarine-viewer with: npm install prismarine-viewer');
        return;
      }
      
      // Check if canvas is available - it's required by prismarine-viewer
      try {
        require('canvas');
      } catch (e) {
        logger.warn('Canvas package not available, prismarine-viewer will not be initialized.');
        logger.warn('To use the viewer, install canvas with: npm install canvas');
        return;
      }
      
      // If we got here, both prismarine-viewer and canvas are available
      mineflayerViewer(this.bot, { 
        port: this.config.viewer.port, 
        firstPerson: this.config.viewer.firstPerson,
        host: '0.0.0.0'
      });
      logger.info(`Prismarine viewer started on port ${this.config.viewer.port}`);
    } catch (error) {
      logger.error('Failed to initialize prismarine viewer:', error);
    }
  }
  
  /**
   * Initialize behavior managers
   */
  initializeBehaviors() {
    try {
      // Initialize utility managers first
      this.inventoryManager = new InventoryManager(this.bot, this.mcData, this.config);
      this.pathfindingManager = new PathfindingManager(this.bot, this.mcData, this.config);
      this.blockUtils = new BlockUtils(this.bot, this.mcData, this.config);
      
      // Initialize PVP options manually to fix potential issues
      if (!this.bot.pvp) {
        logger.warn("PVP plugin not available, creating placeholder");
        this.bot.pvp = {
          options: {
            attackRange: this.config.combat.attackRange || 3,
            followRange: (this.config.combat.attackRange || 3) + 1,
            viewDistance: 16,
            keepDistance: false,
            sprint: true
          },
          attack: function() { logger.warn("PVP attack not available"); },
          stop: function() { logger.warn("PVP stop not available"); }
        };
      } else if (!this.bot.pvp.options) {
        logger.warn("PVP options not available, creating placeholder");
        this.bot.pvp.options = {
          attackRange: this.config.combat.attackRange || 3,
          followRange: (this.config.combat.attackRange || 3) + 1,
          viewDistance: 16,
          keepDistance: false,
          sprint: true
        };
      }
      
      // Initialize behavior managers
      this.miningBehavior = new MiningBehavior(this.bot, this.mcData, this.config, this);
      this.survivalBehavior = new SurvivalBehavior(this.bot, this.mcData, this.config, this);
      this.craftingBehavior = new CraftingBehavior(this.bot, this.mcData, this.config, this);
      this.buildingBehavior = new BuildingBehavior(this.bot, this.mcData, this.config, this);
      this.explorationBehavior = new ExplorationBehavior(this.bot, this.mcData, this.config, this);
      
      // Initialize combat behavior last to ensure PVP options are properly set
      this.combatBehavior = new CombatBehavior(this.bot, this.mcData, this.config, this);
      
      logger.info('All behavior managers initialized');
    } catch (error) {
      logger.error(`Error initializing behaviors: ${error.message}`);
      // Continue without behaviors if there's an error
      logger.warn('Some behaviors may not be available');
    }
  }
  
  /**
   * Initialize the state machine for complex behaviors
   */
  initializeStateMachine() {
    try {
      // Create basic states
      const idleState = new IdleState(this.bot, this);
      const miningState = new MiningState(this.bot, this);
      const combatState = new CombatState(this.bot, this);
      const gatherState = new GatherState(this.bot, this);
      const craftState = new CraftState(this.bot, this);
      const followState = new FollowState(this.bot, this);
      const buildState = new BuildState(this.bot, this);
      const exploreState = new ExploreState(this.bot, this);
      
      // Create advanced states
      const farmState = new FarmState(this.bot, this);
      const fishState = new FishState(this.bot, this);
      const tradeState = new TradeState(this.bot, this);
      const enchantState = new EnchantState(this.bot, this);
      const defenseState = new DefenseState(this.bot, this);
      
      // Create state array for the state machine
      const states = [
        // Basic states
        idleState,
        miningState,
        combatState,
        gatherState,
        craftState,
        followState,
        buildState,
        exploreState,
        
        // Advanced states
        farmState,
        fishState,
        tradeState,
        enchantState,
        defenseState
      ];
      
      // Skip the complex state machine for now to avoid initialization issues
      logger.info('Using simple state machine implementation');
      
      // Create a simple state manager as a fallback
      this.stateMachine = {
        states: states,
        currentState: null,
        
        // Simple state push method
        pushState: (state) => {
          logger.info(`Changing state to: ${state.name}`);
          
          // Exit current state if one exists
          if (this.stateMachine.currentState) {
            if (typeof this.stateMachine.currentState.onStateExited === 'function') {
              this.stateMachine.currentState.onStateExited();
            }
          }
          
          // Set new state
          this.stateMachine.currentState = state;
          
          // Enter new state
          if (typeof state.onStateEntered === 'function') {
            state.onStateEntered();
          }
        },
        
        // Simple state pop method
        popState: () => {
          if (this.stateMachine.currentState) {
            if (typeof this.stateMachine.currentState.onStateExited === 'function') {
              this.stateMachine.currentState.onStateExited();
            }
            this.stateMachine.currentState = null;
          }
        }
      };
      
      // Start with the default state
      const defaultState = states.find(s => s.name === this.config.stateMachine.defaultState);
      if (defaultState) {
        this.stateMachine.pushState(defaultState);
        logger.info(`State machine initialized with default state: ${defaultState.name}`);
      } else {
        logger.info(`State machine initialized with idle state`);
        this.stateMachine.pushState(idleState);
      }
      
      return true;
    } catch (error) {
      logger.error(`Failed to initialize state machine: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Helper to get state object by name
   */
  getStateObjectByName(name, stateObjects) {
    return stateObjects[name] || null;
  }
  
  /**
   * Initialize the command system
   */
  initializeCommands() {
    this.commandSystem = new CommandSystem(this.bot, this.config, this);
    logger.info('Command system initialized');
  }
  
  /**
   * Initialize the plugin system
   */
  async initializePlugins() {
    try {
      logger.info('Initializing plugin system');
      
      // Create the plugin manager
      this.pluginManager = new PluginManager(this, this.config);
      
      // Initialize the plugin manager
      await this.pluginManager.initialize();
      
      // Store a reference to the bot in the plugin manager
      this.pluginManager.bot = this;
      
      // Set bot owner for permission checking
      if (this.config.chat.allowedUsers && this.config.chat.allowedUsers.length > 0) {
        this.owner = this.config.chat.allowedUsers[0];
        logger.info(`Bot owner set to: ${this.owner}`);
      }
      
      logger.info(`Plugin system initialized with ${this.pluginManager.getEnabledPlugins().length} active plugins`);
      return true;
    } catch (error) {
      logger.error('Failed to initialize plugin system:', error);
      return false;
    }
  }
  
  /**
   * Handle bot spawn event
   */
  handleSpawn() {
    const position = this.bot.entity?.position ? this.bot.entity.position.toString() : 'unknown position';
    logger.info(`Bot spawned in world at ${position}`);
    
    // Reset reconnection counter on successful spawn
    this.reconnectAttempts = 0;
    this.isReconnecting = false;
    
    // Update the movements when spawned to ensure we have the latest bot capabilities
    if (this.bot.pathfinder && this.mcData) {
      try {
        const movements = new Movements(this.bot, this.mcData);
        movements.allowSprinting = true;
        movements.allowParkour = true;
        movements.canDig = true;
        this.bot.pathfinder.setMovements(movements);
      } catch (error) {
        logger.warn(`Failed to update movements: ${error.message}`);
      }
    }
  }
  
  /**
   * Handle errors
   */
  handleError(error) {
    logger.error(`Bot encountered an error: ${error.message}`);
    logger.error(error.stack);
  }
  
  /**
   * Handle disconnection from the server
   */
  handleDisconnect() {
    logger.warn('Bot disconnected from the server');
    
    if (this.config.autoReconnect && !this.isReconnecting) {
      this.attemptReconnect();
    }
  }
  
  /**
   * Handle being kicked from the server
   */
  handleKicked(reason) {
    logger.warn(`Bot was kicked from the server: ${reason}`);
    
    if (this.config.autoReconnect && !this.isReconnecting) {
      this.attemptReconnect();
    }
  }
  
  /**
   * Attempt to reconnect to the server
   */
  attemptReconnect() {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      logger.error(`Maximum reconnection attempts (${this.config.maxReconnectAttempts}) reached. Giving up.`);
      return;
    }
    
    this.isReconnecting = true;
    this.reconnectAttempts++;
    
    const delay = this.config.reconnectDelay;
    logger.info(`Attempting to reconnect in ${delay / 1000} seconds... (Attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`);
    
    setTimeout(() => {
      logger.info('Reconnecting now...');
      this.initialize().catch(error => {
        logger.error('Failed to reconnect:', error);
        this.attemptReconnect();
      });
    }, delay);
  }
  
  /**
   * Handle chat messages
   */
  handleChat(username, message) {
    // Ignore our own messages
    if (username === this.bot.username) return;
    
    // Log chat if enabled
    if (this.config.chat.logChat) {
      logger.info(`<${username}> ${message}`);
    }
    
    // Check if this is a command
    if (message.startsWith(this.config.chat.commandPrefix)) {
      this.handleCommand(username, message);
      return;
    }
    
    // Check if we should set this player as owner
    if (message.toLowerCase().includes(`${this.bot.username.toLowerCase()} follow me`)) {
      this.owner = username;
      this.bot.chat(`I will follow you, ${username}!`);
      
      // Change state to follow
      if (this.stateMachine) {
        const followState = this.stateMachine.states.find(state => state.name === 'follow');
        if (followState) {
          this.stateMachine.pushState(followState);
        }
      }
    }
    
    // Respond to all chat if configured to do so
    if (this.config.chat.respondToAll) {
      if (message.toLowerCase().includes(this.bot.username.toLowerCase())) {
        this.bot.chat(`I'm here, ${username}! Use ${this.config.chat.commandPrefix}help to see my commands.`);
      }
    }
  }
  
  /**
   * Handle whispered messages
   */
  handleWhisper(username, message) {
    // Log whispers
    logger.info(`[Whisper] <${username}> ${message}`);
    
    // Always handle commands from whispers
    if (message.startsWith(this.config.chat.commandPrefix)) {
      this.handleCommand(username, message);
      return;
    }
    
    // Respond to whispers if configured to do so
    if (this.config.chat.respondToWhispers) {
      this.bot.whisper(username, `Use ${this.config.chat.commandPrefix}help to see my commands.`);
    }
  }
  
  /**
   * Process commands from chat or whispers
   */
  handleCommand(username, message) {
    // Only process commands from allowed users if the list is defined
    if (this.config.chat.allowedUsers.length > 0 && 
        !this.config.chat.allowedUsers.includes(username)) {
      this.bot.whisper(username, "Sorry, you don't have permission to command me.");
      return;
    }
    
    // Extract command and args
    const parts = message.slice(this.config.chat.commandPrefix.length).split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);
    
    // Pass to command system
    if (this.commandSystem) {
      this.commandSystem.executeCommand(username, command, args);
    }
  }
  
  /**
   * Handle health change event
   */
  handleHealthChange() {
    const health = this.bot.health;
    const food = this.bot.food;
    
    // Log health and food changes
    logger.debug(`Health: ${health}, Food: ${food}`);
    
    // Enable auto-eat if food is low and autoEat plugin is available
    if (food <= this.config.autoEat.startAt && this.config.autoEat.enabled && this.bot.autoEat) {
      this.bot.autoEat.enable();
    }
    
    // Check if health is critically low
    if (health <= this.config.combat.fleeHealthThreshold) {
      // Run away from combat if in danger
      if (this.stateMachine && this.combatBehavior) {
        this.combatBehavior.flee();
      }
    }
  }
  
  /**
   * Handle entity swinging arm (potential attacker)
   */
  handleEntitySwingArm(entity) {
    // Ignore non-mobs or empty entities
    if (!entity || entity.type !== 'mob' || !entity.position) return;
    // Ignore if bot entity doesn't exist yet
    if (!this.bot.entity || !this.bot.entity.position) return;
    
    try {
      // Check if entity is too close and potentially hostile
      const distance = entity.position.distanceTo(this.bot.entity.position);
      if (this.config.combat.defendOwner && distance < this.config.combat.attackRange) {
        if (this.combatBehavior) {
          this.combatBehavior.evaluateThreat(entity);
        }
      }
    } catch (error) {
      logger.warn(`Error in handleEntitySwingArm: ${error.message}`);
    }
  }
  
  /**
   * Handle bot death
   */
  handleDeath() {
    logger.warn(`Bot died! Last position: ${this.bot.entity.position}`);
    
    // Reset state machine to idle on death
    if (this.stateMachine) {
      const idleState = this.stateMachine.states.find(state => state.name === 'idle');
      if (idleState) {
        this.stateMachine.popState();
        this.stateMachine.pushState(idleState);
      }
    }
    
    // Bot will automatically respawn as we set respawn: true in bot options
  }
  
  /**
   * Handle player collecting items
   */
  handlePlayerCollect(collector, collected) {
    if (collector.username === this.bot.username) {
      logger.debug(`Collected item: ${collected.name || 'unknown item'}`);
    }
  }
  
  /**
   * Handle entity being hurt
   */
  handleEntityHurt(entity) {
    // If the owner is hurt and within range, protect them
    if (this.owner && entity.username === this.owner && 
        this.config.combat.defendOwner) {
      
      if (this.combatBehavior) {
        this.combatBehavior.defendOwner();
      }
    }
  }
  
  /**
   * Handle entity disappearing
   */
  handleEntityGone(entity) {
    // If we were targeting this entity, clear the target
    if (this.target && entity.id === this.target.id) {
      this.target = null;
    }
  }
  
  /**
   * Get the current state of the bot
   */
  getState() {
    if (!this.stateMachine) return 'uninitialized';
    
    const activeState = this.stateMachine.currentState;
    return activeState ? activeState.name : 'unknown';
  }
  
  /**
   * Change the bot's state
   */
  changeState(stateName) {
    if (!this.stateMachine) return false;
    
    const targetState = this.stateMachine.states.find(state => state.name === stateName);
    if (targetState) {
      this.stateMachine.popState();
      this.stateMachine.pushState(targetState);
      logger.info(`Changed state to: ${stateName}`);
      return true;
    }
    
    logger.warn(`Failed to change state: ${stateName} not found`);
    return false;
  }
}

module.exports = MinecraftBot;
