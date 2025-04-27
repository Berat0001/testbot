/**
 * Fishing State for Minecraft Bot
 * 
 * In this state, the bot will:
 * - Find a suitable body of water
 * - Equip a fishing rod
 * - Catch fish and other items
 * - Maintain inventory and fishing tools
 */

// Import our custom StateBehavior base class
const StateBehavior = require('../bot/stateBehavior');
const Vec3 = require('vec3');
const logger = require('../bot/logger');

class FishState extends StateBehavior {
  constructor(bot, botManager) {
    super(bot, 'fish');
    this.botManager = botManager;
    
    // State variables
    this.fishingSpot = null;
    this.isFishing = false;
    this.lookingForSpot = false;
    this.fishingStartTime = null;
    this.lastCastTime = 0;
    this.itemsCaught = 0;
    this.fishCaught = 0;
    this.treasureCaught = 0;
    this.junkCaught = 0;
    this.rodDurability = 0;
    this.lastRodCheck = 0;
    this.fishingTimeout = null;
    this.maxFishingDuration = 15 * 60 * 1000; // 15 minutes
    this.currentTarget = null;
    this.targetCatchCount = 20; // Default target
    this.waterSearchRadius = 10; // Default search radius
    this.fishingSetupComplete = false;
    
    // Categories for caught items
    this.fishTypes = ['cod', 'salmon', 'tropical_fish', 'pufferfish'];
    this.treasureTypes = [
      'bow', 'enchanted_book', 'name_tag', 'nautilus_shell', 
      'saddle', 'lily_pad', 'fishing_rod'
    ];
    this.junkTypes = [
      'rotten_flesh', 'string', 'stick', 'ink_sac', 'bone', 
      'leather', 'leather_boots', 'bowl', 'tripwire_hook', 'lily_pad'
    ];
  }

  onStateEntered() {
    super.onStateEntered();
    logger.info('Entered fishing state');
    
    // Initialize fishing session
    this.fishingStartTime = Date.now();
    this.itemsCaught = 0;
    this.fishCaught = 0;
    this.treasureCaught = 0;
    this.junkCaught = 0;
    this.lookingForSpot = false;
    this.fishingSpot = null;
    this.isFishing = false;
    this.fishingSetupComplete = false;
    
    // Announce state change
    this.bot.chat('Starting fishing activities');
    
    // Start fishing setup
    this.setupFishing();
  }

  onStateExited() {
    super.onStateExited();
    logger.info('Exited fishing state');
    
    // Stop fishing
    this.stopFishing();
    
    // Clear any timeouts
    if (this.fishingTimeout) {
      clearTimeout(this.fishingTimeout);
      this.fishingTimeout = null;
    }
    
    // Report fishing results
    if (this.itemsCaught > 0) {
      const duration = (Date.now() - this.fishingStartTime) / 1000;
      this.bot.chat(
        `Fishing session complete: caught ${this.itemsCaught} items ` +
        `(${this.fishCaught} fish, ${this.treasureCaught} treasure, ${this.junkCaught} junk) ` +
        `in ${duration.toFixed(0)} seconds.`
      );
    }
    
    // Reset state variables
    this.fishingSpot = null;
    this.isFishing = false;
    this.fishingStartTime = null;
  }

  /**
   * Set up fishing - find water and equip rod
   */
  async setupFishing() {
    try {
      // First check if we have a fishing rod
      const hasRod = await this.equipFishingRod();
      
      if (!hasRod) {
        this.bot.chat("I don't have a fishing rod");
        // Try to craft one if we have the materials
        const craftedRod = await this.tryCraftFishingRod();
        
        if (!craftedRod) {
          this.bot.chat("I don't have materials to craft a fishing rod either");
          this.miningTaskComplete = true;
          return;
        }
      }
      
      // Check rod durability
      this.checkRodDurability();
      
      // Find a fishing spot
      await this.findFishingSpot();
      
      if (!this.fishingSpot) {
        this.bot.chat("Couldn't find a suitable fishing spot");
        this.miningTaskComplete = true;
        return;
      }
      
      // Move to the fishing spot
      await this.moveToFishingSpot();
      
      // Set up fishing timeout to prevent too long fishing
      this.fishingTimeout = setTimeout(() => {
        logger.info('Fishing timeout reached');
        this.bot.chat('Been fishing for a while, time to do something else');
        this.miningTaskComplete = true;
      }, this.maxFishingDuration);
      
      this.fishingSetupComplete = true;
      this.startFishing();
    } catch (error) {
      logger.error('Error setting up fishing:', error);
      this.bot.chat('Error setting up fishing: ' + error.message);
    }
  }

