/**
 * Learning Behavior Plugin
 * 
 * This plugin implements learning algorithms to improve the bot's decision-making
 * capabilities through experience and feedback.
 */

const BasePlugin = require('../basePlugin');
const LearningManager = require('../../utils/learningManager');
const logger = require('../../bot/logger');

class LearningBehavior extends BasePlugin {
  constructor(bot, config, pluginManager) {
    super(bot, config, pluginManager);
    
    this.name = 'LearningBehavior';
    this.version = '1.0.0';
    this.description = 'Implements learning algorithms for improved decision-making';
    this.author = 'Replit AI';
    this.dependencies = []; // Remove CommandHandler dependency to avoid initialization issues
    
    this.learningManager = null;
    
    // State tracking
    this.lastState = null;
    this.lastAction = null;
    this.actionStartTime = null;
    this.recordingStats = {};
    this.decisionsMade = 0;
    
    // Metrics
    this.miningSuccesses = 0;
    this.miningFailures = 0;
    this.exploreDiscoveries = 0;
    this.combatWins = 0;
    this.combatLosses = 0;
    this.gatherSuccesses = 0;
    
    // Default config
    this.defaultConfig = {
      enabled: true,
      learningEnabled: true,
      learningRate: 0.1,
      explorationRate: 0.1,
      autoDecide: true,
      decisionInterval: 60000, // 1 minute
      logStats: true,
      statsInterval: 300000, // 5 minutes
      analyzePerformance: true,
      persistData: true
    };
  }

  /**
   * Initialize the plugin
   */
  async initialize() {
    this.info('Initializing Learning Behavior plugin');
    
    // Merge default config with provided config
    this.config = {
      ...this.defaultConfig,
      ...this.config
    };
    
    // Initialize learning manager
    this.learningManager = new LearningManager({
      dataFileName: 'botLearning.json',
      learningRate: this.config.learningRate,
      explorationRate: this.config.explorationRate,
      adjustDifficulty: this.config.analyzePerformance,
      targetSuccessRate: 0.7
    });
    
    // Register the available states and actions
    this.registerStatesAndActions();
    
    // Register event handlers
    this.registerEventHandlers();
    
    // Register commands
    this.registerCommands();
    
    // Start periodic tasks
    this.startPeriodicTasks();
    
    this.isEnabled = true;
    this.info('Learning Behavior plugin initialized');
    return true;
  }

  /**
   * Register states and actions for the learning system
   */
  registerStatesAndActions() {
    // All possible states from the state machine
    const states = [
      'idle',
      'mining',
      'combat',
      'gather',
      'craft',
      'follow',
      'build',
      'explore'
    ];
    
    // Actions the bot can take in various states
    const actions = [
      'mine_stone',
      'mine_ores',
      'mine_vein',
      'explore_area',
      'explore_caves',
      'gather_wood',
      'gather_food',
      'craft_tools',
      'craft_items',
      'attack_mobs',
      'attack_players',
      'defend_self',
      'flee_danger',
      'build_shelter',
      'build_structure',
      'follow_player',
      'idle_scan'
    ];
    
    // Register with learning manager
    this.learningManager.registerStates(states);
    this.learningManager.registerActions(actions);
    
    // Set valid actions for each state
    this.learningManager.setStateActions('idle', [
      'explore_area',
      'mine_stone',
      'gather_wood',
      'gather_food',
      'craft_tools',
      'idle_scan'
    ]);
    
    this.learningManager.setStateActions('mining', [
      'mine_stone',
      'mine_ores',
      'mine_vein',
      'explore_caves',
      'defend_self',
      'flee_danger'
    ]);
    
    this.learningManager.setStateActions('combat', [
      'attack_mobs',
      'attack_players',
      'defend_self',
      'flee_danger'
    ]);
    
    this.learningManager.setStateActions('gather', [
      'gather_wood',
      'gather_food',
      'explore_area',
      'defend_self'
    ]);
    
    this.learningManager.setStateActions('craft', [
      'craft_tools',
      'craft_items'
    ]);
    
    this.learningManager.setStateActions('follow', [
      'follow_player',
      'defend_self'
    ]);
    
    this.learningManager.setStateActions('build', [
      'build_shelter',
      'build_structure',
      'gather_wood'
    ]);
    
    this.learningManager.setStateActions('explore', [
      'explore_area',
      'explore_caves',
      'mine_ores',
      'gather_wood',
      'gather_food',
      'defend_self'
    ]);
    
    this.info(`Registered ${states.length} states and ${actions.length} actions`);
  }

