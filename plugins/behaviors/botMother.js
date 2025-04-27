/**
 * Bot Mother Plugin for Minecraft Bot
 * 
 * Inspired by the mineflayer-mother repository by MakkusuOtaku,
 * this plugin provides genetic learning and improved pathfinding.
 */

const BasePlugin = require('../basePlugin');
const EnhancedLearning = require('../../utils/enhancedLearning');
const logger = require('../../bot/logger');
const Vec3 = require('vec3');

class BotMotherPlugin extends BasePlugin {
  constructor(botManager, opts) {
    super(botManager, 'botMother');
    
    this.options = {
      enabled: true,
      learningEnabled: true,
      autonomousActions: true,
      learningInterval: 5000, // milliseconds between learning steps
      ...opts
    };
    
    this.learningEngine = null;
    this.learningIntervalId = null;
    this.lastPosition = null;
    this.stuckCounter = 0;
    this.maxStuckCount = 5;
    this.lastCommandTime = 0;
    this.commandCooldown = 10000; // 10 seconds between autonomous commands
  }
  
  /**
   * Initialize the plugin
   */
  async initialize() {
    if (!this.options.enabled) {
      logger.info('[BotMother] Plugin disabled in configuration');
      return;
    }
    
    try {
      logger.info('[BotMother] Initializing Bot Mother plugin');
      
      // Initialize hooks
      this.registerEventHandlers();
      
      // Initialize learning engine when bot and mcData are available
      this.waitForBotReady().then(() => {
        this.initializeLearning();
      });
      
      // Register commands (safe check for command handler availability)
      try {
        const pluginManager = this.botManager ? this.botManager.pluginManager : null;
        const commandHandler = pluginManager ? pluginManager.getPlugin('commandHandler') : null;
        
        if (commandHandler) {
          this.registerCommands(commandHandler);
        } else {
          logger.warn('[BotMother] Command handler plugin not found, using chat-based commands');
          this.registerChatCommands();
        }
      } catch (cmdError) {
        logger.warn('[BotMother] Could not register with command handler, using chat-based commands');
        this.registerChatCommands();
      }
      
      logger.info('[BotMother] Bot Mother plugin initialized');
      return true;
      
    } catch (error) {
      logger.error(`[BotMother] Initialization error: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Wait for bot to be fully ready before initializing
   */
  waitForBotReady() {
    return new Promise((resolve) => {
      // If bot is already available and spawned, resolve immediately
      if (this.bot && this.bot.entity) {
        resolve();
        return;
      }
      
      // Otherwise wait for spawn event
      const checkInterval = setInterval(() => {
        if (this.bot && this.bot.entity) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 1000);
    });
  }
  
  /**
   * Initialize learning engine
   */
  initializeLearning() {
    try {
      // Create learning engine instance
      this.learningEngine = new EnhancedLearning(
        this.bot,
        this.mcData,
        this.config
      );
      
      logger.info('[BotMother] Enhanced learning engine initialized');
      
      // Start learning loop if enabled
      if (this.options.learningEnabled) {
        this.startLearningLoop();
      }
      
    } catch (error) {
      logger.error(`[BotMother] Error initializing learning engine: ${error.message}`);
    }
  }
  
  /**
   * Start the learning loop
   */
  startLearningLoop() {
    if (this.learningIntervalId) {
      clearInterval(this.learningIntervalId);
    }
    
    this.learningIntervalId = setInterval(() => {
      this.learningStep();
    }, this.options.learningInterval);
    
    logger.info(`[BotMother] Learning loop started with interval: ${this.options.learningInterval}ms`);
  }
  
  /**
   * Stop the learning loop
   */
  stopLearningLoop() {
    if (this.learningIntervalId) {
      clearInterval(this.learningIntervalId);
      this.learningIntervalId = null;
      logger.info('[BotMother] Learning loop stopped');
    }
  }
  
  /**
   * Execute one learning step
   */
  learningStep() {
    try {
      // Skip if bot isn't ready
      if (!this.bot || !this.bot.entity) return;
      
      // Skip if we're handling user commands or in an active state
      if (!this.shouldPerformAutonomousActions()) return;
      
      // Check if we're stuck
      this.checkIfStuck();
      
      // Execute a learning step
      if (this.learningEngine) {
        this.learningEngine.step();
      }
      
    } catch (error) {
      logger.warn(`[BotMother] Error in learning step: ${error.message}`);
    }
  }
  
  /**
   * Check if the bot is stuck (not moving)
   */
  checkIfStuck() {
    try {
      const currentPos = this.bot.entity.position.clone();
      
      if (this.lastPosition) {
        // Calculate distance moved since last check
        const distanceMoved = currentPos.distanceTo(this.lastPosition);
        
        // If we've barely moved, increment stuck counter
        if (distanceMoved < 0.1) {
          this.stuckCounter++;
          
          // If we're stuck for too long, attempt to get unstuck
          if (this.stuckCounter >= this.maxStuckCount) {
            this.attemptUnstuck();
            this.stuckCounter = 0;
          }
        } else {
          this.stuckCounter = 0;
        }
      }
      
      this.lastPosition = currentPos;
    } catch (error) {
      logger.warn(`[BotMother] Error checking if stuck: ${error.message}`);
    }
  }
  
  /**
   * Attempt to get unstuck with random movement
   */
  attemptUnstuck() {
    try {
      logger.info('[BotMother] Bot appears stuck, attempting to get unstuck');
      
      // Clear current path
      if (this.bot.pathfinder) {
        this.bot.pathfinder.stop();
      }
      
      // Clear control states
      this.bot.clearControlStates();
      
      // Try jumping
      this.bot.setControlState('jump', true);
      
      // Choose a random direction to move
      const directions = ['forward', 'back', 'left', 'right'];
      const randomDirection = directions[Math.floor(Math.random() * directions.length)];
      
      // Move in that direction
      this.bot.setControlState(randomDirection, true);
      
      // After some time, clear states
      setTimeout(() => {
        this.bot.clearControlStates();
      }, 1500);
      
    } catch (error) {
      logger.warn(`[BotMother] Error attempting to get unstuck: ${error.message}`);
    }
  }
  
  /**
   * Check if we should perform autonomous actions
   */
  shouldPerformAutonomousActions() {
    // Don't execute autonomous actions if:
    
    // 1. Autonomous actions are disabled
    if (!this.options.autonomousActions) {
      return false;
    }
    
    // 2. Bot is in a non-idle state (controlled by user)
    if (this.botManager && this.botManager.stateMachine && 
        this.botManager.stateMachine.currentState && 
        this.botManager.stateMachine.currentState.name !== 'idle') {
      
      return false;
    }
    
    // 3. We recently executed a command (avoid interrupting user-commanded actions)
    if (Date.now() - this.lastCommandTime < this.commandCooldown) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Register event handlers
   */
  registerEventHandlers() {
    try {
      // Keep track of last command time to avoid interfering with user commands
      this.registerEvent('chat', (username, message) => {
        if (username !== this.bot.username && message.startsWith(this.config.chat.commandPrefix)) {
          this.lastCommandTime = Date.now();
        }
      });
      
      // Track physics events
      this.registerEvent('physicsTick', this.onPhysicsTick.bind(this));
      
    } catch (error) {
      logger.error(`[BotMother] Error registering event handlers: ${error.message}`);
    }
  }
  
  /**
   * Register chat-based commands
   */
  registerChatCommands() {
    try {
      this.registerEvent('chat', (username, message) => {
        // Check if user is authorized
        if (this.config.chat.allowedUsers.length > 0 && 
            !this.config.chat.allowedUsers.includes(username)) {
          return;
        }
        
        const prefix = this.config.chat.commandPrefix;
        
        // Handle mother commands
        if (message === `${prefix}mother status`) {
          this.handleMotherStatusCommand(username);
        } else if (message === `${prefix}mother learn start`) {
          this.handleMotherLearnStartCommand(username);
        } else if (message === `${prefix}mother learn stop`) {
          this.handleMotherLearnStopCommand(username);
        } else if (message === `${prefix}mother autonomous on`) {
          this.handleMotherAutonomousCommand(username, true);
        } else if (message === `${prefix}mother autonomous off`) {
          this.handleMotherAutonomousCommand(username, false);
        }
      });
      
    } catch (error) {
      logger.error(`[BotMother] Error registering chat commands: ${error.message}`);
    }
  }
  
  /**
   * Register commands with command handler
   */
  registerCommands(commandHandler) {
    try {
      commandHandler.registerCommand('mother', {
        description: 'Bot Mother learning and autonomous behavior controls',
        usage: 'mother <status|learn|autonomous> [start|stop|on|off]',
        execute: (username, args) => {
          const subCommand = args[0] || 'status';
          
          if (subCommand === 'status') {
            this.handleMotherStatusCommand(username);
          } else if (subCommand === 'learn') {
            const action = args[1] || 'status';
            if (action === 'start') {
              this.handleMotherLearnStartCommand(username);
            } else if (action === 'stop') {
              this.handleMotherLearnStopCommand(username);
            } else {
              this.bot.chat(`Learning is currently ${this.options.learningEnabled ? 'enabled' : 'disabled'}`);
            }
          } else if (subCommand === 'autonomous') {
            const setting = args[1] || 'status';
            if (setting === 'on') {
              this.handleMotherAutonomousCommand(username, true);
            } else if (setting === 'off') {
              this.handleMotherAutonomousCommand(username, false);
            } else {
              this.bot.chat(`Autonomous actions are currently ${this.options.autonomousActions ? 'enabled' : 'disabled'}`);
            }
          } else {
            this.bot.chat(`Unknown subcommand: ${subCommand}. Use status, learn, or autonomous.`);
          }
        }
      });
      
      logger.info('[BotMother] Mother commands registered with command handler');
      
    } catch (error) {
      logger.error(`[BotMother] Error registering commands: ${error.message}`);
    }
  }
  
  /**
   * Handle the mother status command
   */
  handleMotherStatusCommand(username) {
    try {
      this.bot.chat(`Bot Mother Status:`);
      this.bot.chat(`Learning: ${this.options.learningEnabled ? 'Enabled' : 'Disabled'}`);
      this.bot.chat(`Autonomous actions: ${this.options.autonomousActions ? 'Enabled' : 'Disabled'}`);
      
      if (this.learningEngine) {
        const stats = this.learningEngine.getStats();
        this.bot.chat(`Learning episodes: ${stats.episodes}`);
        this.bot.chat(`Exploration rate: ${(stats.currentExplorationRate * 100).toFixed(1)}%`);
        if (stats.averageReward !== undefined) {
          this.bot.chat(`Average reward: ${stats.averageReward.toFixed(2)}`);
        }
      } else {
        this.bot.chat('Learning engine not initialized');
      }
    } catch (error) {
      logger.error(`[BotMother] Error handling status command: ${error.message}`);
      this.bot.chat(`Error getting status: ${error.message}`);
    }
  }
  
  /**
   * Handle mother learn start command
   */
  handleMotherLearnStartCommand(username) {
    try {
      if (this.options.learningEnabled) {
        this.bot.chat('Learning is already enabled');
        return;
      }
      
      this.options.learningEnabled = true;
      this.startLearningLoop();
      this.bot.chat(`Learning process started`);
    } catch (error) {
      logger.error(`[BotMother] Error handling learn start command: ${error.message}`);
      this.bot.chat(`Error starting learning: ${error.message}`);
    }
  }
  
  /**
   * Handle mother learn stop command
   */
  handleMotherLearnStopCommand(username) {
    try {
      if (!this.options.learningEnabled) {
        this.bot.chat('Learning is already disabled');
        return;
      }
      
      this.options.learningEnabled = false;
      this.stopLearningLoop();
      this.bot.chat(`Learning process stopped`);
    } catch (error) {
      logger.error(`[BotMother] Error handling learn stop command: ${error.message}`);
      this.bot.chat(`Error stopping learning: ${error.message}`);
    }
  }
  
  /**
   * Handle mother autonomous command
   */
  handleMotherAutonomousCommand(username, enabled) {
    try {
      this.options.autonomousActions = enabled;
      this.bot.chat(`Autonomous actions ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      logger.error(`[BotMother] Error handling autonomous command: ${error.message}`);
      this.bot.chat(`Error changing autonomous setting: ${error.message}`);
    }
  }
  
  /**
   * Handle physics tick event
   */
  onPhysicsTick() {
    try {
      // Handle special physics situations like improved jumping
      this.handleImprovedPhysics();
    } catch (error) {
      // Don't log physics errors as they can be frequent
    }
  }
  
  /**
   * Apply improved physics handling
   */
  handleImprovedPhysics() {
    try {
      // Detect if bot is stuck on a block and needs to jump
      if (this.bot.entity && this.bot.pathfinder && this.bot.pathfinder.goal) {
        const targetPos = this.bot.pathfinder.goal.x !== undefined ? 
          new Vec3(this.bot.pathfinder.goal.x, this.bot.pathfinder.goal.y, this.bot.pathfinder.goal.z) : 
          null;
        
        if (targetPos) {
          const currentPos = this.bot.entity.position;
          const horizontalDist = Math.sqrt(
            Math.pow(targetPos.x - currentPos.x, 2) + 
            Math.pow(targetPos.z - currentPos.z, 2)
          );
          
          // If we're trying to move horizontally but making little progress
          if (horizontalDist > 2 && this.stuckCounter >= 3) {
            // Check if there's a block in front of us
            const yaw = this.bot.entity.yaw;
            const dx = -Math.sin(yaw);
            const dz = Math.cos(yaw);
            
            const blockInFront = this.bot.blockAt(
              currentPos.offset(dx, 0, dz)
            );
            
            // If there's a solid block in front, try to jump
            if (blockInFront && blockInFront.boundingBox === 'block') {
              this.bot.setControlState('jump', true);
              
              // Release jump after a short time
              setTimeout(() => {
                this.bot.setControlState('jump', false);
              }, 250);
            }
          }
        }
      }
    } catch (error) {
      // Don't log physics errors
    }
  }
  
  /**
   * Clean up when plugin is unloaded
   */
  onUnload() {
    this.stopLearningLoop();
    
    if (this.learningEngine) {
      try {
        // Save learning data before unloading
        this.learningEngine.saveLearningData();
      } catch (error) {
        logger.error(`[BotMother] Error saving learning data: ${error.message}`);
      }
    }
    
    logger.info('[BotMother] Plugin unloaded');
  }
}

module.exports = BotMotherPlugin;