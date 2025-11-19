/**
 * Timeline - Manages the event timeline
 */

export class Timeline {
  constructor() {
    this.events = [];
  }

  /**
   * Add event to timeline (maintains sorted order)
   */
  addEvent(event) {
    this.events.push(event);
    this.events.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get all events up to (and including) a specific time
   */
  getEventsUpTo(time) {
    return this.events.filter(e => e.timestamp <= time);
  }

  /**
   * Get all events at a specific timestamp
   */
  getEventsAt(time) {
    return this.events.filter(e => e.timestamp === time);
  }

  /**
   * Get next event after a given time
   */
  getNextEvent(afterTime) {
    return this.events.find(e => e.timestamp > afterTime);
  }

  /**
   * Get previous event before a given time
   */
  getPreviousEvent(beforeTime) {
    const filtered = this.events.filter(e => e.timestamp < beforeTime);
    return filtered[filtered.length - 1];
  }

  /**
   * Get maximum timestamp in timeline
   */
  getMaxTime() {
    if (this.events.length === 0) return 0;
    return this.events[this.events.length - 1].timestamp;
  }

  /**
   * Get minimum timestamp in timeline
   */
  getMinTime() {
    if (this.events.length === 0) return 0;
    return this.events[0].timestamp;
  }

  /**
   * Get all unique timestamps
   */
  getUniqueTimestamps() {
    return [...new Set(this.events.map(e => e.timestamp))];
  }

  /**
   * Count events at each timestamp
   */
  getTimestampCounts() {
    const counts = {};
    this.events.forEach(event => {
      counts[event.timestamp] = (counts[event.timestamp] || 0) + 1;
    });
    return counts;
  }

  /**
   * Clear all events
   */
  clear() {
    this.events = [];
  }

  /**
   * Get total event count
   */
  getEventCount() {
    return this.events.length;
  }

  /**
   * Serialize to JSON
   */
  serialize() {
    return {
      events: this.events,
      count: this.events.length,
      maxTime: this.getMaxTime()
    };
  }

  /**
   * Deserialize from JSON
   */
  static deserialize(data) {
    const timeline = new Timeline();
    timeline.events = data.events || [];
    return timeline;
  }
}
