/**
 * Build State for Minecraft Bot
 * 
 * In this state, the bot will build structures such as houses,
 * walls, towers, etc. using materials in its inventory.
 */

// Import our custom StateBehavior base class
const StateBehavior = require('../bot/stateBehavior');
const Vec3 = require('vec3');
const logger = require('../bot/logger');

class BuildState extends StateBehavior {
  constructor(bot, botManager) {
    super(bot, 'build');
    this.botManager = botManager;
    
    this.timeInState = 0;
    this.buildPlan = [];
    this.currentBlock = null;
    this.buildingMaterial = null;
    this.structureType = null;
    this.buildStartPosition = null;
    this.buildComplete = false;
    this.blocksPlaced = 0;
    this.buildStartTime = 0;
    this.lastProgressUpdate = 0;
    this.lastBuildAttempt = 0;
    this.buildAttemptTimeout = 10000; // 10 seconds timeout for placing a block
    this.stuckCount = 0;
  }

  onStateEntered() {
    this.timeInState = 0;
    this.buildPlan = [];
    this.currentBlock = null;
    this.buildComplete = false;
    this.blocksPlaced = 0;
    this.buildStartTime = Date.now();
    this.lastProgressUpdate = 0;
    this.lastBuildAttempt = 0;
    this.stuckCount = 0;
    
    logger.info('Entered build state');
    
    // Get the structure type from building behavior if available
    if (this.botManager.buildingBehavior && this.botManager.buildingBehavior.structureType) {
      this.structureType = this.botManager.buildingBehavior.structureType;
      this.buildingMaterial = this.botManager.buildingBehavior.buildingMaterial;
      
      logger.info(`Building ${this.structureType} with ${this.buildingMaterial || 'available materials'}`);
      this.bot.chat(`Starting to build a ${this.structureType}.`);
      
      // Initialize the build process
      this.initializeBuild();
    } else {
      // If no specific build was set, choose something simple
      this.structureType = 'shelter';
      this.buildingMaterial = null;
      
      logger.info('No specific build requested, building a simple shelter');
      this.bot.chat('Building a simple shelter.');
      
      // Initialize with a default build
      this.initializeBuild();
    }
  }

  onStateExited() {
    logger.info('Exited build state');
    
    // Report building results
    if (this.buildComplete) {
      const buildingTime = (Date.now() - this.buildStartTime) / 1000; // in seconds
      logger.info(`Completed building ${this.structureType}. Placed ${this.blocksPlaced} blocks in ${buildingTime.toFixed(0)} seconds`);
      this.bot.chat(`Finished building the ${this.structureType}!`);
    } else {
      logger.info('Building process was interrupted');
      this.bot.chat('Building process was interrupted.');
    }
    
    // Clean up building state
    this.buildPlan = [];
    this.currentBlock = null;
    
    // Stop any pathfinding
    if (this.bot.pathfinder && this.bot.pathfinder.isMoving()) {
      this.bot.pathfinder.setGoal(null);
    }
    
    // Stop any movement
    this.bot.clearControlStates();
  }

  /**
   * Initialize the building process
   */
  async initializeBuild() {
    // If building behavior is available, use it
    if (this.botManager.buildingBehavior) {
      try {
        // Try to generate a build plan using the building behavior
        await this.botManager.buildingBehavior.build(this.structureType, this.buildingMaterial);
        
        // Get the build plan
        this.buildPlan = this.botManager.buildingBehavior.buildPlan || [];
        this.buildStartPosition = this.botManager.buildingBehavior.buildStartPosition;
        
        if (this.buildPlan.length > 0) {
          logger.info(`Generated build plan with ${this.buildPlan.length} blocks`);
          this.bot.chat(`I'll build a ${this.structureType} with ${this.buildPlan.length} blocks.`);
          
          // Start building
          this.processBuildPlan();
          return;
        }
      } catch (error) {
        logger.error(`Error initializing build: ${error.message}`);
      }
    }
    
    // If we get here, either there's no building behavior or it failed
    // Create a simple default build plan for a shelter
    this.createDefaultShelterPlan();
  }

