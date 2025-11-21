/**
 * VirtualRenderer - Enhanced renderer with viewport support for infinite grids
 */

export class VirtualRenderer {
  constructor(canvasId, grid, viewport) {
    // Get canvas element
    this.canvas = typeof canvasId === 'string'
      ? document.getElementById(canvasId)
      : canvasId;

    if (!this.canvas) {
      throw new Error(`Canvas element not found: ${canvasId}`);
    }

    this.ctx = this.canvas.getContext('2d');
    this.grid = grid;
    this.viewport = viewport;

    // Default font and layout settings
    this.cellWidth = 12;
    this.cellHeight = 20;
    this.padding = 10;
    this.fontSize = 16;
    this.fontFamily = 'Courier New, monospace';

    // Default colors
    this.bgColor = '#000';
    this.textColor = '#0f0';
    this.cursorColor = '#0f0';
    this.cursorAlpha = 0.7;

    // Setup canvas size based on viewport
    if (this.viewport) {
      this.canvas.width = this.viewport.cols * this.cellWidth + this.padding * 2;
      this.canvas.height = this.viewport.rows * this.cellHeight + this.padding * 2;
    } else {
      // Default size
      this.canvas.width = 80 * this.cellWidth + this.padding * 2;
      this.canvas.height = 24 * this.cellHeight + this.padding * 2;
    }
  }

  /**
   * Set viewport for infinite grid mode
   */
  setViewport(viewport) {
    this.viewport = viewport;
  }

  /**
   * Render the complete editor state
   */
  render(cursor, insertMode, selection = null, cursorVisible = true) {
    this.clear();
    if (selection) {
      this.renderSelection(selection);
    }
    this.renderGrid();
    if (cursorVisible) {
      this.renderCursor(cursor, insertMode);
    }
    if (this.viewport) {
      this._renderViewportInfo();
    }
  }

  /**
   * Clear the canvas
   */
  clear() {
    this.ctx.fillStyle = this.bgColor;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Render the text grid with colors
   */
  renderGrid() {
    this.ctx.font = `${this.fontSize}px ${this.fontFamily}`;

    if (this.viewport) {
      // Virtual grid mode - only render visible cells
      const bounds = this.viewport.getBounds();

      for (let y = bounds.minY; y <= bounds.maxY; y++) {
        for (let x = bounds.minX; x <= bounds.maxX; x++) {
          const cell = this.grid.getCell(x, y);
          if (cell.char !== ' ') {
            const pos = this.gridToPixel(x, y);
            this.ctx.fillStyle = cell.color || this.textColor;
            this.ctx.fillText(cell.char, pos.x, pos.y);
          }
        }
      }
    }
  }

  /**
   * Render viewport info overlay
   */
  _renderViewportInfo() {
    if (!this.viewport) return;

    const bounds = this.viewport.getBounds();
    const info = `Viewport: [${bounds.minX},${bounds.minY}] Zoom: ${Math.round(this.viewport.zoom * 100)}%`;

    this.ctx.fillStyle = 'rgba(0, 255, 0, 0.7)';
    this.ctx.font = '10px Courier New';
    this.ctx.fillText(info, 5, 15);
  }

  /**
   * Render selection highlight
   */
  renderSelection(selection) {
    if (!selection || !selection.hasSelection || !selection.hasSelection()) return;

    const sel = selection.getSelection();
    if (!sel) return;

    this.ctx.fillStyle = 'rgba(100, 150, 255, 0.3)';

    const { start, end } = sel;

    if (start.y === end.y) {
      // Single row selection
      const pos = this.gridToPixel(start.x, start.y);
      const width = (end.x - start.x) * this.cellWidth;
      this.ctx.fillRect(
        pos.x,
        pos.y - this.cellHeight + 4,
        width,
        this.cellHeight - 4
      );
    } else {
      // Multi-row selection
      const maxCols = this.viewport ? this.viewport.cols : 80;

      for (let y = start.y; y <= end.y; y++) {
        // Skip if row not visible in viewport
        if (this.viewport && !this.viewport.isVisible(0, y)) {
          continue;
        }

        let startX, endX;

        if (y === start.y) {
          startX = start.x;
          endX = maxCols;
        } else if (y === end.y) {
          startX = 0;
          endX = end.x;
        } else {
          startX = 0;
          endX = maxCols;
        }

        const pos = this.gridToPixel(startX, y);
        const width = (endX - startX) * this.cellWidth;
        this.ctx.fillRect(
          pos.x,
          pos.y - this.cellHeight + 4,
          width,
          this.cellHeight - 4
        );
      }
    }
  }

  /**
   * Render the cursor
   */
  renderCursor(cursor, insertMode) {
    // Check if cursor is visible in viewport
    if (this.viewport && !this.viewport.isVisible(cursor.x, cursor.y)) {
      return; // Don't render cursor if outside viewport
    }

    const pos = this.gridToPixel(cursor.x, cursor.y);

    this.ctx.globalAlpha = this.cursorAlpha;
    this.ctx.fillStyle = this.cursorColor;

    if (insertMode) {
      // Thin line cursor for INSERT mode
      this.ctx.fillRect(
        pos.x,
        pos.y - this.cellHeight + 4,
        2,
        this.cellHeight - 4
      );
    } else {
      // Block cursor for OVERWRITE mode
      this.ctx.fillRect(
        pos.x,
        pos.y - this.cellHeight + 4,
        this.cellWidth,
        this.cellHeight - 4
      );
    }

    this.ctx.globalAlpha = 1.0;
  }

  /**
   * Convert grid coordinates to pixel coordinates
   */
  gridToPixel(x, y) {
    let displayX = x;
    let displayY = y;

    // If viewport is active, convert to viewport-relative coordinates
    if (this.viewport) {
      const viewCoords = this.viewport.toViewportCoords(x, y);
      displayX = viewCoords.x;
      displayY = viewCoords.y;
    }

    return {
      x: this.padding + displayX * this.cellWidth,
      y: this.padding + (displayY + 1) * this.cellHeight - 4
    };
  }

  /**
   * Convert pixel coordinates to grid coordinates
   */
  pixelToGrid(px, py) {
    let x = Math.floor((px - this.padding) / this.cellWidth);
    let y = Math.floor((py - this.padding) / this.cellHeight);

    // If viewport is active, convert from viewport-relative to grid coordinates
    if (this.viewport) {
      const gridCoords = this.viewport.toGridCoords(x, y);
      return gridCoords;
    }

    return { x, y };
  }
}
