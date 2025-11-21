/**
 * Selection - Manages text selection for copy/paste
 * Emits events: 'selection-changed', 'selection-cleared'
 */

import { EventEmitter } from '../utils/EventEmitter.js';
import { Logger } from '../utils/Logger.js';

export class Selection extends EventEmitter {
  constructor() {
    super();
    this.active = false;
    this.start = null; // {x, y}
    this.end = null;   // {x, y}
    this.clipboard = ''; // Internal clipboard
  }

  /**
   * Start selection at position
   */
  startSelection(x, y) {
    this.active = true;
    this.start = { x, y };
    this.end = { x, y };
    this.emit('selection-changed', this.getSelection());
    Logger.debug('Selection started at', x, y);
  }

  /**
   * Update selection end point
   */
  updateSelection(x, y) {
    if (!this.active) return;

    this.end = { x, y };
    this.emit('selection-changed', this.getSelection());
  }

  /**
   * End selection
   */
  endSelection() {
    if (!this.active) return;

    // If start equals end, clear selection
    if (this.start.x === this.end.x && this.start.y === this.end.y) {
      this.clearSelection();
      return;
    }

    Logger.debug('Selection ended:', this.getSelection());
  }

  /**
   * Clear selection
   */
  clearSelection() {
    this.active = false;
    this.start = null;
    this.end = null;
    this.emit('selection-cleared');
    Logger.debug('Selection cleared');
  }

  /**
   * Check if there's an active selection
   */
  hasSelection() {
    return this.active && this.start !== null && this.end !== null &&
      !(this.start.x === this.end.x && this.start.y === this.end.y);
  }

  /**
   * Get normalized selection (start is always before end)
   */
  getSelection() {
    if (!this.hasSelection()) return null;

    const startY = Math.min(this.start.y, this.end.y);
    const endY = Math.max(this.start.y, this.end.y);

    let startX, endX;

    if (this.start.y === this.end.y) {
      // Same row
      startX = Math.min(this.start.x, this.end.x);
      endX = Math.max(this.start.x, this.end.x);
    } else if (this.start.y < this.end.y) {
      // Start is before end
      startX = this.start.x;
      endX = this.end.x;
    } else {
      // End is before start
      startX = this.end.x;
      endX = this.start.x;
    }

    return {
      start: { x: startX, y: startY },
      end: { x: endX, y: endY }
    };
  }

  /**
   * Get selected text from grid
   */
  getSelectedText(grid) {
    const selection = this.getSelection();
    if (!selection) return '';

    const { start, end } = selection;
    let text = '';

    if (start.y === end.y) {
      // Single row selection
      for (let x = start.x; x < end.x; x++) {
        text += grid.getChar(x, start.y);
      }
    } else {
      // Multi-row selection
      for (let y = start.y; y <= end.y; y++) {
        if (y === start.y) {
          // First row - from start.x to end of row
          for (let x = start.x; x < grid.cols; x++) {
            text += grid.getChar(x, y);
          }
          text += '\n';
        } else if (y === end.y) {
          // Last row - from 0 to end.x
          for (let x = 0; x < end.x; x++) {
            text += grid.getChar(x, y);
          }
        } else {
          // Middle rows - entire row
          for (let x = 0; x < grid.cols; x++) {
            text += grid.getChar(x, y);
          }
          text += '\n';
        }
      }
    }

    return text;
  }

  /**
   * Copy selected text to clipboard
   */
  async copy(grid) {
    const text = this.getSelectedText(grid);
    if (!text) return false;

    this.clipboard = text;

    // Try to use system clipboard if available
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        Logger.info('Copied to system clipboard:', text.length, 'chars');
      } catch (err) {
        Logger.warn('Failed to copy to system clipboard, using internal:', err);
      }
    }

    Logger.info('Copied to internal clipboard:', text.length, 'chars');
    return true;
  }

  /**
   * Get clipboard text (try system first, fallback to internal)
   */
  async paste() {
    // Try system clipboard first
    if (navigator.clipboard && navigator.clipboard.readText) {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          Logger.info('Pasted from system clipboard:', text.length, 'chars');
          return text;
        }
      } catch (err) {
        Logger.warn('Failed to read from system clipboard:', err);
      }
    }

    // Fallback to internal clipboard
    if (this.clipboard) {
      Logger.info('Pasted from internal clipboard:', this.clipboard.length, 'chars');
      return this.clipboard;
    }

    return '';
  }

  /**
   * Check if position is within selection
   */
  isSelected(x, y) {
    const selection = this.getSelection();
    if (!selection) return false;

    const { start, end } = selection;

    if (y < start.y || y > end.y) return false;

    if (y === start.y && y === end.y) {
      // Same row
      return x >= start.x && x < end.x;
    } else if (y === start.y) {
      // First row
      return x >= start.x;
    } else if (y === end.y) {
      // Last row
      return x < end.x;
    } else {
      // Middle rows
      return true;
    }
  }
}
