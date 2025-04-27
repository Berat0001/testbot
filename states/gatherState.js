/**
 * Gather State for Minecraft Bot
 * 
 * In this state, the bot will gather resources like wood, food, and
 * other items needed for survival and crafting.
 */

// Import our custom StateBehavior base class
const StateBehavior = require('../bot/stateBehavior');
const Vec3 = require('vec3');
const logger = require('../bot/logger');

class GatherState extends StateBehavior {
  constructor(bot, botManager) {
    super(bot, 'gather');
    this.botManager = botManager;
    
    this.timeInState = 0;
    this.currentTask = null;
    this.targetItems = [];
    this.itemsCollected = {};
    this.gatherStartTime = 0;
    this.lastProgressUpdate = 0;
    this.gatheringComplete = false;
    
    // Track resources and their target amounts
    this.resourceTargets = {
      wood: 0,
      food: 0,
      seeds: 0,
      leather: 0,
      wool: 0
    };
  }

  onStateEntered() {
    this.timeInState = 0;
    this.targetItems = [];
    this.itemsCollected = {};
    this.gatherStartTime = Date.now();
    this.lastProgressUpdate = 0;
    this.gatheringComplete = false;
    
    logger.info('Entered gather state');
    this.bot.chat('Starting resource gathering.');
    
    // Determine what to gather based on needs
    this.determineGatheringNeeds();
  }

  onStateExited() {
    logger.info('Exited gather state');
    this.reportGatheringResults();
    
    // Clean up gathering state
    this.targetItems = [];
    this.currentTask = null;
    
    // Stop any pathfinding
    if (this.bot.pathfinder && this.bot.pathfinder.isMoving()) {
      this.bot.pathfinder.setGoal(null);
    }
  }

  /**
   * Determine what resources we need to gather
   */
  determineGatheringNeeds() {
    logger.info('Determining gathering needs');
    const inventory = this.bot.inventory.items();
    
    // Check wood supply
    const woodItems = inventory.filter(item => 
      item.name.includes('_log') || item.name.includes('_wood') || item.name === 'stick'
    );
    const woodCount = woodItems.reduce((sum, item) => sum + item.count, 0);
    
    if (woodCount < 10) {
      this.resourceTargets.wood = Math.max(16 - woodCount, 0);
      logger.info(`Need to gather ${this.resourceTargets.wood} wood`);
    }
    
    // Check food supply
    const foodItems = inventory.filter(item => {
      // Common food items
      const foodTypes = [
        'apple', 'bread', 'cooked_beef', 'cooked_chicken', 'cooked_mutton',
        'cooked_porkchop', 'baked_potato', 'carrot', 'beetroot',
        'cooked_rabbit', 'cooked_cod', 'cooked_salmon'
      ];
      return foodTypes.some(food => item.name.includes(food));
    });
    
    const foodCount = foodItems.reduce((sum, item) => sum + item.count, 0);
    
    if (foodCount < 5) {
      this.resourceTargets.food = Math.max(10 - foodCount, 0);
      logger.info(`Need to gather ${this.resourceTargets.food} food items`);
    }
    
    // Start with the most critical resource
    this.planGatheringTasks();
  }

  /**
   * Plan gathering tasks based on resource needs
   */
  planGatheringTasks() {
    // Prioritize food if hunger is low
    if (this.bot.food < 10 && this.resourceTargets.food > 0) {
      this.startFoodGathering();
      return;
    }
    
    // Otherwise, prioritize wood as it's needed for tools
    if (this.resourceTargets.wood > 0) {
      this.startWoodGathering();
      return;
    }
    
    // If we need food but aren't starving, gather it next
    if (this.resourceTargets.food > 0) {
      this.startFoodGathering();
      return;
    }
    
    // If no specific needs, look for any valuable items nearby
    this.lookForValuableItems();
  }

  /**
   * Start gathering trees for wood
   */
  startWoodGathering() {
    this.currentTask = 'wood';
    this.bot.chat('Looking for trees to gather wood.');
    
    // Find nearby tree blocks (logs)
    const woodTypes = [
      'oak_log', 'spruce_log', 'birch_log', 'jungle_log', 
      'acacia_log', 'dark_oak_log', 'mangrove_log'
    ];
    
    this.findBlocksToGather(woodTypes);
  }

