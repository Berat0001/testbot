/**
 * Exploration Behavior Module
 * 
 * Handles exploration-related tasks for the bot, including
 * mapping, discovery, and navigating unknown terrain.
 */

const Vec3 = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { GoalXZ, GoalNear, GoalBlock } = goals;
const logger = require('../bot/logger');

class ExplorationBehavior {
  constructor(bot, mcData, config, botManager) {
    this.bot = bot;
    this.mcData = mcData;
    this.config = config;
    this.botManager = botManager;
    
    this.isExploring = false;
    this.explorationRadius = 100; // Default radius
    this.exploredChunks = new Set();
    this.pointsOfInterest = [];
    this.currentDestination = null;
    this.explorationStartPosition = null;
    this.explorationDirection = 0; // in radians
    
    // Interesting block types to track
    this.interestingBlocks = [
      'chest', 'crafting_table', 'furnace', 'enchanting_table', 'bookshelf',
      'brewing_stand', 'anvil', 'beacon', 'diamond_ore', 'deepslate_diamond_ore',
      'emerald_ore', 'deepslate_emerald_ore', 'nether_portal', 'end_portal_frame',
      'spawner', 'ancient_debris', 'village', 'stronghold', 'mansion', 'temple',
      'mineshaft', 'monument', 'nether_fortress'
    ];
  }
  
  /**
   * Start exploration with a specified radius
   */
  async startExploration(radius = 100) {
    if (this.isExploring) {
      this.bot.chat('Already exploring.');
      return;
    }
    
    this.isExploring = true;
    this.explorationRadius = radius;
    this.explorationStartPosition = this.bot.entity.position.clone();
    this.explorationDirection = Math.random() * Math.PI * 2; // Random initial direction
    
    logger.info(`Starting exploration with radius ${radius} blocks`);
    this.bot.chat(`Starting exploration with a radius of ${radius} blocks.`);
    
    try {
      // Execute spiral exploration pattern
      await this.spiralExploration();
    } catch (error) {
      logger.error('Error during exploration:', error);
      this.bot.chat(`Exploration error: ${error.message}`);
    } finally {
      this.isExploring = false;
    }
  }
  
  /**
   * Stop current exploration
   */
  stopExploration() {
    if (!this.isExploring) return;
    
    this.isExploring = false;
    this.bot.pathfinder.setGoal(null);
    this.bot.chat('Exploration stopped.');
    logger.info('Exploration stopped');
  }
  
