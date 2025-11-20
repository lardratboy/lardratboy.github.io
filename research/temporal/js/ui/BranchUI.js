/**
 * BranchUI - Visual interface for managing timeline branches
 * Provides UI controls for creating, switching, and deleting branches
 */

import { EventEmitter } from '../utils/EventEmitter.js';
import { Logger } from '../utils/Logger.js';

export class BranchUI extends EventEmitter {
  constructor(containerId, branchManager) {
    super();
    this.containerId = containerId;
    this.branchManager = branchManager;
    this.container = null;
    this.isVisible = false;

    this.createUI();
    this.bindEvents();
  }

  /**
   * Create the branch management UI
   */
  createUI() {
    // Create container
    this.container = document.createElement('div');
    this.container.className = 'branch-ui-container';
    this.container.innerHTML = `
      <div class="branch-ui-header">
        <h4>🌿 Branch Management</h4>
        <button class="branch-ui-toggle" id="branch-ui-toggle">▼</button>
      </div>
      <div class="branch-ui-content" id="branch-ui-content">
        <div class="branch-ui-current">
          <span class="branch-label">Current Branch:</span>
          <span class="branch-name" id="current-branch-name">main</span>
        </div>

        <div class="branch-ui-actions">
          <button id="branch-create-btn" class="branch-btn branch-btn-primary">
            ➕ Create Branch
          </button>
          <button id="branch-switch-btn" class="branch-btn branch-btn-secondary">
            🔀 Switch Branch
          </button>
          <button id="branch-delete-btn" class="branch-btn branch-btn-danger">
            🗑️ Delete Branch
          </button>
          <button id="branch-merge-btn" class="branch-btn branch-btn-secondary">
            🔗 Merge Branch
          </button>
        </div>

        <div class="branch-list-container">
          <div class="branch-list-header">
            <span>Available Branches:</span>
          </div>
          <div class="branch-list" id="branch-list">
            <!-- Branch items will be added here -->
          </div>
        </div>
      </div>
    `;

    // Append to document
    const targetContainer = document.getElementById(this.containerId);
    if (targetContainer) {
      targetContainer.appendChild(this.container);
    } else {
      document.body.appendChild(this.container);
    }

    this.updateBranchList();
  }

  /**
   * Bind UI events
   */
  bindEvents() {
    // Toggle visibility
    document.getElementById('branch-ui-toggle').addEventListener('click', () => {
      this.toggleVisibility();
    });

    // Create branch
    document.getElementById('branch-create-btn').addEventListener('click', () => {
      this.showCreateDialog();
    });

    // Switch branch
    document.getElementById('branch-switch-btn').addEventListener('click', () => {
      this.showSwitchDialog();
    });

    // Delete branch
    document.getElementById('branch-delete-btn').addEventListener('click', () => {
      this.showDeleteDialog();
    });

    // Merge branch
    document.getElementById('branch-merge-btn').addEventListener('click', () => {
      this.showMergeDialog();
    });

    // Listen to branch manager events
    this.branchManager.on('branch-created', () => this.updateBranchList());
    this.branchManager.on('branch-switched', () => this.updateBranchList());
    this.branchManager.on('branch-deleted', () => this.updateBranchList());
  }

  /**
   * Toggle UI visibility
   */
  toggleVisibility() {
    this.isVisible = !this.isVisible;
    const content = document.getElementById('branch-ui-content');
    const toggle = document.getElementById('branch-ui-toggle');

    if (this.isVisible) {
      content.style.display = 'block';
      toggle.textContent = '▲';
    } else {
      content.style.display = 'none';
      toggle.textContent = '▼';
    }
  }

