/**
 * Farm State for Minecraft Bot
 * 
 * In this state, the bot will:
 * - Locate, harvest, and replant crops
 * - Create and maintain farms
 * - Manage animal breeding and food collection
 */

// Import our custom StateBehavior base class
const StateBehavior = require('../bot/stateBehavior');
const Vec3 = require('vec3');
const logger = require('../bot/logger');

class FarmState extends StateBehavior {
  constructor(bot, botManager) {
    super(bot, 'farm');
    this.botManager = botManager;
    
    // State variables
    this.farmingTarget = null;          // Current target (crop/animal)
    this.farmingMode = 'crops';         // 'crops' or 'animals'
    this.farmRadius = 20;               // Search radius for farming
    this.cropTypes = ['wheat', 'carrot', 'potato', 'beetroot'];
    this.animalTypes = ['cow', 'sheep', 'chicken', 'pig'];
    this.lastSearchTime = 0;            // Last time we searched for farming targets
    this.searchInterval = 5000;         // How often to search for new targets (ms)
    this.harvestedCrops = 0;            // Number of crops harvested in this session
    this.farmingStartTime = null;       // When the farming session started
    this.farmingArea = null;            // Area where bot should farm
    this.lastFarmAreaUpdate = 0;        // Last time farm area was updated
    this.farmPatterns = [];             // Patterns for identifying crop layouts
    this.breedingCooldown = 0;          // Cooldown for animal breeding
    this.seedsNeeded = false;           // Flag for when we need to gather seeds
    this.lastPlantingAttempt = 0;       // Last time we tried to plant crops
  }

  onStateEntered() {
    super.onStateEntered();
    logger.info('Entered farming state');
    
    // Initialize farming session
    this.farmingStartTime = Date.now();
    this.harvestedCrops = 0;
    this.breedingCooldown = 0;
    this.seedsNeeded = false;
    
    // Announce state change
    this.bot.chat('Starting farming activities');
    
    // Set initial mode based on config or default to crops
    this.farmingMode = this.botManager.config.farming?.defaultMode || 'crops';
    
    // Look for farming targets immediately
    this.findFarmingTargets();
  }

  onStateExited() {
    super.onStateExited();
    logger.info('Exited farming state');
    
    // Report farming results
    if (this.harvestedCrops > 0) {
      const duration = (Date.now() - this.farmingStartTime) / 1000;
      this.bot.chat(`Farming session complete: harvested ${this.harvestedCrops} crops in ${duration.toFixed(0)} seconds`);
    }
    
    // Reset state variables
    this.farmingTarget = null;
    this.farmingArea = null;
    this.farmingStartTime = null;
    
    // Clear control states
    this.bot.clearControlStates();
  }

  /**
   * Main update function for the farming state
   */
  update() {
    // Skip if we're not active
    if (!this.active) return;
    
    const now = Date.now();
    
    // Update breeding cooldown
    if (this.breedingCooldown > 0) {
      this.breedingCooldown -= 1;
    }
    
    // Periodically search for new farming targets
    if (now - this.lastSearchTime > this.searchInterval) {
      this.findFarmingTargets();
      this.lastSearchTime = now;
    }
    
    // If we have a farming target, process it
    if (this.farmingTarget) {
      if (this.farmingMode === 'crops') {
        this.processCropTarget();
      } else if (this.farmingMode === 'animals') {
        this.processAnimalTarget();
      }
    } else {
      // If we need seeds and have no other targets, look for tall grass
      if (this.seedsNeeded && this.farmingMode === 'crops') {
        this.lookForGrassToHarvest();
      }
      
      // If we still have no target, check if farming area needs revisiting
      if (!this.farmingTarget && this.farmingArea && now - this.lastFarmAreaUpdate > 30000) {
        this.updateFarmingArea();
        this.lastFarmAreaUpdate = now;
      }
    }
    
    // If we've been in farming mode for too long with no results, consider changing mode
    const timeSinceFarmingStarted = now - this.farmingStartTime;
    if (timeSinceFarmingStarted > 2 * 60 * 1000 && this.harvestedCrops === 0) {
      this.considerChangingFarmingMode();
    }
  }

