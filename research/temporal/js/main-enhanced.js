/**
 * Main Application - Temporal Text Editor V3 (Enhanced)
 * With Playback, Persistence, Analytics, Branching, Macros, and more
 */

import { CONFIG } from './config.js';
import { StateManager } from './core/StateManager.js';
import { EventSystem } from './core/EventSystem.js';
import { Renderer } from './ui/Renderer.js';
import { TimelineUI } from './ui/TimelineUI.js';
import { StatusBar } from './ui/StatusBar.js';
import { EventInspector } from './ui/EventInspector.js';
import { MultiCursorRenderer } from './ui/MultiCursorRenderer.js';
import { KeyboardHandler } from './input/KeyboardHandler.js';
import { MouseHandler } from './input/MouseHandler.js';
import { PlaybackController } from './modes/PlaybackController.js';
import { BranchManager } from './modes/BranchManager.js';
import { MacroRecorder } from './modes/MacroRecorder.js';
import { Export } from './utils/Export.js';
import { Persistence } from './utils/Persistence.js';
import { PatternAnalysis } from './utils/PatternAnalysis.js';
import { Logger } from './utils/Logger.js';

export class TemporalEditorEnhanced {
  constructor(canvasId, timelineId, statusBarId) {
    this.canvas = document.getElementById(canvasId);
    this.timelineEl = document.getElementById(timelineId);
    this.statusBarEl = document.getElementById(statusBarId);

    this.config = CONFIG;
    this.cursorVisible = true;
    this.autoSaveEnabled = true;
    this.autoSaveInterval = 30000; // 30 seconds

    this._init();
  }

