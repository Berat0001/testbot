/**
 * Custom StateBehavior base class for all bot states
 * 
 * This class provides a base implementation that all state
 * classes can extend from, with common functionality.
 */

class StateBehavior {
  /**
   * Create a new state behavior
   * @param {object} bot - The Mineflayer bot instance
   * @param {string} name - The name of this state
   */
  constructor(bot, name) {
    this.bot = bot;
    this.name = name;
    this.active = false;
  }

  /**
   * Called when the bot enters this state
   */
  onStateEntered() {
    this.active = true;
  }

  /**
   * Called when the bot exits this state
   */
  onStateExited() {
    this.active = false;
  }

  /**
   * Called each tick while this state is active
   */
  update() {
    // Override in derived classes
  }

  /**
   * Check if we should transition to the specified state
   * @param {string} nextState - The name of the next state to consider
   * @returns {boolean} - True if we should transition, false otherwise
   */
  shouldTransition(nextState) {
    // Override in derived classes
    return false;
  }
}

module.exports = StateBehavior;