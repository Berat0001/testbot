/**
 * Survival Behavior Module
 * 
 * Handles survival-related tasks for the bot, including
 * food management, health recovery, and danger avoidance.
 */

const Vec3 = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { GoalNear, GoalGetToBlock } = goals;
const logger = require('../bot/logger');

class SurvivalBehavior {
  constructor(bot, mcData, config, botManager) {
    this.bot = bot;
    this.mcData = mcData;
    this.config = config;
    this.botManager = botManager;
    
    this.isBusy = false;
    this.isEating = false;
    this.isCollecting = false;
    this.targetItems = [];
    
    // Food items in order of preference (higher saturation first)
    this.foodPreferences = [
      'golden_carrot', 'cooked_beef', 'cooked_porkchop', 
      'cooked_mutton', 'cooked_salmon', 'cooked_chicken',
      'cooked_rabbit', 'mushroom_stew', 'rabbit_stew',
      'bread', 'baked_potato', 'carrot', 'apple', 
      'melon_slice', 'cookie', 'potato', 'beetroot'
    ];
    
    // Banned foods (unless critical)
    this.bannedFoods = this.config.autoEat.bannedFood || [
      'rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish'
    ];
    
    // Items to always collect
    this.valuableItems = [
      'diamond', 'emerald', 'gold_ingot', 'iron_ingot', 'netherite_ingot',
      'diamond_ore', 'emerald_ore', 'gold_ore', 'iron_ore', 'netherite_scrap',
      'diamond_sword', 'diamond_pickaxe', 'diamond_axe', 'diamond_shovel',
      'enchanted_book', 'experience_bottle', 'ender_pearl', 'golden_apple',
      'enchanted_golden_apple', 'totem_of_undying'
    ];
  }
  
  /**
   * Check whether the bot needs food
   */
  needsFood() {
    return this.bot.food <= this.config.autoEat.startAt;
  }
  
  /**
   * Eat food to restore hunger and health
   */
  async eat(foodName = null) {
    if (this.isEating) return;
    
    this.isEating = true;
    logger.info(`Trying to eat food${foodName ? ': ' + foodName : ''}`);
    
    try {
      // If auto-eat is enabled and available, use it
      if (this.config.autoEat.enabled && this.bot.autoEat) {
        if (foodName) {
          // Find the specific food item if requested
          const items = this.bot.inventory.items();
          const foodItem = items.find(item => item.name.toLowerCase() === foodName.toLowerCase());
          
          if (foodItem) {
            this.bot.autoEat.eat(foodItem);
          } else {
            this.bot.chat(`I don't have any ${foodName} to eat.`);
            this.isEating = false;
            return false;
          }
        } else {
          // Let auto-eat choose the best food
          this.bot.autoEat.eat();
        }
        
        // Wait for eating to complete
        await new Promise(resolve => setTimeout(resolve, 2000));
        this.isEating = false;
        return true;
      }
      
      // If auto-eat is not available, use manual eating
      return await this.manualEat(foodName);
      
    } catch (error) {
      logger.error(`Error while eating:`, error);
      this.isEating = false;
      return false;
    }
  }
  