  /**
   * Create a default simple shelter plan when no other plan is available
   */
  createDefaultShelterPlan() {
    logger.info('Creating default shelter plan');
    
    // Find a suitable flat area
    this.findBuildLocation()
      .then(location => {
        if (!location) {
          logger.warn('Could not find suitable build location');
          this.bot.chat('Could not find a good place to build.');
          this.buildComplete = true;
          return;
        }
        
        this.buildStartPosition = location;
        
        // Create a simple 5x5 shelter with a door
        this.createSimpleShelterPlan(location);
        
        // Start building
        this.processBuildPlan();
      })
      .catch(error => {
        logger.error(`Error creating default shelter: ${error.message}`);
        this.bot.chat('Error planning the shelter.');
        this.buildComplete = true;
      });
  }

  /**
   * Find a suitable location for building
   */
  async findBuildLocation() {
    logger.info('Searching for a suitable build location');
    
    // If building behavior is available, use its method
    if (this.botManager.buildingBehavior && this.botManager.buildingBehavior.findBuildLocation) {
      try {
        const location = await this.botManager.buildingBehavior.findBuildLocation(this.structureType);
        if (location) {
          return location;
        }
      } catch (error) {
        logger.warn(`Error using buildingBehavior.findBuildLocation: ${error.message}`);
      }
    }
    
    // Fallback: find a flat area near the bot
    return this.findFlatArea();
  }

  /**
   * Find a flat area suitable for building
   */
  async findFlatArea() {
    const botPos = this.bot.entity.position.clone();
    
    // Check in a spiral pattern starting from the bot
    const searchRadius = 20;
    const spiralPoints = this.generateSpiralPoints(searchRadius);
    
    for (const point of spiralPoints) {
      const x = Math.floor(botPos.x + point.x);
      const z = Math.floor(botPos.z + point.z);
      
      // Find the surface block at this x,z
      const surfaceY = await this.findSurfaceBlock(x, z);
      if (surfaceY === null) continue;
      
      // Check if this area is flat enough for our shelter
      const isFlatEnough = await this.checkIfAreaIsFlat(x, surfaceY, z, 5, 5);
      if (isFlatEnough) {
        logger.info(`Found suitable flat area at ${x}, ${surfaceY}, ${z}`);
        return new Vec3(x, surfaceY, z);
      }
    }
    
    logger.warn('Could not find a suitable flat area');
    return null;
  }

  /**
   * Generate points in a spiral pattern for searching
   */
  generateSpiralPoints(radius) {
    const points = [];
    let x = 0, z = 0;
    let dx = 0, dz = -1;
    
    for (let i = 0; i < Math.pow(radius * 2, 2); i++) {
      if ((-radius <= x && x <= radius) && (-radius <= z && z <= radius)) {
        points.push({ x, z });
      }
      
      if (x === z || (x < 0 && x === -z) || (x > 0 && x === 1 - z)) {
        [dx, dz] = [-dz, dx];
      }
      
      x += dx;
      z += dz;
    }
    
    return points;
  }

  /**
   * Find the Y coordinate of the surface block at given X,Z
   */
  async findSurfaceBlock(x, z) {
    // Start from a reasonable height and move down
    const startY = Math.min(this.bot.entity.position.y + 20, 256);
    
    for (let y = startY; y > 0; y--) {
      const block = this.bot.blockAt(new Vec3(x, y, z));
      const blockBelow = this.bot.blockAt(new Vec3(x, y - 1, z));
      
      // Skip if we can't see these blocks
      if (!block || !blockBelow) continue;
      
      // If current block is air and block below is solid, we found surface
      if (block.name === 'air' && blockBelow.solid) {
        // Make sure it's not a dangerous block (lava, cactus, etc.)
        if (!this.isDangerousBlock(blockBelow)) {
          return y - 1; // Return the Y of the solid block
        }
      }
    }
    
    return null;
  }

  /**
   * Check if a block is dangerous to build on
   */
  isDangerousBlock(block) {
    const dangerousBlocks = [
      'lava', 'water', 'cactus', 'fire', 'magma_block'
    ];
    
    return dangerousBlocks.includes(block.name);
  }

