/**
 * Crafting Behavior Module
 * 
 * Handles crafting tasks for the bot, including recipe handling,
 * crafting table interactions, and tool creation.
 */

const Vec3 = require('vec3');
const logger = require('../bot/logger');

class CraftingBehavior {
  constructor(bot, mcData, config, botManager) {
    this.bot = bot;
    this.mcData = mcData;
    this.config = config;
    this.botManager = botManager;
    
    this.isCrafting = false;
    this.hasCraftingTable = false;
    this.craftingTablePosition = null;
    
    // When bot loads, check if it has a crafting table
    this.checkForCraftingTable();
  }
  
  /**
   * Check if the bot has a crafting table in inventory
   */
  checkForCraftingTable() {
    const items = this.bot.inventory.items();
    this.hasCraftingTable = items.some(item => item.name === 'crafting_table');
    
    if (this.hasCraftingTable) {
      logger.debug('Bot has a crafting table in inventory');
    }
  }
  
  /**
   * Craft an item with a specific amount
   */
  async craftItem(itemName, amount = 1) {
    if (this.isCrafting) {
      return;
    }
    
    this.isCrafting = true;
    logger.info(`Attempting to craft ${amount}x ${itemName}`);
    
    try {
      // Normalize item name (some items have different names in recipes)
      const normalizedName = this.normalizeItemName(itemName);
      
      // Get recipes for this item
      const recipes = this.bot.recipesFor(normalizedName, null, 1, null);
      
      if (recipes.length === 0) {
        this.bot.chat(`I don't know how to craft ${itemName}.`);
        this.isCrafting = false;
        return false;
      }
      
      // Choose a recipe (prefer ones we have ingredients for)
      let selectedRecipe = null;
      
      for (const recipe of recipes) {
        if (this.hasIngredientsForRecipe(recipe)) {
          selectedRecipe = recipe;
          break;
        }
      }
      
      // If no recipe with available ingredients, use the first one
      if (!selectedRecipe) {
        selectedRecipe = recipes[0];
        
        // Check what ingredients we're missing
        const missingIngredients = this.getMissingIngredients(selectedRecipe);
        if (missingIngredients.length > 0) {
          const missingNames = missingIngredients.map(i => i.name).join(', ');
          this.bot.chat(`I'm missing ingredients for ${itemName}: ${missingNames}`);
          
          // Try to gather missing ingredients
          await this.gatherMissingIngredients(missingIngredients);
          
          // Check again if we have the ingredients
          if (!this.hasIngredientsForRecipe(selectedRecipe)) {
            this.bot.chat(`I still don't have all the ingredients for ${itemName}.`);
            this.isCrafting = false;
            return false;
          }
        }
      }
      
      // Check if we need a crafting table
      const requiresCraftingTable = selectedRecipe.requiresTable;
      
      if (requiresCraftingTable) {
        // Make sure we have access to a crafting table
        if (!await this.ensureCraftingTable()) {
          this.bot.chat(`I need a crafting table to craft ${itemName}, but couldn't get one.`);
          this.isCrafting = false;
          return false;
        }
      }
      
      // Craft the item
      let craftedCount = 0;
      const targetCount = amount;
      
      while (craftedCount < targetCount) {
        const countToCraft = Math.min(targetCount - craftedCount, selectedRecipe.result.count);
        const craftCount = Math.ceil(countToCraft / selectedRecipe.result.count);
        
        try {
          // If using crafting table, make sure we're near it
          if (requiresCraftingTable && this.craftingTablePosition) {
            // Navigate to crafting table if needed
            if (!this.isNearCraftingTable()) {
              await this.botManager.pathfindingManager.goto(this.craftingTablePosition);
            }
            
            // Craft with table
            await this.bot.craft(selectedRecipe, craftCount, this.craftingTablePosition);
          } else {
            // Craft without table
            await this.bot.craft(selectedRecipe, craftCount);
          }
          
          craftedCount += selectedRecipe.result.count * craftCount;
          this.bot.chat(`Crafted ${selectedRecipe.result.count * craftCount}x ${itemName}.`);
          
        } catch (error) {
          logger.error(`Error crafting ${itemName}:`, error);
          this.bot.chat(`I failed to craft ${itemName}: ${error.message}`);
          break;
        }
      }
      
      this.isCrafting = false;
      return craftedCount > 0;
      
    } catch (error) {
      logger.error(`Error in craftItem:`, error);
      this.bot.chat(`Error crafting ${itemName}: ${error.message}`);
      this.isCrafting = false;
      return false;
    }
  }
  