  /**
   * Start gathering food (animals, crops)
   */
  startFoodGathering() {
    this.currentTask = 'food';
    this.bot.chat('Looking for food sources.');
    
    // First check for passive mobs (animals) for meat
    const animals = this.findNearbyAnimals();
    
    if (animals.length > 0) {
      this.bot.chat(`Found ${animals.length} animals to hunt for food.`);
      // Chase closest animal
      this.targetItems = animals.map(animal => animal.entity);
      return;
    }
    
    // If no animals, look for crops
    const cropTypes = [
      'wheat', 'carrots', 'potatoes', 'beetroots',
      'sweet_berry_bush', 'melon', 'pumpkin'
    ];
    
    this.findBlocksToGather(cropTypes);
    
    // If no crops either, look for apple-dropping trees
    if (this.targetItems.length === 0) {
      this.bot.chat('Looking for oak trees for apples.');
      this.findBlocksToGather(['oak_leaves']);
    }
  }

  /**
   * Find blocks matching the given types to gather
   */
  findBlocksToGather(blockTypes) {
    let blocksFound = [];
    
    try {
      // Try to find each type of block
      for (const blockType of blockTypes) {
        const blockId = this.bot.registry.blocksByName[blockType]?.id;
        
        if (blockId) {
          const blocks = this.bot.findBlocks({
            matching: blockId,
            maxDistance: 32,
            count: 10
          });
          
          blocksFound = blocksFound.concat(
            blocks.map(pos => this.bot.blockAt(pos))
                 .filter(block => block !== null)
          );
        }
      }
      
      if (blocksFound.length > 0) {
        // Sort by distance
        blocksFound.sort((a, b) => 
          this.bot.entity.position.distanceTo(a.position) - 
          this.bot.entity.position.distanceTo(b.position)
        );
        
        this.targetItems = blocksFound;
        this.bot.chat(`Found ${blocksFound.length} blocks to gather.`);
      } else {
        this.bot.chat(`Couldn't find any ${blockTypes.join(' or ')} nearby.`);
        // Look for any other valuable items since we couldn't find specific ones
        this.lookForValuableItems();
      }
    } catch (error) {
      logger.error(`Error finding blocks to gather:`, error);
      this.bot.chat(`Error finding resources: ${error.message}`);
    }
  }

  /**
   * Find nearby animals for food
   */
  findNearbyAnimals() {
    const edibleAnimals = [];
    const entities = this.bot.entities;
    
    for (const entity of Object.values(entities)) {
      if (entity.type !== 'mob') continue;
      
      // Define animal types good for food
      const edibleTypes = [
        'cow', 'pig', 'chicken', 'sheep', 'rabbit'
      ];
      
      if (edibleTypes.includes(entity.name)) {
        const distance = entity.position.distanceTo(this.bot.entity.position);
        if (distance < 32) { // Only consider animals within range
          edibleAnimals.push({
            entity: entity,
            name: entity.name,
            distance: distance
          });
        }
      }
    }
    
    // Sort by distance
    edibleAnimals.sort((a, b) => a.distance - b.distance);
    
    return edibleAnimals;
  }

  /**
   * Look for any valuable dropped items or containers
   */
  lookForValuableItems() {
    this.currentTask = 'scavenging';
    this.bot.chat('Looking for valuable items nearby.');
    
    // Look for dropped items
    const items = Object.values(this.bot.entities).filter(
      entity => entity.type === 'object' && 
      entity.objectType === 'Item' && 
      entity.position.distanceTo(this.bot.entity.position) < 32
    );
    
    if (items.length > 0) {
      this.bot.chat(`Found ${items.length} dropped items to collect.`);
      this.targetItems = items;
      return;
    }
    
    // Look for containers (chests)
    const chestId = this.bot.registry.blocksByName['chest']?.id;
    if (chestId) {
      const chestPositions = this.bot.findBlocks({
        matching: chestId,
        maxDistance: 32,
        count: 5
      });
      
      if (chestPositions.length > 0) {
        const chests = chestPositions.map(pos => this.bot.blockAt(pos))
                                    .filter(block => block !== null);
        
        this.bot.chat(`Found ${chests.length} chests to check.`);
        this.targetItems = chests;
        return;
      }
    }
    
    // If nothing found, gathering is complete
    this.bot.chat('No specific resources needed and no valuable items nearby.');
    this.gatheringComplete = true;
  }