  /**
   * Find farming targets based on current mode
   */
  findFarmingTargets() {
    logger.debug(`Looking for farming targets in mode: ${this.farmingMode}`);
    
    if (this.farmingMode === 'crops') {
      this.findCropsToHarvest();
    } else if (this.farmingMode === 'animals') {
      this.findAnimalsToBreed();
    }
  }

  /**
   * Find crops that are ready to harvest
   */
  findCropsToHarvest() {
    try {
      logger.debug('Searching for crops to harvest');
      
      // Get dictionary of crop block IDs by crop age
      const crops = this.getCropBlocks();
      if (!crops || Object.keys(crops).length === 0) {
        logger.warn('No crop blocks found in registry');
        return;
      }
      
      // Convert to array of block IDs to search for mature crops
      const matureCropIds = [];
      
      // Wheat mature age is 7, others might vary
      for (const [cropName, cropData] of Object.entries(crops)) {
        if (cropData && cropData.mature) {
          matureCropIds.push(cropData.mature);
        }
      }
      
      if (matureCropIds.length === 0) {
        logger.warn('No mature crop IDs identified');
        return;
      }
      
      // Find mature crops
      const blocks = this.bot.findBlocks({
        matching: block => matureCropIds.includes(block.type),
        maxDistance: this.farmRadius,
        count: 10
      });
      
      if (blocks.length > 0) {
        // Sort by distance
        blocks.sort((a, b) => {
          const distA = this.bot.entity.position.distanceTo(a);
          const distB = this.bot.entity.position.distanceTo(b);
          return distA - distB;
        });
        
        // Set the closest as our target
        this.farmingTarget = {
          type: 'crop',
          position: blocks[0],
          block: this.bot.blockAt(blocks[0])
        };
        
        logger.info(`Found crop to harvest at ${blocks[0]}`);
      } else {
        logger.debug('No mature crops found nearby');
        
        // If no mature crops, check for empty farmland to plant
        this.findEmptyFarmlandToPlant();
      }
    } catch (error) {
      logger.error('Error finding crops to harvest:', error);
    }
  }

  /**
   * Map crop blocks and their growth stages
   */
  getCropBlocks() {
    const crops = {};
    
    try {
      // Get crop blocks from registry
      // Wheat
      const wheatBlock = this.bot.registry.blocksByName['wheat'];
      if (wheatBlock) {
        crops.wheat = {
          id: wheatBlock.id,
          immature: wheatBlock.id, // These will be filtered by age
          mature: wheatBlock.id,   // We'll check age when harvesting
          seed: 'wheat_seeds'
        };
      }
      
      // Carrots
      const carrotBlock = this.bot.registry.blocksByName['carrots'];
      if (carrotBlock) {
        crops.carrot = {
          id: carrotBlock.id,
          immature: carrotBlock.id,
          mature: carrotBlock.id,
          seed: 'carrot'
        };
      }
      
      // Potatoes
      const potatoBlock = this.bot.registry.blocksByName['potatoes'];
      if (potatoBlock) {
        crops.potato = {
          id: potatoBlock.id,
          immature: potatoBlock.id,
          mature: potatoBlock.id,
          seed: 'potato'
        };
      }
      
      // Beetroot
      const beetrootBlock = this.bot.registry.blocksByName['beetroots'];
      if (beetrootBlock) {
        crops.beetroot = {
          id: beetrootBlock.id,
          immature: beetrootBlock.id,
          mature: beetrootBlock.id,
          seed: 'beetroot_seeds'
        };
      }
    } catch (error) {
      logger.error('Error mapping crop blocks:', error);
    }
    
    return crops;
  }

