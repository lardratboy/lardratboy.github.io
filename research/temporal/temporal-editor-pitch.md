# The Temporal Text Editor
## *When Time Becomes Editable*

### The Pitch in One Sentence

A text editor where you can scrub backwards through time, click anywhere to add concurrent edits at historical moments, and watch multiple "ghost writers" type simultaneously in a turn-based temporal performance.

---

## The Problem with Traditional Text Editors

Every text editor you've ever used treats text editing as **destructive state mutation**:
- Type "hello" → state becomes "hello"
- Delete "lo" → state becomes "hel"
- Type "p" → state becomes "help"

The history is gone. You get undo/redo, but it's a linear stack. You can't go back to the moment after you typed "hello" and add *additional* edits at that same moment. You can't watch the performance of your own typing. You can't insert new thoughts into past moments without erasing what came after.

**Text editors treat documents as final states. But what if we treated them as performances?**

---

## The Core Insight

What if every keystroke was an **immutable event in a timeline** rather than a state change?

```javascript
// Traditional Editor
state = "hello"  // The past is lost

// Temporal Editor
timeline = [
  { t: 0,   action: insert('h') },
  { t: 50,  action: insert('e') },
  { t: 100, action: insert('l') },
  { t: 150, action: insert('l') },
  { t: 200, action: insert('o') }
]
```

With events, you can:
- Scrub to any moment and see exactly what the text looked like
- Add NEW events at OLD timestamps
- Watch events play back in sequence
- Have multiple concurrent edits at the same moment

This is **event sourcing for text editing** - the document is derived from replaying the event timeline.

---

## How It Works

### The Three Modes

**LIVE Mode** (Green Indicator)
- Normal editing mode
- Every keystroke gets timestamp = now + small increment
- You're writing at the "present" moment
- Timeline extends forward

**SCRUBBED Mode** (Red Indicator)  
- You've dragged the timeline backwards
- Cursor is positioned at that historical moment
- Document shows what existed at that time
- Awaiting your next action...

**CONCURRENT Mode** (Red Indicator - Active)
- Activated when you type while scrubbed back
- Each new keystroke you make:
  1. Records action at current timeline position
  2. Calculates where your cursor should be after this action
  3. Jumps to NEXT existing event
  4. Rebuilds document (shows old AND new edits)
  5. Restores your cursor to where you're typing (not where historical events left it)
- Creates illusion of multiple people typing together
- Your cursor stays where you're actively editing
- Exits when timeline runs out of future events

### The Timeline Scrubber

A visual representation of time:
```
[0ms]────────[500ms]────────[1000ms]────────[1500ms]
  ▏           ▏  ▏            ▏▏▏            ▏
  │           │  │            │││            │
  │           │  └── Two      │││            └── Single event
  │           │      events   │└└── Three concurrent
  │           │      (concurrent)    events (yellow!)
  │           └── Single event
  └── First event

        [RED PLAYHEAD at 750ms]
```

- **Click or drag** to scrub through time
- **Green markers** = single events
- **Yellow markers** = concurrent events (multiple at same timestamp)
- **Red playhead** = current time position

### Cursor Teleportation

**The Problem:** Arrow keys record movement events that play back during concurrent editing, making it look messy.

**The Solution:** Click anywhere on the grid to teleport cursor without recording an event.

- **Click** = instant teleport (no timeline entry)
- **Arrow keys** = recorded movement (becomes part of history)

This lets you position concurrent edits anywhere without polluting the timeline with navigation.

### INSERT vs OVERWRITE Modes

Just like classic text editors (WordStar, DOS EDIT, vi):

**INSERT Mode** 📝 (Thin Line Cursor)
- Typing **shifts text to the right** to make room
- Backspace/Delete **shifts text to the left** to fill gaps
- Natural for writing prose
- Events record: `{ type: 'insert_char', insertMode: true }`

**OVERWRITE Mode** ⬜ (Block Cursor)
- Typing **replaces** whatever is at cursor position
- Backspace/Delete **clears** without shifting
- Natural for editing fixed-width data
- Events record: `{ type: 'insert_char', insertMode: false }`

