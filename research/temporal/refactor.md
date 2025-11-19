# Temporal Editor Refactoring Plan

## Current State: V1 (Vanilla Single File)

The `temporal-editor-v1.html` is a fully functional single-file implementation that demonstrates all core concepts:
- Event sourcing architecture
- Timeline scrubbing
- Concurrent editing
- INSERT/OVERWRITE modes
- Grid-based text display

**Strengths:**
- ✅ Zero dependencies
- ✅ Self-contained (works offline)
- ✅ Easy to understand
- ✅ Fast to prototype
- ✅ ~500 lines of code

**Limitations:**
- ❌ All code in one file (hard to maintain)
- ❌ No separation of concerns
- ❌ No reusable components
- ❌ Limited extensibility
- ❌ No testing structure
- ❌ Performance optimizations hardcoded
- ❌ No module system

---

## Refactoring Goals

### 1. **Modularity**
Break monolithic code into logical, reusable modules

### 2. **Maintainability**
Separate concerns for easier debugging and enhancement

### 3. **Extensibility**
Enable easy addition of new features (export formats, playback modes, etc.)

### 4. **Testing**
Structure code to support unit testing

### 5. **Performance**
Optimize rendering and state management

### 6. **Developer Experience**
Better debugging, logging, and introspection tools

---

## Proposed Architecture

### Module Structure

```
temporal-editor/
├── index.html              # Entry point (minimal HTML)
├── css/
│   └── styles.css          # All styling (extracted from inline)
├── js/
│   ├── main.js             # Application initialization
│   ├── config.js           # Configuration constants
│   ├── core/
│   │   ├── Grid.js         # Grid state management
│   │   ├── Timeline.js     # Event timeline management
│   │   ├── Cursor.js       # Cursor position and movement
│   │   ├── EventSystem.js  # Event creation and application
│   │   └── StateManager.js # State derivation from events
│   ├── ui/
│   │   ├── Renderer.js     # Canvas rendering
│   │   ├── TimelineUI.js   # Timeline scrubber UI
│   │   ├── StatusBar.js    # Status bar updates
│   │   └── Controls.js     # Button controls
│   ├── input/
│   │   ├── KeyboardHandler.js  # Keyboard input
│   │   └── MouseHandler.js     # Mouse/touch input
│   ├── modes/
│   │   ├── LiveMode.js     # LIVE mode behavior
│   │   ├── ScrubbedMode.js # SCRUBBED mode behavior
│   │   └── ModeManager.js  # Mode switching logic
│   └── utils/
│       ├── EventEmitter.js # Simple pub/sub for components
│       ├── Logger.js       # Debug logging
│       └── Export.js       # Export functionality
└── README.md               # Documentation
```

---

## Detailed Refactoring Plan

### Phase 1: Extract Configuration
**Goal:** Centralize all constants and configuration

**Actions:**
1. Create `config.js` with all constants:
   - Grid dimensions
   - Rendering settings
   - Timing constants
   - Colors and styles
2. Export as frozen object to prevent mutation
3. Make values easily configurable

**Benefits:**
- Single source of truth
- Easy experimentation with different settings
- Type safety for configuration

---

### Phase 2: Core Data Models
**Goal:** Create clean, testable data structures

#### `Grid.js`
```javascript
class Grid {
  constructor(cols, rows)
  createEmpty()
  clone()
  getChar(x, y)
  setChar(x, y, char)
  shiftRowRight(y, fromX)
  shiftRowLeft(y, fromX)
  serialize()
}
```

#### `Cursor.js`
```javascript
class Cursor {
  constructor(x, y)
  move(dx, dy, bounds)
  teleport(x, y, bounds)
  clone()
  serialize()
}
```

#### `Timeline.js`
```javascript
class Timeline {
  constructor()
  addEvent(event)
  getEventsUpTo(time)
  getEventsAt(time)
  getNextEvent(afterTime)
  getMaxTime()
  clear()
  serialize()
}
```

#### `EventSystem.js`
```javascript
class EventSystem {
  static createInsertChar(char, x, y, insertMode, cursor)
  static createDeleteChar(x, y, moveCursor, cursor)
  static createDeleteAndShift(x, y, moveCursor, cursor)
  static createCursorMove(dx, dy, cursor)
  applyEvent(event, grid, cursor)
}
```