  /**
   * Register event handlers
   */
  registerEventHandlers() {
    // Handle state changes
    this.registerEvent(this.bot, 'changeState', this.onStateChanged.bind(this));
    
    // Handle mining events
    this.registerEvent(this.bot, 'blockBreak', this.onBlockBreak.bind(this));
    
    // Handle combat events
    this.registerEvent(this.bot, 'entityDead', this.onEntityDead.bind(this));
    this.registerEvent(this.bot, 'death', this.onBotDeath.bind(this));
    
    // Handle exploration events
    this.registerEvent(this.bot, 'newChunks', this.onNewChunks.bind(this));
    
    // Handle general events
    this.registerEvent(this.bot, 'health', this.onHealthChanged.bind(this));
    this.registerEvent(this.bot, 'physicsTick', this.onTick.bind(this));
    
    this.info('Registered event handlers');
  }

  /**
   * Register plugin commands
   */
  registerCommands() {
    try {
      // Get the command handler plugin
      const commandHandler = this.pluginManager.getPlugin('commandHandler');
      if (!commandHandler) {
        this.warn('CommandHandler plugin not found (as commandHandler), trying with uppercase name');
        // Try with uppercase name
        const commandHandlerAlt = this.pluginManager.getPlugin('CommandHandler');
        if (!commandHandlerAlt) {
          this.warn('CommandHandler plugin not found with any casing, cannot register commands');
          return;
        }
        
        // Register commands with the alternate casing
        commandHandlerAlt.registerCommand('learn', this.handleLearnCommand.bind(this), 'Manage bot learning', ['learning']);
        this.info('Registered commands with alternate casing plugin');
        return;
      }
      
      // Register commands
      commandHandler.registerCommand('learn', this.handleLearnCommand.bind(this), 'Manage bot learning', ['learning']);
      
      this.info('Registered commands');
    } catch (error) {
      this.error('Error registering commands:', error);
    }
  }

  /**
   * Start periodic tasks
   */
  startPeriodicTasks() {
    // Periodically log learning statistics
    if (this.config.logStats) {
      this.statsTimer = setInterval(() => {
        this.logLearningStats();
      }, this.config.statsInterval);
    }
    
    // Periodically make autonomous decisions if enabled
    if (this.config.autoDecide) {
      this.decisionTimer = setInterval(() => {
        this.makeAutonomousDecision();
      }, this.config.decisionInterval);
    }
  }

  /**
   * Handle learning commands
   */
  handleLearnCommand(username, args) {
    if (!args || args.length === 0) {
      return this.showLearningHelp(username);
    }
    
    const subCommand = args[0].toLowerCase();
    
    switch (subCommand) {
      case 'status':
        return this.showLearningStatus(username);
      case 'enable':
        this.config.learningEnabled = true;
        this.bot.chat(`Learning is now enabled.`);
        return true;
      case 'disable':
        this.config.learningEnabled = false;
        this.bot.chat(`Learning is now disabled.`);
        return true;
      case 'reset':
        this.learningManager.resetLearning();
        this.bot.chat(`Learning data has been reset.`);
        return true;
      case 'stats':
        this.logLearningStats(true);
        return true;
      case 'decide':
        const decision = this.makeAutonomousDecision();
        this.bot.chat(`Decision: ${decision}`);
        return true;
      default:
        return this.showLearningHelp(username);
    }
  }

  /**
   * Show help for learn command
   */
  showLearningHelp(username) {
    this.bot.chat(`Learning commands: status, enable, disable, reset, stats, decide`);
    return true;
  }

  /**
   * Show learning status
   */
  showLearningStatus(username) {
    const successRate = this.learningManager.getSuccessRate();
    
    this.bot.chat(
      `Learning: ${this.config.learningEnabled ? 'enabled' : 'disabled'}, ` +
      `Exploration rate: ${this.learningManager.learningParams.explorationRate.toFixed(2)}, ` +
      `Success rate: ${(successRate * 100).toFixed(0)}%, ` +
      `Decisions: ${this.decisionsMade}`
    );
    
    return true;
  }

