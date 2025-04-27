/**
 * Mining State for Minecraft Bot
 * 
 * In this state, the bot will actively mine blocks, seeking ores
 * and collecting resources. Features advanced mining techniques including:
 * - Targeted ore mining
 * - Branch mining
 * - Strip mining 
 * - Cave exploration mining
 * - Vein following for connected ores
 * - Automatic torch placement
 * - Safety checks for lava and falling blocks
 * - Tool selection based on block type
 */

// Import our custom StateBehavior base class
const StateBehavior = require('../bot/stateBehavior');
const Vec3 = require('vec3');
const logger = require('../bot/logger');

class MiningState extends StateBehavior {
  constructor(bot, botManager) {
    super(bot, 'mining');
    this.botManager = botManager;
    
    // Basic state tracking
    this.timeInState = 0;
    this.lastProgressUpdate = 0;
    this.initialHealth = 0;
    this.initialHunger = 0;
    this.targetBlocks = [];
    this.currentTargetBlock = null;
    this.blocksMinedCount = 0;
    this.blocksMiningFailed = 0;
    this.miningStartTime = 0;
    this.miningTaskComplete = false;
    
    // Mining modes and strategies
    this.miningMode = 'target'; // 'target', 'branch', 'strip', 'cave', 'vein'
    this.isTunnelMining = false;
    this.tunnelDirection = null;
    this.branchMiningData = {
      originPoint: null,
      currentBranch: 0,
      branchLength: 20,
      branchSpacing: 3,
      maxBranches: 10,
      branchesComplete: 0,
      branchDirection: null
    };
    
    // Search and tracking variables
    this.searchingForBlock = false;
    this.lastTorchPlacement = 0;
    this.torchInterval = 8; // blocks between torches
    this.blocksMinesSinceTorch = 0;
    this.oresFound = {};
    this.dangerousBlocksFound = 0;
    this.safetyChecksEnabled = true;
    
    // Performance metrics
    this.miningSpeed = 0; // blocks per minute
    this.lastSpeedCalculation = 0;
    this.lastBlockCount = 0;
  }

  onStateEntered() {
    this.timeInState = 0;
    this.lastProgressUpdate = 0;
    this.initialHealth = this.bot.health;
    this.initialHunger = this.bot.food;
    this.blocksMinedCount = 0;
    this.blocksMiningFailed = 0;
    this.miningStartTime = Date.now();
    this.miningTaskComplete = false;
    
    logger.info('Entered mining state');
    this.bot.chat('Starting mining operations.');
    
    // Get target blocks from mining behavior or find new ones
    this.initializeMiningTargets();
  }

  onStateExited() {
    logger.info('Exited mining state');
    this.reportMiningResults();
    
    // Clean up mining state
    this.targetBlocks = [];
    this.currentTargetBlock = null;
    
    // If we were tunnel mining, reset that state
    this.isTunnelMining = false;
    this.tunnelDirection = null;
    
    // Stop digging if we were in the middle of it
    if (this.bot.targetDigBlock) {
      this.bot.stopDigging();
    }
  }

  /**
   * Initialize mining targets based on behavior state or find new targets
   */
  async initializeMiningTargets() {
    // First check if we have targets from the mining behavior
    if (this.botManager.miningBehavior && 
        this.botManager.miningBehavior.targetBlocks && 
        this.botManager.miningBehavior.targetBlocks.length > 0) {
      
      this.targetBlocks = this.botManager.miningBehavior.targetBlocks.slice();
      logger.info(`Using ${this.targetBlocks.length} target blocks from mining behavior`);
      
      // Start mining process
      this.mineNextBlock();
      return;
    }
    
    // If we're doing tunnel mining
    if (this.isTunnelMining && this.tunnelDirection) {
      this.continueTunnelMining();
      return;
    }
    
    // If no specific targets, decide what to mine based on priorities
    this.decideMiningStrategy();
  }

