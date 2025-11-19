/**
 * Main Application - Temporal Text Editor V2
 * Modular, event-driven architecture
 */

import { CONFIG } from './config.js';
import { StateManager } from './core/StateManager.js';
import { EventSystem } from './core/EventSystem.js';
import { Renderer } from './ui/Renderer.js';
import { TimelineUI } from './ui/TimelineUI.js';
import { StatusBar } from './ui/StatusBar.js';
import { KeyboardHandler } from './input/KeyboardHandler.js';
import { MouseHandler } from './input/MouseHandler.js';
import { Export } from './utils/Export.js';
import { Logger } from './utils/Logger.js';

export class TemporalEditor {
  constructor(canvasId, timelineId, statusBarId) {
    this.canvas = document.getElementById(canvasId);
    this.timelineEl = document.getElementById(timelineId);
    this.statusBarEl = document.getElementById(statusBarId);

    this.config = CONFIG;
    this.cursorVisible = true;

    this._init();
  }

  _init() {
    Logger.info('Initializing Temporal Editor V2');

    // Create core components
    this.state = new StateManager(this.config);
    this.renderer = new Renderer(this.canvas, this.config);
    this.timelineUI = new TimelineUI(this.timelineEl, this.config);
    this.statusBar = new StatusBar(this.statusBarEl);
    this.keyboard = new KeyboardHandler();
    this.mouse = new MouseHandler(this.canvas, this.renderer);

    // Attach input handlers
    this.keyboard.attachTo(document);
    this.mouse.attachTo(this.canvas);

    // Bind events
    this._bindEvents();

    // Start render loop
    this._startRenderLoop();
    this._startCursorBlink();

    // Initial render
    this._render();
    this._updateUI();

    Logger.info('Temporal Editor initialized');
    Logger.info(`Grid: ${this.config.GRID.COLS}x${this.config.GRID.ROWS}`);
  }

  _bindEvents() {
    // Keyboard events
    this.keyboard.on('char-typed', ({ char }) => this._onCharTyped(char));
    this.keyboard.on('delete', ({ isBackspace }) => this._onDelete(isBackspace));
    this.keyboard.on('cursor-move', ({ dx, dy }) => this._onCursorMove(dx, dy));
    this.keyboard.on('toggle-insert-mode', () => this._onToggleInsertMode());
    this.keyboard.on('newline', () => this._onNewline());

    // Mouse events
    this.mouse.on('cursor-teleport', ({ x, y }) => this._onCursorTeleport(x, y));

    // Timeline events
    this.timelineUI.on('scrub', (percent) => this._onTimelineScrub(percent));

    // State events
    this.state.on('state-changed', () => this._onStateChanged());
    this.state.on('time-changed', () => this._onTimeChanged());
    this.state.on('mode-changed', () => this._onModeChanged());
  }

  // ==================== Input Handlers ====================

  _onCharTyped(char) {
    const cursor = this.state.getCurrentCursor();
    const action = EventSystem.createInsertChar(
      char,
      cursor.x,
      cursor.y,
      this.state.getInsertMode(),
      cursor
    );
    this.state.addEvent(action);
  }

  _onDelete(isBackspace) {
    const cursor = this.state.getCurrentCursor();
    const insertMode = this.state.getInsertMode();

    let action;
    if (isBackspace) {
      if (insertMode) {
        action = EventSystem.createDeleteAndShift(cursor.x - 1, cursor.y, true);
      } else {
        action = EventSystem.createDeleteChar(cursor.x - 1, cursor.y, true);
      }
    } else {
      if (insertMode) {
        action = EventSystem.createDeleteAndShift(cursor.x, cursor.y, false);
      } else {
        action = EventSystem.createDeleteChar(cursor.x, cursor.y, false);
      }
    }

    this.state.addEvent(action);
  }

  _onCursorMove(dx, dy) {
    const action = EventSystem.createCursorMove(dx, dy);
    this.state.addEvent(action);
  }

  _onNewline() {
    const action = EventSystem.createNewline();
    this.state.addEvent(action);
  }

  _onToggleInsertMode() {
    this.state.toggleInsertMode();
    this._render();
    this._updateUI();
  }

  _onCursorTeleport(x, y) {
    this.state.teleportCursor(x, y);
    this._render();
    this._updateUI();
  }

  _onTimelineScrub(percent) {
    const maxTime = this.state.getMaxTime();
    const time = Math.floor(percent * maxTime);
    this.state.scrubTo(time);
  }

  // ==================== State Event Handlers ====================

  _onStateChanged() {
    this._render();
    this._updateUI();
  }

  _onTimeChanged() {
    this._updateUI();
  }

  _onModeChanged() {
    this._updateUI();
  }

  // ==================== Rendering ====================

  _render() {
    this.renderer.render(
      this.state.getCurrentGrid(),
      this.state.getCurrentCursor(),
      this.state.getInsertMode(),
      this.cursorVisible
    );
  }

  _updateUI() {
    const state = this.state.getState();
    this.statusBar.update(state);
    this.timelineUI.update(
      state.currentTime,
      state.maxTime,
      this.state.getTimeline()
    );
  }

  _startRenderLoop() {
    const render = () => {
      // Render is called explicitly on state changes
      // This loop is for future optimizations
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  }

  _startCursorBlink() {
    setInterval(() => {
      this.cursorVisible = !this.cursorVisible;
      this._render();
    }, this.config.TIMING.CURSOR_BLINK_RATE);
  }

  // ==================== Public API ====================

  getState() {
    return this.state.getState();
  }

  getTimeline() {
    return this.state.getTimeline().serialize();
  }

  exportJSON() {
    const data = Export.toJSON(this.state.getState());
    const filename = `temporal-timeline-${Date.now()}.json`;
    Export.downloadJSON(data, filename);
    Logger.info('Timeline exported:', filename);
  }

  exportCSV() {
    const data = Export.toCSV(this.state.getTimeline());
    const filename = `temporal-timeline-${Date.now()}.csv`;
    Export.downloadCSV(data, filename);
    Logger.info('Timeline exported:', filename);
  }

  clear() {
    if (confirm('Clear all events and reset editor?')) {
      this.state.clear();
      this._render();
      this._updateUI();
      Logger.info('Editor cleared');
    }
  }

  destroy() {
    this.keyboard.detach();
    this.mouse.detach();
    this.timelineUI.destroy();
    this.state.removeAllListeners();
    Logger.info('Editor destroyed');
  }
}

// ==================== Initialize on DOM ready ====================

document.addEventListener('DOMContentLoaded', () => {
  // Create editor instance
  window.editor = new TemporalEditor('editor-canvas', 'timeline', 'status-bar');

  // Wire up control buttons
  document.getElementById('clear-btn').addEventListener('click', () => {
    window.editor.clear();
  });

  document.getElementById('export-btn').addEventListener('click', () => {
    window.editor.exportJSON();
  });

  document.getElementById('help-btn').addEventListener('click', () => {
    const instructions = document.querySelector('.instructions');
    instructions.style.display = instructions.style.display === 'none' ? 'block' : 'none';
  });

  Logger.info('Temporal Editor ready!');
  console.log('Access the editor via window.editor');
  console.log('Try: editor.getState(), editor.exportJSON(), editor.clear()');
});