  /**
   * Log learning statistics
   */
  logLearningStats(toChat = false) {
    // Get current learning state
    const successRate = this.learningManager.getSuccessRate();
    const currentState = this.bot.getBotManager?.stateMachine?.currentState?.name || 'unknown';
    
    // Compile statistics
    const stats = {
      exploration: this.learningManager.learningParams.explorationRate.toFixed(2),
      successRate: (successRate * 100).toFixed(0) + '%',
      decisions: this.decisionsMade,
      currentState: currentState,
      mining: `${this.miningSuccesses}/${this.miningSuccesses + this.miningFailures}`,
      combat: `${this.combatWins}/${this.combatWins + this.combatLosses}`,
      exploration: this.exploreDiscoveries,
      gathering: this.gatherSuccesses
    };
    
    // Log to console
    this.info('Learning statistics:', stats);
    
    // Send to chat if requested
    if (toChat) {
      this.bot.chat(
        `Learning stats - Success: ${stats.successRate}, ` +
        `Mining: ${stats.mining}, Combat: ${stats.combat}, ` +
        `Explore: ${stats.exploration}, Gather: ${stats.gathering}`
      );
    }
  }

  /**
   * Make an autonomous decision based on learning
   */
  makeAutonomousDecision() {
    if (!this.config.learningEnabled) {
      return 'Learning disabled';
    }
    
    // Get current state
    let currentState = 'idle';
    
    // Different ways the bot might store its current state
    if (this.bot.getBotManager?.stateMachine?.currentState?.name) {
      currentState = this.bot.getBotManager.stateMachine.currentState.name;
    } else if (this.bot.stateMachine?.currentState?.name) {
      currentState = this.bot.stateMachine.currentState.name;
    } else if (this.bot.currentState?.name) {
      currentState = this.bot.currentState.name;
    } else {
      // Try to get it from the API status as last resort
      try {
        const statusCmd = `curl -s http://localhost:5000/api/status`;
        const result = require('child_process').execSync(statusCmd).toString();
        const status = JSON.parse(result);
        if (status && status.currentState) {
          currentState = status.currentState;
        }
      } catch (error) {
        this.warn('Could not determine current state from any source');
      }
    }
    
    // See if we should change state
    if (Math.random() < 0.3) { // 30% chance to consider state change
      const nextState = this.learningManager.selectNextState();
      
      if (nextState && nextState !== currentState) {
        this.info(`Autonomous decision: change state from ${currentState} to ${nextState}`);
        this.lastAction = `change_to_${nextState}`;
        this.actionStartTime = Date.now();
        
        // Try different ways to change state
        try {
          // Method 1: Use executeCommand which should be the most reliable
          if (typeof this.bot.executeCommand === 'function') {
            this.bot.executeCommand(`state ${nextState}`);
            this.decisionsMade++;
            return `Change state to ${nextState} via command`;
          }
          
          // Method 2: Use getBotManager().changeState
          else if (this.bot.getBotManager && typeof this.bot.getBotManager().changeState === 'function') {
            this.bot.getBotManager().changeState(nextState);
            this.decisionsMade++;
            return `Change state to ${nextState} via botManager`;
          }
          
          // Method 3: Use direct changeState method
          else if (typeof this.bot.changeState === 'function') {
            this.bot.changeState(nextState);
            this.decisionsMade++;
            return `Change state to ${nextState} via direct method`;
          }
          
          // Fallback: Use API command via curl
          else {
            const cmd = `curl -s -X POST -H "Content-Type: application/json" -d '{"command":"state ${nextState}"}' http://localhost:5000/api/command`;
            require('child_process').execSync(cmd);
            this.decisionsMade++;
            return `Change state to ${nextState} via API`;
          }
        } catch (error) {
          this.error(`Failed to change state to ${nextState}:`, error);
          return `Failed to change state: ${error.message}`;
        }
      }
    }
    
    // Select best action for current state
    const action = this.learningManager.selectAction(currentState);
    
    if (action) {
      this.info(`Autonomous decision: perform action ${action} in state ${currentState}`);
      this.lastState = currentState;
      this.lastAction = action;
      this.actionStartTime = Date.now();
      
      // Execute action based on what it is
      this.executeAction(action, currentState);
      
      this.decisionsMade++;
      return `Perform ${action} in state ${currentState}`;
    }
    
    return 'No decision made';
  }

