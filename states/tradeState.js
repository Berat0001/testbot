/**
 * Trade State for Minecraft Bot
 * 
 * In this state, the bot will:
 * - Find villagers to trade with
 * - Evaluate trade offers
 * - Execute beneficial trades
 * - Build up emerald reserves
 */

// Import our custom StateBehavior base class
const StateBehavior = require('../bot/stateBehavior');
const Vec3 = require('vec3');
const logger = require('../bot/logger');

class TradeState extends StateBehavior {
  constructor(bot, botManager) {
    super(bot, 'trade');
    this.botManager = botManager;
    
    // State variables
    this.currentVillager = null;
    this.targetVillager = null;
    this.villagerTimeout = null;
    this.tradesCompleted = 0;
    this.emeraldsGained = 0;
    this.emeraldsSpent = 0;
    this.lastTradingAttempt = 0;
    this.lastVillagerSearch = 0;
    this.tradeWindowOpen = false;
    this.villagerSearchRadius = 32;
    this.tradingStartTime = null;
    this.villagerProfessions = [
      "farmer", "fisherman", "shepherd", "fletcher", "librarian",
      "cartographer", "cleric", "armorer", "weaponsmith", "toolsmith",
      "butcher", "leatherworker", "mason", "nitwit"
    ];
    this.valuableGoods = {
      "enchanted_book": 10,
      "diamond_sword": 8,
      "diamond_pickaxe": 8,
      "diamond_axe": 8,
      "diamond_helmet": 7,
      "diamond_chestplate": 7,
      "diamond_leggings": 7,
      "diamond_boots": 7,
      "golden_apple": 6,
      "experience_bottle": 5,
      "name_tag": 5,
      "diamond": 4,
      "iron_ingot": 3,
      "gold_ingot": 3
    };
    this.desiredItems = [];
    this.emeraldTarget = 64; // Target emerald count
  }

  onStateEntered() {
    super.onStateEntered();
    logger.info('Entered trading state');
    
    // Initialize trading session
    this.tradingStartTime = Date.now();
    this.tradesCompleted = 0;
    this.emeraldsGained = 0;
    this.emeraldsSpent = 0;
    this.tradeWindowOpen = false;
    
    // Set up villager event handlers
    this.registerVillagerEvents();
    
    // Announce state change
    this.bot.chat('Looking for villagers to trade with');
    
    // Set target items from config if available
    if (this.botManager.config.trading?.desiredItems) {
      this.desiredItems = [...this.botManager.config.trading.desiredItems];
    }
    
    // Initialize by searching for villagers
    this.searchForVillagers();
  }

  onStateExited() {
    super.onStateExited();
    logger.info('Exited trading state');
    
    // Remove event handlers
    this.unregisterVillagerEvents();
    
    // Close trading window if open
    if (this.tradeWindowOpen) {
      this.closeTradeWindow();
    }
    
    // Clear any pending timeouts
    if (this.villagerTimeout) {
      clearTimeout(this.villagerTimeout);
      this.villagerTimeout = null;
    }
    
    // Report trading results
    if (this.tradesCompleted > 0) {
      const duration = (Date.now() - this.tradingStartTime) / 1000;
      const emeraldNet = this.emeraldsGained - this.emeraldsSpent;
      const profitMessage = emeraldNet >= 0 ? `gained ${emeraldNet}` : `spent ${-emeraldNet}`;
      
      this.bot.chat(`Trading session complete: ${this.tradesCompleted} trades in ${duration.toFixed(0)} seconds, ${profitMessage} emeralds`);
    }
    
    // Reset state variables
    this.currentVillager = null;
    this.targetVillager = null;
    this.tradingStartTime = null;
  }

  /**
   * Register event handlers for villager trading
   */
  registerVillagerEvents() {
    // Handler for trade window open
    this.bot._client.on('open_window', this.handleOpenWindow = (packet) => {
      if (packet.windowType === 'minecraft:villager' || packet.windowType === 'minecraft:merchant') {
        logger.info('Villager trade window opened');
        this.tradeWindowOpen = true;
        
        // Process trade window
        setTimeout(() => this.processTradeWindow(), 500);
      }
    });
    
    // Handler for trade window close
    this.bot._client.on('close_window', this.handleCloseWindow = (packet) => {
      if (this.tradeWindowOpen) {
        logger.info('Villager trade window closed');
        this.tradeWindowOpen = false;
        this.currentVillager = null;
      }
    });
    
    // Handler for trade list updates
    this.bot._client.on('trade_list', this.handleTradeList = (packet) => {
      logger.info(`Received trade list with ${packet.trades?.length || 0} trades`);
      // Trade list processing is handled in processTradeWindow
    });
  }

