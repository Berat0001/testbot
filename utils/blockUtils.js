/**
 * Block Utilities
 * 
 * Provides helper functions for working with blocks in the Minecraft world.
 */

const Vec3 = require('vec3');
const logger = require('../bot/logger');

class BlockUtils {
  constructor(bot, config) {
    this.bot = bot;
    this.config = config;
    
    // Initialize block categories
    this.blockCategories = {
      'ores': [
        'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'emerald_ore', 'lapis_ore', 'redstone_ore',
        'copper_ore', 'nether_gold_ore', 'nether_quartz_ore', 'ancient_debris', 'deepslate_coal_ore',
        'deepslate_iron_ore', 'deepslate_gold_ore', 'deepslate_diamond_ore', 'deepslate_emerald_ore', 
        'deepslate_lapis_ore', 'deepslate_redstone_ore', 'deepslate_copper_ore'
      ],
      'stone': [
        'stone', 'granite', 'diorite', 'andesite', 'deepslate', 'tuff', 'basalt', 'blackstone',
        'cobblestone', 'mossy_cobblestone', 'smooth_stone', 'sandstone', 'red_sandstone'
      ],
      'wood': [
        'oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log',
        'mangrove_log', 'cherry_log', 'crimson_stem', 'warped_stem', 'oak_wood', 'spruce_wood',
        'birch_wood', 'jungle_wood', 'acacia_wood', 'dark_oak_wood', 'mangrove_wood', 'cherry_wood'
      ],
      'crops': [
        'wheat', 'carrots', 'potatoes', 'beetroots', 'pumpkin', 'melon', 'sugar_cane',
        'cactus', 'bamboo', 'cocoa', 'sweet_berry_bush', 'kelp', 'sea_pickle'
      ],
      'soil': [
        'dirt', 'grass_block', 'podzol', 'mycelium', 'moss_block', 'rooted_dirt',
        'farmland', 'mud', 'muddy_mangrove_roots', 'clay', 'soul_soil'
      ],
      'sand': [
        'sand', 'red_sand', 'gravel', 'suspicious_sand'
      ]
    };
  }

  /**
   * Initialize block utilities
   */
  initialize() {
    logger.info('Block utilities initialized');
  }
  
  /**
   * Get block categories
   * Used for finding blocks by category (ores, stone, wood, etc.)
   */
  getBlockCategories() {
    return this.blockCategories;
  }

  /**
   * Check if a block is safe to stand on
   */
  isSafeToStandOn(block) {
    if (!block) return false;
    
    // Make sure the block is stable to stand on
    if (!block.solid) return false;
    
    // Check for dangerous blocks
    if (this.isDangerousBlock(block)) return false;
    
    // Check that there's enough headroom
    const blockAbove1 = this.bot.blockAt(block.position.offset(0, 1, 0));
    const blockAbove2 = this.bot.blockAt(block.position.offset(0, 2, 0));
    
    return (!blockAbove1 || !blockAbove1.solid) && 
           (!blockAbove2 || !blockAbove2.solid);
  }

  /**
   * Check if a block is dangerous to stand on
   */
  isDangerousBlock(block) {
    if (!block) return false;
    
    const dangerousBlocks = [
      'lava', 'flowing_lava', 'fire', 'cactus', 'magma_block',
      'sweet_berry_bush', 'campfire', 'soul_campfire'
    ];
    
    return dangerousBlocks.some(name => block.name.includes(name));
  }

