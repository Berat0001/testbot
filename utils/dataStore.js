/**
 * Data Store Utility
 * 
 * Provides persistent data storage capabilities for the bot's learning algorithms.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../bot/logger');

class DataStore {
  constructor(fileName = 'botData.json') {
    this.fileName = fileName;
    this.dataPath = path.join(__dirname, '..', fileName);
    this.data = {};
    this.loaded = false;
  }

  /**
   * Load data from storage
   */
  load() {
    try {
      if (fs.existsSync(this.dataPath)) {
        const fileContent = fs.readFileSync(this.dataPath, 'utf8');
        this.data = JSON.parse(fileContent);
        this.loaded = true;
        logger.info(`Data loaded from ${this.fileName}`);
      } else {
        // Initialize with empty data if file doesn't exist
        this.data = {};
        this.save(); // Create the file
        this.loaded = true;
        logger.info(`Created new data store at ${this.fileName}`);
      }
      return true;
    } catch (error) {
      logger.error(`Failed to load data from ${this.fileName}:`, error);
      // Initialize with empty data on error
      this.data = {};
      this.loaded = false;
      return false;
    }
  }

  /**
   * Save data to storage
   */
  save() {
    try {
      const dataString = JSON.stringify(this.data, null, 2);
      fs.writeFileSync(this.dataPath, dataString, 'utf8');
      logger.debug(`Data saved to ${this.fileName}`);
      return true;
    } catch (error) {
      logger.error(`Failed to save data to ${this.fileName}:`, error);
      return false;
    }
  }

  /**
   * Get a value from the data store
   */
  get(key, defaultValue = null) {
    if (!this.loaded) {
      this.load();
    }
    
    // Support nested keys with dot notation (e.g., 'mining.ores.success')
    if (key.includes('.')) {
      const keys = key.split('.');
      let data = this.data;
      
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        if (!data[k] || typeof data[k] !== 'object') {
          return defaultValue;
        }
        data = data[k];
      }
      
      const lastKey = keys[keys.length - 1];
      return data[lastKey] !== undefined ? data[lastKey] : defaultValue;
    }
    
    return this.data[key] !== undefined ? this.data[key] : defaultValue;
  }

  /**
   * Set a value in the data store
   */
  set(key, value, saveImmediately = true) {
    if (!this.loaded) {
      this.load();
    }
    
    // Support nested keys with dot notation
    if (key.includes('.')) {
      const keys = key.split('.');
      let data = this.data;
      
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        if (!data[k] || typeof data[k] !== 'object') {
          data[k] = {};
        }
        data = data[k];
      }
      
      const lastKey = keys[keys.length - 1];
      data[lastKey] = value;
    } else {
      this.data[key] = value;
    }
    
    if (saveImmediately) {
      this.save();
    }
    
    return true;
  }

  /**
   * Increment a numeric value in the data store
   */
  increment(key, amount = 1, defaultValue = 0, saveImmediately = true) {
    const currentValue = this.get(key, defaultValue);
    const newValue = typeof currentValue === 'number' ? currentValue + amount : defaultValue + amount;
    return this.set(key, newValue, saveImmediately);
  }

  /**
   * Delete a key from the data store
   */
  delete(key, saveImmediately = true) {
    if (!this.loaded) {
      this.load();
    }
    
    // Support nested keys with dot notation
    if (key.includes('.')) {
      const keys = key.split('.');
      let data = this.data;
      
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        if (!data[k] || typeof data[k] !== 'object') {
          return false; // Key doesn't exist
        }
        data = data[k];
      }
      
      const lastKey = keys[keys.length - 1];
      if (data[lastKey] === undefined) {
        return false;
      }
      
      delete data[lastKey];
    } else {
      if (this.data[key] === undefined) {
        return false;
      }
      
      delete this.data[key];
    }
    
    if (saveImmediately) {
      this.save();
    }
    
    return true;
  }

  /**
   * Get all data
   */
  getAll() {
    if (!this.loaded) {
      this.load();
    }
    return { ...this.data };
  }

  /**
   * Clear all data
   */
  clear(saveImmediately = true) {
    this.data = {};
    
    if (saveImmediately) {
      this.save();
    }
    
    return true;
  }
}

module.exports = DataStore;