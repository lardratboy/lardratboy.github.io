/**
 * UndoStack - Traditional undo/redo on top of event sourcing
 * Tracks groups of events that should be undone together
 * Emits events: 'can-undo-changed', 'can-redo-changed', 'undo', 'redo'
 */

import { EventEmitter } from '../utils/EventEmitter.js';
import { Logger } from '../utils/Logger.js';

export class UndoStack extends EventEmitter {
  constructor(stateManager) {
    super();
    this.stateManager = stateManager;
    this.undoStack = [];
    this.redoStack = [];
    this.currentGroup = null;
    this.groupTimeout = null;
    this.groupDelay = 500; // ms - events within this time are grouped
  }

  /**
   * Start a new undo group (for grouping multiple events)
   */
  beginGroup(description = '') {
    this.endGroup(); // End any existing group

    this.currentGroup = {
      description,
      events: [],
      startTime: Date.now(),
      endTime: null
    };

    Logger.debug('Undo group started:', description);
  }

  /**
   * End the current undo group
   */
  endGroup() {
    if (this.currentGroup && this.currentGroup.events.length > 0) {
      this.currentGroup.endTime = Date.now();
      this.undoStack.push(this.currentGroup);
      this.redoStack = []; // Clear redo stack when new action is performed
      this.currentGroup = null;

      this._emitCanUndoRedoChanged();
      Logger.debug('Undo group ended, stack size:', this.undoStack.length);
    } else {
      this.currentGroup = null;
    }

    if (this.groupTimeout) {
      clearTimeout(this.groupTimeout);
      this.groupTimeout = null;
    }
  }

  /**
   * Record an event to the current undo group
   */
  recordEvent(event) {
    // Auto-start a group if none exists
    if (!this.currentGroup) {
      this.beginGroup('Auto group');
    }

    this.currentGroup.events.push({
      eventId: event.timestamp,
      event: { ...event }
    });

    // Auto-end group after delay
    if (this.groupTimeout) {
      clearTimeout(this.groupTimeout);
    }

    this.groupTimeout = setTimeout(() => {
      this.endGroup();
    }, this.groupDelay);
  }

  /**
   * Undo the last action group
   */
  undo() {
    this.endGroup(); // End any pending group

    if (this.undoStack.length === 0) {
      Logger.warn('Nothing to undo');
      return false;
    }

    const group = this.undoStack.pop();
    this.redoStack.push(group);

    // Remove events from timeline
    const timeline = this.stateManager.getTimeline();
    group.events.forEach(({ eventId }) => {
      timeline.removeEvent(eventId);
    });

    // Rebuild state
    this.stateManager.rebuildState();

    this._emitCanUndoRedoChanged();
    this.emit('undo', group);
    Logger.info('Undo:', group.description || `${group.events.length} events`);

    return true;
  }

  /**
   * Redo the last undone action group
   */
  redo() {
    this.endGroup(); // End any pending group

    if (this.redoStack.length === 0) {
      Logger.warn('Nothing to redo');
      return false;
    }

    const group = this.redoStack.pop();
    this.undoStack.push(group);

    // Re-add events to timeline
    const timeline = this.stateManager.getTimeline();
    group.events.forEach(({ event }) => {
      timeline.addEvent(event);
    });

    // Rebuild state
    this.stateManager.rebuildState();

    this._emitCanUndoRedoChanged();
    this.emit('redo', group);
    Logger.info('Redo:', group.description || `${group.events.length} events`);

    return true;
  }

  /**
   * Check if undo is available
   */
  canUndo() {
    return this.undoStack.length > 0;
  }

  /**
   * Check if redo is available
   */
  canRedo() {
    return this.redoStack.length > 0;
  }

  /**
   * Clear undo/redo stacks
   */
  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.currentGroup = null;

    if (this.groupTimeout) {
      clearTimeout(this.groupTimeout);
      this.groupTimeout = null;
    }

    this._emitCanUndoRedoChanged();
    Logger.debug('Undo stack cleared');
  }

  _emitCanUndoRedoChanged() {
    this.emit('can-undo-changed', this.canUndo());
    this.emit('can-redo-changed', this.canRedo());
  }

  /**
   * Get undo stack info
   */
  getInfo() {
    return {
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
      canUndo: this.canUndo(),
      canRedo: this.canRedo()
    };
  }
}