  /**
   * Try to find a suitable fishing spot with water
   */
  async findFishingSpot() {
    try {
      this.lookingForSpot = true;
      this.bot.chat('Looking for a good fishing spot...');
      
      // Start by checking if there's water right below us
      const pos = this.bot.entity.position.floored();
      const blockBelow = this.bot.blockAt(pos.offset(0, -1, 0));
      
      if (blockBelow && (blockBelow.name === 'water' || blockBelow.name.includes('water'))) {
        // We're already above water, just offset a bit
        this.fishingSpot = pos.offset(0, 1, 0);
        logger.info('Already at water, using current position as fishing spot');
        this.lookingForSpot = false;
        return;
      }
      
      // Search for water blocks in a radius
      const waterBlocks = [];
      
      // Increase radius until we find water
      let radius = 5;
      const maxRadius = this.waterSearchRadius;
      
      while (waterBlocks.length === 0 && radius <= maxRadius) {
        logger.info(`Searching for water with radius ${radius}`);
        
        const blocks = this.bot.findBlocks({
          matching: block => block.name === 'water' || block.name.includes('water'),
          maxDistance: radius,
          count: 10
        });
        
        // Filter for water blocks that have air above them
        for (const blockPos of blocks) {
          const abovePos = blockPos.offset(0, 1, 0);
          const aboveBlock = this.bot.blockAt(abovePos);
          
          if (aboveBlock && (aboveBlock.name === 'air' || aboveBlock.name === 'cave_air')) {
            // Look further to make sure there's enough water
            const waterCount = this.countAdjacentWaterBlocks(blockPos);
            
            if (waterCount >= 3) { // Require at least 3 adjacent water blocks
              waterBlocks.push(blockPos);
            }
          }
        }
        
        radius += 5;
      }
      
      if (waterBlocks.length === 0) {
        logger.info('No suitable water found for fishing');
        this.lookingForSpot = false;
        return;
      }
      
      // Sort by distance
      waterBlocks.sort((a, b) => {
        const distA = this.bot.entity.position.distanceTo(a);
        const distB = this.bot.entity.position.distanceTo(b);
        return distA - distB;
      });
      
      // Find a suitable standing position near the water
      const waterPos = waterBlocks[0];
      const standingPos = await this.findStandingPositionNearWater(waterPos);
      
      if (!standingPos) {
        logger.info('Could not find a suitable standing position near water');
        this.lookingForSpot = false;
        return;
      }
      
      // Set the fishing spot
      this.fishingSpot = standingPos;
      logger.info(`Found fishing spot at ${standingPos}`);
      this.bot.chat('Found a nice fishing spot');
      
      this.lookingForSpot = false;
    } catch (error) {
      logger.error('Error finding fishing spot:', error);
      this.lookingForSpot = false;
    }
  }

