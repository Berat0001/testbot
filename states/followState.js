/**
 * Follow State for Minecraft Bot
 * 
 * In this state, the bot will follow a specific player (usually the owner),
 * maintaining a certain distance and avoiding obstacles.
 */

// Import our custom StateBehavior base class
const StateBehavior = require('../bot/stateBehavior');
const Vec3 = require('vec3');
const logger = require('../bot/logger');

class FollowState extends StateBehavior {
  constructor(bot, botManager) {
    super(bot, 'follow');
    this.botManager = botManager;
    
    this.timeInState = 0;
    this.followTarget = null;
    this.followEntityId = null;
    this.followUsername = null;
    this.isFollowing = false;
    this.followDistance = 3; // Target distance to maintain
    this.pathUpdateInterval = 1000; // How often to update path in ms
    this.lastPathUpdate = 0;
    this.stuckCheckInterval = 3000; // How often to check if we're stuck
    this.lastStuckCheck = 0;
    this.lastPosition = null;
    this.stuckCount = 0;
    this.maxFollowTime = 5 * 60 * 20; // 5 minutes at 20 ticks per second
  }

  onStateEntered() {
    this.timeInState = 0;
    this.isFollowing = false;
    this.lastPathUpdate = 0;
    this.lastStuckCheck = 0;
    this.lastPosition = null;
    this.stuckCount = 0;
    
    logger.info('Entered follow state');
    
    // If the bot manager has an owner, follow them by default
    if (this.botManager.owner) {
      this.followUsername = this.botManager.owner;
      this.bot.chat(`Following ${this.followUsername}.`);
      
      // Locate the owner entity
      this.updateFollowTarget();
    } else {
      logger.info('No owner specified to follow');
      this.bot.chat('No specific target to follow.');
    }
  }

  onStateExited() {
    logger.info('Exited follow state');
    
    // Stop following
    this.isFollowing = false;
    this.followTarget = null;
    this.followEntityId = null;
    
    // Stop pathfinding
    if (this.bot.pathfinder && this.bot.pathfinder.isMoving()) {
      this.bot.pathfinder.setGoal(null);
    }
    
    // Stop any movement
    this.bot.clearControlStates();
  }

  /**
   * Update the follow target entity reference
   */
  updateFollowTarget() {
    // If we have a username to follow
    if (this.followUsername) {
      const player = this.bot.players[this.followUsername];
      
      if (player && player.entity) {
        this.followTarget = player.entity;
        this.followEntityId = player.entity.id;
        this.isFollowing = true;
        return true;
      } else {
        logger.warn(`Could not find player entity for ${this.followUsername}`);
        return false;
      }
    }
    // If we have an entity ID to follow
    else if (this.followEntityId !== null) {
      const entity = this.bot.entities[this.followEntityId];
      
      if (entity) {
        this.followTarget = entity;
        this.isFollowing = true;
        return true;
      } else {
        logger.warn(`Could not find entity with ID ${this.followEntityId}`);
        return false;
      }
    }
    
    return false;
  }

  /**
   * Set a new follow target
   */
  setFollowTarget(target) {
    if (typeof target === 'string') {
      // Target is a username
      this.followUsername = target;
      this.followEntityId = null;
      this.bot.chat(`Now following ${target}.`);
    } else if (target && typeof target === 'object') {
      // Target is an entity
      this.followTarget = target;
      this.followEntityId = target.id;
      this.followUsername = null;
      this.bot.chat(`Now following ${target.name || target.username || 'entity'}.`);
    } else {
      logger.warn('Invalid follow target specified');
      return false;
    }
    
    return this.updateFollowTarget();
  }

  /**
   * Main update function for the follow state
   */
  update() {
    this.timeInState += 1;
    
    // If we're not actively following anyone, try to update the target
    if (!this.isFollowing) {
      const success = this.updateFollowTarget();
      
      if (!success) {
        // If we still don't have a target, we should transition to idle
        if (this.timeInState > 100) { // Give it a few seconds to find a target
          logger.warn('No valid follow target found after waiting');
          return; // Will transition to idle
        }
        return;
      }
    }
    
    // Check if target is still valid
    if (!this.followTarget || !this.followTarget.isValid) {
      logger.warn('Follow target no longer valid');
      this.isFollowing = false;
      this.updateFollowTarget();
      return;
    }
    
    const now = Date.now();
    
    // Update pathfinding periodically
    if (now - this.lastPathUpdate > this.pathUpdateInterval) {
      this.lastPathUpdate = now;
      this.updatePathToTarget();
    }
    
    // Check if we're stuck
    if (now - this.lastStuckCheck > this.stuckCheckInterval) {
      this.lastStuckCheck = now;
      this.checkIfStuck();
    }
    
    // Check for threats
    this.checkForThreats();
    
    // Check if we've been following for too long
    if (this.timeInState > this.maxFollowTime) {
      logger.info('Follow state has reached its maximum time');
      this.bot.chat('I have been following for a while, taking a break.');
      this.isFollowing = false;
    }
  }

