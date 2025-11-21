/**
 * Temporal Text Editor V3 - Infinite Grid Edition
 * Main application file with virtual scrolling, minimap, and pan/zoom
 */

import { VirtualGrid } from './core/VirtualGrid.js';
import { Timeline } from './core/Timeline.js';
import { Viewport } from './core/Viewport.js';
import { VirtualRenderer } from './ui/VirtualRenderer.js';
import { Minimap } from './ui/Minimap.js';
import { KeyboardHandler } from './input/KeyboardHandler.js';
import { StateManager } from './core/StateManager.js';
import { PlaybackController } from './modes/PlaybackController.js';
import { Selection } from './core/Selection.js';
import { AnnotationManager } from './core/Annotation.js';
import { UndoStack } from './core/UndoStack.js';
import { Logger } from './utils/Logger.js';
import { ColorPicker } from './ui/ColorPicker.js';
import { BranchManager } from './ui/BranchManager.js';

class TemporalEditorInfinite {
  constructor() {
    Logger.info('Initializing Temporal Editor V3 - Infinite Grid Edition');

    // Initialize core components
    this.grid = new VirtualGrid();
    this.timeline = new Timeline();
    this.viewport = new Viewport(0, 0, 80, 24); // Start with 80x24 viewport
    this.renderer = new VirtualRenderer('editor-canvas', this.grid, this.viewport);
    this.minimap = new Minimap('minimap-canvas', this.grid, this.viewport);
    this.keyboard = new KeyboardHandler();
    this.stateManager = new StateManager(this.grid, this.timeline);
    this.playback = new PlaybackController(this.stateManager);
    this.selection = new Selection();
    this.annotations = new AnnotationManager();
    this.undoStack = new UndoStack(this.timeline);
    this.colorPicker = new ColorPicker();
    this.branchManager = new BranchManager(this.stateManager);

    // Cursor state
    this.cursor = { x: 0, y: 0 };
    this.insertMode = true; // true = insert, false = overwrite

    // Playback state
    this.isPlaying = false;

    // Auto-save
    this.autoSaveInterval = null;

    this.init();
  }

  init() {
    Logger.info('Setting up event listeners and UI...');

    // Set up event listeners
    this._setupKeyboardEvents();
    this._setupPlaybackEvents();
    this._setupTimelineEvents();
    this._setupCanvasEvents();
    this._setupUIControls();
    this._setupSelectionEvents();
    this._setupViewportEvents();
    this._setupMinimapEvents();

    // Initialize UI
    this._updateUI();
    this.renderer.render(this.cursor, this.insertMode, this.selection);
    this.minimap.render();

    // Start auto-save
    this._startAutoSave();

    // Load saved state if available
    this._autoLoad();

    // Expose to window for console access
    window.editor = this;

    Logger.info('Editor initialized successfully');
  }

  _setupKeyboardEvents() {
    this.keyboard.on('char-typed', (char) => this._onCharTyped(char));
    this.keyboard.on('cursor-move', (direction) => this._onCursorMove(direction));
    this.keyboard.on('delete', (isBackspace) => this._onDelete(isBackspace));
    this.keyboard.on('newline', () => this._onNewline());
    this.keyboard.on('toggle-insert', () => this._onToggleInsertMode());
    this.keyboard.on('undo', () => this._onUndo());
    this.keyboard.on('redo', () => this._onRedo());
    this.keyboard.on('copy', () => this._onCopy());
    this.keyboard.on('paste', () => this._onPaste());
    this.keyboard.on('add-annotation', () => this._onAddAnnotation());
    this.keyboard.on('selection-start', () => this._onSelectionStart());
    this.keyboard.on('selection-update', (direction) => this._onSelectionUpdate(direction));
  }