  /**
   * Find a safe standing position near a target position
   */
  findSafeStandingPositionNear(targetPos, maxDistance = 3) {
    // First, check if the target position itself is safe
    const blockAtTarget = this.bot.blockAt(targetPos);
    const blockBelowTarget = this.bot.blockAt(targetPos.offset(0, -1, 0));
    
    if (blockBelowTarget && this.isSafeToStandOn(blockBelowTarget) &&
        (!blockAtTarget || !blockAtTarget.solid)) {
      return targetPos;
    }
    
    // Define offsets to check in spiral pattern, starting close to target
    const offsets = [];
    for (let d = 1; d <= maxDistance; d++) {
      for (let x = -d; x <= d; x++) {
        for (let z = -d; z <= d; z++) {
          // Only check the perimeter of each distance
          if (Math.abs(x) === d || Math.abs(z) === d) {
            offsets.push({x, y: 0, z});
          }
        }
      }
    }
    
    // Check each position for safety
    for (const offset of offsets) {
      const pos = targetPos.offset(offset.x, offset.y, offset.z);
      const blockBelow = this.bot.blockAt(pos.offset(0, -1, 0));
      const blockAt = this.bot.blockAt(pos);
      const blockAbove = this.bot.blockAt(pos.offset(0, 1, 0));
      
      if (blockBelow && this.isSafeToStandOn(blockBelow) &&
          (!blockAt || !blockAt.solid) &&
          (!blockAbove || !blockAbove.solid)) {
        return pos;
      }
    }
    
    // If no safe position found at y level, try above and below
    for (let y = 1; y <= maxDistance; y++) {
      // Try above
      const posAbove = targetPos.offset(0, y, 0);
      const blockBelowAbove = this.bot.blockAt(posAbove.offset(0, -1, 0));
      const blockAtAbove = this.bot.blockAt(posAbove);
      const blockAboveAbove = this.bot.blockAt(posAbove.offset(0, 1, 0));
      
      if (blockBelowAbove && this.isSafeToStandOn(blockBelowAbove) &&
          (!blockAtAbove || !blockAtAbove.solid) &&
          (!blockAboveAbove || !blockAboveAbove.solid)) {
        return posAbove;
      }
      
      // Try below
      const posBelow = targetPos.offset(0, -y, 0);
      const blockBelowBelow = this.bot.blockAt(posBelow.offset(0, -1, 0));
      const blockAtBelow = this.bot.blockAt(posBelow);
      const blockAboveBelow = this.bot.blockAt(posBelow.offset(0, 1, 0));
      
      if (blockBelowBelow && this.isSafeToStandOn(blockBelowBelow) &&
          (!blockAtBelow || !blockAtBelow.solid) &&
          (!blockAboveBelow || !blockAboveBelow.solid)) {
        return posBelow;
      }
    }
    
    // No safe position found
    return null;
  }

  /**
   * Check if a block can be mined with the bot's current tools
   */
  canMineBlock(block) {
    if (!block) return false;
    
    // Some blocks can't be mined at all
    if (block.name === 'bedrock' || block.name === 'barrier' || 
        block.name.includes('command_block')) {
      return false;
    }
    
    // Liquids can't be mined
    if (block.name.includes('water') || block.name.includes('lava')) {
      return false;
    }
    
    // Check if we have the proper tool
    const items = this.bot.inventory.items();
    
    // If it's something that usually needs a tool (hardness > 1)
    if (block.hardness > 1) {
      // Stone-like blocks need pickaxe
      if (this.isStoneType(block)) {
        return items.some(item => item.name.includes('pickaxe'));
      }
      
      // Wood-like blocks are faster with axe
      if (this.isWoodType(block)) {
        return items.some(item => item.name.includes('axe'));
      }
      
      // Dirt-like blocks are faster with shovel
      if (this.isDirtType(block)) {
        return items.some(item => item.name.includes('shovel'));
      }
    }
    
    // If we get here, either the block doesn't need a special tool or we don't care
    return true;
  }

  /**
   * Check if a block is a stone-type that needs a pickaxe
   */
  isStoneType(block) {
    const stoneTypes = [
      'stone', 'cobblestone', 'andesite', 'diorite', 'granite',
      'sandstone', 'netherrack', 'concrete', 'obsidian',
      'ore', 'coal', 'iron', 'gold', 'diamond', 'emerald', 'redstone', 'lapis'
    ];
    
    return stoneTypes.some(type => block.name.includes(type));
  }