  /**
   * Main update function for the gather state
   */
  update() {
    this.timeInState += 1;
    
    // Check for safety periodically
    this.checkSafetyConditions();
    
    // Provide progress updates
    const now = Date.now();
    if (now - this.lastProgressUpdate > 20000) { // Every 20 seconds
      this.lastProgressUpdate = now;
      this.updateGatheringProgress();
    }
    
    // If gathering is complete, transition away
    if (this.gatheringComplete) {
      return;
    }
    
    // Handle current task
    if (this.currentTask === 'wood') {
      this.updateWoodGathering();
    } else if (this.currentTask === 'food') {
      this.updateFoodGathering();
    } else if (this.currentTask === 'scavenging') {
      this.updateScavenging();
    } else {
      // If no current task, plan new tasks
      this.planGatheringTasks();
    }
  }

  /**
   * Update wood gathering progress
   */
  updateWoodGathering() {
    if (this.targetItems.length === 0) {
      // No more wood targets, check if we've met our goal
      const woodItems = this.bot.inventory.items().filter(item => 
        item.name.includes('_log') || item.name.includes('_wood')
      );
      const woodCount = woodItems.reduce((sum, item) => sum + item.count, 0);
      
      if (woodCount >= this.resourceTargets.wood) {
        logger.info(`Gathered sufficient wood: ${woodCount} items`);
        this.bot.chat('Collected enough wood.');
        
        // Check other gathering needs
        this.resourceTargets.wood = 0;
        this.currentTask = null;
        this.planGatheringTasks();
      } else {
        // Try to find more trees
        logger.info(`Need more wood, searching again`);
        this.startWoodGathering();
      }
    } else {
      this.processNextGatherTarget();
    }
  }

  /**
   * Update food gathering progress
   */
  updateFoodGathering() {
    if (this.targetItems.length === 0) {
      // No more food targets, check if we've met our goal
      // Check food supply
      const foodItems = this.bot.inventory.items().filter(item => {
        // Common food items
        const foodTypes = [
          'apple', 'bread', 'cooked_beef', 'cooked_chicken', 'cooked_mutton',
          'cooked_porkchop', 'baked_potato', 'carrot', 'beetroot',
          'cooked_rabbit', 'cooked_cod', 'cooked_salmon', 'raw_beef',
          'raw_chicken', 'raw_mutton', 'raw_porkchop', 'raw_rabbit'
        ];
        return foodTypes.some(food => item.name.includes(food));
      });
      
      const foodCount = foodItems.reduce((sum, item) => sum + item.count, 0);
      
      if (foodCount >= this.resourceTargets.food) {
        logger.info(`Gathered sufficient food: ${foodCount} items`);
        this.bot.chat('Collected enough food.');
        
        // Check other gathering needs
        this.resourceTargets.food = 0;
        this.currentTask = null;
        this.planGatheringTasks();
      } else {
        // Try to find more food
        logger.info(`Need more food, searching again`);
        this.startFoodGathering();
      }
    } else {
      this.processNextGatherTarget();
    }
  }

  /**
   * Update scavenging progress
   */
  updateScavenging() {
    if (this.targetItems.length === 0) {
      // No more items to scavenge, try something else
      logger.info('Scavenging complete, checking for other needs');
      this.currentTask = null;
      this.planGatheringTasks();
      
      // If no other tasks were found, we're done
      if (!this.currentTask) {
        this.gatheringComplete = true;
      }
    } else {
      this.processNextGatherTarget();
    }
  }

  /**
   * Process the next target in the gathering queue
   */
  processNextGatherTarget() {
    // Skip if no targets
    if (this.targetItems.length === 0) return;
    
    const target = this.targetItems[0];
    const isEntity = !target.position?.isVector;
    
    try {
      if (isEntity) {
        // Target is an entity (mob or dropped item)
        this.processEntityTarget(target);
      } else {
        // Target is a block
        this.processBlockTarget(target);
      }
    } catch (error) {
      logger.warn(`Error processing gather target:`, error);
      // Skip problematic target
      this.targetItems.shift();
    }
  }