  _setupPlaybackEvents() {
    // Playback control buttons
    document.getElementById('playback-play')?.addEventListener('click', () => {
      this.playback.play();
      this.isPlaying = true;
      this._updateUI();
    });

    document.getElementById('playback-pause')?.addEventListener('click', () => {
      this.playback.pause();
      this.isPlaying = false;
      this._updateUI();
    });

    document.getElementById('playback-stop')?.addEventListener('click', () => {
      this.playback.stop();
      this.isPlaying = false;
      this._updateUI();
    });

    document.getElementById('playback-step-back')?.addEventListener('click', () => {
      this.playback.stepBackward();
      this._updateUI();
    });

    document.getElementById('playback-step-forward')?.addEventListener('click', () => {
      this.playback.stepForward();
      this._updateUI();
    });

    document.getElementById('playback-loop')?.addEventListener('click', () => {
      this.playback.toggleLoop();
      this._updateUI();
    });

    document.getElementById('playback-speed')?.addEventListener('change', (e) => {
      this.playback.setSpeed(parseFloat(e.target.value));
    });

    // Listen for state updates during playback
    this.stateManager.on('state-updated', () => {
      this.cursor = { ...this.stateManager.cursor };
      this.viewport.ensureVisible(this.cursor.x, this.cursor.y);
      this.renderer.render(this.cursor, this.insertMode, this.selection);
      this.minimap.render();
      this._updateUI();
    });
  }

  _setupTimelineEvents() {
    const timelineEl = document.getElementById('timeline');
    const playheadEl = document.getElementById('playhead');

    if (!timelineEl || !playheadEl) return;

    let isDragging = false;

    const updatePlayhead = (clientX) => {
      const rect = timelineEl.getBoundingClientRect();
      const x = clientX - rect.left;
      const percent = Math.max(0, Math.min(1, x / rect.width));

      const maxTime = this.timeline.getMaxTime();
      const targetTime = percent * maxTime;

      this.stateManager.scrubTo(targetTime);
      this.cursor = { ...this.stateManager.cursor };

      // Pause playback when scrubbing
      if (this.playback.isPlaying) {
        this.playback.pause();
        this.isPlaying = false;
        Logger.info('Playback paused due to timeline scrub');
      }

      this._updateUI();
      this.viewport.ensureVisible(this.cursor.x, this.cursor.y);
      this.renderer.render(this.cursor, this.insertMode, this.selection);
      this.minimap.render();
    };

    timelineEl.addEventListener('mousedown', (e) => {
      isDragging = true;
      updatePlayhead(e.clientX);
    });

    document.addEventListener('mousemove', (e) => {
      if (isDragging) {
        updatePlayhead(e.clientX);
      }
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  _setupCanvasEvents() {
    const canvas = document.getElementById('editor-canvas');
    if (!canvas) return;

    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / this.renderer.cellWidth);
      const y = Math.floor((e.clientY - rect.top) / this.renderer.cellHeight);

      // Convert viewport coordinates to grid coordinates
      const gridCoords = this.viewport.toGridCoords(x, y);

      // Teleport cursor (no event recorded)
      this.cursor = { x: gridCoords.x, y: gridCoords.y };
      this.viewport.ensureVisible(this.cursor.x, this.cursor.y);

      Logger.debug('Cursor teleported to', this.cursor);
      this._updateUI();
      this.renderer.render(this.cursor, this.insertMode, this.selection);
      this.minimap.render();
    });
  }

  _setupUIControls() {
    // Basic operations
    document.getElementById('toggle-insert-mode-btn')?.addEventListener('click', () => {
      this._onToggleInsertMode();
    });

    document.getElementById('undo-btn')?.addEventListener('click', () => {
      this._onUndo();
    });

    document.getElementById('redo-btn')?.addEventListener('click', () => {
      this._onRedo();
    });

    document.getElementById('clear-btn')?.addEventListener('click', () => {
      if (confirm('Clear all content and timeline?')) {
        this.timeline.clear();
        this.grid.clear();
        this.cursor = { x: 0, y: 0 };
        this.viewport.centerOn(0, 0);
        this.stateManager.reset();
        this.undoStack = new UndoStack(this.timeline);
        this._updateUI();
        this.renderer.render(this.cursor, this.insertMode, this.selection);
        this.minimap.render();
        Logger.info('Editor cleared');
      }
    });

    document.getElementById('help-btn')?.addEventListener('click', () => {
      const instructions = document.querySelector('.instructions');
      if (instructions) {
        instructions.style.display = instructions.style.display === 'none' ? 'block' : 'none';
      }
    });

    // Import/Export
    document.getElementById('export-json-btn')?.addEventListener('click', () => {
      this._exportJSON();
    });

    document.getElementById('export-csv-btn')?.addEventListener('click', () => {
      this._exportCSV();
    });

    document.getElementById('export-asciinema-btn')?.addEventListener('click', () => {
      this._exportAsciinema();
    });

    document.getElementById('import-json-btn')?.addEventListener('click', () => {
      this._importJSON();
    });

    // Persistence
    document.getElementById('save-btn')?.addEventListener('click', () => {
      this._saveState();
    });

    document.getElementById('load-btn')?.addEventListener('click', () => {
      this._loadState();
    });

    // Analysis
    document.getElementById('analyze-btn')?.addEventListener('click', () => {
      this._analyzePatterns();
    });
  }

