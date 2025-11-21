/**
 * ColorPicker - Visual color selection interface
 * Emits: 'color-changed'
 */

import { EventEmitter } from '../utils/EventEmitter.js';
import { Logger } from '../utils/Logger.js';

export class ColorPicker extends EventEmitter {
  constructor(containerId) {
    super();
    this.containerId = containerId;
    this.currentColor = '#0f0';

    // Preset colors (retro terminal palette)
    this.presetColors = [
      { name: 'Green', value: '#0f0', desc: 'Classic Terminal' },
      { name: 'Cyan', value: '#0ff', desc: 'Aqua' },
      { name: 'Yellow', value: '#ff0', desc: 'Warning' },
      { name: 'Red', value: '#f00', desc: 'Error' },
      { name: 'Magenta', value: '#f0f', desc: 'Purple' },
      { name: 'Blue', value: '#00f', desc: 'Info' },
      { name: 'White', value: '#fff', desc: 'Bright' },
      { name: 'Orange', value: '#fa0', desc: 'Warm' },
      { name: 'Pink', value: '#f8f', desc: 'Soft' },
      { name: 'Lime', value: '#8f0', desc: 'Bright Green' },
      { name: 'Teal', value: '#0aa', desc: 'Ocean' },
      { name: 'Purple', value: '#a0f', desc: 'Violet' }
    ];

    this.createUI();
    this.bindEvents();
  }

  /**
   * Create the color picker UI
   */
  createUI() {
    this.container = document.createElement('div');
    this.container.className = 'color-picker-container';
    this.container.innerHTML = `
      <div class="color-picker-header">
        <h4>🎨 Color Picker</h4>
        <div class="color-current-display">
          <span class="color-current-label">Current:</span>
          <div class="color-current-swatch" id="color-current-swatch" style="background: ${this.currentColor}"></div>
          <span class="color-current-value" id="color-current-value">${this.currentColor}</span>
        </div>
      </div>

      <div class="color-picker-presets">
        <div class="color-presets-label">Preset Colors:</div>
        <div class="color-presets-grid" id="color-presets-grid">
          ${this.presetColors.map((color, i) => `
            <div class="color-preset-item"
                 data-color="${color.value}"
                 data-index="${i}"
                 title="${color.name} (${color.value}) - ${color.desc}">
              <div class="color-preset-swatch" style="background: ${color.value}"></div>
              <div class="color-preset-name">${color.name}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="color-picker-custom">
        <label class="color-custom-label">Custom Color:</label>
        <div class="color-custom-controls">
          <input type="color"
                 id="color-custom-input"
                 class="color-custom-input"
                 value="${this.currentColor}">
          <input type="text"
                 id="color-custom-text"
                 class="color-custom-text"
                 value="${this.currentColor}"
                 placeholder="#000000"
                 pattern="^#[0-9A-Fa-f]{3,6}$">
          <button id="color-apply-custom" class="color-apply-btn">Apply</button>
        </div>
      </div>

      <div class="color-picker-shortcuts">
        <div class="color-shortcuts-label">Keyboard Shortcuts:</div>
        <div class="color-shortcuts-list">
          <div class="color-shortcut-item"><kbd>1-9</kbd> Quick select presets</div>
          <div class="color-shortcut-item"><kbd>0</kbd> Default green</div>
        </div>
      </div>
    `;

    const targetContainer = document.getElementById(this.containerId);
    if (targetContainer) {
      targetContainer.appendChild(this.container);
    } else {
      document.body.appendChild(this.container);
    }
  }

  /**
   * Bind UI events
   */
  bindEvents() {
    // Preset color clicks
    const presetGrid = document.getElementById('color-presets-grid');
    presetGrid.addEventListener('click', (e) => {
      const item = e.target.closest('.color-preset-item');
      if (item) {
        const color = item.dataset.color;
        this.setColor(color);
      }
    });

    // Custom color input (color picker)
    const colorInput = document.getElementById('color-custom-input');
    colorInput.addEventListener('input', (e) => {
      const color = e.target.value;
      document.getElementById('color-custom-text').value = color;
    });

    colorInput.addEventListener('change', (e) => {
      const color = e.target.value;
      this.setColor(color);
    });

    // Custom color text input
    const textInput = document.getElementById('color-custom-text');
    textInput.addEventListener('input', (e) => {
      const color = e.target.value;
      if (/^#[0-9A-Fa-f]{3,6}$/.test(color)) {
        document.getElementById('color-custom-input').value = color;
      }
    });

    textInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const color = e.target.value;
        if (/^#[0-9A-Fa-f]{3,6}$/.test(color)) {
          this.setColor(color);
        } else {
          alert('Invalid color format! Use #RGB or #RRGGBB');
        }
      }
    });

    // Apply custom button
    document.getElementById('color-apply-custom').addEventListener('click', () => {
      const color = document.getElementById('color-custom-text').value;
      if (/^#[0-9A-Fa-f]{3,6}$/.test(color)) {
        this.setColor(color);
      } else {
        alert('Invalid color format! Use #RGB or #RRGGBB');
      }
    });

    // Keyboard shortcuts for quick color selection
    document.addEventListener('keydown', (e) => {
      // Only if not in an input field
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      // Number keys 1-9 and 0
      if (e.key >= '0' && e.key <= '9' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const index = e.key === '0' ? 0 : parseInt(e.key) - 1;
        if (index < this.presetColors.length) {
          this.setColor(this.presetColors[index].value);
          this.flashPreset(index);
          e.preventDefault();
        }
      }
    });
  }

  /**
   * Set the current color
   */
  setColor(color) {
    this.currentColor = color;
    this.updateDisplay();
    this.emit('color-changed', color);
    Logger.info('Color changed to:', color);
  }

  /**
   * Get the current color
   */
  getColor() {
    return this.currentColor;
  }

  /**
   * Update the display
   */
  updateDisplay() {
    const swatch = document.getElementById('color-current-swatch');
    const value = document.getElementById('color-current-value');
    const customInput = document.getElementById('color-custom-input');
    const customText = document.getElementById('color-custom-text');

    if (swatch) swatch.style.background = this.currentColor;
    if (value) value.textContent = this.currentColor;
    if (customInput) customInput.value = this.currentColor;
    if (customText) customText.value = this.currentColor;

    // Update active state on presets
    document.querySelectorAll('.color-preset-item').forEach(item => {
      if (item.dataset.color === this.currentColor) {
        item.classList.add('color-preset-active');
      } else {
        item.classList.remove('color-preset-active');
      }
    });
  }

  /**
   * Flash a preset item to show it was selected
   */
  flashPreset(index) {
    const items = document.querySelectorAll('.color-preset-item');
    if (items[index]) {
      items[index].classList.add('color-preset-flash');
      setTimeout(() => {
        items[index].classList.remove('color-preset-flash');
      }, 300);
    }
  }

  /**
   * Destroy the color picker
   */
  destroy() {
    if (this.container) {
      this.container.remove();
    }
    this.removeAllListeners();
  }
}
