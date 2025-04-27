/**
 * Configuration for the Minecraft Bot
 */

module.exports = {
  // Bot connection settings
  server: {
    host: process.env.MC_SERVER_HOST || "31.57.77.215",
    port: parseInt(process.env.MC_SERVER_PORT || "25565", 10),
    version: process.env.MC_VERSION || false, // Auto-detect version by default
    auth: process.env.MC_AUTH_TYPE || "offline", // 'offline', 'microsoft', 'mojang'
  },

  // Bot credentials
  credentials: {
    username: process.env.MC_USERNAME || "AdvancedBot",
    password: process.env.MC_PASSWORD || "", // Only needed for online-mode
  },

  // Chat settings
  chat: {
    commandPrefix: "!",
    logChat: true,
    respondToAll: false,
    respondToWhispers: true,
    allowedUsers: process.env.MC_ALLOWED_USERS
      ? process.env.MC_ALLOWED_USERS.split(",")
      : [], // Empty array means all users
  },

  // Movement settings
  movement: {
    defaultMovementSpeed: 1.0,
    jumpSpeed: 0.3,
    sprintSpeed: 1.3,
    maxPathfindingDistance: 100,
    avoidFallDistance: 4,
  },

  // Combat settings
  combat: {
    enabled: true,
    attackRange: 3,
    attackMobs: true,
    attackHostileMobsOnly: true,
    defendOwner: true,
    avoidDamage: true,
    fleeHealthThreshold: 7,
  },

  // Auto-eat settings
  autoEat: {
    enabled: true,
    priority: "foodPoints", // 'saturation' or 'foodPoints'
    startAt: 14, // Start eating when hunger is below this value
    bannedFood: ["rotten_flesh", "spider_eye", "poisonous_potato"],
  },

  // Mining settings
  mining: {
    enabled: true,
    preferredTools: true,
    mineFluidBlocks: false,
    avoidLavaAndWater: true,
    collectDrops: true,
    maxMiningDistance: 30,
  },

  // Crafting settings
  crafting: {
    enabled: true,
    autoCraftTools: true,
    prioritizeBetterTools: true,
    keepStockOf: {
      wooden_pickaxe: 1,
      stone_pickaxe: 1,
      wooden_axe: 1,
      stone_axe: 1,
      crafting_table: 1,
      torch: 16,
    },
  },

  // Inventory management
  inventory: {
    dumpExcessItems: true,
    keepItems: [], // Items the bot should never throw away
    itemsToKeep: {
      // Category-based item quantities to keep
      tools: { max: 5 },
      weapons: { max: 3 },
      armor: { max: 4 },
      food: { max: 64 },
      blocks: { max: 256 },
    },
  },

  // State machine configuration
  stateMachine: {
    defaultState: "idle",
    transitions: {
      // Define state transition triggers
      // Key: from state, value: array of possible next states
      idle: ["mining", "combat", "gather", "follow", "explore"],
      mining: ["idle", "combat", "gather", "craft"],
      combat: ["idle", "flee", "follow"],
      gather: ["idle", "mining", "combat", "craft"],
      craft: ["idle", "mining", "gather"],
      follow: ["idle", "combat", "gather"],
      build: ["idle", "gather", "craft"],
      explore: ["idle", "mining", "combat", "gather"],
    },
  },

  // Plugin system configuration
  plugins: {
    enabled: true,
    loadPluginsAtStartup: true,
    pluginsDirectory: "plugins",
    loadList: [
      'autoFarmer', 
      'autoResponder', 
      'commandHandler',
      'learningBehavior',
      'aiAssistant',
      'intelligentDecision',
      'botMother',
      'teleportCommands'
    ],

    // Individual plugin configurations
    CommandHandler: {
      enabled: true,
      commandPrefix: "!",
      respondToWhispers: true,
      ownerCommands: ["reload", "disable", "enable", "reloadconfig"],
    },

    AutoResponder: {
      enabled: true,
      patterns: [
        {
          pattern: /hello|hi|hey|howdy/i,
          responses: ["Hello!", "Hi there!", "Hey!", "Greetings!"],
          cooldown: 60000, // 1 minute
        },
        {
          pattern: /what are you doing|what's up/i,
          responses: [
            "Just exploring around!",
            "Looking for resources.",
            "Following my programming!",
          ],
          cooldown: 30000, // 30 seconds
        },
        {
          pattern: /who are you|what are you/i,
          responses: [
            "I'm an autonomous Minecraft bot!",
            "I'm a bot designed to help in Minecraft.",
          ],
          cooldown: 30000, // 30 seconds
        },
      ],
      greetings: ["Hello!", "Hi there!", "Hey!", "Greetings!", "Good day!"],
      questions: [
        "I'm not sure about that.",
        "That's an interesting question.",
        "I'll have to think about that.",
        "I don't know, sorry!",
      ],
    },

    AutoFarmer: {
      enabled: true,
      autoStart: false,
      checkInterval: 10000,
      breedAnimals: true,
      breedingCooldown: 300000,
      farmArea: null, // Will be set by commands
    },
    
    LearningBehavior: {
      enabled: true,
      learningEnabled: true,
      learningRate: 0.1,
      explorationRate: 0.2,
      autoDecide: true,
      decisionInterval: 60000, // 1 minute
      logStats: true,
      statsInterval: 300000, // 5 minutes
      analyzePerformance: true,
      persistData: true
    },
    
    AIAssistant: {
      enabled: true,
      enableAI: true,
      debugMode: true,
      taskTimeout: 60000, // 60 seconds
      maxMemoryItems: 100,
      learningRate: 0.1,
      useMinecraftData: true
    },
    
    IntelligentDecision: {
      enabled: true,
      autonomousMode: true,
      decisionInterval: 30000, // 30 seconds
      taskTimeout: 60000, // 1 minute
      debugMode: true,
    },
    
    BotMother: {
      enabled: true,
      learningEnabled: true,
      autonomousActions: true,
      learningInterval: 5000, // 5 seconds between learning steps
      commandCooldown: 10000 // 10 seconds between autonomous commands
    },
  },

  // Viewer settings (prismarine-viewer)
  viewer: {
    enabled: process.env.ENABLE_VIEWER === "true",
    port: parseInt(process.env.VIEWER_PORT || "5000", 10),
    firstPerson: false,
  },

  // Web inventory settings
  webInventory: {
    enabled: process.env.ENABLE_WEB_INVENTORY === "true",
    port: parseInt(process.env.WEB_INVENTORY_PORT || "3001", 10),
  },

  // Web server settings for dashboard
  webServer: {
    enabled: true,
    port: 5000, // Use port 5000 for Replit
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || "info", // 'debug', 'info', 'warn', 'error'
    logToConsole: true,
    logToFile: true,
    logFileName: "minecraft-bot.log",
  },

  // Auto reconnect & restart settings
  autoReconnect: true,
  reconnectDelay: 5000, // 5 seconds
  maxReconnectAttempts: 10,
  autoRestart: true,
  restartDelay: 10000, // 10 seconds
};
