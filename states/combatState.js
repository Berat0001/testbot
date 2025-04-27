/**
 * Combat State for Minecraft Bot
 * 
 * In this state, the bot will engage in combat with entities,
 * either attacking or defending itself or its owner.
 */

// Import our custom StateBehavior base class
const StateBehavior = require('../bot/stateBehavior');
const Vec3 = require('vec3');
const logger = require('../bot/logger');

class CombatState extends StateBehavior {
  constructor(bot, botManager) {
    super(bot, 'combat');
    this.botManager = botManager;
    
    this.timeInState = 0;
    this.attackTarget = null;
    this.isDefending = false;
    this.defenseTarget = null;
    this.initialHealth = 0;
    this.attacksPerformed = 0;
    this.damageDealt = 0;
    this.damageTaken = 0;
    this.combatStartTime = 0;
    this.lastHealthCheck = 0;
    this.lastAttackTime = 0;
    this.fleeingFromCombat = false;
    this.combatComplete = false;
    this.distanceToTarget = Infinity;
  }

  onStateEntered() {
    this.timeInState = 0;
    this.initialHealth = this.bot.health;
    this.attacksPerformed = 0;
    this.damageDealt = 0;
    this.damageTaken = 0;
    this.combatStartTime = Date.now();
    this.lastHealthCheck = Date.now();
    this.lastAttackTime = 0;
    this.fleeingFromCombat = false;
    this.combatComplete = false;
    
    logger.info('Entered combat state');
    
    // Get target from combat behavior if available
    if (this.botManager.combatBehavior && this.botManager.combatBehavior.attackTarget) {
      this.attackTarget = this.botManager.combatBehavior.attackTarget;
      this.isDefending = false;
      logger.info(`Combat target: ${this.attackTarget.name || this.attackTarget.username || 'entity'}`);
      this.bot.chat(`Engaging ${this.attackTarget.name || this.attackTarget.username || 'entity'} in combat!`);
    } 
    // Check if we're defending someone
    else if (this.botManager.combatBehavior && this.botManager.combatBehavior.isDefending) {
      this.isDefending = true;
      this.defenseTarget = this.botManager.owner;
      logger.info(`Defending ${this.defenseTarget || 'self'}`);
      this.bot.chat(`Defending ${this.defenseTarget || 'myself'}!`);
    }
    // If no target specified, scan for threats
    else {
      this.findNewCombatTarget();
    }
    
    // Equip weapons right away
    this.equipCombatGear();
  }

  onStateExited() {
    logger.info('Exited combat state');
    this.reportCombatResults();
    
    // Reset combat state
    this.attackTarget = null;
    this.isDefending = false;
    this.defenseTarget = null;
    this.fleeingFromCombat = false;
    this.combatComplete = false;
    
    // Stop any PVP attack
    if (this.bot.pvp) {
      this.bot.pvp.stop();
    }
    
    // Clear control states
    this.bot.clearControlStates();
  }

