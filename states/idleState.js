/**
 * Idle State for Minecraft Bot
 * 
 * The default state when the bot isn't actively performing a task.
 * In this state, the bot will:
 * - Wait for commands
 * - Perform minimal autonomous actions (looking around, avoiding dangers)
 * - Maintain basic survival needs
 */

// Import our custom StateBehavior base class
const StateBehavior = require('../bot/stateBehavior');
const Vec3 = require('vec3');
const logger = require('../bot/logger');

class IdleState extends StateBehavior {
  constructor(bot, botManager) {
    super(bot, 'idle');
    this.botManager = botManager;
    this.activeSince = null;
    this.lastLookTime = 0;
    this.lastEatCheckTime = 0;
    this.lastInventoryCheckTime = 0;
    this.lastEnvironmentScanTime = 0;
    this.stuckCount = 0;
    this.idlePosition = null;
  }

  onStateEntered() {
    this.activeSince = Date.now();
    this.idlePosition = this.bot.entity.position.clone();
    this.stuckCount = 0;
    logger.info('Entered idle state');
    this.bot.clearControlStates();
    
    // Stop any ongoing activities
    if (this.bot.pathfinder.isMoving()) {
      this.bot.pathfinder.setGoal(null);
    }
    
    // Check for immediate survival needs
    this.checkSurvivalNeeds();
  }

  onStateExited() {
    logger.info('Exited idle state');
    this.idlePosition = null;
    this.activeSince = null;
  }

  /**
   * Main update function for the idle state
   */
  update() {
    const now = Date.now();
    
    // Periodically look around while idle
    if (now - this.lastLookTime > 5000) {
      this.lookAround();
      this.lastLookTime = now;
    }
    
    // Check survival needs periodically
    if (now - this.lastEatCheckTime > 30000) {
      this.checkSurvivalNeeds();
      this.lastEatCheckTime = now;
    }
    
    // Check inventory periodically for reorganization
    if (now - this.lastInventoryCheckTime > 120000) {
      this.checkInventory();
      this.lastInventoryCheckTime = now;
    }
    
    // Periodically scan environment for threats/opportunities
    if (now - this.lastEnvironmentScanTime > 10000) {
      this.scanEnvironment();
      this.lastEnvironmentScanTime = now;
    }
    
    // Check if we're stuck in idle too long and should do something
    this.checkLongIdleAction();
    
    // Check for threats that might require action
    this.checkForThreats();
  }

  /**
   * Look around randomly while idle to appear more natural and scan surroundings
   */
  lookAround() {
    try {
      // Get a random direction to look
      const yaw = Math.random() * Math.PI * 2; // Random horizontal angle
      const pitch = (Math.random() - 0.5) * Math.PI / 2; // Random vertical angle between -45 and 45 degrees
      
      // Look in that direction
      this.bot.look(yaw, pitch, false);
    } catch (error) {
      logger.warn('Error in idle lookAround:', error);
    }
  }

  /**
   * Check and satisfy basic survival needs
   */
  async checkSurvivalNeeds() {
    try {
      // Check if we need to eat
      if (this.bot.food <= this.botManager.config.autoEat.startAt) {
        logger.info('Hunger detected in idle state, attempting to eat');
        if (this.botManager.survivalBehavior) {
          await this.botManager.survivalBehavior.eat();
        }
      }
      
      // Check if it's night time and dangerous to be outside
      if (this.isNightTimeAndUnsafe()) {
        logger.info('Night time detected, seeking shelter');
        if (this.botManager.survivalBehavior) {
          await this.botManager.survivalBehavior.findShelter();
        }
      }
      
      // Check if it's raining and we should find shelter
      if (this.isRainingAndUnsheltered()) {
        logger.info('Rain detected, seeking shelter');
        if (this.botManager.survivalBehavior) {
          await this.botManager.survivalBehavior.findShelter();
        }
      }
    } catch (error) {
      logger.warn('Error checking survival needs:', error);
    }
  }

  /**
   * Check inventory and manage it if needed
   */
  async checkInventory() {
    try {
      // Skip if inventory manager isn't available
      if (!this.botManager.inventoryManager) return;
      
      const inventoryFullness = this.getInventoryFullness();
      
      // If inventory is getting full, organize it
      if (inventoryFullness > 0.7) {
        logger.info('Inventory getting full, organizing');
        await this.botManager.inventoryManager.organizeInventory();
      }
    } catch (error) {
      logger.warn('Error checking inventory:', error);
    }
  }