  _setupSelectionEvents() {
    this.selection.on('selection-changed', () => {
      this.renderer.render(this.cursor, this.insertMode, this.selection);
    });

    this.selection.on('selection-cleared', () => {
      this.renderer.render(this.cursor, this.insertMode, this.selection);
    });
  }

  _setupViewportEvents() {
    // Pan controls
    document.getElementById('pan-up')?.addEventListener('click', () => {
      this.viewport.pan(0, -5);
      this.renderer.render(this.cursor, this.insertMode, this.selection);
      this.minimap.render();
    });

    document.getElementById('pan-down')?.addEventListener('click', () => {
      this.viewport.pan(0, 5);
      this.renderer.render(this.cursor, this.insertMode, this.selection);
      this.minimap.render();
    });

    document.getElementById('pan-left')?.addEventListener('click', () => {
      this.viewport.pan(-5, 0);
      this.renderer.render(this.cursor, this.insertMode, this.selection);
      this.minimap.render();
    });

    document.getElementById('pan-right')?.addEventListener('click', () => {
      this.viewport.pan(5, 0);
      this.renderer.render(this.cursor, this.insertMode, this.selection);
      this.minimap.render();
    });

    document.getElementById('center-cursor')?.addEventListener('click', () => {
      this.viewport.centerOn(this.cursor.x, this.cursor.y);
      this.renderer.render(this.cursor, this.insertMode, this.selection);
      this.minimap.render();
    });

    // Zoom controls
    document.getElementById('zoom-in')?.addEventListener('click', () => {
      this.viewport.zoomIn();
      this.renderer.render(this.cursor, this.insertMode, this.selection);
      this.minimap.render();
    });

    document.getElementById('zoom-out')?.addEventListener('click', () => {
      this.viewport.zoomOut();
      this.renderer.render(this.cursor, this.insertMode, this.selection);
      this.minimap.render();
    });

    document.getElementById('zoom-reset')?.addEventListener('click', () => {
      this.viewport.resetZoom();
      this.renderer.render(this.cursor, this.insertMode, this.selection);
      this.minimap.render();
    });
  }

  _setupMinimapEvents() {
    this.minimap.on('navigate', ({ x, y }) => {
      this.viewport.centerOn(x, y);
      this.renderer.render(this.cursor, this.insertMode, this.selection);
      this.minimap.render();
      Logger.debug('Navigated to', x, y, 'via minimap');
    });
  }

  _onCharTyped(char) {
    // Pause playback if it's running to prevent corruption
    if (this.playback.isPlaying) {
      this.playback.pause();
      this.isPlaying = false;
      Logger.info('Playback paused due to user input');
    }

    // Clear selection if active
    if (this.selection.hasSelection()) {
      this.selection.clearSelection();
    }

    const timestamp = this.timeline.getCurrentTime();
    const color = this.colorPicker.getCurrentColor();

    this.timeline.addEvent({
      type: 'char',
      x: this.cursor.x,
      y: this.cursor.y,
      char,
      color,
      timestamp,
      insertMode: this.insertMode
    });

    // Apply event immediately
    this.stateManager.applyEvent(this.timeline.events[this.timeline.events.length - 1]);

    // Move cursor forward
    this.cursor.x++;

    // Ensure cursor is visible
    this.viewport.ensureVisible(this.cursor.x, this.cursor.y);

    this._updateUI();
    this.renderer.render(this.cursor, this.insertMode, this.selection);
    this.minimap.render();
  }

