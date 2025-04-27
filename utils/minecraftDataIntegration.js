/**
 * Minecraft Data Integration Utility
 * 
 * This utility provides enhanced integration between minecraft-data
 * and the bot's learning and decision-making systems.
 */

const mcData = require('minecraft-data');
const Vec3 = require('vec3');

/**
 * MinecraftDataIntegration class manages integrations between
 * minecraft-data library and the bot's systems.
 */
class MinecraftDataIntegration {
  /**
   * Initialize the integration with a bot instance
   * 
   * @param {Object} bot - The Mineflayer bot instance
   * @param {Object} learningManager - Optional learning manager instance
   */
  constructor(bot, learningManager = null) {
    this.bot = bot;
    this.learningManager = learningManager;
    
    // Try to get minecraft data for the bot's version
    this.version = this.getVersion();
    this.mcData = this.loadMinecraftData(this.version);
    
    // Initialize data caches
    this.blocksByName = {};
    this.itemsByName = {};
    this.recipesByResult = {};
    this.biomesByName = {};
    this.biomesByID = {};
    
    // Index the data
    this.indexData();
    
    // Block value scores (for resource prioritization)
    this.blockValueScores = this.initBlockValueScores();
    
    // Item crafting complexity (for planning)
    this.craftingComplexity = this.initCraftingComplexity();
    
    // Knowledge about the environment
    this.knownPoints = new Map(); // key: "x,y,z", value: {data}
    this.knownBiomes = new Set(); // Set of biome names the bot has visited
    this.knownItems = new Set(); // Set of item names the bot has collected
    this.knownRecipes = new Set(); // Set of recipes the bot has crafted
    
    // Cache for pathfinding costs
    this.pathCostCache = new Map();
  }
  
  /**
   * Get minecraft version from bot
   */
  getVersion() {
    // Try different ways to get version info
    if (this.bot.version) return this.bot.version;
    if (this.bot.game && this.bot.game.version) return this.bot.game.version;
    if (this.bot.bot && this.bot.bot.version) return this.bot.bot.version;
    
    // Default to a common version
    return '1.16.5';
  }
  
  /**
   * Load minecraft data for a specific version
   */
  loadMinecraftData(version) {
    try {
      const data = mcData(version);
      if (data) return data;
    } catch (e) {
      console.warn(`Failed to load minecraft-data for version ${version}`);
    }
    
    // Try common versions as fallback
    const commonVersions = ['1.16.5', '1.17.1', '1.18.2', '1.19.4', '1.20.1'];
    
    for (const ver of commonVersions) {
      if (ver === version) continue;
      
      try {
        const data = mcData(ver);
        if (data) {
          console.warn(`Using minecraft-data for version ${ver} as fallback`);
          return data;
        }
      } catch (e) {
        // continue to next version
      }
    }
    
    // Minimal structure as last resort
    console.warn('Creating minimal minecraft-data structure');
    return {
      blocks: {},
      items: {},
      biomes: {},
      recipes: {},
      blocksArray: [],
      itemsArray: [],
      biomesArray: [],
      entitiesArray: []
    };
  }
  
  /**
   * Index minecraft data for efficient lookup
   */
  indexData() {
    // Index blocks
    if (this.mcData.blocksArray) {
      this.mcData.blocksArray.forEach(block => {
        this.blocksByName[block.name] = block;
      });
    }
    
    // Index items
    if (this.mcData.itemsArray) {
      this.mcData.itemsArray.forEach(item => {
        this.itemsByName[item.name] = item;
      });
    }
    
    // Index recipes
    if (this.mcData.recipes) {
      Object.entries(this.mcData.recipes).forEach(([name, recipes]) => {
        this.recipesByResult[name] = recipes;
      });
    }
    
    // Index biomes
    if (this.mcData.biomesArray) {
      this.mcData.biomesArray.forEach(biome => {
        this.biomesByName[biome.name] = biome;
        this.biomesByID[biome.id] = biome;
      });
    }
  }
  
  /**
   * Create block value scores for prioritization
   */
  initBlockValueScores() {
    return {
      // High-value ores
      'diamond_ore': 100,
      'emerald_ore': 95,
      'ancient_debris': 110,
      
      // Medium-value ores
      'gold_ore': 70,
      'iron_ore': 65,
      'redstone_ore': 60,
      'lapis_ore': 60,
      
      // Basic ores
      'coal_ore': 40,
      'copper_ore': 35,
      
      // Common building blocks
      'stone': 10,
      'cobblestone': 10,
      'dirt': 5,
      'gravel': 8,
      'sand': 12,
      
      // Wood-related
      'oak_log': 25,
      'spruce_log': 25,
      'birch_log': 25,
      'jungle_log': 25,
      'acacia_log': 25,
      'dark_oak_log': 25,
      
      // Crafting-related
      'crafting_table': 30,
      'furnace': 35,
      'chest': 40,
      
      // Rare blocks
      'obsidian': 80,
      'enchanting_table': 85,
      'bookshelf': 45,
      
      // Default score for unknown blocks
      'default': 1
    };
  }
  
