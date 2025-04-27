/**
 * Enchant State for Minecraft Bot
 * 
 * In this state, the bot will:
 * - Find or craft an enchanting table
 * - Gather required materials (lapis lazuli, books)
 * - Enchant tools and armor
 * - Manage experience levels
 */

// Import our custom StateBehavior base class
const StateBehavior = require('../bot/stateBehavior');
const Vec3 = require('vec3');
const logger = require('../bot/logger');

class EnchantState extends StateBehavior {
  constructor(bot, botManager) {
    super(bot, 'enchant');
    this.botManager = botManager;
    
    // State variables
    this.enchantingTablePos = null;
    this.hasBookshelvesAround = false;
    this.searchingForTable = false;
    this.enchantingTargets = [];
    this.currentEnchantTarget = null;
    this.enchantingStartTime = null;
    this.itemsEnchanted = 0;
    this.enchantingTimeout = null;
    this.maxEnchantingDuration = 10 * 60 * 1000; // 10 minutes
    this.enchantingComplete = false;
    this.targetEnchantCount = 0;
    this.lapisCount = 0;
    this.targetXpLevel = 0;
    this.isEnchanting = false;
    this.enchantmentSlotSelected = -1;
    this.slotSelectTimeout = null;
    
    // Item priority for enchanting
    this.enchantPriorities = [
      // Tools
      { type: 'diamond_pickaxe', priority: 10 },
      { type: 'diamond_sword', priority: 9 },
      { type: 'diamond_axe', priority: 8 },
      { type: 'diamond_shovel', priority: 7 },
      { type: 'diamond_hoe', priority: 3 },
      
      // Armor
      { type: 'diamond_helmet', priority: 7 },
      { type: 'diamond_chestplate', priority: 8 },
      { type: 'diamond_leggings', priority: 7 },
      { type: 'diamond_boots', priority: 7 },
      
      // Iron tools
      { type: 'iron_pickaxe', priority: 6 },
      { type: 'iron_sword', priority: 5 },
      { type: 'iron_axe', priority: 4 },
      { type: 'iron_shovel', priority: 3 },
      
      // Iron armor
      { type: 'iron_helmet', priority: 3 },
      { type: 'iron_chestplate', priority: 4 },
      { type: 'iron_leggings', priority: 3 },
      { type: 'iron_boots', priority: 3 },
      
      // Bows and fishing rods
      { type: 'bow', priority: 8 },
      { type: 'fishing_rod', priority: 5 },
      
      // Books
      { type: 'book', priority: 4 }
    ];
  }

  onStateEntered() {
    super.onStateEntered();
    logger.info('Entered enchanting state');
    
    // Initialize enchanting session
    this.enchantingStartTime = Date.now();
    this.itemsEnchanted = 0;
    this.enchantingComplete = false;
    this.isEnchanting = false;
    
    // Announce state change
    this.bot.chat('Starting enchanting activities');
    
    // Register enchantment window events
    this.registerEnchantmentEvents();
    
    // Start enchanting setup
    this.setupEnchanting();
  }

  onStateExited() {
    super.onStateExited();
    logger.info('Exited enchanting state');
    
    // Unregister event handlers
    this.unregisterEnchantmentEvents();
    
    // Close any open windows
    if (this.bot.currentWindow) {
      this.bot.closeWindow(this.bot.currentWindow);
    }
    
    // Clear any timeouts
    if (this.enchantingTimeout) {
      clearTimeout(this.enchantingTimeout);
      this.enchantingTimeout = null;
    }
    
    if (this.slotSelectTimeout) {
      clearTimeout(this.slotSelectTimeout);
      this.slotSelectTimeout = null;
    }
    
    // Report enchanting results
    if (this.itemsEnchanted > 0) {
      const duration = (Date.now() - this.enchantingStartTime) / 1000;
      this.bot.chat(`Enchanting session complete: enchanted ${this.itemsEnchanted} items in ${duration.toFixed(0)} seconds.`);
    }
    
    // Reset state variables
    this.enchantingTablePos = null;
    this.currentEnchantTarget = null;
    this.enchantingStartTime = null;
  }

