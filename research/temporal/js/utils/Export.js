/**
 * Export - Export timeline to various formats
 */

export class Export {
  /**
   * Export timeline to JSON
   */
  static toJSON(state, timeline) {
    return {
      timeline: timeline.serialize(),
      metadata: {
        totalEvents: state.eventCount,
        maxTime: state.maxTime,
        gridSize: {
          cols: state.grid.cols,
          rows: state.grid.rows
        },
        exportedAt: new Date().toISOString(),
        version: '3.0'
      },
      currentState: {
        currentTime: state.currentTime,
        insertMode: state.insertMode,
        cursorPosition: {
          x: state.cursor.x,
          y: state.cursor.y
        }
      }
    };
  }

  /**
   * Download JSON file
   */
  static downloadJSON(data, filename) {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Export timeline as CSV
   */
  static toCSV(timeline) {
    const headers = ['timestamp', 'type', 'details'];
    const rows = [headers];

    timeline.events.forEach(event => {
      const details = JSON.stringify(event.action).replace(/,/g, ';');
      rows.push([
        event.timestamp,
        event.action.type,
        details
      ]);
    });

    return rows.map(row => row.join(',')).join('\n');
  }

  /**
   * Download CSV file
   */
  static downloadCSV(data, filename) {
    const blob = new Blob([data], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Export timeline as asciinema .cast file
   * Asciinema format: https://github.com/asciinema/asciinema/blob/develop/doc/asciicast-v2.md
   */
  static toAsciinema(timeline, config) {
    const lines = [];

    // Header line (asciinema v2 format)
    const header = {
      version: 2,
      width: config.GRID?.COLS || 80,
      height: config.GRID?.ROWS || 20,
      timestamp: Math.floor(Date.now() / 1000),
      title: "Temporal Text Editor Recording",
      env: {
        SHELL: "/bin/bash",
        TERM: "xterm-256color"
      }
    };
    lines.push(JSON.stringify(header));

    // Build a representation of the grid at each timestamp
    let previousGrid = Array(header.height).fill('').map(() => Array(header.width).fill(' '));
    let previousTime = 0;

    // Get all unique timestamps
    const timestamps = [...new Set(timeline.events.map(e => e.timestamp))].sort((a, b) => a - b);

    timestamps.forEach(timestamp => {
      // Get state at this timestamp
      const eventsUpTo = timeline.events.filter(e => e.timestamp <= timestamp);
      const grid = Export._rebuildGridFromEvents(eventsUpTo, header.width, header.height);

      // Calculate time difference in seconds
      const timeDelta = (timestamp - previousTime) / 1000;

      // Only output if grid changed
      if (!Export._gridsEqual(grid, previousGrid)) {
        // Clear screen and show new state
        const output = Export._renderGrid(grid);
        lines.push(JSON.stringify([timeDelta, "o", output]));

        previousGrid = grid;
      }

      previousTime = timestamp;
    });

    return lines.join('\n');
  }

  /**
   * Rebuild grid from events (helper for asciinema export)
   */
  static _rebuildGridFromEvents(events, cols, rows) {
    const grid = Array(rows).fill('').map(() => Array(cols).fill(' '));
    const cursor = { x: 0, y: 0 };

    events.forEach(event => {
      const action = event.action;

      switch (action.type) {
        case 'insert_char':
          if (action.insertMode) {
            // Shift right
            for (let x = cols - 1; x > action.x; x--) {
              grid[action.y][x] = grid[action.y][x - 1];
            }
          }
          grid[action.y][action.x] = action.char;
          cursor.x = action.x + 1;
          cursor.y = action.y;
          break;

        case 'delete_char':
          grid[action.y][action.x] = ' ';
          if (action.moveCursor) {
            cursor.x = action.x;
          }
          cursor.y = action.y;
          break;

        case 'delete_and_shift':
          // Shift left
          for (let x = action.x; x < cols - 1; x++) {
            grid[action.y][x] = grid[action.y][x + 1];
          }
          grid[action.y][cols - 1] = ' ';
          if (action.moveCursor) {
            cursor.x = action.x;
          }
          cursor.y = action.y;
          break;

        case 'cursor_move':
          cursor.x = Math.max(0, Math.min(cols - 1, cursor.x + action.dx));
          cursor.y = Math.max(0, Math.min(rows - 1, cursor.y + action.dy));
          break;

        case 'newline':
          cursor.x = 0;
          cursor.y = Math.min(rows - 1, cursor.y + 1);
          break;
      }
    });

    return grid;
  }

  /**
   * Render grid to ANSI escape sequences for terminal display
   */
  static _renderGrid(grid) {
    // Clear screen and move to home
    let output = '\x1b[2J\x1b[H';

    // Render each row
    grid.forEach((row, y) => {
      // Move cursor to row
      output += `\x1b[${y + 1};1H`;
      // Output the row as a string
      output += row.join('');
    });

    return output;
  }

  /**
   * Compare two grids for equality
   */
  static _gridsEqual(grid1, grid2) {
    if (grid1.length !== grid2.length) return false;
    for (let i = 0; i < grid1.length; i++) {
      if (grid1[i].join('') !== grid2[i].join('')) return false;
    }
    return true;
  }

  /**
   * Download asciinema .cast file
   */
  static downloadAsciinema(data, filename) {
    const blob = new Blob([data], { type: 'application/x-asciicast' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
