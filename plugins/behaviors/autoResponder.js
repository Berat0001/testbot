/**
 * Auto Responder Plugin
 * 
 * Automatically responds to chat messages based on configured patterns.
 */

const BasePlugin = require('../basePlugin');

class AutoResponderPlugin extends BasePlugin {
  constructor(bot, config, pluginManager) {
    super(bot, config, pluginManager);
    
    // Override base properties
    this.name = 'AutoResponder';
    this.description = 'Automatically responds to chat messages based on patterns';
    this.version = '1.0.0';
    this.author = 'Replit';
    
    // Plugin-specific properties
    this.responsePatterns = [];
    this.greetingResponses = [];
    this.questionResponses = [];
  }

  /**
   * Initialize the plugin
   */
  async initialize() {
    this.info('Initializing Auto Responder plugin');
    
    // Load response patterns from config
    this.loadResponsePatterns();
    
    // Register event handlers
    this.registerEvent('chat', this.handleChatMessage);
    this.registerEvent('whisper', this.handleWhisperMessage);
    
    this.isEnabled = true;
    this.info('Auto Responder plugin initialized');
    return true;
  }

  /**
   * Load response patterns from config
   */
  loadResponsePatterns() {
    // Default patterns
    this.responsePatterns = [
      {
        pattern: /hello|hi|hey|howdy/i,
        responses: ['Hello!', 'Hi there!', 'Hey!', 'Greetings!'],
        cooldown: 60000 // 1 minute cooldown
      },
      {
        pattern: /help/i,
        responses: ['I\'m a bot! You can control me with commands.', 'Try using the !help command to see what I can do.'],
        cooldown: 30000 // 30 second cooldown
      }
    ];
    
    // Load patterns from config if available
    if (this.config.patterns && Array.isArray(this.config.patterns)) {
      this.responsePatterns = [
        ...this.responsePatterns,
        ...this.config.patterns
      ];
    }
    
    // Load greeting responses
    this.greetingResponses = this.config.greetings || [
      'Hello!', 'Hi there!', 'Hey!', 'Greetings!', 'Good day!'
    ];
    
    // Load question responses
    this.questionResponses = this.config.questions || [
      'I\'m not sure about that.', 'That\'s an interesting question.',
      'I\'ll have to think about that.', 'I don\'t know, sorry!'
    ];
    
    this.info(`Loaded ${this.responsePatterns.length} response patterns`);
  }

  /**
   * Handle chat messages
   */
  handleChatMessage = (username, message) => {
    // Skip messages from the bot itself
    if (username === this.bot.username) return;
    
    // Check if bot's username is mentioned
    const isMentioned = message.toLowerCase().includes(this.bot.username.toLowerCase());
    
    // If not mentioned, check if chat message matches any pattern
    if (!isMentioned) {
      this.checkPatterns(username, message, false);
      return;
    }
    
    // Handle direct mentions differently
    this.handleMention(username, message);
  }

  /**
   * Handle whisper messages
   */
  handleWhisperMessage = (username, message) => {
    // Skip messages from the bot itself
    if (username === this.bot.username) return;
    
    // Whispers are always treated as direct communication
    this.checkPatterns(username, message, true);
  }

  /**
   * Check if a message matches any response patterns
   */
  checkPatterns(username, message, isWhisper) {
    const now = Date.now();
    
    // Try to match against patterns
    for (const pattern of this.responsePatterns) {
      if (pattern.pattern.test(message)) {
        // Check if pattern is on cooldown
        if (pattern.lastUsed && (now - pattern.lastUsed) < pattern.cooldown) {
          this.debug(`Pattern matched but on cooldown: ${pattern.pattern}`);
          continue;
        }
        
        // Choose a random response from the list
        const response = this.getRandomItem(pattern.responses);
        
        // Update last used time
        pattern.lastUsed = now;
        
        // Send the response
        if (isWhisper) {
          this.bot.whisper(username, response);
        } else {
          this.bot.chat(response);
        }
        
        this.debug(`Responded to pattern match: ${pattern.pattern}`);
        return true;
      }
    }
    
    return false;
  }

  /**
   * Handle direct mentions of the bot
   */
  handleMention(username, message) {
    // Try standard patterns first
    if (this.checkPatterns(username, message, false)) {
      return;
    }
    
    // If no patterns matched, use more contextual response logic
    
    // Check if it's a question
    if (message.includes('?')) {
      const response = this.getRandomItem(this.questionResponses);
      this.bot.chat(response);
      return;
    }
    
    // Check if it seems like a greeting
    const greetingPatterns = /\b(hi|hello|hey|greetings|howdy)\b/i;
    if (greetingPatterns.test(message)) {
      const response = this.getRandomItem(this.greetingResponses);
      this.bot.chat(response);
      return;
    }
    
    // Default response if nothing else matched
    this.bot.chat(`I'm not sure how to respond to that, ${username}.`);
  }

  /**
   * Get a random item from an array
   */
  getRandomItem(array) {
    if (!array || array.length === 0) return null;
    return array[Math.floor(Math.random() * array.length)];
  }

  /**
   * Shutdown the plugin
   */
  async shutdown() {
    this.info('Shutting down Auto Responder plugin');
    
    // Unregister all events
    this.unregisterAllEvents();
    
    this.isEnabled = false;
    this.info('Auto Responder plugin shut down');
    return true;
  }
}

module.exports = AutoResponderPlugin;