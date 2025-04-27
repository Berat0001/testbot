/**
 * Learning Manager
 * 
 * Manages learning algorithms and provides decision-making capabilities for the bot.
 */

const logger = require('../bot/logger');
const DataStore = require('./dataStore');
const LearningAlgorithms = require('./learningAlgorithms');

class LearningManager {
  constructor(config = {}) {
    this.config = {
      dataFileName: 'botLearning.json',
      learningRate: 0.1,
      discountFactor: 0.9,
      explorationRate: 0.1,
      adjustDifficulty: true,
      targetSuccessRate: 0.7,
      ...config
    };
    
    // Initialize data store for persistence
    this.dataStore = new DataStore(this.config.dataFileName);
    this.dataStore.load();
    
    // Initialize learning data
    this.initLearningData();
    
    // Performance metrics
    this.recentOutcomes = [];
    this.recentRewards = [];
    this.maxOutcomesToTrack = 100;
    this.maxRewardsToTrack = 100;
    
    // Learning states
    this.states = this.dataStore.get('states', []);
    this.actions = this.dataStore.get('actions', []);
    this.currentState = 'idle';
    this.currentAction = null;
    this.lastReward = 0;
    
    logger.info(`Learning Manager initialized with ${this.states.length} states and ${this.actions.length} actions`);
  }

  /**
   * Initialize or load learning data
   */
  initLearningData() {
    // Get or create Q-table
    this.qTable = this.dataStore.get('qTable', null);
    
    // Get state-action mapping
    this.stateActionMap = this.dataStore.get('stateActionMap', {});
    
    // Get multi-armed bandit data for state selection
    this.stateBandit = this.dataStore.get('stateBandit', null);
    
    // If no Q-table, create one - but we need states and actions first
    if (!this.qTable && this.dataStore.get('states') && this.dataStore.get('actions')) {
      const states = this.dataStore.get('states');
      const actions = this.dataStore.get('actions');
      
      this.qTable = LearningAlgorithms.qLearning.initQTable(states, actions);
      this.dataStore.set('qTable', this.qTable);
    }
    
    // If no state bandit, create one
    if (!this.stateBandit && this.dataStore.get('states')) {
      const states = this.dataStore.get('states');
      this.stateBandit = LearningAlgorithms.multiArmedBandit.initBandit(states);
      this.dataStore.set('stateBandit', this.stateBandit);
    }
    
    // Get hyperparameters
    this.learningParams = this.dataStore.get('learningParams', {
      learningRate: this.config.learningRate,
      discountFactor: this.config.discountFactor,
      explorationRate: this.config.explorationRate
    });
    
    // Save any updates
    this.saveData();
  }

  /**
   * Save all learning data
   */
  saveData() {
    this.dataStore.set('qTable', this.qTable, false);
    this.dataStore.set('stateActionMap', this.stateActionMap, false);
    this.dataStore.set('stateBandit', this.stateBandit, false);
    this.dataStore.set('learningParams', this.learningParams, false);
    this.dataStore.set('states', this.states, false);
    this.dataStore.set('actions', this.actions, false);
    this.dataStore.save();
  }

  /**
   * Register available states
   */
  registerStates(states) {
    // Add only new states
    for (const state of states) {
      if (!this.states.includes(state)) {
        this.states.push(state);
      }
    }
    
    // Update Q-table if it exists
    if (this.qTable) {
      for (const state of states) {
        if (!this.qTable[state]) {
          this.qTable[state] = {};
          
          // Initialize Q-values for all actions in this state
          for (const action of this.actions) {
            this.qTable[state][action] = 0;
          }
        }
      }
    } else {
      // Create new Q-table if none exists
      this.qTable = LearningAlgorithms.qLearning.initQTable(this.states, this.actions);
    }
    
    // Update state bandit if it exists
    if (this.stateBandit) {
      for (const state of states) {
        if (this.stateBandit.counts[state] === undefined) {
          this.stateBandit.counts[state] = 0;
          this.stateBandit.values[state] = 0;
        }
      }
    } else {
      // Create new state bandit if none exists
      this.stateBandit = LearningAlgorithms.multiArmedBandit.initBandit(this.states);
    }
    
    // Update state-action map
    for (const state of states) {
      if (!this.stateActionMap[state]) {
        this.stateActionMap[state] = [...this.actions]; // Default: all actions are valid
      }
    }
    
    // Save updates
    this.dataStore.set('states', this.states, false);
    this.saveData();
    
    logger.info(`Registered ${states.length} states, total: ${this.states.length}`);
  }