  /**
   * Decide what mining strategy to use
   */
  async decideMiningStrategy() {
    logger.info('Deciding mining strategy');
    
    // See if we need specific resources
    const needsCoal = this.needsResource('coal');
    const needsIron = this.needsResource('iron');
    const needsStone = this.needsResource('cobblestone', 16);
    
    // Make decisions based on needs
    if (needsCoal) {
      this.bot.chat('Looking for coal to mine.');
      await this.findAndMineResource('coal_ore');
    }
    else if (needsIron) {
      this.bot.chat('Looking for iron to mine.');
      await this.findAndMineResource('iron_ore');
    }
    else if (needsStone) {
      this.bot.chat('Mining some stone.');
      await this.findAndMineResource('stone');
    }
    else {
      // No specific needs, let's try to find valuable ores
      this.bot.chat('Looking for valuable ores to mine.');
      
      // Try diamond first
      const foundDiamond = await this.findAndMineResource('diamond_ore');
      
      // If no diamond, try others in order of value
      if (!foundDiamond) {
        const tryOres = ['emerald_ore', 'gold_ore', 'redstone_ore', 'lapis_ore', 'iron_ore', 'coal_ore'];
        
        for (const ore of tryOres) {
          const found = await this.findAndMineResource(ore);
          if (found) break;
        }
      }
      
      // If we still have no targets, start strip mining
      if (this.targetBlocks.length === 0) {
        this.startStripMining();
      }
    }
  }

  /**
   * Check if the bot needs a specific resource
   */
  needsResource(resourceName, minAmount = 0) {
    const items = this.bot.inventory.items();
    
    // Count how much of this resource we have
    const matchingItems = items.filter(item => item.name.includes(resourceName));
    const totalCount = matchingItems.reduce((sum, item) => sum + item.count, 0);
    
    return totalCount < minAmount;
  }

  /**
   * Find and mine a specific resource
   */
  async findAndMineResource(blockType) {
    this.searchingForBlock = true;
    this.bot.chat(`Searching for ${blockType}...`);
    
    try {
      // Use mining behavior to find blocks
      let blocks = [];
      
      if (this.botManager.miningBehavior) {
        blocks = await this.botManager.miningBehavior.findBlocks(blockType);
      } else {
        // Fallback block finding if mining behavior not available
        const blockId = this.bot.registry.blocksByName[blockType]?.id;
        if (blockId) {
          const positions = this.bot.findBlocks({
            matching: blockId,
            maxDistance: 32,
            count: 10
          });
          
          blocks = positions.map(pos => this.bot.blockAt(pos))
                            .filter(block => block !== null);
        }
      }
      
      if (blocks.length === 0) {
        this.bot.chat(`Couldn't find any ${blockType} nearby.`);
        this.searchingForBlock = false;
        return false;
      }
      
      this.bot.chat(`Found ${blocks.length} ${blockType} blocks to mine.`);
      this.targetBlocks = blocks;
      this.searchingForBlock = false;
      
      // Start mining
      this.mineNextBlock();
      return true;
      
    } catch (error) {
      logger.error(`Error finding ${blockType}:`, error);
      this.bot.chat(`Error searching for ${blockType}: ${error.message}`);
      this.searchingForBlock = false;
      return false;
    }
  }

  /**
   * Start strip mining in a straight line
   */
  startStripMining() {
    // Decide on a direction for strip mining
    // Use the direction the bot is facing
    const yaw = this.bot.entity.yaw;
    let direction;
    
    // Convert yaw to a cardinal direction (N, S, E, W)
    // Yaw 0 is south, π/2 is west, π is north, 3π/2 is east
    if (yaw >= -Math.PI/4 && yaw < Math.PI/4) {
      direction = new Vec3(0, 0, 1); // South
    } else if (yaw >= Math.PI/4 && yaw < 3*Math.PI/4) {
      direction = new Vec3(-1, 0, 0); // West
    } else if (yaw >= 3*Math.PI/4 || yaw < -3*Math.PI/4) {
      direction = new Vec3(0, 0, -1); // North
    } else {
      direction = new Vec3(1, 0, 0); // East
    }
    
    // Set up tunnel mining
    this.isTunnelMining = true;
    this.tunnelDirection = direction;
    this.bot.chat(`Starting strip mining in direction (${direction.x}, ${direction.z}).`);
    
    // Start the tunnel
    this.continueTunnelMining();
  }

