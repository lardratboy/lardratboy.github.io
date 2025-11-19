/**
 * MouseHandler - Handles mouse/touch input on canvas
 * Emits events: 'cursor-teleport'
 */

import { EventEmitter } from '../utils/EventEmitter.js';
import { Logger } from '../utils/Logger.js';

export class MouseHandler extends EventEmitter {
  constructor(canvas, renderer) {
    super();
    this.canvas = canvas;
    this.renderer = renderer;
    this.attached = false;
  }

  attachTo(canvas) {
    if (this.attached) return;

    this._boundClick = this._onClick.bind(this);
    canvas.addEventListener('click', this._boundClick);
    this.attached = true;
    Logger.debug('MouseHandler attached');
  }

  detach() {
    if (!this.attached) return;

    this.canvas.removeEventListener('click', this._boundClick);
    this.attached = false;
    Logger.debug('MouseHandler detached');
  }

  _onClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const gridPos = this.renderer.pixelToGrid(px, py);
    this.emit('cursor-teleport', gridPos);
    Logger.debug(`Cursor teleport requested: (${gridPos.x}, ${gridPos.y})`);
  }
}