  /**
   * Execute a specific action
   */
  executeAction(action, state) {
    // Direct the bot to perform the selected action
    // This will depend on the specific actions and bot implementation
    try {
      switch (action) {
        case 'mine_stone':
          if (this.bot.miningBehavior && typeof this.bot.miningBehavior.mineBlock === 'function') {
            this.info("Using mining behavior to mine stone");
            this.bot.miningBehavior.mineBlock('stone');
          } else {
            this.info("Queueing stone mining command");
            this.bot.chat("I'll look for stone to mine.");
            this.queueCommand('mine stone');
          }
          break;
          
        case 'mine_ores':
          if (this.bot.miningBehavior && typeof this.bot.miningBehavior.findBlocksByCategory === 'function') {
            this.info("Using mining behavior to find ores");
            this.bot.miningBehavior.findBlocksByCategory('ores');
          } else {
            this.info("Queueing ore mining command");
            this.bot.chat("I'll look for valuable ores.");
            this.queueCommand('mine ore');
          }
          break;
          
        case 'explore_area':
          if (this.bot.explorationBehavior && typeof this.bot.explorationBehavior.startExploration === 'function') {
            this.info("Using exploration behavior to explore area");
            this.bot.explorationBehavior.startExploration(50);
          } else {
            this.info("Queueing explore command");
            this.bot.chat("I'll explore the area around me.");
            this.queueCommand('explore');
          }
          break;
          
        case 'gather_wood':
          if (this.bot.gatherBehavior && typeof this.bot.gatherBehavior.gatherMaterial === 'function') {
            this.info("Using gather behavior to get wood");
            this.bot.gatherBehavior.gatherMaterial('wood');
          } else {
            this.info("Queueing gather wood command");
            this.bot.chat("I'll gather some wood.");
            this.queueCommand('gather wood');
          }
          break;
          
        case 'gather_food':
          if (this.bot.gatherBehavior && typeof this.bot.gatherBehavior.gatherMaterial === 'function') {
            this.info("Using gather behavior to get food");
            this.bot.gatherBehavior.gatherMaterial('food');
          } else {
            this.info("Queueing gather food command");
            this.bot.chat("I need to find some food.");
            this.queueCommand('gather food');
          }
          break;
          
        case 'craft_tools':
          if (this.bot.craftingBehavior && typeof this.bot.craftingBehavior.checkAndCraftTools === 'function') {
            this.info("Using crafting behavior to make tools");
            this.bot.craftingBehavior.checkAndCraftTools();
          } else {
            this.info("Queueing craft tools command");
            this.bot.chat("I should craft some tools.");
            this.queueCommand('craft tools');
          }
          break;
          
        case 'build_shelter':
          if (this.bot.buildingBehavior && typeof this.bot.buildingBehavior.build === 'function') {
            this.info("Using building behavior to make shelter");
            this.bot.buildingBehavior.build('house');
          } else {
            this.info("Queueing build shelter command");
            this.bot.chat("I should build a shelter.");
            this.queueCommand('build shelter');
          }
          break;
          
        case 'craft_items':
          if (this.bot.craftingBehavior && typeof this.bot.craftingBehavior.craftItem === 'function') {
            // Pick a reasonable item to craft based on inventory
            const itemsToCraft = ['stick', 'torch', 'crafting_table', 'chest'];
            const randomItem = itemsToCraft[Math.floor(Math.random() * itemsToCraft.length)];
            this.info(`Using crafting behavior to make ${randomItem}`);
            this.bot.craftingBehavior.craftItem(randomItem);
          } else {
            this.info("Queueing craft command");
            this.bot.chat("I'm going to craft something useful.");
            this.queueCommand('craft');
          }
          break;
          
        case 'combat_practice':
          if (this.bot.combatBehavior && typeof this.bot.combatBehavior.equipBestWeapon === 'function') {
            this.info("Using combat behavior to prepare for battle");
            this.bot.combatBehavior.equipBestWeapon();
            // Look for targets (safely)
            this.bot.combat.scanForThreats();
          } else {
            this.info("Equipping for combat");
            this.bot.chat("I'm preparing for combat.");
            this.queueCommand('equip weapon');
          }
          break;
          
        case 'idle_scan':
          this.info("Looking around in idle state");
          this.bot.chat("I'll scan the area while I'm idle.");
          // Just look around a bit
          this.lookAround();
          break;
          
        case 'follow_player':
          const players = Object.values(this.bot.players || {});
          if (players.length > 0) {
            // Find a random player that isn't the bot itself
            const otherPlayers = players.filter(p => p.username !== this.bot.username);
            if (otherPlayers.length > 0) {
              const playerToFollow = otherPlayers[Math.floor(Math.random() * otherPlayers.length)];
              this.info(`Following player: ${playerToFollow.username}`);
              this.bot.chat(`I'll follow ${playerToFollow.username}.`);
              this.queueCommand(`follow ${playerToFollow.username}`);
            } else {
              this.info("No other players to follow");
              this.lookAround();
            }
          } else {
            this.info("No players to follow");
            this.lookAround();
          }
          break;

        default:
          this.debug(`No implementation for action: ${action}`);
          // Perform a simple action as fallback
          this.lookAround();
          break;
      }
    } catch (error) {
      this.error(`Error executing action ${action}:`, error);
      // Look around as fallback
      this.lookAround();
    }
  }