  /**
   * Register available actions
   */
  registerActions(actions) {
    // Add only new actions
    for (const action of actions) {
      if (!this.actions.includes(action)) {
        this.actions.push(action);
      }
    }
    
    // Update Q-table if it exists
    if (this.qTable) {
      for (const state in this.qTable) {
        for (const action of actions) {
          if (this.qTable[state][action] === undefined) {
            this.qTable[state][action] = 0;
          }
        }
      }
    } else {
      // Create new Q-table if none exists
      this.qTable = LearningAlgorithms.qLearning.initQTable(this.states, this.actions);
    }
    
    // Update state-action map
    for (const state in this.stateActionMap) {
      for (const action of actions) {
        if (!this.stateActionMap[state].includes(action)) {
          this.stateActionMap[state].push(action);
        }
      }
    }
    
    // For any states without action mappings, create default mappings
    for (const state of this.states) {
      if (!this.stateActionMap[state]) {
        this.stateActionMap[state] = [...this.actions];
      }
    }
    
    // Save updates
    this.dataStore.set('actions', this.actions, false);
    this.saveData();
    
    logger.info(`Registered ${actions.length} actions, total: ${this.actions.length}`);
  }

  /**
   * Set valid actions for a specific state
   */
  setStateActions(state, validActions) {
    if (!this.states.includes(state)) {
      logger.warn(`Cannot set actions for unknown state: ${state}`);
      return false;
    }
    
    // Validate that all actions are registered
    for (const action of validActions) {
      if (!this.actions.includes(action)) {
        logger.warn(`Cannot add unknown action: ${action} to state: ${state}`);
        return false;
      }
    }
    
    // Update state-action map
    this.stateActionMap[state] = [...validActions];
    
    // Save updates
    this.saveData();
    
    logger.debug(`Set ${validActions.length} valid actions for state: ${state}`);
    return true;
  }

  /**
   * Record an outcome (success or failure)
   */
  recordOutcome(success) {
    this.recentOutcomes.push(success ? 1 : 0);
    
    // Keep only the most recent outcomes
    if (this.recentOutcomes.length > this.maxOutcomesToTrack) {
      this.recentOutcomes.shift();
    }
    
    // Adjust learning parameters if enabled
    if (this.config.adjustDifficulty) {
      this.adjustLearningParameters();
    }
  }

  /**
   * Record a reward value
   */
  recordReward(reward) {
    this.recentRewards.push(reward);
    
    // Keep only the most recent rewards
    if (this.recentRewards.length > this.maxRewardsToTrack) {
      this.recentRewards.shift();
    }
    
    // Update last reward
    this.lastReward = reward;
  }

  /**
   * Calculate success rate from recent outcomes
   */
  getSuccessRate() {
    if (this.recentOutcomes.length === 0) {
      return 0.5; // Default to neutral if no data
    }
    
    const successCount = this.recentOutcomes.filter(outcome => outcome === 1).length;
    return successCount / this.recentOutcomes.length;
  }

  /**
   * Adjust learning parameters based on performance
   */
  adjustLearningParameters() {
    const successRate = this.getSuccessRate();
    
    // Adjust exploration rate
    this.learningParams.explorationRate = LearningAlgorithms.dynamicDifficulty.adjustExplorationRate(
      this.learningParams.explorationRate,
      successRate,
      this.config.targetSuccessRate
    );
    
    // Save updates
    this.dataStore.set('learningParams', this.learningParams);
    
    logger.debug(`Adjusted exploration rate to ${this.learningParams.explorationRate.toFixed(4)} (success rate: ${successRate.toFixed(2)})`);
  }

  /**
   * Select the next state for the bot based on learning
   */
  selectNextState() {
    // If we don't have any states, return null
    if (this.states.length === 0) {
      return null;
    }
    
    // Use multi-armed bandit to select state
    const nextState = LearningAlgorithms.multiArmedBandit.selectAction(
      this.stateBandit,
      this.states,
      this.learningParams.explorationRate
    );
    
    logger.debug(`Selected next state: ${nextState} (exploration rate: ${this.learningParams.explorationRate.toFixed(2)})`);
    return nextState;
  }

