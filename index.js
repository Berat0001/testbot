/**
 * Advanced Minecraft Bot - Main Entry Point
 * 
 * This is the main entry point for the Minecraft bot using Mineflayer
 * with multiple extensions for autonomous operation.
 */

const config = require('./config');
const MinecraftBot = require('./bot/bot');
const logger = require('./bot/logger');
const webServer = require('./web/server');

// Initialize the logger
logger.init(config.logging);

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}`);
  logger.error(err.stack);
  
  // If configured to do so, restart the bot
  if (config.autoRestart) {
    logger.info('Restarting bot due to uncaught exception...');
    startBot();
  } else {
    process.exit(1);
  }
});

// Main function to start the bot
async function startBot() {
  try {
    logger.info('Starting Minecraft Bot...');
    const bot = new MinecraftBot(config);
    await bot.initialize();
    
    // Start the web server if enabled
    if (config.webServer.enabled) {
      webServer.start(bot, config.webServer.port);
    }
    
    return bot;
  } catch (error) {
    logger.error('Failed to start bot:', error);
    
    if (config.autoRestart) {
      logger.info(`Trying to restart in ${config.restartDelay / 1000} seconds...`);
      setTimeout(startBot, config.restartDelay);
    }
  }
}

// Start the bot when this script is run directly
if (require.main === module) {
  startBot();
}

module.exports = { startBot };