  /**
   * Process an entity target (animal or item)
   */
  async processEntityTarget(entity) {
    // Check if entity is still valid
    if (!entity.isValid) {
      this.targetItems.shift();
      return;
    }
    
    const distance = this.bot.entity.position.distanceTo(entity.position);
    
    // If it's a dropped item and we're close enough, collect it
    if (entity.objectType === 'Item') {
      // Just need to get close enough and it will be picked up automatically
      if (distance < 2) {
        // Wait a bit to ensure it's picked up
        await new Promise(resolve => setTimeout(resolve, 250));
        // Remove from targets
        this.targetItems.shift();
        this.recordItemCollected(entity.displayName);
      } else {
        // Move to the item
        this.moveToTarget(entity.position);
      }
    } 
    // If it's an animal, hunt it
    else if (entity.type === 'mob') {
      if (distance <= 2) {
        // We're close enough to attack
        if (this.bot.entity.heldItem?.name.includes('sword')) {
          await this.bot.attack(entity);
        } else {
          // Equip a weapon if available
          const weapon = this.bot.inventory.items().find(item => 
            item.name.includes('sword') || item.name.includes('axe')
          );
          
          if (weapon) {
            await this.bot.equip(weapon, 'hand');
            await this.bot.attack(entity);
          } else {
            // Attack with whatever we have
            await this.bot.attack(entity);
          }
        }
        
        // If the animal died, remove it from targets
        if (!entity.isValid || entity.health <= 0) {
          this.targetItems.shift();
          this.recordItemCollected(entity.name + '_meat');
        }
      } else {
        // Move toward the animal
        this.moveToTarget(entity.position);
      }
    }
  }

  /**
   * Process a block target (tree, crop, etc.)
   */
  async processBlockTarget(block) {
    // Check if block still exists
    const currentBlock = this.bot.blockAt(block.position);
    if (!currentBlock || currentBlock.type !== block.type) {
      this.targetItems.shift();
      return;
    }
    
    const distance = this.bot.entity.position.distanceTo(block.position);
    
    if (distance <= 5) {
      // We're close enough to mine/interact
      try {
        // If it's a crop, only harvest if mature
        if (block.name.includes('wheat') || 
            block.name.includes('carrots') || 
            block.name.includes('potatoes') || 
            block.name.includes('beetroot')) {
          
          // Check crop age (metadata)
          const metadata = block.metadata;
          const maxAge = block.name.includes('beetroot') ? 3 : 7;
          
          if (metadata < maxAge) {
            // Not fully grown, skip
            this.targetItems.shift();
            return;
          }
        }
        
        // Break the block
        await this.bot.dig(block);
        
        // Record what we collected
        if (block.name.includes('_log')) {
          this.recordItemCollected('wood');
        } else if (block.name.includes('wheat')) {
          this.recordItemCollected('wheat');
          this.recordItemCollected('seeds');
        } else if (block.name.includes('carrots')) {
          this.recordItemCollected('carrot');
        } else if (block.name.includes('potatoes')) {
          this.recordItemCollected('potato');
        } else if (block.name.includes('beetroot')) {
          this.recordItemCollected('beetroot');
          this.recordItemCollected('seeds');
        } else if (block.name.includes('leaves')) {
          // Small chance of apple
          if (Math.random() < 0.05) {
            this.recordItemCollected('apple');
          }
        }
        
        this.targetItems.shift();
      } catch (error) {
        logger.warn(`Error breaking block:`, error);
        this.targetItems.shift();
      }
    } else {
      // Move closer to the block
      this.moveToTarget(block.position);
    }
  }

  /**
   * Move toward a target position
   */
  moveToTarget(position) {
    // Use pathfinder if available
    if (this.bot.pathfinder && !this.bot.pathfinder.isMoving()) {
      const pathfinder = require('mineflayer-pathfinder');
      const { goals } = pathfinder;
      
      this.bot.pathfinder.setGoal(new goals.GoalNear(
        position.x, position.y, position.z, 2
      ));
    } else {
      // Simple movement
      this.bot.lookAt(position);
      this.bot.setControlState('forward', true);
      
      // Jump occasionally to handle terrain
      if (this.bot.entity.onGround && Math.random() < 0.1) {
        this.bot.setControlState('jump', true);
        setTimeout(() => {
          this.bot.setControlState('jump', false);
        }, 250);
      }
    }
  }

  /**
   * Record an item we collected
   */
  recordItemCollected(itemName) {
    if (!this.itemsCollected[itemName]) {
      this.itemsCollected[itemName] = 0;
    }
    this.itemsCollected[itemName]++;
    
    if (itemName === 'wood' || itemName.includes('_log')) {
      logger.info(`Collected wood: now have ${this.itemsCollected[itemName]} logs`);
    }
    else if (itemName === 'apple' || itemName === 'carrot' || itemName === 'potato' ||
            itemName === 'beetroot' || itemName.includes('meat')) {
      logger.info(`Collected food item: ${itemName}`);
    }
  }