  /**
   * Select the best action for the current state
   */
  selectAction(state) {
    // If no state provided, use current state
    state = state || this.currentState;
    
    // If state doesn't exist, return null
    if (!this.states.includes(state)) {
      logger.warn(`Cannot select action for unknown state: ${state}`);
      return null;
    }
    
    // Get valid actions for this state
    const validActions = this.stateActionMap[state] || this.actions;
    
    // If no valid actions, return null
    if (validActions.length === 0) {
      logger.warn(`No valid actions for state: ${state}`);
      return null;
    }
    
    // Use Q-learning to select action
    const action = LearningAlgorithms.qLearning.selectAction(
      state,
      this.qTable,
      validActions,
      this.learningParams.explorationRate
    );
    
    // Set as current action
    this.currentAction = action;
    
    logger.debug(`Selected action: ${action} for state: ${state}`);
    return action;
  }

  /**
   * Update learning based on experience
   */
  updateLearning(state, action, reward, nextState) {
    // If any parameters are missing, use current values
    state = state || this.currentState;
    action = action || this.currentAction;
    reward = reward !== undefined ? reward : this.lastReward;
    
    // If state or action don't exist, nothing to update
    if (!this.states.includes(state) || !this.actions.includes(action)) {
      logger.warn(`Cannot update learning for unknown state-action pair: ${state}-${action}`);
      return false;
    }
    
    // Normalize reward if we have enough data
    if (this.recentRewards.length > 5) {
      reward = LearningAlgorithms.dynamicDifficulty.normalizeReward(reward, this.recentRewards);
    }
    
    // Update Q-table
    this.qTable = LearningAlgorithms.qLearning.updateQValue(
      state,
      action,
      reward,
      nextState || state,
      this.qTable,
      this.learningParams.learningRate,
      this.learningParams.discountFactor
    );
    
    // Update state bandit
    this.stateBandit = LearningAlgorithms.multiArmedBandit.updateValues(
      this.stateBandit,
      state,
      reward
    );
    
    // Update current state
    this.currentState = nextState || state;
    
    // Record outcome (positive reward = success)
    this.recordOutcome(reward > 0);
    
    // Record reward
    this.recordReward(reward);
    
    // Save updates
    this.saveData();
    
    logger.debug(`Updated learning for state: ${state}, action: ${action}, reward: ${reward.toFixed(2)}, next state: ${nextState || 'same'}`);
    return true;
  }

  /**
   * Get the best action for a state based on current learning
   */
  getBestAction(state) {
    state = state || this.currentState;
    
    // If state doesn't exist in Q-table, return null
    if (!this.qTable[state]) {
      return null;
    }
    
    // Get valid actions for this state
    const validActions = this.stateActionMap[state] || this.actions;
    
    // Find action with highest Q-value
    let bestAction = null;
    let bestValue = -Infinity;
    
    for (const action of validActions) {
      const value = this.qTable[state][action] || 0;
      if (value > bestValue) {
        bestValue = value;
        bestAction = action;
      }
    }
    
    return bestAction;
  }

  /**
   * Get all Q-values for a specific state
   */
  getStateValues(state) {
    state = state || this.currentState;
    
    // If state doesn't exist in Q-table, return empty object
    if (!this.qTable[state]) {
      return {};
    }
    
    // Get valid actions for this state
    const validActions = this.stateActionMap[state] || this.actions;
    
    // Create a map of action to Q-value
    const values = {};
    for (const action of validActions) {
      values[action] = this.qTable[state][action] || 0;
    }
    
    return values;
  }

  /**
   * Reset all learning data
   */
  resetLearning() {
    // Clear Q-table
    this.qTable = LearningAlgorithms.qLearning.initQTable(this.states, this.actions);
    
    // Clear state bandit
    this.stateBandit = LearningAlgorithms.multiArmedBandit.initBandit(this.states);
    
    // Reset learning parameters
    this.learningParams = {
      learningRate: this.config.learningRate,
      discountFactor: this.config.discountFactor,
      explorationRate: this.config.explorationRate
    };
    
    // Clear performance metrics
    this.recentOutcomes = [];
    this.recentRewards = [];
    
    // Reset current state and action
    this.currentState = 'idle';
    this.currentAction = null;
    this.lastReward = 0;
    
    // Save updates
    this.saveData();
    
    logger.info('Reset all learning data');
    return true;
  }
}

module.exports = LearningManager;