  /**
   * Check if a block is a wood-type that is best mined with an axe
   */
  isWoodType(block) {
    const woodTypes = [
      'log', 'planks', 'wood', 'door', 'fence', 'gate', 'trapdoor',
      'chest', 'crafting_table', 'bookshelf'
    ];
    
    return woodTypes.some(type => block.name.includes(type));
  }

  /**
   * Check if a block is a dirt-type that is best mined with a shovel
   */
  isDirtType(block) {
    const dirtTypes = [
      'dirt', 'grass', 'podzol', 'mycelium', 'sand', 'gravel', 
      'clay', 'soul_sand', 'soul_soil', 'farmland'
    ];
    
    return dirtTypes.some(type => block.name.includes(type));
  }

  /**
   * Find a block face that can be interacted with
   */
  findInteractableFace(blockPos) {
    const cardinalFaces = [
      { x: 0, y: 0, z: 1 },  // North
      { x: 0, y: 0, z: -1 }, // South
      { x: 1, y: 0, z: 0 },  // East
      { x: -1, y: 0, z: 0 }, // West
      { x: 0, y: 1, z: 0 },  // Up
      { x: 0, y: -1, z: 0 }  // Down
    ];
    
    // Start with checking if we can place at the exact position
    const block = this.bot.blockAt(blockPos);
    if (!block || !block.solid) {
      // Position is free, find an adjacent block to place against
      for (const face of cardinalFaces) {
        const adjPos = blockPos.offset(face.x, face.y, face.z);
        const adjBlock = this.bot.blockAt(adjPos);
        
        if (adjBlock && adjBlock.solid) {
          // Found a solid block to place against
          return { 
            position: blockPos,
            adjacentBlock: adjBlock,
            face: { x: -face.x, y: -face.y, z: -face.z }
          };
        }
      }
    }
    
    // If we need to interact with the block at that position
    // Find an adjacent free space that we can interact from
    for (const face of cardinalFaces) {
      const adjPos = blockPos.offset(face.x, face.y, face.z);
      const adjBlock = this.bot.blockAt(adjPos);
      
      if (!adjBlock || !adjBlock.solid) {
        // Check if we have headroom (for the player)
        const headBlock = this.bot.blockAt(adjPos.offset(0, 1, 0));
        if (!headBlock || !headBlock.solid) {
          return {
            position: adjPos,
            block: block,
            face: face
          };
        }
      }
    }
    
    return null;
  }

  /**
   * Check if a position is safe for digging (won't cause lava flows, etc.)
   */
  isSafeToDigAt(pos) {
    // Check for dangerous blocks nearby
    const cardinalDirections = [
      { x: 0, y: 0, z: 1 },  // North
      { x: 0, y: 0, z: -1 }, // South
      { x: 1, y: 0, z: 0 },  // East
      { x: -1, y: 0, z: 0 }, // West
      { x: 0, y: 1, z: 0 },  // Up
      { x: 0, y: -1, z: 0 }  // Down
    ];
    
    for (const dir of cardinalDirections) {
      const adjPos = pos.offset(dir.x, dir.y, dir.z);
      const adjBlock = this.bot.blockAt(adjPos);
      
      if (adjBlock && (adjBlock.name.includes('lava') || adjBlock.name.includes('water'))) {
        // Adjacent to liquid, might be dangerous
        return false;
      }
    }
    
    return true;
  }