  _init() {
    Logger.info('Initializing Temporal Editor V3 (Enhanced)');

    // Create core components
    this.state = new StateManager(this.config);
    this.renderer = new Renderer(this.canvas, this.config);
    this.timelineUI = new TimelineUI(this.timelineEl, this.config);
    this.statusBar = new StatusBar(this.statusBarEl);
    this.keyboard = new KeyboardHandler();
    this.mouse = new MouseHandler(this.canvas, this.renderer);

    // Create enhanced components
    this.playback = new PlaybackController(this.state, this.config);
    this.branches = new BranchManager();
    this.macros = new MacroRecorder();
    this.inspector = new EventInspector();
    this.multiCursor = new MultiCursorRenderer(this.config);

    // Initialize UI
    this.inspector.createUI();

    // Attach input handlers
    this.keyboard.attachTo(document);
    this.mouse.attachTo(this.canvas);

    // Bind events
    this._bindEvents();

    // Try to load auto-save
    this._loadAutoSave();

    // Start auto-save
    this._startAutoSave();

    // Start render loop
    this._startRenderLoop();
    this._startCursorBlink();

    // Initial render
    this._render();
    this._updateUI();

    Logger.info('Temporal Editor V3 initialized');
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
    this.state.on('event-added', (event) => this._onEventAdded(event));

    // Playback events
    this.playback.on('play', () => this._onPlaybackStateChange());
    this.playback.on('pause', () => this._onPlaybackStateChange());
    this.playback.on('stop', () => this._onPlaybackStateChange());

    // Inspector events
    this.inspector.on('event-deleted', () => {
      this.state.rebuildState();
      this._render();
      this._updateUI();
    });

    // Branch events
    this.branches.on('branch-switched', (branch) => {
      this.state.timeline = branch.timeline;
      this.state.rebuildState();
      this._render();
      this._updateUI();
    });
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

  _onEventAdded(event) {
    // Record in macro if recording
    if (this.macros.isRecording) {
      this.macros.recordEvent(event);
    }
  }

  _onPlaybackStateChange() {
    this._updatePlaybackUI();
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

    // Render multi-cursors if enabled
    if (this.multiCursor.enabled) {
      this.multiCursor.renderCursors(
        this.renderer.ctx,
        this.state.getTimeline(),
        this.state.getCurrentTime(),
        (x, y) => this.renderer.gridToPixel(x, y)
      );
    }
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

  _updatePlaybackUI() {
    const playBtn = document.getElementById('playback-play');
    const pauseBtn = document.getElementById('playback-pause');

    if (playBtn && pauseBtn) {
      if (this.playback.isPlaying) {
        playBtn.style.display = 'none';
        pauseBtn.style.display = 'inline-block';
      } else {
        playBtn.style.display = 'inline-block';
        pauseBtn.style.display = 'none';
      }
    }
  }

  _startRenderLoop() {
    const render = () => {
      // Continuous render for playback mode
      if (this.playback.isPlaying) {
        this._render();
      }
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  }

  _startCursorBlink() {
    setInterval(() => {
      this.cursorVisible = !this.cursorVisible;
      if (!this.playback.isPlaying) {
        this._render();
      }
    }, this.config.TIMING.CURSOR_BLINK_RATE);
  }

  // ==================== Auto-Save ====================

  _startAutoSave() {
    if (this.autoSaveEnabled) {
      setInterval(() => {
        this.autoSave();
      }, this.autoSaveInterval);
      Logger.info('Auto-save enabled (every 30s)');
    }
  }

  _loadAutoSave() {
    const saved = Persistence.loadAutoSave();
    if (saved && confirm('Auto-saved state found. Load it?')) {
      this.loadState(saved);
      Logger.info('Auto-save loaded');
    }
  }

  autoSave() {
    if (this.state.getEventCount() > 0) {
      Persistence.autoSave(this.state.getState());
      Logger.debug('Auto-saved');
    }
  }

  // ==================== Public API ====================

  // Basic operations
  getState() {
    return this.state.getState();
  }

  getTimeline() {
    return this.state.getTimeline().serialize();
  }

  clear() {
    if (confirm('Clear all events and reset editor?')) {
      this.state.clear();
      this._render();
      this._updateUI();
      Logger.info('Editor cleared');
    }
  }

  // Export operations
  exportJSON() {
    const state = this.state.getState();
    const data = Export.toJSON(state, state.timeline);
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

  exportAsciinema() {
    const data = Export.toAsciinema(this.state.getTimeline(), this.config);
    const filename = `temporal-recording-${Date.now()}.cast`;
    Export.downloadAsciinema(data, filename);
    Logger.info('Asciinema recording exported:', filename);
  }

  async importJSON() {
    try {
      const data = await Export.importJSON();
      Export.validateImportedData(data);

      // Clear current state
      this.state.clear();

      // Load the timeline from imported data
      this.state.timeline = this.state.timeline.constructor.deserialize(data.timeline);

      // Restore current state if available
      if (data.currentState) {
        this.state.currentTime = data.currentState.currentTime || data.timeline.maxTime || 0;
        this.state.insertMode = data.currentState.insertMode !== undefined ? data.currentState.insertMode : true;
      } else {
        // Default to end of timeline
        this.state.currentTime = this.state.getMaxTime();
      }

      // Rebuild the state
      this.state.rebuildState();

      // Update UI
      this._render();
      this._updateUI();

      Logger.info('Timeline imported successfully');
      alert('Timeline imported successfully!');
    } catch (error) {
      Logger.error('Failed to import timeline:', error);
      alert('Failed to import timeline: ' + error.message);
    }
  }

  // Persistence operations
  save(name = 'default') {
    Persistence.save(this.state.getState(), name);
    Logger.info('State saved:', name);
  }

  load(name = 'default') {
    const data = Persistence.load(name);
    if (data) {
      this.loadState(data);
      Logger.info('State loaded:', name);
    }
  }

  loadState(data) {
    this.state.timeline = this.state.timeline.constructor.deserialize(data.timeline);
    this.state.currentTime = data.currentTime;
    this.state.insertMode = data.insertMode;
    this.state.rebuildState();
    this._render();
    this._updateUI();
  }

  saveDraft(name) {
    Persistence.saveDraft(this.state.getState(), name);
    Logger.info('Draft saved:', name);
  }

  loadDraft(name) {
    const data = Persistence.loadDraft(name);
    if (data) {
      this.loadState(data);
      Logger.info('Draft loaded:', name);
    }
  }

  listDrafts() {
    return Persistence.listDrafts();
  }

  // Playback operations
  play() {
    this.playback.play();
  }

  pause() {
    this.playback.pause();
  }

  stop() {
    this.playback.stop();
  }

  setSpeed(speed) {
    this.playback.setSpeed(speed);
  }

  stepForward() {
    this.playback.stepForward();
  }

  stepBackward() {
    this.playback.stepBackward();
  }

  // Analysis operations
  analyze() {
    const analysis = PatternAnalysis.analyze(this.state.getTimeline());
    console.log('=== Pattern Analysis ===');
    console.log(PatternAnalysis.generateReport(this.state.getTimeline()));
    return analysis;
  }

  // Branch operations
  createBranch(name, description = '') {
    return this.branches.createBranch(name, this.state.getTimeline(), description);
  }

  switchBranch(name) {
    const timeline = this.branches.switchBranch(name);
    if (timeline) {
      this.state.timeline = timeline;
      this.state.rebuildState();
      this._render();
      this._updateUI();
    }
  }

  listBranches() {
    return this.branches.listBranches();
  }

  // Macro operations
  startRecording(name) {
    return this.macros.startRecording(name);
  }

  stopRecording() {
    return this.macros.stopRecording();
  }

  saveMacro(description = '') {
    return this.macros.saveMacro(description);
  }

  replayMacro(name, atTimestamp = 0) {
    return this.macros.replayMacro(name, atTimestamp, this.state);
  }

  listMacros() {
    return this.macros.listMacros();
  }

  // Multi-cursor operations
  toggleMultiCursor() {
    this.multiCursor.setEnabled(!this.multiCursor.enabled);
    this._render();
  }

  // Inspector operations
  inspectEventAt(timestamp) {
    const events = this.state.getTimeline().getEventsAt(timestamp);
    if (events.length > 0) {
      this.inspector.inspect(events[0], this.state.getTimeline());
    }
  }

  // Cleanup
  destroy() {
    this.keyboard.detach();
    this.mouse.detach();
    this.timelineUI.destroy();
    this.inspector.destroy();
    this.playback.destroy();
    this.state.removeAllListeners();
    Logger.info('Editor destroyed');
  }
}

// ==================== Initialize on DOM ready ====================

document.addEventListener('DOMContentLoaded', () => {
  // Create editor instance
  window.editor = new TemporalEditorEnhanced('editor-canvas', 'timeline', 'status-bar');

  // Wire up basic controls
  document.getElementById('clear-btn').addEventListener('click', () => {
    window.editor.clear();
  });

  document.getElementById('import-json-btn').addEventListener('click', () => {
    window.editor.importJSON();
  });

  document.getElementById('export-json-btn').addEventListener('click', () => {
    window.editor.exportJSON();
  });

  document.getElementById('export-csv-btn').addEventListener('click', () => {
    window.editor.exportCSV();
  });

  document.getElementById('export-asciinema-btn').addEventListener('click', () => {
    window.editor.exportAsciinema();
  });

  // Playback controls
  document.getElementById('playback-play').addEventListener('click', () => {
    window.editor.play();
  });

  document.getElementById('playback-pause').addEventListener('click', () => {
    window.editor.pause();
  });

  document.getElementById('playback-stop').addEventListener('click', () => {
    window.editor.stop();
  });

  document.getElementById('playback-step-back').addEventListener('click', () => {
    window.editor.stepBackward();
  });

  document.getElementById('playback-step-forward').addEventListener('click', () => {
    window.editor.stepForward();
  });

  document.getElementById('playback-speed').addEventListener('change', (e) => {
    window.editor.setSpeed(parseFloat(e.target.value));
  });

  // Persistence controls
  document.getElementById('save-btn').addEventListener('click', () => {
    window.editor.save('user-save');
    alert('State saved!');
  });

  document.getElementById('load-btn').addEventListener('click', () => {
    window.editor.load('user-save');
    alert('State loaded!');
  });

  // Analysis
  document.getElementById('analyze-btn').addEventListener('click', () => {
    window.editor.analyze();
    alert('Analysis printed to console!');
  });

  // Multi-cursor
  document.getElementById('multicursor-toggle').addEventListener('click', () => {
    window.editor.toggleMultiCursor();
  });

  // Help toggle
  document.getElementById('help-btn').addEventListener('click', () => {
    const instructions = document.querySelector('.instructions');
    instructions.style.display = instructions.style.display === 'none' ? 'block' : 'none';
  });

  Logger.info('Temporal Editor V3 ready!');
  console.log('=== Temporal Editor V3 - Enhanced ===');
  console.log('Access via: window.editor');
  console.log('\nPlayback:', 'editor.play(), editor.pause(), editor.stop()');
  console.log('Speed:', 'editor.setSpeed(0.5|1|2|4)');
  console.log('Step:', 'editor.stepForward(), editor.stepBackward()');
  console.log('\nImport/Export:', 'editor.importJSON(), editor.exportJSON(), editor.exportCSV(), editor.exportAsciinema()');
  console.log('\nPersistence:', 'editor.save(), editor.load()');
  console.log('Drafts:', 'editor.saveDraft("name"), editor.loadDraft("name")');
  console.log('\nAnalysis:', 'editor.analyze()');
  console.log('\nBranches:', 'editor.createBranch("name"), editor.switchBranch("name")');
  console.log('Macros:', 'editor.startRecording("name"), editor.saveMacro(), editor.replayMacro("name")');
  console.log('\nMulti-cursor:', 'editor.toggleMultiCursor()');
});
