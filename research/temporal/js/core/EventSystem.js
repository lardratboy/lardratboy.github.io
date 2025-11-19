/**
 * EventSystem - Creates and applies events
 */

export class EventSystem {
  /**
   * Create an insert character event
   */
  static createInsertChar(char, x, y, insertMode, cursor) {
    return {
      type: 'insert_char',
      char,
      x,
      y,
      insertMode
    };
  }

  /**
   * Create a delete character event
   */
  static createDeleteChar(x, y, moveCursor) {
    return {
      type: 'delete_char',
      x,
      y,
      moveCursor
    };
  }

  /**
   * Create a delete and shift event (INSERT mode delete)
   */
  static createDeleteAndShift(x, y, moveCursor) {
    return {
      type: 'delete_and_shift',
      x,
      y,
      moveCursor
    };
  }

  /**
   * Create a cursor move event
   */
  static createCursorMove(dx, dy) {
    return {
      type: 'cursor_move',
      dx,
      dy
    };
  }

  /**
   * Apply an event to grid and cursor
   * @param {Object} event - The full event with timestamp and cursorBefore
   * @param {Grid} grid - The grid to modify
   * @param {Cursor} cursor - The cursor to modify
   */
  static applyEvent(event, grid, cursor) {
    const { action, cursorBefore } = event;

    // Set cursor to where it was before the action
    cursor.set(cursorBefore);

    switch (action.type) {
      case 'insert_char':
        this._applyInsertChar(action, grid, cursor);
        break;
      case 'delete_char':
        this._applyDeleteChar(action, grid, cursor);
        break;
      case 'delete_and_shift':
        this._applyDeleteAndShift(action, grid, cursor);
        break;
      case 'cursor_move':
        this._applyCursorMove(action, cursor, grid);
        break;
    }
  }

  static _applyInsertChar(action, grid, cursor) {
    const { char, x, y, insertMode } = action;

    if (insertMode) {
      // Shift everything right from position x
      grid.shiftRowRight(y, x);
    }

    grid.setChar(x, y, char);

    // Move cursor right
    cursor.moveRight({ cols: grid.cols, rows: grid.rows });
  }

  static _applyDeleteChar(action, grid, cursor) {
    const { x, y, moveCursor } = action;

    grid.setChar(x, y, ' ');

    if (moveCursor) {
      cursor.moveLeft();
    }
  }

  static _applyDeleteAndShift(action, grid, cursor) {
    const { x, y, moveCursor } = action;

    // Shift everything left from position x
    grid.shiftRowLeft(y, x);

    if (moveCursor) {
      cursor.moveLeft();
    }
  }

  static _applyCursorMove(action, cursor, grid) {
    const { dx, dy } = action;
    cursor.move(dx, dy, { cols: grid.cols, rows: grid.rows });
  }
}
