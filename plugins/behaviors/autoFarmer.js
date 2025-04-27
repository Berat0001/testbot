/**
 * Auto Farmer Plugin
 * 
 * Automatically farms crops, plants seeds, and breeds animals.
 */

const BasePlugin = require('../basePlugin');
const Vec3 = require('vec3');

class AutoFarmerPlugin extends BasePlugin {
  constructor(bot, config, pluginManager) {
    super(bot, config, pluginManager);
    
    // Override base properties
    this.name = 'AutoFarmer';
    this.description = 'Automatically farms crops and breeds animals';
    this.version = '1.0.0';
    this.author = 'Replit';
    this.dependencies = []; // No dependencies
    
    // Plugin-specific properties
    this.farmingActive = false;
    this.farmingArea = {
      min: null,
      max: null
    };
    this.farmingInterval = null;
    this.checkInterval = 10000; // Check crops every 10 seconds
    
    // Crop definitions with growth stages
    this.crops = {
      wheat: { maxGrowth: 7, seedName: 'wheat_seeds' },
      carrots: { maxGrowth: 7, seedName: 'carrot' },
      potatoes: { maxGrowth: 7, seedName: 'potato' },
      beetroots: { maxGrowth: 3, seedName: 'beetroot_seeds' }
    };
    
    // Animal breeding
    this.breedingActive = false;
    this.breedableAnimals = {
      cow: { breedWith: 'wheat' },
      sheep: { breedWith: 'wheat' },
      pig: { breedWith: 'carrot' },
      chicken: { breedWith: 'wheat_seeds' }
    };
    this.lastBreedingTime = 0;
    this.breedingCooldown = 300000; // 5 minutes between breeding sessions
  }

  /**
   * Initialize the plugin
   */
  async initialize() {
    this.info('Initializing Auto Farmer plugin');
    
    // Load configuration
    this.loadConfig();
    
    // Start farming if auto-start is enabled
    if (this.config.autoStart) {
      this.startFarming();
    }
    
    // Register command handlers if available
    if (this.pluginManager.getPlugin('CommandHandler')) {
      this.registerCommands();
    }
    
    this.isEnabled = true;
    this.info('Auto Farmer plugin initialized');
    return true;
  }

  /**
   * Load configuration from the plugin config
   */
  loadConfig() {
    // Default config values
    const defaultConfig = {
      autoStart: false,
      farmArea: {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 0, y: 0, z: 0 }
      },
      checkInterval: 10000,
      breedAnimals: true,
      breedingCooldown: 300000
    };
    
    // Merge with provided config
    this.config = { ...defaultConfig, ...this.config };
    
    // Update properties from config
    this.checkInterval = this.config.checkInterval;
    this.breedingCooldown = this.config.breedingCooldown;
    
