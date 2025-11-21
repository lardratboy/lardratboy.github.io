/**
 * Minimap - Shows overview of entire grid with viewport indicator
 * Emits events: 'navigate'
 */

import { EventEmitter } from '../utils/EventEmitter.js';

export class Minimap extends EventEmitter {
  constructor(canvasId, grid, viewport) {
    super();
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) {
      // Create canvas if it doesn't exist
      this.canvas = document.createElement('canvas');
      this.canvas.id = canvasId;
    }
    this.ctx = this.canvas.getContext('2d');
    this.grid = grid;
    this.viewport = viewport;

    // Minimap dimensions
    this.width = 200;
    this.height = 150;
    this.canvas.width = this.width;
    this.canvas.height = this.height;

    // Add click handler
    this.canvas.addEventListener('click', this._onClick.bind(this));
    this.canvas.style.cursor = 'pointer';
  }

  /**
   * Render minimap
   */
  render() {
    this.clear();

    const bounds = this.grid.getBounds();
    const gridWidth = bounds.maxX - bounds.minX + 1;
    const gridHeight = bounds.maxY - bounds.minY + 1;

    // Don't render if grid is empty
    if (gridWidth <= 0 || gridHeight <= 0) {
      this._renderEmpty();
      return;
    }

    // Calculate scale to fit grid in minimap
    const scaleX = (this.width - 20) / gridWidth;
    const scaleY = (this.height - 20) / gridHeight;
    const scale = Math.min(scaleX, scaleY);

    // Center the grid in minimap
    const offsetX = 10 + (this.width - 20 - gridWidth * scale) / 2;
    const offsetY = 10 + (this.height - 20 - gridHeight * scale) / 2;

    // Store for click handling
    this.scale = scale;
    this.offsetX = offsetX;
    this.offsetY = offsetY;
    this.gridBounds = bounds;

    // Render grid cells
    this.grid.cells.forEach((cell, key) => {
      const [x, y] = key.split(',').map(Number);

      if (cell.char !== ' ') {
        const px = offsetX + (x - bounds.minX) * scale;
        const py = offsetY + (y - bounds.minY) * scale;

        // Use cell color but dimmed
        this.ctx.fillStyle = this._dimColor(cell.color);
        this.ctx.fillRect(px, py, Math.max(1, scale), Math.max(1, scale));
      }
    });

    // Render viewport rectangle
    const vpBounds = this.viewport.getBounds();
    const vpX = offsetX + (vpBounds.minX - bounds.minX) * scale;
    const vpY = offsetY + (vpBounds.minY - bounds.minY) * scale;
    const vpW = (vpBounds.maxX - vpBounds.minX + 1) * scale;
    const vpH = (vpBounds.maxY - vpBounds.minY + 1) * scale;

    this.ctx.strokeStyle = '#ff0';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(vpX, vpY, vpW, vpH);

    // Draw border
    this.ctx.strokeStyle = '#0a0';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(0, 0, this.width, this.height);
  }

  /**
   * Render empty state
   */
  _renderEmpty() {
    this.ctx.fillStyle = '#0a0';
    this.ctx.font = '12px Courier New';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Empty', this.width / 2, this.height / 2);

    // Draw border
    this.ctx.strokeStyle = '#0a0';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(0, 0, this.width, this.height);
  }

  /**
   * Dim a color for minimap rendering
   */
  _dimColor(color) {
    // Simple dimming - reduce opacity
    if (color.startsWith('#')) {
      return color + '80'; // Add alpha
    }
    return color;
  }

  /**
   * Clear minimap
   */
  clear() {
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  /**
   * Handle click on minimap
   */
  _onClick(e) {
    if (!this.scale || !this.gridBounds) return;

    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    // Convert pixel to grid coordinates
    const gridX = Math.floor((px - this.offsetX) / this.scale + this.gridBounds.minX);
    const gridY = Math.floor((py - this.offsetY) / this.scale + this.gridBounds.minY);

    this.emit('navigate', { x: gridX, y: gridY });
  }

  /**
   * Destroy minimap
   */
  destroy() {
    this.removeAllListeners();
  }
}