  /**
   * Manual eating implementation
   */
  async manualEat(foodName = null) {
    // Get all food items from inventory
    const items = this.bot.inventory.items();
    let foodItems = items.filter(item => this.isEdible(item.name));
    
    // If we have a specific food requested, filter for it
    if (foodName) {
      foodItems = foodItems.filter(item => item.name.toLowerCase() === foodName.toLowerCase());
    } else {
      // Sort by preference
      foodItems.sort((a, b) => {
        const indexA = this.foodPreferences.indexOf(a.name);
        const indexB = this.foodPreferences.indexOf(b.name);
        
        // If both foods are in the preference list, sort by preference
        if (indexA !== -1 && indexB !== -1) {
          return indexA - indexB;
        }
        
        // If only one is in the list, prefer that one
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        
        // Otherwise, just sort alphabetically
        return a.name.localeCompare(b.name);
      });
      
      // Filter out banned foods unless we're desperate
      if (this.bot.food > 2) {
        foodItems = foodItems.filter(item => !this.bannedFoods.includes(item.name));
      }
    }
    
    if (foodItems.length === 0) {
      this.bot.chat(`I don't have any ${foodName || 'food'} to eat.`);
      this.isEating = false;
      return false;
    }
    
    // Get the best food to eat
    const foodToEat = foodItems[0];
    logger.debug(`Eating ${foodToEat.name}`);
    
    try {
      // Equip the food
      await this.bot.equip(foodToEat, 'hand');
      
      // Start consuming (right click)
      await this.bot.consume();
      
      this.bot.chat(`Ate ${foodToEat.name}. Food level: ${this.bot.food}/20`);
      this.isEating = false;
      return true;
    } catch (error) {
      logger.error(`Failed to eat ${foodToEat.name}:`, error);
      this.isEating = false;
      return false;
    }
  }
  
  /**
   * Check if an item is edible
   */
  isEdible(itemName) {
    if (!itemName) return false;
    
    const edibleItems = [
      'apple', 'mushroom_stew', 'bread', 'porkchop', 'cooked_porkchop', 
      'golden_apple', 'enchanted_golden_apple', 'cod', 'salmon', 'tropical_fish', 
      'pufferfish', 'cooked_cod', 'cooked_salmon', 'cookie', 'melon_slice', 
      'dried_kelp', 'beef', 'cooked_beef', 'chicken', 'cooked_chicken', 
      'rotten_flesh', 'spider_eye', 'carrot', 'potato', 'baked_potato', 
      'poisonous_potato', 'golden_carrot', 'pumpkin_pie', 'rabbit', 'cooked_rabbit', 
      'rabbit_stew', 'mutton', 'cooked_mutton', 'beetroot', 'beetroot_soup', 
      'sweet_berries', 'honey_bottle', 'suspicious_stew'
    ];
    
    return edibleItems.includes(itemName);
  }
  