The mode is **stored with each event**, so playback reproduces the exact behavior.

---

## The Magic of Concurrent Editing

Here's what makes this editor truly unique:

### Example: Creating Dual Narratives

**Step 1:** Type a sentence
```
Time: 0ms → 500ms
"The cat sat on the mat"
```

**Step 2:** Drag timeline back to 0ms

**Step 3:** Click on row 2 (teleport cursor)

**Step 4:** Type "Meanwhile underground"

**What Happens:**
- Types 'M' at timestamp 0ms
- Timeline jumps to next event (50ms - when 'e' in "The" was typed)
- Grid shows both: "T" on row 0, "M" on row 2
- Types 'e' at timestamp 50ms
- Timeline jumps to next event (100ms)
- Grid shows both: "Th" on row 0, "Me" on row 2
- And so on...

**Result:** Two sentences appear to type simultaneously, taking turns letter by letter:
```
Row 0: T h e   c a t   s a t   o n   t h e   m a t
Row 2: M e a n w h i l e   u n d e r g r o u n d
```

Like two invisible typewriters working in parallel, synchronized by the timeline!

### Why Turn-Based Instead of Real-Time?

**Real-time playback:**
```
User types "hello" over 1 second
Timeline plays back in real-time at 1x speed
User watches passively
```

**Turn-based advancement:**
```
User types character → sees next historical event → types again
User controls the pace
Each action reveals next piece of history
Creates dialog between present and past
```

Turn-based makes you an **active participant** in the temporal editing process, not a passive observer.

---

## Technical Architecture

### Data Model

```javascript
{
  timestamp: 450,              // When this event occurred
  action: {
    type: 'insert_char',       // What happened
    char: 'x',
    x: 5,                      // Grid position
    y: 2,
    insertMode: true           // Mode at time of action
  },
  cursorBefore: { x: 5, y: 2 } // Cursor before action
}
```

### State Derivation

The editor has **no persistent state** - only the event timeline exists:

```javascript
function getStateAtTime(timeline, targetTime) {
  grid = empty(80, 20)
  cursor = {x: 0, y: 0}
  
  for (event of timeline) {
    if (event.timestamp <= targetTime) {
      applyEvent(event, grid, cursor)
    }
  }
  
  return {grid, cursor}
}
```

Every time you scrub or type, the entire document is rebuilt from scratch by replaying events. This is:
- **Simple**: No state management bugs
- **Deterministic**: Same events = same result always
- **Inspectable**: Timeline IS the document
- **Time-travel friendly**: Just change replay endpoint

### Performance Characteristics

**Current Implementation:**
- Rebuilds entire state on every change
- O(n) where n = number of events up to current time
- Acceptable for <10,000 events (~5 minutes of typing)

**Optimization Strategies (Future):**
1. **Snapshotting**: Cache grid state every 1000ms
2. **Incremental replay**: Only replay from last snapshot
3. **Spatial indexing**: Group events by screen region
4. **Lazy evaluation**: Only compute visible cells

The simplicity of full replay is worth the performance trade-off for this experimental editor.

---

## Use Cases

### 1. **Experimental Writing / Digital Art**
Create the illusion of multiple authors writing simultaneously:
- Write a poem
- Scrub back to beginning
- Add annotations in margins at same timestamps
- Playback shows poem and annotations appearing together
- Export as animated GIF for social media

### 2. **Live Coding Performances**
Record yourself writing code, then:
- Scrub back to add comments concurrently
- Make it look like documentation wrote itself alongside code
- Export timeline as terminal recording (asciinema)
- Educational content that shows thought process

### 3. **Collaborative Fiction (Simulated)**
Simulate the "exquisite corpse" writing game:
- Person 1 writes beginning
- "Person 2" (you, scrubbed back) adds middle section concurrently
- "Person 3" adds ending
- All three narratives interleave when played back

### 4. **Temporal Debugging**
Record bug reproduction, then:
- Scrub to moment before bug
- Add logging/debugging text at those timestamps
- Replay shows what logs would have shown
- Understand state evolution without re-running

