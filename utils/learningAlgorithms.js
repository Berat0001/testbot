/**
 * Learning Algorithms Utility
 * 
 * Provides reinforcement learning algorithms for the bot's decision-making.
 */

const logger = require('../bot/logger');

class LearningAlgorithms {
  constructor() {
    // This is a static utility class, no need for constructor logic
  }
}

/**
 * Q-learning algorithm implementation
 * 
 * Q-learning is a model-free reinforcement learning algorithm that learns
 * the value of an action in a particular state.
 */
LearningAlgorithms.qLearning = {
  /**
   * Initialize Q-table for a set of states and actions
   * 
   * @param {Array} states - Array of possible states
   * @param {Array} actions - Array of possible actions
   * @param {Number} initialValue - Initial Q-value for all state-action pairs
   * @returns {Object} Q-table mapping states and actions to values
   */
  initQTable(states, actions, initialValue = 0) {
    const qTable = {};
    
    for (const state of states) {
      qTable[state] = {};
      for (const action of actions) {
        qTable[state][action] = initialValue;
      }
    }
    
    return qTable;
  },
  
  /**
   * Select an action based on the current state using an epsilon-greedy policy
   * 
   * @param {String} state - Current state
   * @param {Object} qTable - Q-table mapping states and actions to values
   * @param {Array} actions - Array of possible actions
   * @param {Number} epsilon - Exploration rate (0-1)
   * @returns {String} Selected action
   */
  selectAction(state, qTable, actions, epsilon = 0.1) {
    // Ensure state exists in the Q-table
    if (!qTable[state]) {
      logger.warn(`State "${state}" not found in Q-table, initializing with zeros`);
      qTable[state] = {};
      for (const action of actions) {
        qTable[state][action] = 0;
      }
    }
    
    // Exploration: select a random action with probability epsilon
    if (Math.random() < epsilon) {
      const randomIndex = Math.floor(Math.random() * actions.length);
      return actions[randomIndex];
    }
    
    // Exploitation: select the action with the highest Q-value
    let bestAction = actions[0];
    let bestValue = qTable[state][bestAction] || 0;
    
    for (let i = 1; i < actions.length; i++) {
      const action = actions[i];
      const value = qTable[state][action] || 0;
      
      if (value > bestValue) {
        bestAction = action;
        bestValue = value;
      }
    }
    
    return bestAction;
  },
  
  /**
   * Update Q-value for a state-action pair based on the received reward
   * 
   * @param {String} state - Current state
   * @param {String} action - Action taken
   * @param {Number} reward - Reward received
   * @param {String} nextState - Next state
   * @param {Object} qTable - Q-table mapping states and actions to values
   * @param {Number} learningRate - How quickly new information overrides old (0-1)
   * @param {Number} discountFactor - Importance of future rewards (0-1)
   * @returns {Object} Updated Q-table
   */
  updateQValue(state, action, reward, nextState, qTable, learningRate = 0.1, discountFactor = 0.9) {
    // Ensure states exist in the Q-table
    if (!qTable[state]) {
      qTable[state] = {};
    }
    
    if (!qTable[nextState]) {
      qTable[nextState] = {};
    }
    
    // Ensure action exists in both states
    if (qTable[state][action] === undefined) {
      qTable[state][action] = 0;
    }
    
    // Find the max Q-value for the next state
    let maxNextQ = -Infinity;
    for (const nextAction in qTable[nextState]) {
      const value = qTable[nextState][nextAction];
      if (value > maxNextQ) {
        maxNextQ = value;
      }
    }
    
    // If no next actions, use 0
    if (maxNextQ === -Infinity) {
      maxNextQ = 0;
    }
    
    // Update Q-value using the Q-learning formula
    const oldValue = qTable[state][action];
    const newValue = oldValue + learningRate * (reward + discountFactor * maxNextQ - oldValue);
    
    qTable[state][action] = newValue;
    
    return qTable;
  }
};

/**
 * Multi-armed bandit algorithm implementation
 * 
 * This is a simpler form of reinforcement learning where the agent tries
 * to balance exploration and exploitation with limited information.
 */