  /**
   * Unregister event handlers
   */
  unregisterVillagerEvents() {
    // Remove event handlers
    if (this.handleOpenWindow) {
      this.bot._client.removeListener('open_window', this.handleOpenWindow);
    }
    
    if (this.handleCloseWindow) {
      this.bot._client.removeListener('close_window', this.handleCloseWindow);
    }
    
    if (this.handleTradeList) {
      this.bot._client.removeListener('trade_list', this.handleTradeList);
    }
  }

  /**
   * Main update function for the trading state
   */
  update() {
    // Skip if we're not active
    if (!this.active) return;
    
    const now = Date.now();
    
    // If we don't have a target villager, search for one periodically
    if (!this.targetVillager && now - this.lastVillagerSearch > 10000) {
      this.searchForVillagers();
      this.lastVillagerSearch = now;
    }
    
    // If we have a target villager but we're not trading, move to it
    if (this.targetVillager && !this.tradeWindowOpen) {
      this.moveToVillager();
    }
    
    // If we've been in trading state too long with no success, consider exiting
    if (this.tradesCompleted === 0 && now - this.tradingStartTime > 2 * 60 * 1000) {
      logger.info('No trades completed after 2 minutes, considering exiting trading state');
      // We'll let the shouldTransition method handle this
    }
  }

  /**
   * Search for villagers to trade with
   */
  searchForVillagers() {
    try {
      logger.info('Searching for villagers');
      
      // Get entities around the bot
      const villagers = Object.values(this.bot.entities).filter(entity => {
        // Check if it's a villager
        if (entity.name !== 'villager') return false;
        
        // Check distance
        const distance = entity.position.distanceTo(this.bot.entity.position);
        return distance <= this.villagerSearchRadius;
      });
      
      if (villagers.length === 0) {
        logger.info('No villagers found nearby');
        return;
      }
      
      // Sort by distance
      villagers.sort((a, b) => {
        const distA = a.position.distanceTo(this.bot.entity.position);
        const distB = b.position.distanceTo(this.bot.entity.position);
        return distA - distB;
      });
      
      // Select the closest villager as our target
      this.targetVillager = villagers[0];
      
      // Get profession if available
      let profession = "unknown";
      if (this.targetVillager.metadata && Array.isArray(this.targetVillager.metadata)) {
        // Villager profession is typically in metadata - implementation may vary by server
        for (const meta of this.targetVillager.metadata) {
          if (meta && typeof meta === 'object' && meta.villagerProfession) {
            profession = meta.villagerProfession;
            break;
          }
        }
      }
      
      logger.info(`Found villager (${profession}) at distance ${this.targetVillager.position.distanceTo(this.bot.entity.position).toFixed(1)}`);
      
    } catch (error) {
      logger.error('Error searching for villagers:', error);
    }
  }

  /**
   * Move to the target villager
   */
  async moveToVillager() {
    // Skip if we're already trading or if no target
    if (this.tradeWindowOpen || !this.targetVillager) return;
    
    // Skip if the target is no longer valid
    if (!this.bot.entities[this.targetVillager.id]) {
      logger.info('Target villager no longer exists');
      this.targetVillager = null;
      return;
    }
    
    try {
      // Skip if we're already moving
      if (this.bot.pathfinder.isMoving()) return;
      
      // Get current distance to the villager
      const distance = this.targetVillager.position.distanceTo(this.bot.entity.position);
      
      // If we're close enough, try to trade
      if (distance < 3) {
        this.initiateTradeWithVillager();
        return;
      }
      
      // Move to the villager
      logger.info(`Moving to villager at ${this.targetVillager.position.toFixed(1)}`);
      
      await this.bot.pathfinder.goto(this.bot.pathfinder.createMoveToEntityGoal(
        this.targetVillager, 2 // Get within 2 blocks
      ));
      
      // After arriving, try to trade
      this.initiateTradeWithVillager();
    } catch (error) {
      logger.warn(`Error moving to villager: ${error.message}`);
      
      // If pathfinding failed, try a simple approach
      if (this.targetVillager) {
        this.bot.lookAt(this.targetVillager.position);
        this.bot.setControlState('forward', true);
        
        // Stop after a short time
        setTimeout(() => {
          this.bot.clearControlStates();
          // Try to trade after stopping
          this.initiateTradeWithVillager();
        }, 1000);
      }
    }
  }

