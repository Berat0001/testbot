/**
 * Defense State for Minecraft Bot
 * 
 * In this state, the bot will:
 * - Create and maintain defensive structures
 * - Set up traps and defensive mechanisms
 * - Patrol a perimeter area
 * - Establish a safe zone and defend it
 */

// Import our custom StateBehavior base class
const StateBehavior = require('../bot/stateBehavior');
const Vec3 = require('vec3');
const logger = require('../bot/logger');

class DefenseState extends StateBehavior {
  constructor(bot, botManager) {
    super(bot, 'defense');
    this.botManager = botManager;
    
    // State variables
    this.defenseCenter = null;
    this.defenseRadius = 16;
    this.patrolPoints = [];
    this.currentPatrolIndex = 0;
    this.isDefending = false;
    this.isPatrolling = false;
    this.isSettingUpDefenses = false;
    this.defenseStartTime = null;
    this.lastThreatScan = 0;
    this.threats = [];
    this.fortificationBlocks = ['cobblestone', 'stone', 'stone_bricks'];
    this.wallHeight = 3;
    this.hasBuiltWalls = false;
    this.hasDugTrenches = false;
    this.hasPlacedTorches = false;
    this.defendingTarget = null;
    this.operationalPhase = 'setup'; // setup, patrol, combat, fortify
    this.safeItems = [
      'shield', 
      'iron_sword', 
      'bow', 
      'arrow', 
      'iron_helmet', 
      'iron_chestplate', 
      'iron_leggings', 
      'iron_boots'
    ];
    this.defenseComplete = false;
    this.defenseSetupComplete = false;
    this.lastProgressUpdate = 0;
  }

  onStateEntered() {
    super.onStateEntered();
    logger.info('Entered defense state');
    
    // Initialize defense session
    this.defenseStartTime = Date.now();
    this.isDefending = true;
    this.isPatrolling = false;
    this.isSettingUpDefenses = false;
    this.operationalPhase = 'setup';
    this.defenseComplete = false;
    this.defenseSetupComplete = false;
    
    // Announce state change
    this.bot.chat('Starting defensive operations');
    
    // Set up defense position
    this.setupDefensePosition();
  }

  onStateExited() {
    super.onStateExited();
    logger.info('Exited defense state');
    
    // Report defense results
    const duration = (Date.now() - this.defenseStartTime) / 1000;
    this.bot.chat(`Defense operations completed after ${duration.toFixed(0)} seconds`);
    
    // Reset state variables
    this.isDefending = false;
    this.isPatrolling = false;
    this.defenseStartTime = null;
    this.currentPatrolIndex = 0;
  }

  /**
   * Set up defense position and security plan
   */
  setupDefensePosition() {
    try {
      // Use current position as center if none defined
      if (!this.defenseCenter) {
        this.defenseCenter = this.bot.entity.position.clone();
        logger.info(`Using current position as defense center: ${this.defenseCenter}`);
      }
      
      // Check if area is suitable
      this.analyzeDefenseArea();
      
      // Generate patrol points
      this.generatePatrolPoints();
      
      // Check and equip defensive items
      this.equipDefensiveGear();
      
      // Mark setup as complete
      this.defenseSetupComplete = true;
      
      // Set the first phase: setup defensive structures
      this.operationalPhase = 'fortify';
      this.bot.chat('Defense perimeter established, beginning fortification');
    } catch (error) {
      logger.error('Error setting up defense position:', error);
    }
  }

  /**
   * Analyze the defense area for threats and terrain
   */
  analyzeDefenseArea() {
    try {
      logger.info('Analyzing defensive perimeter');
      
      // Scan for hostile mobs
      const hostileMobs = this.scanForHostileMobs();
      if (hostileMobs.length > 0) {
        logger.info(`Found ${hostileMobs.length} hostile mobs in the area`);
        this.threats = hostileMobs;
        
        // If there are immediate threats, change phase to combat
        if (hostileMobs.some(mob => mob.distance < 16)) {
          this.operationalPhase = 'combat';
          this.bot.chat('Immediate threats detected! Engaging in combat');
        }
      }
      
      // Analyze terrain
      this.analyzeTerrain();
      
      // Check if there are valuable items or structures to defend
      this.findDefensePriorities();
    } catch (error) {
      logger.warn('Error analyzing defense area:', error);
    }
  }