**Benefits:**
- Each class has single responsibility
- Easy to test in isolation
- Clear interfaces
- Serialization support for future import/export

---

### Phase 3: State Management
**Goal:** Centralize state derivation and management

#### `StateManager.js`
```javascript
class StateManager extends EventEmitter {
  constructor(timeline, config)

  // State derivation
  rebuildState()
  deriveStateAt(time)

  // State queries
  getCurrentGrid()
  getCurrentCursor()
  getCurrentTime()
  getMaxTime()
  isLive()
  isScrubbed()

  // State mutations (via events)
  addEvent(action)
  scrubTo(time)
  advanceToNextEvent()

  // Mode management
  setInsertMode(mode)
  getInsertMode()

  // Events emitted:
  // - 'state-changed'
  // - 'mode-changed'
  // - 'time-changed'
  // - 'event-added'
}
```

**Benefits:**
- Single source of truth for application state
- Event-driven updates (components can subscribe)
- Clear mutation API
- Easier debugging (all state changes go through here)

---

### Phase 4: Rendering Layer
**Goal:** Separate rendering from logic

#### `Renderer.js`
```javascript
class Renderer {
  constructor(canvas, config)

  render(grid, cursor, insertMode, cursorVisible)
  renderGrid(grid)
  renderCursor(cursor, insertMode, visible)

  clear()
  resize(width, height)

  // Utility
  gridToPixel(x, y)
  pixelToGrid(px, py)
}
```

#### `TimelineUI.js`
```javascript
class TimelineUI extends EventEmitter {
  constructor(containerEl, config)

  update(currentTime, maxTime, timeline)
  renderMarkers(timeline, maxTime)
  renderPlayhead(currentTime, maxTime)

  // Events emitted:
  // - 'scrub' (time)
  // - 'scrub-start'
  // - 'scrub-end'
}
```

#### `StatusBar.js`
```javascript
class StatusBar {
  constructor(containerEl)

  update(state)
  updateMode(isLive, isScrubbed)
  updateInsertMode(insertMode)
  updateTime(current, max)
  updateCursor(x, y)
  updateEventCount(count)
}
```

**Benefits:**
- Pure rendering functions
- No business logic mixed with drawing
- Easy to swap rendering backends
- Better performance (can optimize rendering separately)

---

### Phase 5: Input Handling
**Goal:** Decouple input from application logic

#### `KeyboardHandler.js`
```javascript
class KeyboardHandler extends EventEmitter {
  constructor()

  attachTo(element)
  detach()

  // Events emitted:
  // - 'char-typed' (char)
  // - 'delete' (isBackspace)
  // - 'cursor-move' (dx, dy)
  // - 'toggle-insert-mode'
}
```

#### `MouseHandler.js`
```javascript
class MouseHandler extends EventEmitter {
  constructor(canvas, renderer)

  attachTo(canvas)
  detach()

  // Events emitted:
  // - 'cursor-teleport' (x, y)
}
```

**Benefits:**
- Input abstraction (easier to add gamepad, touch, etc.)
- Testable without actual input events
- Clear event contracts

---

### Phase 6: Mode System
**Goal:** Encapsulate mode-specific behavior

#### `ModeManager.js`
```javascript
class ModeManager extends EventEmitter {
  constructor(stateManager)

  handleCharTyped(char)
  handleDelete(isBackspace)
  handleCursorMove(dx, dy)

  getCurrentMode() // returns 'live' | 'scrubbed'

  // Delegates to appropriate mode handler
  // Emits: 'mode-changed'
}
```

#### `LiveMode.js`
```javascript
class LiveMode {
  handleCharTyped(char, state)
  handleDelete(isBackspace, state)
  handleCursorMove(dx, dy, state)
}
```

#### `ScrubbedMode.js`
```javascript
class ScrubbedMode {
  handleCharTyped(char, state)
  handleDelete(isBackspace, state)
  handleCursorMove(dx, dy, state)
  // Includes concurrent editing logic
}
```

**Benefits:**
- Clear mode separation
- Easy to add new modes
- Mode-specific behavior isolated

---

### Phase 7: Utilities
**Goal:** Reusable helper components

#### `EventEmitter.js`
```javascript
class EventEmitter {
  on(event, callback)
  off(event, callback)
  emit(event, data)
}
```