  /**
   * Register event handlers for enchanting
   */
  registerEnchantmentEvents() {
    // Handler for enchantment window open
    this.bot._client.on('open_window', this.handleOpenWindow = (packet) => {
      if (packet.windowType === 'minecraft:enchantment' || packet.windowType === 'enchantment_table') {
        logger.info('Enchantment table window opened');
        
        // Process enchantment window
        setTimeout(() => this.processEnchantmentWindow(), 500);
      }
    });
    
    // Handler for enchantment window close
    this.bot._client.on('close_window', this.handleCloseWindow = (packet) => {
      if (this.isEnchanting) {
        logger.info('Enchantment table window closed');
        this.isEnchanting = false;
      }
    });
    
    // Handler for enchantment slot updates
    this.bot._client.on('set_slot', this.handleSetSlot = (packet) => {
      if (this.isEnchanting && this.bot.currentWindow) {
        // May contain enchantment information
        this.updateEnchantmentChoices();
      }
    });
  }

  /**
   * Unregister event handlers
   */
  unregisterEnchantmentEvents() {
    // Remove event handlers
    if (this.handleOpenWindow) {
      this.bot._client.removeListener('open_window', this.handleOpenWindow);
    }
    
    if (this.handleCloseWindow) {
      this.bot._client.removeListener('close_window', this.handleCloseWindow);
    }
    
    if (this.handleSetSlot) {
      this.bot._client.removeListener('set_slot', this.handleSetSlot);
    }
  }

  /**
   * Set up enchanting - find table and materials
   */
  async setupEnchanting() {
    try {
      // Check if we have an enchanting target
      await this.findItemsToEnchant();
      
      if (this.enchantingTargets.length === 0) {
        this.bot.chat("I don't have any items to enchant");
        this.enchantingComplete = true;
        return;
      }
      
      // Check if we have lapis lazuli
      this.lapisCount = this.countItem('lapis_lazuli');
      if (this.lapisCount < 3) {
        this.bot.chat(`I need more lapis lazuli for enchanting (have ${this.lapisCount}, need at least 3)`);
        // Try to mine some
        await this.findMoreLapis();
      }
      
      // Find an enchanting table
      await this.findEnchantingTable();
      
      if (!this.enchantingTablePos) {
        this.bot.chat("Couldn't find an enchanting table nearby");
        // Try to craft one
        const craftedTable = await this.tryCraftEnchantingTable();
        
        if (!craftedTable) {
          this.bot.chat("I don't have materials to craft an enchanting table either");
          this.enchantingComplete = true;
          return;
        }
      }
      
      // Check experience level
      this.checkExperienceLevel();
      
      // Set up enchanting timeout to prevent too long enchanting
      this.enchantingTimeout = setTimeout(() => {
        logger.info('Enchanting timeout reached');
        this.bot.chat('Been enchanting for a while, time to do something else');
        this.enchantingComplete = true;
      }, this.maxEnchantingDuration);
      
      // Start enchanting
      await this.moveToEnchantingTable();
    } catch (error) {
      logger.error('Error setting up enchanting:', error);
      this.bot.chat('Error setting up enchanting: ' + error.message);
    }
  }

  /**
   * Find items in our inventory that can be enchanted
   */
  async findItemsToEnchant() {
    try {
      logger.info('Looking for items to enchant');
      
      // Reset targets
      this.enchantingTargets = [];
      
      // Check each item in inventory
      for (const item of this.bot.inventory.items()) {
        // Skip already enchanted items
        if (item.enchants && item.enchants.length > 0) {
          continue;
        }
        
        // Check if it's an enchantable type
        const priority = this.getEnchantPriority(item.name);
        
        if (priority > 0) {
          this.enchantingTargets.push({
            item: item,
            name: item.name,
            priority: priority,
            slot: this.getInventorySlot(item)
          });
        }
      }
      
      // Sort by priority (highest first)
      this.enchantingTargets.sort((a, b) => b.priority - a.priority);
      
      if (this.enchantingTargets.length > 0) {
        logger.info(`Found ${this.enchantingTargets.length} items to enchant`);
        this.bot.chat(`Found ${this.enchantingTargets.length} items that I can enchant`);
        
        // Set the target count
        this.targetEnchantCount = Math.min(this.enchantingTargets.length, Math.floor(this.lapisCount / 3));
        
        // Log the highest priority items
        const topItems = this.enchantingTargets.slice(0, 3);
        logger.info(`Top items to enchant: ${topItems.map(i => i.name).join(', ')}`);
      } else {
        logger.info('No items to enchant found');
      }
    } catch (error) {
      logger.error('Error finding items to enchant:', error);
    }
  }

