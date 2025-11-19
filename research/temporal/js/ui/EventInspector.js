/**
 * EventInspector - Inspect, edit, and delete events
 * Emits events: 'event-selected', 'event-deleted', 'event-edited'
 */

import { EventEmitter } from '../utils/EventEmitter.js';
import { Logger } from '../utils/Logger.js';

export class EventInspector extends EventEmitter {
  constructor() {
    super();
    this.selectedEvent = null;
    this.panel = null;
  }

  /**
   * Create and attach inspector UI
   */
  createUI() {
    const panel = document.createElement('div');
    panel.className = 'event-inspector';
    panel.innerHTML = `
      <div class="inspector-header">
        <h3>Event Inspector</h3>
        <button class="inspector-close" id="inspector-close">×</button>
      </div>
      <div class="inspector-body" id="inspector-body">
        <p class="inspector-empty">Click a timeline marker to inspect an event</p>
      </div>
    `;

    document.body.appendChild(panel);
    this.panel = panel;

    // Close button
    document.getElementById('inspector-close').addEventListener('click', () => {
      this.hide();
    });

    this.hide();
    return panel;
  }

  /**
   * Show inspector panel
   */
  show() {
    if (this.panel) {
      this.panel.style.display = 'block';
    }
  }

  /**
   * Hide inspector panel
   */
  hide() {
    if (this.panel) {
      this.panel.style.display = 'none';
    }
  }

  /**
   * Inspect an event
   */
  inspect(event, timeline) {
    this.selectedEvent = event;
    this.show();

    const body = document.getElementById('inspector-body');
    body.innerHTML = `
      <div class="inspector-section">
        <h4>Event Details</h4>
        <table class="inspector-table">
          <tr><td>Timestamp:</td><td>${event.timestamp}ms</td></tr>
          <tr><td>Type:</td><td>${event.action.type}</td></tr>
          <tr><td>Cursor Before:</td><td>(${event.cursorBefore.x}, ${event.cursorBefore.y})</td></tr>
        </table>
      </div>

      <div class="inspector-section">
        <h4>Action Data</h4>
        <pre class="inspector-json">${JSON.stringify(event.action, null, 2)}</pre>
      </div>

      <div class="inspector-section">
        <h4>Concurrent Events</h4>
        <p>${this._getConcurrentEventsInfo(event, timeline)}</p>
      </div>

      <div class="inspector-actions">
        <button id="inspector-delete" class="inspector-btn inspector-btn-danger">Delete Event</button>
        <button id="inspector-duplicate" class="inspector-btn">Duplicate Event</button>
        <button id="inspector-export" class="inspector-btn">Export Event</button>
      </div>
    `;

    // Wire up buttons
    document.getElementById('inspector-delete').addEventListener('click', () => {
      this._deleteEvent(event, timeline);
    });

    document.getElementById('inspector-duplicate').addEventListener('click', () => {
      this._duplicateEvent(event, timeline);
    });

    document.getElementById('inspector-export').addEventListener('click', () => {
      this._exportEvent(event);
    });

    this.emit('event-selected', event);
    Logger.debug('Inspecting event:', event);
  }

  _getConcurrentEventsInfo(event, timeline) {
    const concurrent = timeline.getEventsAt(event.timestamp);
    if (concurrent.length === 1) {
      return 'No concurrent events';
    }
    return `${concurrent.length - 1} other event(s) at this timestamp`;
  }

  _deleteEvent(event, timeline) {
    if (confirm('Delete this event? This cannot be undone.')) {
      const index = timeline.events.indexOf(event);
      if (index !== -1) {
        timeline.events.splice(index, 1);
        this.emit('event-deleted', event);
        this.hide();
        Logger.info('Event deleted:', event);
      }
    }
  }

  _duplicateEvent(event, timeline) {
    const duplicate = {
      timestamp: event.timestamp + 1, // Slight offset
      action: { ...event.action },
      cursorBefore: { ...event.cursorBefore }
    };
    timeline.addEvent(duplicate);
    this.emit('event-edited', { type: 'duplicate', event: duplicate });
    Logger.info('Event duplicated:', duplicate);
  }

  _exportEvent(event) {
    const json = JSON.stringify(event, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `event-${event.timestamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    Logger.info('Event exported');
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.panel) {
      this.panel.remove();
    }
    this.removeAllListeners();
  }
}