#### `Logger.js`
```javascript
class Logger {
  static setLevel(level) // 'debug' | 'info' | 'warn' | 'error'
  static debug(message, data)
  static info(message, data)
  static warn(message, data)
  static error(message, data)
  static group(label)
  static groupEnd()
}
```

#### `Export.js`
```javascript
class Export {
  static toJSON(timeline, metadata)
  static toCSV(timeline)
  static downloadJSON(data, filename)
  // Future: toGIF, toVideo, toAsciinema
}
```

**Benefits:**
- DRY principles
- Reusable across projects
- Better debugging

---

### Phase 8: Main Application
**Goal:** Wire everything together

#### `main.js`
```javascript
class TemporalEditor {
  constructor(config)

  init()
  destroy()

  // Public API
  getTimeline()
  getState()
  exportJSON()
  clear()

  // Private: wires up all components
  _setupComponents()
  _bindEvents()
  _startRenderLoop()
}
```

---

## File-by-File Refactoring Order

### Priority 1: Foundation (Do First)
1. `config.js` - Extract all constants
2. `EventEmitter.js` - Needed by many components
3. `Logger.js` - For debugging during refactor

### Priority 2: Core Data (Critical Path)
4. `Grid.js` - Core data structure
5. `Cursor.js` - Core data structure
6. `Timeline.js` - Core data structure
7. `EventSystem.js` - Event creation/application

### Priority 3: State Management
8. `StateManager.js` - Central state management

### Priority 4: Rendering
9. `Renderer.js` - Canvas rendering
10. `TimelineUI.js` - Timeline scrubber
11. `StatusBar.js` - Status display

### Priority 5: Input
12. `KeyboardHandler.js` - Keyboard input
13. `MouseHandler.js` - Mouse input

### Priority 6: Modes
14. `LiveMode.js` - Live mode logic
15. `ScrubbedMode.js` - Scrubbed mode logic
16. `ModeManager.js` - Mode orchestration

### Priority 7: Integration
17. `Controls.js` - Button controls
18. `Export.js` - Export functionality
19. `main.js` - Application wiring
20. `index.html` - Entry point
21. `styles.css` - Extracted styles

---

## Key Design Patterns

### 1. **Event-Driven Architecture**
Components communicate via events, not direct calls
- Loose coupling
- Easy to add/remove components
- Clear data flow

### 2. **Immutable Events**
Events in timeline are never modified
- Easier to reason about
- Supports time-travel debugging
- Cache-friendly

### 3. **Derived State**
All UI state derived from timeline
- Single source of truth
- No sync bugs
- Reproducible

### 4. **Separation of Concerns**
- Data (Grid, Timeline, Cursor)
- Logic (StateManager, EventSystem)
- UI (Renderer, StatusBar)
- Input (Keyboard, Mouse)

### 5. **Dependency Injection**
Components receive dependencies, don't create them
- Testable
- Flexible
- Clear dependencies

---

## Performance Optimizations

### 1. **Snapshot Caching**
```javascript
class StateManager {
  constructor() {
    this.snapshots = new Map(); // time -> state
    this.snapshotInterval = 1000; // ms
  }

  deriveStateAt(time) {
    // Find nearest snapshot before time
    const snapTime = this._getNearestSnapshot(time);
    const state = this.snapshots.get(snapTime);

    // Replay only events after snapshot
    const events = timeline.getEventsFrom(snapTime, time);
    return this._replayEvents(state, events);
  }
}
```

**Impact:** O(n) → O(n/k) where k = snapshot interval

### 2. **Dirty Rendering**
```javascript
class Renderer {
  render(grid, cursor, force = false) {
    if (!force && !this._isDirty(grid, cursor)) {
      return; // Skip render
    }
    // ... render
  }

  _isDirty(grid, cursor) {
    return grid !== this.lastGrid ||
           cursor !== this.lastCursor;
  }
}
```

**Impact:** Reduces unnecessary redraws

### 3. **Viewport Culling**
```javascript
class Renderer {
  renderGrid(grid, viewport) {
    // Only render visible cells
    for (let y = viewport.startY; y < viewport.endY; y++) {
      for (let x = viewport.startX; x < viewport.endX; x++) {
        this._renderCell(x, y, grid[y][x]);
      }
    }
  }
}
```

**Impact:** Supports larger grids (scrolling)

### 4. **Request Animation Frame**
```javascript
class TemporalEditor {
  _startRenderLoop() {
    const render = () => {
      this.renderer.render(
        this.state.getCurrentGrid(),
        this.state.getCurrentCursor(),
        this.state.getInsertMode(),
        this.cursorVisible
      );
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  }
}
```

