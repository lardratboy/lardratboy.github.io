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
  constructor(config) {
    super();
    this.config = config;

    // Core state
    this.timeline = new Timeline();
    this.currentTime = 0;
    this.insertMode = true;

    // Derived state (rebuilt from timeline)
    this.grid = Grid.createEmpty(config.GRID.COLS, config.GRID.ROWS);
    this.cursor = new Cursor(0, 0);
  }

  /**
   * Rebuild state by replaying events up to current time
   */
  rebuildState() {
    Logger.debug('Rebuilding state at time:', this.currentTime);

    this.grid = Grid.createEmpty(this.config.GRID.COLS, this.config.GRID.ROWS);
    this.cursor = new Cursor(0, 0);

    const events = this.timeline.getEventsUpTo(this.currentTime);

    events.forEach(event => {
      EventSystem.applyEvent(event, this.grid, this.cursor);
    });

    this.emit('state-changed', this.getState());
  }

  /**
   * Derive state at a specific time (without changing current time)
   */
  deriveStateAt(time) {
    const grid = Grid.createEmpty(this.config.GRID.COLS, this.config.GRID.ROWS);
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
    const timestamp = isScrubbed
      ? this.currentTime
      : this.getMaxTime() + this.config.TIMING.TIME_INCREMENT;

    const event = {
      timestamp,
      action,
      cursorBefore: this.cursor.clone()
    };

    this.timeline.addEvent(event);

    Logger.debug(`Event added at ${timestamp}ms:`, action.type, action);

    // In concurrent mode (scrubbed), advance to next event
    if (isScrubbed && this.currentTime < this.getMaxTime()) {
      this.advanceToNextEvent();
    } else if (!isScrubbed) {
      // In live mode, advance current time
      this.currentTime = timestamp;
    }

    this.rebuildState();
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
    this.cursor.teleport(x, y, {
      cols: this.config.GRID.COLS,
      rows: this.config.GRID.ROWS
    });
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

  // ==================== Actions ====================

  clear() {
    this.timeline.clear();
    this.currentTime = 0;
    this.rebuildState();
    this.emit('state-changed', this.getState());
    this.emit('time-changed', 0);
    Logger.info('State cleared');
  }

  // ==================== Serialization ====================

  serialize() {
    return {
      timeline: this.timeline.serialize(),
      currentTime: this.currentTime,
      insertMode: this.insertMode,
      config: {
        cols: this.config.GRID.COLS,
        rows: this.config.GRID.ROWS
      }
    };
  }

  static deserialize(data, config) {
    const state = new StateManager(config);
    state.timeline = Timeline.deserialize(data.timeline);
    state.currentTime = data.currentTime;
    state.insertMode = data.insertMode;
    state.rebuildState();
    return state;
  }
}