  /**
   * Spiral exploration pattern - efficient for covering large areas
   */
  async spiralExploration() {
    const center = this.explorationStartPosition.clone();
    const maxRadius = this.explorationRadius;
    const stepSize = 20; // Distance between exploration points
    
    this.bot.chat(`Exploring in a spiral pattern with radius ${maxRadius} blocks`);
    
    let pointsExplored = 0;
    let spiralDistance = 0;
    let angle = this.explorationDirection;
    
    // Spiral outwards from the center
    while (spiralDistance < maxRadius && this.isExploring) {
      // Calculate next position in spiral
      spiralDistance += stepSize / (2 * Math.PI);
      angle += stepSize / spiralDistance;
      
      // Convert to cartesian coordinates
      const dx = Math.cos(angle) * spiralDistance;
      const dz = Math.sin(angle) * spiralDistance;
      
      // Calculate target position
      const targetPos = center.offset(dx, 0, dz);
      
      // Check if target is in loaded chunks
      if (!this.bot.world.getColumnAt(targetPos)) {
        // Move closer to the area to load the chunks
        const moveTowardPos = center.plus(new Vec3(dx, 0, dz).normalize().scaled(Math.min(spiralDistance - stepSize, 50)));
        await this.moveToPosition(moveTowardPos);
      }
      
      // Try to move to the target
      const success = await this.moveToPosition(targetPos);
      
      if (success) {
        pointsExplored++;
        
        // Look for points of interest at this location
        await this.scanForPointsOfInterest();
        
        // Record that we've explored this chunk
        const chunkX = Math.floor(this.bot.entity.position.x / 16);
        const chunkZ = Math.floor(this.bot.entity.position.z / 16);
        this.exploredChunks.add(`${chunkX},${chunkZ}`);
        
        // Provide progress updates
        if (pointsExplored % 5 === 0) {
          const distanceFromCenter = this.bot.entity.position.distanceTo(center);
          const percentComplete = Math.floor((distanceFromCenter / maxRadius) * 100);
          this.bot.chat(`Exploration progress: ${Math.min(percentComplete, 100)}% (${pointsExplored} points explored)`);
        }
      }
      
      // Add a small delay to prevent server lag
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    if (this.isExploring) {
      this.bot.chat(`Exploration complete! Explored ${pointsExplored} points.`);
      
      // Report points of interest
      if (this.pointsOfInterest.length > 0) {
        this.bot.chat(`Found ${this.pointsOfInterest.length} points of interest.`);
        
        // Categorize and report
        this.reportPointsOfInterest();
      } else {
        this.bot.chat('No significant points of interest found.');
      }
      
      // Return to start position if requested
      if (this.bot.entity.position.distanceTo(center) > 20) {
        this.bot.chat('Returning to starting position...');
        await this.moveToPosition(center);
      }
    }
    
    this.isExploring = false;
  }
  
  /**
   * Move to a specified position with error handling
   */
  async moveToPosition(position) {
    try {
      // First, try to get approximate height at position
      const targetY = await this.estimateYPosition(position);
      const target = new Vec3(position.x, targetY, position.z);
      
      // Set a goal to move near the position
      const goal = new GoalNear(target.x, target.y, target.z, 3);
      
      // Try to navigate to the position
      logger.debug(`Moving to position ${target}`);
      
      return new Promise((resolve, reject) => {
        // Set a timeout for pathfinding
        const timeout = setTimeout(() => {
          this.bot.pathfinder.setGoal(null);
          logger.warn(`Pathfinding timed out after 30 seconds, continuing exploration`);
          resolve(false);
        }, 30000);
        
        // Set up event listeners
        const onGoalReached = () => {
          clearTimeout(timeout);
          this.bot.removeListener('goal_reached', onGoalReached);
          this.bot.removeListener('path_update', onPathUpdate);
          resolve(true);
        };
        
        const onPathUpdate = (results) => {
          if (results.status === 'noPath') {
            clearTimeout(timeout);
            this.bot.removeListener('goal_reached', onGoalReached);
            this.bot.removeListener('path_update', onPathUpdate);
            
            // Try to move in the general direction
            this.fallbackMove(target).then(success => resolve(success));
          }
        };
        
        // Register listeners
        this.bot.once('goal_reached', onGoalReached);
        this.bot.on('path_update', onPathUpdate);
        
        // Start pathfinding
        this.bot.pathfinder.setGoal(goal);
      });
    } catch (error) {
      logger.warn(`Error moving to ${position}:`, error);
      return false;
    }
  }
  
  /**
   * Fallback movement when pathfinding fails
   */
  async fallbackMove(target) {
    logger.info(`Using fallback movement to get closer to ${target}`);
    
    try {
      // Just try to move in the general XZ direction
      const goal = new GoalXZ(target.x, target.z);
      
      return new Promise((resolve) => {
        // Set a shorter timeout for fallback movement
        const timeout = setTimeout(() => {
          this.bot.pathfinder.setGoal(null);
          resolve(false);
        }, 15000);
        
        const onGoalReached = () => {
          clearTimeout(timeout);
          this.bot.removeListener('goal_reached', onGoalReached);
          resolve(true);
        };
        
        this.bot.once('goal_reached', onGoalReached);
        this.bot.pathfinder.setGoal(goal);
      });
    } catch (error) {
      logger.warn(`Fallback movement failed:`, error);
      return false;
    }
  }
  
  /**
   * Estimate a safe Y position at the target XZ
   */
  async estimateYPosition(position) {
    try {
      // Start from the bot's current Y position
      let y = this.bot.entity.position.y;
      
      // Check if the target is loaded
      const column = this.bot.world.getColumnAt(position);
      
      if (column) {
        // Try to find the top solid block at this position
        const topBlock = this.bot.world.getBlockAt(new Vec3(position.x, y, position.z));
        
        if (topBlock) {
          // Look for the ground
          let foundGround = false;
          let checkY = y;
          
          // Look down up to 20 blocks to find solid ground
          while (!foundGround && checkY > y - 20) {
            const block = this.bot.world.getBlockAt(new Vec3(position.x, checkY, position.z));
            
            if (block && block.boundingBox === 'block') {
              foundGround = true;
              y = checkY + 1; // Stand on top of the ground
              break;
            }
            
            checkY--;
          }
          
          // If no ground found, look up to find air
          if (!foundGround) {
            checkY = y;
            
            while (checkY < y + 20) {
              const block = this.bot.world.getBlockAt(new Vec3(position.x, checkY, position.z));
              
              if (block && block.boundingBox === 'empty') {
                y = checkY;
                break;
              }
              
              checkY++;
            }
          }
        }
      }
      
      return y;
    } catch (error) {
      logger.warn(`Error estimating Y position:`, error);
      return this.bot.entity.position.y; // Default to current Y
    }
  }
  
  /**
   * Scan the current area for interesting features
   */
  async scanForPointsOfInterest() {
    const currentPos = this.bot.entity.position;
    const scanRadius = 20; // Scan a 20-block radius
    
    logger.debug(`Scanning for points of interest at ${currentPos}`);
    
    // Scan for interesting blocks
    for (const blockType of this.interestingBlocks) {
      try {
        const blockId = this.mcData.blocksByName[blockType]?.id;
        
        if (!blockId) continue;
        
        const blocks = this.bot.findBlocks({
          matching: blockId,
          maxDistance: scanRadius,
          count: 5 // Limit to 5 per type for performance
        });
        
        // Add new points of interest
        for (const blockPos of blocks) {
          const block = this.bot.blockAt(blockPos);
          
          if (!block) continue;
          
          // Skip if we already have this position recorded
          const alreadyFound = this.pointsOfInterest.some(poi => 
            poi.position.distanceTo(blockPos) < 5 && poi.type === blockType
          );
          
          if (!alreadyFound) {
            // Record the point of interest
            this.pointsOfInterest.push({
              type: blockType,
              position: blockPos.clone(),
              distance: currentPos.distanceTo(blockPos),
              discoveredAt: Date.now()
            });
            
            logger.info(`Discovered ${blockType} at ${blockPos}`);
            this.bot.chat(`Found a ${blockType} at ${blockPos.x}, ${blockPos.y}, ${blockPos.z}!`);
          }
        }
      } catch (error) {
        // Continue with next block type
        logger.warn(`Error scanning for ${blockType}:`, error);
      }
    }
    
    // Also check for other interesting features like villages, structures, etc.
    // This is limited because Mineflayer doesn't directly expose this information
    // We mainly rely on visible blocks
  }
  
  /**
   * Report a summary of found points of interest
   */
  reportPointsOfInterest() {
    // Group by type
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
      
      // Get closest one
      pois.sort((a, b) => a.distance - b.distance);
      const closest = pois[0];
      
      this.bot.chat(`Found ${count} ${type}(s) - closest at ${Math.round(closest.position.x)}, ${Math.round(closest.position.y)}, ${Math.round(closest.position.z)}`);
    }
  }
  