  /**
   * Create crafting complexity scores
   */
  initCraftingComplexity() {
    return {
      // Basic items
      'stick': 1,
      'torch': 2,
      'wooden_planks': 1,
      
      // Basic tools
      'wooden_pickaxe': 3,
      'wooden_axe': 3,
      'wooden_shovel': 2,
      'wooden_sword': 3,
      'wooden_hoe': 3,
      
      // Stone tools
      'stone_pickaxe': 4,
      'stone_axe': 4,
      'stone_shovel': 3,
      'stone_sword': 4,
      'stone_hoe': 4,
      
      // Iron tools
      'iron_pickaxe': 5,
      'iron_axe': 5,
      'iron_shovel': 4,
      'iron_sword': 5,
      'iron_hoe': 5,
      
      // Gold tools
      'golden_pickaxe': 5,
      'golden_axe': 5,
      'golden_shovel': 4,
      'golden_sword': 5,
      'golden_hoe': 5,
      
      // Diamond tools
      'diamond_pickaxe': 6,
      'diamond_axe': 6,
      'diamond_shovel': 5,
      'diamond_sword': 6,
      'diamond_hoe': 6,
      
      // Functional blocks
      'crafting_table': 2,
      'furnace': 4,
      'chest': 4,
      'hopper': 6,
      
      // Default complexity for unknown items
      'default': 3
    };
  }
  
  /**
   * Get block by name
   */
  getBlockByName(name) {
    return this.blocksByName[name] || null;
  }
  
  /**
   * Get item by name
   */
  getItemByName(name) {
    return this.itemsByName[name] || null;
  }
  
  /**
   * Get recipes for an item
   */
  getRecipesForItem(name) {
    return this.recipesByResult[name] || [];
  }
  
  /**
   * Get biome by ID
   */
  getBiomeById(id) {
    return this.biomesByID[id] || null;
  }
  
  /**
   * Get biome by name
   */
  getBiomeByName(name) {
    return this.biomesByName[name] || null;
  }
  
  /**
   * Get block value score for prioritization
   */
  getBlockValue(blockName) {
    return this.blockValueScores[blockName] || this.blockValueScores.default;
  }
  
  /**
   * Get crafting complexity for an item
   */
  getCraftingComplexity(itemName) {
    return this.craftingComplexity[itemName] || this.craftingComplexity.default;
  }
  
  /**
   * Calculate the total complexity for crafting an item
   * including all dependencies
   */
  calculateTotalCraftingComplexity(itemName, visited = new Set()) {
    // Prevent infinite recursion
    if (visited.has(itemName)) return 0;
    visited.add(itemName);
    
    // Get base complexity
    const baseComplexity = this.getCraftingComplexity(itemName);
    
    // Get recipes
    const recipes = this.getRecipesForItem(itemName);
    if (!recipes || recipes.length === 0) return baseComplexity;
    
    // Use the simplest recipe
    const recipe = recipes[0];
    let ingredientComplexity = 0;
    
    // Calculate complexity for each ingredient
    if (recipe.ingredients) {
      for (const ingredient of recipe.ingredients) {
        const ingredientName = this.mcData.items[ingredient.id]?.name;
        if (ingredientName) {
          ingredientComplexity += this.calculateTotalCraftingComplexity(ingredientName, visited) * ingredient.count;
        }
      }
    } else if (recipe.inShape) {
      for (const row of recipe.inShape) {
        for (const id of row) {
          if (id) {
            const ingredientName = this.mcData.items[id]?.name;
            if (ingredientName) {
              ingredientComplexity += this.calculateTotalCraftingComplexity(ingredientName, visited);
            }
          }
        }
      }
    }
    
    return baseComplexity + ingredientComplexity;
  }
  
  /**
   * Record a point of interest in the bot's knowledge
   */
  recordPoint(x, y, z, data) {
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    this.knownPoints.set(key, {
      ...data,
      position: { x, y, z },
      timestamp: Date.now()
    });
  }
  
