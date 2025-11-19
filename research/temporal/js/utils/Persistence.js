/**
 * Persistence - Save and load editor state from localStorage
 */

import { Logger } from './Logger.js';

export class Persistence {
  static STORAGE_KEY = 'temporal-editor-state';
  static AUTOSAVE_KEY = 'temporal-editor-autosave';
  static DRAFTS_KEY = 'temporal-editor-drafts';

  /**
   * Save state to localStorage
   */
  static save(state, key = Persistence.STORAGE_KEY) {
    try {
      const data = {
        timeline: state.timeline.serialize(),
        currentTime: state.currentTime,
        insertMode: state.insertMode,
        savedAt: new Date().toISOString(),
        version: '2.0'
      };

      localStorage.setItem(key, JSON.stringify(data));
      Logger.info('State saved to localStorage:', key);
      return true;
    } catch (error) {
      Logger.error('Failed to save state:', error);
      return false;
    }
  }

  /**
   * Load state from localStorage
   */
  static load(key = Persistence.STORAGE_KEY) {
    try {
      const json = localStorage.getItem(key);
      if (!json) {
        Logger.info('No saved state found');
        return null;
      }

      const data = JSON.parse(json);
      Logger.info('State loaded from localStorage:', key);
      return data;
    } catch (error) {
      Logger.error('Failed to load state:', error);
      return null;
    }
  }

  /**
   * Auto-save state
   */
  static autoSave(state) {
    return Persistence.save(state, Persistence.AUTOSAVE_KEY);
  }

  /**
   * Load auto-saved state
   */
  static loadAutoSave() {
    return Persistence.load(Persistence.AUTOSAVE_KEY);
  }

  /**
   * Save draft with name
   */
  static saveDraft(state, name) {
    try {
      const drafts = Persistence.listDrafts();
      const draft = {
        name,
        timeline: state.timeline.serialize(),
        currentTime: state.currentTime,
        insertMode: state.insertMode,
        savedAt: new Date().toISOString(),
        version: '2.0'
      };

      drafts[name] = draft;
      localStorage.setItem(Persistence.DRAFTS_KEY, JSON.stringify(drafts));
      Logger.info('Draft saved:', name);
      return true;
    } catch (error) {
      Logger.error('Failed to save draft:', error);
      return false;
    }
  }

  /**
   * Load draft by name
   */
  static loadDraft(name) {
    try {
      const drafts = Persistence.listDrafts();
      const draft = drafts[name];
      if (!draft) {
        Logger.warn('Draft not found:', name);
        return null;
      }
      Logger.info('Draft loaded:', name);
      return draft;
    } catch (error) {
      Logger.error('Failed to load draft:', error);
      return null;
    }
  }

  /**
   * List all saved drafts
   */
  static listDrafts() {
    try {
      const json = localStorage.getItem(Persistence.DRAFTS_KEY);
      return json ? JSON.parse(json) : {};
    } catch (error) {
      Logger.error('Failed to list drafts:', error);
      return {};
    }
  }

  /**
   * Delete draft
   */
  static deleteDraft(name) {
    try {
      const drafts = Persistence.listDrafts();
      delete drafts[name];
      localStorage.setItem(Persistence.DRAFTS_KEY, JSON.stringify(drafts));
      Logger.info('Draft deleted:', name);
      return true;
    } catch (error) {
      Logger.error('Failed to delete draft:', error);
      return false;
    }
  }

  /**
   * Clear all saved data
   */
  static clearAll() {
    try {
      localStorage.removeItem(Persistence.STORAGE_KEY);
      localStorage.removeItem(Persistence.AUTOSAVE_KEY);
      localStorage.removeItem(Persistence.DRAFTS_KEY);
      Logger.info('All saved data cleared');
      return true;
    } catch (error) {
      Logger.error('Failed to clear data:', error);
      return false;
    }
  }

  /**
   * Get storage info
   */
  static getStorageInfo() {
    const info = {
      hasState: !!localStorage.getItem(Persistence.STORAGE_KEY),
      hasAutoSave: !!localStorage.getItem(Persistence.AUTOSAVE_KEY),
      draftCount: Object.keys(Persistence.listDrafts()).length,
      drafts: Object.keys(Persistence.listDrafts())
    };
    return info;
  }
}
