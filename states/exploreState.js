/**
 * Explore State for Minecraft Bot
 * 
 * In this state, the bot will explore the world, mapping new terrain
 * and discovering resources and points of interest.
 */

// Import our custom StateBehavior base class
const StateBehavior = require('../bot/stateBehavior');
const Vec3 = require('vec3');
const logger = require('../bot/logger');

class ExploreState extends StateBehavior {
  constructor(bot, botManager) {
    super(bot, 'explore');
    this.botManager = botManager;
    
    this.timeInState = 0;
    this.explorationStartTime = 0;
    this.lastProgressUpdate = 0;
    this.explorationComplete = false;
    this.currentTask = null;
    this.explorationRadius = 100; // Default exploration radius
    this.targetPosition = null;
    this.visitedPositions = new Set();
    this.pointsOfInterest = [];
    this.lastPathfindingFailure = 0;
    this.pathfindingFailureCount = 0;
    this.stuckCheckInterval = 5000; // How often to check if stuck (ms)
    this.lastStuckCheck = 0;
    this.lastPosition = null;
    this.stuckCount = 0;
    this.biomeTarget = null;
    this.explorePattern = 'spiral'; // Default pattern: spiral, random, or directed
    this.maxExplorationTime = 10 * 60 * 20; // 10 minutes at 20 ticks per second
  }

  onStateEntered() {
    this.timeInState = 0;
    this.explorationStartTime = Date.now();
    this.lastProgressUpdate = 0;
    this.explorationComplete = false;
    this.visitedPositions = new Set();
    this.pointsOfInterest = [];
    this.lastPathfindingFailure = 0;
    this.pathfindingFailureCount = 0;
    this.lastStuckCheck = 0;
    this.lastPosition = this.bot.entity.position.clone();
    this.stuckCount = 0;
    
    logger.info('Entered explore state');
    
    // If exploration behavior is available, get settings from it
    if (this.botManager.explorationBehavior) {
      this.explorationRadius = this.botManager.explorationBehavior.explorationRadius || this.explorationRadius;
      this.biomeTarget = this.botManager.explorationBehavior.targetBiome || null;
      this.explorePattern = this.botManager.explorationBehavior.explorationPattern || this.explorePattern;
    }
    
    this.bot.chat(`Starting exploration with radius ${this.explorationRadius} blocks.`);
    
    // Initialize exploration based on settings
    this.initializeExploration();
  }

  onStateExited() {
    logger.info('Exited explore state');
    
    // Report exploration results
    this.reportExplorationResults();
    
    // Clean up state
    this.targetPosition = null;
    
    // Stop pathfinding
    if (this.bot.pathfinder && this.bot.pathfinder.isMoving()) {
      this.bot.pathfinder.setGoal(null);
    }
    
    // Stop any movement
    this.bot.clearControlStates();
  }

  /**
   * Initialize the exploration process
   */
  initializeExploration() {
    // If we have a target biome
    if (this.biomeTarget) {
      logger.info(`Exploring to find ${this.biomeTarget} biome`);
      this.bot.chat(`Looking for ${this.biomeTarget} biome.`);
      this.currentTask = 'find_biome';
      this.exploreBiome();
      return;
    }
    
    // Otherwise explore based on pattern
    this.currentTask = 'explore';
    
    switch (this.explorePattern) {
      case 'spiral':
        this.beginSpiralExploration();
        break;
      case 'random':
        this.beginRandomExploration();
        break;
      case 'directed':
        this.beginDirectedExploration();
        break;
      default:
        this.beginSpiralExploration();
    }
  }

  /**
   * Begin a spiral exploration pattern
   */
  beginSpiralExploration() {
    logger.info('Beginning spiral exploration pattern');
    this.bot.chat('Exploring in a spiral pattern.');
    
    // Generate spiral points
    const spiralPoints = this.generateSpiralPoints(this.explorationRadius);
    
    // Convert to 3D positions with appropriate Y coordinates
    const startPosition = this.bot.entity.position.clone();
    
    // Process points to create target positions
    this.processExplorationPoints(spiralPoints, startPosition);
  }

