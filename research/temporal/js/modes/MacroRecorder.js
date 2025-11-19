/**
 * MacroRecorder - Record and replay sequences of actions
 * Emits events: 'recording-start', 'recording-stop', 'macro-saved', 'macro-replayed'
 */

import { EventEmitter } from '../utils/EventEmitter.js';
import { Logger } from '../utils/Logger.js';

export class MacroRecorder extends EventEmitter {
  constructor() {
    super();
    this.isRecording = false;
    this.currentMacro = null;
    this.macros = new Map();
  }

  /**
   * Start recording a macro
   */
  startRecording(name) {
    if (this.isRecording) {
      Logger.warn('Already recording');
      return false;
    }

    this.isRecording = true;
    this.currentMacro = {
      name,
      events: [],
      startTime: Date.now(),
      description: ''
    };

    this.emit('recording-start', name);
    Logger.info('Started recording macro:', name);
    return true;
  }

  /**
   * Stop recording
   */
  stopRecording() {
    if (!this.isRecording) {
      Logger.warn('Not recording');
      return null;
    }

    this.isRecording = false;
    const macro = this.currentMacro;
    macro.endTime = Date.now();
    macro.duration = macro.endTime - macro.startTime;

    this.emit('recording-stop', macro);
    Logger.info('Stopped recording macro:', macro.name, `(${macro.events.length} events)`);

    return macro;
  }

  /**
   * Record an event (called by main app during recording)
   */
  recordEvent(event) {
    if (!this.isRecording) return;

    // Store relative timestamp
    const relativeTime = Date.now() - this.currentMacro.startTime;
    this.currentMacro.events.push({
      ...event,
      relativeTime
    });
  }

  /**
   * Save current macro
   */
  saveMacro(description = '') {
    if (this.isRecording) {
      this.stopRecording();
    }

    if (!this.currentMacro) {
      Logger.error('No macro to save');
      return false;
    }

    const macro = this.currentMacro;
    macro.description = description;
    this.macros.set(macro.name, macro);

    this.emit('macro-saved', macro);
    Logger.info('Macro saved:', macro.name);
    this.currentMacro = null;
    return true;
  }

  /**
   * Replay a macro at a specific timestamp
   */
  replayMacro(name, startTimestamp, stateManager) {
    const macro = this.macros.get(name);
    if (!macro) {
      Logger.error('Macro not found:', name);
      return false;
    }

    Logger.info('Replaying macro:', name, 'at', startTimestamp + 'ms');

    // Add all macro events to the timeline with adjusted timestamps
    macro.events.forEach(event => {
      const newTimestamp = startTimestamp + event.relativeTime;
      const newEvent = {
        timestamp: newTimestamp,
        action: { ...event.action },
        cursorBefore: { ...event.cursorBefore }
      };
      stateManager.getTimeline().addEvent(newEvent);
    });

    stateManager.rebuildState();
    this.emit('macro-replayed', { macro, startTimestamp });
    return true;
  }

  /**
   * Delete a macro
   */
  deleteMacro(name) {
    if (!this.macros.has(name)) {
      Logger.error('Macro not found:', name);
      return false;
    }

    this.macros.delete(name);
    Logger.info('Macro deleted:', name);
    return true;
  }

  /**
   * List all macros
   */
  listMacros() {
    return Array.from(this.macros.values()).map(m => ({
      name: m.name,
      eventCount: m.events.length,
      duration: m.duration,
      description: m.description
    }));
  }

  /**
   * Get macro
   */
  getMacro(name) {
    return this.macros.get(name);
  }

  /**
   * Export macro to JSON
   */
  exportMacro(name) {
    const macro = this.macros.get(name);
    if (!macro) {
      Logger.error('Macro not found:', name);
      return null;
    }

    const json = JSON.stringify(macro, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `macro-${name}.json`;
    a.click();
    URL.revokeObjectURL(url);
    Logger.info('Macro exported:', name);
    return macro;
  }

  /**
   * Import macro from JSON
   */
  importMacro(jsonData) {
    try {
      const macro = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
      this.macros.set(macro.name, macro);
      Logger.info('Macro imported:', macro.name);
      return true;
    } catch (error) {
      Logger.error('Failed to import macro:', error);
      return false;
    }
  }

  /**
   * Serialize all macros
   */
  serialize() {
    const serialized = {};
    this.macros.forEach((macro, name) => {
      serialized[name] = macro;
    });
    return serialized;
  }

  /**
   * Deserialize macros
   */
  static deserialize(data) {
    const recorder = new MacroRecorder();
    Object.entries(data).forEach(([name, macro]) => {
      recorder.macros.set(name, macro);
    });
    return recorder;
  }
}