    // Parse farming area if defined
    if (this.config.farmArea && this.config.farmArea.min && this.config.farmArea.max) {
      this.farmingArea.min = new Vec3(
        this.config.farmArea.min.x,
        this.config.farmArea.min.y,
        this.config.farmArea.min.z
      );
      
      this.farmingArea.max = new Vec3(
        this.config.farmArea.max.x,
        this.config.farmArea.max.y,
        this.config.farmArea.max.z
      );
      
      this.info(`Farming area set to: ${this.farmingArea.min} to ${this.farmingArea.max}`);
    }
  }

  /**
   * Register command handlers
   */
  registerCommands() {
    const commandHandler = this.pluginManager.getPlugin('CommandHandler');
    if (!commandHandler) return;
    
    commandHandler.registerCommand('farm', {
      description: 'Manage automatic farming',
      usage: '!farm <start|stop|status|area>',
      handler: (username, args) => this.handleFarmCommand(username, args)
    });
    
    commandHandler.registerCommand('breed', {
      description: 'Manage animal breeding',
      usage: '!breed <start|stop|status>',
      handler: (username, args) => this.handleBreedCommand(username, args)
    });
  }

  /**
   * Handle the farm command
   */
  handleFarmCommand(username, args) {
    if (!args || args.length === 0) {
      return `Usage: !farm <start|stop|status|area>`;
    }
    
    const subCommand = args[0].toLowerCase();
    
    switch (subCommand) {
      case 'start':
        if (this.startFarming()) {
          return 'Started automatic farming';
        } else {
          return 'Failed to start farming. Do you have a farming area set?';
        }
        
      case 'stop':
        if (this.stopFarming()) {
          return 'Stopped automatic farming';
        } else {
          return 'Farming was not active';
        }
        
      case 'status':
        return this.getFarmingStatus();
        
      case 'area':
        if (args.length < 7) {
          return 'Usage: !farm area <minX> <minY> <minZ> <maxX> <maxY> <maxZ>';
        }
        
        try {
          const minX = parseInt(args[1]);
          const minY = parseInt(args[2]);
          const minZ = parseInt(args[3]);
          const maxX = parseInt(args[4]);
          const maxY = parseInt(args[5]);
          const maxZ = parseInt(args[6]);
          
          this.setFarmingArea(
            new Vec3(minX, minY, minZ),
            new Vec3(maxX, maxY, maxZ)
          );
          
          return `Farming area set from (${minX}, ${minY}, ${minZ}) to (${maxX}, ${maxY}, ${maxZ})`;
        } catch (error) {
          return `Error setting farm area: ${error.message}`;
        }
        
      default:
        return `Unknown subcommand: ${subCommand}. Use start, stop, status, or area.`;
    }
  }

  /**
   * Handle the breed command
   */
  handleBreedCommand(username, args) {
    if (!args || args.length === 0) {
      return `Usage: !breed <start|stop|status>`;
    }
    
    const subCommand = args[0].toLowerCase();
    
    switch (subCommand) {
      case 'start':
        if (this.startBreeding()) {
          return 'Started automatic animal breeding';
        } else {
          return 'Failed to start breeding';
        }
        
      case 'stop':
        if (this.stopBreeding()) {
          return 'Stopped automatic animal breeding';
        } else {
          return 'Breeding was not active';
        }
        
      case 'status':
        return this.getBreedingStatus();
        
      default:
        return `Unknown subcommand: ${subCommand}. Use start, stop, or status.`;
    }
  }

  /**
   * Start automatic farming
   */
  startFarming() {
    // Check if farming is already active
    if (this.farmingActive) {
      this.info('Farming is already active');
      return true;
    }
    
    // Check if farming area is defined
    if (!this.farmingArea.min || !this.farmingArea.max) {
      this.warn('Cannot start farming: no farming area defined');
      return false;
    }
    
    // Start farming interval
    this.farmingActive = true;
    this.farmingInterval = setInterval(() => this.checkFarmingArea(), this.checkInterval);
    
    this.info('Started automatic farming');
    return true;
  }

  /**
   * Stop automatic farming
   */
  stopFarming() {
    // Check if farming is active
    if (!this.farmingActive) {
      return false;
    }
    
    // Stop farming interval
    clearInterval(this.farmingInterval);
    this.farmingActive = false;
    
    this.info('Stopped automatic farming');
    return true;
  }

  /**
   * Set the farming area
   */
  setFarmingArea(min, max) {
    this.farmingArea.min = min;
    this.farmingArea.max = max;
    
    // Update config
    this.config.farmArea = {
      min: { x: min.x, y: min.y, z: min.z },
      max: { x: max.x, y: max.y, z: max.z }
    };
    
    this.info(`Set farming area: ${min} to ${max}`);
  }

  /**
   * Get farming status
   */
  getFarmingStatus() {
    const areaSet = this.farmingArea.min && this.farmingArea.max;
    const status = this.farmingActive ? 'active' : 'inactive';
    const areaStr = areaSet ? 
      `from (${this.farmingArea.min.x}, ${this.farmingArea.min.y}, ${this.farmingArea.min.z}) ` + 
      `to (${this.farmingArea.max.x}, ${this.farmingArea.max.y}, ${this.farmingArea.max.z})` : 
      'not set';
    
    return `Farming is ${status}. Farming area is ${areaStr}.`;
  }

  /**
   * Start automatic animal breeding
   */
  startBreeding() {
    if (this.breedingActive) {
      this.info('Breeding is already active');
      return true;
    }
    
    this.breedingActive = true;
    this.info('Started automatic animal breeding');
    return true;
  }

  /**
   * Stop automatic animal breeding
   */
  stopBreeding() {
    if (!this.breedingActive) {
      return false;
    }
    
    this.breedingActive = false;
    this.info('Stopped automatic animal breeding');
    return true;
  }

  /**
   * Get breeding status
   */
  getBreedingStatus() {
    const status = this.breedingActive ? 'active' : 'inactive';
    const lastBreeding = this.lastBreedingTime ? 
      `Last breeding session was ${Math.floor((Date.now() - this.lastBreedingTime) / 1000)} seconds ago.` : 
      'No breeding has occurred yet.';
    
    return `Animal breeding is ${status}. ${lastBreeding}`;
  }

  /**
   * Check the farming area for crops and farmland
   */
  async checkFarmingArea() {
    if (!this.farmingActive) return;
    
    this.debug('Checking farming area for crops');
    
    try {
      // Scan for mature crops and farmland
      const cropsToHarvest = [];
      const farmlandToPlant = [];
      
      // Get blocks in farm area
      for (let x = this.farmingArea.min.x; x <= this.farmingArea.max.x; x++) {
        for (let y = this.farmingArea.min.y; y <= this.farmingArea.max.y; y++) {
          for (let z = this.farmingArea.min.z; z <= this.farmingArea.max.z; z++) {
            const pos = new Vec3(x, y, z);
            const block = this.bot.blockAt(pos);
            
            if (!block) continue;
            
            // Check if it's a crop
            if (this.isCrop(block)) {
              const cropType = this.getCropType(block);
              if (cropType && this.isMature(block, cropType)) {
                cropsToHarvest.push(block);
              }
            }
            
            // Check if it's empty farmland
            else if (block.name === 'farmland') {
              const blockAbove = this.bot.blockAt(pos.offset(0, 1, 0));
              if (blockAbove && blockAbove.name === 'air') {
                farmlandToPlant.push(block);
              }
            }
          }
        }
      }
      
      // Harvest mature crops
      if (cropsToHarvest.length > 0) {
        this.info(`Found ${cropsToHarvest.length} mature crops to harvest`);
        await this.harvestCrops(cropsToHarvest);
      }
      
      // Plant seeds on empty farmland
      if (farmlandToPlant.length > 0) {
        this.info(`Found ${farmlandToPlant.length} empty farmland plots`);
        await this.plantSeeds(farmlandToPlant);
      }
      
      // Check for animals to breed
      if (this.breedingActive && Date.now() - this.lastBreedingTime > this.breedingCooldown) {
        await this.breedAnimals();
      }
      
    } catch (error) {
      this.error('Error checking farming area:', error);
    }
  }

  /**
   * Check if a block is a crop
   */
  isCrop(block) {
    return block.name === 'wheat' || 
           block.name === 'carrots' || 
           block.name === 'potatoes' || 
           block.name === 'beetroots';
  }

  /**
   * Get the crop type from a block
   */
  getCropType(block) {
    return this.crops[block.name];
  }

  /**
   * Check if a crop is mature
   */
  isMature(block, cropType) {
    return block.metadata >= cropType.maxGrowth;
  }

  /**
   * Harvest mature crops
   */
  async harvestCrops(crops) {
    // Sort crops by distance to bot
    crops.sort((a, b) => {
      const distA = this.bot.entity.position.distanceTo(a.position);
      const distB = this.bot.entity.position.distanceTo(b.position);
      return distA - distB;
    });
    
    // Harvest each crop
    for (const crop of crops) {
      try {
        // Move to the crop
        await this.moveToBlock(crop);
        
        // Harvest the crop
        await this.bot.dig(crop);
        
        this.debug(`Harvested ${crop.name} at ${crop.position}`);
      } catch (error) {
        this.warn(`Error harvesting crop at ${crop.position}:`, error);
      }
    }
  }

  /**
   * Plant seeds on empty farmland
   */
  async plantSeeds(farmland) {
    // Check if we have seeds
    let seedItems = this.getSeedItems();
    if (seedItems.length === 0) {
      this.debug('No seeds in inventory to plant');
      return;
    }
    
    // Sort farmland by distance to bot
    farmland.sort((a, b) => {
      const distA = this.bot.entity.position.distanceTo(a.position);
      const distB = this.bot.entity.position.distanceTo(b.position);
      return distA - distB;
    });
    
    // Plant seeds on each farmland block
    for (const land of farmland) {
      try {
        // Update available seeds (might have used them all)
        seedItems = this.getSeedItems();
        if (seedItems.length === 0) {
          this.debug('Used all seeds, stopping planting');
          break;
        }
        
        // Select a seed type (prefer wheat seeds)
        const seedItem = seedItems.find(item => item.name === 'wheat_seeds') || seedItems[0];
        
        // Move to the farmland
        await this.moveToBlock(land);
        
        // Equip the seeds
        await this.bot.equip(seedItem, 'hand');
        
        // Plant the seeds (place on top of farmland)
        const plantPosition = land.position.offset(0, 1, 0);
        await this.bot.placeBlock(land, new Vec3(0, 1, 0));
        
        this.debug(`Planted ${seedItem.name} at ${plantPosition}`);
      } catch (error) {
        this.warn(`Error planting seeds at ${land.position}:`, error);
      }
    }
  }

  /**
   * Get all seed items from inventory
   */
  getSeedItems() {
    return this.bot.inventory.items().filter(item => 
      item.name === 'wheat_seeds' || 
      item.name === 'carrot' || 
      item.name === 'potato' || 
      item.name === 'beetroot_seeds'
    );
  }

  /**
   * Breed nearby animals
   */
  async breedAnimals() {
    if (!this.breedingActive) return;
    
    this.info('Checking for animals to breed');
    
    // Find nearby animals
    const animals = Object.values(this.bot.entities).filter(entity => 
      entity.type === 'mob' && 
      this.breedableAnimals[entity.name] && 
      entity.position.distanceTo(this.bot.entity.position) < 16
    );
    
    if (animals.length < 2) {
      this.debug('Not enough animals to breed');
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
    
    // Try to breed each type of animal
    for (const [animalType, animalList] of Object.entries(animalsByType)) {
      if (animalList.length < 2) continue;
      
      const breedInfo = this.breedableAnimals[animalType];
      const breedItems = this.bot.inventory.items().filter(item => 
        item.name === breedInfo.breedWith
      );
      
      if (breedItems.length < 2) {
        this.debug(`Not enough ${breedInfo.breedWith} to breed ${animalType}`);
        continue;
      }
      
      // Get two animals
      const animal1 = animalList[0];
      const animal2 = animalList[1];
      
      try {
        // Equip breeding item
        await this.bot.equip(breedItems[0], 'hand');
        
        // Move to and feed first animal
        await this.moveToEntity(animal1);
        await this.bot.useOn(animal1);
        
        // Feed second animal
        await this.moveToEntity(animal2);
        await this.bot.useOn(animal2);
        
        this.info(`Successfully bred ${animalType}`);
      } catch (error) {
        this.warn(`Error breeding ${animalType}:`, error);
      }
    }
    
    // Update last breeding time
    this.lastBreedingTime = Date.now();
  }

  /**
   * Move to a block
   */
  async moveToBlock(block) {
    if (!this.bot.pathfinder) {
      throw new Error('Pathfinder plugin not available');
    }
    
    const pathfinder = require('mineflayer-pathfinder');
    const { goals } = pathfinder;
    
    return new Promise((resolve, reject) => {
      try {
        // Create a goal to move near the block
        const goal = new goals.GoalGetToBlock(
          block.position.x,
          block.position.y,
          block.position.z
        );
        
        // Start path finding
        this.bot.pathfinder.setGoal(goal);
        
        // Handle reaching the goal
        const onGoalReached = () => {
          this.bot.removeListener('goal_reached', onGoalReached);
          this.bot.removeListener('path_update', onPathUpdate);
          resolve();
        };
        
        // Handle path updates
        const onPathUpdate = (results) => {
          if (results.status === 'noPath') {
            this.bot.removeListener('goal_reached', onGoalReached);
            this.bot.removeListener('path_update', onPathUpdate);
            reject(new Error('Could not find path to block'));
          }
        };
        
        // Register event listeners
        this.bot.once('goal_reached', onGoalReached);
        this.bot.on('path_update', onPathUpdate);
        
        // Add a timeout
        setTimeout(() => {
          this.bot.removeListener('goal_reached', onGoalReached);
          this.bot.removeListener('path_update', onPathUpdate);
          this.bot.pathfinder.setGoal(null);
          reject(new Error('Timeout while moving to block'));
        }, 10000); // 10 second timeout
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Move to an entity
   */
  async moveToEntity(entity) {
    if (!this.bot.pathfinder) {
      throw new Error('Pathfinder plugin not available');
    }
    
    const pathfinder = require('mineflayer-pathfinder');
    const { goals } = pathfinder;
    
    return new Promise((resolve, reject) => {
      try {
        // Create a goal to move near the entity
        const goal = new goals.GoalNear(
          entity.position.x,
          entity.position.y,
          entity.position.z,
          2 // Get within 2 blocks
        );
        
        // Start path finding
        this.bot.pathfinder.setGoal(goal);
        
        // Handle reaching the goal
        const onGoalReached = () => {
          this.bot.removeListener('goal_reached', onGoalReached);
          this.bot.removeListener('path_update', onPathUpdate);
          resolve();
        };
        
        // Handle path updates
        const onPathUpdate = (results) => {
          if (results.status === 'noPath') {
            this.bot.removeListener('goal_reached', onGoalReached);
            this.bot.removeListener('path_update', onPathUpdate);
            reject(new Error('Could not find path to entity'));
          }
        };
        
        // Register event listeners
        this.bot.once('goal_reached', onGoalReached);
        this.bot.on('path_update', onPathUpdate);
        
        // Add a timeout
        setTimeout(() => {
          this.bot.removeListener('goal_reached', onGoalReached);
          this.bot.removeListener('path_update', onPathUpdate);
          this.bot.pathfinder.setGoal(null);
          reject(new Error('Timeout while moving to entity'));
        }, 10000); // 10 second timeout
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Shutdown the plugin
   */
  async shutdown() {
    this.info('Shutting down Auto Farmer plugin');
    
    // Stop farming
    this.stopFarming();
    
    // Stop breeding
    this.breedingActive = false;
    
    // Unregister all events
    this.unregisterAllEvents();
    
    this.isEnabled = false;
    this.info('Auto Farmer plugin shut down');
    return true;
  }
}

module.exports = AutoFarmerPlugin;