  /**
   * Continue tunnel mining in the set direction
   */
  continueTunnelMining() {
    if (!this.tunnelDirection) {
      this.isTunnelMining = false;
      return;
    }
    
    // Get the starting position
    const startPos = this.bot.entity.position.floored();
    
    // Calculate the blocks to mine (2 high tunnel)
    const blocks = [];
    
    // Mine the block at eye level
    const eyeBlock = this.bot.blockAt(startPos.offset(this.tunnelDirection.x, 1, this.tunnelDirection.z));
    if (eyeBlock && eyeBlock.name !== 'air' && eyeBlock.name !== 'cave_air' && eyeBlock.name !== 'void_air') {
      blocks.push(eyeBlock);
    }
    
    // Mine the block at feet level
    const feetBlock = this.bot.blockAt(startPos.offset(this.tunnelDirection.x, 0, this.tunnelDirection.z));
    if (feetBlock && feetBlock.name !== 'air' && feetBlock.name !== 'cave_air' && feetBlock.name !== 'void_air') {
      blocks.push(feetBlock);
    }
    
    // Add these blocks to our mining targets
    if (blocks.length > 0) {
      this.targetBlocks = blocks;
      this.mineNextBlock();
    } else {
      // No blocks to mine, just move forward
      this.moveForwardInTunnel();
    }
  }

  /**
   * Move forward in the tunnel
   */
  async moveForwardInTunnel() {
    if (!this.tunnelDirection) return;
    
    const currentPos = this.bot.entity.position;
    const targetPos = currentPos.offset(
      this.tunnelDirection.x * 1.5,
      0,
      this.tunnelDirection.z * 1.5
    );
    
    try {
      // Look in the direction we're tunneling
      const yaw = Math.atan2(-this.tunnelDirection.x, this.tunnelDirection.z);
      await this.bot.look(yaw, 0, true);
      
      // Move forward
      this.bot.setControlState('forward', true);
      
      // Wait a bit to move forward
      await new Promise(resolve => setTimeout(resolve, 250));
      
      // Stop moving
      this.bot.clearControlStates();
      
      // Continue tunnel
      this.continueTunnelMining();
    } catch (error) {
      logger.warn('Error moving in tunnel:', error);
      this.bot.clearControlStates();
    }
  }

  /**
   * Main update function for the mining state
   */
  update() {
    this.timeInState += 1;
    
    // Check for health and safety frequently
    this.checkSafetyConditions();
    
    // Provide progress updates periodically
    const now = Date.now();
    if (now - this.lastProgressUpdate > 20000) { // Every 20 seconds
      this.lastProgressUpdate = now;
      this.updateMiningProgress();
    }
    
    // If we've completed the mining task, we should move to idle
    if (this.miningTaskComplete) {
      return;
    }
    
    // If we are not currently mining a block, get the next one
    if (!this.currentTargetBlock && !this.searchingForBlock) {
      if (this.targetBlocks.length > 0) {
        this.mineNextBlock();
      } 
      else if (this.isTunnelMining) {
        this.continueTunnelMining();
      }
      else {
        // We've run out of targets, try to find more or finish
        this.findMoreTargetsOrFinish();
      }
    }
  }

