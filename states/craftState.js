/**
 * Craft State for Minecraft Bot
 * 
 * In this state, the bot will craft items from gathered resources,
 * including tools, armor, and other useful items.
 */

// Import our custom StateBehavior base class
const StateBehavior = require('../bot/stateBehavior');
const Vec3 = require('vec3');
const logger = require('../bot/logger');

class CraftState extends StateBehavior {
  constructor(bot, botManager) {
    super(bot, 'craft');
    this.botManager = botManager;
    
    this.timeInState = 0;
    this.craftQueue = [];
    this.currentRecipe = null;
    this.craftingTablePosition = null;
    this.missingIngredients = {};
    this.itemsCrafted = {};
    this.craftingComplete = false;
    this.craftStartTime = 0;
    this.lastProgressUpdate = 0;
  }

  onStateEntered() {
    this.timeInState = 0;
    this.craftQueue = [];
    this.currentRecipe = null;
    this.missingIngredients = {};
    this.itemsCrafted = {};
    this.craftingComplete = false;
    this.craftStartTime = Date.now();
    this.lastProgressUpdate = 0;
    
    logger.info('Entered craft state');
    this.bot.chat('Beginning crafting session.');
    
    // Determine what to craft based on needs
    this.determineCraftingNeeds();
  }

  onStateExited() {
    logger.info('Exited craft state');
    this.reportCraftingResults();
    
    // Clean up crafting state
    this.craftQueue = [];
    this.currentRecipe = null;
    
    // Stop any pathfinding
    if (this.bot.pathfinder && this.bot.pathfinder.isMoving()) {
      this.bot.pathfinder.setGoal(null);
    }
  }

  /**
   * Determine what items we need to craft
   */
  determineCraftingNeeds() {
    logger.info('Determining crafting needs');
    
    // First, check if we need a crafting table
    const hasCraftingTable = this.bot.inventory.items().some(
      item => item.name === 'crafting_table'
    );
    
    if (!hasCraftingTable) {
      logger.info('Adding crafting table to craft queue');
      this.addItemToCraftQueue('crafting_table', 1);
    }
    
    // Check for basic tools
    this.checkToolNeeds();
    
    // Check for armor
    this.checkArmorNeeds();
    
    // Check for other useful items
    this.checkOtherItemNeeds();
    
    // If craft queue is empty, we're done
    if (this.craftQueue.length === 0) {
      logger.info('No crafting needs identified');
      this.bot.chat('Nothing to craft at the moment.');
      this.craftingComplete = true;
      return;
    }
    
    // Start the crafting process
    logger.info(`Craft queue: ${this.craftQueue.map(item => item.name).join(', ')}`);
    this.bot.chat(`I'll craft ${this.craftQueue.length} items.`);
    
    // Process the first item in queue
    this.processNextCraftingItem();
  }

  /**
   * Check what tools we need to craft
   */
  checkToolNeeds() {
    // Get current tools from inventory
    const items = this.bot.inventory.items();
    
    // Check for wooden pickaxe or better
    const hasPickaxe = items.some(item => 
      item.name.includes('_pickaxe')
    );
    
    if (!hasPickaxe) {
      // Try to craft best pickaxe possible
      if (this.countItem('iron_ingot') >= 3) {
        this.addItemToCraftQueue('iron_pickaxe', 1);
      } else if (this.countItem('cobblestone') >= 3) {
        this.addItemToCraftQueue('stone_pickaxe', 1);
      } else {
        this.addItemToCraftQueue('wooden_pickaxe', 1);
      }
    }
    
    // Check for axe
    const hasAxe = items.some(item => 
      item.name.includes('_axe')
    );
    
    if (!hasAxe) {
      // Try to craft best axe possible
      if (this.countItem('iron_ingot') >= 3) {
        this.addItemToCraftQueue('iron_axe', 1);
      } else if (this.countItem('cobblestone') >= 3) {
        this.addItemToCraftQueue('stone_axe', 1);
      } else {
        this.addItemToCraftQueue('wooden_axe', 1);
      }
    }
    
    // Check for sword
    const hasSword = items.some(item => 
      item.name.includes('_sword')
    );
    
    if (!hasSword) {
      // Try to craft best sword possible
      if (this.countItem('iron_ingot') >= 2) {
        this.addItemToCraftQueue('iron_sword', 1);
      } else if (this.countItem('cobblestone') >= 2) {
        this.addItemToCraftQueue('stone_sword', 1);
      } else {
        this.addItemToCraftQueue('wooden_sword', 1);
      }
    }
    
    // Check for shovel
    const hasShovel = items.some(item => 
      item.name.includes('_shovel')
    );
    
    if (!hasShovel) {
      // Try to craft best shovel possible
      if (this.countItem('iron_ingot') >= 1) {
        this.addItemToCraftQueue('iron_shovel', 1);
      } else if (this.countItem('cobblestone') >= 1) {
        this.addItemToCraftQueue('stone_shovel', 1);
      } else {
        this.addItemToCraftQueue('wooden_shovel', 1);
      }
    }
  }