  /**
   * Record that bot has visited a biome
   */
  recordBiomeVisit(biomeName) {
    this.knownBiomes.add(biomeName);
    
    // Update learning system if available
    if (this.learningManager) {
      this.learningManager.recordExperience({
        type: 'biome_visit',
        biome: biomeName,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Record that bot has collected an item
   */
  recordItemCollection(itemName, count = 1) {
    this.knownItems.add(itemName);
    
    // Update learning system if available
    if (this.learningManager) {
      this.learningManager.recordExperience({
        type: 'item_collection',
        item: itemName,
        count: count,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Record that bot has crafted an item
   */
  recordCrafting(itemName, count = 1) {
    this.knownRecipes.add(itemName);
    
    // Update learning system if available
    if (this.learningManager) {
      this.learningManager.recordExperience({
        type: 'item_crafting',
        item: itemName,
        count: count,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Find the nearest instances of a block type
   */
  findNearestBlocks(blockType, count = 1, searchRadius = 32) {
    // Validate block type
    let blockId;
    if (typeof blockType === 'string') {
      const block = this.getBlockByName(blockType);
      if (!block) return [];
      blockId = block.id;
    } else if (typeof blockType === 'number') {
      blockId = blockType;
    } else if (blockType && typeof blockType === 'object' && blockType.id) {
      blockId = blockType.id;
    } else {
      return [];
    }
    
    // Use bot's findBlocks function
    try {
      const blocks = this.bot.findBlocks({
        matching: blockId,
        maxDistance: searchRadius,
        count: count
      });
      
      // Convert to block positions
      return blocks.map(pos => this.bot.blockAt(pos));
    } catch (error) {
      console.warn(`Error finding blocks: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Find nearest instances of items that match a predicate
   */
  findItemsInInventory(predicate) {
    // Make sure inventory is available
    if (!this.bot || !this.bot.inventory || typeof this.bot.inventory.items !== 'function') {
      return [];
    }
    
    try {
      // Get inventory items safely
      const items = this.bot.inventory.items();
      
      // Ensure we have an array of items
      if (!items || !Array.isArray(items)) {
        return [];
      }
      
      // Filter based on predicate type
      if (typeof predicate === 'function') {
        // Function predicate - apply safely to each item
        return items.filter(item => {
          try {
            return item && predicate(item);
          } catch (e) {
            return false;
          }
        });
      } else if (typeof predicate === 'string') {
        // String predicate - match by name
        return items.filter(item => 
          item && item.name && 
          (item.name === predicate || item.displayName === predicate)
        );
      } else if (typeof predicate === 'number') {
        // Number predicate - match by ID
        return items.filter(item => 
          item && (item.type === predicate || item.id === predicate)
        );
      }
      
      // No predicate - return all items
      return items;
    } catch (error) {
      console.warn(`Error finding items: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Calculate the optimal path to craft an item
   */
  calculateCraftingPath(targetItem, count = 1) {
    // Get recipes for the item
    const recipes = this.getRecipesForItem(targetItem);
    if (!recipes || recipes.length === 0) {
      return { 
        success: false, 
        reason: 'No recipe found',
        gatheringNeeded: [],
        craftingSteps: []
      };
    }
    
    // Find the recipe with the least complexity
    const recipe = recipes[0]; // Assume first recipe is simplest for now
    
    // Check if we have all ingredients
    const inventory = this.bot.inventory.items();
    const ingredients = this.getRecipeIngredients(recipe);
    const gatheringNeeded = [];
    
    // Check each ingredient
    for (const [ingredientName, required] of Object.entries(ingredients)) {
      const available = this.countItemsInInventory(ingredientName);
      
      if (available < required) {
        gatheringNeeded.push({
          item: ingredientName,
          count: required - available,
          source: this.getBestSourceForItem(ingredientName)
        });
      }
    }
    
    // Build crafting steps
    const craftingSteps = [];
    
    // Add gathering steps
    if (gatheringNeeded.length > 0) {
      for (const item of gatheringNeeded) {
        if (item.source === 'craft') {
          // Recursive crafting for ingredients
          const subPath = this.calculateCraftingPath(item.item, item.count);
          if (subPath.craftingSteps) {
            craftingSteps.push(...subPath.craftingSteps);
          }
        } else {
          craftingSteps.push({
            action: 'gather',
            item: item.item,
            count: item.count,
            source: item.source
          });
        }
      }
    }
    
    // Add crafting step
    craftingSteps.push({
      action: 'craft',
      item: targetItem,
      count: count,
      requiresCraftingTable: recipe.requiresCraftingTable
    });
    
    return {
      success: true,
      gatheringNeeded,
      craftingSteps
    };
  }
  
  /**
   * Get ingredients from a recipe, combining duplicates
   */
  getRecipeIngredients(recipe) {
    const ingredients = {};
    
    if (recipe.ingredients) {
      // Simple recipes
      for (const ingredient of recipe.ingredients) {
        const item = this.mcData.items[ingredient.id];
        if (item) {
          const name = item.name;
          if (!ingredients[name]) ingredients[name] = 0;
          ingredients[name] += ingredient.count || 1;
        }
      }
    } else if (recipe.inShape) {
      // Shaped recipes
      for (const row of recipe.inShape) {
        for (const id of row) {
          if (id) {
            const item = this.mcData.items[id];
            if (item) {
              const name = item.name;
              if (!ingredients[name]) ingredients[name] = 0;
              ingredients[name] += 1;
            }
          }
        }
      }
    }
    
    return ingredients;
  }
  
  /**
   * Count items in inventory by name
   */
  countItemsInInventory(itemName) {
    try {
      const items = this.findItemsInInventory(itemName);
      if (!items || !Array.isArray(items)) return 0;
      return items.reduce((total, item) => total + (item.count || 1), 0);
    } catch (error) {
      console.warn(`Error counting items in inventory (${itemName}):`, error.message);
      return 0;
    }
  }
  
  /**
   * Determine the best source for obtaining an item
   */
  getBestSourceForItem(itemName) {
    // Check if item can be crafted
    if (this.getRecipesForItem(itemName).length > 0) {
      return 'craft';
    }
    
    // Check if item is a block that can be mined
    if (this.getBlockByName(itemName)) {
      return 'mine';
    }
    
    // Check item categories
    const item = this.getItemByName(itemName);
    if (!item) return 'unknown';
    
    if (itemName.includes('log') || itemName.includes('wood')) {
      return 'chop';
    }
    
    if (itemName.includes('beef') || itemName.includes('pork') || 
        itemName.includes('chicken') || itemName.includes('mutton')) {
      return 'hunt';
    }
    
    if (itemName.includes('wheat') || itemName.includes('carrot') || 
        itemName.includes('potato') || itemName.includes('beetroot')) {
      return 'farm';
    }
    
    return 'gather';
  }
  
  /**
   * Update learning manager with a reward based on obtained blocks/items
   */
  updateLearningFromGathering(itemName, count = 1) {
    if (!this.learningManager) return;
    
    // Calculate reward based on item value
    let reward = 0.1; // Base reward
    
    // Higher rewards for valuable items
    const valueMap = {
      // High value
      'diamond': 1.0,
      'emerald': 0.9,
      'ancient_debris': 1.0,
      'netherite_ingot': 1.0,
      'gold_ingot': 0.7,
      'iron_ingot': 0.6,
      
      // Medium value
      'redstone': 0.4,
      'lapis_lazuli': 0.4,
      'coal': 0.3,
      'copper_ingot': 0.3,
      
      // Basic resources
      'oak_log': 0.25,
      'spruce_log': 0.25,
      'birch_log': 0.25,
      'jungle_log': 0.25,
      'acacia_log': 0.25,
      'dark_oak_log': 0.25,
      'stone': 0.1,
      'cobblestone': 0.1,
      'dirt': 0.05,
      'sand': 0.1
    };
    
    reward = valueMap[itemName] || reward;
    reward *= count; // Scale by count
    
    this.learningManager.recordReward(reward, `gathered_${itemName}`);
  }
  
  /**
   * Update learning manager with a reward based on crafting
   */
  updateLearningFromCrafting(itemName, count = 1) {
    if (!this.learningManager) return;
    
    // Base reward scaled by complexity
    const complexity = this.getCraftingComplexity(itemName);
    let reward = 0.1 * complexity * count;
    
    // Bonus for first-time crafting
    if (!this.knownRecipes.has(itemName)) {
      reward += 0.5;
    }
    
    this.learningManager.recordReward(reward, `crafted_${itemName}`);
  }
  
  /**
   * Update learning manager with a reward based on exploration
   */
  updateLearningFromExploration(biomeName) {
    if (!this.learningManager) return;
    
    // Reward for exploration
    let reward = 0.3;
    
    // Bonus for discovering new biomes
    if (!this.knownBiomes.has(biomeName)) {
      reward += 0.5;
    }
    
    this.learningManager.recordReward(reward, `explored_${biomeName}`);
  }
  
  /**
   * Create a suggested task based on bot's current situation and needs
   */
  suggestNextTask() {
    // Determine current priorities
    const priorities = this.assessCurrentPriorities();
    
    // Select the highest priority task
    const highestPriority = Object.entries(priorities)
      .sort(([,a], [,b]) => b - a)[0];
    
    if (!highestPriority) return null;
    
    const [taskType, priority] = highestPriority;
    
    // Generate a specific task based on type
    switch (taskType) {
      case 'food':
        return this.suggestFoodTask();
      case 'tools':
        return this.suggestToolTask();
      case 'shelter':
        return this.suggestShelterTask();
      case 'explore':
        return this.suggestExplorationTask();
      case 'mine':
        return this.suggestMiningTask();
      case 'craft':
        return this.suggestCraftingTask();
      default:
        return { type: 'explore', reason: 'Default fallback' };
    }
  }
  
  /**
   * Assess current priorities based on bot state
   */
  assessCurrentPriorities() {
    const priorities = {
      food: 0,
      tools: 0,
      shelter: 0,
      explore: 0,
      mine: 0,
      craft: 0
    };
    
    // Food priority based on hunger
    if (this.bot.food !== undefined) {
      priorities.food = 20 - this.bot.food; // Higher priority when hungrier
    }
    
    // Tool priority based on available tools
    priorities.tools = this.assessToolNeeds();
    
    // Shelter priority based on time and weather
    priorities.shelter = this.assessShelterNeeds();
    
    // Exploration priority decreases as more areas are explored
    priorities.explore = 15 - Math.min(15, this.knownPoints.size / 10);
    
    // Mining priority based on tool availability and resource needs
    priorities.mine = this.assessMiningNeeds();
    
    // Crafting priority based on available materials and needs
    priorities.craft = this.assessCraftingNeeds();
    
    return priorities;
  }
  
  /**
   * Assess tool needs and return a priority score
   */
  assessToolNeeds() {
    let priority = 5; // Base priority
    
    // Check for basic tools
    const hasPickaxe = this.hasToolOfType('pickaxe');
    const hasAxe = this.hasToolOfType('axe');
    const hasSword = this.hasToolOfType('sword');
    
    if (!hasPickaxe) priority += 10;
    if (!hasAxe) priority += 8;
    if (!hasSword) priority += 5;
    
    // Check tool materials and durability
    const bestPickaxe = this.getBestToolOfType('pickaxe');
    if (bestPickaxe) {
      // Lower priority for better materials
      if (bestPickaxe.name.includes('diamond')) {
        priority -= 5;
      } else if (bestPickaxe.name.includes('iron')) {
        priority -= 3;
      } else if (bestPickaxe.name.includes('stone')) {
        priority -= 1;
      }
      
      // Higher priority for low durability
      if (bestPickaxe.durabilityUsed / bestPickaxe.maxDurability > 0.8) {
        priority += 7;
      }
    }
    
    return Math.max(0, priority);
  }
  
  /**
   * Assess shelter needs based on time and weather
   */
  assessShelterNeeds() {
    let priority = 0;
    
    // Check time of day
    if (this.bot.time && this.bot.time.timeOfDay) {
      const timeOfDay = this.bot.time.timeOfDay;
      // Higher priority as night approaches
      if (timeOfDay > 11000 && timeOfDay < 13000) {
        // approaching night
        priority += 10;
      } else if (timeOfDay >= 13000 && timeOfDay <= 23000) {
        // it's night time
        priority += 15;
      }
    }
    
    // Check weather
    if (this.bot.isRaining) {
      priority += 5;
    }
    
    // Check for nearby hostile mobs
    const hostileMobs = this.getNearbyHostileMobs();
    priority += hostileMobs.length * 2;
    
    return priority;
  }
  
  /**
   * Assess mining needs based on resources
   */
  assessMiningNeeds() {
    let priority = 5; // Base priority
    
    // Higher priority if we need stone for tools
    const stoneCount = this.countItemsInInventory('cobblestone');
    if (stoneCount < 10) {
      priority += 8;
    }
    
    // Higher priority if we need coal for torches
    const coalCount = this.countItemsInInventory('coal');
    if (coalCount < 5) {
      priority += 5;
    }
    
    // Higher priority if we need iron
    const ironCount = this.countItemsInInventory('iron_ingot');
    if (ironCount < 3) {
      priority += 7;
    }
    
    return priority;
  }
  
  /**
   * Assess crafting needs
   */
  assessCraftingNeeds() {
    let priority = 0;
    
    // Check if we have materials to craft needed items
    if (this.canCraftBetterTool('pickaxe')) {
      priority += 10;
    }
    
    if (this.canCraftBetterTool('axe')) {
      priority += 8;
    }
    
    if (this.canCraftBetterTool('sword')) {
      priority += 6;
    }
    
    // Check if we have planks but need sticks
    const planksCount = this.countItemsInInventory('oak_planks') +
                        this.countItemsInInventory('spruce_planks') +
                        this.countItemsInInventory('birch_planks') +
                        this.countItemsInInventory('jungle_planks') +
                        this.countItemsInInventory('acacia_planks') +
                        this.countItemsInInventory('dark_oak_planks');
    
    const sticksCount = this.countItemsInInventory('stick');
    
    if (planksCount > 4 && sticksCount < 4) {
      priority += 5;
    }
    
    // Check if we can craft torches
    const coalCount = this.countItemsInInventory('coal');
    if (coalCount > 0 && sticksCount > 0) {
      priority += 4;
    }
    
    return priority;
  }
  
  /**
   * Check if bot has a specific type of tool
   */
  hasToolOfType(toolType) {
    // Make sure inventory is available
    if (!this.bot || !this.bot.inventory || typeof this.bot.inventory.items !== 'function') {
      return false;
    }
    
    try {
      // Get inventory items
      const items = this.bot.inventory.items();
      
      // Check if any items match the tool type
      return items.some(item => 
        item && item.name && item.name.includes && item.name.includes(toolType)
      );
    } catch (error) {
      console.warn(`Error checking for tool type ${toolType}:`, error.message);
      return false;
    }
  }
  
  /**
   * Get the best tool of a specific type
   */
  getBestToolOfType(toolType) {
    // Make sure inventory is available
    if (!this.bot || !this.bot.inventory || typeof this.bot.inventory.items !== 'function') {
      return null;
    }
    
    try {
      // Get inventory items
      const items = this.bot.inventory.items();
      
      // Filter to just the tools of the requested type
      const tools = items.filter(item => 
        item && item.name && item.name.includes && item.name.includes(toolType)
      );
      
      if (tools.length === 0) return null;
      
      // Order of precedence for tool materials
      const materials = ['netherite', 'diamond', 'iron', 'golden', 'stone', 'wooden'];
      
      for (const material of materials) {
        const matchingTool = tools.find(tool => 
          tool.name.includes(material)
        );
        
        if (matchingTool) return matchingTool;
      }
      
      return tools[0]; // fallback to any tool
    } catch (error) {
      console.warn(`Error getting best tool of type ${toolType}:`, error.message);
      return null;
    }
  }
  
  /**
   * Check if we can craft a better tool than currently owned
   */
  canCraftBetterTool(toolType) {
    const currentBestTool = this.getBestToolOfType(toolType);
    
    // If no tool, any new tool is better
    if (!currentBestTool) return true;
    
    // Current material level
    const materials = ['wooden', 'stone', 'iron', 'golden', 'diamond', 'netherite'];
    const currentMaterial = materials.find(m => currentBestTool.name.includes(m)) || 'wooden';
    const currentIndex = materials.indexOf(currentMaterial);
    
    // Check if we have materials for a better tool
    for (let i = currentIndex + 1; i < materials.length; i++) {
      const material = materials[i];
      if (material === 'wooden' && this.hasLogsForTool()) return true;
      if (material === 'stone' && this.countItemsInInventory('cobblestone') >= 3) return true;
      if (material === 'iron' && this.countItemsInInventory('iron_ingot') >= 3) return true;
      if (material === 'golden' && this.countItemsInInventory('gold_ingot') >= 3) return true;
      if (material === 'diamond' && this.countItemsInInventory('diamond') >= 3) return true;
    }
    
    return false;
  }
  
  /**
   * Check if we have logs to make wooden tools
   */
  hasLogsForTool() {
    return this.countItemsInInventory('oak_log') >= 1 ||
           this.countItemsInInventory('spruce_log') >= 1 ||
           this.countItemsInInventory('birch_log') >= 1 ||
           this.countItemsInInventory('jungle_log') >= 1 ||
           this.countItemsInInventory('acacia_log') >= 1 ||
           this.countItemsInInventory('dark_oak_log') >= 1;
  }
  
  /**
   * Get nearby hostile mobs
   */
  getNearbyHostileMobs() {
    try {
      const hostileTypes = [
        'zombie', 'skeleton', 'creeper', 'spider', 'enderman',
        'witch', 'slime', 'phantom', 'drowned', 'pillager'
      ];
      
      return Object.values(this.bot.entities).filter(entity => {
        if (!entity || !entity.type || entity.type !== 'mob') return false;
        return hostileTypes.some(type => entity.name.toLowerCase().includes(type));
      });
    } catch (error) {
      console.warn(`Error getting hostile mobs: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Suggest a food task
   */
  suggestFoodTask() {
    try {
      // Make sure inventory is available
      if (!this.bot || !this.bot.inventory || typeof this.bot.inventory.items !== 'function') {
        return {
          type: 'gather',
          target: 'food',
          reason: 'Need food (fallback)'
        };
      }
      
      // Check for food in inventory
      const items = this.bot.inventory.items();
      if (!items || !Array.isArray(items)) {
        return {
          type: 'gather',
          target: 'food',
          reason: 'Need food (fallback)'
        };
      }
      
      const foodItems = items.filter(item => 
        item && item.name && this.isFood(item.name)
      );
      
      if (foodItems.length > 0) {
        // Use existing food
        return {
          type: 'eat',
          item: foodItems[0].name,
          reason: 'Hungry and have food'
        };
      }
      
      // Look for nearby food sources
      const nearbyFoodSources = this.findNearbyFoodSources();
      if (nearbyFoodSources && nearbyFoodSources.length > 0) {
        const source = nearbyFoodSources[0];
        return {
          type: 'gather',
          target: source.name,
          reason: 'Need food'
        };
      }
      
      // Hunt animals as last resort
      return {
        type: 'hunt',
        reason: 'Need food'
      };
    } catch (error) {
      console.warn('Error suggesting food task:', error);
      return {
        type: 'gather',
        target: 'food',
        reason: 'Need food (error fallback)'
      };
    }
  }
  
  /**
   * Suggest a tool task
   */
  suggestToolTask() {
    // Check what tools we need most
    if (!this.hasToolOfType('pickaxe')) {
      return this.suggestCraftingTaskForTool('pickaxe');
    }
    
    if (!this.hasToolOfType('axe')) {
      return this.suggestCraftingTaskForTool('axe');
    }
    
    if (!this.hasToolOfType('sword')) {
      return this.suggestCraftingTaskForTool('sword');
    }
    
    // Upgrade existing tools
    const pickaxe = this.getBestToolOfType('pickaxe');
    if (pickaxe && pickaxe.name.includes('wooden')) {
      return this.suggestCraftingTaskForTool('pickaxe', 'stone');
    }
    
    return {
      type: 'craft',
      item: 'stone_pickaxe',
      reason: 'Need better tools'
    };
  }
  
  /**
   * Suggest a crafting task for a specific tool
   */
  suggestCraftingTaskForTool(toolType, material = 'wooden') {
    // Check if we have materials
    if (material === 'wooden') {
      // Check for logs or planks
      if (this.hasLogsForTool()) {
        return {
          type: 'craft',
          item: `wooden_${toolType}`,
          reason: `Need a ${toolType}`
        };
      } else {
        // Get logs first
        return {
          type: 'gather',
          target: 'oak_log',
          count: 1,
          reason: `Need wood for ${toolType}`
        };
      }
    } else if (material === 'stone') {
      // Check for cobblestone
      if (this.countItemsInInventory('cobblestone') >= 3) {
        return {
          type: 'craft',
          item: `stone_${toolType}`,
          reason: `Need a better ${toolType}`
        };
      } else {
        // Get stone first
        return {
          type: 'mine',
          target: 'stone',
          count: 3,
          reason: `Need stone for ${toolType}`
        };
      }
    }
    
    // Default
    return {
      type: 'craft',
      item: `${material}_${toolType}`,
      reason: `Need a ${toolType}`
    };
  }
  
  /**
   * Suggest a shelter task
   */
  suggestShelterTask() {
    // Check if we already have a shelter nearby
    // TODO: Implement shelter tracking
    
    // Check if we have building materials
    const dirtCount = this.countItemsInInventory('dirt');
    const stoneCount = this.countItemsInInventory('cobblestone') + 
                       this.countItemsInInventory('stone');
    const woodCount = this.countItemsInInventory('oak_planks') +
                      this.countItemsInInventory('spruce_planks') +
                      this.countItemsInInventory('birch_planks');
    
    if (dirtCount >= 12 || stoneCount >= 12 || woodCount >= 12) {
      return {
        type: 'build',
        structure: 'shelter',
        reason: 'Need shelter for the night'
      };
    }
    
    // Get materials
    if (stoneCount < 12) {
      return {
        type: 'mine',
        target: 'stone',
        count: 12 - stoneCount,
        reason: 'Need materials for shelter'
      };
    } else if (woodCount < 12) {
      return {
        type: 'gather',
        target: 'oak_log',
        count: 3, // One log = 4 planks
        reason: 'Need materials for shelter'
      };
    } else {
      return {
        type: 'gather',
        target: 'dirt',
        count: 12 - dirtCount,
        reason: 'Need materials for shelter'
      };
    }
  }
  
  /**
   * Suggest an exploration task
   */
  suggestExplorationTask() {
    // Find an unexplored direction
    // TODO: Implement exploration tracking
    
    return {
      type: 'explore',
      distance: 100,
      reason: 'Discover new areas'
    };
  }
  
  /**
   * Suggest a mining task
   */
  suggestMiningTask() {
    // Check if night time (mine at night)
    if (this.bot.time && this.bot.time.timeOfDay > 12000) {
      return {
        type: 'mine',
        style: 'tunnel',
        reason: 'Mining safely at night'
      };
    }
    
    // Check what resources we need most
    if (this.countItemsInInventory('iron_ingot') + 
        this.countItemsInInventory('iron_ore') < 3) {
      return {
        type: 'mine',
        target: 'iron_ore',
        reason: 'Need iron'
      };
    }
    
    if (this.countItemsInInventory('coal') < 8) {
      return {
        type: 'mine',
        target: 'coal_ore',
        reason: 'Need coal for torches'
      };
    }
    
    // Default to valuable ores
    return {
      type: 'mine',
      target: 'valuable',
      reason: 'Gathering resources'
    };
  }
  
  /**
   * Suggest a crafting task
   */
  suggestCraftingTask() {
    // Check if we can craft useful items
    
    // Crafting table
    if (!this.hasItem('crafting_table') && this.hasLogsForTool()) {
      return {
        type: 'craft',
        item: 'crafting_table',
        reason: 'Need a crafting table'
      };
    }
    
    // Furnace
    if (!this.hasItem('furnace') && this.countItemsInInventory('cobblestone') >= 8) {
      return {
        type: 'craft',
        item: 'furnace',
        reason: 'Need a furnace'
      };
    }
    
    // Sticks
    const sticksCount = this.countItemsInInventory('stick');
    const planksCount = this.countTotalPlanks();
    
    if (sticksCount < 4 && planksCount >= 2) {
      return {
        type: 'craft',
        item: 'stick',
        count: 4,
        reason: 'Need sticks for tools'
      };
    }
    
    // Torches
    if (this.countItemsInInventory('torch') < 8 && 
        this.countItemsInInventory('coal') > 0 &&
        sticksCount > 0) {
      return {
        type: 'craft',
        item: 'torch',
        count: 4,
        reason: 'Need torches for light'
      };
    }
    
    // Default
    return {
      type: 'craft',
      item: 'planks',
      reason: 'Processing resources'
    };
  }
  
  /**
   * Check if the bot has a specific item
   */
  hasItem(itemName) {
    return this.countItemsInInventory(itemName) > 0;
  }
  
  /**
   * Count total planks of all wood types
   */
  countTotalPlanks() {
    return this.countItemsInInventory('oak_planks') +
           this.countItemsInInventory('spruce_planks') +
           this.countItemsInInventory('birch_planks') +
           this.countItemsInInventory('jungle_planks') +
           this.countItemsInInventory('acacia_planks') +
           this.countItemsInInventory('dark_oak_planks');
  }
  
  /**
   * Find nearby food sources
   */
  findNearbyFoodSources() {
    const sources = [];
    
    // Check for crops
    const crops = [
      'wheat', 'potato', 'carrot', 'beetroot',
      'melon', 'pumpkin', 'apple', 'sweet_berries'
    ];
    
    for (const crop of crops) {
      const blocks = this.findNearestBlocks(crop, 5, 32);
      if (blocks.length > 0) {
        sources.push({
          type: 'crop',
          name: crop,
          positions: blocks.map(b => b.position),
          distance: this.bot.entity.position.distanceTo(blocks[0].position)
        });
      }
    }
    
    // Check for animals (living food sources)
    const animals = ['cow', 'pig', 'chicken', 'sheep', 'rabbit'];
    for (const animal of animals) {
      const entities = Object.values(this.bot.entities).filter(e =>
        e && e.name && e.name.toLowerCase() === animal
      );
      
      if (entities.length > 0) {
        sources.push({
          type: 'animal',
          name: animal,
          entities: entities,
          distance: this.bot.entity.position.distanceTo(entities[0].position)
        });
      }
    }
    
    // Sort by distance
    return sources.sort((a, b) => a.distance - b.distance);
  }
  
  /**
   * Check if an item is food
   */
  isFood(itemName) {
    const foodKeywords = [
      'apple', 'beef', 'pork', 'mutton', 'chicken', 'rabbit',
      'bread', 'carrot', 'potato', 'beetroot', 'melon', 'berries',
      'cod', 'salmon', 'cookie', 'cake'
    ];
    
    return foodKeywords.some(keyword => itemName.includes(keyword));
  }
}

module.exports = MinecraftDataIntegration;