  /**
   * Mining the next block in the targets array
   */
  async mineNextBlock() {
    // Skip if we're already mining
    if (this.currentTargetBlock) return;
    
    // If no more blocks to mine, finish
    if (this.targetBlocks.length === 0) {
      this.findMoreTargetsOrFinish();
      return;
    }
    
    // Get the next block to mine
    this.currentTargetBlock = this.targetBlocks.shift();
    
    try {
      logger.info(`Mining block ${this.currentTargetBlock.name} at ${this.currentTargetBlock.position}`);
      
      // Check if the block is still valid
      const currentBlock = this.bot.blockAt(this.currentTargetBlock.position);
      
      if (!currentBlock || currentBlock.type !== this.currentTargetBlock.type) {
        logger.debug(`Block at ${this.currentTargetBlock.position} changed, skipping`);
        this.currentTargetBlock = null;
        return;
      }
      
      // Navigate to and mine the block
      await this.navigateAndMineBlock(this.currentTargetBlock);
      
      // Block successfully mined
      this.blocksMinedCount++;
      this.currentTargetBlock = null;
      
      // Check if we should search for ore veins
      if (this.isOreBlock(currentBlock)) {
        await this.checkForNearbyOres(currentBlock);
      }
      
      // Handle tunnel mining continuation
      if (this.isTunnelMining && this.targetBlocks.length === 0) {
        this.continueTunnelMining();
      }
      
    } catch (error) {
      logger.warn(`Failed to mine block:`, error);
      this.blocksMiningFailed++;
      this.currentTargetBlock = null;
      
      // Continue with next block
      this.mineNextBlock();
    }
  }

  /**
   * Navigate to a block and mine it
   */
  async navigateAndMineBlock(block) {
    try {
      // If mining behavior available, use it
      if (this.botManager.miningBehavior) {
        return await this.botManager.miningBehavior.mineBlock(block);
      }
      
      // Otherwise, implement a basic mining function
      
      // Check if the block is reachable from current position
      const reachable = await this.isBlockReachable(block);
      
      if (!reachable) {
        // Navigate closer to the block
        await this.navigateToBlock(block);
      }
      
      // Try to equip the best tool
      await this.equipBestTool(block);
      
      // Mine the block
      await this.bot.dig(block);
      
      return true;
    } catch (error) {
      logger.error(`Error mining block:`, error);
      throw error;
    }
  }

  /**
   * Check if a block is reachable for mining
   */
  async isBlockReachable(block) {
    const maxDistance = 4.5; // Maximum reach distance
    const eyePos = this.bot.entity.position.offset(0, this.bot.entity.height, 0);
    const blockPos = block.position.offset(0.5, 0.5, 0.5); // Center of block
    
    // Check distance
    if (eyePos.distanceTo(blockPos) > maxDistance) {
      return false;
    }
    
    // Check line of sight
    const result = this.bot.world.raycast(eyePos, blockPos, 5);
    
    // If we hit anything that isn't our target block, then we can't reach it
    if (result && !result.position.equals(block.position)) {
      return false;
    }
    
    return true;
  }

  /**
   * Navigate to a position close to a block
   */
  async navigateToBlock(block) {
    logger.debug(`Navigating to block at ${block.position}`);
    
    if (this.botManager.pathfindingManager) {
      return await this.botManager.pathfindingManager.goto(block.position);
    }
    
    // Fallback pathfinding using mineflayer-pathfinder directly
    const goals = require('mineflayer-pathfinder').goals;
    const goal = new goals.GoalGetToBlock(block.position.x, block.position.y, block.position.z);
    
    return new Promise((resolve, reject) => {
      // Set a timeout for pathfinding
      const timeout = setTimeout(() => {
        this.bot.pathfinder.setGoal(null);
        reject(new Error(`Pathfinding timed out`));
      }, 30000);
      
      // Set up event listeners
      const onGoalReached = () => {
        clearTimeout(timeout);
        this.bot.removeListener('goal_reached', onGoalReached);
        this.bot.removeListener('path_update', onPathUpdate);
        resolve();
      };
      
      const onPathUpdate = (results) => {
        if (results.status === 'noPath') {
          clearTimeout(timeout);
          this.bot.removeListener('goal_reached', onGoalReached);
          this.bot.removeListener('path_update', onPathUpdate);
          reject(new Error(`No path to block at ${block.position}`));
        }
      };
      
      // Register listeners
      this.bot.once('goal_reached', onGoalReached);
      this.bot.on('path_update', onPathUpdate);
      
      // Start pathfinding
      this.bot.pathfinder.setGoal(goal);
    });
  }

