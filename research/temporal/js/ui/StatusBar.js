/**
 * StatusBar - Status bar UI updates
 */

export class StatusBar {
  constructor(containerEl) {
    this.modeIndicator = containerEl.querySelector('#mode-indicator');
    this.insertModeIndicator = containerEl.querySelector('#insert-mode-indicator');
    this.timeDisplay = containerEl.querySelector('#time-display');
    this.cursorDisplay = containerEl.querySelector('#cursor-display');
    this.eventCount = containerEl.querySelector('#event-count');
  }

  /**
   * Update all status displays
   */
  update(state) {
    this.updateMode(state.isLive, state.isScrubbed);
    this.updateInsertMode(state.insertMode);
    this.updateTime(state.currentTime, state.maxTime);
    this.updateCursor(state.cursor.x, state.cursor.y);
    this.updateEventCount(state.eventCount);
  }

  updateMode(isLive, isScrubbed) {
    if (isScrubbed) {
      this.modeIndicator.textContent = 'SCRUBBED';
      this.modeIndicator.className = 'mode-indicator mode-scrubbed';
    } else {
      this.modeIndicator.textContent = 'LIVE';
      this.modeIndicator.className = 'mode-indicator mode-live';
    }
  }

  updateInsertMode(insertMode) {
    if (insertMode) {
      this.insertModeIndicator.textContent = 'INSERT (|)';
    } else {
      this.insertModeIndicator.textContent = 'OVERWRITE (█)';
    }
  }

  updateTime(currentTime, maxTime) {
    this.timeDisplay.textContent = `${currentTime}ms / ${maxTime}ms`;
  }

  updateCursor(x, y) {
    this.cursorDisplay.textContent = `(${x}, ${y})`;
  }

  updateEventCount(count) {
    this.eventCount.textContent = count;
  }
}
