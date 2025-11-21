/**
 * Grid - Manages the character grid state with color support
 */

export class Grid {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.cells = this._createEmpty();
  }

  _createEmpty() {
    const cells = [];
    for (let y = 0; y < this.rows; y++) {
      cells[y] = [];
      for (let x = 0; x < this.cols; x++) {
        cells[y][x] = { char: ' ', color: '#0f0' };
      }
    }
    return cells;
  }

  /**
   * Create a new empty grid
   */
  static createEmpty(cols, rows) {
    return new Grid(cols, rows);
  }

  /**
   * Clone this grid
   */
  clone() {
    const newGrid = new Grid(this.cols, this.rows);
    newGrid.cells = this.cells.map(row => row.map(cell => ({ ...cell })));
    return newGrid;
  }

  /**
   * Get character at position
   */
  getChar(x, y) {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) {
      return ' ';
    }
    return this.cells[y][x].char;
  }

  /**
   * Get cell at position (returns {char, color})
   */
  getCell(x, y) {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) {
      return { char: ' ', color: '#0f0' };
    }
    return this.cells[y][x];
  }

  /**
   * Get color at position
   */
  getColor(x, y) {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) {
      return '#0f0';
    }
    return this.cells[y][x].color;
  }

  /**
   * Set character at position
   */
  setChar(x, y, char, color = null) {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) {
      return;
    }
    this.cells[y][x].char = char;
    if (color !== null) {
      this.cells[y][x].color = color;
    }
  }

  /**
   * Set cell at position
   */
  setCell(x, y, char, color) {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) {
      return;
    }
    this.cells[y][x] = { char, color };
  }

  /**
   * Shift row right from position (for INSERT mode)
   */
  shiftRowRight(y, fromX) {
    if (y < 0 || y >= this.rows) return;

    for (let x = this.cols - 1; x > fromX; x--) {
      this.cells[y][x] = this.cells[y][x - 1];
    }
  }

  /**
   * Shift row left from position (for INSERT mode delete)
   */
  shiftRowLeft(y, fromX) {
    if (y < 0 || y >= this.rows) return;

    for (let x = fromX; x < this.cols - 1; x++) {
      this.cells[y][x] = this.cells[y][x + 1];
    }
    this.cells[y][this.cols - 1] = { char: ' ', color: '#0f0' };
  }

  /**
   * Clear entire grid
   */
  clear() {
    this.cells = this._createEmpty();
  }

  /**
   * Serialize to JSON
   */
  serialize() {
    return {
      cols: this.cols,
      rows: this.rows,
      cells: this.cells.map(row => row.map(cell => ({
        char: cell.char,
        color: cell.color
      })))
    };
  }

  /**
   * Deserialize from JSON
   */
  static deserialize(data) {
    const grid = new Grid(data.cols, data.rows);

    // Handle old format (strings) and new format (objects with color)
    grid.cells = data.cells.map(row => {
      if (typeof row === 'string') {
        // Old format - convert to new format
        return row.split('').map(char => ({ char, color: '#0f0' }));
      } else {
        // New format
        return row.map(cell => ({
          char: cell.char || ' ',
          color: cell.color || '#0f0'
        }));
      }
    });

    return grid;
  }
}
