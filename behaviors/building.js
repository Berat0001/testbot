/**
 * Building Behavior Module
 * 
 * Handles building tasks for the bot, including structure
 * construction and block placement.
 */

const Vec3 = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { GoalNear } = goals;
const logger = require('../bot/logger');

class BuildingBehavior {
  constructor(bot, mcData, config, botManager) {
    this.bot = bot;
    this.mcData = mcData;
    this.config = config;
    this.botManager = botManager;
    
    this.isBuilding = false;
    this.currentStructure = null;
    this.structurePlans = null;
    this.buildingMaterials = null;
    
    // Cache for structure templates
    this.structureTemplates = require('../bot/constants').buildingTemplates;
  }
  
  /**
   * Start building a structure
   */
  async build(structureType, material = null) {
    if (this.isBuilding) {
      this.bot.chat('I\'m already building something.');
      return false;
    }
    
    logger.info(`Starting to build a ${structureType} with ${material || 'auto-selected material'}`);
    this.isBuilding = true;
    this.currentStructure = structureType;
    
    try {
      // Get the structure template
      const template = this.structureTemplates[structureType];
      
      if (!template) {
        this.bot.chat(`I don't know how to build a ${structureType}.`);
        this.isBuilding = false;
        return false;
      }
      
      // Select building materials
      this.buildingMaterials = await this.selectBuildingMaterials(material, template.materialCount);
      
      if (!this.buildingMaterials || this.buildingMaterials.length === 0) {
        this.bot.chat(`I don't have enough materials to build a ${structureType}.`);
        this.isBuilding = false;
        return false;
      }
      
      // Find a suitable location to build
      const buildLocation = await this.findBuildLocation(structureType);
      
      if (!buildLocation) {
        this.bot.chat(`I couldn't find a suitable location to build a ${structureType}.`);
        this.isBuilding = false;
        return false;
      }
      
      // Create the structure plan
      this.structurePlans = this.createBuildPlan(structureType, buildLocation);
      
      if (!this.structurePlans || this.structurePlans.length === 0) {
        this.bot.chat(`Failed to create a building plan for ${structureType}.`);
        this.isBuilding = false;
        return false;
      }
      
      // Start building
      this.bot.chat(`Building a ${structureType} at ${buildLocation}. This will take some time...`);
      
      // Execute the build
      const success = await this.executeBuildPlan();
      
      if (success) {
        this.bot.chat(`Finished building the ${structureType}!`);
      } else {
        this.bot.chat(`Couldn't complete the ${structureType}.`);
      }
      
      this.isBuilding = false;
      this.currentStructure = null;
      this.structurePlans = null;
      this.buildingMaterials = null;
      
      return success;
      
    } catch (error) {
      logger.error(`Error in building behavior:`, error);
      this.bot.chat(`I encountered an error while building: ${error.message}`);
      
      this.isBuilding = false;
      this.currentStructure = null;
      this.structurePlans = null;
      this.buildingMaterials = null;
      
      return false;
    }
  }
  