  /**
   * Scan for hostile mobs in the area
   */
  scanForHostileMobs() {
    const hostileMobs = [];
    
    try {
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
            distance: distance,
            position: entity.position.clone()
          });
        }
      }
      
      // Sort by distance
      hostileMobs.sort((a, b) => a.distance - b.distance);
    } catch (error) {
      logger.warn('Error scanning for hostile mobs:', error);
    }
    
    return hostileMobs;
  }

  /**
   * Analyze terrain for defensive advantages and disadvantages
   */
  analyzeTerrain() {
    try {
      logger.info('Analyzing terrain for defensive position');
      
      // Check ground blocks for stability
      const groundBlocks = this.checkGroundBlocks();
      
      // Check if area has good visibility
      const hasGoodVisibility = this.checkAreaVisibility();
      
      // Check for natural barriers
      const naturalBarriers = this.checkForNaturalBarriers();
      
      // Check for water sources
      const waterSources = this.checkForWaterSources();
      
      logger.info(`Terrain analysis: Ground stability: ${groundBlocks.stable ? 'Good' : 'Poor'}, ` +
                 `Visibility: ${hasGoodVisibility ? 'Good' : 'Poor'}, ` +
                 `Natural barriers: ${naturalBarriers.length}, ` +
                 `Water sources: ${waterSources.length}`);
    } catch (error) {
      logger.warn('Error analyzing terrain:', error);
    }
  }

  /**
   * Check ground blocks for stability
   */
  checkGroundBlocks() {
    const result = { stable: true, unstableCount: 0 };
    
    try {
      const center = this.defenseCenter.floored();
      const radius = Math.min(8, this.defenseRadius);
      
      // Check a sample of blocks in the area
      for (let x = -radius; x <= radius; x += 2) {
        for (let z = -radius; z <= radius; z += 2) {
          const pos = center.offset(x, -1, z);
          const block = this.bot.blockAt(pos);
          
          if (!block || block.boundingBox !== 'block') {
            result.unstableCount++;
          }
          
          // Check for dangerous blocks (lava, etc)
          if (block && (block.name === 'lava' || block.name === 'flowing_lava')) {
            result.dangerous = true;
          }
        }
      }
      
      // Determine if the ground is stable enough
      result.stable = result.unstableCount < (radius * radius / 4);
    } catch (error) {
      logger.warn('Error checking ground blocks:', error);
    }
    
    return result;
  }

  /**
   * Check if the area has good visibility
   */
  checkAreaVisibility() {
    try {
      const center = this.defenseCenter.floored();
      const radius = Math.min(16, this.defenseRadius);
      let blockedSightlines = 0;
      
      // Check visibility in cardinal directions
      const directions = [
        { x: 1, z: 0 },
        { x: -1, z: 0 },
        { x: 0, z: 1 },
        { x: 0, z: -1 },
        { x: 1, z: 1 },
        { x: -1, z: 1 },
        { x: 1, z: -1 },
        { x: -1, z: -1 }
      ];
      
      // Count how many directions have clear sightlines
      for (const dir of directions) {
        let clearSightline = true;
        
        // Check along the sightline
        for (let dist = 3; dist <= radius; dist += 3) {
          const checkPos = center.offset(dir.x * dist, 0, dir.z * dist);
          
          // Check blocks at eye level and above
          for (let y = 1; y <= 2; y++) {
            const block = this.bot.blockAt(checkPos.offset(0, y, 0));
            if (block && block.boundingBox === 'block') {
              clearSightline = false;
              break;
            }
          }
          
          if (!clearSightline) break;
        }
        
        if (!clearSightline) {
          blockedSightlines++;
        }
      }
      
      // Return true if at least 5 of 8 directions have clear sightlines
      return blockedSightlines <= 3;
    } catch (error) {
      logger.warn('Error checking area visibility:', error);
      return false;
    }
  }

  /**
   * Check for natural barriers like walls, cliffs, etc.
   */
  checkForNaturalBarriers() {
    const barriers = [];
    
    try {
      const center = this.defenseCenter.floored();
      const radius = Math.min(16, this.defenseRadius);
      
      // Check in a circular pattern around the perimeter
      const steps = 12; // Check 12 points around the circle
      for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * 2 * Math.PI;
        const x = Math.round(Math.cos(angle) * radius);
        const z = Math.round(Math.sin(angle) * radius);
        
        const checkPos = center.offset(x, 0, z);
        
        // Check for walls or cliffs (vertical stack of solid blocks)
        let solidBlocksCount = 0;
        for (let y = -1; y <= 5; y++) {
          const block = this.bot.blockAt(checkPos.offset(0, y, 0));
          if (block && block.boundingBox === 'block') {
            solidBlocksCount++;
          }
        }
        
        // If there are at least 3 solid blocks stacked, consider it a barrier
        if (solidBlocksCount >= 3) {
          barriers.push({
            position: checkPos,
            height: solidBlocksCount,
            angle: angle
          });
        }
      }
    } catch (error) {
      logger.warn('Error checking for natural barriers:', error);
    }
    
    return barriers;
  }

  /**
   * Check for water sources in the area
   */
  checkForWaterSources() {
    const waterSources = [];
    
    try {
      const center = this.defenseCenter.floored();
      const radius = Math.min(24, this.defenseRadius);
      
      // Get water block ID
      const waterId = this.bot.registry.blocksByName['water']?.id;
      if (!waterId) return waterSources;
      
      // Find water blocks
      const waterPositions = this.bot.findBlocks({
        matching: waterId,
        maxDistance: radius,
        count: 10
      });
      
      for (const pos of waterPositions) {
        const block = this.bot.blockAt(pos);
        if (block) {
          waterSources.push({
            position: pos,
            distance: pos.distanceTo(center)
          });
        }
      }
    } catch (error) {
      logger.warn('Error checking for water sources:', error);
    }
    
    return waterSources;
  }

  /**
   * Find valuable items or structures to prioritize defending
   */
  findDefensePriorities() {
    // This would check for chests, workbenches, farms, etc.
    // For now, we'll focus on the bot's position as the main priority
    this.defendingTarget = {
      type: 'position',
      position: this.defenseCenter,
      priority: 10,
      name: 'Base position'
    };
    
    logger.info(`Defending position: ${this.defenseCenter}`);
  }

  /**
   * Generate patrol points around the perimeter
   */
  generatePatrolPoints() {
    try {
      logger.info('Generating patrol points');
      
      // Reset patrol points
      this.patrolPoints = [];
      
      // Create points around the perimeter
      const numPoints = 8;
      for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * 2 * Math.PI;
        const x = Math.cos(angle) * this.defenseRadius;
        const z = Math.sin(angle) * this.defenseRadius;
        
        const pos = this.defenseCenter.offset(x, 0, z);
        
        // Find the ground level
        const groundPos = this.findGroundPosition(pos);
        
        if (groundPos) {
          this.patrolPoints.push(groundPos);
        }
      }
      
      logger.info(`Generated ${this.patrolPoints.length} patrol points`);
    } catch (error) {
      logger.error('Error generating patrol points:', error);
    }
  }

  /**
   * Find the ground level at a position
   */
  findGroundPosition(pos) {
    try {
      // Start from slightly above the position to avoid being inside blocks
      const startPos = pos.offset(0, 5, 0);
      
      // Check downward until we find a solid block
      for (let y = 0; y < 20; y++) {
        const checkPos = startPos.offset(0, -y, 0);
        const blockBelow = this.bot.blockAt(checkPos.offset(0, -1, 0));
        const blockAt = this.bot.blockAt(checkPos);
        const blockAbove = this.bot.blockAt(checkPos.offset(0, 1, 0));
        
        // If there's a solid block below and air at and above the position, it's valid
        if (blockBelow && blockBelow.boundingBox === 'block' &&
            blockAt && blockAt.boundingBox === 'empty' &&
            blockAbove && blockAbove.boundingBox === 'empty') {
          return checkPos;
        }
      }
    } catch (error) {
      logger.warn('Error finding ground position:', error);
    }
    
    return null;
  }

  /**
   * Equip the best defensive gear
   */
  async equipDefensiveGear() {
    try {
      // Equip armor if available
      if (this.bot.armorManager) {
        this.bot.armorManager.equipAll();
      } else {
        // Manual armor equipping if armorManager not available
        await this.manualEquipArmor();
      }
      
      // Equip a shield in offhand if available
      const shield = this.bot.inventory.items().find(item => item.name === 'shield');
      if (shield) {
        await this.bot.equip(shield, 'off-hand');
        logger.info('Equipped shield in off-hand');
      }
      
      // Equip a weapon in main hand
      const weapons = this.bot.inventory.items().filter(item => 
        ['sword', 'axe'].some(type => item.name.includes(type))
      );
      
      if (weapons.length > 0) {
        // Sort by material quality
        const materialOrder = ['netherite', 'diamond', 'iron', 'stone', 'gold', 'wooden'];
        weapons.sort((a, b) => {
          const aIndex = materialOrder.findIndex(m => a.name.includes(m));
          const bIndex = materialOrder.findIndex(m => b.name.includes(m));
          return aIndex - bIndex; // Lower index = better material
        });
        
        // Equip the best weapon
        await this.bot.equip(weapons[0], 'hand');
        logger.info(`Equipped ${weapons[0].name} as weapon`);
      }
    } catch (error) {
      logger.error('Error equipping defensive gear:', error);
    }
  }

  /**
   * Manually equip armor pieces if the armor manager plugin isn't available
   */
  async manualEquipArmor() {
    try {
      const armorSlots = {
        helmet: 'head',
        chestplate: 'torso',
        leggings: 'legs',
        boots: 'feet'
      };
      
      // Material quality order
      const materialOrder = ['netherite', 'diamond', 'iron', 'chainmail', 'gold', 'leather'];
      
      // For each armor slot
      for (const [armorType, slot] of Object.entries(armorSlots)) {
        const armorPieces = this.bot.inventory.items().filter(item => 
          item.name.includes(armorType)
        );
        
        if (armorPieces.length > 0) {
          // Sort by material quality
          armorPieces.sort((a, b) => {
            const aIndex = materialOrder.findIndex(m => a.name.includes(m));
            const bIndex = materialOrder.findIndex(m => b.name.includes(m));
            return aIndex - bIndex; // Lower index = better material
          });
          
          // Equip the best piece
          await this.bot.equip(armorPieces[0], slot);
          logger.info(`Equipped ${armorPieces[0].name}`);
        }
      }
    } catch (error) {
      logger.warn('Error manually equipping armor:', error);
    }
  }

  /**
   * Build defensive walls
   */
  async buildDefensiveWalls() {
    try {
      if (this.hasBuiltWalls) return;
      
      this.bot.chat('Building defensive walls');
      logger.info('Building defensive wall perimeter');
      
      // Check if we have building materials
      const blocks = this.findBuildingMaterials();
      
      if (blocks.length === 0) {
        logger.warn('No building materials available for walls');
        this.bot.chat('No building materials available for defenses');
        return;
      }
      
      // Equip building blocks
      await this.bot.equip(blocks[0], 'hand');
      
      // Build at patrol points
      for (const point of this.patrolPoints) {
        // Skip if we run out of blocks
        if (blocks[0].count <= 0) {
          const newBlocks = this.findBuildingMaterials();
          if (newBlocks.length === 0) break;
          await this.bot.equip(newBlocks[0], 'hand');
        }
        
        // Build a pillar at this point
        await this.buildDefensivePillar(point);
      }
      
      this.hasBuiltWalls = true;
      this.bot.chat('Defensive fortifications complete');
    } catch (error) {
      logger.error('Error building defensive walls:', error);
    }
  }

  /**
   * Build a defensive pillar at a location
   */
  async buildDefensivePillar(position) {
    try {
      // Build a wall pillar at this position
      for (let y = 0; y < this.wallHeight; y++) {
        const placePos = position.offset(0, y, 0);
        
        // Check if there's already a block here
        const blockAt = this.bot.blockAt(placePos);
        if (blockAt && blockAt.boundingBox === 'block') {
          continue; // Skip if there's already a block
        }
        
        // Find a reference block to place against
        const refBlock = await this.findAdjacentBlock(placePos);
        if (!refBlock) continue;
        
        // Determine the face to place against
        const dx = placePos.x - refBlock.position.x;
        const dy = placePos.y - refBlock.position.y;
        const dz = placePos.z - refBlock.position.z;
        
        // Attempt to place block
        try {
          await this.bot.placeBlock(refBlock, new Vec3(dx, dy, dz));
          await new Promise(resolve => setTimeout(resolve, 250)); // Small delay between placements
        } catch (placeError) {
          logger.warn(`Failed to place block at ${placePos}: ${placeError.message}`);
        }
      }
    } catch (error) {
      logger.warn(`Error building pillar at ${position}: ${error.message}`);
    }
  }

  /**
   * Find an adjacent block to place against
   */
  async findAdjacentBlock(position) {
    const offsets = [
      { x: 0, y: -1, z: 0 }, // Below
      { x: -1, y: 0, z: 0 }, // -X
      { x: 1, y: 0, z: 0 },  // +X
      { x: 0, y: 0, z: -1 }, // -Z
      { x: 0, y: 0, z: 1 },  // +Z
    ];
    
    for (const offset of offsets) {
      const checkPos = position.offset(offset.x, offset.y, offset.z);
      const block = this.bot.blockAt(checkPos);
      
      if (block && block.boundingBox === 'block') {
        return block;
      }
    }
    
    return null;
  }

  /**
   * Find building materials in inventory
   */
  findBuildingMaterials() {
    const validMaterials = ['cobblestone', 'stone', 'dirt', 'planks'];
    
    return this.bot.inventory.items().filter(item => 
      validMaterials.some(m => item.name.includes(m))
    );
  }

  /**
   * Place torches for visibility and mob prevention
   */
  async placeTorches() {
    try {
      if (this.hasPlacedTorches) return;
      
      // Check if we have torches
      const torches = this.bot.inventory.items().find(item => item.name === 'torch');
      
      if (!torches) {
        logger.info('No torches available');
        return;
      }
      
      // Equip torches
      await this.bot.equip(torches, 'hand');
      
      logger.info('Placing torches around perimeter');
      
      // Place torches at strategic points
      for (let i = 0; i < this.patrolPoints.length; i += 2) { // Place at every other patrol point
        const point = this.patrolPoints[i];
        
        // Find a place to put the torch
        const placePos = point.offset(0, 1, 0); // Place at eye level
        
        // Find a reference block to place against
        const refBlock = await this.findAdjacentBlock(placePos);
        if (!refBlock) continue;
        
        // Determine the face to place against
        const dx = placePos.x - refBlock.position.x;
        const dy = placePos.y - refBlock.position.y;
        const dz = placePos.z - refBlock.position.z;
        
        // Attempt to place torch
        try {
          await this.bot.placeBlock(refBlock, new Vec3(dx, dy, dz));
          await new Promise(resolve => setTimeout(resolve, 500)); // Delay between placements
        } catch (placeError) {
          logger.warn(`Failed to place torch at ${placePos}: ${placeError.message}`);
        }
      }
      
      this.hasPlacedTorches = true;
      logger.info('Torches placed successfully');
    } catch (error) {
      logger.error('Error placing torches:', error);
    }
  }

  /**
   * Dig trenches for additional defense
   */
  async digTrenches() {
    try {
      if (this.hasDugTrenches) return;
      
      this.bot.chat('Digging defensive trenches');
      logger.info('Digging defensive trenches');
      
      // We'll dig a trench in a circle around our perimeter
      const center = this.defenseCenter.floored();
      const radius = this.defenseRadius - 2; // Slightly smaller than patrol radius
      
      // Equip a shovel if available
      await this.equipBestTool('shovel');
      
      // Dig points around the circle
      const steps = 16;
      for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * 2 * Math.PI;
        const x = Math.round(Math.cos(angle) * radius);
        const z = Math.round(Math.sin(angle) * radius);
        
        const digPos = center.offset(x, -1, z);
        const block = this.bot.blockAt(digPos);
        
        if (block && block.boundingBox === 'block') {
          // Dig this block
          try {
            await this.bot.dig(block);
            await new Promise(resolve => setTimeout(resolve, 250)); // Small delay between digs
          } catch (digError) {
            logger.warn(`Failed to dig block at ${digPos}: ${digError.message}`);
          }
        }
      }
      
      this.hasDugTrenches = true;
      this.bot.chat('Defensive trenches complete');
    } catch (error) {
      logger.error('Error digging trenches:', error);
    }
  }

  /**
   * Equip the best tool of a certain type
   */
  async equipBestTool(toolType) {
    try {
      const materials = ['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden'];
      
      // Look for tools of the specified type
      for (const material of materials) {
        const tool = this.bot.inventory.items().find(item => 
          item.name === `${material}_${toolType}`
        );
        
        if (tool) {
          await this.bot.equip(tool, 'hand');
          return true;
        }
      }
      
      // No specific tool found, try to use any tool
      const anyTool = this.bot.inventory.items().find(item => 
        item.name.includes('_pickaxe') || 
        item.name.includes('_axe') || 
        item.name.includes('_shovel')
      );
      
      if (anyTool) {
        await this.bot.equip(anyTool, 'hand');
        return true;
      }
      
      return false;
    } catch (error) {
      logger.warn(`Error equipping ${toolType}:`, error);
      return false;
    }
  }

  /**
   * Start patrolling the perimeter
   */
  async startPatrolling() {
    try {
      if (this.isPatrolling) return;
      
      this.isPatrolling = true;
      this.bot.chat('Starting perimeter patrol');
      
      // Begin patrol loop
      await this.patrolNextPoint();
    } catch (error) {
      logger.error('Error starting patrol:', error);
      this.isPatrolling = false;
    }
  }

  /**
   * Move to the next patrol point
   */
  async patrolNextPoint() {
    if (!this.isPatrolling || this.patrolPoints.length === 0) return;
    
    try {
      // Get the next patrol point
      const point = this.patrolPoints[this.currentPatrolIndex];
      
      // Move to the point
      logger.info(`Moving to patrol point ${this.currentPatrolIndex + 1}/${this.patrolPoints.length}`);
      
      // Check if we need to equip a weapon before patrolling
      await this.equipBestWeapon();
      
      // Navigate to the point
      await this.moveToPosition(point);
      
      // Scan for threats at this position
      await this.scanAreaFromPatrolPoint();
      
      // Move to the next point
      this.currentPatrolIndex = (this.currentPatrolIndex + 1) % this.patrolPoints.length;
      
      // Continue patrol if we're still in patrol state
      if (this.isPatrolling && this.operationalPhase === 'patrol') {
        await this.patrolNextPoint();
      }
    } catch (error) {
      logger.error('Error during patrol:', error);
      
      // Try to continue patrolling despite error
      setTimeout(() => {
        if (this.isPatrolling) {
          this.currentPatrolIndex = (this.currentPatrolIndex + 1) % this.patrolPoints.length;
          this.patrolNextPoint();
        }
      }, 2000);
    }
  }

  /**
   * Scan the area from the current patrol point
   */
  async scanAreaFromPatrolPoint() {
    try {
      // Look around in a full circle
      for (let i = 0; i < 8; i++) {
        const yaw = (i / 8) * 2 * Math.PI;
        await this.bot.look(yaw, 0, true);
        await new Promise(resolve => setTimeout(resolve, 250));
        
        // Check for hostile mobs while looking in this direction
        const hostileMobs = this.scanForHostileMobs();
        
        if (hostileMobs.length > 0) {
          const closestMob = hostileMobs[0];
          if (closestMob.distance < 16) {
            // We found a threat, change to combat phase
            this.operationalPhase = 'combat';
            this.threats = hostileMobs;
            logger.info(`Detected threat during patrol: ${closestMob.name} at distance ${closestMob.distance.toFixed(1)}`);
            this.bot.chat(`Alert! ${closestMob.name} detected at distance ${closestMob.distance.toFixed(1)}`);
            
            // Return true to indicate we found a threat
            return true;
          }
        }
      }
      
      // No immediate threats found
      return false;
    } catch (error) {
      logger.warn('Error scanning area from patrol point:', error);
      return false;
    }
  }

  /**
   * Equip the best weapon available
   */
  async equipBestWeapon() {
    try {
      // First try to equip a sword
      const swords = this.bot.inventory.items().filter(item => 
        item.name.includes('_sword')
      );
      
      if (swords.length > 0) {
        // Sort by material
        const materialOrder = ['netherite', 'diamond', 'iron', 'stone', 'gold', 'wooden'];
        swords.sort((a, b) => {
          const aIndex = materialOrder.findIndex(m => a.name.includes(m));
          const bIndex = materialOrder.findIndex(m => b.name.includes(m));
          return aIndex - bIndex; // Lower index = better material
        });
        
        await this.bot.equip(swords[0], 'hand');
        return;
      }
      
      // If no sword, try an axe
      const axes = this.bot.inventory.items().filter(item => 
        item.name.includes('_axe')
      );
      
      if (axes.length > 0) {
        const materialOrder = ['netherite', 'diamond', 'iron', 'stone', 'gold', 'wooden'];
        axes.sort((a, b) => {
          const aIndex = materialOrder.findIndex(m => a.name.includes(m));
          const bIndex = materialOrder.findIndex(m => b.name.includes(m));
          return aIndex - bIndex;
        });
        
        await this.bot.equip(axes[0], 'hand');
        return;
      }
      
      // If nothing else, try to equip any tool
      const tools = this.bot.inventory.items().filter(item => 
        item.name.includes('_pickaxe') || item.name.includes('_shovel')
      );
      
      if (tools.length > 0) {
        await this.bot.equip(tools[0], 'hand');
      }
    } catch (error) {
      logger.warn('Error equipping weapon:', error);
    }
  }

  /**
   * Move to a position with error handling
   */
  async moveToPosition(position) {
    try {
      if (this.bot.pathfinder) {
        await this.bot.pathfinder.goto(this.bot.pathfinder.createFlyGoal(
          position.x, position.y, position.z, 0.5
        ));
      } else {
        // Simple move if pathfinder not available
        this.bot.chat('No pathfinder available, using simple movement');
        
        // Look at the target
        const delta = position.minus(this.bot.entity.position);
        const yaw = Math.atan2(-delta.x, delta.z);
        await this.bot.look(yaw, 0, true);
        
        // Try to move forward
        this.bot.setControlState('forward', true);
        
        // Wait a bit
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Stop moving
        this.bot.clearControlStates();
      }
      
      return true;
    } catch (error) {
      logger.warn(`Error moving to position ${position}: ${error.message}`);
      
      // Stop moving if there was an error
      this.bot.clearControlStates();
      
      return false;
    }
  }

  /**
   * Engage a hostile entity
   */
  async engageHostile(hostileEntity) {
    try {
      if (!hostileEntity || !hostileEntity.entity) {
        logger.warn('Invalid hostile entity to engage');
        return;
      }
      
      // Use the combat behavior if available
      if (this.botManager.combatBehavior) {
        logger.info(`Engaging ${hostileEntity.name} using combat behavior`);
        
        // Attack the entity
        await this.botManager.combatBehavior.attackEntity(hostileEntity.entity);
        
        // Let the combat behavior handle the rest
        return;
      }
      
      // Fallback combat if no combat behavior available
      logger.info(`Engaging ${hostileEntity.name} using fallback combat`);
      
      // Equip a weapon
      await this.equipBestWeapon();
      
      // Move closer to the entity
      const entity = hostileEntity.entity;
      const dist = this.bot.entity.position.distanceTo(entity.position);
      
      if (dist > 3) {
        await this.moveToPosition(entity.position);
      }
      
      // Look at the entity
      await this.bot.lookAt(entity.position.offset(0, entity.height * 0.8, 0));
      
      // Attack!
      await this.bot.attack(entity);
      
    } catch (error) {
      logger.error(`Error engaging hostile entity: ${error.message}`);
    }
  }

  /**
   * Main update function for the defense state
   */
  update() {
    // Skip if we're not active
    if (!this.active) return;
    
    const now = Date.now();
    
    // Provide progress updates periodically
    if (now - this.lastProgressUpdate > 10000) { // Every 10 seconds
      this.updateProgressReport();
      this.lastProgressUpdate = now;
    }
    
    // Handle based on current operational phase
    switch (this.operationalPhase) {
      case 'setup':
        // Setup phase - defensive position analysis
        if (this.defenseSetupComplete) {
          // Move to fortify phase once setup is complete
          this.operationalPhase = 'fortify';
        }
        break;
        
      case 'fortify':
        // Fortify phase - build defenses
        this.handleFortifyPhase();
        break;
        
      case 'patrol':
        // Patrol phase - patrol the perimeter
        this.handlePatrolPhase();
        break;
        
      case 'combat':
        // Combat phase - engage threats
        this.handleCombatPhase();
        break;
    }
    
    // Scan for threats regardless of phase
    if (now - this.lastThreatScan > 5000) { // Every 5 seconds
      this.scanForThreats();
      this.lastThreatScan = now;
    }
  }

  /**
   * Handle the fortify phase
   */
  async handleFortifyPhase() {
    try {
      if (!this.hasBuiltWalls) {
        await this.buildDefensiveWalls();
      } else if (!this.hasDugTrenches) {
        await this.digTrenches();
      } else if (!this.hasPlacedTorches) {
        await this.placeTorches();
      } else {
        // All fortifications complete, move to patrol phase
        this.operationalPhase = 'patrol';
        this.bot.chat('Fortifications complete, beginning patrol');
        
        // Start patrolling
        this.startPatrolling();
      }
    } catch (error) {
      logger.error('Error in fortify phase:', error);
    }
  }

  /**
   * Handle the patrol phase
   */
  async handlePatrolPhase() {
    try {
      // Start patrolling if not already
      if (!this.isPatrolling) {
        this.startPatrolling();
      }
      
      // The patrolling is handled by the patrol loop itself
    } catch (error) {
      logger.error('Error in patrol phase:', error);
    }
  }

  /**
   * Handle the combat phase
   */
  async handleCombatPhase() {
    try {
      // If we have threats, engage them
      if (this.threats.length > 0) {
        const target = this.threats[0];
        
        // Check if the entity still exists
        if (this.bot.entities[target.entity.id]) {
          // Engage the target
          await this.engageHostile(target);
        } else {
          // Target is gone, remove it from threats
          this.threats.shift();
        }
      } else {
        // No more threats, return to patrol
        this.operationalPhase = 'patrol';
        this.bot.chat('Threats eliminated, resuming patrol');
        
        // Start patrolling
        this.startPatrolling();
      }
    } catch (error) {
      logger.error('Error in combat phase:', error);
    }
  }

  /**
   * Scan for threats
   */
  scanForThreats() {
    try {
      const hostileMobs = this.scanForHostileMobs();
      
      // Update our threats list
      this.threats = hostileMobs.filter(mob => mob.distance < 24);
      
      // If we find threats and we're in patrol mode, switch to combat
      if (this.threats.length > 0 && this.operationalPhase === 'patrol') {
        const closestThreat = this.threats[0];
        logger.info(`Detected threat: ${closestThreat.name} at distance ${closestThreat.distance.toFixed(1)}`);
        this.bot.chat(`Alert! ${closestThreat.name} detected at distance ${closestThreat.distance.toFixed(1)}`);
        
        // Switch to combat mode
        this.operationalPhase = 'combat';
        this.isPatrolling = false;
      }
    } catch (error) {
      logger.warn('Error scanning for threats:', error);
    }
  }

  /**
   * Update progress report
   */
  updateProgressReport() {
    try {
      const statusMessages = {
        setup: 'Analyzing defense area',
        fortify: `Building defenses (walls: ${this.hasBuiltWalls ? 'done' : 'pending'}, trenches: ${this.hasDugTrenches ? 'done' : 'pending'}, torches: ${this.hasPlacedTorches ? 'done' : 'pending'})`,
        patrol: `Patrolling perimeter (point ${this.currentPatrolIndex + 1}/${this.patrolPoints.length})`,
        combat: `Engaging threats (${this.threats.length} remaining)`
      };
      
      logger.info(`Defense status: ${statusMessages[this.operationalPhase]}`);
    } catch (error) {
      logger.warn('Error updating progress report:', error);
    }
  }

  /**
   * Determine if we should transition to another state
   */
  shouldTransition(nextState) {
    // Don't transition if we just entered the state
    if (this.defenseStartTime && Date.now() - this.defenseStartTime < 30000) {
      return false;
    }
    
    switch (nextState) {
      case 'idle':
        // Transition to idle if defense is complete
        return this.defenseComplete;
        
      case 'combat':
        // If we're not in combat phase but there are threats detected by combat behavior
        return this.operationalPhase !== 'combat' && 
               this.botManager.combatBehavior && 
               this.botManager.combatBehavior.scanForThreats().length > 0;
        
      case 'follow':
        // Always follow owner if requested
        return this.botManager.owner !== null;
        
      default:
        return false;
    }
  }
}

module.exports = DefenseState;