  _onCursorMove(direction) {
    // Pause playback if it's running
    if (this.playback.isPlaying) {
      this.playback.pause();
      this.isPlaying = false;
      Logger.info('Playback paused due to cursor move');
    }

    const timestamp = this.timeline.getCurrentTime();

    const oldCursor = { ...this.cursor };

    // Update cursor based on direction
    switch (direction) {
      case 'up':
        this.cursor.y = Math.max(this.grid.minY, this.cursor.y - 1);
        break;
      case 'down':
        this.cursor.y++;
        break;
      case 'left':
        this.cursor.x = Math.max(this.grid.minX, this.cursor.x - 1);
        break;
      case 'right':
        this.cursor.x++;
        break;
    }

    // Record cursor move event
    this.timeline.addEvent({
      type: 'cursor-move',
      from: oldCursor,
      to: { ...this.cursor },
      timestamp
    });

    // Ensure cursor is visible
    this.viewport.ensureVisible(this.cursor.x, this.cursor.y);

    this._updateUI();
    this.renderer.render(this.cursor, this.insertMode, this.selection);
    this.minimap.render();
  }

  _onDelete(isBackspace) {
    // Pause playback if it's running
    if (this.playback.isPlaying) {
      this.playback.pause();
      this.isPlaying = false;
      Logger.info('Playback paused due to delete');
    }

    const timestamp = this.timeline.getCurrentTime();

    let targetX = this.cursor.x;
    let targetY = this.cursor.y;

    if (isBackspace) {
      if (this.cursor.x > this.grid.minX) {
        targetX = this.cursor.x - 1;
      } else {
        return; // Can't backspace at start
      }
    }

    const deletedChar = this.grid.getChar(targetX, targetY);

    this.timeline.addEvent({
      type: 'delete',
      x: targetX,
      y: targetY,
      deletedChar,
      isBackspace,
      timestamp
    });

    // Apply event immediately
    this.stateManager.applyEvent(this.timeline.events[this.timeline.events.length - 1]);

    if (isBackspace) {
      this.cursor.x = targetX;
    }

    // Ensure cursor is visible
    this.viewport.ensureVisible(this.cursor.x, this.cursor.y);

    this._updateUI();
    this.renderer.render(this.cursor, this.insertMode, this.selection);
    this.minimap.render();
  }

  _onNewline() {
    // Pause playback if it's running
    if (this.playback.isPlaying) {
      this.playback.pause();
      this.isPlaying = false;
      Logger.info('Playback paused due to newline');
    }

    const timestamp = this.timeline.getCurrentTime();

    this.timeline.addEvent({
      type: 'newline',
      from: { ...this.cursor },
      timestamp
    });

    // Move cursor to start of next line
    this.cursor.x = 0;
    this.cursor.y++;

    // Ensure cursor is visible
    this.viewport.ensureVisible(this.cursor.x, this.cursor.y);

    this._updateUI();
    this.renderer.render(this.cursor, this.insertMode, this.selection);
    this.minimap.render();
  }

  _onToggleInsertMode() {
    this.insertMode = !this.insertMode;
    Logger.info('Insert mode:', this.insertMode ? 'INSERT' : 'OVERWRITE');
    this._updateUI();
    this.renderer.render(this.cursor, this.insertMode, this.selection);
  }

  _onUndo() {
    if (this.undoStack.canUndo()) {
      const removedEvents = this.undoStack.undo();
      Logger.info('Undoing', removedEvents.length, 'events');

      // Remove events from timeline
      for (const event of removedEvents) {
        this.timeline.removeEvent(event.timestamp);
      }

      // Rebuild state from scratch
      this.stateManager.rebuildFromEvents();
      this.cursor = { ...this.stateManager.cursor };

      this.viewport.ensureVisible(this.cursor.x, this.cursor.y);
      this._updateUI();
      this.renderer.render(this.cursor, this.insertMode, this.selection);
      this.minimap.render();
    }
  }

  _onRedo() {
    if (this.undoStack.canRedo()) {
      const restoredEvents = this.undoStack.redo();
      Logger.info('Redoing', restoredEvents.length, 'events');

      // Re-add events to timeline
      for (const event of restoredEvents) {
        this.timeline.events.push(event);
      }

      // Sort by timestamp
      this.timeline.events.sort((a, b) => a.timestamp - b.timestamp);

      // Rebuild state
      this.stateManager.rebuildFromEvents();
      this.cursor = { ...this.stateManager.cursor };

      this.viewport.ensureVisible(this.cursor.x, this.cursor.y);
      this._updateUI();
      this.renderer.render(this.cursor, this.insertMode, this.selection);
      this.minimap.render();
    }
  }