  /**
   * Check safety conditions during gathering
   */
  checkSafetyConditions() {
    // Check for health issues
    if (this.bot.health < 10) {
      logger.warn('Health low during gathering, consider fleeing or healing');
    }
    
    // Check for hunger
    if (this.bot.food < 6 && this.currentTask !== 'food') {
      logger.warn('Hunger critical, prioritizing food gathering');
      this.currentTask = null;
      this.startFoodGathering();
    }
    
    // Check for nearby threats
    const hostileMobs = this.findNearbyHostileMobs();
    if (hostileMobs.length > 0 && hostileMobs[0].distance < 8) {
      logger.warn(`Hostile mob detected during gathering: ${hostileMobs[0].name} at ${hostileMobs[0].distance}`);
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
   * Update gathering progress information
   */
  updateGatheringProgress() {
    // Calculate how long we've been gathering
    const gatheringTime = (Date.now() - this.gatherStartTime) / 1000; // in seconds
    
    // Summarize what we've gathered so far
    const itemsCollected = Object.entries(this.itemsCollected)
      .map(([item, count]) => `${count} ${item}`)
      .join(', ');
    
    logger.info(`Gathering progress after ${gatheringTime.toFixed(0)} seconds: ${itemsCollected || 'nothing yet'}`);
    
    if (this.currentTask) {
      this.bot.chat(`Still gathering ${this.currentTask}. Found ${this.targetItems.length} potential targets.`);
    }
  }

  /**
   * Report gathering results when exiting the state
   */
  reportGatheringResults() {
    // Calculate how long we spent gathering
    const gatheringTime = (Date.now() - this.gatherStartTime) / 1000; // in seconds
    
    // Summarize what we gathered
    const itemsSummary = Object.entries(this.itemsCollected)
      .map(([item, count]) => `${count} ${item}`)
      .join(', ');
    
    if (itemsSummary) {
      logger.info(`Gathering complete. Collected: ${itemsSummary} in ${gatheringTime.toFixed(0)} seconds`);
      this.bot.chat(`Gathering complete. Collected: ${itemsSummary}`);
    } else {
      logger.info(`Gathering complete. Nothing collected in ${gatheringTime.toFixed(0)} seconds`);
      this.bot.chat('Gathering complete. Found nothing useful.');
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
      case 'mine':
        return this.shouldTransitionToMining();
      case 'craft':
        return this.shouldTransitionToCraft();
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
    // Transition to idle if gathering is complete
    if (this.gatheringComplete) {
      return true;
    }
    
    // Also consider idle if we've been gathering for too long (5 minutes)
    const gatheringTime = (Date.now() - this.gatherStartTime) / 1000;
    return gatheringTime > 300;
  }

  /**
   * Check if we should transition to mining state
   */
  shouldTransitionToMining() {
    // Check if inventory is getting full (80%+)
    const slots = this.bot.inventory.slots;
    let usedSlots = 0;
    let totalSlots = 36; // Main inventory + hotbar
    
    for (let i = 9; i < 45; i++) { // Skip armor slots
      if (slots[i]) usedSlots++;
    }
    
    const inventoryFullness = usedSlots / totalSlots;
    
    // If we completed basic gathering and inventory isn't too full, 
    // consider mining for more valuable resources
    return this.gatheringComplete && inventoryFullness < 0.8;
  }

  /**
   * Check if we should transition to craft state
   */
  shouldTransitionToCraft() {
    // Check if we've gathered enough wood to craft useful items
    const woodItems = this.bot.inventory.items().filter(item => 
      item.name.includes('_log') || item.name.includes('_wood')
    );
    const woodCount = woodItems.reduce((sum, item) => sum + item.count, 0);
    
    return woodCount >= 8; // Enough for a crafting table and some tools
  }

  /**
   * Check if we should transition to follow state
   */
  shouldTransitionToFollow() {
    // If owner issues a command to follow, this would return true
    // For now, just check if the owner is nearby and we're done gathering
    if (!this.botManager.owner) return false;
    
    const owner = this.bot.players[this.botManager.owner];
    if (!owner || !owner.entity) return false;
    
    const distanceToOwner = owner.entity.position.distanceTo(this.bot.entity.position);
    
    return this.gatheringComplete && distanceToOwner < 20;
  }
}

module.exports = GatherState;