/**
 * Enhanced Learning Module for Minecraft Bot
 * 
 * This module implements advanced learning algorithms inspired by:
 * - MakkusuOtaku/mineflayer-mother (neural network-based learning)
 * - The reinforcement learning concepts from the YouTube video
 * 
 * It extends the existing learning system with more sophisticated techniques.
 */

const logger = require('../bot/logger');
const fs = require('fs');
const path = require('path');
const Vec3 = require('vec3');

class EnhancedLearning {
  constructor(bot, mcData, config) {
    this.bot = bot;
    this.mcData = mcData;
    this.config = config;
    
    // Learning data
    this.learningData = {
      actions: {},
      states: {},
      rewards: {},
      observations: [],
      stateTransitions: {},
      neuralWeights: {},
      learningRate: 0.05,
      discountFactor: 0.9,
      explorationRate: 0.2
    };
    
    this.lastState = null;
    this.lastAction = null;
    this.lastReward = 0;
    this.cumulativeReward = 0;
    this.episodeCount = 0;
    this.episodeSteps = 0;
    this.maxEpisodeSteps = 1000;
    
    // Path to save learning data
    this.learningDataPath = path.join(process.cwd(), 'enhancedLearning.json');
    
    // Load data if available
    this.loadLearningData();
    
    // Initialize neural network weights if empty
    if (Object.keys(this.learningData.neuralWeights).length === 0) {
      this.initializeNeuralWeights();
    }
  }
  
  /**
   * Initialize neural network weights
   */
  initializeNeuralWeights() {
    // Simple 3-layer network with input, hidden, and output layers
    // Input: basic environment state features
    // Output: Q-values for different actions
    
    const inputSize = 10;  // Environment features (position, health, etc.)
    const hiddenSize = 20;
    const outputSize = 10; // Different actions
    
    // Initialize weights with small random values
    this.learningData.neuralWeights = {
      inputToHidden: Array(inputSize).fill().map(() => 
        Array(hiddenSize).fill().map(() => (Math.random() * 2 - 1) * 0.1)
      ),
      hiddenToOutput: Array(hiddenSize).fill().map(() => 
        Array(outputSize).fill().map(() => (Math.random() * 2 - 1) * 0.1)
      ),
      hiddenBias: Array(hiddenSize).fill().map(() => (Math.random() * 2 - 1) * 0.1),
      outputBias: Array(outputSize).fill().map(() => (Math.random() * 2 - 1) * 0.1)
    };
    
    logger.info('Neural network weights initialized');
  }
  
  /**
   * Load learning data from file
   */
  loadLearningData() {
    try {
      if (fs.existsSync(this.learningDataPath)) {
        const data = fs.readFileSync(this.learningDataPath, 'utf8');
        const parsedData = JSON.parse(data);
        this.learningData = { ...this.learningData, ...parsedData };
        logger.info('Enhanced learning data loaded successfully');
      } else {
        logger.info('No enhanced learning data file found, using default values');
      }
    } catch (error) {
      logger.error(`Error loading enhanced learning data: ${error.message}`);
    }
  }
  
  /**
   * Save learning data to file
   */
  saveLearningData() {
    try {
      const data = JSON.stringify(this.learningData, null, 2);
      fs.writeFileSync(this.learningDataPath, data, 'utf8');
      logger.info('Enhanced learning data saved successfully');
    } catch (error) {
      logger.error(`Error saving enhanced learning data: ${error.message}`);
    }
  }
  
  /**
   * Extract current state features from bot
   */
  getStateFeatures() {
    const features = [];
    
    try {
      // Basic positional features
      if (this.bot.entity && this.bot.entity.position) {
        const pos = this.bot.entity.position;
        features.push(pos.x / 100); // Normalize position
        features.push(pos.y / 100);
        features.push(pos.z / 100);
      } else {
        features.push(0, 0, 0);
      }
      
      // Health and food
      features.push(this.bot.health ? this.bot.health / 20 : 0);
      features.push(this.bot.food ? this.bot.food / 20 : 0);
      
      // Time of day (0-1 normalized)
      features.push((this.bot.time ? this.bot.time.timeOfDay : 0) / 24000);
      
      // Nearby entities
      const nearbyEntities = Object.values(this.bot.entities || {}).length;
      features.push(Math.min(nearbyEntities / 10, 1)); // Normalize, cap at 1
      
      // Light level
      features.push(this.bot.entity && this.bot.entity.position ? 
        (this.getLightLevel(this.bot.entity.position) / 15) : 0);
      
      // Inventory fullness
      features.push(this.bot.inventory ? 
        (this.bot.inventory.slots.filter(Boolean).length / this.bot.inventory.slots.length) : 0);
      
      // Danger level (0-1)
      features.push(this.calculateDangerLevel());
    } catch (error) {
      logger.warn(`Error getting state features: ${error.message}`);
      // Fill with zeros if there's an error
      while (features.length < 10) features.push(0);
    }
    
    return features;
  }
  