  /**
   * Select appropriate building materials from inventory
   */
  async selectBuildingMaterials(preferredMaterial, requiredCount) {
    const items = this.bot.inventory.items();
    const buildingBlocks = [];
    
    // If a specific material is preferred, try to use it
    if (preferredMaterial) {
      const preferredItems = items.filter(item => 
        item.name.includes(preferredMaterial) && this.isValidBuildingBlock(item)
      );
      
      // Check if we have enough of the preferred material
      const preferredCount = preferredItems.reduce((total, item) => total + item.count, 0);
      
      if (preferredCount >= requiredCount) {
        return preferredItems;
      } else {
        this.bot.chat(`I don't have enough ${preferredMaterial} (need ${requiredCount}, have ${preferredCount}).`);
      }
    }
    
    // Otherwise, collect any suitable building blocks
    for (const item of items) {
      if (this.isValidBuildingBlock(item)) {
        buildingBlocks.push(item);
      }
    }
    
    // Check total count
    const totalBlocks = buildingBlocks.reduce((total, item) => total + item.count, 0);
    
    if (totalBlocks < requiredCount) {
      this.bot.chat(`I don't have enough building materials (need ${requiredCount}, have ${totalBlocks}).`);
      
      // Try to get more building materials if we don't have enough
      if (totalBlocks > 0) {
        // If we have some blocks but not enough, we'll try to build with what we have
        this.bot.chat(`I'll try to build with the ${totalBlocks} blocks I have.`);
        return buildingBlocks;
      }
      
      // Try to mine some basic building blocks
      if (this.botManager.miningBehavior) {
        this.bot.chat(`I'll try to get some building materials.`);
        
        // Try to mine some stone or dirt
        try {
          await this.botManager.miningBehavior.mineBlock('stone', requiredCount - totalBlocks);
        } catch (error) {
          logger.warn(`Failed to mine stone:`, error);
          try {
            await this.botManager.miningBehavior.mineBlock('dirt', requiredCount - totalBlocks);
          } catch (error) {
            logger.warn(`Failed to mine dirt:`, error);
          }
        }
        
        // Check if we got materials
        return await this.selectBuildingMaterials(preferredMaterial, requiredCount);
      }
      
      return [];
    }
    
    return buildingBlocks;
  }
  
  /**
   * Check if an item is a valid building block
   */
  isValidBuildingBlock(item) {
    if (!item) return false;
    
    // Common building blocks
    const validBlocks = [
      'stone', 'cobblestone', 'dirt', 'andesite', 'diorite', 'granite',
      'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks',
      'acacia_planks', 'dark_oak_planks', 'crimson_planks', 'warped_planks',
      'oak_log', 'spruce_log', 'birch_log', 'jungle_log',
      'acacia_log', 'dark_oak_log', 'crimson_stem', 'warped_stem',
      'sandstone', 'brick', 'stone_brick', 'deepslate', 'deepslate_brick',
      'deepslate_tile', 'cobbled_deepslate'
    ];
    
    // Check if the item is in our list or ends with one of these suffixes
    const validSuffixes = ['_planks', '_log', '_wood', '_brick', '_bricks', '_block', '_stone'];
    
    return validBlocks.includes(item.name) || 
           validSuffixes.some(suffix => item.name.endsWith(suffix));
  }
  
  /**
   * Find a suitable location for building
   */
  async findBuildLocation(structureType) {
    const template = this.structureTemplates[structureType];
    if (!template) return null;
    
    // Get dimensions needed for the structure
    const width = template.width || 3;
    const length = template.length || width;
    const height = template.height || 3;
    
    // Start from current position
    const startPos = this.bot.entity.position.floored();
    
    // Search in a spiral pattern
    const maxRadius = 10;
    for (let r = 0; r <= maxRadius; r++) {
      // Check in a square pattern at distance r
      for (let x = -r; x <= r; x++) {
        for (let z = -r; z <= r; z++) {
          // Only check the perimeter of this radius
          if (r > 0 && Math.abs(x) < r && Math.abs(z) < r) continue;
          
          const checkPos = startPos.offset(x, 0, z);
          
          // Check if this area is suitable
          if (await this.isSuitableBuildArea(checkPos, width, length, height)) {
            return checkPos;
          }
        }
      }
    }
    
    // If we couldn't find a naturally suitable area, we might need to clear one
    return await this.clearAreaForBuilding(width, length, height);
  }
  
