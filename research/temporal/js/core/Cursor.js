/**
 * Cursor - Manages cursor position and movement
 */

export class Cursor {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  /**
   * Move cursor by delta
   */
  move(dx, dy, bounds) {
    this.x = Math.max(0, Math.min(bounds.cols - 1, this.x + dx));
    this.y = Math.max(0, Math.min(bounds.rows - 1, this.y + dy));
  }

  /**
   * Teleport cursor to absolute position
   */
  teleport(x, y, bounds) {
    this.x = Math.max(0, Math.min(bounds.cols - 1, x));
    this.y = Math.max(0, Math.min(bounds.rows - 1, y));
  }

  /**
   * Move cursor right (with wrapping)
   */
  moveRight(bounds) {
    this.x++;
    if (this.x >= bounds.cols) {
      this.x = 0;
      this.y = Math.min(this.y + 1, bounds.rows - 1);
    }
  }

  /**
   * Move cursor left
   */
  moveLeft() {
    this.x = Math.max(0, this.x - 1);
  }

  /**
   * Clone cursor
   */
  clone() {
    return new Cursor(this.x, this.y);
  }

  /**
   * Set from another cursor
   */
  set(cursor) {
    this.x = cursor.x;
    this.y = cursor.y;
  }

  /**
   * Serialize to JSON
   */
  serialize() {
    return { x: this.x, y: this.y };
  }

  /**
   * Deserialize from JSON
   */
  static deserialize(data) {
    return new Cursor(data.x, data.y);
  }

  /**
   * Check equality
   */
  equals(other) {
    return this.x === other.x && this.y === other.y;
  }
}
