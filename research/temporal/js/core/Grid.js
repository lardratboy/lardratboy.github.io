/**
 * Grid - Manages the character grid state
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
        cells[y][x] = ' ';
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
    newGrid.cells = this.cells.map(row => [...row]);
    return newGrid;
  }

  /**
   * Get character at position
   */
  getChar(x, y) {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) {
      return ' ';
    }
    return this.cells[y][x];
  }

  /**
   * Set character at position
   */
  setChar(x, y, char) {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) {
      return;
    }
    this.cells[y][x] = char;
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
    this.cells[y][this.cols - 1] = ' ';
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
      cells: this.cells.map(row => row.join(''))
    };
  }

  /**
   * Deserialize from JSON
   */
  static deserialize(data) {
    const grid = new Grid(data.cols, data.rows);
    grid.cells = data.cells.map(row => row.split(''));
    return grid;
  }
}