  /**
   * Check if an area is suitable for building
   */
  async isSuitableBuildArea(position, width, length, height) {
    // Check ground blocks
    const halfWidth = Math.floor(width / 2);
    const halfLength = Math.floor(length / 2);
    
    // Check if ground is solid and relatively flat
    let foundSolidGround = false;
    let groundY = position.y;
    
    // Find ground level (look down up to 3 blocks)
    for (let y = 0; y >= -3; y--) {
      const groundPos = position.offset(0, y, 0);
      const groundBlock = this.bot.blockAt(groundPos);
      
      if (groundBlock && groundBlock.boundingBox === 'block') {
        groundY = groundPos.y + 1; // One above the ground
        foundSolidGround = true;
        break;
      }
    }
    
    if (!foundSolidGround) {
      return false;
    }
    
    // Check the area at the found ground level
    for (let x = -halfWidth; x <= halfWidth; x++) {
      for (let z = -halfLength; z <= halfLength; z++) {
        // Check if ground is solid
        const groundPos = new Vec3(position.x + x, groundY - 1, position.z + z);
        const groundBlock = this.bot.blockAt(groundPos);
        
        if (!groundBlock || groundBlock.boundingBox !== 'block') {
          return false;
        }
        
        // Check if the space above is clear for building
        for (let y = 0; y < height; y++) {
          const checkPos = new Vec3(position.x + x, groundY + y, position.z + z);
          const block = this.bot.blockAt(checkPos);
          
          if (!block) return false; // Outside loaded chunks
          
          if (block.boundingBox !== 'empty') {
            // Space is not clear
            return false;
          }
        }
      }
    }
    
    return true;
  }
  
  /**
   * Clear an area for building
   */
  async clearAreaForBuilding(width, length, height) {
    // Start near the bot
    const startPos = this.bot.entity.position.floored();
    
    // Find the ground level
    let groundY = startPos.y;
    
    // Try to find solid ground within 3 blocks down
    for (let y = 0; y >= -3; y--) {
      const checkPos = startPos.offset(0, y, 0);
      const block = this.bot.blockAt(checkPos);
      
      if (block && block.boundingBox === 'block') {
        groundY = checkPos.y + 1; // One above the ground
        break;
      }
    }
    
    // Set the starting position with the correct ground level
    const buildPos = new Vec3(startPos.x, groundY, startPos.z);
    
    // Calculate the clear area
    const halfWidth = Math.floor(width / 2);
    const halfLength = Math.floor(length / 2);
    
    this.bot.chat(`Clearing an area for building...`);
    
    // Clear the area
    for (let x = -halfWidth; x <= halfWidth; x++) {
      for (let z = -halfLength; z <= halfLength; z++) {
        for (let y = 0; y < height; y++) {
          const pos = buildPos.offset(x, y, z);
          const block = this.bot.blockAt(pos);
          
          if (block && block.boundingBox !== 'empty') {
            try {
              // Skip if this is a protected block type (bedrock, etc.)
              if (block.name === 'bedrock' || block.name === 'barrier') {
                continue;
              }
              
              // Dig the block
              await this.bot.dig(block);
            } catch (error) {
              // Ignore errors and continue
              logger.warn(`Failed to clear block at ${pos}:`, error);
            }
          }
        }
      }
    }
    
    this.bot.chat(`Area cleared for building.`);
    return buildPos;
  }
  
  /**
   * Create a building plan for the structure
   */
  createBuildPlan(structureType, startPosition) {
    const template = this.structureTemplates[structureType];
    if (!template) return [];
    
    const buildPlan = [];
    
    // Different structure types have different build plans
    switch (structureType) {
      case 'wall':
        return this.createWallPlan(template, startPosition);
      case 'tower':
        return this.createTowerPlan(template, startPosition);
      case 'house':
        return this.createHousePlan(template, startPosition);
      case 'bridge':
        return this.createBridgePlan(template, startPosition);
      case 'staircase':
        return this.createStaircasePlan(template, startPosition);
      default:
        logger.warn(`No build plan available for ${structureType}`);
        return [];
    }
  }
  
