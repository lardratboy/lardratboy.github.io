/**
 * TimelineUI - Timeline scrubber visualization and interaction
 * Emits events: 'scrub', 'scrub-start', 'scrub-end'
 */

import { EventEmitter } from '../utils/EventEmitter.js';

export class TimelineUI extends EventEmitter {
  constructor(containerEl, config) {
    super();
    this.containerEl = containerEl;
    this.config = config;
    this.playheadEl = containerEl.querySelector('.timeline-playhead');
    this.isDragging = false;

    this._attachListeners();
  }

  _attachListeners() {
    this.containerEl.addEventListener('mousedown', this._onMouseDown.bind(this));
    document.addEventListener('mousemove', this._onMouseMove.bind(this));
    document.addEventListener('mouseup', this._onMouseUp.bind(this));
  }

  _onMouseDown(e) {
    this.isDragging = true;
    this.emit('scrub-start');
    this._scrubToPosition(e.clientX);
  }

  _onMouseMove(e) {
    if (this.isDragging) {
      this._scrubToPosition(e.clientX);
    }
  }

  _onMouseUp() {
    if (this.isDragging) {
      this.isDragging = false;
      this.emit('scrub-end');
    }
  }

  _scrubToPosition(clientX) {
    const rect = this.containerEl.getBoundingClientRect();
    const x = clientX - rect.left;
    const percent = Math.max(0, Math.min(1, x / rect.width));
    this.emit('scrub', percent);
  }

  /**
   * Update timeline visualization
   */
  update(currentTime, maxTime, timeline) {
    this.renderPlayhead(currentTime, maxTime);
    this.renderMarkers(timeline, maxTime);
  }

  /**
   * Render the playhead position
   */
  renderPlayhead(currentTime, maxTime) {
    if (maxTime === 0) {
      this.playheadEl.style.left = '0%';
    } else {
      const percent = (currentTime / maxTime) * 100;
      this.playheadEl.style.left = `${percent}%`;
    }
  }

  /**
   * Render timeline markers for events
   */
  renderMarkers(timeline, maxTime) {
    // Remove old markers
    const oldMarkers = this.containerEl.querySelectorAll('.timeline-marker');
    oldMarkers.forEach(m => m.remove());

    if (maxTime === 0) return;

    // Get timestamp counts (for concurrent events)
    const timestampCounts = timeline.getTimestampCounts();

    // Create markers
    Object.entries(timestampCounts).forEach(([timestamp, count]) => {
      const marker = document.createElement('div');
      marker.className = 'timeline-marker';

      if (count > 1) {
        marker.classList.add('concurrent');
        marker.title = `${count} concurrent events`;
      }

      const percent = (parseInt(timestamp) / maxTime) * 100;
      marker.style.left = `${percent}%`;
      this.containerEl.appendChild(marker);
    });
  }

  destroy() {
    this.removeAllListeners();
  }
}