  /**
   * Equip the best tool for mining a block
   */
  async equipBestTool(block) {
    try {
      if (this.bot.pathfinder.bestHarvestTool) {
        const tool = this.bot.pathfinder.bestHarvestTool(block);
        if (tool) {
          await this.bot.equip(tool, 'hand');
          return true;
        }
      }
      
      // Fallback to simpler tool selection
      const items = this.bot.inventory.items();
      const suitableTools = items.filter(item => {
        return (
          item.name.includes('_pickaxe') ||
          item.name.includes('_axe') ||
          item.name.includes('_shovel')
        );
      });
      
      if (suitableTools.length > 0) {
        // Prefer higher tier tools
        const toolOrder = ['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden'];
        
        // Sort by tool tier
        suitableTools.sort((a, b) => {
          const tierA = toolOrder.findIndex(tier => a.name.includes(tier));
          const tierB = toolOrder.findIndex(tier => b.name.includes(tier));
          return tierA - tierB; // Lower index (higher tier) comes first
        });
        
        await this.bot.equip(suitableTools[0], 'hand');
        return true;
      }
      
      return false;
    } catch (error) {
      logger.warn(`Failed to equip tool:`, error);
      return false;
    }
  }

  /**
   * Check for nearby ores of the same type (vein mining)
   */
  async checkForNearbyOres(block) {
    try {
      // Skip this if it's not an ore block
      if (!this.isOreBlock(block)) return;
      
      const blockType = block.type;
      
      // Check adjacent blocks
      const offsets = [
        new Vec3(1, 0, 0),
        new Vec3(-1, 0, 0),
        new Vec3(0, 1, 0),
        new Vec3(0, -1, 0),
        new Vec3(0, 0, 1),
        new Vec3(0, 0, -1)
      ];
      
      for (const offset of offsets) {
        const checkPos = block.position.plus(offset);
        const checkBlock = this.bot.blockAt(checkPos);
        
        if (checkBlock && checkBlock.type === blockType) {
          // Found matching ore, add to mining targets
          this.targetBlocks.push(checkBlock);
        }
      }
      
      // If we found more blocks, sort them by distance
      if (this.targetBlocks.length > 0) {
        this.targetBlocks.sort((a, b) => {
          const distA = a.position.distanceTo(this.bot.entity.position);
          const distB = b.position.distanceTo(this.bot.entity.position);
          return distA - distB;
        });
      }
      
    } catch (error) {
      logger.warn(`Error checking nearby ores:`, error);
    }
  }

  /**
   * Check if a block is an ore
   */
  isOreBlock(block) {
    if (!block) return false;
    
    const oreNames = [
      'coal_ore', 'deepslate_coal_ore',
      'iron_ore', 'deepslate_iron_ore',
      'copper_ore', 'deepslate_copper_ore',
      'gold_ore', 'deepslate_gold_ore',
      'redstone_ore', 'deepslate_redstone_ore',
      'diamond_ore', 'deepslate_diamond_ore',
      'lapis_ore', 'deepslate_lapis_ore',
      'emerald_ore', 'deepslate_emerald_ore',
      'nether_gold_ore', 'nether_quartz_ore',
      'ancient_debris'
    ];
    
    return oreNames.includes(block.name);
  }