### 5. **Mechanical Poetry**
Treat the editor as an instrument:
- Type rhythmically at specific intervals
- Scrub back and add counter-rhythms
- Create visual/temporal polyrhythms of text
- Document as performance art piece

### 6. **Time-Travel Storytelling**
Write a story where:
- Future events are written first
- Past events added concurrently later
- Causality appears reversed in playback
- Narrative unfolds non-chronologically

---

## What Makes This Different

### vs. Traditional Text Editors
- **Traditional**: State-based, destructive edits
- **Temporal**: Event-based, additive history
- **Traditional**: Linear undo/redo
- **Temporal**: Non-linear time travel

### vs. Collaborative Editors (Google Docs)
- **Collaborative**: Real-time sync, conflict resolution
- **Temporal**: Async by design, no conflicts (spatial separation)
- **Collaborative**: Multiple human users
- **Temporal**: One user, multiple temporal positions

### vs. Version Control (Git)
- **Git**: Explicit commits, branching, merging
- **Temporal**: Implicit commits (every keystroke), concurrent not branching
- **Git**: Code-focused, file-level
- **Temporal**: Character-level, temporal-focused

### vs. Replay Systems (Asciinema)
- **Replay**: Record → watch passively
- **Temporal**: Record → scrub → edit → participate
- **Replay**: Linear playback
- **Temporal**: Interactive time manipulation

---

## Design Principles

### 1. **Time is a Material**
Just as traditional editors let you move the cursor in space (left/right/up/down), this editor lets you move in **time** (backward/forward through history). Time becomes as manipulable as space.

### 2. **Events Over States**
The document is not a grid of characters. The document is a **timeline of actions**. The grid is just a view derived from replaying those actions.

### 3. **Additive, Not Destructive**
You never erase history. When you scrub back and type, you're **adding to** the timeline, not replacing it. Multiple truths can coexist at the same moment.

### 4. **Performance as Document**
The final text is just one artifact. The **timeline itself** - the recording of how it was created - is equally important. The act of creation becomes the creation.

### 5. **Turn-Based Interaction**
Time doesn't flow continuously during concurrent editing. It advances **one event per user action**, creating a dialog between present and past rather than passive playback.

---

## Visual Design Choices

### Retro Terminal Aesthetic
- Green text on black background
- Monospaced Courier New font
- Fixed 80x20 grid (classic terminal dimensions)
- Scanline-style presentation

**Why?** The editor is about **viewing text through time**, like watching old terminal sessions. The retro aesthetic reinforces the temporal archaeology feeling.

### Cursor Modes
- **INSERT**: Thin 2px line (like classic terminal cursor)
- **OVERWRITE**: Semi-transparent block covering character width
- **Visual distinction** makes mode immediately obvious

### Timeline Colors
- **Green markers**: Standard events
- **Yellow markers**: Concurrent events (exciting! multiple things happening!)
- **Red playhead**: Current position in time
- **Grab/Grabbing cursor**: Feels like scrubbing video

### Mode Indicators
- **LIVE** (green): Normal editing
- **SCRUBBED** (red): Time-traveled to past
- **CONCURRENT** (red): Actively adding concurrent events
- Color-coding creates immediate awareness of temporal state

---

## Limitations & Trade-offs

### Not Suitable For...

**1. Large Documents**
- Rebuilding state on every change doesn't scale past ~10k events
- No virtual scrolling or viewport optimization
- Fixed 80x20 grid is tiny by modern standards

**2. Traditional Prose Editing**
- No word wrap, line breaks, paragraphs
- Grid-based means characters stay in cells
- Better for code, ASCII art, structured data

**3. Production Work**
- This is an experimental/artistic tool
- No file save/load (timeline exists only in memory)
- No export beyond screen recording

**4. Real Collaboration**
- Simulates multiple authors, doesn't support actual multi-user
- Would need network sync and conflict resolution for real collab

### Cognitive Load
**The Hard Part:** Thinking in temporal dimensions is not natural.

Users must understand:
- Current time vs. max time
- LIVE vs. SCRUBBED modes
- Concurrent editing creates interleaved playback
- Cursor teleportation vs. recorded movement

