/**
 * Mining Behavior Module
 * 
 * Handles mining tasks for the bot, including resource gathering
 * and block searching.
 */

const Vec3 = require('vec3');
const { goals, Movements } = require('mineflayer-pathfinder');
const { GoalBlock, GoalNear } = goals;
const logger = require('../bot/logger');

class MiningBehavior {
  constructor(bot, mcData, config, botManager) {
    this.bot = bot;
    this.mcData = mcData;
    this.config = config;
    this.botManager = botManager;
    
    this.targetBlocks = [];
    this.miningStats = {
      blocksMined: 0,
      oresMined: 0,
      toolsBreak: 0,
      startTime: null,
      resourcesCollected: {}
    };
    
    this.safetyBlocks = [
      'lava', 'flowing_lava', 'water', 'flowing_water', 
      'fire', 'soul_fire', 'cactus'
    ].map(name => this.mcData.blocksByName[name]?.id).filter(id => id !== undefined);
  }
  
  /**
   * Start mining a specific block type
   */
  async mineBlock(blockType, amount = 1) {
    logger.info(`Starting to mine ${amount}x ${blockType}`);
    this.miningStats.startTime = Date.now();
    this.miningStats.blocksMined = 0;
    
    // Empty previous targets
    this.targetBlocks = [];
    
    try {
      // Find blocks to mine
      const blocks = await this.findBlocks(blockType);
      
      if (blocks.length === 0) {
        this.bot.chat(`I couldn't find any ${blockType} nearby.`);
        // Return to idle state
        this.botManager.changeState('idle');
        return;
      }
      
      this.bot.chat(`Found ${blocks.length} ${blockType} blocks to mine.`);
      this.targetBlocks = blocks.slice(0, Math.min(blocks.length, amount * 2)); // Get more than needed in case some fail
      
      // Start mining process
      await this.mineTargets(amount);
      
    } catch (error) {
      logger.error(`Error in mining behavior:`, error);
      this.bot.chat(`I encountered an error while mining: ${error.message}`);
      this.botManager.changeState('idle');
    }
  }
  
  /**
   * Mine vein of ores - follows connected ores
   */
  async mineVein(oreType) {
    logger.info(`Starting to mine a vein of ${oreType}`);
    this.miningStats.startTime = Date.now();
    this.miningStats.blocksMined = 0;
    
    try {
      // Find the closest ore block
      const blocks = await this.findBlocks(oreType);
      
      if (blocks.length === 0) {
        this.bot.chat(`I couldn't find any ${oreType} nearby.`);
        this.botManager.changeState('idle');
        return;
      }
      
      const startBlock = blocks[0];
      this.bot.chat(`Found a vein of ${oreType} at ${startBlock.position}. Mining...`);
      
      // Extract the ore ID for vein mining
      const oreId = startBlock.type;
      const minedBlocks = new Set(); // Keep track of mined positions
      
      // Mine the starting block
      await this.mineBlock(startBlock);
      minedBlocks.add(`${startBlock.position.x},${startBlock.position.y},${startBlock.position.z}`);
      
      // Continue mining connected blocks
      let foundMore = true;
      while (foundMore) {
        foundMore = false;
        
        // Get current position to check for adjacent blocks
        const nearby = this.findAdjacentBlocks(this.bot.entity.position, oreId, minedBlocks);
        
        if (nearby.length > 0) {
          foundMore = true;
          for (const block of nearby) {
            // Add to mined set before mining to prevent duplicates
            minedBlocks.add(`${block.position.x},${block.position.y},${block.position.z}`);
            await this.mineBlock(block);
          }
        }
      }
      
      this.bot.chat(`Finished mining the vein. Mined ${minedBlocks.size} blocks of ${oreType}.`);
      this.botManager.changeState('idle');
      
    } catch (error) {
      logger.error(`Error in vein mining:`, error);
      this.bot.chat(`I encountered an error while vein mining: ${error.message}`);
      this.botManager.changeState('idle');
    }
  }
  
