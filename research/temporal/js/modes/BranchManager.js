/**
 * BranchManager - Manage timeline branches
 * Emits events: 'branch-created', 'branch-switched', 'branch-deleted'
 */

import { EventEmitter } from '../utils/EventEmitter.js';
import { Timeline } from '../core/Timeline.js';
import { Logger } from '../utils/Logger.js';

export class BranchManager extends EventEmitter {
  constructor() {
    super();
    this.branches = new Map();
    this.currentBranch = 'main';

    // Create main branch
    this.branches.set('main', {
      name: 'main',
      timeline: new Timeline(),
      createdAt: Date.now(),
      description: 'Main timeline'
    });
  }

  /**
   * Create a new branch from current timeline
   */
  createBranch(name, fromTimeline, description = '') {
    if (this.branches.has(name)) {
      Logger.warn('Branch already exists:', name);
      return false;
    }

    // Clone the timeline
    const newTimeline = new Timeline();
    newTimeline.events = fromTimeline.events.map(e => ({ ...e }));

    const branch = {
      name,
      timeline: newTimeline,
      createdAt: Date.now(),
      parentBranch: this.currentBranch,
      description
    };

    this.branches.set(name, branch);
    this.emit('branch-created', branch);
    Logger.info('Branch created:', name);
    return true;
  }

  /**
   * Switch to a different branch
   */
  switchBranch(name) {
    if (!this.branches.has(name)) {
      Logger.error('Branch not found:', name);
      return null;
    }

    this.currentBranch = name;
    const branch = this.branches.get(name);
    this.emit('branch-switched', branch);
    Logger.info('Switched to branch:', name);
    return branch.timeline;
  }

  /**
   * Delete a branch
   */
  deleteBranch(name) {
    if (name === 'main') {
      Logger.error('Cannot delete main branch');
      return false;
    }

    if (name === this.currentBranch) {
      Logger.error('Cannot delete current branch');
      return false;
    }

    if (!this.branches.has(name)) {
      Logger.error('Branch not found:', name);
      return false;
    }

    this.branches.delete(name);
    this.emit('branch-deleted', name);
    Logger.info('Branch deleted:', name);
    return true;
  }

  /**
   * Merge branch into current branch
   */
  mergeBranch(sourceBranchName) {
    if (!this.branches.has(sourceBranchName)) {
      Logger.error('Source branch not found:', sourceBranchName);
      return false;
    }

    const sourceBranch = this.branches.get(sourceBranchName);
    const currentBranch = this.branches.get(this.currentBranch);

    // Merge events (combine and sort)
    const mergedEvents = [
      ...currentBranch.timeline.events,
      ...sourceBranch.timeline.events
    ];

    // Remove duplicates and sort
    const uniqueEvents = mergedEvents.filter((event, index, self) =>
      index === self.findIndex(e =>
        e.timestamp === event.timestamp &&
        JSON.stringify(e.action) === JSON.stringify(event.action)
      )
    );

    uniqueEvents.sort((a, b) => a.timestamp - b.timestamp);
    currentBranch.timeline.events = uniqueEvents;

    Logger.info(`Merged ${sourceBranchName} into ${this.currentBranch}`);
    return true;
  }

  /**
   * Get current branch
   */
  getCurrentBranch() {
    return this.branches.get(this.currentBranch);
  }

  /**
   * Get current branch name
   */
  getCurrentBranchName() {
    return this.currentBranch;
  }

  /**
   * Get all branch names
   */
  getBranchNames() {
    return Array.from(this.branches.keys());
  }

  /**
   * Get branch info
   */
  getBranchInfo(name) {
    const branch = this.branches.get(name);
    if (!branch) return null;

    return {
      name: branch.name,
      eventCount: branch.timeline.getEventCount(),
      maxTime: branch.timeline.getMaxTime(),
      createdAt: new Date(branch.createdAt).toISOString(),
      parentBranch: branch.parentBranch,
      description: branch.description
    };
  }

  /**
   * List all branches with info
   */
  listBranches() {
    return Array.from(this.branches.keys()).map(name => this.getBranchInfo(name));
  }

  /**
   * Serialize all branches
   */
  serialize() {
    const serialized = {};
    this.branches.forEach((branch, name) => {
      serialized[name] = {
        name: branch.name,
        timeline: branch.timeline.serialize(),
        createdAt: branch.createdAt,
        parentBranch: branch.parentBranch,
        description: branch.description
      };
    });
    return {
      branches: serialized,
      currentBranch: this.currentBranch
    };
  }

  /**
   * Deserialize branches
   */
  static deserialize(data) {
    const manager = new BranchManager();
    manager.branches.clear();

    Object.entries(data.branches).forEach(([name, branchData]) => {
      const branch = {
        name: branchData.name,
        timeline: Timeline.deserialize(branchData.timeline),
        createdAt: branchData.createdAt,
        parentBranch: branchData.parentBranch,
        description: branchData.description
      };
      manager.branches.set(name, branch);
    });

    manager.currentBranch = data.currentBranch;
    return manager;
  }
}
