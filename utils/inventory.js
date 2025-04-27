/**
 * Inventory Management Utility
 * 
 * Provides helper functions for organizing and managing the bot's inventory.
 */

const logger = require('../bot/logger');

class InventoryManager {
  constructor(bot, config) {
    this.bot = bot;
    this.config = config;
    this.lastInventoryCheck = 0;
    this.inventoryCheckInterval = 60000; // Check inventory organization every minute
  }

  /**
   * Initialize inventory manager
   */
  initialize() {
    // Register periodic inventory check
    this.bot.on('physicsTick', () => {
      const now = Date.now();
      if (now - this.lastInventoryCheck > this.inventoryCheckInterval) {
        this.lastInventoryCheck = now;
        this.checkInventory();
      }
    });

    logger.info('Inventory manager initialized');
  }

  /**
   * Periodically check inventory and organize if needed
   */
  async checkInventory() {
    try {
      // Only organize if inventory is getting full
      const fullness = this.getInventoryFullness();
      if (fullness > 0.8) {
        logger.info('Inventory getting full (80%+), organizing');
        await this.organizeInventory();
      }
    } catch (error) {
      logger.warn('Error checking inventory:', error);
    }
  }

  /**
   * Calculate how full the inventory is (0-1)
   */
  getInventoryFullness() {
    const slots = this.bot.inventory.slots;
    let usedSlots = 0;
    let totalSlots = 36; // Main inventory + hotbar
    
    for (let i = 9; i < 45; i++) { // Skip armor slots
      if (slots[i]) usedSlots++;
    }
    
    return usedSlots / totalSlots;
  }

  /**
   * Organize the inventory by stacking similar items and moving tools to hotbar
   */
  async organizeInventory() {
    try {
      // First, stack similar items
      await this.stackItems();
      
      // Then move tools to hotbar
      await this.moveToolsToHotbar();
      
      // Move food to hotbar
      await this.moveFoodToHotbar();
      
      logger.info('Inventory organization complete');
    } catch (error) {
      logger.warn('Error organizing inventory:', error);
    }
  }

  /**
   * Stack similar items together to save space
   */
  async stackItems() {
    const items = this.bot.inventory.items();
    const itemsByName = {};
    
    // Group items by name
    for (const item of items) {
      if (!itemsByName[item.name]) {
        itemsByName[item.name] = [];
      }
      itemsByName[item.name].push(item);
    }
    
    // For each item type that has multiple instances, try to stack them
    for (const [name, itemList] of Object.entries(itemsByName)) {
      if (itemList.length <= 1) continue; // Skip if only one item
      
      // Sort by count (ascending, so we fill up already existing stacks first)
      itemList.sort((a, b) => a.count - b.count);
      
      // Check if there's room to stack
      const maxStackSize = itemList[0].stackSize;
      for (let i = 0; i < itemList.length - 1; i++) {
        const sourceItem = itemList[i];
        
        // Skip if this item is already at max stack
        if (sourceItem.count >= maxStackSize) continue;
        
        for (let j = i + 1; j < itemList.length; j++) {
          const targetItem = itemList[j];
          
          // Skip if target is at max stack or source is now empty
          if (targetItem.count >= maxStackSize || sourceItem.count === 0) continue;
          
          // Calculate how much we can move
          const countToMove = Math.min(
            targetItem.count,
            maxStackSize - sourceItem.count
          );
          
          if (countToMove > 0) {
            // Move items from target to source to consolidate
            try {
              await this.bot.moveSlotItem(targetItem.slot, sourceItem.slot);
              
              // Update counts to reflect the move
              sourceItem.count += countToMove;
              targetItem.count -= countToMove;
              
              // If the target is now empty, remove it from the list
              if (targetItem.count === 0) {
                itemList.splice(j, 1);
                j--;
              }
            } catch (error) {
              logger.warn(`Error stacking ${name}:`, error);
            }
            
            // Small delay to avoid overwhelming the server
            await new Promise(resolve => setTimeout(resolve, 150));
          }
        }
      }
    }
  }

