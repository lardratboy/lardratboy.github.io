# Temporal Editor V3 - Enhanced Features Guide

This document describes all the enhanced features added in Version 3.

## 🎯 Overview

V3 builds on the foundation of V2's modular architecture to add powerful new capabilities:

- **Playback Controls** - Play, pause, speed control
- **Persistence** - Auto-save, save/load, drafts
- **Pattern Analysis** - Typing metrics and insights
- **Event Inspector** - Inspect and edit individual events
- **Multi-Cursor Visualization** - See all concurrent cursor positions
- **Timeline Branching** - Create and switch between timeline branches
- **Macro Recording** - Record and replay action sequences

---

## 1. Playback Controls

Play back your typing timeline like a video.

### Features

- **Play/Pause** - Watch events replay in real-time
- **Speed Control** - 0.25x, 0.5x, 1x, 2x, 4x playback speeds
- **Step Controls** - Step forward/backward one event at a time
- **Stop** - Return to beginning

### UI Controls

```
▶ Play    - Start playback from current position
⏸ Pause   - Pause playback
⏹ Stop    - Stop and return to beginning
⏮ Step Back - Move to previous event
⏭ Step Forward - Move to next event
```

### API

```javascript
editor.play()              // Start playback
editor.pause()             // Pause playback
editor.stop()              // Stop and return to start
editor.setSpeed(2)         // Set speed (0.25, 0.5, 1, 2, 4)
editor.stepForward()       // Step to next event
editor.stepBackward()      // Step to previous event
```

### Use Cases

- Review your typing performance
- Create demonstrations
- Debug concurrent editing
- Show timeline evolution

---

## 2. Persistence

Save and load your work with auto-save protection.

### Features

- **Auto-Save** - Automatically saves every 30 seconds
- **Manual Save/Load** - Save and load named states
- **Drafts** - Save multiple named drafts
- **Auto-Load** - Prompts to load auto-save on startup

### UI Controls

```
Save State  - Save current state
Load State  - Load saved state
```

### API

```javascript
// Basic save/load
editor.save('my-work')     // Save with name
editor.load('my-work')     // Load by name

// Drafts
editor.saveDraft('draft1') // Save named draft
editor.loadDraft('draft1') // Load named draft
editor.listDrafts()        // List all drafts

// Auto-save
editor.autoSave()          // Manual auto-save
```

### Storage

Data is stored in browser's `localStorage`:
- `temporal-editor-state` - Manual saves
- `temporal-editor-autosave` - Auto-save
- `temporal-editor-drafts` - Named drafts

---

## 3. Pattern Analysis

Analyze your typing patterns and get insights.

### Metrics

**Basic Metrics:**
- Total events
- Duration
- Event type breakdown

**Typing Metrics:**
- Total characters typed
- Average typing speed (chars/sec)
- Burstiness (typing rhythm variance)
- Average interval between keystrokes

**Timing Analysis:**
- Average event interval
- Min/max intervals
- Standard deviation

**Concurrency Analysis:**
- Number of concurrent timestamps
- Maximum concurrent events
- Total concurrent events
- Concurrency rate

**Corrections:**
- Delete count
- Correction rate
- Backspace vs Delete key usage

**Spatial Usage:**
- Unique positions used
- Rows and columns used
- Grid coverage percentage

### UI Controls

```
Analyze Patterns - Print analysis to console
```

### API

```javascript
const analysis = editor.analyze()  // Returns full analysis object
// Also prints formatted report to console

// Analysis object structure:
{
  basic: { totalEvents, duration, eventTypes, ... },
  typing: { totalChars, avgSpeed, burstiness, ... },
  timing: { avgInterval, minInterval, maxInterval, ... },
  concurrency: { concurrentTimestamps, maxConcurrent, ... },
  corrections: { deleteCount, correctionRate, ... },
  spatial: { rowsUsed, colsUsed, coverage, ... }
}
```

### Use Cases

- Understand your typing patterns
- Measure typing speed
- Analyze correction behavior
- Study concurrent editing usage

---

## 4. Event Inspector

Inspect and manipulate individual events.

