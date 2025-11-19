/**
 * Logger utility for debug output
 */

import { CONFIG } from '../config.js';

const LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

class LoggerClass {
  constructor() {
    this.level = CONFIG.DEBUG.LOG_LEVEL;
    this.enabled = CONFIG.DEBUG.LOGGING_ENABLED;
  }

  setLevel(level) {
    if (LEVELS[level] !== undefined) {
      this.level = level;
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  _shouldLog(level) {
    return this.enabled && LEVELS[level] >= LEVELS[this.level];
  }

  debug(message, ...args) {
    if (this._shouldLog('debug')) {
      console.log(`[DEBUG] ${message}`, ...args);
    }
  }

  info(message, ...args) {
    if (this._shouldLog('info')) {
      console.info(`[INFO] ${message}`, ...args);
    }
  }

  warn(message, ...args) {
    if (this._shouldLog('warn')) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  }

  error(message, ...args) {
    if (this._shouldLog('error')) {
      console.error(`[ERROR] ${message}`, ...args);
    }
  }

  group(label) {
    if (this.enabled) {
      console.group(label);
    }
  }

  groupEnd() {
    if (this.enabled) {
      console.groupEnd();
    }
  }
}

export const Logger = new LoggerClass();