  /**
   * Check what armor we need to craft
   */
  checkArmorNeeds() {
    // Only consider armor if we have enough materials
    if (this.countItem('iron_ingot') < 5) return;
    
    const items = this.bot.inventory.items();
    
    // Check helmet
    const hasHelmet = items.some(item => item.name.includes('helmet'));
    if (!hasHelmet && this.countItem('iron_ingot') >= 5) {
      this.addItemToCraftQueue('iron_helmet', 1);
    }
    
    // Check chestplate
    const hasChestplate = items.some(item => item.name.includes('chestplate'));
    if (!hasChestplate && this.countItem('iron_ingot') >= 8) {
      this.addItemToCraftQueue('iron_chestplate', 1);
    }
    
    // Check leggings
    const hasLeggings = items.some(item => item.name.includes('leggings'));
    if (!hasLeggings && this.countItem('iron_ingot') >= 7) {
      this.addItemToCraftQueue('iron_leggings', 1);
    }
    
    // Check boots
    const hasBoots = items.some(item => item.name.includes('boots'));
    if (!hasBoots && this.countItem('iron_ingot') >= 4) {
      this.addItemToCraftQueue('iron_boots', 1);
    }
  }

  /**
   * Check what other useful items we need to craft
   */
  checkOtherItemNeeds() {
    const items = this.bot.inventory.items();
    
    // Check for sticks (needed for tools)
    if (this.countItem('stick') < 4) {
      // Need planks for sticks
      const planksCount = this.countItem('planks') + 
                         this.countItem('oak_planks') +
                         this.countItem('spruce_planks') +
                         this.countItem('birch_planks') +
                         this.countItem('jungle_planks') +
                         this.countItem('acacia_planks') +
                         this.countItem('dark_oak_planks');
      
      if (planksCount < 2) {
        // Need to craft planks first
        const logCount = this.countItem('oak_log') +
                        this.countItem('spruce_log') +
                        this.countItem('birch_log') +
                        this.countItem('jungle_log') +
                        this.countItem('acacia_log') +
                        this.countItem('dark_oak_log');
        
        if (logCount > 0) {
          // Figure out which log type we have
          let logType = 'oak_log';
          
          ['oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log'].forEach(type => {
            if (this.countItem(type) > 0) logType = type;
          });
          
          // Convert the log type to plank type
          const plankType = logType.replace('_log', '_planks');
          
          this.addItemToCraftQueue(plankType, 4); // 1 log -> 4 planks
        }
      }
      
      // Add sticks to the queue
      this.addItemToCraftQueue('stick', 4); // 2 planks -> 4 sticks
    }
    
    // Check for furnace
    const hasFurnace = items.some(item => item.name === 'furnace');
    if (!hasFurnace && this.countItem('cobblestone') >= 8) {
      this.addItemToCraftQueue('furnace', 1);
    }
    
    // Check for chest
    const hasChest = items.some(item => item.name === 'chest');
    if (!hasChest && (this.countItem('oak_planks') >= 8 || 
                    this.countItem('spruce_planks') >= 8 ||
                    this.countItem('birch_planks') >= 8 ||
                    this.countItem('jungle_planks') >= 8 ||
                    this.countItem('acacia_planks') >= 8 ||
                    this.countItem('dark_oak_planks') >= 8)) {
      this.addItemToCraftQueue('chest', 1);
    }
    
    // Check for shield
    const hasShield = items.some(item => item.name === 'shield');
    if (!hasShield && this.countItem('iron_ingot') >= 1 && 
        (this.countItem('oak_planks') >= 6 || 
         this.countItem('spruce_planks') >= 6 ||
         this.countItem('birch_planks') >= 6 ||
         this.countItem('jungle_planks') >= 6 ||
         this.countItem('acacia_planks') >= 6 ||
         this.countItem('dark_oak_planks') >= 6)) {
      this.addItemToCraftQueue('shield', 1);
    }
  }