  /**
   * Initiate trading with the target villager
   */
  async initiateTradeWithVillager() {
    // Skip if we're already trading
    if (this.tradeWindowOpen) return;
    
    // Skip if no target or if too soon since last attempt
    if (!this.targetVillager || Date.now() - this.lastTradingAttempt < 3000) return;
    
    try {
      logger.info('Initiating trade with villager');
      this.lastTradingAttempt = Date.now();
      
      // Set current villager
      this.currentVillager = this.targetVillager;
      
      // Right-click on villager to open trade window
      await this.bot.lookAt(this.targetVillager.position.offset(0, 1, 0));
      await this.bot.useEntity(this.targetVillager);
      
      // Set a timeout to clear the trading attempt if window doesn't open
      this.villagerTimeout = setTimeout(() => {
        if (!this.tradeWindowOpen) {
          logger.warn('Trade window did not open, resetting');
          this.currentVillager = null;
          this.villagerTimeout = null;
        }
      }, 5000);
    } catch (error) {
      logger.error('Error initiating trade with villager:', error);
      this.currentVillager = null;
    }
  }

  /**
   * Process the open trade window
   */
  processTradeWindow() {
    // Skip if window isn't actually open
    if (!this.tradeWindowOpen) return;
    
    try {
      // Check if we have a valid window
      if (!this.bot.currentWindow) {
        logger.warn('Trade window reference not found');
        return;
      }
      
      logger.info('Processing trade window');
      
      // Get available trades
      const trades = this.bot.currentWindow.trades;
      
      if (!trades || trades.length === 0) {
        logger.warn('No trades available from this villager');
        this.closeTradeWindow();
        return;
      }
      
      logger.info(`Villager offers ${trades.length} trades`);
      
      // Evaluate trades and execute beneficial ones
      this.evaluateAndExecuteTrades(trades);
    } catch (error) {
      logger.error('Error processing trade window:', error);
      this.closeTradeWindow();
    }
  }

  /**
   * Evaluate trades and execute the most beneficial ones
   */
  async evaluateAndExecuteTrades(trades) {
    try {
      // Get our current emerald count
      const emeraldCount = this.countItem('emerald');
      logger.info(`Current emerald count: ${emeraldCount}`);
      
      // Different strategies based on our emerald count
      if (emeraldCount < 10) {
        // We have few emeralds - focus on selling items to gain emeralds
        await this.executeSellTrades(trades);
      } else if (emeraldCount > this.emeraldTarget) {
        // We have excess emeralds - prioritize buying valuable items
        await this.executeBuyTrades(trades);
      } else {
        // We have a moderate number of emeralds - do a mix of trading
        await this.executeBalancedTrades(trades);
      }
      
      // Close the window after trading
      this.closeTradeWindow();
    } catch (error) {
      logger.error('Error evaluating trades:', error);
      this.closeTradeWindow();
    }
  }

  /**
   * Execute trades to sell items for emeralds
   */
  async executeSellTrades(trades) {
    try {
      logger.info('Looking for trades to gain emeralds');
      
      // Filter for trades where we sell items for emeralds
      const sellTrades = trades.filter(trade => {
        // Check if trade outputs emeralds
        return trade.outputItem.name === 'emerald' && 
               // And we have the required input items
               this.canMakeTrade(trade);
      });
      
      if (sellTrades.length === 0) {
        logger.info('No viable sell trades found');
        return;
      }
      
      // Sort by emerald gain (high to low)
      sellTrades.sort((a, b) => {
        return b.outputItem.count - a.outputItem.count;
      });
      
      // Execute the best trades
      for (const trade of sellTrades) {
        // Skip if locked
        if (trade.disabled) continue;
        
        // Skip if we can't make this trade
        if (!this.canMakeTrade(trade)) continue;
        
        const inputDesc = trade.inputItem.name + 
          (trade.inputItem2 ? ` and ${trade.inputItem2.name}` : '');
        const outputDesc = `${trade.outputItem.count} emerald${trade.outputItem.count > 1 ? 's' : ''}`;
        
        logger.info(`Trading ${inputDesc} for ${outputDesc}`);
        
        try {
          // Make the trade
          await this.tradeOnce(trades.indexOf(trade));
          
          // Update counters
          this.tradesCompleted++;
          this.emeraldsGained += trade.outputItem.count;
          
          // Check if we've reached our target emerald count
          if (this.countItem('emerald') >= this.emeraldTarget) {
            logger.info(`Reached target emerald count: ${this.countItem('emerald')}`);
            return;
          }
          
          // Check if we can make the trade again
          if (!this.canMakeTrade(trade)) {
            logger.info('Cannot make this trade again');
            continue;
          }
        } catch (error) {
          logger.warn(`Error executing trade: ${error.message}`);
        }
      }
    } catch (error) {
      logger.error('Error executing sell trades:', error);
    }
  }