  /**
   * Update the branch list display
   */
  updateBranchList() {
    const listEl = document.getElementById('branch-list');
    const currentBranchEl = document.getElementById('current-branch-name');

    // Update current branch indicator
    const currentBranch = this.branchManager.getCurrentBranchName();
    currentBranchEl.textContent = currentBranch;
    currentBranchEl.className = 'branch-name branch-name-active';

    // Get all branches
    const branches = this.branchManager.listBranches();

    // Clear list
    listEl.innerHTML = '';

    // Add branch items
    branches.forEach(branch => {
      const item = document.createElement('div');
      item.className = 'branch-item';
      if (branch.name === currentBranch) {
        item.classList.add('branch-item-active');
      }

      item.innerHTML = `
        <div class="branch-item-header">
          <span class="branch-item-name">${branch.name}</span>
          ${branch.name === currentBranch ? '<span class="branch-badge">CURRENT</span>' : ''}
        </div>
        <div class="branch-item-info">
          <span class="branch-item-stat">📊 ${branch.eventCount} events</span>
          <span class="branch-item-stat">⏱️ ${branch.maxTime}ms</span>
        </div>
        ${branch.description ? `<div class="branch-item-description">${branch.description}</div>` : ''}
      `;

      // Click to switch
      item.addEventListener('click', () => {
        if (branch.name !== currentBranch) {
          this.emit('switch-branch', branch.name);
        }
      });

      listEl.appendChild(item);
    });

    // Show empty state if no branches
    if (branches.length === 0) {
      listEl.innerHTML = '<div class="branch-list-empty">No branches yet</div>';
    }
  }

  /**
   * Show create branch dialog
   */
  showCreateDialog() {
    const name = prompt('Enter new branch name:');
    if (!name) return;

    if (!/^[a-zA-Z0-9-_]+$/.test(name)) {
      alert('Branch name can only contain letters, numbers, dashes, and underscores.');
      return;
    }

    const description = prompt('Enter branch description (optional):') || '';

    this.emit('create-branch', { name, description });
  }

  /**
   * Show switch branch dialog
   */
  showSwitchDialog() {
    const branches = this.branchManager.getBranchNames();
    const currentBranch = this.branchManager.getCurrentBranchName();

    const otherBranches = branches.filter(b => b !== currentBranch);

    if (otherBranches.length === 0) {
      alert('No other branches available. Create a new branch first!');
      return;
    }

    const branchList = otherBranches.map((b, i) => `${i + 1}. ${b}`).join('\n');
    const choice = prompt(`Switch to branch:\n${branchList}\n\nEnter branch name:`);

    if (!choice) return;

    if (!otherBranches.includes(choice)) {
      alert('Invalid branch name!');
      return;
    }

    this.emit('switch-branch', choice);
  }

  /**
   * Show delete branch dialog
   */
  showDeleteDialog() {
    const branches = this.branchManager.getBranchNames();
    const currentBranch = this.branchManager.getCurrentBranchName();

    const deletableBranches = branches.filter(b => b !== currentBranch && b !== 'main');

    if (deletableBranches.length === 0) {
      alert('No branches available to delete.\n(Cannot delete current branch or main branch)');
      return;
    }

    const branchList = deletableBranches.map((b, i) => `${i + 1}. ${b}`).join('\n');
    const choice = prompt(`Delete branch:\n${branchList}\n\nEnter branch name:`);

    if (!choice) return;

    if (!deletableBranches.includes(choice)) {
      alert('Invalid branch name or cannot delete that branch!');
      return;
    }

    if (confirm(`Are you sure you want to delete branch "${choice}"?`)) {
      this.emit('delete-branch', choice);
    }
  }

  /**
   * Show merge branch dialog
   */
  showMergeDialog() {
    const branches = this.branchManager.getBranchNames();
    const currentBranch = this.branchManager.getCurrentBranchName();

    const otherBranches = branches.filter(b => b !== currentBranch);

    if (otherBranches.length === 0) {
      alert('No other branches available to merge!');
      return;
    }

    const branchList = otherBranches.map((b, i) => `${i + 1}. ${b}`).join('\n');
    const choice = prompt(`Merge branch into ${currentBranch}:\n${branchList}\n\nEnter branch name:`);

    if (!choice) return;

    if (!otherBranches.includes(choice)) {
      alert('Invalid branch name!');
      return;
    }

    if (confirm(`Merge "${choice}" into "${currentBranch}"?`)) {
      this.emit('merge-branch', choice);
    }
  }

  /**
   * Show a notification
   */
  showNotification(message, type = 'info') {
    Logger.info(`[BranchUI] ${message}`);

    // Create notification element
    const notification = document.createElement('div');
    notification.className = `branch-notification branch-notification-${type}`;
    notification.textContent = message;

    this.container.appendChild(notification);

    // Auto-remove after 3 seconds
    setTimeout(() => {
      notification.remove();
    }, 3000);
  }

  /**
   * Destroy the UI
   */
  destroy() {
    if (this.container) {
      this.container.remove();
    }
    this.removeAllListeners();
  }
}