  /**
   * Collect nearby items or specific items
   */
  async collectItems(itemName = null) {
    if (this.isCollecting) return;
    
    this.isCollecting = true;
    logger.info(`Collecting items${itemName ? ': ' + itemName : ''}`);
    
    try {
      // Get all nearby dropped items
      const droppedItems = Object.values(this.bot.entities)
        .filter(entity => entity.type === 'object' && entity.objectType === 'Item');
      
      if (droppedItems.length === 0) {
        this.bot.chat('No items found nearby.');
        this.isCollecting = false;
        return;
      }
      
      // Filter items if a specific name was requested
      let targetItems = droppedItems;
      if (itemName) {
        targetItems = droppedItems.filter(entity => {
          // Try to get the item name from the entity
          const metadata = entity.metadata;
          if (metadata && metadata.length > 7 && metadata[7]) {
            const itemStack = metadata[7];
            return itemStack.itemName && itemStack.itemName.toLowerCase().includes(itemName.toLowerCase());
          }
          return false;
        });
      }
      
      if (targetItems.length === 0) {
        this.bot.chat(`No ${itemName} found nearby.`);
        this.isCollecting = false;
        return;
      }
      
      this.bot.chat(`Found ${targetItems.length} items to collect.`);
      
      // Sort items by priority and distance
      targetItems.sort((a, b) => {
        // First check if it's a valuable item
        const aValuable = this.isValuableItem(a);
        const bValuable = this.isValuableItem(b);
        
        if (aValuable && !bValuable) return -1;
        if (!aValuable && bValuable) return 1;
        
        // Otherwise sort by distance
        const distA = a.position.distanceTo(this.bot.entity.position);
        const distB = b.position.distanceTo(this.bot.entity.position);
        return distA - distB;
      });
      
      // Collect the items
      for (const item of targetItems) {
        try {
          // Check if item is still valid
          if (!item.isValid) continue;
          
          // Navigate to the item
          const goal = new GoalNear(item.position.x, item.position.y, item.position.z, 1);
          await this.botManager.pathfindingManager.setGoal(goal);
          
          // Wait a short time to see if we pick it up automatically
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Check if we've already collected the item
          if (!item.isValid) {
            logger.debug(`Collected item.`);
            continue;
          }
          
          // If item is still there, try to look at it and move closer
          await this.bot.lookAt(item.position);
          await this.bot.pathfinder.goto(goal);
          
          // Wait again to see if we pick it up
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (error) {
          logger.warn(`Failed to collect item:`, error);
          // Continue with next item
        }
      }
      
      this.bot.chat('Finished collecting items.');
      
    } catch (error) {
      logger.error(`Error collecting items:`, error);
      this.bot.chat(`Error collecting items: ${error.message}`);
    } finally {
      this.isCollecting = false;
    }
  }
  
  /**
   * Check if an entity is a valuable item
   */
  isValuableItem(entity) {
    if (!entity || entity.type !== 'object' || entity.objectType !== 'Item') {
      return false;
    }
    
    // Try to get the item name from the entity
    const metadata = entity.metadata;
    if (metadata && metadata.length > 7 && metadata[7]) {
      const itemStack = metadata[7];
      
      if (itemStack.itemName) {
        return this.valuableItems.some(valuable => 
          itemStack.itemName.toLowerCase().includes(valuable.toLowerCase()));
      }
    }
    
    return false;
  }
  
  /**
   * Find shelter when in danger (night, rain, low health)
   */
  async findShelter() {
    logger.info('Looking for shelter');
    this.bot.chat('Looking for shelter...');
    
    // Check for existing shelters nearby (houses, caves, etc.)
    const possibleShelter = await this.findExistingShelter();
    
    if (possibleShelter) {
      // We found a shelter, go to it
      this.bot.chat('Found possible shelter.');
      await this.botManager.pathfindingManager.goto(possibleShelter);
      return true;
    }
    
    // If no existing shelter found, build a simple one
    this.bot.chat('No shelter found. Building a simple shelter.');
    return await this.buildSimpleShelter();
  }
  
  /**
   * Find an existing shelter (building, cave, etc.)
   */
  async findExistingShelter() {
    // Look for structures with roofs (we just need a roof block above us)
    // Search in a spiral pattern from the bot's position
    const center = this.bot.entity.position.floored();
    const radius = 20; // Search radius
    
    // Simple spiral search
    for (let r = 1; r <= radius; r++) {
      for (let x = -r; x <= r; x++) {
        for (let z = -r; z <= r; z++) {
          // Only check the perimeter of this radius
          if (Math.abs(x) < r && Math.abs(z) < r) continue;
          
          const pos = center.offset(x, 0, z);
          
          // Check if this is a valid shelter location
          if (await this.isShelterAt(pos)) {
            return pos;
          }
        }
      }
    }
    
    return null;
  }
  
  /**
   * Check if a position can serve as shelter
   */
  async isShelterAt(pos) {
    // Check if there's at least 2 blocks of empty space for the bot
    const blockAtFeet = this.bot.blockAt(pos);
    const blockAtHead = this.bot.blockAt(pos.offset(0, 1, 0));
    
    if (!blockAtFeet || !blockAtHead) return false;
    
    if (blockAtFeet.boundingBox !== 'empty' || blockAtHead.boundingBox !== 'empty') {
      return false;
    }
    
    // Check if there's a solid block above (roof)
    const blockAboveHead = this.bot.blockAt(pos.offset(0, 2, 0));
    
    if (!blockAboveHead || blockAboveHead.boundingBox !== 'block') {
      return false;
    }
    
    // Check if the position is safe (no lava, etc.)
    return this.isSafePosition(pos);
  }
  
  /**
   * Check if a position is safe
   */
  isSafePosition(pos) {
    // Check for dangerous blocks in a small area
    for (let y = -1; y <= 1; y++) {
      for (let x = -1; x <= 1; x++) {
        for (let z = -1; z <= 1; z++) {
          const block = this.bot.blockAt(pos.offset(x, y, z));
          
          if (!block) continue;
          
          if (block.name === 'lava' || block.name === 'flowing_lava' || 
              block.name === 'fire' || block.name === 'soul_fire' ||
              block.name === 'cactus') {
            return false;
          }
        }
      }
    }
    
    return true;
  }
  
  /**
   * Build a simple emergency shelter
   */
  async buildSimpleShelter() {
    logger.info('Building a simple shelter');
    
    try {
      // Find a flat area first
      const flatArea = await this.findFlatArea();
      
      if (!flatArea) {
        this.bot.chat("Couldn't find a flat area to build shelter.");
        return false;
      }
      
      // Get building materials
      const buildingBlocks = this.getBuildingMaterials();
      
      if (buildingBlocks.length === 0) {
        this.bot.chat("I don't have any blocks to build with.");
        return false;
      }
      
      // Go to the flat area
      await this.botManager.pathfindingManager.goto(flatArea);
      
      // Build a simple 1x2x1 shelter (just enough to cover the bot)
      this.bot.chat('Building a simple shelter...');
      
      // First place a block on the ground to stand on
      const groundBlock = buildingBlocks[0];
      await this.bot.equip(groundBlock, 'hand');
      
      // Get blocks around to place against
      const currentPos = this.bot.entity.position.floored();
      
      // Place blocks in a box shape around the bot
      // First place the floor block
      const floorPos = currentPos.offset(0, -1, 0);
      await this.placeBlock(groundBlock, floorPos);
      
      // Place wall blocks
      for (let x = -1; x <= 1; x++) {
        for (let z = -1; z <= 1; z++) {
          if (x === 0 && z === 0) continue; // Skip center block
          
          // Place wall blocks (2 high)
          const wallBlock = buildingBlocks[0];
          await this.bot.equip(wallBlock, 'hand');
          
          for (let y = 0; y <= 1; y++) {
            const wallPos = currentPos.offset(x, y, z);
            await this.placeBlock(wallBlock, wallPos);
          }
        }
      }
      
      // Place roof blocks
      for (let x = -1; x <= 1; x++) {
        for (let z = -1; z <= 1; z++) {
          const roofBlock = buildingBlocks[0];
          await this.bot.equip(roofBlock, 'hand');
          
          const roofPos = currentPos.offset(x, 2, z);
          await this.placeBlock(roofBlock, roofPos);
        }
      }
      
      this.bot.chat('Simple shelter built!');
      return true;
      
    } catch (error) {
      logger.error(`Error building shelter:`, error);
      this.bot.chat(`Failed to build shelter: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Find a flat area to build on
   */
  async findFlatArea() {
    // Look for a 3x3 flat area
    const startPos = this.bot.entity.position.floored();
    
    // Scan in expanding squares from the bot's position
    for (let radius = 0; radius < 10; radius++) {
      for (let x = -radius; x <= radius; x++) {
        for (let z = -radius; z <= radius; z++) {
          // Only check the perimeter of this radius
          if (radius > 0 && Math.abs(x) < radius && Math.abs(z) < radius) continue;
          
          const checkPos = startPos.offset(x, 0, z);
          
          // Check if this 3x3 area is flat
          if (await this.isAreaFlat(checkPos, 3, 3)) {
            return checkPos;
          }
        }
      }
    }
    
    return null;
  }
  
  /**
   * Check if an area is flat enough to build on
   */
  async isAreaFlat(center, width, length) {
    // Check if all blocks in the area have the same height and are solid
    const halfWidth = Math.floor(width / 2);
    const halfLength = Math.floor(length / 2);
    const groundHeight = center.y - 1; // One block below the bot
    
    for (let x = -halfWidth; x <= halfWidth; x++) {
      for (let z = -halfLength; z <= halfLength; z++) {
        const pos = center.offset(x, -1, z);
        const block = this.bot.blockAt(pos);
        
        // Check if the ground block is solid
        if (!block || block.boundingBox !== 'block') {
          return false;
        }
        
        // Check if there's enough empty space above
        const blockAbove1 = this.bot.blockAt(pos.offset(0, 1, 0));
        const blockAbove2 = this.bot.blockAt(pos.offset(0, 2, 0));
        const blockAbove3 = this.bot.blockAt(pos.offset(0, 3, 0));
        
        if (!blockAbove1 || !blockAbove2 || !blockAbove3 ||
            blockAbove1.boundingBox !== 'empty' ||
            blockAbove2.boundingBox !== 'empty' ||
            blockAbove3.boundingBox !== 'empty') {
          return false;
        }
      }
    }
    
    return true;
  }
  
  /**
   * Get building materials from inventory
   */
  getBuildingMaterials() {
    const items = this.bot.inventory.items();
    
    // Look for blocks that can be used for building
    const buildingBlocks = items.filter(item => {
      // Basic block detection
      const isBlock = item.name.includes('_planks') || 
                     item.name.includes('stone') ||
                     item.name.includes('dirt') ||
                     item.name.includes('cobblestone') ||
                     item.name === 'stone' ||
                     item.name === 'andesite' ||
                     item.name === 'diorite' ||
                     item.name === 'granite';
      
      // Check if we have enough of them (at least 10)
      return isBlock && item.count >= 10;
    });
    
    return buildingBlocks;
  }
  
  /**
   * Place a block at a position
   */
  async placeBlock(item, position) {
    try {
      // Find a face to place against
      const faces = [
        new Vec3(0, 1, 0), // Up
        new Vec3(0, -1, 0), // Down
        new Vec3(1, 0, 0), // East
        new Vec3(-1, 0, 0), // West
        new Vec3(0, 0, 1), // South
        new Vec3(0, 0, -1), // North
      ];
      
      for (const face of faces) {
        const targetBlock = this.bot.blockAt(position.minus(face));
        
        if (targetBlock && targetBlock.boundingBox === 'block') {
          // Equip the block
          await this.bot.equip(item, 'hand');
          
          // Look at the block we're placing against
          await this.bot.lookAt(targetBlock.position.offset(0.5, 0.5, 0.5));
          
          // Place the block
          await this.bot.placeBlock(targetBlock, face);
          return true;
        }
      }
      
      return false;
    } catch (error) {
      logger.warn(`Failed to place block:`, error);
      return false;
    }
  }
  
  /**
   * Check if it's night time
   */
  isNightTime() {
    // Time is in ticks (24000 ticks in a day)
    // Night starts at 13000 and ends at 23000
    const time = this.bot.time.timeOfDay;
    return time >= 13000 && time < 23000;
  }
  
  /**
   * Check if it's raining
   */
  isRaining() {
    return this.bot.isRaining;
  }
  
  /**
   * Handle morning tasks when day starts
   */
  async handleMorning() {
    logger.info('Morning routine started');
    this.bot.chat('Good morning! Starting my daily tasks.');
    
    // Check food levels and eat if needed
    if (this.needsFood()) {
      await this.eat();
    }
    
    // Check inventory and organize if needed
    if (this.botManager.inventoryManager) {
      await this.botManager.inventoryManager.organizeInventory();
    }
    
    // Check tools and craft if needed
    if (this.botManager.craftingBehavior) {
      await this.botManager.craftingBehavior.checkAndCraftTools();
    }
    
    // Look for nearby ores to mine
    if (this.botManager.miningBehavior) {
      const ores = await this.botManager.miningBehavior.findBlocks('ores');
      if (ores.length > 0) {
        this.bot.chat(`Found ${ores.length} ore blocks nearby.`);
      }
    }
    
    this.bot.chat('Ready for today\'s adventures!');
  }
}

module.exports = SurvivalBehavior;
