/**
 * Renderer - Canvas rendering for the editor grid
 */

export class Renderer {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.config = config;

    // Setup canvas size
    this.canvas.width = config.GRID.COLS * config.FONT.CHAR_WIDTH + config.LAYOUT.PADDING * 2;
    this.canvas.height = config.GRID.ROWS * config.FONT.LINE_HEIGHT + config.LAYOUT.PADDING * 2;

    // Cache for dirty checking
    this.lastRendered = null;
  }

  /**
   * Render the complete editor state
   */
  render(grid, cursor, insertMode, cursorVisible) {
    this.clear();
    this.renderRightEdgeBoundary();
    this.renderGrid(grid);
    if (cursorVisible) {
      this.renderCursor(cursor, insertMode);
    }
  }

  /**
   * Render the right edge boundary indicator
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

    for (let y = 0; y < grid.rows; y++) {
      for (let x = 0; x < grid.cols; x++) {
        const cell = grid.getCell(x, y);
        if (cell.char !== ' ') {
          const pos = this.gridToPixel(x, y);
          this.ctx.fillStyle = cell.color || this.config.COLORS.TEXT;
          this.ctx.fillText(cell.char, pos.x, pos.y);
        }
      }
    }
  }

  /**
   * Render the cursor
   */
  renderCursor(cursor, insertMode) {
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
    return {
      x: this.config.LAYOUT.PADDING + x * this.config.FONT.CHAR_WIDTH,
      y: this.config.LAYOUT.PADDING + (y + 1) * this.config.FONT.LINE_HEIGHT - 4
    };
  }

  /**
   * Convert pixel coordinates to grid coordinates
   */
  pixelToGrid(px, py) {
    const x = Math.floor((px - this.config.LAYOUT.PADDING) / this.config.FONT.CHAR_WIDTH);
    const y = Math.floor((py - this.config.LAYOUT.PADDING) / this.config.FONT.LINE_HEIGHT);

    return {
      x: Math.max(0, Math.min(this.config.GRID.COLS - 1, x)),
      y: Math.max(0, Math.min(this.config.GRID.ROWS - 1, y))
    };
  }
}