  /**
   * Create a wall build plan
   */
  createWallPlan(template, startPosition) {
    const width = template.width;
    const height = template.height;
    const buildPlan = [];
    
    // Build from bottom to top, left to right
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pos = startPosition.offset(x - Math.floor(width / 2), y, 0);
        buildPlan.push(pos);
      }
    }
    
    return buildPlan;
  }
  
  /**
   * Create a tower build plan
   */
  createTowerPlan(template, startPosition) {
    const width = template.width;
    const height = template.height;
    const buildPlan = [];
    
    // Calculate the radius (half of width)
    const radius = Math.floor(width / 2);
    
    // Build from bottom to top, in a circular pattern
    for (let y = 0; y < height; y++) {
      // Create a ring for each layer
      for (let x = -radius; x <= radius; x++) {
        for (let z = -radius; z <= radius; z++) {
          // Skip the inner part for hollow tower
          if (y > 0 && y < height - 1 && // Not at base or top
              x > -radius && x < radius &&
              z > -radius && z < radius) {
            continue;
          }
          
          // For a circular tower, use distance from center
          const distSq = x * x + z * z;
          if (distSq <= radius * radius + 1) { // Slightly larger than perfect circle
            const pos = startPosition.offset(x, y, z);
            buildPlan.push(pos);
          }
        }
      }
    }
    
    return buildPlan;
  }
  
  /**
   * Create a house build plan
   */
  createHousePlan(template, startPosition) {
    const width = template.width;
    const length = template.length;
    const height = template.height;
    const buildPlan = [];
    
    // Half dimensions for easier positioning
    const halfWidth = Math.floor(width / 2);
    const halfLength = Math.floor(length / 2);
    
    // Build floor first
    for (let x = -halfWidth; x <= halfWidth; x++) {
      for (let z = -halfLength; z <= halfLength; z++) {
        const pos = startPosition.offset(x, 0, z);
        buildPlan.push(pos);
      }
    }
    
    // Build walls
    for (let y = 1; y < height; y++) {
      for (let x = -halfWidth; x <= halfWidth; x++) {
        for (let z = -halfLength; z <= halfLength; z++) {
          // If it's the edge of the structure, add a wall block
          if (x === -halfWidth || x === halfWidth || 
              z === -halfLength || z === halfLength) {
            
            // Add a door in the middle of one wall
            if (y === 1 && y === 2 && z === -halfLength && x === 0) {
              continue; // Leave space for door
            }
            
            const pos = startPosition.offset(x, y, z);
            buildPlan.push(pos);
          }
        }
      }
    }
    
    // Build roof
    for (let x = -halfWidth - 1; x <= halfWidth + 1; x++) {
      for (let z = -halfLength - 1; z <= halfLength + 1; z++) {
        const pos = startPosition.offset(x, height, z);
        buildPlan.push(pos);
      }
    }
    
    return buildPlan;
  }
  
  /**
   * Create a bridge build plan
   */
  createBridgePlan(template, startPosition) {
    const width = template.width;
    const length = template.length;
    const buildPlan = [];
    
    // Half width for easier positioning
    const halfWidth = Math.floor(width / 2);
    
    // Build the bridge along the Z-axis
    for (let z = 0; z < length; z++) {
      // Build the bridge floor (main walking surface)
      for (let x = -halfWidth; x <= halfWidth; x++) {
        const pos = startPosition.offset(x, 0, z);
        buildPlan.push(pos);
      }
      
      // Build railings on the sides
      const leftRailingPos = startPosition.offset(-halfWidth, 1, z);
      const rightRailingPos = startPosition.offset(halfWidth, 1, z);
      buildPlan.push(leftRailingPos);
      buildPlan.push(rightRailingPos);
    }
    
    return buildPlan;
  }
  
  /**
   * Create a staircase build plan
   */
  createStaircasePlan(template, startPosition) {
    const steps = template.steps;
    const buildPlan = [];
    
    // Build a staircase going up (or down if steps is negative)
    const direction = 1; // 1 for up, -1 for down
    
    // Build each step
    for (let step = 0; step < Math.abs(steps); step++) {
      // Calculate position for this step
      const x = 0;
      const y = step * direction;
      const z = step;
      
      // Add the step block
      const stepPos = startPosition.offset(x, y, z);
      buildPlan.push(stepPos);
      
      // Add blocks on either side for safety
      buildPlan.push(startPosition.offset(x - 1, y, z));
      buildPlan.push(startPosition.offset(x + 1, y, z));
      
      // Add blocks under the step for support (if building upward)
      if (direction > 0 && step > 0) {
        for (let supportY = 0; supportY < y; supportY++) {
          buildPlan.push(startPosition.offset(x, supportY, z));
        }
      }
    }
    
    return buildPlan;
  }
  
  /**
   * Execute the build plan
   */
  async executeBuildPlan() {
    if (!this.structurePlans || this.structurePlans.length === 0) {
      return false;
    }
    
    let successCount = 0;
    const totalBlocks = this.structurePlans.length;
    
    // Go through each position in the plan
    for (let i = 0; i < this.structurePlans.length; i++) {
      const position = this.structurePlans[i];
      
      try {
        // Check if there's already a block here
        const existingBlock = this.bot.blockAt(position);
        if (existingBlock && existingBlock.boundingBox === 'block') {
          // Skip if there's already a solid block
          successCount++;
          continue;
        }
        
        // Navigate close to the position
        const goal = new GoalNear(position.x, position.y, position.z, 3);
        await this.botManager.pathfindingManager.setGoal(goal);
        
        // Select a building material
        const material = this.getNextBuildingMaterial();
        if (!material) {
          this.bot.chat(`I've run out of building materials after ${successCount} blocks!`);
          return successCount > 0;
        }
        
        // Equip the material
        await this.bot.equip(material, 'hand');
        
        // Place the block
        const placed = await this.placeBlock(position, material);
        
        if (placed) {
          successCount++;
        }
        
        // Provide progress updates
        if (i % 5 === 0 || i === this.structurePlans.length - 1) {
          const progress = Math.floor((i + 1) / totalBlocks * 100);
          this.bot.chat(`Building progress: ${progress}% (${i + 1}/${totalBlocks})`);
        }
        
      } catch (error) {
        logger.warn(`Failed to place block at ${position}:`, error);
        // Continue with the next block
      }
    }
    
    const successPercent = Math.floor(successCount / totalBlocks * 100);
    this.bot.chat(`Building complete! Placed ${successCount}/${totalBlocks} blocks (${successPercent}%)`);
    
    return successCount > 0;
  }
  
  /**
   * Get the next building material from inventory
   */
  getNextBuildingMaterial() {
    if (!this.buildingMaterials || this.buildingMaterials.length === 0) {
      return null;
    }
    
    // Find a material that still has blocks left
    for (let i = 0; i < this.buildingMaterials.length; i++) {
      const material = this.buildingMaterials[i];
      
      // Skip if the count is 0
      if (material.count <= 0) continue;
      
      // Update the inventory to make sure counts are accurate
      const inventory = this.bot.inventory.items();
      const updatedMaterial = inventory.find(item => item.name === material.name);
      
      if (updatedMaterial && updatedMaterial.count > 0) {
        return updatedMaterial;
      }
    }
    
    // If we're here, try to find any suitable building block in inventory
    const inventory = this.bot.inventory.items();
    for (const item of inventory) {
      if (this.isValidBuildingBlock(item) && item.count > 0) {
        return item;
      }
    }
    
    return null;
  }
  
  /**
   * Place a block at a specific position
   */
  async placeBlock(position, item) {
    try {
      // First, find a block face to place against
      const targetBlock = await this.findAdjacentBlock(position);
      
      if (!targetBlock) {
        logger.warn(`No adjacent block found to place against at ${position}`);
        return false;
      }
      
      // Calculate the face to place on
      const faceVector = position.minus(targetBlock.position);
      
      // Equip the block
      await this.bot.equip(item, 'hand');
      
      // Look at the target block
      await this.bot.lookAt(targetBlock.position.offset(0.5, 0.5, 0.5));
      
      // Place the block
      await this.bot.placeBlock(targetBlock, faceVector);
      
      // Verify the block was placed
      const newBlock = this.bot.blockAt(position);
      return newBlock && newBlock.boundingBox === 'block';
      
    } catch (error) {
      logger.warn(`Failed to place block at ${position}:`, error);
      return false;
    }
  }
  
  /**
   * Find an adjacent block to place against
   */
  async findAdjacentBlock(position) {
    // Check all possible adjacent positions
    const adjacentOffsets = [
      new Vec3(0, -1, 0), // Below
      new Vec3(0, 1, 0),  // Above
      new Vec3(-1, 0, 0), // West
      new Vec3(1, 0, 0),  // East
      new Vec3(0, 0, -1), // North
      new Vec3(0, 0, 1),  // South
    ];
    
    for (const offset of adjacentOffsets) {
      const adjacentPos = position.plus(offset);
      const block = this.bot.blockAt(adjacentPos);
      
      if (block && block.boundingBox === 'block') {
        return block;
      }
    }
    
    // If no adjacent block found, try to create one
    for (const offset of adjacentOffsets) {
      const adjacentPos = position.plus(offset);
      const block = this.bot.blockAt(adjacentPos);
      
      // Skip if there's already a solid block
      if (block && block.boundingBox === 'block') continue;
      
      // Try to place a block here first
      const material = this.getNextBuildingMaterial();
      if (material) {
        // Recursively try to place a block at this adjacent position
        const placedSupport = await this.placeBlock(adjacentPos, material);
        
        if (placedSupport) {
          // Return the newly placed block
          return this.bot.blockAt(adjacentPos);
        }
      }
    }
    
    return null;
  }
  
  /**
   * Repair a broken structure
   */
  async repairStructure(structureType, position) {
    this.bot.chat(`Examining ${structureType} at ${position} for repairs...`);
    
    // Create a template plan for the structure
    const template = this.structureTemplates[structureType];
    if (!template) {
      this.bot.chat(`I don't know how to repair a ${structureType}.`);
      return false;
    }
    
    // Generate what the structure should look like
    const idealPlan = this.createBuildPlan(structureType, position);
    if (!idealPlan || idealPlan.length === 0) {
      this.bot.chat(`Failed to create a repair plan for ${structureType}.`);
      return false;
    }
    
    // Check which blocks are missing
    const missingBlocks = [];
    for (const blockPos of idealPlan) {
      const block = this.bot.blockAt(blockPos);
      
      if (!block || block.boundingBox !== 'block') {
        missingBlocks.push(blockPos);
      }
    }
    
    if (missingBlocks.length === 0) {
      this.bot.chat(`The ${structureType} is in perfect condition!`);
      return true;
    }
    
    this.bot.chat(`Found ${missingBlocks.length} blocks to repair in the ${structureType}.`);
    
    // Get building materials
    this.buildingMaterials = await this.selectBuildingMaterials(null, missingBlocks.length);
    
    if (!this.buildingMaterials || this.buildingMaterials.length === 0) {
      this.bot.chat(`I don't have materials to repair the ${structureType}.`);
      return false;
    }
    
    // Repair the missing blocks
    let repairedCount = 0;
    
    for (const blockPos of missingBlocks) {
      try {
        // Navigate close to the position
        const goal = new GoalNear(blockPos.x, blockPos.y, blockPos.z, 3);
        await this.botManager.pathfindingManager.setGoal(goal);
        
        // Select a building material
        const material = this.getNextBuildingMaterial();
        if (!material) {
          this.bot.chat(`I've run out of repair materials after fixing ${repairedCount} blocks.`);
          return repairedCount > 0;
        }
        
        // Place the block
        const placed = await this.placeBlock(blockPos, material);
        
        if (placed) {
          repairedCount++;
          
          // Provide progress updates
          if (repairedCount % 5 === 0 || repairedCount === missingBlocks.length) {
            const progress = Math.floor(repairedCount / missingBlocks.length * 100);
            this.bot.chat(`Repair progress: ${progress}% (${repairedCount}/${missingBlocks.length})`);
          }
        }
        
      } catch (error) {
        logger.warn(`Failed to repair block at ${blockPos}:`, error);
        // Continue with the next block
      }
    }
    
    const successPercent = Math.floor(repairedCount / missingBlocks.length * 100);
    this.bot.chat(`Repairs complete! Fixed ${repairedCount}/${missingBlocks.length} blocks (${successPercent}%)`);
    
    return repairedCount > 0;
  }
}

module.exports = BuildingBehavior;