  /**
   * Count how many of a specific item we have in inventory
   */
  countItem(itemName) {
    const items = this.bot.inventory.items().filter(
      item => item.name === itemName || item.name.includes(itemName)
    );
    
    return items.reduce((sum, item) => sum + item.count, 0);
  }

  /**
   * Add an item to the crafting queue
   */
  addItemToCraftQueue(itemName, count = 1) {
    this.craftQueue.push({
      name: itemName,
      count: count
    });
  }

  /**
   * Process the next item in the crafting queue
   */
  processNextCraftingItem() {
    // If queue is empty, we're done
    if (this.craftQueue.length === 0) {
      logger.info('Crafting queue is empty');
      this.bot.chat('Finished crafting all items.');
      this.craftingComplete = true;
      return;
    }
    
    // Get the next item to craft
    const item = this.craftQueue[0];
    logger.info(`Attempting to craft: ${item.name} x${item.count}`);
    
    // Find the recipe
    let recipes = this.bot.recipesFor(item.name, null, 1, null);
    
    // If no recipe found, try for similar names
    if (recipes.length === 0) {
      // Try common variations (like oak_planks vs planks)
      const variations = [
        item.name,
        item.name.replace('oak_', ''),
        item.name.replace('spruce_', ''),
        item.name.replace('birch_', ''),
        item.name.replace('jungle_', ''),
        item.name.replace('acacia_', ''),
        item.name.replace('dark_oak_', '')
      ];
      
      for (const variation of variations) {
        recipes = this.bot.recipesFor(variation, null, 1, null);
        if (recipes.length > 0) break;
      }
    }
    
    // Check if we found recipes
    if (recipes.length === 0) {
      logger.warn(`No recipe found for ${item.name}, skipping`);
      this.bot.chat(`I don't know how to craft ${item.name}.`);
      this.craftQueue.shift();
      this.processNextCraftingItem();
      return;
    }
    
    // Choose the best recipe (prefer the one with fewer ingredients)
    recipes.sort((a, b) => a.ingredients.length - b.ingredients.length);
    const recipe = recipes[0];
    this.currentRecipe = recipe;
    
    // Check if we have all ingredients
    const missingIngredients = this.checkIngredientsForRecipe(recipe);
    
    if (Object.keys(missingIngredients).length > 0) {
      // We're missing some ingredients
      this.missingIngredients = missingIngredients;
      
      logger.warn(`Missing ingredients for ${item.name}: ${Object.entries(missingIngredients)
        .map(([name, count]) => `${count} ${name}`)
        .join(', ')}`);
      
      this.bot.chat(`I can't craft ${item.name} yet, missing ingredients.`);
      
      // Move this item to the end of the queue
      this.craftQueue.push(this.craftQueue.shift());
      
      // If we've tried all items and still have missing ingredients, give up
      if (this.craftQueue.every(queuedItem => 
        Object.keys(this.checkIngredientsForRecipe(this.bot.recipesFor(queuedItem.name, null, 1, null)[0] || {})).length > 0
      )) {
        logger.warn('Unable to craft any items in queue due to missing ingredients');
        this.bot.chat('I need more materials before I can craft anything.');
        this.craftingComplete = true;
      } else {
        // Try the next item
        this.processNextCraftingItem();
      }
      
      return;
    }
    
    // We have all ingredients, check if we need a crafting table
    if (recipe.requiresTable) {
      this.ensureCraftingTable()
        .then(() => this.performCrafting(recipe, item))
        .catch(error => {
          logger.error(`Error ensuring crafting table: ${error.message}`);
          this.bot.chat('Had trouble with the crafting table.');
          this.craftQueue.shift();
          this.processNextCraftingItem();
        });
    } else {
      // We can craft in inventory
      this.performCrafting(recipe, item)
        .catch(error => {
          logger.error(`Error crafting ${item.name}: ${error.message}`);
          this.bot.chat(`Had trouble crafting ${item.name}.`);
          this.craftQueue.shift();
          this.processNextCraftingItem();
        });
    }
  }

