/**
 * VirtualGrid - Infinite grid with dynamic bounds
 * Only stores cells that have been written to (sparse storage)
 */

export class VirtualGrid {
  constructor() {
    this.cells = new Map(); // key: "x,y" -> {char, color}
    this.bounds = {
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0
    };
  }

  /**
   * Get cell key for Map storage
   */
  _getKey(x, y) {
    return `${x},${y}`;
  }

  /**
   * Get character at position
   */
  getChar(x, y) {
    const cell = this.cells.get(this._getKey(x, y));
    return cell ? cell.char : ' ';
  }

  /**
   * Get cell at position (returns {char, color})
   */
  getCell(x, y) {
    const cell = this.cells.get(this._getKey(x, y));
    return cell || { char: ' ', color: '#0f0' };
  }

  /**
   * Get color at position
   */
  getColor(x, y) {
    const cell = this.cells.get(this._getKey(x, y));
    return cell ? cell.color : '#0f0';
  }

  /**
   * Set character at position
   */
  setChar(x, y, char, color = null) {
    const key = this._getKey(x, y);
    let cell = this.cells.get(key);

    if (!cell) {
      cell = { char: ' ', color: '#0f0' };
      this.cells.set(key, cell);
    }

    cell.char = char;
    if (color !== null) {
      cell.color = color;
    }

    // Update bounds
    this._updateBounds(x, y);
  }

  /**
   * Set cell at position
   */
  setCell(x, y, char, color) {
    this.cells.set(this._getKey(x, y), { char, color });
    this._updateBounds(x, y);
  }

  /**
   * Update grid bounds to include position
   */
  _updateBounds(x, y) {
    this.bounds.minX = Math.min(this.bounds.minX, x);
    this.bounds.maxX = Math.max(this.bounds.maxX, x);
    this.bounds.minY = Math.min(this.bounds.minY, y);
    this.bounds.maxY = Math.max(this.bounds.maxY, y);
  }

  /**
   * Shift row right from position (for INSERT mode)
   */
  shiftRowRight(y, fromX) {
    // Collect all cells in row at or after fromX
    const rowCells = [];
    this.cells.forEach((cell, key) => {
      const [cellX, cellY] = key.split(',').map(Number);
      if (cellY === y && cellX >= fromX) {
        rowCells.push({ x: cellX, cell });
      }
    });

    // Sort by x descending and shift right
    rowCells.sort((a, b) => b.x - a.x);
    rowCells.forEach(({ x, cell }) => {
      this.cells.delete(this._getKey(x, y));
      this.cells.set(this._getKey(x + 1, y), cell);
      this._updateBounds(x + 1, y);
    });
  }

  /**
   * Shift row left from position (for INSERT mode delete)
   */
  shiftRowLeft(y, fromX) {
    // Collect all cells in row after fromX
    const rowCells = [];
    this.cells.forEach((cell, key) => {
      const [cellX, cellY] = key.split(',').map(Number);
      if (cellY === y && cellX > fromX) {
        rowCells.push({ x: cellX, cell });
      }
    });

    // Sort by x ascending and shift left
    rowCells.sort((a, b) => a.x - b.x);
    rowCells.forEach(({ x, cell }) => {
      this.cells.delete(this._getKey(x, y));
      this.cells.set(this._getKey(x - 1, y), cell);
    });

    // Delete cell at fromX
    this.cells.delete(this._getKey(fromX, y));
  }

  /**
   * Get all non-empty cells in viewport
   */
  getCellsInViewport(minX, minY, maxX, maxY) {
    const cells = [];
    this.cells.forEach((cell, key) => {
      const [x, y] = key.split(',').map(Number);
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
        cells.push({ x, y, ...cell });
      }
    });
    return cells;
  }

  /**
   * Get actual used bounds
   */
  getBounds() {
    return { ...this.bounds };
  }

  /**
   * Get grid dimensions (bounds size)
   */
  getSize() {
    return {
      width: this.bounds.maxX - this.bounds.minX + 1,
      height: this.bounds.maxY - this.bounds.minY + 1
    };
  }

  /**
   * Clear entire grid
   */
  clear() {
    this.cells.clear();
    this.bounds = {
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0
    };
  }

  /**
   * Clone this grid
   */
  clone() {
    const newGrid = new VirtualGrid();
    this.cells.forEach((cell, key) => {
      newGrid.cells.set(key, { ...cell });
    });
    newGrid.bounds = { ...this.bounds };
    return newGrid;
  }

  /**
   * Serialize to JSON
   */
  serialize() {
    const cellsArray = [];
    this.cells.forEach((cell, key) => {
      const [x, y] = key.split(',').map(Number);
      cellsArray.push({ x, y, char: cell.char, color: cell.color });
    });

    return {
      cells: cellsArray,
      bounds: this.bounds
    };
  }

  /**
   * Deserialize from JSON
   */
  static deserialize(data) {
    const grid = new VirtualGrid();

    if (data.cells) {
      data.cells.forEach(({ x, y, char, color }) => {
        grid.setCell(x, y, char, color);
      });
    }

    if (data.bounds) {
      grid.bounds = { ...data.bounds };
    }

    return grid;
  }

  // Legacy compatibility methods for fixed grid size
  get cols() {
    return this.getSize().width;
  }

  get rows() {
    return this.getSize().height;
  }
}