  /**
   * Find a new combat target by scanning for threats
   */
  findNewCombatTarget() {
    logger.info('Scanning for combat targets');
    
    // Check if combat behavior is available
    if (this.botManager.combatBehavior) {
      const threats = this.botManager.combatBehavior.scanForThreats();
      
      if (threats.length > 0) {
        const closest = threats[0];
        this.attackTarget = closest.entity;
        logger.info(`Found combat target: ${this.attackTarget.name || this.attackTarget.username || 'entity'} at distance ${closest.distance}`);
        this.bot.chat(`Engaging ${this.attackTarget.name || this.attackTarget.username || 'entity'} in combat!`);
        return;
      }
    }
    
    // Fallback if no combat behavior or no threats found
    const hostileMobs = this.findNearbyHostileMobs();
    
    if (hostileMobs.length > 0) {
      const closest = hostileMobs[0];
      this.attackTarget = closest.entity;
      logger.info(`Found hostile mob target: ${closest.name} at distance ${closest.distance}`);
      this.bot.chat(`Engaging ${closest.name} in combat!`);
    } else {
      logger.info('No combat targets found');
      this.bot.chat('No threats detected.');
      this.combatComplete = true;
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
        'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider',
        'enderman', 'witch', 'slime', 'phantom', 'drowned', 'husk',
        'pillager', 'vindicator', 'evoker', 'vex'
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
   * Equip the best combat gear
   */
  async equipCombatGear() {
    try {
      // Equip best weapon
      if (this.botManager.combatBehavior) {
        await this.botManager.combatBehavior.equipBestWeapon();
      } else {
        // Fallback weapon equipping
        const items = this.bot.inventory.items();
        
        // Prefer swords, then axes
        const weapons = items.filter(item => 
          item.name.includes('_sword') || item.name.includes('_axe')
        );
        
        if (weapons.length > 0) {
          // Sort by material (diamond > iron > stone > wood)
          const materialOrder = ['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden'];
          
          weapons.sort((a, b) => {
            const matA = materialOrder.findIndex(m => a.name.includes(m));
            const matB = materialOrder.findIndex(m => b.name.includes(m));
            return matA - matB; // Lower index (better material) first
          });
          
          await this.bot.equip(weapons[0], 'hand');
        }
      }
      
      // If we have armor manager, use it to equip best armor
      if (this.bot.armorManager) {
        this.bot.armorManager.equipAll();
      }
      
    } catch (error) {
      logger.warn('Error equipping combat gear:', error);
    }
  }

  /**
   * Main update function for the combat state
   */
  update() {
    this.timeInState += 1;
    
    // If combat is complete, transition away
    if (this.combatComplete) {
      return;
    }
    
    // If we're fleeing, check if we should continue fleeing
    if (this.fleeingFromCombat) {
      this.updateFleeing();
      return;
    }
    
    // Check health and decide whether to flee
    const now = Date.now();
    if (now - this.lastHealthCheck > 1000) { // Check health every second
      this.lastHealthCheck = now;
      this.checkHealthAndFlee();
    }
    
    // Update behavior based on current mode
    if (this.isDefending) {
      this.updateDefense();
    } else if (this.attackTarget) {
      this.updateAttack();
    } else {
      // If no target and not defending, scan for a new target
      this.findNewCombatTarget();
      
      // If still no target, combat is complete
      if (!this.attackTarget && !this.isDefending) {
        this.combatComplete = true;
      }
    }
  }

  /**
   * Update attack behavior
   */
  async updateAttack() {
    try {
      // Verify target still exists and is valid
      if (!this.attackTarget || !this.attackTarget.isValid) {
        logger.info('Combat target no longer valid');
        this.attackTarget = null;
        return;
      }
      
      // Update distance to target
      this.distanceToTarget = this.bot.entity.position.distanceTo(this.attackTarget.position);
      
      // If PVP extension is available, use it
      if (this.bot.pvp) {
        // If we're not already attacking, start
        if (!this.bot.pvp.target) {
          this.bot.pvp.attack(this.attackTarget);
        }
      } else {
        // Manual combat implementation
        await this.performManualAttack();
      }
      
      // Check if the target is dead
      if (this.attackTarget.health <= 0) {
        logger.info('Combat target defeated');
        this.bot.chat(`${this.attackTarget.name || this.attackTarget.username || 'Target'} defeated!`);
        this.attackTarget = null;
        
        // Look for other threats
        this.findNewCombatTarget();
      }
    } catch (error) {
      logger.warn('Error updating attack:', error);
    }
  }

  /**
   * Perform manual attack when pvp extension not available
   */
  async performManualAttack() {
    try {
      // Check if target is in range
      if (this.distanceToTarget <= this.botManager.config.combat.attackRange) {
        // If there's a cooldown, wait
        const now = Date.now();
        if (now - this.lastAttackTime < 1000) {
          return; // Still in cooldown
        }
        
        // Face the target
        await this.bot.lookAt(this.attackTarget.position.offset(0, this.attackTarget.height * 0.8, 0));
        
        // Attack
        await this.bot.attack(this.attackTarget);
        this.attacksPerformed++;
        this.lastAttackTime = now;
      } else {
        // Move closer to target
        await this.moveToTarget();
      }
    } catch (error) {
      logger.warn('Error in manual attack:', error);
    }
  }

  /**
   * Move toward the attack target
   */
  async moveToTarget() {
    try {
      // If pathfinder is available
      if (this.bot.pathfinder && !this.bot.pathfinder.isMoving()) {
        const goals = require('mineflayer-pathfinder').goals;
        const goal = new goals.GoalNear(
          this.attackTarget.position.x,
          this.attackTarget.position.y,
          this.attackTarget.position.z,
          this.botManager.config.combat.attackRange - 1
        );
        
        this.bot.pathfinder.setGoal(goal);
      } else {
        // Simple movement if pathfinder not available
        this.bot.lookAt(this.attackTarget.position);
        this.bot.setControlState('forward', true);
        
        // Jump if needed
        if (this.bot.entity.onGround && this.attackTarget.position.y > this.bot.entity.position.y + 1) {
          this.bot.setControlState('jump', true);
          setTimeout(() => {
            this.bot.setControlState('jump', false);
          }, 250);
        }
      }
    } catch (error) {
      logger.warn('Error moving to target:', error);
    }
  }

  /**
   * Update defense behavior
   */
  updateDefense() {
    try {
      // If we have a defense target (owner), locate them
      if (this.defenseTarget) {
        const owner = this.bot.players[this.defenseTarget];
        
        if (owner && owner.entity) {
          // Stay close to owner
          this.stayCloseToTarget(owner.entity);
          
          // Check for threats around owner
          const threats = this.findThreatsAroundEntity(owner.entity);
          
          if (threats.length > 0) {
            // Attack the closest threat
            this.attackTarget = threats[0].entity;
            this.isDefending = false;
            logger.info(`Defending ${this.defenseTarget} from ${threats[0].name} at distance ${threats[0].distance}`);
            this.bot.chat(`Defending you from ${threats[0].name}!`);
          }
        } else {
          // Owner not visible, just defend self
          this.defenseTarget = null;
          this.isDefending = true;
          
          // Look for threats around self
          this.findNewCombatTarget();
        }
      } else {
        // Defending self, look for threats
        this.findNewCombatTarget();
      }
    } catch (error) {
      logger.warn('Error updating defense:', error);
    }
  }

  /**
   * Stay close to a target entity (like the owner)
   */
  async stayCloseToTarget(entity) {
    try {
      const distance = this.bot.entity.position.distanceTo(entity.position);
      
      // If we're too far, move closer
      if (distance > 5) {
        if (this.bot.pathfinder && !this.bot.pathfinder.isMoving()) {
          const goals = require('mineflayer-pathfinder').goals;
          const goal = new goals.GoalNear(
            entity.position.x,
            entity.position.y,
            entity.position.z,
            3
          );
          
          this.bot.pathfinder.setGoal(goal);
        } else {
          // Simple movement if pathfinder not available
          this.bot.lookAt(entity.position);
          this.bot.setControlState('forward', true);
        }
      } else {
        // Stop moving if we're close enough
        this.bot.clearControlStates();
        
        if (this.bot.pathfinder && this.bot.pathfinder.isMoving()) {
          this.bot.pathfinder.setGoal(null);
        }
      }
    } catch (error) {
      logger.warn('Error staying close to target:', error);
    }
  }

  /**
   * Find threats around a specific entity
   */
  findThreatsAroundEntity(entity) {
    const threats = [];
    const entities = this.bot.entities;
    
    for (const potentialThreat of Object.values(entities)) {
      if (potentialThreat.type !== 'mob') continue;
      
      // Define hostile mob types
      const hostileTypes = [
        'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider',
        'enderman', 'witch', 'slime', 'phantom'
      ];
      
      if (hostileTypes.includes(potentialThreat.name)) {
        const distance = entity.position.distanceTo(potentialThreat.position);
        
        if (distance < 8) { // Only consider close mobs as threats
          threats.push({
            entity: potentialThreat,
            name: potentialThreat.name,
            distance: distance
          });
        }
      }
    }
    
    // Sort by distance
    threats.sort((a, b) => a.distance - b.distance);
    
    return threats;
  }

  /**
   * Check health and decide whether to flee
   */
  checkHealthAndFlee() {
    // Track damage taken
    const currentHealth = this.bot.health;
    const healthChange = this.initialHealth - currentHealth;
    
    if (healthChange > 0) {
      this.damageTaken += healthChange;
    }
    
    this.initialHealth = currentHealth;
    
    // Check if health is too low to continue fighting
    if (currentHealth <= this.botManager.config.combat.fleeHealthThreshold) {
      logger.info(`Health low (${currentHealth}), fleeing from combat`);
      this.bot.chat("I'm taking too much damage! Retreating!");
      this.fleeingFromCombat = true;
      
      // Start fleeing
      this.startFleeing();
    }
  }

  /**
   * Start fleeing from combat
   */
  async startFleeing() {
    try {
      // Stop attacking
      if (this.bot.pvp) {
        this.bot.pvp.stop();
      }
      
      // Clear control states
      this.bot.clearControlStates();
      
      // If combat behavior has flee method, use it
      if (this.botManager.combatBehavior) {
        await this.botManager.combatBehavior.flee(this.attackTarget);
        return;
      }
      
      // Otherwise implement a simple flee mechanism
      
      // Get direction away from target or just a random direction if no target
      let fleeDirection;
      
      if (this.attackTarget) {
        // Direction from target to bot
        fleeDirection = this.bot.entity.position.minus(this.attackTarget.position).normalize();
      } else {
        // Random direction if no target
        const yaw = this.bot.entity.yaw + (Math.random() * Math.PI - Math.PI/2);
        fleeDirection = new Vec3(-Math.sin(yaw), 0, -Math.cos(yaw));
      }
      
      // Determine a point to flee to (10-15 blocks away)
      const fleeDistance = 12 + Math.random() * 3;
      const fleeTarget = this.bot.entity.position.plus(fleeDirection.scaled(fleeDistance));
      
      // Try to pathfind to the flee point
      if (this.bot.pathfinder) {
        const goals = require('mineflayer-pathfinder').goals;
        const goal = new goals.GoalNear(
          fleeTarget.x,
          fleeTarget.y,
          fleeTarget.z,
          2
        );
        
        this.bot.pathfinder.setGoal(goal);
      } else {
        // Simple flee if pathfinder not available
        this.bot.lookAt(fleeTarget);
        this.bot.setControlState('forward', true);
        this.bot.setControlState('sprint', true);
      }
      
    } catch (error) {
      logger.error('Error starting to flee:', error);
    }
  }

  /**
   * Update fleeing behavior
   */
  updateFleeing() {
    try {
      // Check if we're far enough from threats
      const safeDistance = 20;
      let nearestThreatDistance = Infinity;
      
      // Check distance to original target
      if (this.attackTarget && this.attackTarget.isValid) {
        nearestThreatDistance = this.bot.entity.position.distanceTo(this.attackTarget.position);
      } else {
        // Check all potential threats
        const hostileMobs = this.findNearbyHostileMobs();
        
        if (hostileMobs.length > 0) {
          nearestThreatDistance = hostileMobs[0].distance;
        }
      }
      
      // If we're safe, try to heal and consider ending flee state
      if (nearestThreatDistance > safeDistance) {
        logger.info(`Safe distance reached (${nearestThreatDistance.toFixed(1)} blocks), stopping to heal`);
        
        // Stop moving
        this.bot.clearControlStates();
        
        if (this.bot.pathfinder && this.bot.pathfinder.isMoving()) {
          this.bot.pathfinder.setGoal(null);
        }
        
        // Try to eat to regenerate health
        if (this.botManager.survivalBehavior) {
          this.botManager.survivalBehavior.eat();
        }
        
        // Check if health is good enough to stop fleeing
        if (this.bot.health > this.botManager.config.combat.fleeHealthThreshold * 1.5) {
          logger.info(`Health recovered (${this.bot.health}), ending flee state`);
          this.fleeingFromCombat = false;
          
          // Find new combat target or end combat
          this.findNewCombatTarget();
          
          if (!this.attackTarget) {
            this.combatComplete = true;
          }
        }
      }
    } catch (error) {
      logger.warn('Error updating fleeing behavior:', error);
    }
  }

  /**
   * Report combat results when exiting the state
   */
  reportCombatResults() {
    const elapsedTime = (Date.now() - this.combatStartTime) / 1000;
    const seconds = Math.floor(elapsedTime);
    
    this.bot.chat(`Combat ended after ${seconds} seconds with ${this.attacksPerformed} attacks performed.`);
    
    if (this.damageTaken > 0) {
      this.bot.chat(`I took ${this.damageTaken.toFixed(1)} damage during combat.`);
    }
    
    // Report final health status
    const healthStatus = this.getHealthStatus();
    this.bot.chat(`Current status: ${healthStatus}`);
  }

  /**
   * Get health status text
   */
  getHealthStatus() {
    const health = this.bot.health;
    
    let healthDesc = 'Unknown';
    if (health > 15) healthDesc = 'Good';
    else if (health > 8) healthDesc = 'Injured';
    else if (health > 0) healthDesc = 'Critical';
    
    return `Health: ${healthDesc} (${health.toFixed(1)}/20)`;
  }

  /**
   * Determine if we should transition to another state
   */
  shouldTransition(nextState) {
    // Different checks based on the potential next state
    switch (nextState) {
      case 'idle':
        return this.shouldTransitionToIdle();
      case 'gather':
        return this.shouldTransitionToGather();
      case 'flee':
        return this.shouldTransitionToFlee();
      case 'follow':
        return this.shouldTransitionToFollow();
      default:
        return false;
    }
  }

  /**
   * Check if we should transition to idle state
   */
  shouldTransitionToIdle() {
    // If combat is complete
    if (this.combatComplete) {
      return true;
    }
    
    // If we've been in combat for too long (cap at 2 minutes)
    const elapsedTime = (Date.now() - this.combatStartTime) / 1000;
    if (elapsedTime > 120) { // 2 minutes
      return true;
    }
    
    return false;
  }

  /**
   * Check if we should transition to gather state
   */
  shouldTransitionToGather() {
    // If we're safe but very hungry
    if (!this.attackTarget && !this.isDefending && this.bot.food < 8) {
      return true;
    }
    
    // If we've been explicitly instructed to gather
    if (this.botManager.survivalBehavior && this.botManager.survivalBehavior.isCollecting) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if we should transition to flee state
   */
  shouldTransitionToFlee() {
    // We handle fleeing internally in the combat state
    return false;
  }

  /**
   * Check if we should transition to follow state
   */
  shouldTransitionToFollow() {
    // If combat is complete and owner is calling us
    if (this.combatComplete && this.botManager.owner) {
      const ownerEntity = this.bot.players[this.botManager.owner]?.entity;
      
      if (ownerEntity) {
        const distance = this.bot.entity.position.distanceTo(ownerEntity.position);
        if (distance > 10) {
          return true;
        }
      }
    }
    
    return false;
  }
}

module.exports = CombatState;