  /**
   * Check if we have all ingredients for a recipe
   * @returns object with missing ingredients and counts
   */
  checkIngredientsForRecipe(recipe) {
    const missingIngredients = {};
    
    if (!recipe || !recipe.ingredients) return missingIngredients;
    
    // Get the inventory contents
    const inventory = this.bot.inventory.items();
    
    // Check each ingredient
    for (const ingredient of recipe.ingredients) {
      // Skip empty ingredient slots
      if (!ingredient) continue;
      
      // Find matching item in inventory
      let haveCount = 0;
      for (const item of inventory) {
        if (item.type === ingredient.type) {
          haveCount += item.count;
        }
      }
      
      // Check if we have enough
      if (haveCount < ingredient.count) {
        const ingredientName = ingredient.name || 'unknown_item';
        missingIngredients[ingredientName] = ingredient.count - haveCount;
      }
    }
    
    return missingIngredients;
  }

  /**
   * Ensure we have a crafting table placed and accessible
   */
  async ensureCraftingTable() {
    // First check inventory for crafting table
    const craftingTableItem = this.bot.inventory.items().find(
      item => item.name === 'crafting_table'
    );
    
    // If we don't have one, but we need to craft with one, we have an issue
    if (!craftingTableItem) {
      logger.warn('Need crafting table but none in inventory');
      throw new Error('Need crafting table but none in inventory');
    }
    
    // Check if we already know about a crafting table
    if (this.craftingTablePosition) {
      // Make sure it's still there
      const block = this.bot.blockAt(this.craftingTablePosition);
      if (block && block.name === 'crafting_table') {
        // Table is still there, move to it
        await this.moveToBlock(block);
        return;
      }
      
      // Table is gone, need to place a new one
      this.craftingTablePosition = null;
    }
    
    // Look for nearby crafting table
    logger.info('Looking for nearby crafting table');
    const craftingTableBlock = this.bot.findBlock({
      matching: block => block.name === 'crafting_table',
      maxDistance: 16
    });
    
    if (craftingTableBlock) {
      this.craftingTablePosition = craftingTableBlock.position;
      logger.info(`Found existing crafting table at ${this.craftingTablePosition}`);
      await this.moveToBlock(craftingTableBlock);
      return;
    }
    
    // Need to place a crafting table
    logger.info('Need to place a crafting table');
    
    // Find a suitable position near us
    const placementPos = await this.findPlacementPosition();
    if (!placementPos) {
      throw new Error('Could not find a place to put crafting table');
    }
    
    // Equip the crafting table
    await this.bot.equip(craftingTableItem, 'hand');
    
    // Place the crafting table
    const targetBlock = this.bot.blockAt(placementPos.adjacentBlockPos);
    await this.bot.placeBlock(targetBlock, placementPos.direction);
    
    // Get the position of the newly placed table
    const offsetPos = placementPos.adjacentBlockPos.offset(
      placementPos.direction.x,
      placementPos.direction.y,
      placementPos.direction.z
    );
    
    this.craftingTablePosition = offsetPos;
    logger.info(`Placed crafting table at ${this.craftingTablePosition}`);
    
    // Wait a moment for the block to be properly registered
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  /**
   * Find a suitable position to place a block near the bot
   */
  async findPlacementPosition() {
    // Get the bot's position
    const botPos = this.bot.entity.position.floored();
    
    // Check positions around the bot
    const adjacentOffsets = [
      { x: 0, y: 0, z: 1 },  // North
      { x: 1, y: 0, z: 0 },  // East
      { x: 0, y: 0, z: -1 }, // South
      { x: -1, y: 0, z: 0 }  // West
    ];
    
    for (const offset of adjacentOffsets) {
      const adjacentPos = botPos.offset(offset.x, offset.y, offset.z);
      const adjacentBlock = this.bot.blockAt(adjacentPos);
      
      // Skip if this position isn't a solid block that we can place against
      if (!adjacentBlock || !adjacentBlock.solid) continue;
      
      // Check if the position above is clear for placement
      const placePos = adjacentPos.offset(0, 1, 0);
      const placeBlock = this.bot.blockAt(placePos);
      
      if (placeBlock && placeBlock.name === 'air') {
        // This is a valid place to put our crafting table
        // The direction is the opposite of the offset
        return {
          adjacentBlockPos: adjacentPos,
          direction: { x: -offset.x, y: 0, z: -offset.z }
        };
      }
    }
    
    // If we can't find a spot at bot level, check below
    const belowPos = botPos.offset(0, -1, 0);
    const belowBlock = this.bot.blockAt(belowPos);
    
    if (belowBlock && belowBlock.solid) {
      return {
        adjacentBlockPos: belowPos,
        direction: { x: 0, y: 1, z: 0 }
      };
    }
    
    return null;
  }

  /**
   * Move to a block position
   */
  async moveToBlock(block) {
    // If pathfinder is available, use it
    if (this.bot.pathfinder) {
      const pathfinder = require('mineflayer-pathfinder');
      const { goals } = pathfinder;
      
      const goal = new goals.GoalGetToBlock(
        block.position.x,
        block.position.y,
        block.position.z
      );
      
      this.bot.pathfinder.setGoal(goal);
      
      // Wait until we're there or timeout
      const startTime = Date.now();
      while (this.bot.pathfinder.isMoving() && Date.now() - startTime < 10000) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      if (this.bot.pathfinder.isMoving()) {
        this.bot.pathfinder.setGoal(null);
        throw new Error('Pathfinding to crafting table timed out');
      }
    } else {
      // Simple movement if pathfinder not available
      this.bot.lookAt(block.position);
      this.bot.setControlState('forward', true);
      
      // Wait a bit and then stop
      await new Promise(resolve => setTimeout(resolve, 1000));
      this.bot.clearControlStates();
    }
  }

  /**
   * Perform the actual crafting operation
   */
  async performCrafting(recipe, item) {
    try {
      logger.info(`Crafting ${item.name} x${item.count}`);
      
      // If we need a crafting table, we should be near one now
      if (recipe.requiresTable) {
        const craftingTable = this.bot.blockAt(this.craftingTablePosition);
        if (!craftingTable || craftingTable.name !== 'crafting_table') {
          throw new Error('Expected crafting table but none found');
        }
        
        // Craft at the table
        await this.bot.craft(recipe, item.count, craftingTable);
      } else {
        // Craft in inventory
        await this.bot.craft(recipe, item.count);
      }
      
      // Successfully crafted
      logger.info(`Successfully crafted ${item.name} x${item.count}`);
      this.bot.chat(`Crafted ${item.name}.`);
      
      // Record what we crafted
      if (!this.itemsCrafted[item.name]) {
        this.itemsCrafted[item.name] = 0;
      }
      this.itemsCrafted[item.name] += item.count;
      
      // Remove from queue
      this.craftQueue.shift();
      
      // Process next item after a short delay
      setTimeout(() => this.processNextCraftingItem(), 500);
    } catch (error) {
      logger.error(`Error crafting ${item.name}: ${error.message}`);
      this.bot.chat(`Failed to craft ${item.name}: ${error.message}`);
      
      // Move this item to the end of the queue
      this.craftQueue.push(this.craftQueue.shift());
      
      // Try next item
      this.processNextCraftingItem();
    }
  }

  /**
   * Main update function for the craft state
   */
  update() {
    this.timeInState += 1;
    
    // Check for safety periodically
    this.checkSafetyConditions();
    
    // Provide progress updates
    const now = Date.now();
    if (now - this.lastProgressUpdate > 30000) { // Every 30 seconds
      this.lastProgressUpdate = now;
      this.updateCraftingProgress();
    }
    
    // If crafting is complete, transition away
    if (this.craftingComplete) {
      return;
    }
    
    // If we're stuck in this state too long, timeout
    if (this.timeInState > 2400) { // About 2 minutes at 20 tps
      logger.warn('Crafting state has timed out');
      this.bot.chat('Taking too long to craft, moving on.');
      this.craftingComplete = true;
    }
  }

  /**
   * Check safety conditions during crafting
   */
  checkSafetyConditions() {
    // Check for nearby hostile mobs
    const hostileMobs = this.findNearbyHostileMobs();
    if (hostileMobs.length > 0 && hostileMobs[0].distance < 8) {
      logger.warn(`Hostile mob detected during crafting: ${hostileMobs[0].name}`);
      // We'll let the state machine's shouldTransition method handle the actual state change
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
        'zombie', 'skeleton', 'creeper', 'spider', 'enderman',
        'witch', 'slime', 'phantom', 'drowned', 'husk', 'stray'
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
   * Update crafting progress information
   */
  updateCraftingProgress() {
    // Calculate how long we've been crafting
    const craftingTime = (Date.now() - this.craftStartTime) / 1000; // in seconds
    
    // Summarize what we've crafted so far
    const itemsCrafted = Object.entries(this.itemsCrafted)
      .map(([item, count]) => `${count} ${item}`)
      .join(', ');
    
    logger.info(`Crafting progress after ${craftingTime.toFixed(0)} seconds: ${itemsCrafted || 'nothing yet'}`);
    
    if (this.craftQueue.length > 0) {
      this.bot.chat(`Still crafting. ${this.craftQueue.length} items in queue.`);
    }
  }

  /**
   * Report crafting results when exiting the state
   */
  reportCraftingResults() {
    // Calculate how long we spent crafting
    const craftingTime = (Date.now() - this.craftStartTime) / 1000; // in seconds
    
    // Summarize what we crafted
    const itemsSummary = Object.entries(this.itemsCrafted)
      .map(([item, count]) => `${count} ${item}`)
      .join(', ');
    
    if (itemsSummary) {
      logger.info(`Crafting complete. Created: ${itemsSummary} in ${craftingTime.toFixed(0)} seconds`);
      this.bot.chat(`Crafting complete. Created: ${itemsSummary}`);
    } else {
      logger.info(`Crafting complete. Nothing crafted in ${craftingTime.toFixed(0)} seconds`);
      this.bot.chat('Crafting complete. Created nothing.');
    }
  }

  /**
   * Determine if we should transition to another state
   */
  shouldTransition(nextState) {
    // Scenarios where we'd want to transition
    switch (nextState) {
      case 'combat':
        return this.shouldTransitionToCombat();
      case 'idle':
        return this.shouldTransitionToIdle();
      case 'gather':
        return this.shouldTransitionToGather();
      case 'follow':
        return this.shouldTransitionToFollow();
      default:
        return false;
    }
  }

  /**
   * Check if we should transition to combat state
   */
  shouldTransitionToCombat() {
    const hostileMobs = this.findNearbyHostileMobs();
    
    // If there's a very close hostile mob, switch to combat
    return hostileMobs.length > 0 && hostileMobs[0].distance < 5;
  }

  /**
   * Check if we should transition to idle state
   */
  shouldTransitionToIdle() {
    // Transition to idle if crafting is complete
    return this.craftingComplete;
  }

  /**
   * Check if we should transition to gather state
   */
  shouldTransitionToGather() {
    // If we are missing ingredients and need to gather resources
    return Object.keys(this.missingIngredients).length > 0;
  }

  /**
   * Check if we should transition to follow state
   */
  shouldTransitionToFollow() {
    // If owner issues a command to follow, this would return true
    // For now, just check if the owner is nearby and we're done crafting
    if (!this.botManager.owner) return false;
    
    const owner = this.bot.players[this.botManager.owner];
    if (!owner || !owner.entity) return false;
    
    const distanceToOwner = owner.entity.position.distanceTo(this.bot.entity.position);
    
    return this.craftingComplete && distanceToOwner < 20;
  }
}

module.exports = CraftState;