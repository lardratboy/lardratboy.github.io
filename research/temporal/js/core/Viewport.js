/**
 * Viewport - Manages the visible area of the infinite grid
 * Emits events: 'viewport-changed', 'zoom-changed'
 */

import { EventEmitter } from '../utils/EventEmitter.js';
import { Logger } from '../utils/Logger.js';

export class Viewport extends EventEmitter {
  constructor(x, y, cols, rows) {
    super();

    // Viewport position (top-left corner in grid coordinates)
    this.x = x || 0;
    this.y = y || 0;

    // Base viewport size in grid cells (at 100% zoom)
    this.baseCols = cols || 80;
    this.baseRows = rows || 24;

    // Current viewport size (affected by zoom)
    this.cols = this.baseCols;
    this.rows = this.baseRows;

    // Viewport offset for panning
    this.offsetX = 0;
    this.offsetY = 0;

    // Zoom level (1.0 = 100%)
    this.zoom = 1.0;
    this.minZoom = 0.5;
    this.maxZoom = 2.0;
  }

  /**
   * Pan viewport by delta
   */
  pan(dx, dy) {
    this.x += dx;
    this.y += dy;
    this.emit('viewport-changed', this.getInfo());
    Logger.debug(`Viewport panned to (${this.x}, ${this.y})`);
  }

  /**
   * Set viewport position
   */
  setPosition(x, y) {
    this.x = x;
    this.y = y;
    this.emit('viewport-changed', this.getInfo());
  }

  /**
   * Center viewport on position
   */
  centerOn(x, y) {
    this.x = Math.floor(x - this.cols / 2);
    this.y = Math.floor(y - this.rows / 2);
    this.emit('viewport-changed', this.getInfo());
    Logger.debug(`Viewport centered on (${x}, ${y})`);
  }

  /**
   * Ensure position is visible in viewport
   */
  ensureVisible(x, y) {
    let changed = false;

    // Check if position is outside viewport
    if (x < this.x) {
      this.x = x;
      changed = true;
    } else if (x >= this.x + this.cols) {
      this.x = x - this.cols + 1;
      changed = true;
    }

    if (y < this.y) {
      this.y = y;
      changed = true;
    } else if (y >= this.y + this.rows) {
      this.y = y - this.rows + 1;
      changed = true;
    }

    if (changed) {
      this.emit('viewport-changed', this.getInfo());
      Logger.debug(`Viewport adjusted to show (${x}, ${y})`);
    }
  }

  /**
   * Zoom in
   */
  zoomIn() {
    const newZoom = Math.min(this.zoom * 1.2, this.maxZoom);
    if (newZoom !== this.zoom) {
      this.setZoom(newZoom);
    }
  }

  /**
   * Zoom out
   */
  zoomOut() {
    const newZoom = Math.max(this.zoom / 1.2, this.minZoom);
    if (newZoom !== this.zoom) {
      this.setZoom(newZoom);
    }
  }

  /**
   * Set zoom level
   */
  setZoom(zoom) {
    const oldZoom = this.zoom;
    this.zoom = Math.max(this.minZoom, Math.min(zoom, this.maxZoom));

    // Adjust viewport size based on zoom
    // More zoom = fewer cells visible
    this.cols = Math.floor(this.baseCols / this.zoom);
    this.rows = Math.floor(this.baseRows / this.zoom);

    this.emit('zoom-changed', this.zoom);
    this.emit('viewport-changed', this.getInfo());
    Logger.debug(`Zoom changed from ${oldZoom.toFixed(2)} to ${this.zoom.toFixed(2)}`);
  }

  /**
   * Reset zoom to 100%
   */
  resetZoom() {
    this.setZoom(1.0);
  }

  /**
   * Get viewport bounds
   */
  getBounds() {
    return {
      minX: this.x,
      minY: this.y,
      maxX: this.x + this.cols - 1,
      maxY: this.y + this.rows - 1
    };
  }

  /**
   * Check if position is in viewport
   */
  isVisible(x, y) {
    const bounds = this.getBounds();
    return x >= bounds.minX && x <= bounds.maxX &&
           y >= bounds.minY && y <= bounds.maxY;
  }

  /**
   * Convert grid coordinates to viewport-relative coordinates
   */
  toViewportCoords(gridX, gridY) {
    return {
      x: gridX - this.x,
      y: gridY - this.y
    };
  }

  /**
   * Convert viewport coordinates to grid coordinates
   */
  toGridCoords(viewX, viewY) {
    return {
      x: viewX + this.x,
      y: viewY + this.y
    };
  }

  /**
   * Get viewport info
   */
  getInfo() {
    return {
      x: this.x,
      y: this.y,
      cols: this.cols,
      rows: this.rows,
      zoom: this.zoom,
      bounds: this.getBounds()
    };
  }

  /**
   * Serialize viewport state
   */
  serialize() {
    return {
      x: this.x,
      y: this.y,
      zoom: this.zoom
    };
  }

  /**
   * Deserialize viewport state
   */
  static deserialize(data, cols = 80, rows = 24) {
    const viewport = new Viewport(0, 0, cols, rows);
    if (data) {
      viewport.x = data.x || 0;
      viewport.y = data.y || 0;
      if (data.zoom) {
        viewport.setZoom(data.zoom);
      }
    }
    return viewport;
  }
}