  /**
   * Check if an area is flat enough for building
   */
  async checkIfAreaIsFlat(centerX, centerY, centerZ, width, length) {
    const heightVariance = 1; // Allow for this much height variance
    
    // Check each position in the area
    for (let x = centerX - Math.floor(width / 2); x <= centerX + Math.floor(width / 2); x++) {
      for (let z = centerZ - Math.floor(length / 2); z <= centerZ + Math.floor(length / 2); z++) {
        const y = await this.findSurfaceBlock(x, z);
        
        // If we couldn't find surface or height varies too much, area is not flat
        if (y === null || Math.abs(y - centerY) > heightVariance) {
          return false;
        }
      }
    }
    
    return true;
  }

  /**
   * Create a simple shelter plan at the specified location
   */
  createSimpleShelterPlan(location) {
    const x = Math.floor(location.x);
    const y = Math.floor(location.y);
    const z = Math.floor(location.z);
    
    this.buildPlan = [];
    
    // Create a 5x5 shelter with walls and a door
    // First, the floor
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        this.buildPlan.push({
          position: new Vec3(x + dx, y, z + dz),
          type: 'floor'
        });
      }
    }
    
    // Walls
    for (let height = 1; height <= 3; height++) {
      // Front wall with door
      for (let dx = -2; dx <= 2; dx++) {
        // Skip middle block at ground level for the door
        if (dx === 0 && height <= 2) continue;
        
        this.buildPlan.push({
          position: new Vec3(x + dx, y + height, z - 2),
          type: 'wall'
        });
      }
      
      // Back wall
      for (let dx = -2; dx <= 2; dx++) {
        this.buildPlan.push({
          position: new Vec3(x + dx, y + height, z + 2),
          type: 'wall'
        });
      }
      
      // Left wall
      for (let dz = -1; dz <= 1; dz++) {
        this.buildPlan.push({
          position: new Vec3(x - 2, y + height, z + dz),
          type: 'wall'
        });
      }
      
      // Right wall
      for (let dz = -1; dz <= 1; dz++) {
        this.buildPlan.push({
          position: new Vec3(x + 2, y + height, z + dz),
          type: 'wall'
        });
      }
    }
    
    // Roof
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        this.buildPlan.push({
          position: new Vec3(x + dx, y + 4, z + dz),
          type: 'roof'
        });
      }
    }
    
    // Shuffle the build plan to avoid building in strict layers
    // This makes it easier to reach blocks and place them
    this.buildPlan = this.shuffleBuildPlan(this.buildPlan);
    
    logger.info(`Created simple shelter plan with ${this.buildPlan.length} blocks`);
    this.bot.chat(`Planning a simple shelter with ${this.buildPlan.length} blocks.`);
  }

  /**
   * Shuffle the build plan but keep floor blocks first
   */
  shuffleBuildPlan(plan) {
    // Extract floor blocks
    const floorBlocks = plan.filter(block => block.type === 'floor');
    const otherBlocks = plan.filter(block => block.type !== 'floor');
    
    // Shuffle the non-floor blocks
    for (let i = otherBlocks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [otherBlocks[i], otherBlocks[j]] = [otherBlocks[j], otherBlocks[i]];
    }
    
    // Return floor blocks first, then the shuffled blocks
    return [...floorBlocks, ...otherBlocks];
  }

  /**
   * Process the build plan and build the structure
   */
  processBuildPlan() {
    if (this.buildPlan.length === 0) {
      logger.info('Build plan is empty');
      this.buildComplete = true;
      return;
    }
    
    // Start processing the build plan
    this.placeNextBlock();
  }

  /**
   * Place the next block in the build plan
   */
  placeNextBlock() {
    // If there are no more blocks to place, we're done
    if (this.buildPlan.length === 0) {
      logger.info('Finished building, no more blocks in plan');
      this.buildComplete = true;
      return;
    }
    
    // Get the next block from the plan
    this.currentBlock = this.buildPlan[0];
    
    // Check if the block already has something there
    const blockAtPosition = this.bot.blockAt(this.currentBlock.position);
    
    // Skip if the position already has a non-air block (except for replace operations)
    if (blockAtPosition && blockAtPosition.name !== 'air' && !this.currentBlock.replace) {
      logger.debug(`Position ${this.currentBlock.position} already has ${blockAtPosition.name}, skipping`);
      this.buildPlan.shift();
      this.placeNextBlock();
      return;
    }
    
    // Try to place the block
    this.tryToPlaceBlock();
  }

  /**
   * Try to place the current block
   */
  async tryToPlaceBlock() {
    try {
      // Reset the last build attempt time
      this.lastBuildAttempt = Date.now();
      
      // Check if we have a suitable block to place
      const block = await this.selectBuildingBlock(this.currentBlock.type);
      
      if (!block) {
        logger.warn(`No suitable building blocks for ${this.currentBlock.type}`);
        this.bot.chat('I need more building materials.');
        
        // Skip this block and continue
        this.buildPlan.shift();
        this.placeNextBlock();
        return;
      }
      
      // Try to find a position to place from
      const placementInfo = await this.findPlacementPosition();
      
      if (!placementInfo) {
        logger.warn(`Could not find a position to place block at ${this.currentBlock.position}`);
        
        // Move this block to the end of the plan to try it later
        this.buildPlan.push(this.buildPlan.shift());
        
        // Increment stuck counter
        this.stuckCount++;
        
        // If we're stuck too many times, skip this block
        if (this.stuckCount > 5) {
          logger.warn(`Skipping difficult block at ${this.currentBlock.position} after multiple attempts`);
          this.stuckCount = 0;
        } else {
          // Try another block
          this.placeNextBlock();
        }
        
        return;
      }
      
      // Move to the placement position
      await this.moveToPosition(placementInfo.position);
      
      // Look at the face of the reference block
      await this.bot.lookAt(placementInfo.facePosition);
      
      // Place the block
      await this.bot.placeBlock(placementInfo.referenceBlock, placementInfo.faceVector);
      
      // Block successfully placed
      this.blocksPlaced++;
      logger.debug(`Placed block at ${this.currentBlock.position}`);
      
      // Remove this block from the plan
      this.buildPlan.shift();
      this.stuckCount = 0;
      
      // Continue with the next block
      this.placeNextBlock();
    } catch (error) {
      logger.warn(`Error placing block: ${error.message}`);
      
      // Move this block to the end of the plan to try it later
      this.buildPlan.push(this.buildPlan.shift());
      
      // Try another block
      this.placeNextBlock();
    }
  }

  /**
   * Select an appropriate building block based on block type
   */
  async selectBuildingBlock(blockType) {
    // If building behavior is available, use its method
    if (this.botManager.buildingBehavior && this.botManager.buildingBehavior.selectBuildingMaterials) {
      try {
        const material = await this.botManager.buildingBehavior.selectBuildingMaterials(
          this.buildingMaterial, 1
        );
        if (material) return material;
      } catch (error) {
        logger.warn(`Error using buildingBehavior.selectBuildingMaterials: ${error.message}`);
      }
    }
    
    // Fallback: select materials from inventory
    const items = this.bot.inventory.items();
    
    // Define block preferences based on the block type
    let preferredBlocks = [];
    
    switch (blockType) {
      case 'floor':
        preferredBlocks = [
          'cobblestone', 'stone', 'planks', 'dirt', 'sand', 'sandstone',
          'oak_planks', 'spruce_planks', 'birch_planks',
          'jungle_planks', 'acacia_planks', 'dark_oak_planks'
        ];
        break;
      case 'wall':
        preferredBlocks = [
          'cobblestone', 'stone', 'planks', 'oak_planks', 'spruce_planks', 
          'birch_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks',
          'oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log'
        ];
        break;
      case 'roof':
        preferredBlocks = [
          'cobblestone', 'stone', 'planks', 'oak_planks', 'spruce_planks',
          'birch_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks',
          'oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log'
        ];
        break;
      default:
        // For any other type, use any solid block
        preferredBlocks = [
          'cobblestone', 'stone', 'dirt', 'planks',
          'oak_planks', 'spruce_planks', 'birch_planks',
          'jungle_planks', 'acacia_planks', 'dark_oak_planks'
        ];
    }
    
    // Try to find a preferred block in inventory
    for (const blockName of preferredBlocks) {
      const blockItem = items.find(item => 
        item.name === blockName || 
        item.name.includes(blockName)
      );
      
      if (blockItem) {
        // Equip the block
        await this.bot.equip(blockItem, 'hand');
        return blockItem;
      }
    }
    
    // If no preferred blocks, try any placeable block
    const placeable = items.filter(item => {
      // Simple heuristic for placeable blocks
      return item.name.includes('_planks') || 
             item.name.includes('_log') ||
             item.name.includes('stone') ||
             item.name.includes('dirt') ||
             item.name.includes('sand') ||
             item.name === 'cobblestone' ||
             item.name === 'stone' ||
             item.name === 'dirt' ||
             item.name === 'sand' ||
             item.name === 'gravel';
    });
    
    if (placeable.length > 0) {
      await this.bot.equip(placeable[0], 'hand');
      return placeable[0];
    }
    
    // No suitable blocks found
    return null;
  }

  /**
   * Find a position from which to place the current block
   */
  async findPlacementPosition() {
    // Define possible offsets to place from
    const offsets = [
      { x: 0, y: 0, z: 1 },  // North
      { x: 1, y: 0, z: 0 },  // East
      { x: 0, y: 0, z: -1 }, // South
      { x: -1, y: 0, z: 0 }, // West
      { x: 0, y: 1, z: 0 },  // Above
      { x: 0, y: -1, z: 0 }  // Below
    ];
    
    // Shuffle the offsets for more natural building
    offsets.sort(() => Math.random() - 0.5);
    
    const targetPos = this.currentBlock.position;
    
    // Check each offset to find a valid position to place from
    for (const offset of offsets) {
      const referencePos = targetPos.offset(offset.x, offset.y, offset.z);
      
      // Make sure there's a solid block to place against
      const referenceBlock = this.bot.blockAt(referencePos);
      if (!referenceBlock || !referenceBlock.solid) continue;
      
      // Check if this position is accessible (has air nearby)
      // We'll check a few positions around the reference block
      const accessOffsets = [
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 0, z: -1 },
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 }
      ];
      
      for (const accessOffset of accessOffsets) {
        // Skip the offset that would point toward the target block
        if (accessOffset.x === -offset.x && 
            accessOffset.y === -offset.y && 
            accessOffset.z === -offset.z) {
          continue;
        }
        
        const standPos = referencePos.offset(
          accessOffset.x, 
          accessOffset.y, 
          accessOffset.z
        );
        
        // Check if there are two air blocks to stand and have head space
        const footBlock = this.bot.blockAt(standPos);
        const headBlock = this.bot.blockAt(standPos.offset(0, 1, 0));
        
        if (footBlock && headBlock && 
            footBlock.name === 'air' && 
            headBlock.name === 'air') {
          
          // Make sure we can pathfind to this position
          if (this.canPathfindTo(standPos)) {
            // This is a valid position to place from
            return {
              position: standPos,
              referenceBlock: referenceBlock,
              faceVector: new Vec3(-offset.x, -offset.y, -offset.z),
              facePosition: targetPos
            };
          }
        }
      }
    }
    
    // No valid placement position found
    return null;
  }

  /**
   * Check if we can pathfind to a position
   */
  canPathfindTo(position) {
    // For now, assume we can pathfind to any position that's close enough
    // A more sophisticated solution would use the actual pathfinder
    const maxDistance = 20;
    return this.bot.entity.position.distanceTo(position) < maxDistance;
  }

  /**
   * Move to a position
   */
  async moveToPosition(position) {
    // If pathfinder is available, use it
    if (this.bot.pathfinder) {
      const pathfinder = require('mineflayer-pathfinder');
      const { goals } = pathfinder;
      
      const goal = new goals.GoalBlock(
        position.x,
        position.y,
        position.z
      );
      
      this.bot.pathfinder.setGoal(goal);
      
      // Wait until we're there or timeout
      const startTime = Date.now();
      while (this.bot.pathfinder.isMoving() && Date.now() - startTime < 10000) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      if (this.bot.pathfinder.isMoving()) {
        this.bot.pathfinder.setGoal(null);
        throw new Error('Pathfinding to build position timed out');
      }
    } else {
      // Simple movement if pathfinder not available
      this.bot.lookAt(position);
      this.bot.setControlState('forward', true);
      
      // Wait a bit and then stop
      await new Promise(resolve => setTimeout(resolve, 1000));
      this.bot.clearControlStates();
    }
  }

  /**
   * Main update function for the build state
   */
  update() {
    this.timeInState += 1;
    
    // Check for safety periodically
    this.checkSafetyConditions();
    
    // Provide progress updates
    const now = Date.now();
    if (now - this.lastProgressUpdate > 30000) { // Every 30 seconds
      this.lastProgressUpdate = now;
      this.updateBuildProgress();
    }
    
    // If building is complete, transition away
    if (this.buildComplete) {
      return;
    }
    
    // Check if we've been trying to place the same block for too long
    if (this.lastBuildAttempt > 0 && now - this.lastBuildAttempt > this.buildAttemptTimeout) {
      logger.warn('Taking too long to place a block, trying another');
      
      // Move this block to the end of the plan
      if (this.buildPlan.length > 0) {
        this.buildPlan.push(this.buildPlan.shift());
      }
      
      // Reset attempt time
      this.lastBuildAttempt = 0;
      
      // Try another block
      this.placeNextBlock();
    }
    
    // If we've been in this state too long, timeout
    if (this.timeInState > 6000) { // About 5 minutes at 20 tps
      logger.warn('Build state has timed out');
      this.bot.chat('Taking too long to build, moving on.');
      this.buildComplete = true;
    }
  }

  /**
   * Check safety conditions during building
   */
  checkSafetyConditions() {
    // Check for nearby hostile mobs
    const hostileMobs = this.findNearbyHostileMobs();
    if (hostileMobs.length > 0 && hostileMobs[0].distance < 8) {
      logger.warn(`Hostile mob detected during building: ${hostileMobs[0].name}`);
      // We'll let the state machine's shouldTransition method handle the actual state change
    }
    
    // Check for nighttime
    if (this.isNightTime() && !this.isInShelter()) {
      logger.warn('Night time and not in shelter, may need to pause building');
    }
  }

  /**
   * Check if it's night time
   */
  isNightTime() {
    // Time is based on ticks, one day is 24000 ticks
    // Night is approximately between 13000 and 23000
    const time = this.bot.time.timeOfDay;
    return time >= 13000 && time <= 23000;
  }

  /**
   * Check if the bot is in a shelter (has a block above)
   */
  isInShelter() {
    const pos = this.bot.entity.position;
    for (let y = Math.floor(pos.y) + 2; y <= Math.floor(pos.y) + 4; y++) {
      const block = this.bot.blockAt(new Vec3(Math.floor(pos.x), y, Math.floor(pos.z)));
      if (block && block.solid) {
        return true;
      }
    }
    return false;
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
        if (distance < 16) { // Only consider mobs within a reasonable distance
          hostileMobs.push({
            entity: entity,
            name: entity.name,
            distance: distance
          });
        }
      }
    }
    
    // Sort by distance
    hostileMobs.sort((a, b) => a.distance - b.distance);
    
    return hostileMobs;
  }

  /**
   * Update building progress information
   */
  updateBuildProgress() {
    // Calculate how long we've been building
    const buildingTime = (Date.now() - this.buildStartTime) / 1000; // in seconds
    
    // Report progress
    const totalBlocks = this.blocksPlaced + this.buildPlan.length;
    const percentComplete = Math.floor((this.blocksPlaced / totalBlocks) * 100);
    
    logger.info(`Building progress: ${this.blocksPlaced}/${totalBlocks} blocks (${percentComplete}%) after ${buildingTime.toFixed(0)} seconds`);
    this.bot.chat(`Building progress: ${percentComplete}% complete.`);
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
      default:
        return false;
    }
  }

  /**
   * Check if we should transition to combat state
   */
  shouldTransitionToCombat() {
    // If combat is disabled, never transition to combat
    if (!this.botManager.config.combat.enabled) return false;
    
    // Check for hostile mobs very close to us
    const hostileMobs = this.findNearbyHostileMobs();
    if (hostileMobs.length > 0 && hostileMobs[0].distance < 5) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if we should transition to idle state
   */
  shouldTransitionToIdle() {
    // If building is complete, go idle
    if (this.buildComplete) {
      return true;
    }
    
    // If it's night and unsafe, go idle to find shelter
    if (this.isNightTime() && !this.isInShelter() && this.botManager.config.survival.avoidNightTime) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if we should transition to gather state
   */
  shouldTransitionToGather() {
    // If we're out of building materials, go gather
    if (this.buildPlan.length > 0 && this.selectBuildingBlock(this.currentBlock.type) === null) {
      return true;
    }
    
    return false;
  }
}

module.exports = BuildState;