  /**
   * Execute trades to buy valuable items with emeralds
   */
  async executeBuyTrades(trades) {
    try {
      logger.info('Looking for trades to buy valuable items');
      
      // Filter for trades where we buy items with emeralds
      const buyTrades = trades.filter(trade => {
        // Check if trade requires emeralds
        return (trade.inputItem.name === 'emerald' || 
                (trade.inputItem2 && trade.inputItem2.name === 'emerald')) && 
               // And outputs something valuable
               this.isValuableOutput(trade.outputItem) &&
               // And we have enough emeralds
               this.canMakeTrade(trade);
      });
      
      if (buyTrades.length === 0) {
        logger.info('No viable buy trades found');
        return;
      }
      
      // Sort by value (high to low)
      buyTrades.sort((a, b) => {
        return this.getItemValue(b.outputItem) - this.getItemValue(a.outputItem);
      });
      
      // Execute the best trades
      for (const trade of buyTrades) {
        // Skip if locked
        if (trade.disabled) continue;
        
        // Skip if we can't make this trade
        if (!this.canMakeTrade(trade)) continue;
        
        // Skip if we'll go below our minimum emerald reserve
        const emeraldCost = trade.inputItem.name === 'emerald' ? 
          trade.inputItem.count : 
          (trade.inputItem2 && trade.inputItem2.name === 'emerald' ? trade.inputItem2.count : 0);
        
        if (this.countItem('emerald') - emeraldCost < 10) {
          logger.info('Keeping minimum emerald reserve');
          return;
        }
        
        const outputItem = trade.outputItem;
        logger.info(`Trading ${emeraldCost} emeralds for ${outputItem.count} ${outputItem.name}`);
        
        try {
          // Make the trade
          await this.tradeOnce(trades.indexOf(trade));
          
          // Update counters
          this.tradesCompleted++;
          this.emeraldsSpent += emeraldCost;
        } catch (error) {
          logger.warn(`Error executing trade: ${error.message}`);
        }
      }
    } catch (error) {
      logger.error('Error executing buy trades:', error);
    }
  }

  /**
   * Execute a balanced mix of trading
   */
  async executeBalancedTrades(trades) {
    try {
      logger.info('Executing balanced trades');
      
      // First, see if we need any specific items
      if (this.desiredItems.length > 0) {
        // Try to buy desired items first
        const desiredTrades = trades.filter(trade => 
          this.desiredItems.includes(trade.outputItem.name) &&
          this.canMakeTrade(trade)
        );
        
        for (const trade of desiredTrades) {
          if (trade.disabled) continue;
          
          const emeraldCost = trade.inputItem.name === 'emerald' ? 
            trade.inputItem.count : 
            (trade.inputItem2 && trade.inputItem2.name === 'emerald' ? trade.inputItem2.count : 0);
          
          // Skip if we'd spend too many emeralds
          if (this.countItem('emerald') - emeraldCost < 5) continue;
          
          logger.info(`Trading for desired item: ${trade.outputItem.name}`);
          
          try {
            await this.tradeOnce(trades.indexOf(trade));
            this.tradesCompleted++;
            if (emeraldCost > 0) this.emeraldsSpent += emeraldCost;
          } catch (error) {
            logger.warn(`Error trading for desired item: ${error.message}`);
          }
        }
      }
      
      // Then, make profitable trades to gain emeralds
      await this.executeSellTrades(trades);
      
      // Finally, if we have excess emeralds, buy valuable items
      if (this.countItem('emerald') > this.emeraldTarget) {
        await this.executeBuyTrades(trades);
      }
    } catch (error) {
      logger.error('Error executing balanced trades:', error);
    }
  }