  /**
   * Find adjacent blocks of the same type
   */
  findAdjacentBlocks(pos, blockId, minedBlocks) {
    const offsets = [
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: -1 }
    ];
    
    const adjacentBlocks = [];
    
    for (const offset of offsets) {
      const checkPos = pos.offset(offset.x, offset.y, offset.z);
      const posKey = `${checkPos.x},${checkPos.y},${checkPos.z}`;
      
      // Skip if already mined
      if (minedBlocks.has(posKey)) continue;
      
      const block = this.bot.blockAt(checkPos);
      if (block && block.type === blockId) {
        adjacentBlocks.push(block);
      }
    }
    
    return adjacentBlocks;
  }
  
  /**
   * Mine the targeted blocks up to the requested amount
   */
  async mineTargets(amount) {
    let minedCount = 0;
    let attemptedBlocks = 0;
    
    while (minedCount < amount && attemptedBlocks < this.targetBlocks.length) {
      const block = this.targetBlocks[attemptedBlocks];
      attemptedBlocks++;
      
      try {
        // Check if the block still exists
        const currentBlock = this.bot.blockAt(block.position);
        if (!currentBlock || currentBlock.type !== block.type) {
          logger.debug(`Block at ${block.position} is no longer the target type`);
          continue;
        }
        
        // Mine the block
        await this.mineBlock(currentBlock);
        minedCount++;
        
        // Update stats
        this.miningStats.blocksMined++;
        if (this.isOreBlock(currentBlock)) {
          this.miningStats.oresMined++;
        }
        
        // Add to resources collected stats
        const blockName = currentBlock.name;
        this.miningStats.resourcesCollected[blockName] = 
          (this.miningStats.resourcesCollected[blockName] || 0) + 1;
        
        if (minedCount % 5 === 0) {
          this.bot.chat(`Mining progress: ${minedCount}/${amount}`);
        }
        
      } catch (error) {
        logger.warn(`Failed to mine block at ${block.position}: ${error.message}`);
        // Continue with next block
      }
    }
    
    // Report mining results
    const duration = (Date.now() - this.miningStats.startTime) / 1000;
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    
    this.bot.chat(`Mining complete! Mined ${minedCount} blocks in ${minutes}m ${seconds}s.`);
    logger.info(`Mining stats: ${JSON.stringify(this.miningStats)}`);
    
    // Return to idle state if done
    this.botManager.changeState('idle');
  }
  
  /**
   * Find blocks of a specific type in the world
   */
  async findBlocks(blockType) {
    try {
      // Check if blockType is a category
      if (blockType in this.botManager.blockUtils.getBlockCategories()) {
        return this.findBlocksByCategory(blockType);
      }
      
      // Get block ID from name
      const blockId = this.mcData.blocksByName[blockType]?.id;
      
      if (!blockId) {
        this.bot.chat(`I don't know what ${blockType} is.`);
        return [];
      }
      
      // Use mineflayer's findBlocks function
      const maxDistance = this.config.mining.maxMiningDistance;
      const positions = this.bot.findBlocks({
        matching: blockId,
        maxDistance: maxDistance,
        count: 100 // Find more than needed to find the closest
      });
      
      if (positions.length === 0) {
        return [];
      }
      
      // Filter out unsafe blocks and convert to Block objects
      const blocks = positions
        .map(pos => this.bot.blockAt(pos))
        .filter(block => block !== null)
        .filter(block => this.isSafeToMine(block));
      
      // Sort by distance
      return this.sortBlocksByDistance(blocks);
      
    } catch (error) {
      logger.error(`Error finding blocks:`, error);
      throw error;
    }
  }
  
  /**
   * Find blocks by category
   */
  async findBlocksByCategory(category) {
    const categories = this.botManager.blockUtils.getBlockCategories();
    if (!categories[category]) {
      throw new Error(`Unknown block category: ${category}`);
    }
    
    const blockNames = categories[category];
    const blockIds = [];
    
    // Convert block names to IDs
    for (const name of blockNames) {
      const id = this.mcData.blocksByName[name]?.id;
      if (id) blockIds.push(id);
    }
    
    if (blockIds.length === 0) {
      return [];
    }
    
    // Find blocks of any type in the category
    const positions = this.bot.findBlocks({
      matching: blockIds,
      maxDistance: this.config.mining.maxMiningDistance,
      count: 100
    });
    
    if (positions.length === 0) {
      return [];
    }
    
    // Filter out unsafe blocks and convert to Block objects
    const blocks = positions
      .map(pos => this.bot.blockAt(pos))
      .filter(block => block !== null)
      .filter(block => this.isSafeToMine(block));
    
    // Sort by distance
    return this.sortBlocksByDistance(blocks);
  }
  
  /**
   * Sort blocks by distance from the bot
   */
  sortBlocksByDistance(blocks) {
    return blocks.sort((a, b) => {
      const distA = a.position.distanceTo(this.bot.entity.position);
      const distB = b.position.distanceTo(this.bot.entity.position);
      return distA - distB;
    });
  }
  
  /**
   * Check if block is safe to mine
   */
  isSafeToMine(block) {
    if (!block) return false;
    
    // Check for safety blocks nearby
    const pos = block.position;
    
    // Check for dangerous blocks nearby
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          // Skip checking the block itself
          if (x === 0 && y === 0 && z === 0) continue;
          
          const nearbyPos = pos.offset(x, y, z);
          const nearbyBlock = this.bot.blockAt(nearbyPos);
          
          if (nearbyBlock && this.safetyBlocks.includes(nearbyBlock.type)) {
            // Found a dangerous block nearby
            return false;
          }
        }
      }
    }
    
    return true;
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
   * Mine a single block
   */
  async mineBlock(block) {
    if (!block) {
      throw new Error('No block specified to mine');
    }
    
    logger.debug(`Mining block ${block.name} at ${block.position}`);
    
    // Check if we can reach the block from current position
    const canReach = await this.canReachBlock(block);
    
    if (!canReach) {
      // Navigate to the block first
      await this.navigateToBlock(block);
    }
    
    // Check again if we can reach after navigating
    if (!await this.canReachBlock(block)) {
      throw new Error(`Cannot reach block at ${block.position} to mine it`);
    }
    
    try {
      // Equip the best tool for this block if tool selection is enabled
      if (this.config.mining.preferredTools) {
        await this.equipBestTool(block);
      }
      
      // Mine the block
      await this.bot.dig(block);
      logger.debug(`Successfully mined ${block.name} at ${block.position}`);
      
      // Wait a bit to collect drops if configured
      if (this.config.mining.collectDrops) {
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      
      return true;
    } catch (error) {
      logger.error(`Failed to mine block:`, error);
      throw error;
    }
  }
  
  /**
   * Check if the bot can reach a block
   */
  async canReachBlock(block) {
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
    
    // Create a goal to get near the block
    const goal = new GoalNear(block.position.x, block.position.y, block.position.z, 2);
    
    // Navigate to the goal
    return new Promise((resolve, reject) => {
      // Set a timeout for pathfinding
      const timeout = setTimeout(() => {
        this.bot.pathfinder.setGoal(null);
        reject(new Error(`Pathfinding timed out after 20 seconds`));
      }, 20000);
      
      // Set up listeners
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
      
      // Fallback method if the pathfinder method doesn't work
      const items = this.bot.inventory.items();
      
      // Find the items that can harvest this block
      const diggers = items.filter(item => 
        block.canHarvest(item.type) && 
        item.type !== this.mcData.itemsByName.air.id
      );
      
      if (diggers.length === 0) {
        logger.debug(`No specific tool for ${block.name}, using hand`);
        await this.bot.unequip('hand');
        return false;
      }
      
      // Sort by harvest speed (approximated by tool material)
      const sorted = diggers.sort((a, b) => {
        // Get tool tier (wooden < stone < iron < diamond < netherite)
        function getToolTier(item) {
          if (item.name.includes('netherite')) return 5;
          if (item.name.includes('diamond')) return 4;
          if (item.name.includes('golden')) return 3;
          if (item.name.includes('iron')) return 2;
          if (item.name.includes('stone')) return 1;
          return 0; // wooden or other
        }
        
        return getToolTier(b) - getToolTier(a);
      });
      
      if (sorted.length > 0) {
        await this.bot.equip(sorted[0], 'hand');
        logger.debug(`Equipped ${sorted[0].name} for mining ${block.name}`);
        return true;
      }
      
      return false;
    } catch (error) {
      logger.warn(`Failed to equip best tool:`, error);
      return false;
    }
  }
  
  /**
   * Strip mine from current location
   */
  async stripMine(direction, length = 10) {
    logger.info(`Starting strip mining in ${direction} direction for ${length} blocks`);
    this.miningStats.startTime = Date.now();
    this.miningStats.blocksMined = 0;
    
    try {
      let directionVector;
      
      // Determine direction vector based on compass direction or vector
      if (typeof direction === 'string') {
        switch (direction.toLowerCase()) {
          case 'north': directionVector = new Vec3(0, 0, -1); break;
          case 'south': directionVector = new Vec3(0, 0, 1); break;
          case 'east': directionVector = new Vec3(1, 0, 0); break;
          case 'west': directionVector = new Vec3(-1, 0, 0); break;
          default: throw new Error(`Unknown direction: ${direction}`);
        }
      } else if (direction.x !== undefined && direction.z !== undefined) {
        // Normalize the direction vector to only go in cardinal directions
        if (Math.abs(direction.x) > Math.abs(direction.z)) {
          directionVector = new Vec3(Math.sign(direction.x), 0, 0);
        } else {
          directionVector = new Vec3(0, 0, Math.sign(direction.z));
        }
      } else {
        throw new Error('Invalid direction specified');
      }
      
      this.bot.chat(`Strip mining in direction (${directionVector.x}, ${directionVector.z}) for ${length} blocks`);
      
      // Current position is starting point
      const startPos = this.bot.entity.position.floored();
      let currentPos = startPos.clone();
      
      // Mine 2 blocks high tunnel
      for (let i = 0; i < length; i++) {
        // Calculate next position in the tunnel
        currentPos = startPos.clone().add(directionVector.scaled(i));
        
        // Mine the two blocks (at eye level and feet level)
        const bottomBlock = this.bot.blockAt(currentPos);
        const topBlock = this.bot.blockAt(currentPos.offset(0, 1, 0));
        
        // Skip air blocks
        if (bottomBlock.name !== 'air') {
          await this.mineBlock(bottomBlock);
        }
        
        if (topBlock.name !== 'air') {
          await this.mineBlock(topBlock);
        }
        
        // Check for ores in adjacent blocks
        await this.checkForOres(currentPos);
        
        // Place a torch every 8 blocks
        if (i > 0 && i % 8 === 0) {
          await this.placeTorch(currentPos);
        }
      }
      
      // Report completion
      const blocksMinedTotal = this.miningStats.blocksMined;
      const oresFound = this.miningStats.oresMined;
      
      this.bot.chat(`Strip mining complete! Mined ${blocksMinedTotal} blocks and found ${oresFound} ores.`);
      this.botManager.changeState('idle');
      
    } catch (error) {
      logger.error(`Error in strip mining:`, error);
      this.bot.chat(`I encountered an error while strip mining: ${error.message}`);
      this.botManager.changeState('idle');
    }
  }
  
  /**
   * Check for ores in blocks adjacent to the current position
   */
  async checkForOres(position) {
    // Check a 3x3 area around the position (excluding the tunnel itself)
    const offsets = [
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: -1 },
      { x: 1, y: 1, z: 0 },
      { x: -1, y: 1, z: 0 },
      { x: 0, y: 1, z: 1 },
      { x: 0, y: 1, z: -1 },
      { x: 0, y: -1, z: 0 },
      { x: 1, y: -1, z: 0 },
      { x: -1, y: -1, z: 0 },
      { x: 0, y: -1, z: 1 },
      { x: 0, y: -1, z: -1 }
    ];
    
    for (const offset of offsets) {
      const checkPos = position.offset(offset.x, offset.y, offset.z);
      const block = this.bot.blockAt(checkPos);
      
      if (block && this.isOreBlock(block)) {
        logger.info(`Found ore (${block.name}) while strip mining!`);
        this.bot.chat(`Found ${block.name}!`);
        
        // Mine the ore
        await this.mineBlock(block);
        
        // Check for connected ores (simple vein mining)
        await this.checkConnectedOres(block);
      }
    }
  }
  
  /**
   * Check for connected ores in a vein
   */
  async checkConnectedOres(startBlock) {
    // Remember which blocks we've checked to avoid loops
    const checkedPositions = new Set();
    const blockType = startBlock.type;
    const positionKey = `${startBlock.position.x},${startBlock.position.y},${startBlock.position.z}`;
    checkedPositions.add(positionKey);
    
    // Simple flood fill algorithm
    const toCheck = [startBlock.position];
    
    while (toCheck.length > 0) {
      const currentPos = toCheck.shift();
      
      // Check adjacent blocks
      const offsets = [
        { x: 1, y: 0, z: 0 },
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 0, z: -1 }
      ];
      
      for (const offset of offsets) {
        const checkPos = currentPos.offset(offset.x, offset.y, offset.z);
        const posKey = `${checkPos.x},${checkPos.y},${checkPos.z}`;
        
        // Skip if we've already checked this position
        if (checkedPositions.has(posKey)) continue;
        
        // Mark as checked
        checkedPositions.add(posKey);
        
        // Check if it's the same type of ore
        const block = this.bot.blockAt(checkPos);
        if (block && block.type === blockType) {
          logger.debug(`Found connected ore at ${checkPos}`);
          
          // Mine this block
          await this.mineBlock(block);
          
          // Add to list to check its neighbors
          toCheck.push(checkPos);
        }
      }
    }
  }
  
  /**
   * Place a torch if available
   */
  async placeTorch(position) {
    try {
      // Find torch in inventory
      const torchItem = this.bot.inventory.items().find(item => item.name === 'torch');
      
      if (!torchItem) {
        logger.debug('No torches available to place');
        return false;
      }
      
      // Find a suitable position for the torch (on the ground or wall)
      const floorPos = position.offset(0, -1, 0);
      const floorBlock = this.bot.blockAt(floorPos);
      
      if (floorBlock && floorBlock.material !== 'air') {
        // Equip torch
        await this.bot.equip(torchItem, 'hand');
        
        // Place on floor
        await this.bot.placeBlock(floorBlock, new Vec3(0, 1, 0));
        logger.debug(`Placed torch at ${position}`);
        return true;
      }
      
      // Try walls if floor placement fails
      const wallOffsets = [
        { x: 1, y: 0, z: 0, face: new Vec3(-1, 0, 0) },
        { x: -1, y: 0, z: 0, face: new Vec3(1, 0, 0) },
        { x: 0, y: 0, z: 1, face: new Vec3(0, 0, -1) },
        { x: 0, y: 0, z: -1, face: new Vec3(0, 0, 1) }
      ];
      
      for (const offset of wallOffsets) {
        const wallPos = position.offset(offset.x, offset.y, offset.z);
        const wallBlock = this.bot.blockAt(wallPos);
        
        if (wallBlock && wallBlock.material !== 'air') {
          // Equip torch
          await this.bot.equip(torchItem, 'hand');
          
          // Place on wall
          await this.bot.placeBlock(wallBlock, offset.face);
          logger.debug(`Placed torch on wall at ${wallPos}`);
          return true;
        }
      }
      
      return false;
    } catch (error) {
      logger.warn(`Failed to place torch:`, error);
      return false;
    }
  }
}

module.exports = MiningBehavior;
