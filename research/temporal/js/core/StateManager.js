/**
 * StateManager - Central state management with event sourcing
 * Emits events: 'state-changed', 'mode-changed', 'time-changed', 'event-added'
 */

import { EventEmitter } from '../utils/EventEmitter.js';
import { Grid } from './Grid.js';
import { Cursor } from './Cursor.js';
import { Timeline } from './Timeline.js';
import { EventSystem } from './EventSystem.js';
import { Logger } from '../utils/Logger.js';

export class StateManager extends EventEmitter {
  constructor(gridOrConfig, timelineOrUndefined) {
    super();

    // Support two modes:
    // 1. New mode: StateManager(grid, timeline) - for infinite grid with VirtualGrid
    // 2. Legacy mode: StateManager(config) - for fixed grid with config object
    if (timelineOrUndefined) {
      // New mode: accepting grid and timeline directly
      this.grid = gridOrConfig;
      this.timeline = timelineOrUndefined;
      this.config = null;
      this.isVirtualGrid = true;
    } else {
      // Legacy mode: accepting config object
      this.config = gridOrConfig;
      this.timeline = new Timeline();
      this.grid = Grid.createEmpty(gridOrConfig.GRID.COLS, gridOrConfig.GRID.ROWS);
      this.isVirtualGrid = false;
    }

    // Core state
    this.currentTime = 0;
    this.insertMode = true;
    this.currentColor = '#00ff00'; // Default green color

    // Cursor
    this.cursor = new Cursor(0, 0);
  }

  /**
   * Rebuild state by replaying events up to current time
   */
  rebuildState() {
    Logger.debug('Rebuilding state at time:', this.currentTime);

    if (!this.isVirtualGrid) {
      // Fixed grid mode - recreate grid
      this.grid = Grid.createEmpty(this.config.GRID.COLS, this.config.GRID.ROWS);
    } else {
      // Virtual grid mode - clear existing grid
      this.grid.clear();
    }

    this.cursor = new Cursor(0, 0);

    const events = this.timeline.getEventsUpTo(this.currentTime);

    events.forEach(event => {
      EventSystem.applyEvent(event, this.grid, this.cursor);
    });

    this.emit('state-changed', this.getState());
  }

  /**
   * Rebuild state from all events in timeline (not just up to current time)
   */
  rebuildFromEvents() {
    Logger.debug('Rebuilding from all events');

    if (!this.isVirtualGrid) {
      // Fixed grid mode - recreate grid
      this.grid = Grid.createEmpty(this.config.GRID.COLS, this.config.GRID.ROWS);
    } else {
      // Virtual grid mode - clear existing grid
      this.grid.clear();
    }

    this.cursor = new Cursor(0, 0);

    // Apply all events
    this.timeline.events.forEach(event => {
      EventSystem.applyEvent(event, this.grid, this.cursor);
    });

    // Set current time to max time
    this.currentTime = this.getMaxTime();

    this.emit('state-changed', this.getState());
  }

  /**
   * Apply a single event to the current state
   */
  applyEvent(event) {
    EventSystem.applyEvent(event, this.grid, this.cursor);
    this.emit('state-changed', this.getState());
  }

  /**
   * Derive state at a specific time (without changing current time)
   */
  deriveStateAt(time) {
    let grid;
    if (!this.isVirtualGrid) {
      grid = Grid.createEmpty(this.config.GRID.COLS, this.config.GRID.ROWS);
    } else {
      // For virtual grid, create a new instance and clear it
      grid = this.grid.constructor ? new this.grid.constructor() : this.grid.clone();
      if (grid.clear) grid.clear();
    }

    const cursor = new Cursor(0, 0);

    const events = this.timeline.getEventsUpTo(time);
    events.forEach(event => {
      EventSystem.applyEvent(event, grid, cursor);
    });

    return { grid, cursor, time };
  }

  /**
   * Add an event to the timeline
   */
  addEvent(action) {
    const isScrubbed = this.isScrubbed();
    const timeIncrement = this.config ? this.config.TIMING.TIME_INCREMENT : 16;
    const timestamp = isScrubbed
      ? this.currentTime
      : this.getMaxTime() + timeIncrement;

    const event = {
      timestamp,
      action,
      cursorBefore: this.cursor.clone()
    };

    this.timeline.addEvent(event);

    Logger.debug(`Event added at ${timestamp}ms:`, action.type, action);

    // In concurrent mode (scrubbed), we need to preserve where the cursor should be
    // after applying this new event, even though we're advancing to the next timestamp
    let userCursorPosition = null;
    if (isScrubbed && this.currentTime < this.getMaxTime()) {
      // Calculate where cursor will be after applying this event
      const tempCursor = this.cursor.clone();
      const tempGrid = this.grid.clone();
      EventSystem.applyEvent(event, tempGrid, tempCursor);
      userCursorPosition = tempCursor.clone();

      this.advanceToNextEvent();
    } else if (!isScrubbed) {
      // In live mode, advance current time
      this.currentTime = timestamp;
    }

    this.rebuildState();

    // In concurrent mode, restore the user's cursor position
    // This keeps the cursor where the user is typing, not where historical events left it
    if (userCursorPosition) {
      this.cursor.set(userCursorPosition);
      Logger.debug(`Restored user cursor to (${userCursorPosition.x}, ${userCursorPosition.y})`);
    }

    this.emit('event-added', event);
    this.emit('time-changed', this.currentTime);

    return event;
  }