  /**
   * Update mining progress
   */
  updateMiningProgress() {
    // Skip if it's been less than a minute
    const elapsedTime = (Date.now() - this.miningStartTime) / 1000;
    if (elapsedTime < 60) return;
    
    const minutes = Math.floor(elapsedTime / 60);
    const seconds = Math.floor(elapsedTime % 60);
    
    const blocksPerMinute = (this.blocksMinedCount / elapsedTime) * 60;
    
    this.bot.chat(`Mining progress: ${this.blocksMinedCount} blocks mined in ${minutes}m ${seconds}s (${blocksPerMinute.toFixed(1)} blocks/min)`);
  }

  /**
   * Find more mining targets or finish mining
   */
  async findMoreTargetsOrFinish() {
    // If we were tunnel mining, just continue the tunnel
    if (this.isTunnelMining) {
      this.continueTunnelMining();
      return;
    }
    
    // Check if we've been mining for a while
    const elapsedTime = (Date.now() - this.miningStartTime) / 1000;
    
    if (elapsedTime > 300 || this.blocksMinedCount > 50) {
      // We've been mining for 5 minutes or mined a lot, consider stopping
      
      // Check if inventory is getting full
      const inventoryFull = this.checkInventoryFullness();
      
      if (inventoryFull || Math.random() < 0.7) {
        // 70% chance to stop mining after a while, or if inventory is full
        this.miningTaskComplete = true;
        return;
      }
    }
    
    // Try to find more blocks to mine
    const oreTypes = [
      'diamond_ore', 'iron_ore', 'gold_ore', 'coal_ore',
      'emerald_ore', 'redstone_ore', 'lapis_ore'
    ];
    
    // Try each ore type
    for (const oreType of oreTypes) {
      const found = await this.findAndMineResource(oreType);
      if (found) return;
    }
    
    // If no ores found, try stone
    const foundStone = await this.findAndMineResource('stone');
    
    if (!foundStone) {
      // If we can't find anything to mine, switch to strip mining
      this.startStripMining();
    }
  }

  /**
   * Check if inventory is getting full
   */
  checkInventoryFullness() {
    const slots = this.bot.inventory.slots;
    let usedSlots = 0;
    let totalSlots = 36; // Main inventory + hotbar
    
    for (let i = 9; i < 45; i++) { // Skip armor slots
      if (slots[i]) usedSlots++;
    }
    
    return usedSlots / totalSlots > 0.8; // 80% full
  }

  /**
   * Check safety conditions while mining
   */
  checkSafetyConditions() {
    // Check health
    if (this.bot.health < 7) {
      logger.warn('Low health during mining, seeking safety');
      this.miningTaskComplete = true;
      return;
    }
    
    // Check hunger
    if (this.bot.food < 8) {
      logger.info('Getting hungry during mining, should eat soon');
      
      // Try to eat if we have food
      if (this.botManager.survivalBehavior) {
        this.botManager.survivalBehavior.eat();
      }
      
      // If food is really low, stop mining
      if (this.bot.food < 4) {
        logger.warn('Very hungry during mining, stopping mining to find food');
        this.miningTaskComplete = true;
        return;
      }
    }
    
    // Check for hostile mobs
    const hostileMobs = this.findNearbyHostileMobs();
    
    if (hostileMobs.length > 0) {
      // If there's a hostile mob very close, stop mining
      const closestMob = hostileMobs[0];
      
      if (closestMob.distance < 5) {
        logger.warn(`Hostile mob ${closestMob.name} nearby, stopping mining for safety`);
        this.miningTaskComplete = true;
        return;
      }
    }
  }