  /**
   * Generate points in a spiral pattern
   */
  generateSpiralPoints(radius) {
    const points = [];
    let x = 0, z = 0;
    let dx = 0, dz = -1;
    const step = 16; // Distance between exploration points
    
    // Only add every Nth point to avoid too dense exploration
    for (let i = 0; i < Math.pow(radius / 8, 2); i++) {
      // Only use points within the exploration radius
      if (Math.sqrt(x*x + z*z) * step <= radius) {
        points.push({ x: x * step, z: z * step });
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
   * Begin a random exploration pattern
   */
  beginRandomExploration() {
    logger.info('Beginning random exploration pattern');
    this.bot.chat('Exploring randomly.');
    
    // Generate random points within the radius
    const randomPoints = this.generateRandomPoints(this.explorationRadius, 20);
    
    // Process the points
    const startPosition = this.bot.entity.position.clone();
    this.processExplorationPoints(randomPoints, startPosition);
  }

  /**
   * Generate random points within a radius
   */
  generateRandomPoints(radius, count) {
    const points = [];
    
    for (let i = 0; i < count; i++) {
      // Generate points in a circle
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.random() * radius;
      
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      
      points.push({ x, z });
    }
    
    return points;
  }

  /**
   * Begin a directed exploration pattern (toward a specific direction)
   */
  beginDirectedExploration() {
    logger.info('Beginning directed exploration pattern');
    this.bot.chat('Exploring in a specific direction.');
    
    // Determine direction based on bot's facing
    const yaw = this.bot.entity.yaw;
    const dirX = -Math.sin(yaw);
    const dirZ = -Math.cos(yaw);
    
    // Generate points along this direction
    const directedPoints = [];
    const startPosition = this.bot.entity.position.clone();
    
    // Add points at increasing distances
    for (let dist = 16; dist <= this.explorationRadius; dist += 16) {
      directedPoints.push({ 
        x: dirX * dist, 
        z: dirZ * dist 
      });
    }
    
    // Add some randomness to either side of the direct path
    for (let dist = 32; dist <= this.explorationRadius; dist += 32) {
      // Add points to the sides
      const perpX = -dirZ;
      const perpZ = dirX;
      
      for (let side = -1; side <= 1; side += 2) {
        for (let offset = 16; offset <= 48; offset += 16) {
          directedPoints.push({ 
            x: dirX * dist + perpX * offset * side, 
            z: dirZ * dist + perpZ * offset * side 
          });
        }
      }
    }
    
    // Process the points
    this.processExplorationPoints(directedPoints, startPosition);
  }

  /**
   * Process exploration points to create target positions
   */
  processExplorationPoints(points, startPosition) {
    // Start with empty array for target positions
    const targetPositions = [];
    
    // Process each point
    for (const point of points) {
      const targetX = Math.floor(startPosition.x + point.x);
      const targetZ = Math.floor(startPosition.z + point.z);
      
      // Skip positions that are too similar to ones we've already added
      let tooClose = false;
      for (const existingTarget of targetPositions) {
        const dx = existingTarget.x - targetX;
        const dz = existingTarget.z - targetZ;
        if (Math.sqrt(dx*dx + dz*dz) < 16) {
          tooClose = true;
          break;
        }
      }
      
      if (tooClose) continue;
      
      // Create a unique key for this position
      const posKey = `${Math.floor(targetX/16)},${Math.floor(targetZ/16)}`;
      
      // Skip if we've already visited this chunk
      if (this.visitedPositions.has(posKey)) continue;
      
      targetPositions.push(new Vec3(targetX, 0, targetZ));
    }
    
    logger.info(`Generated ${targetPositions.length} exploration targets`);
    
    // Sort by distance from start
    targetPositions.sort((a, b) => {
      const distA = new Vec3(a.x, startPosition.y, a.z).distanceTo(startPosition);
      const distB = new Vec3(b.x, startPosition.y, b.z).distanceTo(startPosition);
      return distA - distB;
    });
    
    // Now we need to find suitable Y coordinates for these positions
    this.findSuitableHeights(targetPositions);
  }

  /**
   * Find suitable Y heights for target positions
   */
  async findSuitableHeights(targetPositions) {
    if (targetPositions.length === 0) {
      logger.warn('No valid exploration targets found');
      this.explorationComplete = true;
      return;
    }
    
    // Take the first position
    this.targetPosition = targetPositions.shift();
    
    // Estimate a suitable Y position
    this.targetPosition.y = await this.estimateYPosition(this.targetPosition);
    
    // Move to this target
    this.moveToExplorationTarget();
  }

  /**
   * Estimate a suitable Y position for a given X,Z
   */
  async estimateYPosition(position) {
    // Default to current Y if the target is nearby
    if (position.distanceTo(this.bot.entity.position) < 64) {
      return this.bot.entity.position.y;
    }
    
    // Otherwise aim for a bit above sea level
    return 64;
  }

  /**
   * Move to the current exploration target
   */
  moveToExplorationTarget() {
    if (!this.targetPosition) {
      logger.warn('No target position to move to');
      this.explorationComplete = true;
      return;
    }
    
    logger.info(`Moving to exploration target at ${this.targetPosition}`);
    
    // Use pathfinder if available
    if (this.bot.pathfinder) {
      const pathfinder = require('mineflayer-pathfinder');
      const { goals } = pathfinder;
      
      // Use a goal near since we just want to get to the general area
      const goal = new goals.GoalNear(
        this.targetPosition.x,
        this.targetPosition.y,
        this.targetPosition.z,
        5
      );
      
      // Set a timeout if pathfinding fails
      const onPathfindingFailure = () => {
        const now = Date.now();
        this.lastPathfindingFailure = now;
        this.pathfindingFailureCount++;
        
        // If we've failed too many times, try a new target
        if (this.pathfindingFailureCount >= 3) {
          logger.warn('Pathfinding failed too many times, trying a new target');
          this.pathfindingFailureCount = 0;
          this.selectNextExplorationTarget();
        }
      };
      
      // Setup pathfinding event listeners
      this.bot.once('goal_reached', () => {
        logger.info('Reached exploration target');
        this.recordExploredPosition();
        this.scanCurrentArea();
        
        // Move to next target after scan
        this.selectNextExplorationTarget();
      });
      
      this.bot.once('path_update', (results) => {
        if (results.status === 'noPath') {
          onPathfindingFailure();
        }
      });
      
      // Start pathfinding
      this.bot.pathfinder.setGoal(goal);
      
      // Set a timeout in case the path_update event doesn't fire
      setTimeout(() => {
        if (this.bot.pathfinder.isMoving()) {
          // Still moving, likely making progress
        } else {
          // Not moving, might be stuck
          onPathfindingFailure();
        }
      }, 10000);
    } else {
      // Simple movement if pathfinder not available
      this.simpleMove();
    }
  }

  /**
   * Simple movement toward target when pathfinder isn't available
   */
  simpleMove() {
    if (!this.targetPosition) return;
    
    // Look toward target
    const dx = this.targetPosition.x - this.bot.entity.position.x;
    const dz = this.targetPosition.z - this.bot.entity.position.z;
    const yaw = Math.atan2(-dx, -dz);
    
    this.bot.look(yaw, 0, true);
    this.bot.setControlState('forward', true);
    
    // Check if we've reached the target
    const interval = setInterval(() => {
      if (!this.targetPosition) {
        clearInterval(interval);
        this.bot.clearControlStates();
        return;
      }
      
      const pos = this.bot.entity.position;
      const distance = Math.sqrt(
        Math.pow(pos.x - this.targetPosition.x, 2) +
        Math.pow(pos.z - this.targetPosition.z, 2)
      );
      
      if (distance < 5) {
        clearInterval(interval);
        this.bot.clearControlStates();
        
        logger.info('Reached exploration target (simple move)');
        this.recordExploredPosition();
        this.scanCurrentArea();
        
        // Move to next target after scan
        this.selectNextExplorationTarget();
      }
    }, 2000);
  }

  /**
   * Record that we've explored this position
   */
  recordExploredPosition() {
    if (!this.targetPosition) return;
    
    const chunkX = Math.floor(this.targetPosition.x / 16);
    const chunkZ = Math.floor(this.targetPosition.z / 16);
    const chunkKey = `${chunkX},${chunkZ}`;
    
    this.visitedPositions.add(chunkKey);
    
    // Also record neighboring chunks as visited
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        const neighborKey = `${chunkX+dx},${chunkZ+dz}`;
        this.visitedPositions.add(neighborKey);
      }
    }
  }

  /**
   * Scan the current area for points of interest
   */
  scanCurrentArea() {
    logger.info('Scanning area for points of interest');
    
    // If exploration behavior is available, use its scanning method
    if (this.botManager.explorationBehavior && this.botManager.explorationBehavior.scanForPointsOfInterest) {
      this.botManager.explorationBehavior.scanForPointsOfInterest();
      return;
    }
    
    // Basic implementation - scan for valuable blocks
    this.scanForValuableBlocks();
    
    // Scan for structures and features
    this.scanForStructures();
    
    // Record biome information
    this.recordBiomeInfo();
  }

  /**
   * Scan for valuable blocks in the area
   */
  scanForValuableBlocks() {
    // List of valuable blocks to look for
    const valuableBlocks = [
      'diamond_ore', 'emerald_ore', 'gold_ore', 'iron_ore',
      'ancient_debris', 'lapis_ore', 'redstone_ore',
      'deepslate_diamond_ore', 'deepslate_emerald_ore',
      'deepslate_gold_ore', 'deepslate_iron_ore',
      'deepslate_lapis_ore', 'deepslate_redstone_ore'
    ];
    
    // Distance to scan
    const scanDistance = 16;
    
    // Check for each valuable block
    for (const blockType of valuableBlocks) {
      try {
        const blockId = this.bot.registry.blocksByName[blockType]?.id;
        if (!blockId) continue;
        
        const blocks = this.bot.findBlocks({
          matching: blockId,
          maxDistance: scanDistance,
          count: 5
        });
        
        if (blocks.length > 0) {
          const positions = blocks.map(pos => {
            return {
              position: pos,
              type: blockType,
              distance: pos.distanceTo(this.bot.entity.position)
            };
          });
          
          // Add to points of interest
          this.pointsOfInterest.push(...positions.map(p => ({
            type: 'resource',
            subType: p.type,
            position: p.position,
            description: `${p.type} deposit`
          })));
          
          logger.info(`Found ${positions.length} ${blockType} deposits`);
        }
      } catch (error) {
        logger.warn(`Error scanning for ${blockType}: ${error.message}`);
      }
    }
  }

  /**
   * Scan for structures and features
   */
  scanForStructures() {
    // Look for specific blocks that indicate structures
    const structureIndicators = [
      { block: 'mob_spawner', type: 'dungeon', description: 'Monster Spawner' },
      { block: 'chest', type: 'loot', description: 'Chest' },
      { block: 'end_portal_frame', type: 'stronghold', description: 'End Portal' },
      { block: 'nether_portal', type: 'portal', description: 'Nether Portal' },
      { block: 'lectern', type: 'village', description: 'Village Building' },
      { block: 'enchanting_table', type: 'library', description: 'Enchanting Setup' }
    ];
    
    // Distance to scan
    const scanDistance = 16;
    
    // Check for each structure indicator
    for (const indicator of structureIndicators) {
      try {
        const blockId = this.bot.registry.blocksByName[indicator.block]?.id;
        if (!blockId) continue;
        
        const blocks = this.bot.findBlocks({
          matching: blockId,
          maxDistance: scanDistance,
          count: 3
        });
        
        if (blocks.length > 0) {
          const positions = blocks.map(pos => {
            return {
              position: pos,
              type: indicator.type,
              description: indicator.description,
              distance: pos.distanceTo(this.bot.entity.position)
            };
          });
          
          // Add to points of interest
          this.pointsOfInterest.push(...positions.map(p => ({
            type: 'structure',
            subType: p.type,
            position: p.position,
            description: p.description
          })));
          
          logger.info(`Found ${positions.length} ${indicator.description}`);
        }
      } catch (error) {
        logger.warn(`Error scanning for ${indicator.block}: ${error.message}`);
      }
    }
  }

  /**
   * Record information about the current biome
   */
  recordBiomeInfo() {
    try {
      // Get current biome
      const biome = this.getCurrentBiome();
      if (!biome) return;
      
      logger.info(`Recorded biome information: ${biome}`);
      
      // If we're looking for a specific biome, check if we found it
      if (this.biomeTarget && biome.toLowerCase().includes(this.biomeTarget.toLowerCase())) {
        logger.info(`Found target biome: ${biome}`);
        this.bot.chat(`I found the ${biome} biome!`);
        
        // Add current location as a point of interest
        this.pointsOfInterest.push({
          type: 'biome',
          subType: biome,
          position: this.bot.entity.position.clone(),
          description: `${biome} Biome`
        });
        
        // If finding the biome was our main task, we're done
        if (this.currentTask === 'find_biome') {
          this.explorationComplete = true;
        }
      }
    } catch (error) {
      logger.warn(`Error recording biome info: ${error.message}`);
    }
  }

  /**
   * Get the current biome if possible
   */
  getCurrentBiome() {
    // This is a stub - Mineflayer doesn't have direct biome access
    // In a real implementation, we would use additional plugins or heuristics
    
    // For now, try to guess based on blocks around us
    const blockCounts = {};
    const scanRadius = 8;
    const pos = this.bot.entity.position.clone();
    
    // Sample blocks around the bot
    for (let x = -scanRadius; x <= scanRadius; x += 2) {
      for (let z = -scanRadius; z <= scanRadius; z += 2) {
        const blockPos = pos.offset(x, 0, z);
        const block = this.bot.blockAt(blockPos);
        if (!block) continue;
        
        if (!blockCounts[block.name]) {
          blockCounts[block.name] = 0;
        }
        blockCounts[block.name]++;
      }
    }
    
    // Try to guess biome based on block distribution
    if (blockCounts['sand'] > 20) return 'Desert';
    if (blockCounts['ice'] > 5 || blockCounts['snow'] > 5) return 'Snowy';
    if (blockCounts['jungle_log'] > 0) return 'Jungle';
    if (blockCounts['dark_oak_log'] > 0) return 'Dark Forest';
    if (blockCounts['birch_log'] > 0) return 'Birch Forest';
    if (blockCounts['spruce_log'] > 0) return 'Taiga';
    if (blockCounts['acacia_log'] > 0) return 'Savanna';
    if (blockCounts['oak_log'] > 0) return 'Forest';
    if (blockCounts['water'] > 15) return 'Ocean';
    if (blockCounts['grass_block'] > 15) return 'Plains';
    
    return 'Unknown';
  }

  /**
   * Select the next exploration target
   */
  selectNextExplorationTarget() {
    // Stop current pathfinding
    if (this.bot.pathfinder && this.bot.pathfinder.isMoving()) {
      this.bot.pathfinder.setGoal(null);
    }
    
    // Clear target position
    this.targetPosition = null;
    
    // If exploration is biome-specific and we found it, we're done
    if (this.currentTask === 'find_biome' && this.explorationComplete) {
      return;
    }
    
    // If exploration behavior is available, get next target from it
    if (this.botManager.explorationBehavior && this.botManager.explorationBehavior.getNextExplorationTarget) {
      const nextTarget = this.botManager.explorationBehavior.getNextExplorationTarget();
      if (nextTarget) {
        this.targetPosition = nextTarget;
        this.moveToExplorationTarget();
        return;
      }
    }
    
    // Otherwise generate a new target if needed
    if (this.explorePattern === 'spiral') {
      const spiralPoints = this.generateSpiralPoints(this.explorationRadius);
      const startPosition = this.bot.entity.position.clone();
      this.processExplorationPoints(spiralPoints, startPosition);
      return;
    }
    
    // For other patterns, just generate a new random target
    const randomPoints = this.generateRandomPoints(this.explorationRadius, 5);
    const startPosition = this.bot.entity.position.clone();
    this.processExplorationPoints(randomPoints, startPosition);
  }

  /**
   * Explore to find a specific biome
   */
  exploreBiome() {
    // If exploration behavior has specialized biome finding
    if (this.botManager.explorationBehavior && this.botManager.explorationBehavior.exploreBiome) {
      this.botManager.explorationBehavior.exploreBiome(this.biomeTarget)
        .then(found => {
          if (found) {
            logger.info(`Found ${this.biomeTarget} biome`);
            this.explorationComplete = true;
          } else {
            logger.warn(`Could not find ${this.biomeTarget} biome`);
            this.explorationComplete = true;
          }
        })
        .catch(error => {
          logger.error(`Error finding biome: ${error.message}`);
          this.explorationComplete = true;
        });
      return;
    }
    
    // Otherwise use a simple exploration pattern to look for the biome
    // We'll search in a spiral pattern with larger steps
    const spiralPoints = this.generateSpiralPoints(this.explorationRadius * 2);
    const startPosition = this.bot.entity.position.clone();
    this.processExplorationPoints(spiralPoints, startPosition);
  }

  /**
   * Main update function for the explore state
   */
  update() {
    this.timeInState += 1;
    
    // Check for safety periodically
    this.checkSafetyConditions();
    
    // Check if we're stuck
    const now = Date.now();
    if (now - this.lastStuckCheck > this.stuckCheckInterval) {
      this.lastStuckCheck = now;
      this.checkIfStuck();
    }
    
    // Provide progress updates
    if (now - this.lastProgressUpdate > 60000) { // Every minute
      this.lastProgressUpdate = now;
      this.updateExplorationProgress();
    }
    
    // If exploration is complete, transition away
    if (this.explorationComplete) {
      return;
    }
    
    // If we've been in this state too long, finish up
    if (this.timeInState > this.maxExplorationTime) {
      logger.info('Exploration has reached time limit');
      this.bot.chat('Finishing exploration due to time limit.');
      this.explorationComplete = true;
    }
  }

  /**
   * Check if the bot is stuck while exploring
   */
  checkIfStuck() {
    if (!this.targetPosition) return;
    
    const currentPos = this.bot.entity.position.clone();
    
    // If this is the first check, just record position
    if (!this.lastPosition) {
      this.lastPosition = currentPos;
      return;
    }
    
    // Calculate how far we've moved since last check
    const moveDistance = this.lastPosition.distanceTo(currentPos);
    
    // If we're not moving but should be (pathfinder is active), we might be stuck
    if (moveDistance < 0.5 && this.bot.pathfinder && this.bot.pathfinder.isMoving()) {
      this.stuckCount++;
      
      // If we've been stuck for a few checks
      if (this.stuckCount >= 3) {
        logger.warn('Bot appears to be stuck during exploration, selecting new target');
        this.selectNextExplorationTarget();
        this.stuckCount = 0;
      }
    } else {
      // Reset stuck counter if we're moving
      this.stuckCount = 0;
    }
    
    // Update last position
    this.lastPosition = currentPos;
  }

  /**
   * Check safety conditions during exploration
   */
  checkSafetyConditions() {
    // Check for nearby hostile mobs
    const hostileMobs = this.findNearbyHostileMobs();
    if (hostileMobs.length > 0 && hostileMobs[0].distance < 8) {
      logger.warn(`Hostile mob detected during exploration: ${hostileMobs[0].name}`);
      // We'll let the state machine's shouldTransition method handle the actual state change
    }
    
    // Check for nighttime if configured to avoid night
    if (this.isNightTime() && this.botManager.config.survival.avoidNightTime) {
      logger.warn('Night time detected during exploration');
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
   * Update exploration progress information
   */
  updateExplorationProgress() {
    // Calculate how long we've been exploring
    const explorationTime = (Date.now() - this.explorationStartTime) / 1000; // in seconds
    
    // Report progress
    const chunksExplored = this.visitedPositions.size;
    const poiFound = this.pointsOfInterest.length;
    
    logger.info(`Exploration progress: Explored ${chunksExplored} areas and found ${poiFound} points of interest in ${explorationTime.toFixed(0)} seconds`);
    this.bot.chat(`Exploration progress: Found ${poiFound} interesting locations so far.`);
    
    // Report discovered biomes or important finds
    if (this.pointsOfInterest.length > 0) {
      const biomes = this.pointsOfInterest.filter(poi => poi.type === 'biome');
      if (biomes.length > 0) {
        const biomeNames = [...new Set(biomes.map(b => b.subType))];
        this.bot.chat(`Discovered biomes: ${biomeNames.join(', ')}`);
      }
      
      const structures = this.pointsOfInterest.filter(poi => poi.type === 'structure');
      if (structures.length > 0) {
        const structureTypes = [...new Set(structures.map(s => s.description))];
        this.bot.chat(`Found structures: ${structureTypes.join(', ')}`);
      }
    }
  }

  /**
   * Report exploration results when exiting the state
   */
  reportExplorationResults() {
    // Calculate how long we spent exploring
    const explorationTime = (Date.now() - this.explorationStartTime) / 1000; // in seconds
    
    // Report findings
    const chunksExplored = this.visitedPositions.size;
    const poiFound = this.pointsOfInterest.length;
    
    logger.info(`Exploration complete. Explored ${chunksExplored} areas and found ${poiFound} points of interest in ${explorationTime.toFixed(0)} seconds`);
    
    if (poiFound > 0) {
      this.bot.chat(`Exploration complete! Found ${poiFound} interesting locations.`);
      
      // Group points of interest by type
      const poiByType = {};
      for (const poi of this.pointsOfInterest) {
        if (!poiByType[poi.type]) {
          poiByType[poi.type] = [];
        }
        poiByType[poi.type].push(poi);
      }
      
      // Report each type
      for (const [type, pois] of Object.entries(poiByType)) {
        const count = pois.length;
        const subtypes = [...new Set(pois.map(p => p.subType || p.description))];
        this.bot.chat(`${type.charAt(0).toUpperCase() + type.slice(1)}s found: ${count} (${subtypes.join(', ')})`);
      }
    } else {
      this.bot.chat('Exploration complete. Found nothing particularly interesting.');
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
        return this.shouldTransitionToMine();
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
    return hostileMobs.length > 0 && hostileMobs[0].distance < 5;
  }

  /**
   * Check if we should transition to idle state
   */
  shouldTransitionToIdle() {
    // If exploration is complete, go idle
    if (this.explorationComplete) {
      return true;
    }
    
    // If it's night and unsafe, go idle to find shelter
    if (this.isNightTime() && 
        this.botManager.config.survival.avoidNightTime) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if we should transition to gather state
   */
  shouldTransitionToGather() {
    // Only consider gathering if food is low
    return this.bot.food < 8;
  }

  /**
   * Check if we should transition to mine state
   */
  shouldTransitionToMine() {
    // If we found valuable ore deposits during exploration, maybe mine them
    const oreDeposits = this.pointsOfInterest.filter(poi => 
      poi.type === 'resource' && 
      (poi.subType.includes('diamond') || 
       poi.subType.includes('emerald') ||
       poi.subType.includes('ancient_debris'))
    );
    
    // Only consider if we found high-value ores
    return oreDeposits.length > 0;
  }
}

module.exports = ExploreState;