### Features

- View event details
- See concurrent events
- Delete events
- Duplicate events
- Export individual events

### UI

Click a timeline marker to open the inspector (currently requires API).

### API

```javascript
editor.inspectEventAt(timestamp)  // Open inspector for event at time
```

### Inspector Displays

- Timestamp
- Event type
- Cursor position before event
- Full action data (JSON)
- Concurrent events at same time

### Actions

- **Delete Event** - Remove event from timeline
- **Duplicate Event** - Create copy at +1ms
- **Export Event** - Download as JSON

---

## 5. Multi-Cursor Visualization

Visualize all concurrent cursor positions simultaneously.

### Features

- Shows ghost cursors for concurrent events
- Color-coded cursors (cyan, magenta, yellow, orange, etc.)
- Labels (C1, C2, C3...) for each cursor
- Semi-transparent visualization

### UI Controls

```
Toggle Multi-Cursor - Enable/disable visualization
```

### API

```javascript
editor.toggleMultiCursor()  // Toggle on/off
```

### How It Works

When you have concurrent events (multiple events at the same timestamp), the multi-cursor renderer shows where each cursor was positioned before its action.

### Use Cases

- Understand concurrent editing patterns
- Debug complex multi-position edits
- Visual representation of temporal multiplicity
- Create interesting visual effects

---

## 6. Timeline Branching

Create alternate timeline branches, like git for your editor.

### Features

- Create named branches from current timeline
- Switch between branches
- Merge branches
- List all branches
- Branch metadata (creation time, parent, description)

### API

```javascript
// Create branch
editor.createBranch('experiment1', 'Testing concurrent editing')

// Switch branches
editor.switchBranch('experiment1')  // Switch to experiment1
editor.switchBranch('main')         // Back to main

// List branches
editor.listBranches()
// Returns array:
[
  {
    name: 'main',
    eventCount: 42,
    maxTime: 5000,
    createdAt: '2025-01-...',
    parentBranch: undefined,
    description: 'Main timeline'
  },
  ...
]
```

### Workflow Example

```javascript
// 1. Work on main branch
// ... type some text ...

// 2. Create experimental branch
editor.createBranch('try-something', 'Experimental layout')

// 3. Make changes
// ... edit more ...

// 4. Don't like it? Switch back
editor.switchBranch('main')

// 5. Create another branch
editor.createBranch('better-idea')

// 6. Like this one? Keep working
// ... more edits ...
```

### Use Cases

- Experiment without losing work
- Compare different approaches
- Create variations
- Organize complex projects

---

## 7. Macro Recording

Record sequences of actions and replay them.

### Features

- Record named macros
- Replay at any timestamp
- Save/load macros
- Macro metadata (event count, duration)

### API

```javascript
// Start recording
editor.startRecording('header-template')

// ... perform actions (type, move cursor, etc.) ...

// Stop recording
editor.stopRecording()

// Save the macro
editor.saveMacro('Adds header with separator')

// Replay macro at timestamp 0
editor.replayMacro('header-template', 0)

// List all macros
editor.listMacros()
// Returns:
[
  {
    name: 'header-template',
    eventCount: 25,
    duration: 1234,
    description: 'Adds header with separator'
  },
  ...
]
```

### Workflow Example

```javascript
// 1. Record a common pattern
editor.startRecording('box-border')
// Type: +----+
// Move down, type: |    |
// Move down, type: +----+
editor.saveMacro('Draws a box border')

// 2. Use it multiple times
editor.replayMacro('box-border', 0)     // At start
editor.replayMacro('box-border', 5000)  // At 5 seconds
editor.replayMacro('box-border', 10000) // At 10 seconds
```

### Use Cases

- Automate repetitive patterns
- Create templates
- Build complex structures quickly
- Procedural generation

---

## 8. Export Options

Enhanced export capabilities.

### Formats

- **JSON** - Complete timeline with metadata
- **CSV** - Event log in CSV format

### API

```javascript
editor.exportJSON()  // Download JSON file
editor.exportCSV()   // Download CSV file
```

---

## Advanced Workflows