  /**
   * Calculate light level at a position
   */
  getLightLevel(position) {
    try {
      const block = this.bot.blockAt(position);
      return block && block.light ? block.light : 0;
    } catch (error) {
      return 0;
    }
  }
  
  /**
   * Calculate danger level based on environment
   */
  calculateDangerLevel() {
    let danger = 0;
    
    try {
      // Check for hostile mobs
      const hostiles = Object.values(this.bot.entities || {}).filter(entity => 
        entity && entity.type === 'mob' && 
        ['zombie', 'skeleton', 'creeper', 'spider'].includes(entity.name)
      );
      
      // Add danger for each hostile mob, weighted by distance
      if (this.bot.entity && this.bot.entity.position) {
        hostiles.forEach(mob => {
          const distance = mob.position.distanceTo(this.bot.entity.position);
          if (distance < 16) {
            danger += (16 - distance) / 16; // More danger for closer mobs
          }
        });
      }
      
      // Cap danger at 1.0
      danger = Math.min(danger, 1.0);
      
      // Add danger for low health
      if (this.bot.health && this.bot.health < 10) {
        danger += (10 - this.bot.health) / 10;
      }
      
      // Add danger for nighttime
      if (this.bot.time && this.bot.time.timeOfDay > 12000 && this.bot.time.timeOfDay < 24000) {
        danger += 0.3;
      }
      
      // Cap final danger value
      return Math.min(danger, 1.0);
    } catch (error) {
      return 0;
    }
  }
  
  /**
   * Use neural network to predict Q-values for state
   */
  predictQValues(stateFeatures) {
    // Forward pass through neural network
    try {
      const { inputToHidden, hiddenToOutput, hiddenBias, outputBias } = this.learningData.neuralWeights;
      
      // Calculate hidden layer activations
      const hiddenActivations = Array(hiddenBias.length).fill(0);
      
      for (let i = 0; i < stateFeatures.length; i++) {
        for (let j = 0; j < hiddenActivations.length; j++) {
          hiddenActivations[j] += stateFeatures[i] * inputToHidden[i][j];
        }
      }
      
      // Add bias and apply ReLU activation function
      const hiddenOutputs = hiddenActivations.map((val, i) => 
        Math.max(0, val + hiddenBias[i]));
      
      // Calculate output layer activations
      const outputActivations = Array(outputBias.length).fill(0);
      
      for (let i = 0; i < hiddenOutputs.length; i++) {
        for (let j = 0; j < outputActivations.length; j++) {
          outputActivations[j] += hiddenOutputs[i] * hiddenToOutput[i][j];
        }
      }
      
      // Add bias
      const qValues = outputActivations.map((val, i) => val + outputBias[i]);
      
      return qValues;
    } catch (error) {
      logger.warn(`Error predicting Q-values: ${error.message}`);
      return Array(10).fill(0);
    }
  }
  
  /**
   * Choose action based on state using epsilon-greedy strategy
   */
  chooseAction(state) {
    // Epsilon-greedy exploration: sometimes choose random action
    if (Math.random() < this.learningData.explorationRate) {
      const actionIds = Object.keys(this.getAvailableActions());
      const randomIndex = Math.floor(Math.random() * actionIds.length);
      return actionIds[randomIndex];
    }
    
    // Otherwise choose best action based on predicted Q-values
    const stateFeatures = this.getStateFeatures();
    const qValues = this.predictQValues(stateFeatures);
    
    // Get available actions
    const availableActions = this.getAvailableActions();
    
    // Find best action among available ones
    let bestActionId = null;
    let bestValue = -Infinity;
    
    Object.keys(availableActions).forEach((actionId, index) => {
      if (index < qValues.length && qValues[index] > bestValue) {
        bestValue = qValues[index];
        bestActionId = actionId;
      }
    });
    
    return bestActionId;
  }
  