**Mitigation:**
- Clear mode indicators
- Status bar always shows time and mode
- Instructions at top explain key concepts
- Console logging for debugging actions

---

## Future Directions

### 1. **Multi-Cursor Visualization**
Show all concurrent cursor positions:
```javascript
// At timestamp 500ms, display:
cursor1 at (5, 0)  // Original timeline
cursor2 at (10, 5) // Concurrent edit 1
cursor3 at (2, 8)  // Concurrent edit 2
```
Semi-transparent ghost cursors show where other "writers" are.

### 2. **Timeline Branching**
Allow explicit branches:
```
main:   ──A──B──C──D
         \
alt:      X──Y──Z
```
Switch between timelines, merge them, compare them.

### 3. **Playback Speed Control**
- 0.5x: Slow motion replay
- 1x: Real-time replay
- 2x: Fast forward
- Variable speed during drag scrubbing

### 4. **Export Formats**

**Animated GIF:**
```javascript
export_to_gif(timeline, {
  fps: 10,
  width: 640,
  height: 400,
  loop: true
})
```

**Terminal Recording:**
```javascript
export_to_asciinema(timeline)
// Generates .cast file for asciinema player
```

**Video:**
```javascript
export_to_mp4(timeline, {
  resolution: '1080p',
  codec: 'h264'
})
```

**Event Log:**
```javascript
export_to_json(timeline)
// Raw event data for analysis/replay
```

### 5. **Event Filters**
View timeline subsets:
- Only character insertions (hide deletions/movements)
- Only events in specific region (show row 0-5 events)
- Only INSERT mode actions
- Only concurrent events

### 6. **Pattern Analysis**
Analyze typing patterns:
```javascript
{
  avgTypingSpeed: 4.2,  // chars per second
  burstiness: 0.7,      // how irregular is timing
  corrections: 15,      // backspace count
  concurrentClusters: 3 // groups of concurrent edits
}
```

### 7. **Macro Recording**
Group actions into replayable macros:
```javascript
{
  type: 'macro',
  name: 'insert_header',
  events: [
    { type: 'insert_char', char: '=', ... },
    { type: 'insert_char', char: '=', ... },
    // ... more events
  ]
}
```
Play back complex edit sequences as single timeline entry.

### 8. **Real Collaboration**
Connect multiple users to shared timeline:
- Each user has unique timestamp offset
- Events merge in real-time
- Already designed for concurrency!
- WebSocket sync + CRDT conflict resolution

### 9. **Audio Integration**
Record audio while typing:
```javascript
{
  timestamp: 450,
  action: { type: 'insert_char', ... },
  audio: AudioBuffer(450ms → 500ms)
}
```
Play back typing sounds synchronized with events.

### 10. **Time Compression**
Automatically remove "dead time":
```javascript
// Original timeline
[0, 50, 100, 5000, 5050, 5100] // 5 second gap!

// Compressed timeline  
[0, 50, 100, 200, 250, 300]    // Gap removed
```
Makes playback smoother by eliminating pauses.

---

## The Philosophy

### Text as Performance

Traditional writing tools treat text as **product**:
- You type
- You edit
- You export final result
- Process is discarded

This editor treats text as **performance**:
- The typing IS the art
- The timeline IS the document
- The process IS the product
- Final state is just one view

Like watching a painter work vs. seeing finished painting. The brushstrokes matter.

### Temporal Multiplicity

In most editors, you are **one person at one time**.

In this editor, you can be **multiple temporal instances of yourself**, all editing the same document at overlapping moments.

It's not time travel in the "change the past" sense. It's time travel in the "add to the past" sense. The past becomes richer, not replaced.

### Additive History

Most undo systems are **destructive**:
```
State 1 → State 2 → State 3
         ↓ undo
State 1 → State 2 → State 4  (State 3 erased!)
```

This editor is **additive**:
```
Timeline: [Event1, Event2, Event3]
Add new edit at time of Event2
Timeline: [Event1, Event2, Event3, Event2.5]
         ↓ sort
Timeline: [Event1, Event2, Event2.5, Event3]
```