  /**
   * Find the nearest block of a specific type
   */
  findNearestBlock(blockType, options = {}) {
    const maxDistance = options.maxDistance || 32;
    const count = options.count || 10;
    
    try {
      const blockId = this.bot.registry.blocksByName[blockType]?.id;
      if (blockId === undefined) {
        logger.warn(`Unknown block type: ${blockType}`);
        return null;
      }
      
      const blockPositions = this.bot.findBlocks({
        matching: blockId,
        maxDistance: maxDistance,
        count: count
      });
      
      if (blockPositions.length === 0) {
        return null;
      }
      
      // Convert to block objects and sort by distance
      const blocks = blockPositions
        .map(pos => this.bot.blockAt(pos))
        .filter(block => block !== null);
      
      if (blocks.length === 0) {
        return null;
      }
      
      // Sort by distance
      blocks.sort((a, b) => {
        const distA = a.position.distanceTo(this.bot.entity.position);
        const distB = b.position.distanceTo(this.bot.entity.position);
        return distA - distB;
      });
      
      return blocks[0];
    } catch (error) {
      logger.warn(`Error finding nearest ${blockType}:`, error);
      return null;
    }
  }

  /**
   * Find all blocks of a specific type within range
   */
  findBlocksOfType(blockType, options = {}) {
    const maxDistance = options.maxDistance || 32;
    const count = options.count || 100;
    
    try {
      const blockId = this.bot.registry.blocksByName[blockType]?.id;
      if (blockId === undefined) {
        logger.warn(`Unknown block type: ${blockType}`);
        return [];
      }
      
      const blockPositions = this.bot.findBlocks({
        matching: blockId,
        maxDistance: maxDistance,
        count: count
      });
      
      // Convert to block objects and filter out nulls
      return blockPositions
        .map(pos => this.bot.blockAt(pos))
        .filter(block => block !== null);
    } catch (error) {
      logger.warn(`Error finding blocks of type ${blockType}:`, error);
      return [];
    }
  }

  /**
   * Get the layer type at a specific Y level
   */
  getLevelType(y) {
    // Determine likely layer type based on Y position
    // These values work for vanilla terrain generation
    if (y < 0) return 'void';
    if (y < 5) return 'bedrock';
    if (y < 12) return 'deep_underground';
    if (y < 30) return 'diamond_level';
    if (y < 50) return 'underground';
    if (y < 60) return 'cave_level';
    if (y < 64) return 'sea_level';
    if (y < 70) return 'surface';
    if (y < 80) return 'low_mountains';
    if (y < 120) return 'mountains';
    if (y < 240) return 'high_mountains';
    return 'sky';
  }

  /**
   * Find blocks in a vein (connected blocks of same type)
   */
  findBlocksInVein(startBlock, maxBlocks = 20) {
    if (!startBlock) return [];
    
    const targetType = startBlock.name;
    const veinBlocks = [startBlock];
    const checkedPositions = new Set();
    
    // Add the starting position to checked set
    checkedPositions.add(`${startBlock.position.x},${startBlock.position.y},${startBlock.position.z}`);
    
    // Process each block in the vein
    let index = 0;
    while (index < veinBlocks.length && veinBlocks.length < maxBlocks) {
      const block = veinBlocks[index];
      
      // Check adjacent blocks
      const adjacentPositions = [
        block.position.offset(1, 0, 0),
        block.position.offset(-1, 0, 0),
        block.position.offset(0, 1, 0),
        block.position.offset(0, -1, 0),
        block.position.offset(0, 0, 1),
        block.position.offset(0, 0, -1)
      ];
      
      for (const pos of adjacentPositions) {
        const posKey = `${pos.x},${pos.y},${pos.z}`;
        
        // Skip if already checked
        if (checkedPositions.has(posKey)) continue;
        checkedPositions.add(posKey);
        
        // Check if this adjacent block is the same type
        const adjacentBlock = this.bot.blockAt(pos);
        if (adjacentBlock && adjacentBlock.name === targetType) {
          veinBlocks.push(adjacentBlock);
          
          // Limit size of vein
          if (veinBlocks.length >= maxBlocks) break;
        }
      }
      
      index++;
    }
    
    return veinBlocks;
  }
}

module.exports = BlockUtils;