  async _onCopy() {
    if (this.selection.hasSelection()) {
      const success = await this.selection.copy(this.grid);
      if (success) {
        Logger.info('Text copied to clipboard');
      }
    }
  }

  async _onPaste() {
    const text = await this.selection.paste();
    if (text) {
      // Type each character
      for (const char of text) {
        if (char === '\n') {
          this._onNewline();
        } else {
          this._onCharTyped(char);
        }
      }
      Logger.info('Text pasted from clipboard');
    }
  }

  _onAddAnnotation() {
    const currentTime = this.stateManager.currentTime;
    const note = prompt('Enter annotation text:');
    if (note) {
      this.annotations.addAnnotation(currentTime, 'note', note);
      Logger.info('Annotation added at', currentTime);
    }
  }

  _onSelectionStart() {
    this.selection.startSelection(this.cursor.x, this.cursor.y);
  }

  _onSelectionUpdate(direction) {
    // Move cursor in direction and update selection
    const oldX = this.cursor.x;
    const oldY = this.cursor.y;

    switch (direction) {
      case 'up':
        this.cursor.y = Math.max(this.grid.minY, this.cursor.y - 1);
        break;
      case 'down':
        this.cursor.y++;
        break;
      case 'left':
        this.cursor.x = Math.max(this.grid.minX, this.cursor.x - 1);
        break;
      case 'right':
        this.cursor.x++;
        break;
    }

    this.selection.updateSelection(this.cursor.x, this.cursor.y);
    this.viewport.ensureVisible(this.cursor.x, this.cursor.y);
    this._updateUI();
    this.renderer.render(this.cursor, this.insertMode, this.selection);
  }

  _updateUI() {
    // Update mode indicator
    const modeIndicator = document.getElementById('mode-indicator');
    if (modeIndicator) {
      const maxTime = this.timeline.getMaxTime();
      const currentTime = this.stateManager.currentTime;

      if (this.isPlaying) {
        modeIndicator.textContent = 'PLAYING';
        modeIndicator.className = 'mode-indicator mode-playing';
      } else if (currentTime < maxTime) {
        modeIndicator.textContent = 'SCRUBBED';
        modeIndicator.className = 'mode-indicator mode-scrubbed';
      } else {
        modeIndicator.textContent = 'LIVE';
        modeIndicator.className = 'mode-indicator mode-live';
      }
    }

    // Update insert mode indicator
    const insertModeIndicator = document.getElementById('insert-mode-indicator');
    if (insertModeIndicator) {
      insertModeIndicator.textContent = this.insertMode ? 'INSERT (|)' : 'OVERWRITE (█)';
    }

    // Update time display
    const timeDisplay = document.getElementById('time-display');
    if (timeDisplay) {
      const current = this.stateManager.currentTime;
      const max = this.timeline.getMaxTime();
      timeDisplay.textContent = `${current}ms / ${max}ms`;
    }

    // Update cursor display
    const cursorDisplay = document.getElementById('cursor-display');
    if (cursorDisplay) {
      cursorDisplay.textContent = `(${this.cursor.x}, ${this.cursor.y})`;
    }

    // Update event count
    const eventCount = document.getElementById('event-count');
    if (eventCount) {
      eventCount.textContent = this.timeline.events.length;
    }

    // Update timeline playhead
    const playhead = document.getElementById('playhead');
    if (playhead) {
      const maxTime = this.timeline.getMaxTime();
      const percent = maxTime > 0 ? (this.stateManager.currentTime / maxTime) * 100 : 0;
      playhead.style.left = `${percent}%`;
    }

    // Update undo/redo buttons
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    if (undoBtn) undoBtn.disabled = !this.undoStack.canUndo();
    if (redoBtn) redoBtn.disabled = !this.undoStack.canRedo();

    // Update loop button
    const loopBtn = document.getElementById('playback-loop');
    if (loopBtn) {
      loopBtn.style.background = this.playback.loopMode ? '#0a0' : '';
      loopBtn.style.color = this.playback.loopMode ? '#000' : '';
    }
  }