**Impact:** Smooth, optimized rendering

---

## Testing Strategy

### Unit Tests
- `Grid.js` - All grid operations
- `Cursor.js` - Movement and bounds
- `Timeline.js` - Event ordering
- `EventSystem.js` - Event application

### Integration Tests
- `StateManager.js` - State derivation
- `ModeManager.js` - Mode switching

### E2E Tests (Future)
- Full user workflows
- Timeline scrubbing
- Concurrent editing

**Testing Framework:** Plain JavaScript (no dependencies)
```javascript
// test/Grid.test.js
function testGridShiftRight() {
  const grid = new Grid(10, 5);
  grid.setChar(0, 0, 'A');
  grid.shiftRowRight(0, 0);
  assert(grid.getChar(1, 0) === 'A');
  assert(grid.getChar(0, 0) === ' ');
}
```

---

## Migration Path

### Step 1: Side-by-Side Development
- Keep `temporal-editor-v1.html` as reference
- Build modular version as `temporal-editor-v2/`
- Compare behavior during development

### Step 2: Feature Parity
- Ensure all V1 features work in V2
- Verify same events produce same results
- Performance benchmarking

### Step 3: Enhancement
- Add features impossible in V1:
  - Unit tests
  - Export to multiple formats
  - Playback speed control
  - Event editing
  - Timeline branching

### Step 4: Documentation
- API documentation
- Architecture guide
- Contributing guide

---

## Success Metrics

### Code Quality
- ✅ All modules < 200 lines
- ✅ Each module has single responsibility
- ✅ No circular dependencies
- ✅ 100% of core logic covered by tests

### Performance
- ✅ Handles 10,000 events smoothly
- ✅ Render at 60 FPS
- ✅ State rebuild < 16ms

### Developer Experience
- ✅ New feature added in < 1 hour
- ✅ Bug fix requires touching < 3 files
- ✅ Clear error messages
- ✅ Comprehensive logging

### User Experience
- ✅ Same functionality as V1
- ✅ No regressions
- ✅ Faster perceived performance
- ✅ Better error handling

---

## Future Enhancements (Post-Refactor)

### 1. **Playback Controls**
- Play/pause timeline
- Speed control (0.5x, 1x, 2x)
- Step forward/backward

### 2. **Export Formats**
- Animated GIF
- MP4 video
- Asciinema recording
- SVG animation

### 3. **Timeline Branching**
- Create named branches
- Switch between branches
- Merge branches
- Compare branches

### 4. **Multi-Cursor Visualization**
- Show all concurrent cursors
- Ghost cursor trails
- Color-coded by timeline branch

### 5. **Event Inspector**
- Click timeline marker to inspect event
- Edit event properties
- Delete events
- Duplicate events

### 6. **Macros**
- Record macro (sequence of actions)
- Replay macro at any timestamp
- Save/load macros

### 7. **Collaboration (Real-time)**
- WebSocket sync
- CRDT for conflict resolution
- User presence indicators

### 8. **Audio Integration**
- Record audio while typing
- Sync playback with timeline
- Export with audio

### 9. **Pattern Analysis**
- Typing speed metrics
- Burst detection
- Correction rate
- Timeline visualization

### 10. **Persistence**
- Save to localStorage
- Load timeline JSON
- Auto-save drafts
- Version history

---

## Conclusion

This refactoring transforms the Temporal Editor from:
- **Prototype** → **Production-ready architecture**
- **Single file** → **Modular codebase**
- **Hard to test** → **Fully testable**
- **Hard to extend** → **Plugin-ready**
- **Educational toy** → **Research platform**

The modular architecture enables:
1. **Rapid experimentation** - Add new features quickly
2. **Collaboration** - Multiple developers can work in parallel
3. **Quality** - Comprehensive testing
4. **Performance** - Targeted optimizations
5. **Innovation** - Foundation for advanced features

While maintaining:
- ✅ Zero runtime dependencies
- ✅ Simple deployment (static files)
- ✅ Original vision and philosophy
- ✅ All V1 functionality

**Timeline:** ~2-3 days for core refactor, 1 week for full implementation with tests

**Risk:** Low - V1 serves as executable specification

**ROI:** High - Unlocks advanced features and research potential