LearningAlgorithms.multiArmedBandit = {
  /**
   * Initialize bandit data for a set of actions
   * 
   * @param {Array} actions - Array of possible actions
   * @returns {Object} Bandit data with counts and values for each action
   */
  initBandit(actions) {
    const bandit = {
      counts: {},
      values: {}
    };
    
    for (const action of actions) {
      bandit.counts[action] = 0;
      bandit.values[action] = 0;
    }
    
    return bandit;
  },
  
  /**
   * Select an action using epsilon-greedy strategy
   * 
   * @param {Object} bandit - Bandit data with counts and values
   * @param {Array} actions - Array of possible actions
   * @param {Number} epsilon - Exploration rate (0-1)
   * @returns {String} Selected action
   */
  selectAction(bandit, actions, epsilon = 0.1) {
    // Exploration: select a random action with probability epsilon
    if (Math.random() < epsilon) {
      const randomIndex = Math.floor(Math.random() * actions.length);
      return actions[randomIndex];
    }
    
    // Exploitation: select the action with the highest value
    let bestAction = actions[0];
    let bestValue = bandit.values[bestAction] || 0;
    
    for (let i = 1; i < actions.length; i++) {
      const action = actions[i];
      const value = bandit.values[action] || 0;
      
      if (value > bestValue) {
        bestAction = action;
        bestValue = value;
      }
    }
    
    return bestAction;
  },
  
  /**
   * Update bandit data based on the received reward
   * 
   * @param {Object} bandit - Bandit data with counts and values
   * @param {String} action - Action taken
   * @param {Number} reward - Reward received
   * @returns {Object} Updated bandit data
   */
  updateValues(bandit, action, reward) {
    // Ensure action exists in bandit data
    if (bandit.counts[action] === undefined) {
      bandit.counts[action] = 0;
      bandit.values[action] = 0;
    }
    
    // Increment count for this action
    bandit.counts[action]++;
    
    // Update running average for this action
    const count = bandit.counts[action];
    const oldValue = bandit.values[action];
    const newValue = oldValue + (reward - oldValue) / count;
    
    bandit.values[action] = newValue;
    
    return bandit;
  }
};

/**
 * Dynamic difficulty adjustment
 * 
 * This adjusts parameters based on performance metrics to maintain
 * an optimal learning and performance curve.
 */
LearningAlgorithms.dynamicDifficulty = {
  /**
   * Adjust exploration rate (epsilon) based on recent performance
   * 
   * @param {Number} currentEpsilon - Current exploration rate
   * @param {Number} successRate - Recent success rate (0-1)
   * @param {Number} targetSuccessRate - Target success rate (0-1)
   * @param {Number} adjustmentFactor - How quickly to adjust (0-1)
   * @returns {Number} New epsilon value
   */
  adjustExplorationRate(currentEpsilon, successRate, targetSuccessRate = 0.7, adjustmentFactor = 0.05) {
    // If success rate is below target, increase exploration
    // If success rate is above target, decrease exploration
    const delta = (targetSuccessRate - successRate) * adjustmentFactor;
    let newEpsilon = currentEpsilon + delta;
    
    // Clamp epsilon between 0.01 and 0.5
    newEpsilon = Math.max(0.01, Math.min(0.5, newEpsilon));
    
    return newEpsilon;
  },
  
  /**
   * Normalize rewards to prevent reward inflation
   * 
   * @param {Number} reward - Raw reward value
   * @param {Array} recentRewards - Array of recent reward values
   * @returns {Number} Normalized reward value
   */
  normalizeReward(reward, recentRewards) {
    if (recentRewards.length === 0) {
      return reward;
    }
    
    // Calculate mean and standard deviation of recent rewards
    const mean = recentRewards.reduce((sum, val) => sum + val, 0) / recentRewards.length;
    
    // Standard deviation calculation
    const variance = recentRewards.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / recentRewards.length;
    const stdDev = Math.sqrt(variance) || 1; // Prevent division by zero
    
    // Normalize reward using z-score
    const normalizedReward = (reward - mean) / stdDev;
    
    // Scale to reasonable range (-1 to 1)
    return Math.max(-1, Math.min(1, normalizedReward));
  }
};

module.exports = LearningAlgorithms;