  /**
   * Process a crop target - move to it and harvest if ready
   */
  async processCropTarget() {
    if (!this.farmingTarget || this.farmingTarget.type !== 'crop') return;
    
    try {
      const target = this.farmingTarget;
      const targetBlock = this.bot.blockAt(target.position);
      
      // Make sure target is still valid
      if (!targetBlock || !this.isMatureCrop(targetBlock)) {
        logger.debug('Crop target no longer valid');
        this.farmingTarget = null;
        return;
      }
      
      // If we're not close enough, move to the crop
      const distance = this.bot.entity.position.distanceTo(target.position);
      if (distance > 3) {
        await this.moveToTarget(target.position);
        return;
      }
      
      // We're close enough, harvest the crop
      logger.info(`Harvesting crop at ${target.position}`);
      
      try {
        // Equip appropriate tool if available (hoe might be slightly better)
        await this.equipFarmingTool();
        
        // Harvest the crop
        await this.bot.dig(targetBlock);
        
        // Increment counter
        this.harvestedCrops++;
        
        // Get the seed type for this crop
        const seedType = this.getSeedTypeForCrop(targetBlock);
        
        // Check if we need to plant a new crop
        if (seedType) {
          // Wait a tick for the block to update
          await new Promise(resolve => setTimeout(resolve, 50));
          
          // Check if there's farmland below
          const belowPos = target.position.offset(0, -1, 0);
          const belowBlock = this.bot.blockAt(belowPos);
          
          if (belowBlock && belowBlock.name === 'farmland') {
            // Try to replant immediately
            await this.plantCrop(target.position, seedType);
          }
        }
        
        // Clear target
        this.farmingTarget = null;
        
        // Find another target nearby
        this.findCropsToHarvest();
      } catch (error) {
        logger.error('Error harvesting crop:', error);
        this.farmingTarget = null;
      }
    } catch (error) {
      logger.error('Error processing crop target:', error);
      this.farmingTarget = null;
    }
  }

  /**
   * Check if a block is a mature crop ready for harvest
   */
  isMatureCrop(block) {
    if (!block) return false;
    
    try {
      // Check wheat (age 7 is mature)
      if (block.name === 'wheat') {
        return block.metadata === 7;
      }
      
      // Check carrots and potatoes (age 7 is mature)
      if (block.name === 'carrots' || block.name === 'potatoes') {
        return block.metadata === 7;
      }
      
      // Check beetroot (age 3 is mature)
      if (block.name === 'beetroots') {
        return block.metadata === 3;
      }
    } catch (error) {
      logger.warn('Error checking crop maturity:', error);
    }
    
    return false;
  }

  /**
   * Get the seed type needed to replant a crop
   */
  getSeedTypeForCrop(block) {
    if (!block) return null;
    
    try {
      switch(block.name) {
        case 'wheat':
          return 'wheat_seeds';
        case 'carrots':
          return 'carrot';
        case 'potatoes':
          return 'potato';
        case 'beetroots':
          return 'beetroot_seeds';
        default:
          return null;
      }
    } catch (error) {
      logger.warn('Error getting seed type for crop:', error);
      return null;
    }
  }

  /**
   * Find empty farmland to plant crops on
   */
  findEmptyFarmlandToPlant() {
    try {
      logger.debug('Looking for empty farmland to plant');
      
      // Find farmland blocks
      const farmlandId = this.bot.registry.blocksByName['farmland']?.id;
      if (!farmlandId) {
        logger.warn('Could not find farmland block ID');
        return;
      }
      
      // Find farmland blocks
      const farmlandBlocks = this.bot.findBlocks({
        matching: farmlandId,
        maxDistance: this.farmRadius,
        count: 20
      });
      
      if (farmlandBlocks.length === 0) {
        logger.debug('No farmland found nearby');
        return;
      }
      
      // Check each farmland block for an empty space above
      for (const pos of farmlandBlocks) {
        const abovePos = pos.offset(0, 1, 0);
        const aboveBlock = this.bot.blockAt(abovePos);
        
        // If the space above is empty, we can plant here
        if (aboveBlock && aboveBlock.name === 'air') {
          this.farmingTarget = {
            type: 'plantingSpot',
            position: abovePos,
            farmlandPosition: pos
          };
          
          logger.info(`Found empty farmland to plant at ${abovePos}`);
          return;
        }
      }
      
      logger.debug('No empty farmland spots found');
    } catch (error) {
      logger.error('Error finding empty farmland:', error);
    }
  }