  /**
   * Get all available actions in current state
   */
  getAvailableActions() {
    // Define basic actions
    const actions = {
      'move_forward': { 
        description: 'Move forward',
        execute: () => this.executeMovement('forward')
      },
      'move_backward': { 
        description: 'Move backward',
        execute: () => this.executeMovement('back')
      },
      'move_left': { 
        description: 'Move left',
        execute: () => this.executeMovement('left')
      },
      'move_right': { 
        description: 'Move right',
        execute: () => this.executeMovement('right')
      },
      'jump': { 
        description: 'Jump',
        execute: () => this.executeMovement('jump')
      },
      'mine_block': { 
        description: 'Mine nearest block',
        execute: () => this.mineNearestBlock()
      },
      'collect_item': { 
        description: 'Collect nearest item',
        execute: () => this.collectNearestItem()
      },
      'attack': { 
        description: 'Attack nearby entity',
        execute: () => this.attackNearestEntity()
      },
      'place_block': { 
        description: 'Place block',
        execute: () => this.placeBlock()
      },
      'look_around': { 
        description: 'Look around',
        execute: () => this.lookAround()
      }
    };
    
    return actions;
  }
  
  /**
   * Execute movement action
   */
  executeMovement(direction) {
    try {
      // Set control state for a short duration then clear it
      this.bot.setControlState(direction, true);
      
      setTimeout(() => {
        this.bot.setControlState(direction, false);
      }, 500);
      
      return true;
    } catch (error) {
      logger.warn(`Error executing movement ${direction}: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Mine nearest block
   */
  mineNearestBlock() {
    try {
      // Find blocks within reach
      const playerPos = this.bot.entity.position;
      const blocks = this.bot.findBlocks({
        matching: block => block && block.boundingBox === 'block',
        maxDistance: 4,
        count: 5
      });
      
      if (blocks.length > 0) {
        // Get closest block
        const closestBlock = blocks.reduce((closest, pos) => {
          const distToClosest = closest ? closest.distanceTo(playerPos) : Infinity;
          const distToCurrent = pos.distanceTo(playerPos);
          return distToCurrent < distToClosest ? pos : closest;
        }, null);
        
        if (closestBlock) {
          const block = this.bot.blockAt(closestBlock);
          if (block) {
            // Look at block then mine it
            this.bot.lookAt(block.position);
            setTimeout(() => {
              this.bot.dig(block).catch(err => 
                logger.warn(`Mining error: ${err.message}`)
              );
            }, 250);
            return true;
          }
        }
      }
      return false;
    } catch (error) {
      logger.warn(`Error mining nearest block: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Collect nearest item
   */
  collectNearestItem() {
    try {
      const playerPos = this.bot.entity.position;
      const items = Object.values(this.bot.entities).filter(
        entity => entity.type === 'object' && 
                 entity.objectType === 'Item' && 
                 entity.position.distanceTo(playerPos) < 16
      );
      
      if (items.length > 0) {
        // Sort by distance
        items.sort((a, b) => 
          a.position.distanceTo(playerPos) - b.position.distanceTo(playerPos)
        );
        
        // Pick closest
        const closest = items[0];
        
        // Move toward item
        this.bot.pathfinder.goto(
          this.bot.pathfinder.createFlyGoal(
            closest.position.x, closest.position.y, closest.position.z, 0.5
          )
        ).catch(err => logger.warn(`Pathing error: ${err.message}`));
        
        return true;
      }
      return false;
    } catch (error) {
      logger.warn(`Error collecting nearest item: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Attack nearest entity
   */
  attackNearestEntity() {
    try {
      const playerPos = this.bot.entity.position;
      const hostiles = Object.values(this.bot.entities).filter(
        entity => entity.type === 'mob' && 
                entity.position.distanceTo(playerPos) < 4 &&
                ['zombie', 'skeleton', 'spider', 'creeper'].includes(entity.name)
      );
      
      if (hostiles.length > 0) {
        // Sort by distance
        hostiles.sort((a, b) => 
          a.position.distanceTo(playerPos) - b.position.distanceTo(playerPos)
        );
        
        // Attack closest
        this.bot.lookAt(hostiles[0].position.offset(0, hostiles[0].height * 0.8, 0));
        setTimeout(() => {
          this.bot.attack(hostiles[0]);
        }, 250);
        
        return true;
      }
      return false;
    } catch (error) {
      logger.warn(`Error attacking nearest entity: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Place a block from inventory
   */
  placeBlock() {
    try {
      // Find a solid block to place against
      const playerPos = this.bot.entity.position.floored();
      const offsets = [
        new Vec3(1, 0, 0),
        new Vec3(-1, 0, 0),
        new Vec3(0, 0, 1),
        new Vec3(0, 0, -1)
      ];
      
      // Find placeable block in inventory
      const blocks = this.bot.inventory.items().filter(item => {
        const name = item.name;
        return !name.includes('_pickaxe') && 
               !name.includes('_axe') && 
               !name.includes('_shovel') && 
               !name.includes('_hoe') && 
               !name.includes('_sword') && 
               !name.includes('_helmet') && 
               !name.includes('_chestplate') && 
               !name.includes('_leggings') && 
               !name.includes('_boots');
      });
      
      if (blocks.length === 0) return false;
      
      // Equip the block
      this.bot.equip(blocks[0], 'hand').catch(err => 
        logger.warn(`Equip error: ${err.message}`)
      );
      
      // Check each potential placement position
      for (const offset of offsets) {
        const placeAgainstPos = playerPos.plus(offset);
        const placeAtPos = playerPos.plus(new Vec3(0, 1, 0));
        
        const blockToPlaceAgainst = this.bot.blockAt(placeAgainstPos);
        const blockAtPlacePos = this.bot.blockAt(placeAtPos);
        
        if (blockToPlaceAgainst && blockToPlaceAgainst.boundingBox === 'block' &&
            blockAtPlacePos && blockAtPlacePos.boundingBox === 'empty') {
          
          // Look at the block to place against
          this.bot.lookAt(placeAgainstPos);
          
          setTimeout(() => {
            // Place the block
            const faceVector = new Vec3(0, 1, 0);
            this.bot.placeBlock(blockToPlaceAgainst, faceVector).catch(err => 
              logger.warn(`Block placement error: ${err.message}`)
            );
          }, 250);
          
          return true;
        }
      }
      
      return false;
    } catch (error) {
      logger.warn(`Error placing block: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Look around (random direction)
   */
  lookAround() {
    try {
      const yaw = Math.random() * Math.PI * 2;
      const pitch = Math.random() * Math.PI - Math.PI / 2;
      this.bot.look(yaw, pitch);
      return true;
    } catch (error) {
      logger.warn(`Error looking around: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Update neural network weights based on reward
   */
  updateNetwork(state, action, reward, nextState) {
    try {
      const { learningRate, discountFactor } = this.learningData;
      const { inputToHidden, hiddenToOutput, hiddenBias, outputBias } = this.learningData.neuralWeights;
      
      // Current state forward pass
      const hiddenActivations = Array(hiddenBias.length).fill(0);
      for (let i = 0; i < state.length; i++) {
        for (let j = 0; j < hiddenActivations.length; j++) {
          hiddenActivations[j] += state[i] * inputToHidden[i][j];
        }
      }
      
      // Add bias and apply ReLU
      const hiddenOutputs = hiddenActivations.map((val, i) => 
        Math.max(0, val + hiddenBias[i]));
      
      // Hidden to output
      const outputActivations = Array(outputBias.length).fill(0);
      for (let i = 0; i < hiddenOutputs.length; i++) {
        for (let j = 0; j < outputActivations.length; j++) {
          outputActivations[j] += hiddenOutputs[i] * hiddenToOutput[i][j];
        }
      }
      
      // Add bias
      const currentQValues = outputActivations.map((val, i) => val + outputBias[i]);
      
      // Next state forward pass (for target Q-value)
      const nextQValues = this.predictQValues(nextState);
      const maxNextQ = Math.max(...nextQValues);
      
      // Calculate target Q-value using Q-learning update rule
      const actionIndex = parseInt(action, 10) % outputBias.length;
      const targetQ = reward + discountFactor * maxNextQ;
      const error = targetQ - currentQValues[actionIndex];
      
      // Backward pass (simplified backpropagation)
      // Update output layer weights and biases
      for (let i = 0; i < hiddenOutputs.length; i++) {
        hiddenToOutput[i][actionIndex] += learningRate * error * hiddenOutputs[i];
      }
      outputBias[actionIndex] += learningRate * error;
      
      // Update hidden layer weights and biases
      for (let i = 0; i < state.length; i++) {
        for (let j = 0; j < hiddenBias.length; j++) {
          // Only update if ReLU was active (output > 0)
          if (hiddenOutputs[j] > 0) {
            const hiddenError = error * hiddenToOutput[j][actionIndex];
            inputToHidden[i][j] += learningRate * hiddenError * state[i];
          }
        }
      }
      
      // Update hidden biases
      for (let j = 0; j < hiddenBias.length; j++) {
        if (hiddenOutputs[j] > 0) {
          const hiddenError = error * hiddenToOutput[j][actionIndex];
          hiddenBias[j] += learningRate * hiddenError;
        }
      }
      
      // Save updated weights
      this.learningData.neuralWeights = {
        inputToHidden,
        hiddenToOutput,
        hiddenBias,
        outputBias
      };
      
      // Periodically save the data
      this.episodeSteps++;
      if (this.episodeSteps % 100 === 0) {
        this.saveLearningData();
      }
      
      return error;
    } catch (error) {
      logger.warn(`Error updating network: ${error.message}`);
      return 0;
    }
  }
  
  /**
   * Calculate reward based on state change
   */
  calculateReward(oldState, newState, actionResult) {
    let reward = 0;
    
    try {
      // Base reward on action success
      reward += actionResult ? 0.1 : -0.05;
      
      // If we have valid state data
      if (oldState && newState && oldState.length >= 5 && newState.length >= 5) {
        // Reward for health gain, penalize for health loss
        const oldHealth = oldState[3] * 20;
        const newHealth = newState[3] * 20;
        reward += (newHealth - oldHealth) * 0.5;
        
        // Reward for food gain, penalize for food loss
        const oldFood = oldState[4] * 20;
        const newFood = newState[4] * 20;
        reward += (newFood - oldFood) * 0.3;
        
        // Reward for inventory changes (feature 8)
        const oldInventory = oldState[8];
        const newInventory = newState[8];
        reward += (newInventory - oldInventory) * 2.0;
        
        // Penalize for increased danger
        const oldDanger = oldState[9];
        const newDanger = newState[9];
        reward -= (newDanger - oldDanger) * 0.5;
      }
      
      // Small penalty for doing nothing
      reward -= 0.01;
      
      return reward;
    } catch (error) {
      logger.warn(`Error calculating reward: ${error.message}`);
      return 0;
    }
  }
  
  /**
   * Run a learning step
   */
  step() {
    try {
      // Get current state
      const currentState = this.getStateFeatures();
      
      // Choose action
      const actionId = this.chooseAction(currentState);
      const actions = this.getAvailableActions();
      
      // Execute action
      let actionResult = false;
      if (actions[actionId] && typeof actions[actionId].execute === 'function') {
        actionResult = actions[actionId].execute();
      }
      
      // Short delay to allow action to affect the world
      setTimeout(() => {
        // Get new state
        const newState = this.getStateFeatures();
        
        // Calculate reward
        const reward = this.calculateReward(currentState, newState, actionResult);
        this.cumulativeReward += reward;
        
        // Update Q-network
        this.updateNetwork(currentState, actionId, reward, newState);
        
        // Save state for next step
        this.lastState = newState;
        this.lastAction = actionId;
        this.lastReward = reward;
        
        // Check if episode should end
        if (this.episodeSteps >= this.maxEpisodeSteps) {
          this.endEpisode();
        }
      }, 500);
      
      return actionResult;
    } catch (error) {
      logger.error(`Error in learning step: ${error.message}`);
      return false;
    }
  }
  
  /**
   * End current learning episode
   */
  endEpisode() {
    try {
      this.episodeCount++;
      logger.info(`Learning episode ${this.episodeCount} completed with reward: ${this.cumulativeReward}`);
      
      // Record episode data
      this.learningData.observations.push({
        episode: this.episodeCount,
        steps: this.episodeSteps,
        reward: this.cumulativeReward,
        timestamp: Date.now()
      });
      
      // Trim observations if we have too many
      if (this.learningData.observations.length > 100) {
        this.learningData.observations = this.learningData.observations.slice(-100);
      }
      
      // Reset episode tracking
      this.episodeSteps = 0;
      this.cumulativeReward = 0;
      
      // Lower exploration rate over time (annealing)
      this.learningData.explorationRate = Math.max(
        0.05, 
        this.learningData.explorationRate * 0.99
      );
      
      // Save data at end of episode
      this.saveLearningData();
      
    } catch (error) {
      logger.error(`Error ending learning episode: ${error.message}`);
    }
  }
  
  /**
   * Get learning progress statistics
   */
  getStats() {
    const stats = {
      episodes: this.episodeCount,
      currentExplorationRate: this.learningData.explorationRate,
      lastReward: this.lastReward,
      cumulativeReward: this.cumulativeReward,
      episodeSteps: this.episodeSteps
    };
    
    // Add recent episode statistics if available
    if (this.learningData.observations.length > 0) {
      const recentEpisodes = this.learningData.observations.slice(-5);
      stats.recentEpisodeRewards = recentEpisodes.map(episode => episode.reward);
      stats.averageReward = recentEpisodes.reduce((sum, ep) => sum + ep.reward, 0) / recentEpisodes.length;
    }
    
    return stats;
  }
}

module.exports = EnhancedLearning;