/**
 * Export - Export timeline to various formats
 */

export class Export {
  /**
   * Export timeline to JSON
   */
  static toJSON(state) {
    return {
      timeline: state.timeline.serialize(),
      metadata: {
        totalEvents: state.eventCount,
        maxTime: state.maxTime,
        gridSize: {
          cols: state.grid.cols,
          rows: state.grid.rows
        },
        exportedAt: new Date().toISOString(),
        version: '2.0'
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
}
