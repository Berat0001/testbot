/**
 * Combat Behavior Module
 * 
 * Handles combat-related tasks for the bot, including
 * attacking entities, defending, and evaluating threats.
 */

const Vec3 = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { GoalNear, GoalBlock } = goals;
const logger = require('../bot/logger');

class CombatBehavior {
  constructor(bot, mcData, config, botManager) {
    this.bot = bot;
    this.mcData = mcData;
    this.config = config;
    this.botManager = botManager;
    
    this.attackTarget = null;
    this.fleeingFrom = null;
    this.lastAttackTime = 0;
    this.isAttacking = false;
    this.isDefending = false;
    this.isFleeing = false;
    
    // Weapon preferences in order of priority (best first)
    this.weaponPreferences = [
      'netherite_sword', 'diamond_sword', 'iron_sword', 
      'stone_sword', 'golden_sword', 'wooden_sword',
      'netherite_axe', 'diamond_axe', 'iron_axe', 
      'stone_axe', 'golden_axe', 'wooden_axe'
    ];
    
    // Store combat settings locally instead of trying to use bot.pvp
    this.pvpSettings = {
      attackRange: this.config.combat.attackRange || 3,
      followRange: (this.config.combat.attackRange || 3) + 1,
      viewDistance: 16,
      keepDistance: false,
      sprint: true
    };
    
    logger.info("Combat behavior initialized with local settings");
  }
  
  /**
   * Configure PVP settings 
   */
  configurePvp() {
    try {
      // Skip configuration if we can't access the PVP module
      if (typeof this.bot.pvp !== 'object') {
        logger.warn("PVP plugin not properly initialized. Creating fallback object.");
        this.bot.pvp = {};
      }
      
      // Store options locally to avoid referencing issues
      const pvpOptions = {
        attackRange: this.config.combat.attackRange || 3,
        followRange: (this.config.combat.attackRange || 3) + 1,
        viewDistance: 16,
        keepDistance: false,
        sprint: true
      };
      
      // Set the options using a property setter approach
      logger.debug("Setting PVP configuration options");
      // Don't try to modify the object directly, create a new one
      this.bot.pvp.options = pvpOptions;
      
      logger.info("PVP configuration completed successfully");
    } catch (error) {
      logger.error(`Error configuring PVP: ${error.message}`);
      // Always make sure we have a usable object
      this.bot.pvp = {
        options: {
          attackRange: this.config.combat.attackRange || 3,
          followRange: (this.config.combat.attackRange || 3) + 1,
          viewDistance: 16,
          keepDistance: false,
          sprint: true
        },
        // Provide fallback methods in case the real ones don't exist
        attack: function() { logger.warn("PVP attack not available"); },
        stop: function() { logger.warn("PVP stop not available"); }
      };
    }
  }
  
  /**
   * Attack a specific entity
   */
  async attackEntity(entity) {
    if (!entity) {
      throw new Error('No target specified to attack');
    }
    
    logger.info(`Starting attack on ${entity.name || entity.username || entity.displayName || 'entity'}`);
    
    try {
      // If bot can attack, equip best weapon
      await this.equipBestWeapon();
      
      this.attackTarget = entity;
      this.isAttacking = true;
      this.isFleeing = false;
      
      // Use the pvp plugin to handle the attack
      if (this.bot.pvp) {
        // Set up listeners for attack events
        this.registerPvpEvents();
        
        // Start attacking
        this.bot.pvp.attack(entity);
        this.bot.chat(`Attacking ${entity.name || entity.username || entity.displayName || 'entity'}!`);
      } else {
        // Fallback if pvp plugin isn't available
        await this.manualAttack(entity);
      }
    } catch (error) {
      logger.error(`Failed to attack entity:`, error);
      this.stopAttacking();
      throw error;
    }
  }
  
  /**
   * Register PVP events
   */
  registerPvpEvents() {
    // Define event handlers and store them on the instance
    if (!this.onStoppedAttacking) {
      this.onStoppedAttacking = () => {
        logger.info(`Stopped attacking`);
        this.stopAttacking();
      };
    }
    
    if (!this.onEntityGone) {
      this.onEntityGone = (entity) => {
        if (this.attackTarget && entity.id === this.attackTarget.id) {
          logger.info(`Target entity is gone, stopping attack`);
          this.stopAttacking();
        }
      };
    }
    
    // Register event listeners
    this.bot.on('stoppedAttacking', this.onStoppedAttacking);
    this.bot.on('entityGone', this.onEntityGone);
    
    logger.debug("Combat event listeners registered");
  }
  