  /**
   * Explore a specific biome
   */
  async exploreBiome(biomeName) {
    this.bot.chat(`Looking for ${biomeName} biome...`);
    
    // Start from current position
    const startPos = this.bot.entity.position.clone();
    const searchRadius = 200; // Search radius
    const searchStepSize = 30; // How far to move for each check
    
    // Search in an outward spiral pattern
    let foundBiome = false;
    let pointsChecked = 0;
    let spiralDistance = 0;
    let angle = 0;
    
    while (spiralDistance < searchRadius && !foundBiome) {
      // Calculate next position in spiral
      spiralDistance += searchStepSize / (2 * Math.PI);
      angle += searchStepSize / spiralDistance;
      
      // Convert to cartesian coordinates
      const dx = Math.cos(angle) * spiralDistance;
      const dz = Math.sin(angle) * spiralDistance;
      
      // Calculate target position
      const targetPos = startPos.offset(dx, 0, dz);
      
      // Try to move to the target
      await this.moveToPosition(targetPos);
      pointsChecked++;
      
      // Check biome at current position
      try {
        const currentBiome = this.getCurrentBiome();
        
        if (currentBiome && currentBiome.toLowerCase().includes(biomeName.toLowerCase())) {
          foundBiome = true;
          this.bot.chat(`Found ${currentBiome} biome at ${this.bot.entity.position.x}, ${this.bot.entity.position.y}, ${this.bot.entity.position.z}!`);
          break;
        }
        
        // Progress report
        if (pointsChecked % 5 === 0) {
          this.bot.chat(`Searched ${pointsChecked} locations for ${biomeName} biome. Current biome: ${currentBiome || 'unknown'}`);
        }
      } catch (error) {
        logger.warn(`Error checking biome:`, error);
      }
    }
    
    if (!foundBiome) {
      this.bot.chat(`Could not find ${biomeName} biome within ${searchRadius} blocks.`);
    }
    
    return foundBiome;
  }
  
  /**
   * Get the current biome name
   */
  getCurrentBiome() {
    try {
      const pos = this.bot.entity.position.floored();
      const block = this.bot.blockAt(pos);
      
      if (block && block.biome) {
        return block.biome.name;
      }
      
      return null;
    } catch (error) {
      logger.warn(`Error getting current biome:`, error);
      return null;
    }
  }
  
  /**
   * Generate and return a map of the explored area
   */
  getExplorationMap() {
    // This is a simplified map representation
    const map = {
      startPosition: this.explorationStartPosition,
      exploredChunks: Array.from(this.exploredChunks),
      pointsOfInterest: this.pointsOfInterest.map(poi => ({
        type: poi.type,
        x: poi.position.x,
        y: poi.position.y,
        z: poi.position.z
      }))
    };
    
    return map;
  }
  
  /**
   * Travel to a specific point of interest
   */
  async travelToPointOfInterest(poiType) {
    // Find matching points of interest
    const matchingPOIs = this.pointsOfInterest.filter(poi => 
      poi.type.toLowerCase().includes(poiType.toLowerCase())
    );
    
    if (matchingPOIs.length === 0) {
      this.bot.chat(`I haven't discovered any ${poiType} yet.`);
      return false;
    }
    
    // Sort by distance
    matchingPOIs.sort((a, b) => 
      a.position.distanceTo(this.bot.entity.position) - 
      b.position.distanceTo(this.bot.entity.position)
    );
    
    // Travel to the closest one
    const target = matchingPOIs[0];
    this.bot.chat(`Traveling to ${target.type} at ${target.position.x}, ${target.position.y}, ${target.position.z}`);
    
    // Move to the position
    const success = await this.moveToPosition(target.position);
    
    if (success) {
      this.bot.chat(`Arrived at the ${target.type}!`);
    } else {
      this.bot.chat(`Had trouble reaching the ${target.type}.`);
    }
    
    return success;
  }
}

module.exports = ExplorationBehavior;