  /**
   * Execute a single trade transaction
   */
  async tradeOnce(tradeIndex) {
    try {
      // Execute the trade
      await this.bot.trade(tradeIndex, 1); // 1 is the count
      
      // Wait for transaction to complete
      await new Promise(resolve => setTimeout(resolve, 500));
      
      logger.info('Trade completed successfully');
      return true;
    } catch (error) {
      logger.error(`Error executing trade: ${error.message}`);
      return false;
    }
  }

  /**
   * Close the trading window
   */
  closeTradeWindow() {
    try {
      if (this.tradeWindowOpen && this.bot.currentWindow) {
        this.bot.closeWindow(this.bot.currentWindow);
      }
    } catch (error) {
      logger.warn(`Error closing trade window: ${error.message}`);
    }
    
    // Mark window as closed regardless of success
    this.tradeWindowOpen = false;
    this.currentVillager = null;
  }

  /**
   * Check if we can make a trade
   */
  canMakeTrade(trade) {
    try {
      // Skip disabled trades
      if (trade.disabled) return false;
      
      // Check if we have the first input item
      const hasInput1 = this.hasEnoughItems(trade.inputItem.name, trade.inputItem.count);
      if (!hasInput1) return false;
      
      // Check if we have the second input item if required
      if (trade.inputItem2 && trade.inputItem2.count > 0) {
        const hasInput2 = this.hasEnoughItems(trade.inputItem2.name, trade.inputItem2.count);
        if (!hasInput2) return false;
      }
      
      // Check if we have space for the output
      // This is simplified - a more accurate implementation would check for stackability
      const freeSlots = this.bot.inventory.emptySlotCount();
      if (freeSlots < 1) return false;
      
      return true;
    } catch (error) {
      logger.warn(`Error checking if trade is possible: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if we have enough of a specific item
   */
  hasEnoughItems(itemName, count) {
    return this.countItem(itemName) >= count;
  }

  /**
   * Count how many of a specific item we have
   */
  countItem(itemName) {
    let count = 0;
    
    try {
      // Count matching items in inventory
      for (const item of this.bot.inventory.items()) {
        if (item.name === itemName) {
          count += item.count;
        }
      }
    } catch (error) {
      logger.warn(`Error counting items: ${error.message}`);
    }
    
    return count;
  }

  /**
   * Check if an output item is valuable
   */
  isValuableOutput(item) {
    // Check if it's in our valuable goods list
    if (this.valuableGoods[item.name]) return true;
    
    // Check if it's in our desired items
    if (this.desiredItems.includes(item.name)) return true;
    
    // Check for enchanted items
    if (item.enchants && item.enchants.length > 0) return true;
    
    // Other heuristics for valuable items
    if (item.name.includes('diamond_')) return true;
    if (item.name.includes('enchanted_')) return true;
    if (item.name === 'diamond') return true;
    
    return false;
  }

  /**
   * Get the value of an item for trade prioritization
   */
  getItemValue(item) {
    // Start with base value from our config
    let value = this.valuableGoods[item.name] || 0;
    
    // Multiply by count
    value *= item.count;
    
    // Add value for enchantments
    if (item.enchants && item.enchants.length > 0) {
      value += item.enchants.length * 5;
      
      // Add extra for specific valuable enchantments
      for (const enchant of item.enchants) {
        if (['mending', 'unbreaking', 'fortune', 'efficiency', 'looting', 'infinity'].includes(enchant.name)) {
          value += enchant.lvl * 3;
        }
      }
    }
    
    // Extra value for priority desired items
    if (this.desiredItems.includes(item.name)) {
      value += 10;
    }
    
    return value;
  }

  /**
   * Determine if we should transition to another state
   */
  shouldTransition(nextState) {
    // Don't transition if we're actively trading
    if (this.tradeWindowOpen) return false;
    
    // Force transitions based on next state
    switch (nextState) {
      case 'idle':
        // Transition to idle if we've been trading unsuccessfully for too long
        if (this.tradesCompleted === 0 && Date.now() - this.tradingStartTime > 2 * 60 * 1000) {
          return true;
        }
        // Or if we have no target and haven't found any villagers
        if (!this.targetVillager && Date.now() - this.lastVillagerSearch > 30000) {
          return true;
        }
        return false;
        
      case 'combat':
        // Always transition to combat if needed
        return this.botManager.combatBehavior && 
               this.botManager.combatBehavior.scanForThreats().length > 0;
        
      case 'follow':
        // Always follow owner if requested
        return this.botManager.owner !== null;
        
      default:
        return false;
    }
  }
}

module.exports = TradeState;