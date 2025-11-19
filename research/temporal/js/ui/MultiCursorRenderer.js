/**
 * MultiCursorRenderer - Visualize all concurrent cursor positions
 */

import { Logger } from '../utils/Logger.js';

export class MultiCursorRenderer {
  constructor(config) {
    this.config = config;
    this.enabled = false;
    this.cursorColors = [
      '#0ff', // cyan
      '#f0f', // magenta
      '#ff0', // yellow
      '#f80', // orange
      '#0f8', // green-cyan
      '#80f'  // purple
    ];
  }

  /**
   * Enable/disable multi-cursor visualization
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    Logger.debug('Multi-cursor visualization:', enabled ? 'enabled' : 'disabled');
  }

  /**
   * Get all cursor positions at current time
   */
  getCursorPositions(timeline, currentTime) {
    if (!this.enabled) return [];

    // Get all events at current time
    const eventsAtTime = timeline.getEventsAt(currentTime);
    if (eventsAtTime.length <= 1) return [];

    // Extract cursor positions before each event
    const cursors = eventsAtTime.map((event, index) => ({
      position: event.cursorBefore,
      color: this.cursorColors[index % this.cursorColors.length],
      event: event
    }));

    return cursors;
  }

  /**
   * Render all concurrent cursors
   */
  renderCursors(ctx, timeline, currentTime, gridToPixel) {
    if (!this.enabled) return;

    const cursors = this.getCursorPositions(timeline, currentTime);

    cursors.forEach((cursor, index) => {
      this._renderGhostCursor(
        ctx,
        cursor.position,
        cursor.color,
        gridToPixel,
        index
      );
    });

    if (cursors.length > 0) {
      Logger.debug(`Rendering ${cursors.length} concurrent cursors`);
    }
  }

  /**
   * Render a single ghost cursor
   */
  _renderGhostCursor(ctx, position, color, gridToPixel, index) {
    const pos = gridToPixel(position.x, position.y);

    // Draw translucent block
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = color;
    ctx.fillRect(
      pos.x,
      pos.y - this.config.FONT.LINE_HEIGHT + 4,
      this.config.FONT.CHAR_WIDTH,
      this.config.FONT.LINE_HEIGHT - 4
    );

    // Draw border
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(
      pos.x,
      pos.y - this.config.FONT.LINE_HEIGHT + 4,
      this.config.FONT.CHAR_WIDTH,
      this.config.FONT.LINE_HEIGHT - 4
    );

    // Draw label
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = color;
    ctx.font = '10px monospace';
    ctx.fillText(
      `C${index + 1}`,
      pos.x,
      pos.y - this.config.FONT.LINE_HEIGHT + 2
    );

    ctx.globalAlpha = 1.0;
  }

  /**
   * Get cursor trail (positions over time)
   */
  getCursorTrail(timeline, startTime, endTime, cursorIndex = 0) {
    const events = timeline.events.filter(e =>
      e.timestamp >= startTime && e.timestamp <= endTime
    );

    const trail = events
      .filter((_, index) => index % (cursorIndex + 1) === 0) // Sample every nth event
      .map(e => ({
        position: e.cursorBefore,
        timestamp: e.timestamp
      }));

    return trail;
  }

  /**
   * Render cursor trail
   */
  renderTrail(ctx, trail, color, gridToPixel) {
    if (!this.enabled || trail.length < 2) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3;

    ctx.beginPath();
    const firstPos = gridToPixel(trail[0].position.x, trail[0].position.y);
    ctx.moveTo(firstPos.x, firstPos.y - this.config.FONT.LINE_HEIGHT / 2);

    for (let i = 1; i < trail.length; i++) {
      const pos = gridToPixel(trail[i].position.x, trail[i].position.y);
      ctx.lineTo(pos.x, pos.y - this.config.FONT.LINE_HEIGHT / 2);
    }

    ctx.stroke();
    ctx.globalAlpha = 1.0;
  }
}
