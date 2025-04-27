/**
 * Pathfinding Utility
 * 
 * Provides enhanced pathfinding capabilities for the bot.
 */

const logger = require('../bot/logger');

class PathfindingManager {
  constructor(bot, config) {
    this.bot = bot;
    this.config = config;
    this.pathfinder = null;
    this.movements = null;
    this.goals = null;
    this.lastPathfindingTime = 0;
    this.consecutiveFailures = 0;
    this.maxConsecutiveFailures = 5;
    this.isInitialized = false;
  }

  /**
   * Initialize pathfinding
   */
  initialize() {
    if (!this.bot.pathfinder) {
      logger.warn('Pathfinder plugin not available');
      return false;
    }

    try {
      // Import pathfinder from bot
      const mineflayerPathfinder = require('mineflayer-pathfinder');
      this.pathfinder = this.bot.pathfinder;
      this.movements = new mineflayerPathfinder.Movements(this.bot, this.bot.registry);
      this.goals = mineflayerPathfinder.goals;
      
      // Configure default movements
      this.configureMovements();
      this.pathfinder.setMovements(this.movements);
      
      // Set up pathfinding event handlers
      this.bot.on('goal_reached', () => {
        this.consecutiveFailures = 0;
        logger.debug('Pathfinding goal reached');
      });
      
      this.bot.on('path_update', (results) => {
        if (results.status === 'noPath') {
          this.consecutiveFailures++;
          logger.warn(`Pathfinding failed: ${results.path.length} nodes explored`);
          
          if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
            logger.warn('Too many consecutive pathfinding failures, resetting');
            this.reset();
          }
        } else {
          this.consecutiveFailures = 0;
        }
      });
      
      this.isInitialized = true;
      logger.info('Pathfinding manager initialized');
      return true;
    } catch (error) {
      logger.error('Error initializing pathfinding manager:', error);
      return false;
    }
  }

  /**
   * Configure default movement parameters
   */
  configureMovements() {
    if (!this.movements) return;
    
    // Configure movement costs based on config
    if (this.config.pathfinding) {
      const pfConfig = this.config.pathfinding;
      
      // Block break costs
      if (pfConfig.blockBreakCosts) {
        for (const [blockType, cost] of Object.entries(pfConfig.blockBreakCosts)) {
          const blockId = this.bot.registry.blocksByName[blockType]?.id;
          if (blockId !== undefined) {
            this.movements.blocksCosts[blockId] = cost;
          }
        }
      }
      
      // General movement parameters
      if (pfConfig.parameters) {
        const params = pfConfig.parameters;
        
        if (params.canDig !== undefined) this.movements.canDig = params.canDig;
        if (params.maxDropDown !== undefined) this.movements.maxDropDown = params.maxDropDown;
        if (params.maxFallDamage !== undefined) this.movements.maxFallDamage = params.maxFallDamage;
        if (params.allowParkour !== undefined) this.movements.allowParkour = params.allowParkour;
        if (params.allowSprinting !== undefined) this.movements.allowSprinting = params.allowSprinting;
        if (params.canOpenDoors !== undefined) this.movements.canOpenDoors = params.canOpenDoors;
        if (params.allowSwimming !== undefined) this.movements.allowSwimming = params.allowSwimming;
      }
    }
    
    // Default configurations if not specified in config
    if (this.movements.canDig === undefined) this.movements.canDig = true;
    if (this.movements.allowParkour === undefined) this.movements.allowParkour = true;
    if (this.movements.allowSprinting === undefined) this.movements.allowSprinting = true;
    if (this.movements.allowSwimming === undefined) this.movements.allowSwimming = true;
    
    // Increase digging costs for harder materials
    const hardBlocks = [
      'stone', 'cobblestone', 'coal_ore', 'iron_ore',
      'gold_ore', 'diamond_ore', 'emerald_ore', 'obsidian'
    ];
    
    for (const blockName of hardBlocks) {
      const blockId = this.bot.registry.blocksByName[blockName]?.id;
      if (blockId !== undefined && !this.movements.blocksCosts[blockId]) {
        // Higher cost for harder blocks to encourage going around when possible
        this.movements.blocksCosts[blockId] = blockName === 'obsidian' ? 50 : 5;
      }
    }
  }

  /**
   * Move to a specific position
   */
  async goToPosition(position, options = {}) {
    if (!this.isInitialized) {
      const initialized = this.initialize();
      if (!initialized) {
        logger.error('Cannot go to position: pathfinding manager not initialized');
        return false;
      }
    }
    
    // Cancel any current goal
    this.pathfinder.setGoal(null);
    
    // Set up options
    const range = options.range || 1;
    const timeout = options.timeout || 30000;
    const tickTimeout = options.tickTimeout || 200; // Ticks before giving up (10 seconds at 20tps)
    
    // Create a goal
    let goal;
    if (range <= 1) {
      goal = new this.goals.GoalBlock(position.x, position.y, position.z);
    } else {
      goal = new this.goals.GoalNear(position.x, position.y, position.z, range);
    }
    
    // Record start time
    const startTime = Date.now();
    this.lastPathfindingTime = startTime;
    
    // If we want to wait until the goal is reached or timeout
    if (options.wait) {
      try {
        logger.info(`Moving to position (${position.x}, ${position.y}, ${position.z}) with range ${range}`);
        
        // Set pathfinding options
        if (options.canDig !== undefined) this.movements.canDig = options.canDig;
        if (options.allowFallDamage !== undefined) this.movements.allowFallDamage = options.allowFallDamage;
        
        // Set the goal with any additional options
        const pathfindingOptions = {};
        if (tickTimeout) pathfindingOptions.tickTimeout = tickTimeout;
        this.pathfinder.setGoal(goal, pathfindingOptions);
        
        // Wait until we reach the goal or timeout
        while (this.pathfinder.isMoving()) {
          if (Date.now() - startTime > timeout) {
            logger.warn('Pathfinding timed out');
            this.pathfinder.setGoal(null);
            return false;
          }
          
          // Pause briefly before checking again
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Reset any temporary movement changes
        this.configureMovements();
        
        // Check if we're close enough to consider it successful
        const distance = this.bot.entity.position.distanceTo(position);
        const success = distance <= range + 1;
        
        if (success) {
          logger.info(`Successfully moved to position in ${(Date.now() - startTime) / 1000} seconds`);
        } else {
          logger.warn(`Failed to reach position, ended at distance ${distance.toFixed(2)}`);
        }
        
        return success;
      } catch (error) {
        logger.error('Error in pathfinding:', error);
        return false;
      }
    }
    
    // Otherwise just start the pathfinding and return
    try {
      // Set pathfinding options
      if (options.canDig !== undefined) this.movements.canDig = options.canDig;
      if (options.allowFallDamage !== undefined) this.movements.allowFallDamage = options.allowFallDamage;
      
      // Set the goal with any additional options
      const pathfindingOptions = {};
      if (tickTimeout) pathfindingOptions.tickTimeout = tickTimeout;
      this.pathfinder.setGoal(goal, pathfindingOptions);
      
      // Return immediately
      return true;
    } catch (error) {
      logger.error('Error starting pathfinding:', error);
      return false;
    }
  }

  /**
   * Find a path to the nearest block of a specific type
   */
  async findPathToBlock(blockType, options = {}) {
    if (!this.isInitialized) {
      const initialized = this.initialize();
      if (!initialized) {
        logger.error('Cannot find path to block: pathfinding manager not initialized');
        return false;
      }
    }
    
    try {
      // Find blocks of the specified type
      logger.info(`Finding path to nearest ${blockType} block`);
      
      const blockId = this.bot.registry.blocksByName[blockType]?.id;
      if (blockId === undefined) {
        logger.warn(`Unknown block type: ${blockType}`);
        return false;
      }
      
      const maxDistance = options.maxDistance || 64;
      const count = options.count || 10;
      
      const blockPositions = this.bot.findBlocks({
        matching: blockId,
        maxDistance: maxDistance,
        count: count
      });
      
      if (blockPositions.length === 0) {
        logger.warn(`No ${blockType} blocks found within range ${maxDistance}`);
        return false;
      }
      
      // Find the closest block that we can actually path to
      let closestDistance = Infinity;
      let closestPosition = null;
      
      for (const position of blockPositions) {
        // Convert to Vec3 with y+1 to aim for the block above it (to stand on/near it)
        const pathTarget = position.offset(0, 1, 0);
        
        // Check if we can path to it
        this.pathfinder.setGoal(null); // Clear any current goal
        const goal = new this.goals.GoalNear(pathTarget.x, pathTarget.y, pathTarget.z, 2);
        
        try {
          // Find a path to this block
          const path = await this.getPath(goal, options);
          
          if (path) {
            // Path exists, check distance
            const distance = path.length;
            if (distance < closestDistance) {
              closestDistance = distance;
              closestPosition = position;
            }
          }
        } catch (error) {
          // This position might not be reachable, continue to the next
          continue;
        }
      }
      
      if (closestPosition) {
        // Path to the closest reachable block
        logger.info(`Found pathable ${blockType} at ${closestPosition}, path length: ${closestDistance}`);
        
        // If we want to actually go there
        if (options.moveToBlock) {
          return this.goToPosition(closestPosition.offset(0, 1, 0), {
            range: 2,
            wait: options.wait,
            timeout: options.timeout
          });
        }
        
        return closestPosition;
      } else {
        logger.warn(`No pathable ${blockType} blocks found`);
        return false;
      }
    } catch (error) {
      logger.error(`Error finding path to ${blockType}:`, error);
      return false;
    }
  }

  /**
   * Find a path to a specific entity
   */
  async findPathToEntity(entity, options = {}) {
    if (!this.isInitialized) {
      const initialized = this.initialize();
      if (!initialized) {
        logger.error('Cannot find path to entity: pathfinding manager not initialized');
        return false;
      }
    }
    
    if (!entity || !entity.position) {
      logger.warn('Invalid entity for pathfinding');
      return false;
    }
    
    try {
      const range = options.range || 2; // Default to 2 blocks range
      const position = entity.position;
      
      logger.info(`Finding path to entity at (${position.x}, ${position.y}, ${position.z})`);
      
      return this.goToPosition(position, {
        range: range,
        wait: options.wait,
        timeout: options.timeout
      });
    } catch (error) {
      logger.error('Error finding path to entity:', error);
      return false;
    }
  }

  /**
   * Get a path to a goal without actually moving
   */
  async getPath(goal, options = {}) {
    if (!this.isInitialized) {
      const initialized = this.initialize();
      if (!initialized) return null;
    }
    
    try {
      // Set temporary movement parameters if needed
      const originalCanDig = this.movements.canDig;
      const originalAllowFallDamage = this.movements.allowFallDamage;
      
      if (options.canDig !== undefined) this.movements.canDig = options.canDig;
      if (options.allowFallDamage !== undefined) this.movements.allowFallDamage = options.allowFallDamage;
      
      // Calculate the path
      const path = await this.pathfinder.getPathTo(goal, undefined, options.tickTimeout || 100);
      
      // Reset movement parameters
      this.movements.canDig = originalCanDig;
      this.movements.allowFallDamage = originalAllowFallDamage;
      
      return path;
    } catch (error) {
      logger.debug('Error getting path:', error);
      return null;
    }
  }

  /**
   * Stop any current pathfinding
   */
  stop() {
    if (this.pathfinder) {
      this.pathfinder.setGoal(null);
      this.bot.clearControlStates();
    }
  }

  /**
   * Reset the pathfinding manager in case of errors
   */
  reset() {
    this.stop();
    this.consecutiveFailures = 0;
    
    // Re-initialize movements
    if (this.movements) {
      this.configureMovements();
      this.pathfinder.setMovements(this.movements);
    }
  }

  /**
   * Check if the bot is currently pathfinding
   */
  isMoving() {
    return this.pathfinder ? this.pathfinder.isMoving() : false;
  }
}

module.exports = PathfindingManager;