  _exportJSON() {
    const data = {
      version: '3.0-infinite',
      events: this.timeline.events,
      cursor: this.cursor,
      insertMode: this.insertMode,
      annotations: this.annotations.annotations,
      viewport: {
        offsetX: this.viewport.offsetX,
        offsetY: this.viewport.offsetY,
        zoom: this.viewport.zoom
      }
    };

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `temporal-editor-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    Logger.info('Exported JSON');
  }

  _exportCSV() {
    let csv = 'timestamp,type,x,y,char,data\n';

    for (const event of this.timeline.events) {
      const char = event.char ? `"${event.char}"` : '';
      const data = JSON.stringify(event).replace(/"/g, '""');
      csv += `${event.timestamp},${event.type},${event.x || ''},${event.y || ''},${char},"${data}"\n`;
    }

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `temporal-editor-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    Logger.info('Exported CSV');
  }

  _exportAsciinema() {
    const header = {
      version: 2,
      width: this.viewport.cols,
      height: this.viewport.rows,
      timestamp: Math.floor(Date.now() / 1000)
    };

    let output = JSON.stringify(header) + '\n';

    let lastTime = 0;
    for (const event of this.timeline.events) {
      const delay = (event.timestamp - lastTime) / 1000;
      let char = event.char || '';

      if (event.type === 'char') {
        output += `[${delay.toFixed(3)},"o",${JSON.stringify(char)}]\n`;
      } else if (event.type === 'newline') {
        output += `[${delay.toFixed(3)},"o","\\r\\n"]\n`;
      }

      lastTime = event.timestamp;
    }

    const blob = new Blob([output], { type: 'application/x-asciicast' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `temporal-editor-${Date.now()}.cast`;
    a.click();
    URL.revokeObjectURL(url);

    Logger.info('Exported Asciinema .cast file');
  }

  _importJSON() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);

          // Clear current state
          this.timeline.clear();
          this.grid.clear();

          // Import events
          if (data.events) {
            for (const event of data.events) {
              this.timeline.events.push(event);
            }
          }

          // Rebuild state
          this.stateManager.rebuildFromEvents();

          // Restore cursor
          if (data.cursor) {
            this.cursor = data.cursor;
          }

          // Restore insert mode
          if (data.insertMode !== undefined) {
            this.insertMode = data.insertMode;
          }

          // Restore annotations
          if (data.annotations) {
            this.annotations.annotations = data.annotations;
          }

          // Restore viewport
          if (data.viewport) {
            this.viewport.offsetX = data.viewport.offsetX || 0;
            this.viewport.offsetY = data.viewport.offsetY || 0;
            this.viewport.zoom = data.viewport.zoom || 1;
          }

          this.viewport.ensureVisible(this.cursor.x, this.cursor.y);
          this._updateUI();
          this.renderer.render(this.cursor, this.insertMode, this.selection);
          this.minimap.render();

          Logger.info('Imported JSON with', data.events.length, 'events');
        } catch (err) {
          Logger.error('Failed to import JSON:', err);
          alert('Failed to import JSON: ' + err.message);
        }
      };

      reader.readAsText(file);
    };

    input.click();
  }

  _saveState() {
    const state = {
      version: '3.0-infinite',
      events: this.timeline.events,
      cursor: this.cursor,
      insertMode: this.insertMode,
      annotations: this.annotations.annotations,
      viewport: {
        offsetX: this.viewport.offsetX,
        offsetY: this.viewport.offsetY,
        zoom: this.viewport.zoom
      },
      timestamp: Date.now()
    };

    localStorage.setItem('temporal-editor-state', JSON.stringify(state));
    Logger.info('State saved to localStorage');
    alert('State saved!');
  }

  _loadState() {
    const saved = localStorage.getItem('temporal-editor-state');
    if (!saved) {
      alert('No saved state found');
      return;
    }

    try {
      const state = JSON.parse(saved);

      // Clear current state
      this.timeline.clear();
      this.grid.clear();

      // Restore events
      if (state.events) {
        for (const event of state.events) {
          this.timeline.events.push(event);
        }
      }

      // Rebuild state
      this.stateManager.rebuildFromEvents();

      // Restore cursor
      if (state.cursor) {
        this.cursor = state.cursor;
      }

      // Restore insert mode
      if (state.insertMode !== undefined) {
        this.insertMode = state.insertMode;
      }

      // Restore annotations
      if (state.annotations) {
        this.annotations.annotations = state.annotations;
      }

      // Restore viewport
      if (state.viewport) {
        this.viewport.offsetX = state.viewport.offsetX || 0;
        this.viewport.offsetY = state.viewport.offsetY || 0;
        this.viewport.zoom = state.viewport.zoom || 1;
      }

      this.viewport.ensureVisible(this.cursor.x, this.cursor.y);
      this._updateUI();
      this.renderer.render(this.cursor, this.insertMode, this.selection);
      this.minimap.render();

      Logger.info('State loaded from localStorage');
      alert('State loaded!');
    } catch (err) {
      Logger.error('Failed to load state:', err);
      alert('Failed to load state: ' + err.message);
    }
  }

  _startAutoSave() {
    // Auto-save every 30 seconds
    this.autoSaveInterval = setInterval(() => {
      this._saveState();
      Logger.debug('Auto-saved state');
    }, 30000);
  }

  _autoLoad() {
    // Try to load saved state on startup
    const saved = localStorage.getItem('temporal-editor-state');
    if (saved) {
      try {
        const state = JSON.parse(saved);

        // Only auto-load if recent (within 1 hour)
        const age = Date.now() - (state.timestamp || 0);
        if (age < 3600000) {
          Logger.info('Auto-loading recent state...');

          // Restore events
          if (state.events) {
            for (const event of state.events) {
              this.timeline.events.push(event);
            }
          }

          // Rebuild state
          this.stateManager.rebuildFromEvents();

          // Restore cursor
          if (state.cursor) {
            this.cursor = state.cursor;
          }

          // Restore insert mode
          if (state.insertMode !== undefined) {
            this.insertMode = state.insertMode;
          }

          // Restore annotations
          if (state.annotations) {
            this.annotations.annotations = state.annotations;
          }

          // Restore viewport
          if (state.viewport) {
            this.viewport.offsetX = state.viewport.offsetX || 0;
            this.viewport.offsetY = state.viewport.offsetY || 0;
            this.viewport.zoom = state.viewport.zoom || 1;
          }

          this.viewport.ensureVisible(this.cursor.x, this.cursor.y);
          this._updateUI();
          this.renderer.render(this.cursor, this.insertMode, this.selection);
          this.minimap.render();
        }
      } catch (err) {
        Logger.warn('Failed to auto-load state:', err);
      }
    }
  }

  _analyzePatterns() {
    if (this.timeline.events.length === 0) {
      alert('No events to analyze');
      return;
    }

    const analysis = {
      totalEvents: this.timeline.events.length,
      duration: this.timeline.getMaxTime(),
      eventTypes: {},
      charsPerMinute: 0,
      mostUsedChars: {},
      cursorTravel: 0
    };

    // Count event types
    for (const event of this.timeline.events) {
      analysis.eventTypes[event.type] = (analysis.eventTypes[event.type] || 0) + 1;

      if (event.type === 'char' && event.char) {
        analysis.mostUsedChars[event.char] = (analysis.mostUsedChars[event.char] || 0) + 1;
      }
    }

    // Calculate chars per minute
    const charEvents = analysis.eventTypes['char'] || 0;
    const minutes = analysis.duration / 60000;
    analysis.charsPerMinute = minutes > 0 ? Math.round(charEvents / minutes) : 0;

    // Calculate cursor travel distance
    for (let i = 1; i < this.timeline.events.length; i++) {
      const prev = this.timeline.events[i - 1];
      const curr = this.timeline.events[i];

      if (prev.x !== undefined && prev.y !== undefined &&
          curr.x !== undefined && curr.y !== undefined) {
        const dx = Math.abs(curr.x - prev.x);
        const dy = Math.abs(curr.y - prev.y);
        analysis.cursorTravel += dx + dy;
      }
    }

    // Display results
    console.log('=== Pattern Analysis ===');
    console.log('Total Events:', analysis.totalEvents);
    console.log('Duration:', analysis.duration, 'ms');
    console.log('Event Types:', analysis.eventTypes);
    console.log('Chars Per Minute:', analysis.charsPerMinute);
    console.log('Cursor Travel Distance:', analysis.cursorTravel, 'cells');
    console.log('Top 10 Most Used Characters:',
      Object.entries(analysis.mostUsedChars)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
    );

    alert('Pattern analysis complete! See console for details.');
  }
}

// Initialize editor when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new TemporalEditorInfinite();
});