  /**
   * Queue a command to be executed
   */
  queueCommand(command) {
    try {
      if (typeof this.bot.executeCommand === 'function') {
        this.info(`Executing command via bot.executeCommand: ${command}`);
        this.bot.executeCommand(command);
        return true;
      } else if (typeof this.bot.chat === 'function' && command.startsWith('!')) {
        // If it's already a command (starts with !)
        this.info(`Executing command via bot.chat: ${command}`);
        this.bot.chat(command);
        return true;
      } else if (typeof this.bot.chat === 'function') {
        // Prefix with ! to make it a command
        this.info(`Executing command via bot.chat: !${command}`);
        this.bot.chat(`!${command}`);
        return true;
      } else {
        // Try using the API endpoint as a last resort
        this.info(`Attempting to execute command via API: ${command}`);
        try {
          const cmd = `curl -s -X POST -H "Content-Type: application/json" -d '{"command":"${command}"}' http://localhost:5000/api/command`;
          require('child_process').execSync(cmd);
          return true;
        } catch (apiError) {
          this.error(`API command execution failed: ${apiError.message}`);
          return false;
        }
      }
    } catch (error) {
      this.error(`Error executing command ${command}:`, error);
      return false;
    }
  }

  /**
   * Look around randomly
   */
  lookAround() {
    try {
      // Get a random direction to look
      const yaw = Math.random() * Math.PI * 2; // Random horizontal angle
      const pitch = (Math.random() - 0.5) * Math.PI / 2; // Random vertical angle between -45 and 45 degrees
      
      // Look in that direction
      this.bot.look(yaw, pitch, false);
    } catch (error) {
      this.warn('Error in lookAround:', error);
    }
  }

  /**
   * Handle state change event
   */
  onStateChanged(oldState, newState) {
    if (!this.config.learningEnabled) return;
    
    // If we had a previous action, record its outcome
    if (this.lastState && this.lastAction) {
      const timeTaken = Date.now() - (this.actionStartTime || Date.now());
      
      // Generate a reward based on the state transition
      let reward = 0;
      
      // State transition reward - based on whether this was our intended action
      if (this.lastAction === `change_to_${newState.name}`) {
        reward += 0.5; // We successfully changed to our target state
      }
      
      // Update learning with the outcome of the previous action
      this.learningManager.updateLearning(
        this.lastState,
        this.lastAction,
        reward,
        newState.name
      );
    }
    
    // Update tracking
    this.lastState = newState.name;
  }