  /**
   * Count adjacent water blocks to ensure we have a large enough water body
   */
  countAdjacentWaterBlocks(centerPos) {
    let count = 0;
    const checked = new Set();
    const toCheck = [centerPos];
    
    // Add position string to checked set
    const posKey = pos => `${pos.x},${pos.y},${pos.z}`;
    
    // Add initial position to checked
    checked.add(posKey(centerPos));
    
    // Check adjacent positions (breadth-first search, limited depth)
    while (toCheck.length > 0 && count < 10) {
      const pos = toCheck.shift();
      
      // Check if it's water
      const block = this.bot.blockAt(pos);
      if (block && (block.name === 'water' || block.name.includes('water'))) {
        count++;
        
        // Add adjacent blocks to check
        const adjacentPositions = [
          pos.offset(1, 0, 0),
          pos.offset(-1, 0, 0),
          pos.offset(0, 0, 1),
          pos.offset(0, 0, -1)
        ];
        
        for (const adjPos of adjacentPositions) {
          const key = posKey(adjPos);
          if (!checked.has(key)) {
            checked.add(key);
            toCheck.push(adjPos);
          }
        }
      }
    }
    
    return count;
  }

  /**
   * Find a suitable position to stand near water for fishing
   */
  async findStandingPositionNearWater(waterPos) {
    // Check in a small radius around the water
    const directions = [
      new Vec3(1, 0, 0),
      new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1),
      new Vec3(0, 0, -1),
      new Vec3(1, 0, 1),
      new Vec3(1, 0, -1),
      new Vec3(-1, 0, 1),
      new Vec3(-1, 0, -1)
    ];
    
    for (const dir of directions) {
      const checkPos = waterPos.plus(dir);
      
      // Check the block at this position
      const block = this.bot.blockAt(checkPos);
      if (!block) continue;
      
      // Check if we can stand here (solid, non-water block)
      if (block.name !== 'water' && block.name !== 'lava' && block.boundingBox === 'block') {
        // Check if there's space above for the bot
        const aboveBlock1 = this.bot.blockAt(checkPos.offset(0, 1, 0));
        const aboveBlock2 = this.bot.blockAt(checkPos.offset(0, 2, 0));
        
        if ((aboveBlock1 && aboveBlock1.boundingBox === 'empty') &&
            (aboveBlock2 && aboveBlock2.boundingBox === 'empty')) {
          // This position should work
          return checkPos.offset(0, 1, 0);
        }
      }
    }
    
    // If we couldn't find an adjacent spot, try above the water
    const aboveWater = waterPos.offset(0, 1, 0);
    
    // Check if we can place a block here
    if (await this.canPlaceBlockAt(aboveWater)) {
      // Try to find a block to use
      const blockItem = this.findPlaceableBlock();
      
      if (blockItem) {
        try {
          // Equip the block
          await this.bot.equip(blockItem, 'hand');
          
          // Find a reference block to place against
          const refBlock = this.bot.blockAt(waterPos);
          
          // Place the block
          await this.bot.placeBlock(refBlock, new Vec3(0, 1, 0));
          
          // If successful, we can stand on this block
          return aboveWater.offset(0, 1, 0);
        } catch (error) {
          logger.warn('Error placing block for fishing platform:', error);
        }
      }
    }
    