  /**
   * Plant a crop at the specified position
   */
  async plantCrop(position, seedType) {
    // Don't try to plant too frequently
    const now = Date.now();
    if (now - this.lastPlantingAttempt < 1000) return false;
    this.lastPlantingAttempt = now;
    
    try {
      logger.info(`Attempting to plant ${seedType} at ${position}`);
      
      // Find seeds in inventory
      const seedItem = this.bot.inventory.items().find(item => item.name === seedType);
      
      if (!seedItem) {
        logger.warn(`No ${seedType} found in inventory`);
        this.seedsNeeded = true;
        return false;
      }
      
      // Equip the seeds
      await this.bot.equip(seedItem, 'hand');
      
      // Get the block we're planting on
      const belowPos = position.offset(0, -1, 0);
      const belowBlock = this.bot.blockAt(belowPos);
      
      if (!belowBlock || belowBlock.name !== 'farmland') {
        logger.warn('Not farmland below planting position');
        return false;
      }
      
      // Get the reference block to place against
      const placementBlock = belowBlock;
      
      // Use the placeBlock function to place the seed
      await this.bot.placeBlock(placementBlock, new Vec3(0, 1, 0));
      
      logger.info(`Successfully planted ${seedType}`);
      return true;
    } catch (error) {
      logger.error(`Error planting crop: ${error.message}`);
      return false;
    }
  }

  /**
   * Process a planting target - move to it and plant a crop
   */
  async processPlantingTarget() {
    if (!this.farmingTarget || this.farmingTarget.type !== 'plantingSpot') return;
    
    try {
      const target = this.farmingTarget;
      
      // If we're not close enough, move to the planting spot
      const distance = this.bot.entity.position.distanceTo(target.position);
      if (distance > 3) {
        await this.moveToTarget(target.position);
        return;
      }
      
      // We're close enough, try to plant
      // Select a seed type based on what we have in inventory
      const seedTypes = ['wheat_seeds', 'carrot', 'potato', 'beetroot_seeds'];
      let seedType = null;
      
      for (const type of seedTypes) {
        const seedItem = this.bot.inventory.items().find(item => item.name === type);
        if (seedItem) {
          seedType = type;
          break;
        }
      }
      
      if (!seedType) {
        logger.warn('No seeds found in inventory');
        this.seedsNeeded = true;
        this.farmingTarget = null;
        return;
      }
      
      // Plant the crop
      const success = await this.plantCrop(target.position, seedType);
      
      // Clear target
      this.farmingTarget = null;
      
      // Find another target if planting was successful
      if (success) {
        this.findEmptyFarmlandToPlant();
      }
    } catch (error) {
      logger.error('Error processing planting target:', error);
      this.farmingTarget = null;
    }
  }

  /**
   * Find animals that can be bred
   */
  findAnimalsToBreed() {
    try {
      logger.debug('Searching for animals to breed');
      
      // Skip if on cooldown
      if (this.breedingCooldown > 0) {
        logger.debug(`Breeding on cooldown (${this.breedingCooldown})`);
        return;
      }
      
      // Get entities around the bot
      const animals = Object.values(this.bot.entities).filter(entity => {
        // Check if it's an animal we care about
        if (!this.animalTypes.includes(entity.name)) return false;
        
        // Check distance
        const distance = entity.position.distanceTo(this.bot.entity.position);
        return distance <= this.farmRadius;
      });
      
      if (animals.length < 2) {
        logger.debug('Not enough animals found for breeding');
        return;
      }
      
      // Group animals by type
      const animalsByType = {};
      for (const animal of animals) {
        if (!animalsByType[animal.name]) {
          animalsByType[animal.name] = [];
        }
        animalsByType[animal.name].push(animal);
      }
      
      // Find a type with at least 2 animals
      let breedingPair = null;
      let breedingFood = null;
      
      for (const [type, typeAnimals] of Object.entries(animalsByType)) {
        if (typeAnimals.length >= 2) {
          // Check if we have breeding food for this type
          const food = this.getBreedingFoodForAnimal(type);
          
          if (food) {
            breedingPair = {
              type: type,
              animals: typeAnimals.slice(0, 2) // Take the first two
            };
            breedingFood = food;
            break;
          }
        }
      }
      
      if (breedingPair) {
        this.farmingTarget = {
          type: 'breedingPair',
          animalType: breedingPair.type,
          animals: breedingPair.animals,
          food: breedingFood
        };
        
        logger.info(`Found ${breedingPair.type}s to breed using ${breedingFood}`);
      } else {
        logger.debug('No suitable breeding pairs found');
      }
    } catch (error) {
      logger.error('Error finding animals to breed:', error);
    }
  }