  /**
   * Manual attack implementation as fallback
   */
  async manualAttack(entity) {
    // Navigate close to the entity
    const targetPos = entity.position;
    
    try {
      const goal = new GoalNear(targetPos.x, targetPos.y, targetPos.z, 2);
      await this.botManager.pathfindingManager.setGoal(goal);
      
      // Keep attacking until entity is dead or gone
      while (entity.isValid && this.isAttacking) {
        // Check if entity is in range
        const distance = this.bot.entity.position.distanceTo(entity.position);
        
        if (distance <= this.config.combat.attackRange) {
          // Face entity and attack
          await this.bot.lookAt(entity.position.offset(0, entity.height, 0));
          this.bot.attack(entity);
          
          // Cooldown for attack
          await new Promise(resolve => setTimeout(resolve, 500));
        } else {
          // Move closer to entity
          await this.botManager.pathfindingManager.goto(entity.position);
        }
        
        // Check if we need to flee
        if (this.shouldFlee()) {
          await this.flee(entity);
          break;
        }
        
        // Short pause to prevent spam
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (error) {
      logger.error(`Error in manual attack:`, error);
    } finally {
      this.stopAttacking();
    }
  }
  
  /**
   * Stop attacking current target
   */
  stopAttacking() {
    if (this.bot.pvp) {
      this.bot.pvp.stop();
    }
    
    this.isAttacking = false;
    this.attackTarget = null;
    this.bot.removeListener('stoppedAttacking', this.onStoppedAttacking);
    this.bot.removeListener('entityGone', this.onEntityGone);
  }
  
  /**
   * Evaluate if an entity is a threat
   */
  evaluateThreat(entity) {
    if (!entity) return false;
    
    // Don't consider players as threats if they're the owner
    if (entity.type === 'player' && entity.username === this.botManager.owner) {
      return false;
    }
    
    // Check if entity is a hostile mob
    const isHostileMob = this.isHostileMob(entity);
    
    // Check if entity is attacking the bot or the owner
    const isAttackingBot = this.isEntityAttackingBot(entity);
    const isAttackingOwner = this.botManager.owner && this.isEntityAttackingPlayer(entity, this.botManager.owner);
    
    // Return true if it's a hostile mob or it's attacking
    if (isHostileMob || isAttackingBot || isAttackingOwner) {
      if (!this.isAttacking && !this.isFleeing) {
        logger.info(`Detected threat: ${entity.name || entity.username || entity.displayName}`);
        
        // If combat is enabled and the entity is close enough, attack it
        if (this.config.combat.enabled) {
          const distance = this.bot.entity.position.distanceTo(entity.position);
          
          if (distance < this.config.combat.attackRange * 2) {
            this.attackEntity(entity).catch(err => 
              logger.error(`Failed to attack threat:`, err));
          }
        }
        
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Defend the bot itself
   */
  async defendSelf() {
    logger.info('Defending self');
    this.isDefending = true;
    
    try {
      // Look for nearby threats
      const nearbyEntities = Object.values(this.bot.entities);
      let closestThreat = null;
      let closestDistance = Infinity;
      
      for (const entity of nearbyEntities) {
        // Skip non-mobs and non-players
        if (entity.type !== 'mob' && entity.type !== 'player') continue;
        
        // Skip friendly entities
        if (entity.type === 'player' && entity.username === this.bot.username) continue;
        if (entity.type === 'player' && entity.username === this.botManager.owner) continue;
        
        const isHostile = this.isHostileMob(entity);
        const isAttackingBot = this.isEntityAttackingBot(entity);
        
        if (isHostile || isAttackingBot) {
          const distance = this.bot.entity.position.distanceTo(entity.position);
          
          if (distance < closestDistance && distance < 20) {
            closestThreat = entity;
            closestDistance = distance;
          }
        }
      }
      
      // If we found a threat, attack it
      if (closestThreat) {
        this.bot.chat(`Defending myself against ${closestThreat.name || closestThreat.username || 'entity'}!`);
        await this.attackEntity(closestThreat);
      } else {
        this.bot.chat('No immediate threats detected.');
        this.isDefending = false;
      }
    } catch (error) {
      logger.error(`Error defending self:`, error);
      this.isDefending = false;
    }
  }
  
  /**
   * Defend the bot's owner
   */
  async defendOwner() {
    if (!this.botManager.owner) {
      this.bot.chat("I don't have an owner to defend.");
      return;
    }
    
    logger.info(`Defending owner: ${this.botManager.owner}`);
    this.isDefending = true;
    
    try {
      // Get owner entity
      const ownerEntity = this.bot.players[this.botManager.owner]?.entity;
      
      if (!ownerEntity) {
        this.bot.chat(`I can't see ${this.botManager.owner} to defend them.`);
        this.isDefending = false;
        return;
      }
      
      // Look for threats near the owner
      const nearbyEntities = Object.values(this.bot.entities);
      let closestThreat = null;
      let closestDistance = Infinity;
      
      for (const entity of nearbyEntities) {
        // Skip non-mobs and non-players
        if (entity.type !== 'mob' && entity.type !== 'player') continue;
        
        // Skip friendly entities
        if (entity.type === 'player' && entity.username === this.bot.username) continue;
        if (entity.type === 'player' && entity.username === this.botManager.owner) continue;
        
        const isHostile = this.isHostileMob(entity);
        const isAttackingOwner = this.isEntityAttackingPlayer(entity, this.botManager.owner);
        
        if (isHostile || isAttackingOwner) {
          const distanceToOwner = entity.position.distanceTo(ownerEntity.position);
          
          if (distanceToOwner < closestDistance && distanceToOwner < 20) {
            closestThreat = entity;
            closestDistance = distanceToOwner;
          }
        }
      }
      
      // If we found a threat, first get close to owner then attack the threat
      if (closestThreat) {
        // Get close to owner first
        const ownerPos = ownerEntity.position;
        await this.botManager.pathfindingManager.goto(ownerPos);
        
        this.bot.chat(`Defending ${this.botManager.owner} against ${closestThreat.name || closestThreat.username || 'entity'}!`);
        await this.attackEntity(closestThreat);
      } else {
        // If no threats, just stay close to owner
        this.bot.chat(`No threats detected near ${this.botManager.owner}.`);
        
        // Stay close to owner
        const ownerPos = ownerEntity.position;
        await this.botManager.pathfindingManager.goto(ownerPos);
        
        this.isDefending = false;
      }
    } catch (error) {
      logger.error(`Error defending owner:`, error);
      this.isDefending = false;
    }
  }
  
  /**
   * Flee from current combat
   */
  async flee(entity = null) {
    if (this.isFleeing) return;
    
    logger.info('Fleeing from combat');
    this.isFleeing = true;
    this.fleeingFrom = entity || this.attackTarget;
    
    // Stop attacking
    this.stopAttacking();
    
    try {
      // If there's no entity to flee from, just retreat
      if (!this.fleeingFrom) {
        this.isFleeing = false;
        return;
      }
      
      // Calculate a flee direction (away from entity)
      const fleeDirection = this.bot.entity.position.minus(this.fleeingFrom.position).normalize();
      
      // Determine a point to flee to (10-15 blocks away)
      const fleeDistance = 12 + Math.random() * 3;
      const fleeTarget = this.bot.entity.position.plus(fleeDirection.scaled(fleeDistance));
      
      this.bot.chat('Retreating!');
      
      // Try to pathfind to the flee point
      await this.botManager.pathfindingManager.goto(fleeTarget);
      
      // After reaching the flee point, check if we're healing
      const health = this.bot.health;
      
      if (health < 10) {
        this.bot.chat('Healing up...');
        // Eat food if available
        if (this.botManager.survivalBehavior) {
          await this.botManager.survivalBehavior.eat();
        }
        
        // Wait a bit to heal
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      
      this.isFleeing = false;
      this.fleeingFrom = null;
      
    } catch (error) {
      logger.error(`Error fleeing:`, error);
      this.isFleeing = false;
      this.fleeingFrom = null;
    }
  }
  
  /**
   * Check if we should flee from combat
   */
  shouldFlee() {
    // Check health
    const health = this.bot.health;
    return health <= this.config.combat.fleeHealthThreshold;
  }
  
  /**
   * Check if an entity is attacking the bot
   */
  isEntityAttackingBot(entity) {
    if (!entity) return false;
    
    // Check if entity is targeting the bot
    if (entity.entityType === this.mcData.entitiesByName.zombie?.id ||
        entity.entityType === this.mcData.entitiesByName.skeleton?.id ||
        entity.entityType === this.mcData.entitiesByName.spider?.id) {
      // For some mobs, check if they're facing the bot
      const entityPosition = entity.position;
      const botPosition = this.bot.entity.position;
      
      // Vector from entity to bot
      const toBot = botPosition.minus(entityPosition).normalize();
      // Entity's look vector (may need adjustment based on entity type)
      const entityLook = new Vec3(-Math.sin(entity.yaw), 0, -Math.cos(entity.yaw)).normalize();
      
      // Dot product to check if entity is facing bot
      const facingBot = toBot.dot(entityLook) > 0.7; // Roughly facing (cos 45 degrees)
      
      // Check distance
      const distance = entityPosition.distanceTo(botPosition);
      
      return facingBot && distance < 8; // Within reasonable attack distance
    }
    
    // For players or other entities, check if they recently attacked the bot
    if (entity.type === 'player') {
      // This would require tracking recent damage from players
      // A more sophisticated implementation would track who damaged the bot
      return false;
    }
    
    return false;
  }
  
  /**
   * Check if an entity is attacking a specific player
   */
  isEntityAttackingPlayer(entity, playerName) {
    if (!entity || !playerName) return false;
    
    const player = this.bot.players[playerName];
    if (!player || !player.entity) return false;
    
    // Similar logic to isEntityAttackingBot, but for a specific player
    const entityPosition = entity.position;
    const playerPosition = player.entity.position;
    
    // Vector from entity to player
    const toPlayer = playerPosition.minus(entityPosition).normalize();
    // Entity's look vector
    const entityLook = new Vec3(-Math.sin(entity.yaw), 0, -Math.cos(entity.yaw)).normalize();
    
    // Dot product to check if entity is facing player
    const facingPlayer = toPlayer.dot(entityLook) > 0.7; // Roughly facing
    
    // Check distance
    const distance = entityPosition.distanceTo(playerPosition);
    
    return facingPlayer && distance < 8; // Within reasonable attack distance
  }
  
  /**
   * Check if an entity is a hostile mob
   */
  isHostileMob(entity) {
    if (!entity || !entity.name) return false;
    
    const hostileMobs = [
      'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'enderman',
      'witch', 'slime', 'silverfish', 'zombie_villager', 'drowned',
      'husk', 'stray', 'phantom', 'vindicator', 'evoker', 'pillager', 'ravager',
      'vex', 'ghast', 'blaze', 'magma_cube', 'wither_skeleton', 'guardian',
      'elder_guardian', 'shulker', 'endermite', 'hoglin', 'piglin_brute', 'zoglin',
      'warden'
    ];
    
    return hostileMobs.includes(entity.name.toLowerCase());
  }
  
  /**
   * Equip the best available weapon
   */
  async equipBestWeapon() {
    try {
      // Get all items
      const items = this.bot.inventory.items();
      
      // Find first matching weapon in preference order
      let bestWeapon = null;
      
      for (const weaponName of this.weaponPreferences) {
        const weapon = items.find(item => item.name === weaponName);
        if (weapon) {
          bestWeapon = weapon;
          break;
        }
      }
      
      // If no preferred weapon found, look for any sword or axe
      if (!bestWeapon) {
        bestWeapon = items.find(item => 
          item.name.includes('_sword') || item.name.includes('_axe'));
      }
      
      // Equip the weapon if found
      if (bestWeapon) {
        await this.bot.equip(bestWeapon, 'hand');
        logger.debug(`Equipped ${bestWeapon.name} for combat`);
        return true;
      } else {
        logger.debug('No weapon found, using bare hands');
        return false;
      }
    } catch (error) {
      logger.warn(`Failed to equip weapon:`, error);
      return false;
    }
  }
  
  /**
   * Scan for threats around the bot
   */
  scanForThreats() {
    const nearbyEntities = Object.values(this.bot.entities);
    const threats = [];
    
    for (const entity of nearbyEntities) {
      // Skip non-mobs and non-players
      if (entity.type !== 'mob' && entity.type !== 'player') continue;
      
      // Skip friendly entities
      if (entity.type === 'player' && entity.username === this.bot.username) continue;
      if (entity.type === 'player' && entity.username === this.botManager.owner) continue;
      
      // Check if entity is a threat
      if (this.isHostileMob(entity) || this.isEntityAttackingBot(entity)) {
        const distance = this.bot.entity.position.distanceTo(entity.position);
        if (distance < 20) { // Only consider relatively nearby entities
          threats.push({
            entity: entity,
            distance: distance,
            type: entity.name || entity.username || 'unknown',
            isMob: entity.type === 'mob'
          });
        }
      }
    }
    
    // Sort threats by distance
    threats.sort((a, b) => a.distance - b.distance);
    
    return threats;
  }
}

module.exports = CombatBehavior;
