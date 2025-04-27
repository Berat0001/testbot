/**
 * Constants for the Minecraft Bot
 */

// Export useful constant values and configurations
module.exports = {
  // Block categories for mining
  blockCategories: {
    ores: [
      'coal_ore', 'deepslate_coal_ore',
      'iron_ore', 'deepslate_iron_ore',
      'copper_ore', 'deepslate_copper_ore',
      'gold_ore', 'deepslate_gold_ore',
      'redstone_ore', 'deepslate_redstone_ore',
      'diamond_ore', 'deepslate_diamond_ore',
      'lapis_ore', 'deepslate_lapis_ore',
      'emerald_ore', 'deepslate_emerald_ore',
      'nether_gold_ore', 'nether_quartz_ore',
      'ancient_debris'
    ],
    wood: [
      'oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log',
      'mangrove_log', 'cherry_log', 'crimson_stem', 'warped_stem'
    ],
    stone: [
      'stone', 'granite', 'diorite', 'andesite', 'deepslate', 
      'calcite', 'tuff', 'dripstone_block'
    ],
    soil: [
      'dirt', 'grass_block', 'podzol', 'mycelium', 'mud', 'clay',
      'sand', 'red_sand', 'gravel', 'soul_sand', 'soul_soil'
    ],
  },
  
  // Tool categories and efficiency mappings
  toolEfficiency: {
    pickaxe: ['stone', 'cobblestone', 'ores', 'metal_blocks', 'obsidian'],
    axe: ['wood', 'logs', 'planks', 'wooden_items'],
    shovel: ['dirt', 'sand', 'gravel', 'clay', 'snow'],
    sword: ['cobweb', 'bamboo'],
    shears: ['wool', 'leaves', 'vines'],
    hoe: ['crops', 'leaves', 'hay'],
  },
  
  // Tool tier progression
  toolTiers: ['wooden', 'stone', 'iron', 'golden', 'diamond', 'netherite'],
  
  // Tool durability
  toolDurability: {
    wooden: 59,
    stone: 131,
    iron: 250,
    golden: 32,
    diamond: 1561,
    netherite: 2031,
  },
  
  // Mob categories for combat
  mobCategories: {
    passive: [
      'cow', 'pig', 'sheep', 'chicken', 'rabbit', 'horse', 'donkey', 'llama', 
      'fox', 'bat', 'bee', 'cat', 'mooshroom', 'ocelot', 'panda', 'parrot',
      'polar_bear', 'squid', 'strider', 'turtle', 'dolphin', 'axolotl', 'goat'
    ],
    neutral: [
      'wolf', 'spider', 'cave_spider', 'enderman', 'zombified_piglin', 'goat',
      'bee', 'iron_golem', 'llama', 'panda', 'polar_bear', 'trader_llama'
    ],
    hostile: [
      'zombie', 'skeleton', 'creeper', 'slime', 'spider', 'cave_spider', 'witch',
      'phantom', 'drowned', 'enderman', 'silverfish', 'zombie_villager', 'blaze',
      'ghast', 'magma_cube', 'wither_skeleton', 'guardian', 'elder_guardian', 
      'shulker', 'husk', 'stray', 'pillager', 'ravager', 'vindicator', 'evoker', 
      'vex', 'endermite', 'hoglin', 'piglin', 'piglin_brute', 'zoglin', 'warden'
    ],
    boss: [
      'ender_dragon', 'wither'
    ],
  },
  
  // Food values
  foodValues: {
    apple: { hunger: 4, saturation: 2.4 },
    baked_potato: { hunger: 5, saturation: 6.0 },
    beetroot: { hunger: 1, saturation: 1.2 },
    beetroot_soup: { hunger: 6, saturation: 7.2 },
    bread: { hunger: 5, saturation: 6.0 },
    carrot: { hunger: 3, saturation: 3.6 },
    cooked_beef: { hunger: 8, saturation: 12.8 },
    cooked_chicken: { hunger: 6, saturation: 7.2 },
    cooked_cod: { hunger: 5, saturation: 6.0 },
    cooked_mutton: { hunger: 6, saturation: 9.6 },
    cooked_porkchop: { hunger: 8, saturation: 12.8 },
    cooked_rabbit: { hunger: 5, saturation: 6.0 },
    cooked_salmon: { hunger: 6, saturation: 9.6 },
    cookie: { hunger: 2, saturation: 0.4 },
    dried_kelp: { hunger: 1, saturation: 0.6 },
    golden_apple: { hunger: 4, saturation: 9.6 },
    golden_carrot: { hunger: 6, saturation: 14.4 },
    honey_bottle: { hunger: 6, saturation: 1.2 },
    melon_slice: { hunger: 2, saturation: 1.2 },
    mushroom_stew: { hunger: 6, saturation: 7.2 },
    potato: { hunger: 1, saturation: 0.6 },
    pumpkin_pie: { hunger: 8, saturation: 4.8 },
    rabbit_stew: { hunger: 10, saturation: 12.0 },
    rotten_flesh: { hunger: 4, saturation: 0.8 },
    suspicious_stew: { hunger: 6, saturation: 7.2 },
    sweet_berries: { hunger: 2, saturation: 1.2 },
    tropical_fish: { hunger: 1, saturation: 0.2 },
  },
  
  // Block search ranges
  ranges: {
    miningRange: 32,
    safetyDistance: 4,
    attackRange: 3.5,
    interactRange: 4.5,
    dangerousBlocks: 2,
    viewDistance: 16,
  },
  
  // Standard crafting recipes (simplified)
  commonRecipes: {
    'crafting_table': {
      ingredients: [{ name: 'planks', count: 4 }],
      requiresCraftingTable: false
    },
    'wooden_pickaxe': {
      ingredients: [
        { name: 'planks', count: 3 },
        { name: 'stick', count: 2 }
      ],
      pattern: [
        'XXX',
        ' | ',
        ' | '
      ],
      requiresCraftingTable: true
    },
    'wooden_axe': {
      ingredients: [
        { name: 'planks', count: 3 },
        { name: 'stick', count: 2 }
      ],
      pattern: [
        'XX ',
        'X| ',
        ' | '
      ],
      requiresCraftingTable: true
    },
    'wooden_shovel': {
      ingredients: [
        { name: 'planks', count: 1 },
        { name: 'stick', count: 2 }
      ],
      pattern: [
        ' X ',
        ' | ',
        ' | '
      ],
      requiresCraftingTable: true
    },
    'stone_pickaxe': {
      ingredients: [
        { name: 'cobblestone', count: 3 },
        { name: 'stick', count: 2 }
      ],
      pattern: [
        'XXX',
        ' | ',
        ' | '
      ],
      requiresCraftingTable: true
    },
    'chest': {
      ingredients: [{ name: 'planks', count: 8 }],
      pattern: [
        'XXX',
        'X X',
        'XXX'
      ],
      requiresCraftingTable: true
    },
    'torch': {
      ingredients: [
        { name: 'coal', count: 1 },
        { name: 'stick', count: 1 }
      ],
      requiresCraftingTable: false
    },
    'furnace': {
      ingredients: [{ name: 'cobblestone', count: 8 }],
      pattern: [
        'XXX',
        'X X',
        'XXX'
      ],
      requiresCraftingTable: true
    }
  },
  
  // Building templates
  buildingTemplates: {
    'wall': {
      description: 'A simple straight wall',
      height: 3,
      width: 5,
      materials: ['cobblestone', 'stone', 'planks', 'stone_bricks'],
      materialCount: 15, // 3 high x 5 wide
    },
    'tower': {
      description: 'A simple watchtower',
      height: 5,
      width: 3,
      materials: ['cobblestone', 'stone', 'planks', 'stone_bricks'],
      materialCount: 45, // Approx for a 3x3 tower 5 blocks high
    },
    'house': {
      description: 'A basic shelter',
      height: 4,
      width: 5,
      length: 5,
      materials: ['planks', 'cobblestone', 'stone', 'stone_bricks'],
      materialCount: 80, // Approx for a 5x5 house with roof
    },
    'bridge': {
      description: 'A simple bridge',
      width: 3,
      length: 7,
      materials: ['planks', 'cobblestone', 'stone'],
      materialCount: 21, // 3 wide x 7 long
    },
    'staircase': {
      description: 'A staircase up or down',
      steps: 10,
      materials: ['cobblestone', 'stone', 'planks'],
      materialCount: 30, // 3 blocks per step
    }
  },
};