  /**
   * Get the appropriate breeding food for an animal type
   */
  getBreedingFoodForAnimal(animalType) {
    try {
      // Get potential breeding foods
      const breedingFoods = {
        cow: ['wheat'],
        sheep: ['wheat'],
        chicken: ['wheat_seeds', 'melon_seeds', 'beetroot_seeds', 'pumpkin_seeds'],
        pig: ['carrot', 'potato', 'beetroot']
      };
      
      // Get foods for this animal type
      const foods = breedingFoods[animalType] || [];
      
      // Check if we have any of these foods in inventory
      for (const food of foods) {
        const foodItem = this.bot.inventory.items().find(item => item.name === food);
        if (foodItem && foodItem.count >= 2) { // Need at least 2 for breeding
          return food;
        }
      }
      
      return null;
    } catch (error) {
      logger.warn('Error getting breeding food:', error);
      return null;
    }
  }

  /**
   * Process a breeding target - move to the animals and breed them
   */
  async processAnimalTarget() {
    if (!this.farmingTarget || this.farmingTarget.type !== 'breedingPair') return;
    
    try {
      const target = this.farmingTarget;
      
      // Make sure animals are still valid
      const validAnimals = target.animals.filter(animal => 
        this.bot.entities[animal.id] && 
        !animal.metadata?.inLove); // Skip animals already in love mode
      
      if (validAnimals.length < 2) {
        logger.debug('Not enough valid animals in breeding pair');
        this.farmingTarget = null;
        return;
      }
      
      // Calculate center point between the animals
      const centerPos = validAnimals.reduce(
        (sum, animal) => sum.plus(animal.position), 
        new Vec3(0, 0, 0)
      ).scaled(1 / validAnimals.length);
      
      // If we're not close enough, move to the center
      const distance = this.bot.entity.position.distanceTo(centerPos);
      if (distance > 3) {
        await this.moveToTarget(centerPos);
        return;
      }
      
      // We're close enough, breed the animals
      logger.info(`Breeding ${validAnimals.length} ${target.animalType}s with ${target.food}`);
      
      try {
        // Find the food in inventory
        const foodItem = this.bot.inventory.items().find(item => item.name === target.food);
        
        if (!foodItem || foodItem.count < 2) {
          logger.warn(`Not enough ${target.food} for breeding`);
          this.farmingTarget = null;
          return;
        }
        
        // Equip the food
        await this.bot.equip(foodItem, 'hand');
        
        // Feed each animal
        for (const animal of validAnimals.slice(0, 2)) {
          await this.bot.useOn(animal);
          
          // Short delay between feeding
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Set cooldown to prevent immediate rebreeding
        this.breedingCooldown = 60; // 60 ticks (3 seconds) cooldown
        
        // Clear target
        this.farmingTarget = null;
        
        // Look for more breeding pairs after a delay
        setTimeout(() => this.findAnimalsToBreed(), 5000);
      } catch (error) {
        logger.error('Error breeding animals:', error);
        this.farmingTarget = null;
      }
    } catch (error) {
      logger.error('Error processing breeding target:', error);
      this.farmingTarget = null;
    }
  }

  /**
   * Move to a target position
   */
  async moveToTarget(position) {
    try {
      // Skip if we're already moving
      if (this.bot.pathfinder.isMoving()) return;
      
      // Move to the target
      logger.debug(`Moving to position ${position}`);
      
      await this.bot.pathfinder.goto(this.bot.pathfinder.createFlyGoal(
        position.x, position.y, position.z, 1 // Get within 1 block
      ));
    } catch (error) {
      logger.warn(`Error moving to target: ${error.message}`);
      
      // Try a simple movement if pathfinding fails
      this.bot.lookAt(position);
      this.bot.setControlState('forward', true);
      
      setTimeout(() => {
        this.bot.clearControlStates();
      }, 1000);
    }
  }

  /**
   * Equip the best tool for farming
   */
  async equipFarmingTool() {
    try {
      // Try to find a hoe first (best for farming)
      const hoeTypes = ['diamond_hoe', 'iron_hoe', 'stone_hoe', 'golden_hoe', 'wooden_hoe'];
      
      for (const hoeType of hoeTypes) {
        const hoeItem = this.bot.inventory.items().find(item => item.name === hoeType);
        if (hoeItem) {
          await this.bot.equip(hoeItem, 'hand');
          return;
        }
      }
      
      // If no hoe, any tool will do
      const toolTypes = ['diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe',
                         'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe',
                         'diamond_shovel', 'iron_shovel', 'stone_shovel', 'wooden_shovel'];
      
      for (const toolType of toolTypes) {
        const toolItem = this.bot.inventory.items().find(item => item.name === toolType);
        if (toolItem) {
          await this.bot.equip(toolItem, 'hand');
          return;
        }
      }
      
      // If no tools, just use hand
      logger.debug('No farming tools found, using hand');
    } catch (error) {
      logger.warn(`Error equipping farming tool: ${error.message}`);
    }
  }

  /**
   * Look for tall grass to harvest for seeds
   */
  async lookForGrassToHarvest() {
    try {
      logger.debug('Looking for tall grass to harvest for seeds');
      
      // Find tall grass or fern blocks
      const grassId = this.bot.registry.blocksByName['tall_grass']?.id;
      const fernId = this.bot.registry.blocksByName['fern']?.id;
      
      if (!grassId && !fernId) {
        logger.warn('Could not find grass block IDs');
        return;
      }
      
      // Prepare matching function
      const blockIds = [grassId, fernId].filter(id => id !== undefined);
      
      // Find grass blocks
      const grassBlocks = this.bot.findBlocks({
        matching: block => blockIds.includes(block.type),
        maxDistance: this.farmRadius,
        count: 5
      });
      
      if (grassBlocks.length === 0) {
        logger.debug('No tall grass found nearby');
        return;
      }
      
      // Sort by distance
      grassBlocks.sort((a, b) => {
        const distA = this.bot.entity.position.distanceTo(a);
        const distB = this.bot.entity.position.distanceTo(b);
        return distA - distB;
      });
      
      // Set target
      this.farmingTarget = {
        type: 'grass',
        position: grassBlocks[0],
        block: this.bot.blockAt(grassBlocks[0])
      };
      
      logger.info(`Found tall grass to harvest at ${grassBlocks[0]}`);
    } catch (error) {
      logger.error('Error finding grass to harvest:', error);
    }
  }

  /**
   * Process a grass target - move to it and harvest for seeds
   */
  async processGrassTarget() {
    if (!this.farmingTarget || this.farmingTarget.type !== 'grass') return;
    
    try {
      const target = this.farmingTarget;
      const targetBlock = this.bot.blockAt(target.position);
      
      // Make sure target is still valid
      if (!targetBlock || (targetBlock.name !== 'tall_grass' && targetBlock.name !== 'fern')) {
        logger.debug('Grass target no longer valid');
        this.farmingTarget = null;
        return;
      }
      
      // If we're not close enough, move to the grass
      const distance = this.bot.entity.position.distanceTo(target.position);
      if (distance > 3) {
        await this.moveToTarget(target.position);
        return;
      }
      
      // We're close enough, harvest the grass
      logger.info(`Harvesting grass at ${target.position}`);
      
      try {
        // Equip appropriate tool if available (shears are best)
        const shears = this.bot.inventory.items().find(item => item.name === 'shears');
        if (shears) {
          await this.bot.equip(shears, 'hand');
        }
        
        // Break the grass
        await this.bot.dig(targetBlock);
        
        // Clear target
        this.farmingTarget = null;
        
        // Check if we got seeds
        const hasSeeds = this.bot.inventory.items().some(item => item.name === 'wheat_seeds');
        
        if (hasSeeds) {
          this.seedsNeeded = false;
          // Find farmland to plant on
          this.findEmptyFarmlandToPlant();
        } else {
          // Look for more grass
          this.lookForGrassToHarvest();
        }
      } catch (error) {
        logger.error('Error harvesting grass:', error);
        this.farmingTarget = null;
      }
    } catch (error) {
      logger.error('Error processing grass target:', error);
      this.farmingTarget = null;
    }
  }

  /**
   * Update the farming area based on surroundings
   */
  updateFarmingArea() {
    try {
      logger.debug('Updating farming area information');
      
      // Look for farmland in all directions to establish a farming area
      const farmlandId = this.bot.registry.blocksByName['farmland']?.id;
      if (!farmlandId) return;
      
      const farmlandBlocks = this.bot.findBlocks({
        matching: farmlandId,
        maxDistance: this.farmRadius,
        count: 64
      });
      
      if (farmlandBlocks.length === 0) {
        this.farmingArea = null;
        return;
      }
      
      // Calculate bounding box of farmland
      let minX = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxZ = -Infinity;
      
      for (const pos of farmlandBlocks) {
        minX = Math.min(minX, pos.x);
        minZ = Math.min(minZ, pos.z);
        maxX = Math.max(maxX, pos.x);
        maxZ = Math.max(maxZ, pos.z);
      }
      
      // Set farming area
      this.farmingArea = {
        min: new Vec3(minX, 0, minZ),
        max: new Vec3(maxX, 0, maxZ),
        center: new Vec3((minX + maxX) / 2, this.bot.entity.position.y, (minZ + maxZ) / 2),
        blocks: farmlandBlocks
      };
      
      logger.info(`Updated farming area: ${farmlandBlocks.length} farmland blocks`);
    } catch (error) {
      logger.error('Error updating farming area:', error);
    }
  }

  /**
   * Consider changing farming mode based on results
   */
  considerChangingFarmingMode() {
    // If we've been in one mode for a while with no results, switch modes
    if (this.farmingMode === 'crops') {
      logger.info('No crops found, switching to animal farming');
      this.farmingMode = 'animals';
      this.bot.chat('Switching to animal farming');
    } else {
      logger.info('No suitable animals found, switching to crop farming');
      this.farmingMode = 'crops';
      this.bot.chat('Switching to crop farming');
    }
    
    // Reset timers
    this.farmingStartTime = Date.now();
    this.harvestedCrops = 0;
    
    // Find new targets immediately
    this.findFarmingTargets();
  }

  /**
   * Determine if we should transition to another state
   */
  shouldTransition(nextState) {
    // Don't transition if we're actively farming and have targets
    if (this.farmingTarget && Date.now() - this.farmingStartTime < 5 * 60 * 1000) {
      return false;
    }
    
    switch (nextState) {
      case 'idle':
        // Transition to idle if we haven't found anything to farm for a while
        return !this.farmingTarget && Date.now() - this.lastSearchTime > 30000;
        
      case 'mining':
        // Don't interrupt farming for mining
        return false;
        
      case 'combat':
        // Always transition to combat if needed
        return this.botManager.combatBehavior && 
               this.botManager.combatBehavior.scanForThreats().length > 0;
        
      case 'gather':
        // Transition to gather if we need seeds but can't find grass
        return this.seedsNeeded && !this.farmingTarget;
        
      case 'craft':
        // Transition to craft if we need farming tools
        return !this.hasFarmingTools() && this.hasRawMaterials();
        
      case 'follow':
        // Always follow owner if requested
        return this.botManager.owner !== null;
        
      default:
        return false;
    }
  }
  
  /**
   * Check if bot has farming tools
   */
  hasFarmingTools() {
    const items = this.bot.inventory.items();
    const hasHoe = items.some(item => item.name.includes('_hoe'));
    return hasHoe;
  }
  
  /**
   * Check if bot has raw materials for crafting
   */
  hasRawMaterials() {
    const items = this.bot.inventory.items();
    const hasWood = items.some(item => item.name.includes('_planks') || item.name.includes('log'));
    const hasStone = items.some(item => item.name === 'cobblestone' || item.name === 'stone');
    const hasSticks = items.some(item => item.name === 'stick');
    
    return (hasWood || hasStone) && (hasSticks || hasWood);
  }
}

module.exports = FarmState;