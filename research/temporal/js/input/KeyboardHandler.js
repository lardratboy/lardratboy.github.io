/**
 * KeyboardHandler - Handles keyboard input
 * Emits events: 'char-typed', 'delete', 'cursor-move', 'toggle-insert-mode', 'newline'
 */

import { EventEmitter } from '../utils/EventEmitter.js';
import { Logger } from '../utils/Logger.js';

export class KeyboardHandler extends EventEmitter {
  constructor() {
    super();
    this.attached = false;
  }

  attachTo(element) {
    if (this.attached) return;

    this._boundKeyDown = this._onKeyDown.bind(this);
    element.addEventListener('keydown', this._boundKeyDown);
    this.attached = true;
    Logger.debug('KeyboardHandler attached');
  }

  detach() {
    if (!this.attached) return;

    document.removeEventListener('keydown', this._boundKeyDown);
    this.attached = false;
    Logger.debug('KeyboardHandler detached');
  }

  _onKeyDown(e) {
    // Prevent default for handled keys
    if (!e.ctrlKey && !e.metaKey) {
      if (this._shouldPreventDefault(e.key)) {
        e.preventDefault();
      }
    }

    this._handleKey(e);
  }

  _shouldPreventDefault(key) {
    const preventKeys = [
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
      'Backspace', 'Delete', 'Insert', 'Enter'
    ];
    return key.length === 1 || preventKeys.includes(key);
  }

  _handleKey(e) {
    const { key, shiftKey, ctrlKey, metaKey } = e;
    const modKey = ctrlKey || metaKey; // Ctrl on Windows/Linux, Cmd on Mac

    // Keyboard shortcuts with Ctrl/Cmd
    if (modKey) {
      if (key === 'z' || key === 'Z') {
        this.emit('undo');
        return;
      }
      if (key === 'y' || key === 'Y') {
        this.emit('redo');
        return;
      }
      if (key === 'c' || key === 'C') {
        this.emit('copy');
        return;
      }
      if (key === 'x' || key === 'X') {
        this.emit('cut');
        return;
      }
      if (key === 'v' || key === 'V') {
        this.emit('paste');
        return;
      }
      if (key === 'b' || key === 'B') {
        this.emit('add-annotation');
        return;
      }
      // Let other Ctrl+key combinations pass through
      return;
    }

    // Insert mode toggle
    if (key === 'Insert') {
      this.emit('toggle-insert-mode');
      return;
    }

    // Arrow keys - cursor movement or selection
    if (key === 'ArrowLeft') {
      if (shiftKey) {
        this.emit('selection-move', { dx: -1, dy: 0 });
      } else {
        this.emit('cursor-move', { dx: -1, dy: 0 });
      }
      return;
    }
    if (key === 'ArrowRight') {
      if (shiftKey) {
        this.emit('selection-move', { dx: 1, dy: 0 });
      } else {
        this.emit('cursor-move', { dx: 1, dy: 0 });
      }
      return;
    }
    if (key === 'ArrowUp') {
      if (shiftKey) {
        this.emit('selection-move', { dx: 0, dy: -1 });
      } else {
        this.emit('cursor-move', { dx: 0, dy: -1 });
      }
      return;
    }
    if (key === 'ArrowDown') {
      if (shiftKey) {
        this.emit('selection-move', { dx: 0, dy: 1 });
      } else {
        this.emit('cursor-move', { dx: 0, dy: 1 });
      }
      return;
    }

    // Escape - clear selection
    if (key === 'Escape') {
      this.emit('escape');
      return;
    }

    // Enter/Return - newline
    if (key === 'Enter') {
      this.emit('newline');
      return;
    }

    // Delete keys
    if (key === 'Backspace') {
      this.emit('delete', { isBackspace: true });
      return;
    }
    if (key === 'Delete') {
      this.emit('delete', { isBackspace: false });
      return;
    }

    // Printable characters
    if (key.length === 1) {
      this.emit('char-typed', { char: key });
    }
  }
}
