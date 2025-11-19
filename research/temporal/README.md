# Temporal Text Editor

**When Time Becomes Editable**

A text editor where you can scrub backwards through time, add concurrent edits at historical moments, and watch multiple "ghost writers" type simultaneously in a turn-based temporal performance.

## Versions

### V1 - Vanilla Single File (`temporal-editor-v1.html`)
- ✅ Complete implementation in one HTML file
- ✅ Zero dependencies
- ✅ ~500 lines of code
- ✅ Perfect for learning and prototyping
- ⚠️ Monolithic structure

### V2 - Modular Architecture (`index.html` + modules)
- ✅ Modular, maintainable codebase
- ✅ ES6 modules with clear separation of concerns
- ✅ Event-driven architecture
- ✅ Easily testable components
- ✅ Extensible for future features
- ⚠️ Requires modern browser with ES6 module support

## Quick Start

### Running V1 (Simple)
```bash
# Just open in browser
open temporal-editor-v1.html
```

### Running V2 (Modular)
```bash
# Serve with any static server (modules require HTTP/HTTPS)
python3 -m http.server 8000
# or
npx serve

# Then open http://localhost:8000
```

## Core Concepts

### Event Sourcing
Every keystroke is an **immutable event** in a timeline, not a destructive state change. The document is derived by replaying events.

### Time Travel
Scrub the timeline to any moment in history and see exactly what the text looked like.

### Concurrent Editing
Add new events at old timestamps. Multiple edits at the same moment create "concurrent" events that interleave during playback.

### Three Modes

**LIVE Mode** (Green)
- Normal editing
- Events timestamped at "now"
- Timeline extends forward

**SCRUBBED Mode** (Red)
- Dragged timeline backwards
- Viewing historical state
- Ready for concurrent editing

**CONCURRENT Mode** (Red - Active)
- Typing while scrubbed back
- Each keystroke advances to next historical event
- Creates illusion of simultaneous typing

## Architecture (V2)

```
js/
├── config.js           # Configuration constants
├── main.js             # Application entry point
├── core/               # Core data structures & logic
│   ├── Grid.js         # Character grid
│   ├── Cursor.js       # Cursor position
│   ├── Timeline.js     # Event timeline
│   ├── EventSystem.js  # Event creation/application
│   └── StateManager.js # Central state management
├── ui/                 # User interface
│   ├── Renderer.js     # Canvas rendering
│   ├── TimelineUI.js   # Timeline scrubber
│   └── StatusBar.js    # Status display
├── input/              # Input handling
│   ├── KeyboardHandler.js
│   └── MouseHandler.js
└── utils/              # Utilities
    ├── EventEmitter.js # Pub/sub events
    ├── Logger.js       # Debug logging
    └── Export.js       # Export formats
```

## Usage Examples

### Basic Workflow
1. Type "HELLO WORLD"
2. Drag timeline to beginning
3. Click on row 5
4. Type "GOODBYE MOON"
5. Watch them type in alternating turns

### Concurrent Editing
1. Write a sentence on row 0
2. Scrub timeline back to start
3. Click on row 2
4. Type another sentence
5. Both sentences appear to type simultaneously

### API (V2)
```javascript
// Access via browser console
const editor = window.editor;

// Get current state
editor.getState();

// Export timeline
editor.exportJSON();

// Clear editor
editor.clear();

// Access state manager
editor.state.getTimeline();
editor.state.getCurrentGrid();
```

## Key Features

- ✅ Event sourcing architecture
- ✅ Full timeline scrubbing
- ✅ Concurrent editing (temporal multiplicity)
- ✅ INSERT/OVERWRITE modes
- ✅ Cursor teleportation
- ✅ Visual timeline with markers
- ✅ Export to JSON/CSV
- ✅ Retro terminal aesthetic
- ✅ Zero runtime dependencies

## Browser Support

- Chrome/Edge: ✅ Full support
- Firefox: ✅ Full support
- Safari: ✅ Full support (14+)
- IE: ❌ Not supported (no ES6 modules)

## Development

### V2 Module Structure

Each module follows single responsibility principle:
- **Data**: Pure data structures (Grid, Cursor, Timeline)
- **Logic**: State management and event application
- **UI**: Rendering and display
- **Input**: Event handling and user interaction

### Event Flow

```
User Input → KeyboardHandler
           → MouseHandler
               ↓
         StateManager
       (creates events)
               ↓
          Timeline
       (stores events)
               ↓
         Rebuild State
      (replay events)
               ↓
           Renderer
        (draw to canvas)
```

## Philosophy

### Event Sourcing for Editing
The document is not a grid of characters. It's a **timeline of actions**. The grid is just a view derived from replaying those actions.

### Time as Material
Just as traditional editors let you move in space (↑↓←→), this editor lets you move in **time** (◀ ▶ on timeline).

### Additive History
You never erase history. Scrubbing back and typing **adds to** the timeline, creating multiple truths at the same moment.

### Performance as Document
The final text is one artifact. The **timeline itself** - the recording of creation - is equally important.

## Performance

### V1 & V2 (Current)
- Full state rebuild on every change
- O(n) where n = events up to current time
- Handles ~10,000 events smoothly
- 60 FPS rendering

### Future Optimizations
- Snapshot caching every 1000ms
- Incremental replay from snapshots
- Viewport culling for larger grids
- Lazy evaluation of off-screen cells

## Future Features

See `refactor.md` for detailed roadmap:

- [ ] Playback controls (play/pause/speed)
- [ ] Export to GIF/MP4/Asciinema
- [ ] Timeline branching
- [ ] Multi-cursor visualization
- [ ] Event inspector and editor
- [ ] Macro recording
- [ ] Real-time collaboration
- [ ] Audio integration
- [ ] Pattern analysis
- [ ] Persistence (localStorage/file)

## Files

- `temporal-editor-v1.html` - Original single-file implementation
- `index.html` - V2 entry point
- `temporal-editor-pitch.md` - Design philosophy and vision
- `refactor.md` - Detailed refactoring plan and architecture

## License

MIT - Do What Thou Wilt

## Warning

May cause temporal confusion, creative enlightenment, or both.

---

*"The future is just the past that hasn't happened yet, unless you scrub the timeline back and make them happen concurrently, in which case time is just a suggestion and text editing becomes jazz."*