    return null;
  }

  /**
   * Check if we can place a block at the given position
   */
  async canPlaceBlockAt(pos) {
    const block = this.bot.blockAt(pos);
    return block && block.boundingBox === 'empty';
  }

  /**
   * Find a placeable block in the inventory
   */
  findPlaceableBlock() {
    const placeableTypes = [
      'dirt', 'stone', 'cobblestone', 'sand', 'gravel', 'planks',
      'netherrack', 'soul_sand', 'grass_block'
    ];
    
    for (const item of this.bot.inventory.items()) {
      for (const type of placeableTypes) {
        if (item.name.includes(type)) {
          return item;
        }
      }
    }
    
    return null;
  }

  /**
   * Move to the fishing spot
   */
  async moveToFishingSpot() {
    if (!this.fishingSpot) return;
    
    try {
      this.bot.chat('Moving to fishing spot...');
      logger.info(`Moving to fishing spot at ${this.fishingSpot}`);
      
      if (this.bot.pathfinder) {
        await this.bot.pathfinder.goto(this.bot.pathfinder.createFlyGoal(
          this.fishingSpot.x, this.fishingSpot.y, this.fishingSpot.z, 0.5
        ));
      } else {
        // Simple move if pathfinder not available
        this.bot.chat('No pathfinder available, trying simple movement');
        
        // Look at the target
        const delta = this.fishingSpot.minus(this.bot.entity.position);
        const yaw = Math.atan2(-delta.x, delta.z);
        await this.bot.look(yaw, 0, true);
        
        // Try to move forward
        this.bot.setControlState('forward', true);
        
        // Wait a bit
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Stop moving
        this.bot.clearControlStates();
      }
      
      logger.info('Arrived at fishing spot');
      this.bot.chat('Arrived at fishing spot, ready to fish');
      
      // Look at water
      await this.lookAtWater();
    } catch (error) {
      logger.error('Error moving to fishing spot:', error);
      this.bot.chat('Had trouble reaching the fishing spot: ' + error.message);
    }
  }

  /**
   * Look towards water for fishing
   */
  async lookAtWater() {
    try {
      // Find water blocks in view
      const waterBlocks = [];
      
      // Look in a small radius
      const searchRadius = 5;
      const pos = this.bot.entity.position;
      
      for (let x = -searchRadius; x <= searchRadius; x++) {
        for (let y = -3; y <= 0; y++) {
          for (let z = -searchRadius; z <= searchRadius; z++) {
            const checkPos = pos.offset(x, y, z);
            const block = this.bot.blockAt(checkPos);
            
            if (block && (block.name === 'water' || block.name.includes('water'))) {
              waterBlocks.push(checkPos);
            }
          }
        }
      }
      
      if (waterBlocks.length === 0) {
        logger.warn('No water blocks found to look at');
        return;
      }
      
      // Sort by distance
      waterBlocks.sort((a, b) => {
        const distA = this.bot.entity.position.distanceTo(a);
        const distB = this.bot.entity.position.distanceTo(b);
        return distA - distB;
      });
      
      // Look at the closest water block
      const target = waterBlocks[0];
      const delta = target.minus(this.bot.entity.position.offset(0, 1.6, 0)); // Adjust for eye height
      const yaw = Math.atan2(-delta.x, delta.z);
      const pitch = Math.atan2(delta.y, Math.sqrt(delta.x * delta.x + delta.z * delta.z));
      
      await this.bot.look(yaw, pitch, true);
      logger.info(`Looking at water at ${target}`);
    } catch (error) {
      logger.warn('Error looking at water:', error);
    }
  }

  /**
   * Start fishing
   */
  async startFishing() {
    if (this.isFishing) return;
    
    try {
      // Make sure we have a fishing rod equipped
      const hasRod = await this.equipFishingRod();
      
      if (!hasRod) {
        this.bot.chat("Can't fish without a fishing rod");
        this.miningTaskComplete = true;
        return;
      }
      
      // Update rod durability
      this.checkRodDurability();
      
      // Look at water before casting
      await this.lookAtWater();
      
      // Start fishing
      logger.info('Starting to fish');
      this.bot.chat('Casting line...');
      
      // Register fishing events
      this.registerFishingEvents();
      
      // Set timeout before recasting
      this.recastTimeout = setTimeout(() => {
        if (this.active) {
          logger.info('Recasting after timeout');
          this.stopFishing();
          this.startFishing();
        }
      }, 60000); // Recast after 1 minute if nothing happens
      
      // Use fishing rod
      this.bot.activateItem();
      this.isFishing = true;
      this.lastCastTime = Date.now();
    } catch (error) {
      logger.error('Error starting fishing:', error);
      this.bot.chat('Error starting fishing: ' + error.message);
      this.isFishing = false;
    }
  }

  /**
   * Register event handlers for fishing
   */
  registerFishingEvents() {
    if (!this._onCollect) {
      this._onCollect = (collector, collected) => {
        if (collector.username === this.bot.username) {
          logger.info(`Caught something: ${JSON.stringify(collected)}`);
          
          // Get the item details if possible
          const entity = this.bot.entities[collected.entityId];
          if (entity) {
            // Process the caught item
            this.processCaughtItem(entity);
          }
          
          // Increment counters
          this.itemsCaught++;
          
          // Check fishing rod durability
          this.checkRodDurability();
          
          // Check if we've reached our target
          if (this.targetCatchCount > 0 && this.itemsCaught >= this.targetCatchCount) {
            this.bot.chat(`Reached target of ${this.targetCatchCount} items caught!`);
            this.miningTaskComplete = true;
            return;
          }
          
          // Recast the line
          setTimeout(() => {
            if (this.active) {
              this.stopFishing();
              this.startFishing();
            }
          }, 1000);
        }
      };
      
      this.bot.on('playerCollect', this._onCollect);
    }
    
    if (!this._onSoundEffect) {
      this._onSoundEffect = (packet) => {
        // Listen for bobber splash (fish bite)
        if (packet && packet.soundId === 73) { // Adjust sound ID as needed
          logger.info('Heard fish splash sound, retrieving line');
          
          // Wait a moment then use rod to catch
          setTimeout(() => {
            if (this.isFishing && this.active) {
              this.bot.activateItem();
            }
          }, 500);
        }
      };
      
      this.bot._client.on('sound_effect', this._onSoundEffect);
    }
  }

  /**
   * Unregister fishing event handlers
   */
  unregisterFishingEvents() {
    if (this._onCollect) {
      this.bot.removeListener('playerCollect', this._onCollect);
      this._onCollect = null;
    }
    
    if (this._onSoundEffect) {
      this.bot._client.removeListener('sound_effect', this._onSoundEffect);
      this._onSoundEffect = null;
    }
  }

  /**
   * Process a caught item
   */
  processCaughtItem(entity) {
    if (!entity || !entity.metadata) {
      logger.warn('No entity metadata available for caught item');
      return;
    }
    
    try {
      let itemName = "unknown item";
      
      // Try to get the item name
      for (const meta of entity.metadata) {
        if (meta && meta.value && meta.value.itemId) {
          itemName = meta.value.itemId;
          break;
        }
      }
      
      logger.info(`Caught: ${itemName}`);
      
      // Categorize the item
      if (this.fishTypes.some(type => itemName.includes(type))) {
        this.fishCaught++;
        this.bot.chat(`Caught a fish! (${this.fishCaught} total)`);
      } else if (this.treasureTypes.some(type => itemName.includes(type))) {
        this.treasureCaught++;
        this.bot.chat(`Caught treasure: ${itemName}!`);
      } else {
        this.junkCaught++;
        this.bot.chat(`Caught some junk: ${itemName}`);
      }
    } catch (error) {
      logger.warn('Error processing caught item:', error);
    }
  }

  /**
   * Stop fishing
   */
  stopFishing() {
    if (!this.isFishing) return;
    
    try {
      // Clear timeouts
      if (this.recastTimeout) {
        clearTimeout(this.recastTimeout);
        this.recastTimeout = null;
      }
      
      // Unregister event handlers
      this.unregisterFishingEvents();
      
      // If we're actively fishing, use the rod again to stop
      if (this.isFishing) {
        this.bot.activateItem();
      }
      
      this.isFishing = false;
      logger.info('Stopped fishing');
    } catch (error) {
      logger.warn('Error stopping fishing:', error);
    }
  }

  /**
   * Equip a fishing rod
   */
  async equipFishingRod() {
    try {
      // Find fishing rod in inventory
      const rod = this.bot.inventory.items().find(item => 
        item.name === 'fishing_rod'
      );
      
      if (!rod) {
        logger.info('No fishing rod found in inventory');
        return false;
      }
      
      // Equip the rod
      await this.bot.equip(rod, 'hand');
      logger.info('Equipped fishing rod');
      
      return true;
    } catch (error) {
      logger.error('Error equipping fishing rod:', error);
      return false;
    }
  }

  /**
   * Try to craft a fishing rod if we don't have one
   */
  async tryCraftFishingRod() {
    try {
      if (!this.botManager.craftingBehavior) {
        logger.warn('No crafting behavior available');
        return false;
      }
      
      this.bot.chat('Trying to craft a fishing rod');
      
      // Check if we have the materials (3 sticks, 2 strings)
      const hasSticks = this.bot.inventory.count(this.bot.registry.itemsByName.stick?.id) >= 3;
      const hasString = this.bot.inventory.count(this.bot.registry.itemsByName.string?.id) >= 2;
      
      if (!hasSticks || !hasString) {
        logger.info(`Missing materials for fishing rod: sticks=${hasSticks}, string=${hasString}`);
        return false;
      }
      
      // Try to craft
      await this.botManager.craftingBehavior.craftItem('fishing_rod', 1);
      
      // Check if successful
      const hasRod = this.bot.inventory.items().some(item => item.name === 'fishing_rod');
      
      if (hasRod) {
        this.bot.chat('Successfully crafted a fishing rod');
        return true;
      } else {
        logger.warn('Failed to craft fishing rod');
        return false;
      }
    } catch (error) {
      logger.error('Error crafting fishing rod:', error);
      return false;
    }
  }

  /**
   * Check rod durability
   */
  checkRodDurability() {
    try {
      const now = Date.now();
      if (now - this.lastRodCheck < 30000) return; // Check at most every 30 seconds
      
      this.lastRodCheck = now;
      
      // Get the held item
      const heldItem = this.bot.inventory.slots[this.bot.getEquipmentDestSlot('hand')];
      
      if (!heldItem || heldItem.name !== 'fishing_rod') return;
      
      // Calculate durability percentage
      const maxDurability = 64; // Standard fishing rod durability
      const durability = heldItem.durabilityUsed || 0;
      const durabilityLeft = maxDurability - durability;
      const durabilityPercent = Math.floor((durabilityLeft / maxDurability) * 100);
      
      this.rodDurability = durabilityPercent;
      
      // Warn if durability is low
      if (durabilityPercent <= 10) {
        this.bot.chat('Warning: Fishing rod is about to break!');
        logger.warn('Fishing rod durability critical: ' + durabilityPercent + '%');
      } else if (durabilityPercent <= 25) {
        logger.info('Fishing rod durability low: ' + durabilityPercent + '%');
      }
    } catch (error) {
      logger.warn('Error checking rod durability:', error);
    }
  }

  /**
   * Main update function for the fishing state
   */
  update() {
    // Skip if we're not active
    if (!this.active) return;
    
    // If we're still setting up, skip updates
    if (!this.fishingSetupComplete) return;
    
    // If we've been fishing for too long, consider stopping
    if (this.fishingStartTime && Date.now() - this.fishingStartTime > this.maxFishingDuration) {
      logger.info('Been fishing for too long, finishing up');
      this.bot.chat('Been fishing for a while, time to do something else');
      this.miningTaskComplete = true;
      return;
    }
    
    // If we're not fishing, try to restart
    if (!this.isFishing && !this.lookingForSpot) {
      // Check if we've been interrupted
      const timeSinceLastCast = Date.now() - this.lastCastTime;
      
      if (timeSinceLastCast > 5000) { // 5 seconds since last cast
        this.startFishing();
      }
    }
    
    // Check rod durability periodically
    const now = Date.now();
    if (now - this.lastRodCheck > 60000) { // every minute
      this.checkRodDurability();
    }
  }

  /**
   * Determine if we should transition to another state
   */
  shouldTransition(nextState) {
    // Don't transition if we just started fishing
    if (this.fishingStartTime && Date.now() - this.fishingStartTime < 30000) {
      return false;
    }
    
    switch (nextState) {
      case 'idle':
        // Transition to idle if we've completed our fishing task
        return this.miningTaskComplete;
        
      case 'combat':
        // Always transition to combat if needed
        return this.botManager.combatBehavior && 
               this.botManager.combatBehavior.scanForThreats().length > 0;
        
      case 'craft':
        // Transition to craft if our fishing rod is broken
        return this.rodDurability <= 5;
        
      case 'follow':
        // Always follow owner if requested
        return this.botManager.owner !== null;
        
      default:
        return false;
    }
  }
}

module.exports = FishState;