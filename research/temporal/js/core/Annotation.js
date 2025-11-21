/**
 * Annotation - Manages timeline annotations and bookmarks
 * Emits events: 'annotation-added', 'annotation-removed', 'annotation-updated'
 */

import { EventEmitter } from '../utils/EventEmitter.js';
import { Logger } from '../utils/Logger.js';

export class AnnotationManager extends EventEmitter {
  constructor() {
    super();
    this.annotations = [];
    this.nextId = 1;
  }

  /**
   * Add annotation at timestamp
   */
  addAnnotation(timestamp, text, type = 'note') {
    const annotation = {
      id: this.nextId++,
      timestamp,
      text,
      type, // 'note', 'bookmark', 'warning', 'info'
      createdAt: Date.now()
    };

    this.annotations.push(annotation);
    this.annotations.sort((a, b) => a.timestamp - b.timestamp);

    this.emit('annotation-added', annotation);
    Logger.debug('Annotation added:', annotation);

    return annotation;
  }

  /**
   * Remove annotation by id
   */
  removeAnnotation(id) {
    const index = this.annotations.findIndex(a => a.id === id);
    if (index !== -1) {
      const removed = this.annotations.splice(index, 1)[0];
      this.emit('annotation-removed', removed);
      Logger.debug('Annotation removed:', removed);
      return true;
    }
    return false;
  }

  /**
   * Update annotation text
   */
  updateAnnotation(id, text) {
    const annotation = this.annotations.find(a => a.id === id);
    if (annotation) {
      annotation.text = text;
      this.emit('annotation-updated', annotation);
      Logger.debug('Annotation updated:', annotation);
      return true;
    }
    return false;
  }

  /**
   * Get annotations at specific timestamp
   */
  getAnnotationsAt(timestamp, tolerance = 0) {
    return this.annotations.filter(a =>
      Math.abs(a.timestamp - timestamp) <= tolerance
    );
  }

  /**
   * Get all annotations
   */
  getAllAnnotations() {
    return [...this.annotations];
  }

  /**
   * Get annotation by id
   */
  getAnnotation(id) {
    return this.annotations.find(a => a.id === id);
  }

  /**
   * Get bookmarks only
   */
  getBookmarks() {
    return this.annotations.filter(a => a.type === 'bookmark');
  }

  /**
   * Clear all annotations
   */
  clear() {
    this.annotations = [];
    this.nextId = 1;
    Logger.debug('Annotations cleared');
  }

  /**
   * Serialize annotations
   */
  serialize() {
    return {
      annotations: this.annotations.map(a => ({ ...a })),
      nextId: this.nextId
    };
  }

  /**
   * Deserialize annotations
   */
  static deserialize(data) {
    const manager = new AnnotationManager();
    if (data && data.annotations) {
      manager.annotations = data.annotations.map(a => ({ ...a }));
      manager.nextId = data.nextId || manager.annotations.length + 1;
    }
    return manager;
  }
}
