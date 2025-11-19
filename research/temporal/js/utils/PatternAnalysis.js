/**
 * PatternAnalysis - Analyze typing patterns and timeline metrics
 */

import { Logger } from './Logger.js';

export class PatternAnalysis {
  /**
   * Analyze timeline and return comprehensive metrics
   */
  static analyze(timeline) {
    const events = timeline.events;

    if (events.length === 0) {
      return PatternAnalysis._emptyMetrics();
    }

    const metrics = {
      basic: PatternAnalysis._analyzeBasic(events),
      typing: PatternAnalysis._analyzeTyping(events),
      timing: PatternAnalysis._analyzeTiming(events),
      concurrency: PatternAnalysis._analyzeConcurrency(timeline),
      corrections: PatternAnalysis._analyzeCorrections(events),
      spatial: PatternAnalysis._analyzeSpatial(events)
    };

    Logger.debug('Pattern analysis complete:', metrics);
    return metrics;
  }

  static _emptyMetrics() {
    return {
      basic: { totalEvents: 0, duration: 0, eventTypes: {} },
      typing: { totalChars: 0, avgSpeed: 0, burstiness: 0 },
      timing: { avgInterval: 0, minInterval: 0, maxInterval: 0 },
      concurrency: { concurrentTimestamps: 0, maxConcurrent: 0 },
      corrections: { deleteCount: 0, correctionRate: 0 },
      spatial: { rowsUsed: 0, colsUsed: 0, coverage: 0 }
    };
  }

  /**
   * Basic metrics
   */
  static _analyzeBasic(events) {
    const eventTypes = {};
    events.forEach(e => {
      eventTypes[e.action.type] = (eventTypes[e.action.type] || 0) + 1;
    });

    return {
      totalEvents: events.length,
      duration: events[events.length - 1].timestamp - events[0].timestamp,
      eventTypes,
      startTime: events[0].timestamp,
      endTime: events[events.length - 1].timestamp
    };
  }

