/**
 * Temporal Editor Configuration
 * Central configuration for all constants and settings
 */

export const CONFIG = Object.freeze({
  // Grid dimensions
  GRID: {
    COLS: 80,
    ROWS: 20
  },

  // Font and rendering
  FONT: {
    FAMILY: 'Courier New',
    SIZE: 16,
    LINE_HEIGHT: 20,
    CHAR_WIDTH: 9.6 // Measured for Courier New 16px
  },

  // Layout
  LAYOUT: {
    PADDING: 10
  },

  // Timing
  TIMING: {
    TIME_INCREMENT: 50, // ms between keystrokes in LIVE mode
    CURSOR_BLINK_RATE: 530, // ms
    SNAPSHOT_INTERVAL: 1000 // ms between state snapshots (for optimization)
  },

  // Colors
  COLORS: {
    BACKGROUND: '#000',
    TEXT: '#0f0',
    CURSOR: '#0f0',
    CURSOR_ALPHA: 0.7,
    MODE_LIVE: '#0f0',
    MODE_SCRUBBED: '#f00',
    TIMELINE_MARKER: '#0f0',
    TIMELINE_MARKER_CONCURRENT: '#ff0',
    TIMELINE_PLAYHEAD: '#f00'
  },

  // Debug
  DEBUG: {
    LOGGING_ENABLED: true,
    LOG_LEVEL: 'debug' // 'debug' | 'info' | 'warn' | 'error'
  }
});