  /**
   * Handle block break event
   */
  onBlockBreak(block) {
    if (!this.config.learningEnabled) return;
    
    // Record mining success
    if (this.lastState === 'mining' && this.lastAction) {
      let reward = 0.1; // Base reward for mining any block
      
      // Higher rewards for valuable blocks
      const blockType = block.name || '';
      
      if (blockType.includes('ore')) {
        reward = 0.8; // Ores are valuable
        this.miningSuccesses++;
      } else if (blockType.includes('stone') && this.lastAction === 'mine_stone') {
        reward = 0.3; // Stone when looking for stone
        this.miningSuccesses++;
      } else if (blockType.includes('dirt') || blockType.includes('grass')) {
        reward = 0.05; // Less valuable blocks
      }
      
      // Update learning with this outcome
      this.learningManager.updateLearning(
        this.lastState,
        this.lastAction,
        reward,
        this.lastState // Stay in same state
      );
    }
  }

  /**
   * Handle entity death event
   */
  onEntityDead(entity) {
    if (!this.config.learningEnabled) return;
    
    // Check if this was a combat victory
    if (this.lastState === 'combat' && this.lastAction) {
      // Calculate reward based on entity type
      let reward = 0.2; // Base reward for killing any entity
      
      if (entity.type === 'player') {
        reward = 1.0; // Players are high-value targets
      } else if (entity.mobType && entity.type === 'mob') {
        // Hostile mobs are worth more
        const hostileMobs = ['creeper', 'zombie', 'skeleton', 'spider'];
        if (hostileMobs.includes(entity.mobType)) {
          reward = 0.7;
        }
      }
      
      this.combatWins++;
      
      // Update learning with this outcome
      this.learningManager.updateLearning(
        this.lastState,
        this.lastAction,
        reward,
        this.lastState // Stay in same state
      );
    }
  }

  /**
   * Handle bot death event
   */
  onBotDeath() {
    if (!this.config.learningEnabled) return;
    
    // Record combat loss
    if (this.lastState === 'combat' && this.lastAction) {
      const reward = -1.0; // Dying is bad
      this.combatLosses++;
      
      // Update learning with this outcome
      this.learningManager.updateLearning(
        this.lastState,
        this.lastAction,
        reward,
        'idle' // Will respawn in idle state
      );
    } else {
      // Dying in any other state is also bad
      const reward = -0.8;
      
      // Update learning with this outcome
      this.learningManager.updateLearning(
        this.lastState || 'idle',
        this.lastAction || 'unknown',
        reward,
        'idle' // Will respawn in idle state
      );
    }
  }

  /**
   * Handle new chunks event (exploration)
   */
  onNewChunks() {
    if (!this.config.learningEnabled) return;
    
    // Record exploration success
    if (this.lastState === 'explore' && this.lastAction) {
      const reward = 0.3; // Base reward for finding new areas
      this.exploreDiscoveries++;
      
      // Update learning with this outcome
      this.learningManager.updateLearning(
        this.lastState,
        this.lastAction,
        reward,
        this.lastState // Stay in same state
      );
    }
  }

  /**
   * Handle health change event
   */
  onHealthChanged() {
    if (!this.config.learningEnabled) return;
    
    // If health decreased significantly, this is negative feedback
    if (this.lastState && this.lastAction) {
      if (this.bot.health < this.lastHealth && (this.lastHealth - this.bot.health) > 2) {
        const reward = -0.5; // Taking damage is bad
        
        // Update learning with this outcome
        this.learningManager.updateLearning(
          this.lastState,
          this.lastAction,
          reward,
          this.lastState // Stay in same state
        );
      }
    }
    
    // Record current health for next comparison
    this.lastHealth = this.bot.health;
  }

  /**
   * Handle physics tick event
   */
  onTick() {
    // We don't need to do anything every tick,
    // but we could monitor for stuck situations
  }
  
  /**
   * Shutdown the plugin
   */
  async shutdown() {
    // Clear timers
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    
    if (this.decisionTimer) {
      clearInterval(this.decisionTimer);
      this.decisionTimer = null;
    }
    
    // Save learning data
    if (this.learningManager) {
      this.learningManager.saveData();
    }
    
    this.info('Learning Behavior plugin shutdown');
    return await super.shutdown();
  }
}

module.exports = LearningBehavior;