### 1. Performance Review Session

```javascript
// Record yourself working
// ... type for a while ...

// Analyze performance
editor.analyze()

// Replay to review
editor.setSpeed(2)  // 2x speed
editor.play()

// Step through slow sections
editor.pause()
editor.stepForward()  // Examine each action
```

### 2. Template Creation

```javascript
// Create reusable macro
editor.startRecording('function-template')
// Type function boilerplate...
editor.saveMacro('Standard function template')

// Use in multiple branches
editor.createBranch('module1')
editor.replayMacro('function-template', 0)

editor.switchBranch('main')
editor.createBranch('module2')
editor.replayMacro('function-template', 0)
```

### 3. Experimental Editing

```javascript
// Save current work
editor.saveDraft('before-experiments')

// Try idea 1
editor.createBranch('idea1')
// ... edit ...

// Try idea 2
editor.switchBranch('main')
editor.createBranch('idea2')
// ... edit ...

// Compare with analysis
editor.switchBranch('idea1')
editor.analyze()

editor.switchBranch('idea2')
editor.analyze()

// Keep the best, or revert
editor.loadDraft('before-experiments')
```

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Insert | Toggle INSERT/OVERWRITE mode |
| Arrow Keys | Move cursor (recorded) |
| Backspace | Delete backward |
| Delete | Delete forward |
| Click | Teleport cursor (not recorded) |

*Playback controls currently use UI buttons only*

---

## Console API Reference

Complete API available via `window.editor`:

```javascript
// Playback
editor.play()
editor.pause()
editor.stop()
editor.setSpeed(speed)
editor.stepForward()
editor.stepBackward()

// Persistence
editor.save(name)
editor.load(name)
editor.autoSave()
editor.saveDraft(name)
editor.loadDraft(name)
editor.listDrafts()

// Analysis
editor.analyze()

// Branches
editor.createBranch(name, description)
editor.switchBranch(name)
editor.listBranches()

// Macros
editor.startRecording(name)
editor.stopRecording()
editor.saveMacro(description)
editor.replayMacro(name, timestamp)
editor.listMacros()

// Multi-cursor
editor.toggleMultiCursor()

// Inspector
editor.inspectEventAt(timestamp)

// Export
editor.exportJSON()
editor.exportCSV()

// Basic
editor.clear()
editor.getState()
editor.getTimeline()
```

---

## Performance Considerations

### Auto-Save Impact
- Auto-save runs every 30 seconds
- Minimal performance impact (async operation)
- Uses localStorage (5-10MB limit)

### Playback Performance
- Smooth playback up to 10,000 events
- Higher speeds (2x, 4x) may show frame drops on complex timelines
- Step controls always instant

### Branch Storage
- Each branch stores full timeline copy
- Memory usage: ~1KB per 100 events per branch
- Recommend: < 10 branches for optimal performance

---

## Troubleshooting

### Auto-save not working
- Check localStorage is enabled
- Check available storage space
- Look for errors in console

### Playback stuttering
- Reduce playback speed
- Close other tabs
- Check timeline event count

### Branches not switching
- Check branch exists: `editor.listBranches()`
- Ensure current branch is saved
- Check console for errors

---

## Future Enhancements

Possible future additions:

- Real-time collaboration (WebSocket)
- Export to animated GIF
- Export to video (MP4)
- Audio integration
- Timeline compression
- Event filtering
- Pattern visualization charts
- Macro editor UI
- Branch merge conflict resolution

---

## Version History

**V3.0 (Enhanced)**
- ✅ Playback controls
- ✅ Persistence & auto-save
- ✅ Pattern analysis
- ✅ Event inspector
- ✅ Multi-cursor visualization
- ✅ Timeline branching
- ✅ Macro recording

**V2.0 (Modular)**
- Refactored to modular architecture
- ES6 modules
- Event-driven design

**V1.0 (Vanilla)**
- Single-file implementation
- Core temporal editing features

---

For more information, see:
- `README.md` - General overview
- `refactor.md` - Architecture details
- `temporal-editor-pitch.md` - Design philosophy
