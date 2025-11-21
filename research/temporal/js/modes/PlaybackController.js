/**
 * PlaybackController - Controls timeline playback
 * Emits events: 'play', 'pause', 'stop', 'speed-change', 'step'
 */

import { EventEmitter } from '../utils/EventEmitter.js';
import { Logger } from '../utils/Logger.js';

export class PlaybackController extends EventEmitter {
  constructor(stateManager, config) {
    super();
    this.stateManager = stateManager;
    this.config = config;

    this.isPlaying = false;
    this.playbackSpeed = 1.0; // 1x speed
    this.playbackInterval = null;
    this.lastPlaybackTime = 0;
    this.loopMode = false;
  }

  /**
   * Start playback from current position
   */
  play() {
    if (this.isPlaying) return;
    if (this.stateManager.getCurrentTime() >= this.stateManager.getMaxTime()) {
      // If at end, restart from beginning
      this.stateManager.scrubTo(0);
    }

    this.isPlaying = true;
    this.lastPlaybackTime = Date.now();
    this._startPlaybackLoop();
    this.emit('play');
    Logger.info('Playback started at', this.playbackSpeed + 'x speed');
  }

  /**
   * Pause playback
   */
  pause() {
    if (!this.isPlaying) return;

    this.isPlaying = false;
    this._stopPlaybackLoop();
    this.emit('pause');
    Logger.info('Playback paused at', this.stateManager.getCurrentTime() + 'ms');
  }

  /**
   * Stop playback and return to beginning
   */
  stop() {
    this.pause();
    this.stateManager.scrubTo(0);
    this.emit('stop');
    Logger.info('Playback stopped');
  }

  /**
   * Toggle play/pause
   */
  togglePlayPause() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  /**
   * Set playback speed
   * @param {number} speed - Speed multiplier (0.25, 0.5, 1, 2, 4)
   */
  setSpeed(speed) {
    this.playbackSpeed = speed;
    this.emit('speed-change', speed);
    Logger.debug('Playback speed set to', speed + 'x');

    // Restart playback loop if playing
    if (this.isPlaying) {
      this._stopPlaybackLoop();
      this._startPlaybackLoop();
    }
  }

  /**
   * Step forward one event
   */
  stepForward() {
    const nextEvent = this.stateManager.getTimeline().getNextEvent(
      this.stateManager.getCurrentTime()
    );
    if (nextEvent) {
      this.stateManager.scrubTo(nextEvent.timestamp);
      this.emit('step', 'forward');
      Logger.debug('Stepped forward to', nextEvent.timestamp + 'ms');
    }
  }

  /**
   * Step backward one event
   */
  stepBackward() {
    const prevEvent = this.stateManager.getTimeline().getPreviousEvent(
      this.stateManager.getCurrentTime()
    );
    if (prevEvent) {
      this.stateManager.scrubTo(prevEvent.timestamp);
      this.emit('step', 'backward');
      Logger.debug('Stepped backward to', prevEvent.timestamp + 'ms');
    } else {
      // Go to beginning
      this.stateManager.scrubTo(0);
      this.emit('step', 'backward');
    }
  }

  /**
   * Jump to start
   */
  jumpToStart() {
    this.stateManager.scrubTo(0);
    Logger.debug('Jumped to start');
  }

  /**
   * Jump to end
   */
  jumpToEnd() {
    this.stateManager.scrubTo(this.stateManager.getMaxTime());
    Logger.debug('Jumped to end');
  }

  _startPlaybackLoop() {
    const frameDelay = 16; // ~60fps

    this.playbackInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - this.lastPlaybackTime;
      this.lastPlaybackTime = now;

      // Advance timeline by elapsed time * speed
      const timeAdvance = elapsed * this.playbackSpeed;
      const newTime = this.stateManager.getCurrentTime() + timeAdvance;
      const maxTime = this.stateManager.getMaxTime();

      if (newTime >= maxTime) {
        // Reached end - check for loop mode
        if (this.loopMode) {
          this.stateManager.scrubTo(0);
          this.lastPlaybackTime = Date.now();
        } else {
          this.stateManager.scrubTo(maxTime);
          this.pause();
        }
      } else {
        this.stateManager.scrubTo(newTime);
      }
    }, frameDelay);
  }

  _stopPlaybackLoop() {
    if (this.playbackInterval) {
      clearInterval(this.playbackInterval);
      this.playbackInterval = null;
    }
  }

  /**
   * Toggle loop mode
   */
  toggleLoop() {
    this.loopMode = !this.loopMode;
    this.emit('loop-changed', this.loopMode);
    Logger.debug('Loop mode:', this.loopMode);
    return this.loopMode;
  }

  /**
   * Set loop mode
   */
  setLoopMode(enabled) {
    this.loopMode = enabled;
    this.emit('loop-changed', this.loopMode);
    Logger.debug('Loop mode set to:', this.loopMode);
  }

  /**
   * Get current playback state
   */
  getState() {
    return {
      isPlaying: this.isPlaying,
      speed: this.playbackSpeed,
      loopMode: this.loopMode
    };
  }

  /**
   * Cleanup
   */
  destroy() {
    this.pause();
    this.removeAllListeners();
  }
}