  /**
   * Get a measure of how full the inventory is (0-1)
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
   * Scan environment for threats, resources, or points of interest
   */
  scanEnvironment() {
    try {
      // Check for hostile mobs nearby
      const hostileMobs = this.findNearbyHostileMobs();
      
      if (hostileMobs.length > 0) {
        const closest = hostileMobs[0];
        logger.debug(`Idle state detected ${closest.name} at distance ${closest.distance}`);
        
        // If the mob is very close, prepare for potential combat
        if (closest.distance < 10 && this.botManager.config.combat.enabled) {
          // Just make note of it for now - the threat check will handle actual combat
          logger.info(`Potential threat from ${closest.name} at distance ${closest.distance}`);
        }
      }
      
      // Check for important resources nearby (ores, etc.) but don't take action yet
      this.scanForResources();
    } catch (error) {
      logger.warn('Error scanning environment:', error);
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
   * Scan for valuable resources nearby
   */
  scanForResources() {
    try {
      // Skip if no mining behavior
      if (!this.botManager.miningBehavior) return;
      
      // List of valuable blocks to scan for
      const valuableBlocks = [
        'diamond_ore', 'deepslate_diamond_ore',
        'iron_ore', 'deepslate_iron_ore',
        'gold_ore', 'deepslate_gold_ore',
        'emerald_ore', 'deepslate_emerald_ore',
        'ancient_debris'
      ];
      
      // Scan for each type
      for (const blockType of valuableBlocks) {
        try {
          const blockId = this.bot.registry.blocksByName[blockType]?.id;
          if (!blockId) continue;
          
          const blocks = this.bot.findBlocks({
            matching: blockId,
            maxDistance: 20,
            count: 1
          });
          
          if (blocks.length > 0) {
            const pos = blocks[0];
            const distance = this.bot.entity.position.distanceTo(pos);
            logger.debug(`Found ${blockType} at ${pos}, distance ${distance}`);
            
            // We don't take action here, just record it
            // This information can be used by other states to decide transitions
          }
        } catch (err) {
          // Just skip this block type
        }
      }
    } catch (error) {
      logger.warn('Error scanning for resources:', error);
    }
  }

  /**
   * Check if we've been idle for too long and should do something proactive
   */
  checkLongIdleAction() {
    if (!this.activeSince) return;
    
    const idleTime = Date.now() - this.activeSince;
    const currentPosition = this.bot.entity.position;
    
    // If we've been idle for more than 5 minutes, consider doing something
    if (idleTime > 5 * 60 * 1000) {
      logger.info('Been idle for too long, considering autonomous action');
      
      // Reset the idle timer
      this.activeSince = Date.now();
      
      // Decide what to do based on needs and environment
      this.decideAutonomousAction();
    }
    
    // Check if we're not moving at all for a long time
    if (this.idlePosition && currentPosition.distanceTo(this.idlePosition) < 0.1) {
      this.stuckCount++;
      
      // If we haven't moved for a while, try a small random movement
      if (this.stuckCount > 20) { // About 20 seconds of no movement
        this.performSmallMovement();
        this.stuckCount = 0;
      }
    } else {
      // Update idle position and reset stuck counter
      this.idlePosition = currentPosition.clone();
      this.stuckCount = 0;
    }
  }

  /**
   * Check for immediate threats that need response
   */
  checkForThreats() {
    // Skip if combat disabled
    if (!this.botManager.config.combat.enabled) return;
    if (!this.botManager.combatBehavior) return;
    
    // Scan for threats using the combat behavior's methods
    const threats = this.botManager.combatBehavior.scanForThreats();
    
    // If there are threats and they're very close, we might need to change state
    if (threats.length > 0) {
      const closestThreat = threats[0];
      
      // If the threat is really close, we should respond
      if (closestThreat.distance < 5) {
        logger.info(`Detected imminent threat: ${closestThreat.type} at distance ${closestThreat.distance}`);
        // We'll let the state machine's shouldTransition method handle the actual state change
      }
    }
  }

  /**
   * Decide what to do autonomously when idle for too long
   */
  decideAutonomousAction() {
    // This method lets the bot decide what to do when idle for too long
    // It won't change state directly but will set up conditions that may trigger transitions
    
    // First, check if there are immediate needs
    if (this.bot.food < 15) {
      logger.info('Hunger detected, will seek food');
      this.bot.chat('I should find some food...');
      return; // Let state transitions handle it
    }
    
    // Check inventory for tool needs
    const hasPicks = this.hasPickaxes();
    if (!hasPicks) {
      logger.info('No pickaxes, should craft some');
      this.bot.chat('I need to craft some tools...');
      return; // Let state transitions handle it
    }
    
    // Otherwise, pick something to do based on weighted random choice
    const options = [
      { activity: 'explore', weight: 3 },
      { activity: 'mine', weight: 2 },
      { activity: 'gather', weight: 1 }
    ];
    
    // Calculate total weight
    const totalWeight = options.reduce((sum, option) => sum + option.weight, 0);
    let randomValue = Math.random() * totalWeight;
    
    // Select an option based on weights
    let selectedActivity = null;
    for (const option of options) {
      randomValue -= option.weight;
      if (randomValue <= 0) {
        selectedActivity = option.activity;
        break;
      }
    }
    
    // Act based on the selected activity
    switch (selectedActivity) {
      case 'explore':
        logger.info('Autonomously deciding to explore');
        this.bot.chat('I think I\'ll explore the area for a bit.');
        break;
      case 'mine':
        logger.info('Autonomously deciding to mine');
        this.bot.chat('I should do some mining.');
        break;
      case 'gather':
        logger.info('Autonomously deciding to gather resources');
        this.bot.chat('I\'ll gather some resources.');
        break;
    }
  }

  /**
   * Check if the bot has pickaxes in inventory
   */
  hasPickaxes() {
    const items = this.bot.inventory.items();
    return items.some(item => item.name.includes('_pickaxe'));
  }

  /**
   * Perform a small random movement to avoid getting stuck
   */
  performSmallMovement() {
    const randomDirection = Math.random() * Math.PI * 2;
    const x = Math.cos(randomDirection);
    const z = Math.sin(randomDirection);
    
    // Just move a tiny bit in a random direction
    this.bot.setControlState('forward', true);
    this.bot.look(randomDirection, 0, false);
    
    // Stop after a short period
    setTimeout(() => {
      this.bot.clearControlStates();
    }, 1000);
  }

  /**
   * Check if it's night time and potentially unsafe
   */
  isNightTimeAndUnsafe() {
    // Time is in ticks (24000 ticks in a day)
    // Night is between 13000 and 23000
    const time = this.bot.time.timeOfDay;
    const isNight = time >= 13000 && time < 23000;
    
    // If it's night and we're outdoors (sky light level > 0), it might be unsafe
    // This is a simplification - ideally we'd check actual light levels and mob spawning conditions
    if (isNight) {
      const pos = this.bot.entity.position.floored();
      const block = this.bot.blockAt(pos);
      
      // If we can get sky light level, use that to determine if we're outside
      if (block && block.skyLight > 0) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Check if it's raining and the bot is unsheltered
   */
  isRainingAndUnsheltered() {
    if (!this.bot.isRaining) return false;
    
    // Check if we're exposed to the sky
    const pos = this.bot.entity.position.floored();
    
    // Look up to check for blocks above us that might provide shelter
    for (let y = pos.y + 1; y < Math.min(pos.y + 20, 255); y++) {
      const blockPos = new Vec3(pos.x, y, pos.z);
      const block = this.bot.blockAt(blockPos);
      
      if (block && block.boundingBox === 'block') {
        // Found a solid block above us, we're sheltered
        return false;
      }
    }
    
    // No shelter found, we're exposed to rain
    return true;
  }

  /**
   * Determine if we should transition to another state
   */
  shouldTransition(nextState) {
    // This method is called by the state machine to check if we should
    // transition from idle to another state
    
    // Different checks based on the potential next state
    switch (nextState) {
      case 'mining':
        return this.shouldTransitionToMining();
      case 'combat':
        return this.shouldTransitionToCombat();
      case 'gather':
        return this.shouldTransitionToGather();
      case 'follow':
        return this.shouldTransitionToFollow();
      case 'explore':
        return this.shouldTransitionToExplore();
      case 'craft':
        return this.shouldTransitionToCraft();
      case 'build':
        return this.shouldTransitionToBuild();
      default:
        return false;
    }
  }

  /**
   * Check if we should transition to mining state
   */
  shouldTransitionToMining() {
    // If we just entered idle state, don't switch too quickly
    if (Date.now() - this.activeSince < 5000) return false;
    
    // If we have an owner and they instructed us to mine something
    if (this.botManager.miningBehavior && this.botManager.miningBehavior.targetBlocks 
        && this.botManager.miningBehavior.targetBlocks.length > 0) {
      return true;
    }
    
    // If we've been idle for a while and decided autonomously to mine
    const longIdleTime = Date.now() - this.activeSince > 3 * 60 * 1000;
    if (longIdleTime && Math.random() < 0.3) { // 30% chance after 3 minutes idle
      return true;
    }
    
    return false;
  }

  /**
   * Check if we should transition to combat state
   */
  shouldTransitionToCombat() {
    // Always transition to combat if we have an attack target
    if (this.botManager.combatBehavior && this.botManager.combatBehavior.attackTarget) {
      return true;
    }
    
    // Check for imminent threats
    if (this.botManager.combatBehavior) {
      const threats = this.botManager.combatBehavior.scanForThreats();
      
      // If there's a very close threat, engage in combat
      if (threats.length > 0 && threats[0].distance < 5) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Check if we should transition to gather state
   */
  shouldTransitionToGather() {
    // If we just entered idle state, don't switch too quickly
    if (Date.now() - this.activeSince < 5000) return false;
    
    // If we have low food and need to gather more
    if (this.bot.food < 10) {
      return true;
    }
    
    // If we're directed to collect specific items
    if (this.botManager.survivalBehavior && this.botManager.survivalBehavior.isCollecting) {
      return true;
    }
    
    // If we've been idle for a while and decided autonomously to gather
    const longIdleTime = Date.now() - this.activeSince > 4 * 60 * 1000;
    if (longIdleTime && Math.random() < 0.25) { // 25% chance after 4 minutes idle
      return true;
    }
    
    return false;
  }

  /**
   * Check if we should transition to follow state
   */
  shouldTransitionToFollow() {
    // Only follow if we have an owner
    if (!this.botManager.owner) return false;
    
    // Check if the owner is nearby and we should follow them
    const owner = this.bot.players[this.botManager.owner];
    
    if (owner && owner.entity) {
      // If the owner is far away, follow them
      const distance = owner.entity.position.distanceTo(this.bot.entity.position);
      
      if (distance > 10) {
        // Owner is getting far away, follow them
        return true;
      }
    }
    
    return false;
  }

  /**
   * Check if we should transition to explore state
   */
  shouldTransitionToExplore() {
    // If we just entered idle state, don't switch too quickly
    if (Date.now() - this.activeSince < 5000) return false;
    
    // If we're specifically directed to explore
    if (this.botManager.explorationBehavior && this.botManager.explorationBehavior.isExploring) {
      return true;
    }
    
    // If we've been idle for a long while, occasionally explore
    const veryLongIdleTime = Date.now() - this.activeSince > 5 * 60 * 1000;
    if (veryLongIdleTime && Math.random() < 0.4) { // 40% chance after 5 minutes idle
      return true;
    }
    
    return false;
  }

  /**
   * Check if we should transition to craft state
   */
  shouldTransitionToCraft() {
    // If we've been instructed to craft something
    if (this.botManager.craftingBehavior && this.botManager.craftingBehavior.isCrafting) {
      return true;
    }
    
    // If we need tools and should craft them
    const basicTools = this.hasBasicTools();
    if (!basicTools && Math.random() < 0.7) { // 70% chance to craft if we need tools
      return true;
    }
    
    return false;
  }

  /**
   * Check if we should transition to build state
   */
  shouldTransitionToBuild() {
    // Only transition to build if explicitly instructed to
    if (this.botManager.buildingBehavior && this.botManager.buildingBehavior.isBuilding) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if the bot has basic tools
   */
  hasBasicTools() {
    const items = this.bot.inventory.items();
    const hasPickaxe = items.some(item => item.name.includes('_pickaxe'));
    const hasAxe = items.some(item => item.name.includes('_axe') && !item.name.includes('pick'));
    
    return hasPickaxe && hasAxe;
  }
}

module.exports = IdleState;