  /**
   * Update the path to the follow target
   */
  updatePathToTarget() {
    if (!this.isFollowing || !this.followTarget) return;
    
    const distanceToTarget = this.bot.entity.position.distanceTo(this.followTarget.position);
    
    // If we're already close enough, stop moving
    if (distanceToTarget <= this.followDistance) {
      if (this.bot.pathfinder && this.bot.pathfinder.isMoving()) {
        this.bot.pathfinder.setGoal(null);
      }
      this.bot.clearControlStates();
      return;
    }
    
    // If pathfinder is available, use it
    if (this.bot.pathfinder) {
      const pathfinder = require('mineflayer-pathfinder');
      const { goals } = pathfinder;
      
      const goal = new goals.GoalNear(
        this.followTarget.position.x,
        this.followTarget.position.y,
        this.followTarget.position.z,
        this.followDistance
      );
      
      this.bot.pathfinder.setGoal(goal);
    } else {
      // Simple movement if pathfinder not available
      this.simpleFollowMovement();
    }
  }

  /**
   * Simple follow movement without pathfinder
   */
  simpleFollowMovement() {
    const targetPos = this.followTarget.position;
    const botPos = this.bot.entity.position;
    
    // Look at the target
    this.bot.lookAt(targetPos);
    
    // Calculate distance
    const distance = botPos.distanceTo(targetPos);
    
    if (distance > this.followDistance) {
      // Move toward target
      this.bot.setControlState('forward', true);
      
      // Jump if we see a block in front that's jumpable
      if (this.bot.entity.onGround) {
        const blockAhead = this.bot.blockAtCursor(2); // Check for blocks within 2 blocks ahead
        if (blockAhead && blockAhead.position.y > botPos.y) {
          this.bot.setControlState('jump', true);
          setTimeout(() => {
            this.bot.setControlState('jump', false);
          }, 250);
        }
      }
    } else {
      // Stop moving if we're close enough
      this.bot.clearControlStates();
    }
  }

  /**
   * Check if the bot is stuck while following
   */
  checkIfStuck() {
    const currentPos = this.bot.entity.position.clone();
    
    // If this is the first check, just record position
    if (!this.lastPosition) {
      this.lastPosition = currentPos;
      return;
    }
    
    // Calculate how far we've moved since last check
    const moveDistance = this.lastPosition.distanceTo(currentPos);
    
    // If we're not moving but should be (pathfinder is active), we might be stuck
    if (moveDistance < 0.1 && this.bot.pathfinder && this.bot.pathfinder.isMoving()) {
      this.stuckCount++;
      
      // If we've been stuck for a few checks
      if (this.stuckCount >= 3) {
        logger.warn('Bot appears to be stuck, trying to unstick');
        this.tryToUnstick();
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
   * Try to get unstuck
   */
  tryToUnstick() {
    // Stop current movement
    this.bot.clearControlStates();
    if (this.bot.pathfinder && this.bot.pathfinder.isMoving()) {
      this.bot.pathfinder.setGoal(null);
    }
    
    // Move in a different direction briefly
    const randomDirection = Math.floor(Math.random() * 4);
    let direction;
    
    switch (randomDirection) {
      case 0:
        direction = 'forward';
        break;
      case 1:
        direction = 'back';
        break;
      case 2:
        direction = 'left';
        break;
      case 3:
        direction = 'right';
        break;
    }
    
    // Try to move in the random direction and jump
    this.bot.setControlState(direction, true);
    this.bot.setControlState('jump', true);
    
    // Stop after a short time
    setTimeout(() => {
      this.bot.clearControlStates();
      
      // Resume pathfinding after a moment
      setTimeout(() => {
        this.updatePathToTarget();
      }, 500);
    }, 1000);
  }

  /**
   * Check for threats while following
   */
  checkForThreats() {
    // Skip if combat is disabled
    if (!this.botManager.config.combat.enabled) return;
    
    // If target is a player, defend them
    if (this.followUsername) {
      const hostileMobs = this.findNearbyHostileMobs();
      
      // Check if any are near our follow target
      if (hostileMobs.length > 0 && this.followTarget) {
        const targetsTarget = hostileMobs.find(mob => {
          // Calculate distance from the mob to our follow target
          const distance = mob.entity.position.distanceTo(this.followTarget.position);
          return distance < 6; // If mob is within 6 blocks of our target
        });
        
        if (targetsTarget) {
          logger.info(`Hostile mob ${targetsTarget.name} threatening followed target`);
          // We'll let the state machine's shouldTransition method handle the actual state change
        }
      }
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
      case 'mine':
        return this.shouldTransitionToMine();
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
    
    // Check for mobs threatening our follow target
    if (this.followTarget) {
      const hostileMobsNearTarget = hostileMobs.filter(mob => {
        const distanceToTarget = mob.entity.position.distanceTo(this.followTarget.position);
        return distanceToTarget < 6;
      });
      
      return hostileMobsNearTarget.length > 0;
    }
    
    return false;
  }

  /**
   * Check if we should transition to idle state
   */
  shouldTransitionToIdle() {
    // If we don't have a valid follow target, go idle
    if (!this.isFollowing) {
      return true;
    }
    
    // If we've been following for the maximum time
    if (this.timeInState > this.maxFollowTime) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if we should transition to gather state
   */
  shouldTransitionToGather() {
    // Only consider this if food is low and we're following the owner
    if (this.bot.food < 8 && this.followUsername === this.botManager.owner) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if we should transition to mine state
   */
  shouldTransitionToMine() {
    // Generally we stay in follow state as long as we have a valid target
    // So for now, don't transition to mining
    return false;
  }
}

module.exports = FollowState;