/**
 * VirtualRenderer - Enhanced renderer with viewport support for infinite grids
 */

export class VirtualRenderer {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.config = config;

    // Setup canvas size
    this.canvas.width = config.GRID.COLS * config.FONT.CHAR_WIDTH + config.LAYOUT.PADDING * 2;
    this.canvas.height = config.GRID.ROWS * config.FONT.LINE_HEIGHT + config.LAYOUT.PADDING * 2;

    // Viewport (optional - for infinite grid mode)
    this.viewport = null;
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
  render(grid, cursor, insertMode, cursorVisible, selection = null) {
    this.clear();
    if (!this.viewport) {
      this.renderRightEdgeBoundary();
    }
    if (selection) {
      this.renderSelection(selection);
    }
    this.renderGrid(grid);
    if (cursorVisible) {
      this.renderCursor(cursor, insertMode);
    }
    if (this.viewport) {
      this._renderViewportInfo();
    }
  }

  /**
   * Render the right edge boundary indicator (fixed grid only)
   */
  renderRightEdgeBoundary() {
    const x = this.config.LAYOUT.PADDING + (this.config.GRID.COLS * this.config.FONT.CHAR_WIDTH);

    this.ctx.strokeStyle = 'rgba(0, 255, 0, 0.3)';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([5, 5]);

    this.ctx.beginPath();
    this.ctx.moveTo(x, this.config.LAYOUT.PADDING);
    this.ctx.lineTo(x, this.canvas.height - this.config.LAYOUT.PADDING);
    this.ctx.stroke();

    // Reset line dash
    this.ctx.setLineDash([]);
  }

  /**
   * Clear the canvas
   */
  clear() {
    this.ctx.fillStyle = this.config.COLORS.BACKGROUND;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Render the text grid with colors
   */
  renderGrid(grid) {
    this.ctx.font = `${this.config.FONT.SIZE}px ${this.config.FONT.FAMILY}`;

    if (this.viewport) {
      // Virtual grid mode - only render visible cells
      const bounds = this.viewport.getBounds();

      for (let y = bounds.minY; y <= bounds.maxY; y++) {
        for (let x = bounds.minX; x <= bounds.maxX; x++) {
          const cell = grid.getCell(x, y);
          if (cell.char !== ' ') {
            const pos = this.gridToPixel(x, y);
            this.ctx.fillStyle = cell.color || this.config.COLORS.TEXT;
            this.ctx.fillText(cell.char, pos.x, pos.y);
          }
        }
      }
    } else {
      // Fixed grid mode - render all cells
      const rows = grid.rows || this.config.GRID.ROWS;
      const cols = grid.cols || this.config.GRID.COLS;

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const cell = grid.getCell(x, y);
          if (cell.char !== ' ') {
            const pos = this.gridToPixel(x, y);
            this.ctx.fillStyle = cell.color || this.config.COLORS.TEXT;
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
      const width = (end.x - start.x) * this.config.FONT.CHAR_WIDTH;
      this.ctx.fillRect(
        pos.x,
        pos.y - this.config.FONT.LINE_HEIGHT + 4,
        width,
        this.config.FONT.LINE_HEIGHT - 4
      );
    } else {
      // Multi-row selection
      const maxCols = this.viewport ? this.viewport.cols : this.config.GRID.COLS;

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
        const width = (endX - startX) * this.config.FONT.CHAR_WIDTH;
        this.ctx.fillRect(
          pos.x,
          pos.y - this.config.FONT.LINE_HEIGHT + 4,
          width,
          this.config.FONT.LINE_HEIGHT - 4
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

    this.ctx.globalAlpha = this.config.COLORS.CURSOR_ALPHA;
    this.ctx.fillStyle = this.config.COLORS.CURSOR;

    if (insertMode) {
      // Thin line cursor for INSERT mode
      this.ctx.fillRect(
        pos.x,
        pos.y - this.config.FONT.LINE_HEIGHT + 4,
        2,
        this.config.FONT.LINE_HEIGHT - 4
      );
    } else {
      // Block cursor for OVERWRITE mode
      this.ctx.fillRect(
        pos.x,
        pos.y - this.config.FONT.LINE_HEIGHT + 4,
        this.config.FONT.CHAR_WIDTH,
        this.config.FONT.LINE_HEIGHT - 4
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
      x: this.config.LAYOUT.PADDING + displayX * this.config.FONT.CHAR_WIDTH,
      y: this.config.LAYOUT.PADDING + (displayY + 1) * this.config.FONT.LINE_HEIGHT - 4
    };
  }

  /**
   * Convert pixel coordinates to grid coordinates
   */
  pixelToGrid(px, py) {
    let x = Math.floor((px - this.config.LAYOUT.PADDING) / this.config.FONT.CHAR_WIDTH);
    let y = Math.floor((py - this.config.LAYOUT.PADDING) / this.config.FONT.LINE_HEIGHT);

    // If viewport is active, convert from viewport-relative to grid coordinates
    if (this.viewport) {
      const gridCoords = this.viewport.toGridCoords(x, y);
      return gridCoords;
    }

    return {
      x: Math.max(0, Math.min(this.config.GRID.COLS - 1, x)),
      y: Math.max(0, Math.min(this.config.GRID.ROWS - 1, y))
    };
  }
}