Nothing is destroyed. The past just gets more detailed.

### The Editor as Time Machine

This isn't a text editor that happens to have time-travel features.

This is a **time machine** that happens to edit text.

The core mechanic is temporal navigation. Text editing is the domain we've applied it to, but the pattern could work for:
- Image editing (concurrent brush strokes)
- Music sequencing (concurrent note placement)
- Code refactoring (concurrent fixes)
- 3D modeling (concurrent vertex edits)

Any creative act that unfolds over time could benefit from temporal editing.

---

## Technical Implementation Details

### Character Dimensions
- Font: Courier New, 16px
- Line height: 20px
- Character width: ~9.6px (measured dynamically)
- Grid: 80 columns × 20 rows
- Cursor offset: 2px vertical + 10px padding

### Event Types

**insert_char**
```javascript
{
  type: 'insert_char',
  char: 'x',
  x: 5,
  y: 2,
  insertMode: true  // or false
}
```

**delete_char**
```javascript
{
  type: 'delete_char',
  x: 5,
  y: 2,
  moveCursor: false  // for Delete key vs Backspace
}
```

**delete_and_shift**
```javascript
{
  type: 'delete_and_shift',
  x: 5,
  y: 2,
  moveCursor: true   // Backspace moves, Delete doesn't
}
```

**cursor_move**
```javascript
{
  type: 'cursor_move',
  dx: 1,   // -1 for left, +1 for right
  dy: 0    // -1 for up, +1 for down
}
```

### Execution Logic

**INSERT mode - insert_char:**
```javascript
// Shift everything right from position x
for (i = cols-1; i > x; i--) {
  grid[y][i] = grid[y][i-1]
}
grid[y][x] = char
```

**INSERT mode - delete_and_shift:**
```javascript
// Shift everything left from position x
for (i = x; i < cols-1; i++) {
  grid[y][i] = grid[y][i+1]
}
grid[y][cols-1] = ' '
```

**OVERWRITE mode:**
```javascript
// Simple replacement
grid[y][x] = char  // or ' ' for delete
```

---

## Why This Matters

### 1. **New Creative Possibilities**
This editor enables creations that are **impossible** in traditional editors:
- Text that appears to write itself from multiple sources
- Temporal polyrhythms of characters
- Causality-violating narratives
- Performance art pieces

### 2. **Rethinking Tools**
We've been editing text the same way for 50+ years. What if the foundational model was wrong?

**What we learned:**
- Event sourcing scales down (not just for distributed systems)
- Time-travel is intuitive for creative work (filmmakers scrub constantly)
- Concurrent editing works without conflict resolution (spatial separation)
- Turn-based > real-time for human-timeline interaction

### 3. **Research Platform**
This editor is a **probe** - a way to ask:
- How do people think about time in their creative process?
- What happens when history is editable?
- Can temporal mechanics create new art forms?
- What other domains need temporal editing?

### 4. **Aesthetic Experience**
Watching text type itself is oddly mesmerizing. The editor is:
- A visualization of thought
- A choreography of keystrokes  
- A archaeological dig through typing history
- A performance instrument

The experience of using it is unlike any other editor.

---

## Critical Reception (Hypothetical)

**"It's completely impractical and I love it."**  
— Hypothetical HackerNews commenter

**"I spent 3 hours making ASCII art where past-me and future-me collaborated. I regret nothing."**  
— Beta tester

**"This is what happens when you take event sourcing too seriously."**  
— Database architect

**"As an art piece exploring temporality in digital media, it succeeds brilliantly. As a text editor, it's delightfully terrible."**  
— Digital art critic

**"I showed it to my students to demonstrate event-driven architecture. They made memes instead. A++"**  
— Computer science professor

**"Undo/redo will never be the same after this."**  
— UX designer

---

## Open Questions

### 1. **What's the Maximum Useful Complexity?**
- How many concurrent timelines can users track mentally?
- At what point does the timeline become noise instead of signal?
- Is there a "sweet spot" for temporal editing complexity?