  /**
   * Get the priority for enchanting an item
   */
  getEnchantPriority(itemName) {
    const priorityEntry = this.enchantPriorities.find(entry => itemName === entry.type);
    return priorityEntry ? priorityEntry.priority : 0;
  }

  /**
   * Get the inventory slot number for an item
   */
  getInventorySlot(item) {
    for (let i = 0; i < this.bot.inventory.slots.length; i++) {
      const slotItem = this.bot.inventory.slots[i];
      if (slotItem && slotItem.slot === item.slot) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Try to find more lapis lazuli by mining
   */
  async findMoreLapis() {
    try {
      // Skip if we have enough lapis
      if (this.lapisCount >= 3) return;
      
      this.bot.chat('Trying to find more lapis lazuli');
      
      if (!this.botManager.miningBehavior) {
        logger.warn('No mining behavior available');
        return;
      }
      
      // Try to find and mine lapis
      const found = await this.botManager.miningBehavior.mineBlock('lapis_ore', 1);
      
      // Update lapis count
      this.lapisCount = this.countItem('lapis_lazuli');
      
      logger.info(`After mining, lapis count: ${this.lapisCount}`);
    } catch (error) {
      logger.error('Error finding more lapis:', error);
    }
  }

  /**
   * Find an enchanting table nearby
   */
  async findEnchantingTable() {
    try {
      this.searchingForTable = true;
      this.bot.chat('Looking for an enchanting table...');
      
      // Get enchanting table block ID
      const enchantingTableId = this.bot.registry.blocksByName['enchanting_table']?.id;
      
      if (!enchantingTableId) {
        logger.warn('Could not find enchanting table block ID');
        this.searchingForTable = false;
        return;
      }
      
      // Find enchanting tables around the bot
      const tablePositions = this.bot.findBlocks({
        matching: enchantingTableId,
        maxDistance: 32,
        count: 1
      });
      
      if (tablePositions.length === 0) {
        logger.info('No enchanting table found nearby');
        this.searchingForTable = false;
        return;
      }
      
      // Set the enchanting table position
      this.enchantingTablePos = tablePositions[0];
      
      // Check for bookshelves around the table
      this.checkForBookshelves();
      
      logger.info(`Found enchanting table at ${this.enchantingTablePos}`);
      this.bot.chat('Found an enchanting table' + 
                    (this.hasBookshelvesAround ? ' with bookshelves around it' : ''));
      
      this.searchingForTable = false;
    } catch (error) {
      logger.error('Error finding enchanting table:', error);
      this.searchingForTable = false;
    }
  }

  /**
   * Check for bookshelves around the enchanting table
   */
  checkForBookshelves() {
    try {
      if (!this.enchantingTablePos) return;
      
      const bookshelfId = this.bot.registry.blocksByName['bookshelf']?.id;
      if (!bookshelfId) return;
      
      // Get the position of the enchanting table
      const tablePos = this.enchantingTablePos;
      
      // Count bookshelves in the area
      let bookshelfCount = 0;
      
      // Check in a 5x5x5 area centered on the table
      for (let x = -2; x <= 2; x++) {
        for (let y = -1; y <= 1; y++) {
          for (let z = -2; z <= 2; z++) {
            // Skip positions too close to the table
            if (Math.abs(x) <= 1 && Math.abs(z) <= 1 && y === 0) continue;
            
            const checkPos = new Vec3(
              tablePos.x + x,
              tablePos.y + y,
              tablePos.z + z
            );
            
            const block = this.bot.blockAt(checkPos);
            
            if (block && block.type === bookshelfId) {
              bookshelfCount++;
            }
          }
        }
      }
      
      logger.info(`Found ${bookshelfCount} bookshelves around enchanting table`);
      this.hasBookshelvesAround = bookshelfCount > 0;
    } catch (error) {
      logger.warn('Error checking for bookshelves:', error);
    }
  }

  /**
   * Try to craft an enchanting table
   */
  async tryCraftEnchantingTable() {
    try {
      if (!this.botManager.craftingBehavior) {
        logger.warn('No crafting behavior available');
        return false;
      }
      
      this.bot.chat('Trying to craft an enchanting table');
      
      // Check if we have the materials (4 obsidian, 2 diamonds, 1 book)
      const hasObsidian = this.countItem('obsidian') >= 4;
      const hasDiamonds = this.countItem('diamond') >= 2;
      const hasBook = this.countItem('book') >= 1;
      
      if (!hasObsidian || !hasDiamonds || !hasBook) {
        logger.info(`Missing materials for enchanting table: obsidian=${hasObsidian}, diamonds=${hasDiamonds}, book=${hasBook}`);
        return false;
      }
      
      // Try to craft
      await this.botManager.craftingBehavior.craftItem('enchanting_table', 1);
      
      // If successful, try to place it
      const enchTableItem = this.bot.inventory.items().find(item => item.name === 'enchanting_table');
      
      if (enchTableItem) {
        this.bot.chat('Successfully crafted an enchanting table, now placing it');
        const placed = await this.placeEnchantingTable(enchTableItem);
        
        if (placed) {
          // Find the newly placed table
          await this.findEnchantingTable();
          return true;
        }
      }
      
      return false;
    } catch (error) {
      logger.error('Error crafting enchanting table:', error);
      return false;
    }
  }

  /**
   * Place an enchanting table
   */
  async placeEnchantingTable(tableItem) {
    try {
      // Find a suitable place near the bot
      const pos = this.bot.entity.position.floored();
      
      // Look for a solid block to place on
      let placePos = null;
      let referenceBlock = null;
      
      // Try different positions around the bot
      const offsets = [
        new Vec3(1, 0, 0),
        new Vec3(-1, 0, 0),
        new Vec3(0, 0, 1),
        new Vec3(0, 0, -1)
      ];
      
      for (const offset of offsets) {
        const blockPos = pos.plus(offset);
        const block = this.bot.blockAt(blockPos);
        
        if (block && block.boundingBox === 'block') {
          // Check if there's space above
          const abovePos = blockPos.offset(0, 1, 0);
          const aboveBlock = this.bot.blockAt(abovePos);
          
          if (aboveBlock && aboveBlock.boundingBox === 'empty') {
            placePos = abovePos;
            referenceBlock = block;
            break;
          }
        }
      }
      
      if (!placePos || !referenceBlock) {
        logger.warn('Could not find a suitable place for enchanting table');
        return false;
      }
      
      // Equip the enchanting table
      await this.bot.equip(tableItem, 'hand');
      
      // Place the table
      await this.bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
      
      logger.info(`Placed enchanting table at ${placePos}`);
      return true;
    } catch (error) {
      logger.error('Error placing enchanting table:', error);
      return false;
    }
  }

  /**
   * Check if we have enough experience levels
   */
  checkExperienceLevel() {
    const currentLevel = this.bot.experience.level;
    logger.info(`Current XP level: ${currentLevel}`);
    
    // Determine target level based on what we want to enchant
    this.targetXpLevel = 3; // Minimum for basic enchantments
    
    if (this.hasBookshelvesAround) {
      // With bookshelves, we can do better enchantments
      this.targetXpLevel = 30; // Maximum level
    }
    
    if (currentLevel < this.targetXpLevel) {
      this.bot.chat(`I need more XP levels (have ${currentLevel}, want ${this.targetXpLevel})`);
    } else {
      this.bot.chat(`I have enough XP levels (${currentLevel}) for enchanting`);
    }
  }

  /**
   * Move to the enchanting table
   */
  async moveToEnchantingTable() {
    if (!this.enchantingTablePos) return;
    
    try {
      this.bot.chat('Moving to the enchanting table...');
      
      // Find a position next to the table
      const tablePos = this.enchantingTablePos;
      
      // Try positions around the table
      const positions = [
        tablePos.offset(1, 0, 0),
        tablePos.offset(-1, 0, 0),
        tablePos.offset(0, 0, 1),
        tablePos.offset(0, 0, -1)
      ];
      
      // Filter for positions we can stand on
      const validPositions = [];
      
      for (const pos of positions) {
        const belowPos = pos.offset(0, -1, 0);
        const belowBlock = this.bot.blockAt(belowPos);
        const atPos = this.bot.blockAt(pos);
        const abovePos = pos.offset(0, 1, 0);
        const aboveBlock = this.bot.blockAt(abovePos);
        
        if (belowBlock && belowBlock.boundingBox === 'block' && // Solid block below
            atPos && atPos.boundingBox === 'empty' && // Air at position
            aboveBlock && aboveBlock.boundingBox === 'empty') { // Air above
          validPositions.push(pos);
        }
      }
      
      if (validPositions.length === 0) {
        logger.warn('No valid positions found around enchanting table');
        return;
      }
      
      // Sort by distance
      validPositions.sort((a, b) => {
        const distA = this.bot.entity.position.distanceTo(a);
        const distB = this.bot.entity.position.distanceTo(b);
        return distA - distB;
      });
      
      // Move to the closest valid position
      const targetPos = validPositions[0];
      
      if (this.bot.pathfinder) {
        await this.bot.pathfinder.goto(this.bot.pathfinder.createFlyGoal(
          targetPos.x, targetPos.y, targetPos.z, 0.5
        ));
      } else {
        // Simple move if pathfinder not available
        this.bot.chat('No pathfinder available, trying simple movement');
        
        // Look at the target
        const delta = targetPos.minus(this.bot.entity.position);
        const yaw = Math.atan2(-delta.x, delta.z);
        await this.bot.look(yaw, 0, true);
        
        // Try to move forward
        this.bot.setControlState('forward', true);
        
        // Wait a bit
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Stop moving
        this.bot.clearControlStates();
      }
      
      logger.info('Arrived at enchanting table');
      this.bot.chat('Ready to enchant');
      
      // Try to open the enchanting table
      await this.openEnchantingTable();
    } catch (error) {
      logger.error('Error moving to enchanting table:', error);
      this.bot.chat('Had trouble reaching the enchanting table: ' + error.message);
    }
  }

  /**
   * Open the enchanting table
   */
  async openEnchantingTable() {
    try {
      if (!this.enchantingTablePos) return;
      
      const tableBlock = this.bot.blockAt(this.enchantingTablePos);
      
      if (!tableBlock || tableBlock.name !== 'enchanting_table') {
        logger.warn('Enchanting table not found at saved position');
        return;
      }
      
      logger.info('Activating enchanting table');
      
      // Look at the table
      await this.bot.lookAt(this.enchantingTablePos.offset(0.5, 0.5, 0.5));
      
      // Activate it
      await this.bot.activateBlock(tableBlock);
      
      // Wait for the window to open
      this.isEnchanting = true;
    } catch (error) {
      logger.error('Error opening enchanting table:', error);
    }
  }

  /**
   * Process the enchantment window
   */
  processEnchantmentWindow() {
    // Skip if window isn't actually open
    if (!this.isEnchanting || !this.bot.currentWindow) {
      logger.warn('Enchantment window not open');
      return;
    }
    
    try {
      logger.info('Processing enchantment window');
      
      // First, select an item to enchant
      this.selectItemToEnchant();
    } catch (error) {
      logger.error('Error processing enchantment window:', error);
      this.closeEnchantmentWindow();
    }
  }

  /**
   * Select an item to enchant
   */
  async selectItemToEnchant() {
    try {
      // Skip if we've enchanted enough items
      if (this.itemsEnchanted >= this.targetEnchantCount) {
        this.bot.chat('Completed all planned enchantments');
        this.enchantingComplete = true;
        this.closeEnchantmentWindow();
        return;
      }
      
      // Make sure we have items to enchant
      if (this.enchantingTargets.length === 0) {
        await this.findItemsToEnchant();
        
        if (this.enchantingTargets.length === 0) {
          this.bot.chat('No items left to enchant');
          this.enchantingComplete = true;
          this.closeEnchantmentWindow();
          return;
        }
      }
      
      // Select the highest priority item
      this.currentEnchantTarget = this.enchantingTargets.shift();
      
      // Make sure we have lapis
      const lapisCount = this.countItem('lapis_lazuli');
      if (lapisCount < 3) {
        this.bot.chat(`Not enough lapis to enchant (have ${lapisCount}, need 3)`);
        this.closeEnchantmentWindow();
        return;
      }
      
      // Place item in the enchanting table
      logger.info(`Placing ${this.currentEnchantTarget.name} in enchanting table`);
      
      const itemToEnchant = this.bot.inventory.slots[this.currentEnchantTarget.slot];
      if (!itemToEnchant) {
        logger.warn('Item to enchant not found in inventory');
        return;
      }
      
      // Get lapis lazuli from inventory
      const lapis = this.bot.inventory.findInventoryItem(this.bot.registry.itemsByName.lapis_lazuli?.id);
      if (!lapis) {
        logger.warn('Lapis lazuli not found in inventory');
        return;
      }
      
      // Place the item in the enchanting slot
      await this.bot.putSelectedItemRange(0, 0, this.currentEnchantTarget.slot);
      
      // Place lapis in the lapis slot
      await this.bot.putSelectedItemRange(1, 0, this.getInventorySlot(lapis));
      
      // Wait for enchantment options to update
      setTimeout(() => this.selectEnchantmentLevel(), 500);
    } catch (error) {
      logger.error('Error selecting item to enchant:', error);
    }
  }

  /**
   * Update enchantment choices based on window updates
   */
  updateEnchantmentChoices() {
    // Called when the enchantment window updates
    // Not all Minecraft versions provide full enchantment details
    logger.debug('Enchantment choices updated');
  }

  /**
   * Select an enchantment level
   */
  async selectEnchantmentLevel() {
    try {
      // Make sure we still have the window open
      if (!this.isEnchanting || !this.bot.currentWindow) {
        logger.warn('Enchantment window not open when selecting level');
        return;
      }
      
      // Get current XP level
      const currentLevel = this.bot.experience.level;
      
      // Determine which slot to select based on XP level
      let slotToSelect = -1;
      
      if (currentLevel >= 30 && this.hasBookshelvesAround) {
        slotToSelect = 2; // Highest level enchantment (30 levels)
      } else if (currentLevel >= 20) {
        slotToSelect = 1; // Mid-level enchantment
      } else if (currentLevel >= 10) {
        slotToSelect = 0; // Low level enchantment
      } else {
        // Not enough XP for meaningful enchantment
        this.bot.chat('Not enough XP for a good enchantment');
        this.closeEnchantmentWindow();
        return;
      }
      
      logger.info(`Selecting enchantment level at slot ${slotToSelect}`);
      this.enchantmentSlotSelected = slotToSelect;
      
      // Click the enchantment option
      await this.bot.simpleClick.leftMouse(slotToSelect + 1);
      
      // After enchanting, count it as done
      this.itemsEnchanted++;
      
      // Show the result
      this.bot.chat(`Enchanted ${this.currentEnchantTarget.name} (${this.itemsEnchanted}/${this.targetEnchantCount})`);
      
      // Wait for the enchantment to complete
      this.slotSelectTimeout = setTimeout(() => {
        // Close the window and re-open for the next enchantment
        this.closeEnchantmentWindow();
        
        // If we have more enchantments to do, re-open the table
        if (this.enchantingTargets.length > 0 && this.itemsEnchanted < this.targetEnchantCount) {
          setTimeout(() => this.openEnchantingTable(), 1000);
        } else {
          this.bot.chat('Finished enchanting items');
          this.enchantingComplete = true;
        }
      }, 1000);
    } catch (error) {
      logger.error('Error selecting enchantment level:', error);
    }
  }

  /**
   * Close the enchantment window
   */
  closeEnchantmentWindow() {
    try {
      if (this.isEnchanting && this.bot.currentWindow) {
        this.bot.closeWindow(this.bot.currentWindow);
      }
    } catch (error) {
      logger.warn(`Error closing enchantment window: ${error.message}`);
    }
    
    // Mark window as closed
    this.isEnchanting = false;
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
   * Main update function for the enchanting state
   */
  update() {
    // Skip if we're not active
    if (!this.active) return;
    
    // If we've been enchanting for too long, consider stopping
    if (this.enchantingStartTime && Date.now() - this.enchantingStartTime > this.maxEnchantingDuration) {
      logger.info('Been enchanting for too long, finishing up');
      this.bot.chat('Been enchanting for a while, time to do something else');
      this.enchantingComplete = true;
      return;
    }
    
    // If we're not enchanting and not searching, try to restart
    if (!this.isEnchanting && !this.searchingForTable && this.enchantingTablePos && !this.enchantingComplete) {
      // Try to open the table again after a delay
      setTimeout(() => this.openEnchantingTable(), 2000);
    }
  }

  /**
   * Determine if we should transition to another state
   */
  shouldTransition(nextState) {
    // Don't transition if we just started enchanting
    if (this.enchantingStartTime && Date.now() - this.enchantingStartTime < 30000) {
      return false;
    }
    
    switch (nextState) {
      case 'idle':
        // Transition to idle if we've completed enchanting
        return this.enchantingComplete || this.itemsEnchanted >= this.targetEnchantCount;
        
      case 'mining':
        // Transition to mining if we need more lapis
        return this.lapisCount < 3 && this.enchantingTargets.length > 0;
        
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

module.exports = EnchantState;