  /**
   * Normalize an item name to match recipe names
   */
  normalizeItemName(itemName) {
    // Handle common cases where the item name differs from the recipe name
    const nameMap = {
      'sticks': 'stick',
      'planks': 'oak_planks',
      'wood': 'oak_log',
      'table': 'crafting_table',
      'workbench': 'crafting_table',
      'furnace': 'furnace',
      'chest': 'chest',
      'pick': 'wooden_pickaxe',
      'pickaxe': 'wooden_pickaxe',
      'axe': 'wooden_axe',
      'shovel': 'wooden_shovel',
      'sword': 'wooden_sword',
      'hoe': 'wooden_hoe',
      'bucket': 'bucket',
    };
    
    // Check if this is a specific tier of tool
    if (itemName.includes('_')) {
      const parts = itemName.split('_');
      if (parts.length >= 2) {
        // If it's already a valid item name, return it
        const fullName = parts.join('_');
        if (this.mcData.itemsByName[fullName]) {
          return fullName;
        }
      }
    }
    
    // Return the mapped name or the original if no mapping exists
    return nameMap[itemName.toLowerCase()] || itemName;
  }
  
  /**
   * Check if the bot has all ingredients for a recipe
   */
  hasIngredientsForRecipe(recipe) {
    if (!recipe) return false;
    
    // Get inventory items
    const inventory = this.bot.inventory.items();
    
    // Check each ingredient
    for (const ingredient of recipe.delta) {
      // Skip output items (positive count)
      if (ingredient.count > 0) continue;
      
      // Need to find |ingredient.count| of this item in inventory
      const requiredCount = -ingredient.count;
      
      // Find matching item in inventory
      const availableItem = inventory.find(item => item.type === ingredient.id);
      
      // If we don't have this item or not enough, return false
      if (!availableItem || availableItem.count < requiredCount) {
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Get a list of missing ingredients for a recipe
   */
  getMissingIngredients(recipe) {
    if (!recipe) return [];
    
    const missingIngredients = [];
    const inventory = this.bot.inventory.items();
    
    // Check each ingredient
    for (const ingredient of recipe.delta) {
      // Skip output items (positive count)
      if (ingredient.count > 0) continue;
      
      // Need to find |ingredient.count| of this item in inventory
      const requiredCount = -ingredient.count;
      
      // Find matching item in inventory
      const availableItem = inventory.find(item => item.type === ingredient.id);
      
      // If we don't have this item or not enough, add to missing list
      if (!availableItem || availableItem.count < requiredCount) {
        const itemInfo = this.mcData.items[ingredient.id] || { name: `Unknown(${ingredient.id})` };
        const availableCount = availableItem ? availableItem.count : 0;
        const missingCount = requiredCount - availableCount;
        
        missingIngredients.push({
          id: ingredient.id,
          name: itemInfo.name,
          count: missingCount
        });
      }
    }
    
    return missingIngredients;
  }
  
  /**
   * Ensure the bot has access to a crafting table
   */
  async ensureCraftingTable() {
    // First check if we already know a crafting table location
    if (this.craftingTablePosition) {
      // Verify the crafting table is still there
      const block = this.bot.blockAt(this.craftingTablePosition);
      if (block && block.name === 'crafting_table') {
        // The table is still there
        return true;
      } else {
        // Table is gone, forget its position
        this.craftingTablePosition = null;
      }
    }
    
    // Check if we have a crafting table in inventory
    const craftingTableItem = this.bot.inventory.items().find(item => item.name === 'crafting_table');
    
    if (craftingTableItem) {
      // We have a table, place it
      logger.info('Placing crafting table');
      return await this.placeCraftingTable();
    }
    
    // Search for existing crafting table in the world
    const craftingTable = this.findNearbyCraftingTable();
    
    if (craftingTable) {
      this.craftingTablePosition = craftingTable.position;
      return true;
    }
    
    // If we don't have one, try to craft one
    logger.info('Trying to craft a crafting table');
    const craftedTable = await this.craftCraftingTable();
    
    if (craftedTable) {
      // Now we have a table, place it
      return await this.placeCraftingTable();
    }
    
    // If we couldn't craft or find a table, return false
    return false;
  }
  
  /**
   * Find a nearby crafting table
   */
  findNearbyCraftingTable() {
    // Get the ID for crafting table
    const craftingTableId = this.mcData.blocksByName.crafting_table.id;
    
    // Find nearby crafting tables
    const craftingTables = this.bot.findBlocks({
      matching: craftingTableId,
      maxDistance: 20,
      count: 1
    });
    
    if (craftingTables.length > 0) {
      const position = craftingTables[0];
      logger.info(`Found existing crafting table at ${position}`);
      
      // Get the actual block at this position
      const craftingTable = this.bot.blockAt(position);
      return craftingTable;
    }
    
    return null;
  }
  
  /**
   * Craft a crafting table
   */
  async craftCraftingTable() {
    // We need 4 planks to craft a table
    const planksItems = this.bot.inventory.items().filter(item => 
      item.name.endsWith('_planks')
    );
    
    // Check if we have enough planks
    const planksCount = planksItems.reduce((total, item) => total + item.count, 0);
    
    if (planksCount >= 4) {
      // We have enough planks, try to craft
      return await this.craftItem('crafting_table', 1);
    }
    
    // If we don't have enough planks, check if we have logs
    const logItems = this.bot.inventory.items().filter(item => 
      item.name.endsWith('_log') || item.name.endsWith('_stem')
    );
    
    if (logItems.length > 0) {
      // Try to craft planks from logs first
      // Choose the most abundant log type
      const bestLog = logItems.reduce((best, item) => 
        item.count > best.count ? item : best, logItems[0]);
      
      // Get the plank type matching the log
      let plankType = 'oak_planks'; // Default
      if (bestLog.name.includes('_')) {
        const woodType = bestLog.name.split('_')[0];
        plankType = `${woodType}_planks`;
      }
      
      // Craft planks first
      const craftedPlanks = await this.craftItem(plankType, 4);
      
      if (craftedPlanks) {
        // Now try to craft the table again
        return await this.craftItem('crafting_table', 1);
      }
    }
    
    // If we couldn't craft planks or a table
    this.bot.chat("I need logs or planks to craft a crafting table.");
    return false;
  }
  
  /**
   * Place a crafting table near the bot
   */
  async placeCraftingTable() {
    // Find the crafting table in our inventory
    const craftingTableItem = this.bot.inventory.items().find(item => item.name === 'crafting_table');
    
    if (!craftingTableItem) {
      logger.warn(`No crafting table found in inventory`);
      return false;
    }
    
    try {
      // Find a suitable position to place the table
      const placementPosition = await this.findTablePlacementPosition();
      
      if (!placementPosition) {
        this.bot.chat("I couldn't find a good spot to place the crafting table.");
        return false;
      }
      
      // Equip the table
      await this.bot.equip(craftingTableItem, 'hand');
      
      // Place the table
      await this.bot.placeBlock(placementPosition.referenceBlock, placementPosition.faceVector);
      
      // Update the table position
      const placedPosition = placementPosition.referenceBlock.position.plus(placementPosition.faceVector);
      const placedBlock = this.bot.blockAt(placedPosition);
      
      if (placedBlock && placedBlock.name === 'crafting_table') {
        logger.info(`Placed crafting table at ${placedPosition}`);
        this.craftingTablePosition = placedPosition;
        return true;
      } else {
        logger.warn(`Failed to place crafting table, block at ${placedPosition} is ${placedBlock?.name}`);
        return false;
      }
    } catch (error) {
      logger.error(`Error placing crafting table:`, error);
      return false;
    }
  }
  
  /**
   * Find a position to place the crafting table
   */
  async findTablePlacementPosition() {
    // Try to find a solid block next to the bot to place against
    const offsets = [
      new Vec3(1, 0, 0),
      new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1),
      new Vec3(0, 0, -1),
      new Vec3(0, -1, 0), // Below (standing on)
    ];
    
    const pos = this.bot.entity.position.floored();
    
    for (const offset of offsets) {
      const targetPos = pos.plus(offset);
      const targetBlock = this.bot.blockAt(targetPos);
      
      // Skip if block doesn't exist or isn't solid
      if (!targetBlock || targetBlock.boundingBox !== 'block') continue;
      
      // Calculate the face to place against
      const faceVector = offset.scaled(-1);
      
      // Check if the face is free (air block)
      const placePos = targetPos.plus(faceVector);
      const placeBlock = this.bot.blockAt(placePos);
      
      if (placeBlock && placeBlock.boundingBox === 'empty') {
        // Make sure there's enough space for the bot above
        const abovePos = placePos.offset(0, 1, 0);
        const aboveBlock = this.bot.blockAt(abovePos);
        
        if (aboveBlock && aboveBlock.boundingBox === 'empty') {
          return {
            referenceBlock: targetBlock,
            faceVector: faceVector
          };
        }
      }
    }
    
    // If we can't place near the bot, try to dig out a spot
    const blockBelow = this.bot.blockAt(pos.offset(0, -1, 0));
    if (blockBelow && blockBelow.boundingBox === 'block') {
      // Try to dig a block adjacent to where we're standing
      for (const offset of offsets.slice(0, 4)) { // Just the horizontal offsets
        const targetPos = pos.plus(offset);
        const targetBlock = this.bot.blockAt(targetPos);
        
        // Skip air blocks
        if (!targetBlock || targetBlock.boundingBox === 'empty') continue;
        
        // Dig the block
        try {
          await this.bot.dig(targetBlock);
          
          // Return the position to place against
          return {
            referenceBlock: blockBelow,
            faceVector: new Vec3(0, 1, 0)
          };
        } catch (error) {
          // Ignore errors and try the next block
          continue;
        }
      }
    }
    
    return null;
  }
  
  /**
   * Check if the bot is near its crafting table
   */
  isNearCraftingTable() {
    if (!this.craftingTablePosition) return false;
    
    const distance = this.bot.entity.position.distanceTo(this.craftingTablePosition);
    return distance <= 3;
  }
  
  /**
   * Check if the bot needs tools and craft them if necessary
   */
  async checkAndCraftTools() {
    logger.info('Checking and crafting needed tools');
    
    // Check current tools
    const currentTools = this.getCurrentTools();
    
    // Check what tools to keep stock of based on config
    const toolsToCraft = [];
    
    for (const [toolName, count] of Object.entries(this.config.crafting.keepStockOf)) {
      if (!currentTools[toolName] && count > 0) {
        toolsToCraft.push(toolName);
      }
    }
    
    // Craft the missing tools
    let craftedCount = 0;
    
    for (const tool of toolsToCraft) {
      try {
        const result = await this.craftItem(tool, 1);
        if (result) craftedCount++;
      } catch (error) {
        logger.error(`Failed to craft ${tool}:`, error);
      }
    }
    
    if (craftedCount > 0) {
      this.bot.chat(`Crafted ${craftedCount} needed tools.`);
    } else if (toolsToCraft.length > 0) {
      this.bot.chat(`Couldn't craft any of the ${toolsToCraft.length} tools we need.`);
    } else {
      this.bot.chat(`We have all the tools we need.`);
    }
    
    return craftedCount;
  }
  
  /**
   * Get a map of the current tools in inventory
   */
  getCurrentTools() {
    const tools = {};
    const items = this.bot.inventory.items();
    
    // Check for various tools
    for (const item of items) {
      if (item.name.endsWith('_pickaxe')) tools[item.name] = item.count;
      else if (item.name.endsWith('_axe')) tools[item.name] = item.count;
      else if (item.name.endsWith('_shovel')) tools[item.name] = item.count;
      else if (item.name.endsWith('_hoe')) tools[item.name] = item.count;
      else if (item.name.endsWith('_sword')) tools[item.name] = item.count;
      else if (item.name === 'crafting_table') tools[item.name] = item.count;
      else if (item.name === 'furnace') tools[item.name] = item.count;
      else if (item.name === 'torch') tools[item.name] = item.count;
    }
    
    return tools;
  }
  
  /**
   * Gather missing ingredients for crafting
   */
  async gatherMissingIngredients(ingredients) {
    if (!ingredients || ingredients.length === 0) return;
    
    this.bot.chat(`Gathering ingredients: ${ingredients.map(i => `${i.count}x ${i.name}`).join(', ')}`);
    
    // Try to gather each ingredient
    for (const ingredient of ingredients) {
      // Skip complex ingredients for now
      if (ingredient.name.includes('_pickaxe') || 
          ingredient.name.includes('_axe') ||
          ingredient.name.includes('_sword') ||
          ingredient.name.includes('_shovel') ||
          ingredient.name.includes('_hoe')) {
        continue;
      }
      
      // For simple ingredients, try to gather/mine them
      if (ingredient.name.includes('_log') || ingredient.name === 'log') {
        // Find and mine logs
        if (this.botManager.miningBehavior) {
          await this.botManager.miningBehavior.mineBlock('wood', ingredient.count);
        }
      } else if (ingredient.name.endsWith('_planks') || ingredient.name === 'planks') {
        // Need to craft planks from logs
        const logs = this.bot.inventory.items().filter(item => 
          item.name.endsWith('_log') || item.name.endsWith('_stem')
        );
        
        if (logs.length > 0) {
          // Get the wood type from the log
          const woodType = logs[0].name.split('_')[0];
          const plankType = `${woodType}_planks`;
          
          // Craft planks (one log = 4 planks)
          const neededLogs = Math.ceil(ingredient.count / 4);
          await this.craftItem(plankType, ingredient.count);
        }
      } else if (ingredient.name === 'stick') {
        // Need to craft sticks from planks
        const planks = this.bot.inventory.items().filter(item => 
          item.name.endsWith('_planks')
        );
        
        if (planks.length > 0) {
          // Craft sticks (2 planks = 4 sticks)
          const neededPlanks = Math.ceil(ingredient.count / 2);
          await this.craftItem('stick', ingredient.count);
        }
      } else if (ingredient.name === 'cobblestone' || ingredient.name === 'stone') {
        // Mine stone/cobblestone
        if (this.botManager.miningBehavior) {
          await this.botManager.miningBehavior.mineBlock('stone', ingredient.count);
        }
      }
    }
  }
  
  /**
   * Smelt items in a furnace
   */
  async smeltItems(itemToSmelt, fuelItem, amount = 1) {
    logger.info(`Attempting to smelt ${amount}x ${itemToSmelt} using ${fuelItem}`);
    
    try {
      // First find or place a furnace
      const furnaceBlock = await this.findOrPlaceFurnace();
      
      if (!furnaceBlock) {
        this.bot.chat(`I couldn't find or place a furnace.`);
        return false;
      }
      
      // Find the items to smelt and use as fuel
      const itemsToSmelt = this.bot.inventory.items().filter(item => 
        item.name === itemToSmelt
      );
      
      const fuels = this.bot.inventory.items().filter(item => 
        item.name === fuelItem
      );
      
      if (itemsToSmelt.length === 0) {
        this.bot.chat(`I don't have any ${itemToSmelt} to smelt.`);
        return false;
      }
      
      if (fuels.length === 0) {
        this.bot.chat(`I don't have any ${fuelItem} to use as fuel.`);
        return false;
      }
      
      // Navigate to the furnace
      const furnacePosition = furnaceBlock.position;
      await this.botManager.pathfindingManager.goto(furnacePosition);
      
      // Open the furnace
      const furnace = await this.bot.openFurnace(furnaceBlock);
      
      // Put items in furnace
      await furnace.putInput(itemsToSmelt[0], null, Math.min(itemsToSmelt[0].count, amount));
      await furnace.putFuel(fuels[0], null, Math.min(fuels[0].count, Math.ceil(amount / 8)));
      
      // Wait for smelting to complete
      this.bot.chat(`Smelting ${amount}x ${itemToSmelt}. This will take some time...`);
      
      // Simple wait based on amount (roughly 10 seconds per item)
      const waitTime = amount * 10 * 1000;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      
      // Take output
      try {
        await furnace.takeOutput();
      } catch (e) {
        // Ignore errors when taking output
      }
      
      // Close the furnace
      furnace.close();
      
      this.bot.chat(`Finished smelting ${itemToSmelt}!`);
      return true;
      
    } catch (error) {
      logger.error(`Error in smeltItems:`, error);
      this.bot.chat(`Error while smelting: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Find or place a furnace
   */
  async findOrPlaceFurnace() {
    // First look for existing furnace
    const furnaceId = this.mcData.blocksByName.furnace.id;
    
    const furnacePositions = this.bot.findBlocks({
      matching: furnaceId,
      maxDistance: 20,
      count: 1
    });
    
    if (furnacePositions.length > 0) {
      const furnacePos = furnacePositions[0];
      return this.bot.blockAt(furnacePos);
    }
    
    // If no furnace found, check if we have one in inventory
    const furnaceItem = this.bot.inventory.items().find(item => 
      item.name === 'furnace'
    );
    
    if (furnaceItem) {
      // Place the furnace
      logger.info('Placing furnace');
      
      // Find a place to put it
      const placementPosition = await this.findTablePlacementPosition();
      
      if (!placementPosition) {
        this.bot.chat("I couldn't find a good spot to place the furnace.");
        return null;
      }
      
      // Equip the furnace
      await this.bot.equip(furnaceItem, 'hand');
      
      // Place the furnace
      await this.bot.placeBlock(placementPosition.referenceBlock, placementPosition.faceVector);
      
      // Get the placed furnace block
      const placedPos = placementPosition.referenceBlock.position.plus(placementPosition.faceVector);
      return this.bot.blockAt(placedPos);
    }
    
    // If we don't have a furnace, try to craft one
    await this.craftItem('furnace', 1);
    
    // Check if we crafted it successfully
    const newFurnaceItem = this.bot.inventory.items().find(item => 
      item.name === 'furnace'
    );
    
    if (newFurnaceItem) {
      // Recursive call to place the new furnace
      return await this.findOrPlaceFurnace();
    }
    
    return null;
  }
}

module.exports = CraftingBehavior;