  /**
   * Advance to next event in timeline (for concurrent editing)
   */
  advanceToNextEvent() {
    const nextEvent = this.timeline.getNextEvent(this.currentTime);
    if (nextEvent) {
      this.currentTime = nextEvent.timestamp;
      Logger.debug(`Advanced to next event at ${this.currentTime}ms`);
      this.emit('time-changed', this.currentTime);
    } else {
      // No more future events, exit scrubbed mode
      this.currentTime = this.getMaxTime();
      Logger.info('Exited concurrent mode - no more future events');
      this.emit('mode-changed', { isScrubbed: false });
      this.emit('time-changed', this.currentTime);
    }
  }

  /**
   * Scrub timeline to a specific time
   */
  scrubTo(time) {
    const maxTime = this.getMaxTime();
    this.currentTime = Math.max(0, Math.min(time, maxTime));
    this.rebuildState();
    this.emit('time-changed', this.currentTime);
    this.emit('mode-changed', { isScrubbed: this.isScrubbed() });
  }

  /**
   * Teleport cursor without recording event
   */
  teleportCursor(x, y) {
    if (this.config) {
      // Fixed grid mode - respect boundaries
      this.cursor.teleport(x, y, {
        cols: this.config.GRID.COLS,
        rows: this.config.GRID.ROWS
      });
    } else {
      // Virtual grid mode - no boundaries
      this.cursor.x = x;
      this.cursor.y = y;
    }
    this.emit('state-changed', this.getState());
    Logger.debug(`Cursor teleported to (${x}, ${y})`);
  }

  // ==================== Getters ====================

  getCurrentGrid() {
    return this.grid;
  }

  getCurrentCursor() {
    return this.cursor;
  }

  getCurrentTime() {
    return this.currentTime;
  }

  getMaxTime() {
    return this.timeline.getMaxTime();
  }

  isLive() {
    return this.currentTime >= this.getMaxTime();
  }

  isScrubbed() {
    return this.currentTime < this.getMaxTime();
  }

  getInsertMode() {
    return this.insertMode;
  }

  getCurrentColor() {
    return this.currentColor;
  }

  getTimeline() {
    return this.timeline;
  }

  getEventCount() {
    return this.timeline.getEventCount();
  }

  getState() {
    return {
      grid: this.grid,
      cursor: this.cursor,
      timeline: this.timeline,
      currentTime: this.currentTime,
      maxTime: this.getMaxTime(),
      isLive: this.isLive(),
      isScrubbed: this.isScrubbed(),
      insertMode: this.insertMode,
      eventCount: this.getEventCount()
    };
  }

  // ==================== Setters ====================

  setInsertMode(mode) {
    if (this.insertMode !== mode) {
      this.insertMode = mode;
      this.emit('mode-changed', { insertMode: mode });
      Logger.debug(`Insert mode set to: ${mode ? 'INSERT' : 'OVERWRITE'}`);
    }
  }

  toggleInsertMode() {
    this.setInsertMode(!this.insertMode);
  }

  setCurrentColor(color) {
    if (this.currentColor !== color) {
      this.currentColor = color;
      this.emit('color-changed', { color });
      Logger.debug(`Current color set to: ${color}`);
    }
  }

  // ==================== Actions ====================

  clear() {
    this.timeline.clear();
    this.currentTime = 0;
    this.rebuildState();
    this.emit('state-changed', this.getState());
    this.emit('time-changed', 0);
    Logger.info('State cleared');
  }

  reset() {
    // Alias for clear()
    this.clear();
  }

  // ==================== Serialization ====================

  serialize() {
    const result = {
      timeline: this.timeline.serialize(),
      currentTime: this.currentTime,
      insertMode: this.insertMode,
      currentColor: this.currentColor
    };

    if (this.config) {
      result.config = {
        cols: this.config.GRID.COLS,
        rows: this.config.GRID.ROWS
      };
    }

    return result;
  }

  static deserialize(data, config) {
    const state = new StateManager(config);
    state.timeline = Timeline.deserialize(data.timeline);
    state.currentTime = data.currentTime;
    state.insertMode = data.insertMode;
    state.currentColor = data.currentColor || '#00ff00';
    state.rebuildState();
    return state;
  }
}