  /**
   * Move tools to the hotbar for easy access
   */
  async moveToolsToHotbar() {
    const hotbarStart = 36; // Slot ID where the hotbar starts (0-8 in-game, 36-44 internally)
    const hotbarSize = 9;
    const toolTypes = [
      'pickaxe', 'axe', 'shovel', 'sword', 'hoe'
    ];
    
    // Get all tool items
    const tools = this.bot.inventory.items().filter(item => 
      toolTypes.some(toolType => item.name.includes(toolType))
    );
    
    // Skip if no tools
    if (tools.length === 0) return;
    
    // Sort by material quality (diamond > iron > stone > wood)
    const materialOrder = ['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden'];
    
    tools.sort((a, b) => {
      // Get material for each tool
      const matA = materialOrder.findIndex(m => a.name.includes(m));
      const matB = materialOrder.findIndex(m => b.name.includes(m));
      
      // If same material, sort by tool type
      if (matA === matB) {
        // Prioritize sword, pickaxe, axe, shovel, hoe
        const toolOrder = ['sword', 'pickaxe', 'axe', 'shovel', 'hoe'];
        const toolA = toolOrder.findIndex(t => a.name.includes(t));
        const toolB = toolOrder.findIndex(t => b.name.includes(t));
        return toolA - toolB;
      }
      
      return matA - matB; // Lower index (better material) first
    });
    
    // Try to place tools in hotbar, focusing on the best tools first
    for (const tool of tools) {
      // Skip if already in hotbar
      if (tool.slot >= hotbarStart && tool.slot < hotbarStart + hotbarSize) {
        continue;
      }
      
      // Find a free hotbar slot
      let hotbarSlot = -1;
      for (let i = 0; i < hotbarSize; i++) {
        const slot = hotbarStart + i;
        if (!this.bot.inventory.slots[slot]) {
          hotbarSlot = slot;
          break;
        }
      }
      
      // If no free slot, try to replace items that aren't tools or food
      if (hotbarSlot === -1) {
        for (let i = 0; i < hotbarSize; i++) {
          const slot = hotbarStart + i;
          const item = this.bot.inventory.slots[slot];
          
          if (item && !this.isToolOrFood(item)) {
            hotbarSlot = slot;
            break;
          }
        }
      }
      
      // If we found a suitable slot, move the tool there
      if (hotbarSlot !== -1) {
        try {
          await this.bot.moveSlotItem(tool.slot, hotbarSlot);
        } catch (error) {
          logger.warn(`Error moving tool to hotbar:`, error);
        }
        
        // Small delay to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }
  }

  /**
   * Move food to the hotbar for easy access
   */
  async moveFoodToHotbar() {
    const hotbarStart = 36; // Slot ID where the hotbar starts (0-8 in-game, 36-44 internally)
    const hotbarSize = 9;
    
    // Get all food items
    const foodItems = this.bot.inventory.items().filter(item => this.isFood(item));
    
    // Skip if no food
    if (foodItems.length === 0) return;
    
    // Sort by food value (efficiency) - higher nourishment first
    foodItems.sort((a, b) => {
      return this.getFoodValue(b) - this.getFoodValue(a);
    });
    
    // Try to place food in hotbar if not already there
    for (const food of foodItems) {
      // Only need one food item in hotbar, so stop if we already have food there
      if (this.hasFoodInHotbar()) {
        break;
      }
      
      // Skip if already in hotbar
      if (food.slot >= hotbarStart && food.slot < hotbarStart + hotbarSize) {
        continue;
      }
      
      // Find a free hotbar slot
      let hotbarSlot = -1;
      for (let i = 0; i < hotbarSize; i++) {
        const slot = hotbarStart + i;
        if (!this.bot.inventory.slots[slot]) {
          hotbarSlot = slot;
          break;
        }
      }
      
      // If no free slot, try to replace non-essential items
      if (hotbarSlot === -1) {
        for (let i = 0; i < hotbarSize; i++) {
          const slot = hotbarStart + i;
          const item = this.bot.inventory.slots[slot];
          
          if (item && !this.isToolOrFood(item)) {
            hotbarSlot = slot;
            break;
          }
        }
      }
      
      // If we found a suitable slot, move the food there
      if (hotbarSlot !== -1) {
        try {
          await this.bot.moveSlotItem(food.slot, hotbarSlot);
        } catch (error) {
          logger.warn(`Error moving food to hotbar:`, error);
        }
        
        // Small delay to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }
  }

  /**
   * Check if an item is food
   */
  isFood(item) {
    // Common food items
    const foodTypes = [
      'apple', 'beef', 'cooked_beef', 'chicken', 'cooked_chicken',
      'mutton', 'cooked_mutton', 'porkchop', 'cooked_porkchop',
      'bread', 'potato', 'baked_potato', 'carrot', 'beetroot',
      'rabbit', 'cooked_rabbit', 'cod', 'cooked_cod', 'salmon', 'cooked_salmon'
    ];
    
    return foodTypes.some(food => item.name.includes(food));
  }

  /**
   * Check if an item is a tool or food
   */
  isToolOrFood(item) {
    const toolTypes = ['pickaxe', 'axe', 'shovel', 'sword', 'hoe'];
    
    return toolTypes.some(tool => item.name.includes(tool)) || this.isFood(item);
  }

  /**
   * Get estimated food value for a food item
   */
  getFoodValue(item) {
    // Approximate food values (hunger points restored)
    const foodValues = {
      'cooked_beef': 8,
      'cooked_porkchop': 8,
      'cooked_mutton': 6,
      'cooked_chicken': 6,
      'cooked_rabbit': 5,
      'cooked_cod': 5,
      'cooked_salmon': 6,
      'baked_potato': 5,
      'bread': 5,
      'golden_carrot': 6,
      'carrot': 3,
      'apple': 4,
      'beetroot': 1,
      'potato': 1,
      'beef': 3,
      'porkchop': 3,
      'mutton': 2,
      'chicken': 2,
      'rabbit': 3,
      'cod': 2,
      'salmon': 2
    };
    
    // Try to find the matching food value
    for (const [foodName, value] of Object.entries(foodValues)) {
      if (item.name.includes(foodName)) {
        return value;
      }
    }
    
    // Default value if not found
    return 1;
  }

  /**
   * Check if there's already food in the hotbar
   */
  hasFoodInHotbar() {
    const hotbarStart = 36; // Slot ID where the hotbar starts
    const hotbarSize = 9;
    
    for (let i = 0; i < hotbarSize; i++) {
      const slot = hotbarStart + i;
      const item = this.bot.inventory.slots[slot];
      
      if (item && this.isFood(item)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Get all items of a specific type in inventory
   */
  getItemsByType(itemName) {
    return this.bot.inventory.items().filter(item => 
      item.name === itemName || item.name.includes(itemName)
    );
  }

  /**
   * Count how many of a specific item we have in inventory
   */
  countItemsByType(itemName) {
    const items = this.getItemsByType(itemName);
    return items.reduce((sum, item) => sum + item.count, 0);
  }

  /**
   * Check if the bot has a specific item
   */
  hasItem(itemName, minCount = 1) {
    return this.countItemsByType(itemName) >= minCount;
  }

  /**
   * Find a slot that contains a specific item
   */
  findItemInInventory(itemName) {
    const items = this.getItemsByType(itemName);
    return items.length > 0 ? items[0] : null;
  }

  /**
   * Equip an item by name
   */
  async equipItem(itemName, destination = 'hand') {
    const item = this.findItemInInventory(itemName);
    
    if (!item) {
      logger.warn(`Cannot equip ${itemName}: item not found in inventory`);
      return false;
    }
    
    try {
      await this.bot.equip(item, destination);
      return true;
    } catch (error) {
      logger.warn(`Error equipping ${itemName}:`, error);
      return false;
    }
  }

  /**
   * Drop items to make room in inventory
   */
  async dropLowValueItems(countToDrop = 1) {
    // Items to consider dropping first (lowest value first)
    const lowValueItems = [
      'dirt', 'gravel', 'sand', 'cobblestone', 'andesite', 'diorite', 'granite',
      'netherrack', 'stone', 'rotten_flesh'
    ];
    
    let droppedCount = 0;
    
    // Try dropping each item type until we've dropped enough
    for (const itemType of lowValueItems) {
      const items = this.getItemsByType(itemType);
      
      for (const item of items) {
        if (droppedCount >= countToDrop) {
          return droppedCount;
        }
        
        try {
          await this.bot.tossItem(item.type, null, item.count);
          droppedCount += item.count;
          logger.info(`Dropped ${item.count} ${item.name}`);
          
          // Small delay to avoid overwhelming the server
          await new Promise(resolve => setTimeout(resolve, 150));
        } catch (error) {
          logger.warn(`Error dropping ${item.name}:`, error);
        }
      }
    }
    
    return droppedCount;
  }

  /**
   * Ensure we have enough free inventory slots
   */
  async ensureFreeSlots(slotsNeeded = 1) {
    const slots = this.bot.inventory.slots;
    let usedSlots = 0;
    
    for (let i = 9; i < 45; i++) { // Skip armor slots
      if (slots[i]) usedSlots++;
    }
    
    const totalSlots = 36; // Main inventory + hotbar
    const freeSlots = totalSlots - usedSlots;
    
    if (freeSlots >= slotsNeeded) {
      return true;
    }
    
    // Need to make room
    logger.info(`Need to make room for ${slotsNeeded} items, have ${freeSlots} free slots`);
    
    // First try to stack items
    await this.stackItems();
    
    // Check again after stacking
    usedSlots = 0;
    for (let i = 9; i < 45; i++) {
      if (this.bot.inventory.slots[i]) usedSlots++;
    }
    
    const freeAfterStacking = totalSlots - usedSlots;
    
    if (freeAfterStacking >= slotsNeeded) {
      return true;
    }
    
    // Still need to make room, drop some low-value items
    const countToDrop = slotsNeeded - freeAfterStacking;
    const droppedCount = await this.dropLowValueItems(countToDrop);
    
    return droppedCount >= countToDrop;
  }
}

module.exports = InventoryManager;