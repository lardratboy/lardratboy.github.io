/**
 * KeyboardHandler - Handles keyboard input
 * Emits events: 'char-typed', 'delete', 'cursor-move', 'toggle-insert-mode'
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
      'Backspace', 'Delete', 'Insert'
    ];
    return key.length === 1 || preventKeys.includes(key);
  }

  _handleKey(e) {
    const { key } = e;

    // Insert mode toggle
    if (key === 'Insert') {
      this.emit('toggle-insert-mode');
      return;
    }

    // Arrow keys - cursor movement
    if (key === 'ArrowLeft') {
      this.emit('cursor-move', { dx: -1, dy: 0 });
      return;
    }
    if (key === 'ArrowRight') {
      this.emit('cursor-move', { dx: 1, dy: 0 });
      return;
    }
    if (key === 'ArrowUp') {
      this.emit('cursor-move', { dx: 0, dy: -1 });
      return;
    }
    if (key === 'ArrowDown') {
      this.emit('cursor-move', { dx: 0, dy: 1 });
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
    if (key.length === 1 && !e.ctrlKey && !e.metaKey) {
      this.emit('char-typed', { char: key });
    }
  }
}
