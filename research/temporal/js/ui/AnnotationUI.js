/**
 * AnnotationUI - UI for managing timeline annotations
 */

import { EventEmitter } from '../utils/EventEmitter.js';
import { Logger } from '../utils/Logger.js';

export class AnnotationUI extends EventEmitter {
  constructor(containerId, annotationManager, stateManager) {
    super();
    this.containerId = containerId;
    this.annotationManager = annotationManager;
    this.stateManager = stateManager;
    this.container = null;

    this._createUI();
    this._bindEvents();
  }

  _createUI() {
    // Create container if it doesn't exist
    let container = document.getElementById(this.containerId);
    if (!container) {
      container = document.createElement('div');
      container.id = this.containerId;
      document.body.appendChild(container);
    }
    this.container = container;

    this.container.innerHTML = `
      <div class="annotation-panel">
        <div class="annotation-header">
          <h3>📌 Annotations & Bookmarks</h3>
          <button id="annotation-add-btn" class="annotation-add-btn" title="Add annotation at current time (Ctrl+B)">
            ➕ Add
          </button>
        </div>
        <div class="annotation-list" id="annotation-list">
          <div class="annotation-empty">No annotations yet. Press Ctrl+B to add one!</div>
        </div>
      </div>
    `;

    Logger.debug('AnnotationUI created');
  }

  _bindEvents() {
    const addBtn = document.getElementById('annotation-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => this._promptAddAnnotation());
    }

    // Listen to annotation manager events
    this.annotationManager.on('annotation-added', () => this._updateList());
    this.annotationManager.on('annotation-removed', () => this._updateList());
    this.annotationManager.on('annotation-updated', () => this._updateList());
  }

  _promptAddAnnotation() {
    const currentTime = this.stateManager.getCurrentTime();
    const text = prompt('Enter annotation text:', '');

    if (text && text.trim()) {
      const type = confirm('Is this a bookmark? (OK=Bookmark, Cancel=Note)')
        ? 'bookmark'
        : 'note';

      this.annotationManager.addAnnotation(currentTime, text.trim(), type);
    }
  }

  _updateList() {
    const listEl = document.getElementById('annotation-list');
    if (!listEl) return;

    const annotations = this.annotationManager.getAllAnnotations();

    if (annotations.length === 0) {
      listEl.innerHTML = '<div class="annotation-empty">No annotations yet. Press Ctrl+B to add one!</div>';
      return;
    }

    listEl.innerHTML = annotations.map(annotation => {
      const icon = annotation.type === 'bookmark' ? '🔖' : '📝';
      const typeClass = `annotation-type-${annotation.type}`;

      return `
        <div class="annotation-item ${typeClass}" data-id="${annotation.id}">
          <div class="annotation-icon">${icon}</div>
          <div class="annotation-content">
            <div class="annotation-time">${this._formatTime(annotation.timestamp)}</div>
            <div class="annotation-text">${this._escapeHtml(annotation.text)}</div>
          </div>
          <div class="annotation-actions">
            <button class="annotation-goto-btn" data-id="${annotation.id}" title="Jump to this time">
              ⏱
            </button>
            <button class="annotation-delete-btn" data-id="${annotation.id}" title="Delete">
              🗑
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Attach event listeners
    listEl.querySelectorAll('.annotation-goto-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt(e.target.dataset.id);
        const annotation = this.annotationManager.getAnnotation(id);
        if (annotation) {
          this.emit('goto-time', annotation.timestamp);
        }
      });
    });

    listEl.querySelectorAll('.annotation-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt(e.target.dataset.id);
        if (confirm('Delete this annotation?')) {
          this.annotationManager.removeAnnotation(id);
        }
      });
    });
  }

  _formatTime(timestamp) {
    const seconds = Math.floor(timestamp / 1000);
    const ms = timestamp % 1000;
    return `${seconds}.${ms.toString().padStart(3, '0')}s`;
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Prompt user to add annotation
   */
  promptAdd() {
    this._promptAddAnnotation();
  }

  /**
   * Destroy the UI
   */
  destroy() {
    if (this.container) {
      this.container.innerHTML = '';
    }
    this.removeAllListeners();
  }
}