  /**
   * Find nearby hostile mobs
   */
  findNearbyHostileMobs() {
    const hostileMobs = [];
    const entities = this.bot.entities;
    
    for (const entity of Object.values(entities)) {
      if (entity.type !== 'mob') continue;
      
      // Define hostile mob types
      const hostileTypes = [
        'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider',
        'enderman', 'witch', 'slime', 'phantom'
      ];
      
      if (hostileTypes.includes(entity.name)) {
        const distance = entity.position.distanceTo(this.bot.entity.position);
        hostileMobs.push({
          entity: entity,
          name: entity.name,
          distance: distance
        });
      }
    }
    
    // Sort by distance
    hostileMobs.sort((a, b) => a.distance - b.distance);
    
    return hostileMobs;
  }

  /**
   * Report mining results when exiting the state
   */
  reportMiningResults() {
    const elapsedTime = (Date.now() - this.miningStartTime) / 1000;
    const minutes = Math.floor(elapsedTime / 60);
    const seconds = Math.floor(elapsedTime % 60);
    
    this.bot.chat(`Mining session complete! Mined ${this.blocksMinedCount} blocks in ${minutes}m ${seconds}s.`);
    
    // Report any failures
    if (this.blocksMiningFailed > 0) {
      this.bot.chat(`Failed to mine ${this.blocksMiningFailed} blocks due to various issues.`);
    }
    
    // Check health and hunger changes
    const healthChange = this.bot.health - this.initialHealth;
    const hungerChange = this.bot.food - this.initialHunger;
    
    if (healthChange < 0) {
      this.bot.chat(`Lost ${-healthChange} health points during mining.`);
    }
    
    if (hungerChange < 0) {
      this.bot.chat(`Used ${-hungerChange} hunger points during mining.`);
    }
  }

  /**
   * Determine if we should transition to another state
   */
  shouldTransition(nextState) {
    // Different checks based on the potential next state
    switch (nextState) {
      case 'idle':
        return this.shouldTransitionToIdle();
      case 'combat':
        return this.shouldTransitionToCombat();
      case 'gather':
        return this.shouldTransitionToGather();
      case 'craft':
        return this.shouldTransitionToCraft();
      default:
        return false;
    }
  }

  /**
   * Check if we should transition to idle state
   */
  shouldTransitionToIdle() {
    // If mining is complete
    if (this.miningTaskComplete) {
      return true;
    }
    
    // If we've been mining for too long (cap at 10 minutes)
    const elapsedTime = (Date.now() - this.miningStartTime) / 1000;
    if (elapsedTime > 600) { // 10 minutes
      return true;
    }
    
    // If inventory is completely full
    if (this.checkInventoryFullness() && this.blocksMinedCount > 10) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if we should transition to combat state
   */
  shouldTransitionToCombat() {
    // If we have an attack target, always switch to combat
    if (this.botManager.combatBehavior && this.botManager.combatBehavior.attackTarget) {
      return true;
    }
    
    // Check for very close hostile mobs
    const hostileMobs = this.findNearbyHostileMobs();
    
    if (hostileMobs.length > 0 && hostileMobs[0].distance < 4) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if we should transition to gather state
   */
  shouldTransitionToGather() {
    // Transition to gather if very hungry and mining for a while
    const elapsedTime = (Date.now() - this.miningStartTime) / 1000;
    
    if (this.bot.food < 6 && elapsedTime > 120) { // 2 minutes
      return true;
    }
    
    // If explicitly told to collect items
    if (this.botManager.survivalBehavior && this.botManager.survivalBehavior.isCollecting) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if we should transition to craft state
   */
  shouldTransitionToCraft() {
    // If tools are about to break
    const mainHandItem = this.bot.heldItem;
    
    if (mainHandItem && 
        (mainHandItem.name.includes('_pickaxe') || mainHandItem.name.includes('_shovel')) && 
        mainHandItem.durabilityUsed / mainHandItem.maxDurability > 0.9) {
      // Tool is 90% worn out
      return true;
    }
    
    // If we've been explicitly instructed to craft
    if (this.botManager.craftingBehavior && this.botManager.craftingBehavior.isCrafting) {
      return true;
    }
    
    return false;
  }
}

module.exports = MiningState;