  /**
   * Typing speed and patterns
   */
  static _analyzeTyping(events) {
    const charEvents = events.filter(e => e.action.type === 'insert_char');

    if (charEvents.length === 0) {
      return { totalChars: 0, avgSpeed: 0, burstiness: 0 };
    }

    const duration = charEvents[charEvents.length - 1].timestamp - charEvents[0].timestamp;
    const avgSpeed = duration > 0 ? (charEvents.length / duration) * 1000 : 0; // chars per second

    // Calculate burstiness (variance in typing intervals)
    const intervals = [];
    for (let i = 1; i < charEvents.length; i++) {
      intervals.push(charEvents[i].timestamp - charEvents[i - 1].timestamp);
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((acc, val) => {
      return acc + Math.pow(val - avgInterval, 2);
    }, 0) / intervals.length;
    const burstiness = Math.sqrt(variance) / avgInterval;

    return {
      totalChars: charEvents.length,
      avgSpeed: avgSpeed.toFixed(2),
      burstiness: burstiness.toFixed(2),
      avgInterval: avgInterval.toFixed(2)
    };
  }

  /**
   * Timing analysis
   */
  static _analyzeTiming(events) {
    if (events.length < 2) {
      return { avgInterval: 0, minInterval: 0, maxInterval: 0 };
    }

    const intervals = [];
    for (let i = 1; i < events.length; i++) {
      intervals.push(events[i].timestamp - events[i - 1].timestamp);
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const minInterval = Math.min(...intervals);
    const maxInterval = Math.max(...intervals);

    return {
      avgInterval: avgInterval.toFixed(2),
      minInterval,
      maxInterval,
      stdDev: PatternAnalysis._calculateStdDev(intervals).toFixed(2)
    };
  }

  /**
   * Concurrency analysis
   */
  static _analyzeConcurrency(timeline) {
    const timestampCounts = timeline.getTimestampCounts();
    const counts = Object.values(timestampCounts);
    const concurrentTimestamps = counts.filter(c => c > 1).length;
    const maxConcurrent = counts.length > 0 ? Math.max(...counts) : 0;
    const totalConcurrentEvents = counts.reduce((acc, c) => acc + (c > 1 ? c : 0), 0);

    return {
      concurrentTimestamps,
      maxConcurrent,
      totalConcurrentEvents,
      concurrencyRate: (concurrentTimestamps / Object.keys(timestampCounts).length * 100).toFixed(2) + '%'
    };
  }

  /**
   * Correction analysis (backspace/delete usage)
   */
  static _analyzeCorrections(events) {
    const deleteEvents = events.filter(e =>
      e.action.type === 'delete_char' || e.action.type === 'delete_and_shift'
    );
    const charEvents = events.filter(e => e.action.type === 'insert_char');

    const deleteCount = deleteEvents.length;
    const correctionRate = charEvents.length > 0
      ? (deleteCount / charEvents.length * 100).toFixed(2)
      : 0;

    return {
      deleteCount,
      correctionRate: correctionRate + '%',
      backspaceCount: deleteEvents.filter(e => e.action.moveCursor).length,
      deleteKeyCount: deleteEvents.filter(e => !e.action.moveCursor).length
    };
  }

  /**
   * Spatial analysis (where on the grid)
   */
  static _analyzeSpatial(events) {
    const positions = new Set();
    const rows = new Set();
    const cols = new Set();

    events.forEach(e => {
      if (e.action.x !== undefined && e.action.y !== undefined) {
        positions.add(`${e.action.x},${e.action.y}`);
        rows.add(e.action.y);
        cols.add(e.action.x);
      }
    });

    return {
      uniquePositions: positions.size,
      rowsUsed: rows.size,
      colsUsed: cols.size,
      coverage: (positions.size / (80 * 20) * 100).toFixed(2) + '%'
    };
  }

  /**
   * Get timeline heat map data (for visualization)
   */
  static getHeatMap(timeline, bucketSize = 100) {
    const events = timeline.events;
    if (events.length === 0) return [];

    const maxTime = events[events.length - 1].timestamp;
    const buckets = Math.ceil(maxTime / bucketSize);
    const heatMap = new Array(buckets).fill(0);

    events.forEach(e => {
      const bucket = Math.floor(e.timestamp / bucketSize);
      heatMap[bucket]++;
    });

    return heatMap;
  }

  /**
   * Get typing speed over time
   */
  static getSpeedOverTime(timeline, windowSize = 1000) {
    const charEvents = timeline.events.filter(e => e.action.type === 'insert_char');
    if (charEvents.length === 0) return [];

    const speeds = [];
    for (let i = 0; i < charEvents.length; i++) {
      const windowEnd = charEvents[i].timestamp;
      const windowStart = windowEnd - windowSize;
      const charsInWindow = charEvents.filter(e =>
        e.timestamp >= windowStart && e.timestamp <= windowEnd
      ).length;

      const speed = (charsInWindow / windowSize) * 1000; // chars per second
      speeds.push({ time: windowEnd, speed: speed.toFixed(2) });
    }

    return speeds;
  }

  static _calculateStdDev(values) {
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((acc, val) => {
      return acc + Math.pow(val - avg, 2);
    }, 0) / values.length;
    return Math.sqrt(variance);
  }

  /**
   * Generate text report
   */
  static generateReport(timeline) {
    const metrics = PatternAnalysis.analyze(timeline);

    let report = '=== TEMPORAL EDITOR ANALYSIS REPORT ===\n\n';

    report += 'BASIC METRICS:\n';
    report += `  Total Events: ${metrics.basic.totalEvents}\n`;
    report += `  Duration: ${metrics.basic.duration}ms (${(metrics.basic.duration / 1000).toFixed(1)}s)\n`;
    report += `  Event Types: ${JSON.stringify(metrics.basic.eventTypes, null, 2)}\n\n`;

    report += 'TYPING METRICS:\n';
    report += `  Characters Typed: ${metrics.typing.totalChars}\n`;
    report += `  Avg Speed: ${metrics.typing.avgSpeed} chars/sec\n`;
    report += `  Burstiness: ${metrics.typing.burstiness}\n`;
    report += `  Avg Interval: ${metrics.typing.avgInterval}ms\n\n`;

    report += 'TIMING ANALYSIS:\n';
    report += `  Avg Interval: ${metrics.timing.avgInterval}ms\n`;
    report += `  Min Interval: ${metrics.timing.minInterval}ms\n`;
    report += `  Max Interval: ${metrics.timing.maxInterval}ms\n`;
    report += `  Std Dev: ${metrics.timing.stdDev}ms\n\n`;

    report += 'CONCURRENCY:\n';
    report += `  Concurrent Timestamps: ${metrics.concurrency.concurrentTimestamps}\n`;
    report += `  Max Concurrent: ${metrics.concurrency.maxConcurrent}\n`;
    report += `  Total Concurrent Events: ${metrics.concurrency.totalConcurrentEvents}\n`;
    report += `  Concurrency Rate: ${metrics.concurrency.concurrencyRate}\n\n`;

    report += 'CORRECTIONS:\n';
    report += `  Delete Count: ${metrics.corrections.deleteCount}\n`;
    report += `  Correction Rate: ${metrics.corrections.correctionRate}\n`;
    report += `  Backspace: ${metrics.corrections.backspaceCount}\n`;
    report += `  Delete Key: ${metrics.corrections.deleteKeyCount}\n\n`;

    report += 'SPATIAL USAGE:\n';
    report += `  Unique Positions: ${metrics.spatial.uniquePositions}\n`;
    report += `  Rows Used: ${metrics.spatial.rowsUsed}\n`;
    report += `  Cols Used: ${metrics.spatial.colsUsed}\n`;
    report += `  Grid Coverage: ${metrics.spatial.coverage}\n\n`;

    return report;
  }
}