### 2. **Can This Scale?**
- What if we added snapshotting and viewport culling?
- Could it handle 100,000 events? 1,000,000?
- Would it still feel like "temporal editing" at scale?

### 3. **Should Events Be Editable?**
Currently events are immutable. But what if:
- You could delete events from timeline
- You could edit event timestamps
- You could modify event properties

Would this add power or destroy the core metaphor?

### 4. **What About Branching?**
Concurrent editing is "horizontal" (same time, different space).  
Timeline branching would be "vertical" (different timelines altogether).

Do we need both? Or is concurrent editing enough?

### 5. **Who Is This For?**
- Writers? (probably not - too constrained)
- Programmers? (maybe - for demos/education)
- Artists? (yes - digital performance art)
- Educators? (yes - showing thought process)
- Researchers? (yes - studying creative process)

---

## Conclusion

The Temporal Text Editor is:

✅ **Technically interesting** - Event sourcing, time-travel, concurrent editing  
✅ **Conceptually novel** - New paradigm for thinking about editing  
✅ **Aesthetically unique** - Retro terminal meets time machine  
✅ **Practically limited** - Not for real work  
✅ **Creatively enabling** - Opens new artistic possibilities  

It's not meant to replace VS Code or Google Docs.

It's meant to make you **think differently** about:
- What text editors could be
- How time works in creative tools
- What "editing" means
- How performance and product relate

**This editor asks:** *What if we could edit when things happen, not just what happens?*

The answer turns out to be strange, beautiful, impractical, and thought-provoking.

Exactly as it should be.

---

## Try It Yourself

**Basic Workflow:**
1. Type "HELLO WORLD"
2. Drag timeline to beginning
3. Click on row 5
4. Type "GOODBYE MOON"
5. Watch them type in alternating turns

**Advanced Experiment:**
1. Switch to OVERWRITE mode (block cursor)
2. Type a line of text
3. Switch to INSERT mode (thin cursor)  
4. Scrub back to middle
5. Click on same row, offset by 10 chars
6. Type new text - watch original shift right!
7. Delete text - watch it shift left!

**Temporal Poetry:**
1. Write haiku on row 0
2. Scrub to beginning
3. Add annotations on row 2 at same timestamps
4. Play back - poem and commentary appear together

**The Mind-Bender:**
1. Type "EFFECT" on row 0
2. Scrub to beginning
3. Type "CAUSE" on row 5
4. Causality appears backwards in playback

---

**Documentation Version:** 2.0  
**Last Updated:** 2025-11-18  
**Status:** Experimental / Art Project / Time-Travel Research  
**License:** MIT (or "Do What Thou Wilt")  
**Warning:** May cause temporal confusion, creative enlightenment, or both  

**Repository:** [Your temporal journey begins here]  
**Demo:** [Experience time as a material]  
**Paper:** "Temporal Editing: When History Becomes Malleable" (forthcoming)

---

*"The future is just the past that hasn't happened yet, unless you scrub the timeline back and make them happen concurrently, in which case time is just a suggestion and text editing becomes jazz."*

— Design philosophy, probably

---

## Appendix: Comparison Matrix

| Feature | Traditional Editor | Git | Google Docs | Temporal Editor |
|---------|-------------------|-----|-------------|-----------------|
| Time Model | Linear undo stack | Branching history | No history | Scrubable timeline |
| Collaboration | None | Async merge | Real-time sync | Temporal simulation |
| State Management | Current state only | Snapshots (commits) | Operational transform | Event sourcing |
| Time Travel | Limited (undo/redo) | Yes (checkout) | No | Full (scrubbing) |
| Concurrent Edits | No | Merge conflicts | Yes | Yes (temporal) |
| History Visibility | Hidden | Explicit (log) | No access | Visual timeline |
| Performance | Instant | Depends on repo | Network latency | Replay cost |
| Use Case | Daily work | Version control | Collaboration | Experimentation |
| Learning Curve | Easy | Moderate | Easy | Steep |
| Fun Factor | Low | Medium | Low | **MAXIMUM** |

---

*End of Design Document*

*Now go forth and edit time itself.*
