# Game Design Document: Cube Corner Match-3

**Version:** 1.0  
**Date:** November 2024  
**Status:** Concept & Prototype Phase

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current Implementation Status](#current-implementation-status)
3. [Game Concept](#game-concept)
4. [Core Gameplay Loop](#core-gameplay-loop)
5. [Unique Mechanics](#unique-mechanics)
6. [Game Modes](#game-modes)
7. [Progression Systems](#progression-systems)
8. [Scoring & Rewards](#scoring--rewards)
9. [Visual Design](#visual-design)
10. [Audio Design](#audio-design)
11. [User Interface](#user-interface)
12. [Controls & Interaction](#controls--interaction)
13. [Difficulty Progression](#difficulty-progression)
14. [Power-Ups & Special Pieces](#power-ups--special-pieces)
15. [Tutorial & Onboarding](#tutorial--onboarding)
16. [Accessibility](#accessibility)
17. [Target Audience](#target-audience)
18. [Competitive Analysis](#competitive-analysis)
19. [Technical Requirements](#technical-requirements)
20. [Monetization Strategy](#monetization-strategy)
21. [Future Features](#future-features)

---

## 1. Executive Summary

### High Concept
**"Match-3 meets spatial reasoning in a gravity-defying 3D corner puzzle"**

Cube Corner is an innovative match-3 puzzle game that reimagines the genre through 3D spatial mechanics. Players manipulate pieces across three interconnected boards that share a physical corner in 3D space, creating a cascade of strategic depth as pieces flow between walls and floor with multi-directional gravity.

### Key Differentiators
- **3D Topology**: Three boards meeting at a corner, not a flat grid
- **Dual Gravity Systems**: Walls fall down; floor falls down AND left
- **Shared Space**: One board receives input from two perpendicular sources
- **Cascade Complexity**: Actions on one board affect two others
- **Spatial Thinking**: Players must visualize 3D piece flow and predict multi-board cascades

### Target Platforms
- Web (Primary): HTML5/WebGL
- Mobile: iOS/Android
- Desktop: Windows/Mac/Linux (Electron or native)

### Development Status
- ✅ Core concept validated
- ✅ Prototype functional
- ⏳ Game design document (current)
- ⬜ Production build
- ⬜ Content creation
- ⬜ Polish & balance
- ⬜ Release

---

## 2. Current Implementation Status

**Last Updated:** November 2024
**Prototype Version:** 0.2 (Swap Mechanics)

### What's Currently Implemented ✅

**Core Gameplay:**
- ✅ 10×10 board with three sections (Red wall, Green wall, Blue floor)
- ✅ 5×5 unused gray section (bottom-right corner)
- ✅ **Swap-based mechanics** (click to select, click another to swap)
- ✅ Match-3 detection (horizontal and vertical)
- ✅ Optional diagonal matching (toggle in UI)
- ✅ Gravity system with multi-directional flow
- ✅ Cascade detection and chain reactions
- ✅ Basic scoring system
- ✅ 5 colors (red, green, blue, yellow, magenta)

**Visual & UI:**
- ✅ 3D rendering with Three.js
- ✅ Camera positioning for corner view
- ✅ Minimap showing grid layout
- ✅ Score display
- ✅ Move feedback (selection highlight)
- ✅ Responsive design (portrait/landscape support)

**Technical:**
- ✅ HTML5/WebGL implementation
- ✅ Mouse interaction (click-based)
- ✅ Animation system (swap, fall, clear)
- ✅ Window resize handling

### What's NOT Yet Implemented ⬜

**Gameplay Features:**
- ⬜ Piece spawning/dropping mechanic (original design concept)
- ⬜ Move limits
- ⬜ Level objectives
- ⬜ Special pieces (Bomb, Lightning, Rainbow, Cascade Star)
- ⬜ Power-ups
- ⬜ Tutorial system
- ⬜ Multiple game modes

**Content:**
- ⬜ Story mode (100 levels)
- ⬜ Endless mode
- ⬜ Puzzle mode
- ⬜ Daily challenges
- ⬜ Boss levels

**Systems:**
- ⬜ Progression system
- ⬜ Achievement system
- ⬜ Collection/unlocks
- ⬜ Monetization
- ⬜ Leaderboards
- ⬜ Save/load system

**Polish:**
- ⬜ Audio (music & SFX)
- ⬜ Particle effects
- ⬜ Advanced animations
- ⬜ Themes/skins
- ⬜ Accessibility features

### Design Evolution Notes

**Important: Core Mechanic Change**

The current prototype implements a **swap-based match-3** mechanic (similar to Bejeweled):
- Players click a cube to select it
- Click another cube to swap positions
- Swaps trigger gravity and match detection
- All three boards can be manipulated

The original design document (sections below) describes a **drop-based spawning** mechanic (similar to Dr. Mario):
- Players choose which wall to spawn pieces on
- Pieces drop down columns
- Gravity transfers pieces between boards

**Both mechanics work with the 3D corner topology.** The current implementation chose swapping for:
1. Easier prototyping and iteration
2. More strategic control for players
3. Familiar mechanic for testing the unique 3D space

Future development may:
- Keep swap mechanics and refine them further
- Implement drop mechanics as originally designed
- Offer both as different game modes

### How to Use This Document

The sections below describe the **complete vision** for the game, not just what's currently built. Consider:
- **Sections 3-20**: Full design vision (aspirational)
- **Section 2**: Current reality (what's playable now)
- Implementation should reference both for context

---

## 3. Game Concept (Full Vision)

**Note:** This section and those following describe the complete design vision. See Section 2 for current implementation status.

### Vision Statement
Create a puzzle game that challenges players to think in three dimensions while maintaining the accessible satisfaction of match-3 gameplay. Every move should feel strategic, every cascade should feel earned, and the spatial relationship between boards should create emergent complexity.

### Core Fantasy
**"Mastering the flow of a gravitational corner"**

Players become architects of cascades, learning to predict and manipulate how pieces flow through a 3D space. The satisfaction comes from:
- Understanding the unique topology
- Planning multi-board combos
- Creating massive chain reactions
- Achieving perfect piece placement
- Mastering spatial reasoning

### Inspiration & References

**Puzzle Mechanics:**
- **Tetris**: Gravity-based piece management
- **Dr. Mario**: Multi-column gravity and color matching
- **Puyo Puyo**: Chain reaction focus
- **Bejeweled**: Match-3 accessibility

**Spatial Innovation:**
- **Portal**: 3D spatial reasoning
- **Monument Valley**: Impossible geometry
- **Echochrome**: Perspective-based puzzles
- **Fez**: 2D/3D dimension shifting

**Unique Twist:**
Our game combines match-3 familiarity with genuine 3D spatial challenges, creating a new subgenre: **"Spatial Match-3"**

---

## 3. Core Gameplay Loop

### Moment-to-Moment Loop (5-10 seconds)
```
1. Assess board states → 
2. Choose wall to spawn piece → 
3. Select column for placement → 
4. Watch gravity resolve → 
5. Observe cascades → 
6. Matches clear → 
7. New cascades trigger → 
8. Repeat
```

### Short Session Loop (2-5 minutes)
```
1. Start level with clear objective
2. Make strategic placements
3. Build toward big combo
4. Execute cascade chain
5. Complete objective
6. Receive rewards
7. Progress to next level
```

### Long Session Loop (15-60 minutes)
```
1. Play through world/chapter
2. Unlock new mechanics
3. Face increasing difficulty
4. Master new patterns
5. Complete world boss challenge
6. Unlock next world
7. Upgrade abilities/unlock skins
```

### Meta Loop (Days/Weeks)
```
1. Daily challenges
2. Event participation
3. Leaderboard competition
4. Collection completion
5. Mastery achievements
6. Community engagement
```

---

## 4. Unique Mechanics

### 4.1 Three-Board Topology

**The Corner:**
- Three 5×5 boards forming interior corner of a cube
- Red Wall (back), Green Wall (right), Blue Floor (bottom)
- All meet at shared corner point
- Pieces flow between boards via edge connections

**Why It Works:**
- Creates spatial puzzle within familiar match-3 framework
- Forces 3D thinking in 2D interface
- Generates emergent complexity from simple rules
- Enables multi-board strategies

### 4.2 Directional Gravity

**Wall Gravity (Red & Green):**
- Pieces fall straight down within each wall
- Simple, predictable, easy to learn
- Bottom row is "exit zone" to floor

**Floor Gravity (Blue):**
- Pieces fall DOWN (from Red inputs)
- Pieces fall LEFT (from Green inputs)
- Dual gravity creates bottom-left "well"
- Most complex board, highest strategic value

**Strategic Implications:**
- Walls are "queuing zones" for floor
- Floor is "mixing zone" for both walls
- Corner cell (bottom-left floor) is critical choke point
- Players must manage piece flow like traffic

### 4.3 Iterative Packing

**Physics Resolution:**
All gravity resolves completely before player can act again:
```
1. Both walls pack down
2. Red transfers to floor columns
3. Green transfers to floor rows  
4. Floor packs down then left
5. Repeat until stable
6. Check for matches
7. Remove matches
8. Repeat gravity
9. Continue until no matches
```

**Why It Matters:**
- Creates satisfying "settling" animation
- Cascades feel organic and earned
- Players can predict outcomes with practice
- Prevents chaotic/unpredictable behavior

### 4.4 Match Detection

**Rules:**
- 3+ consecutive pieces of same color
- Horizontal OR vertical only (no diagonals)
- Each board checked independently
- All boards can match simultaneously

**Strategic Depth:**
- Matches on walls create space for new pieces
- Matches on floor create space for wall transfers
- Clearing walls feeds more pieces to floor
- Clearing floor prevents choking
- Multi-board matches = massive combos

### 4.5 Cascade System

**Chain Reactions:**
```
Match → Clear → Gravity → New pieces fall → 
New configuration → New match → Repeat
```

**Multi-Board Cascades:**
- Clear Red wall → pieces fall → transfer to floor
- Floor matches → spaces open → Green transfers
- Green wall → pieces fall → transfer to floor
- Floor matches again → massive combo
- Can create 5+ chain reactions

**Combo Rewards:**
- 3-match: 30 points
- 4-match: 100 points
- 5-match: 300 points
- 2-chain: 2× multiplier
- 3-chain: 3× multiplier
- 4-chain: 5× multiplier
- 5+ chain: 10× multiplier

---

## 5. Game Modes

### 5.1 Story Mode (Primary Mode)

**Structure:**
- 5 Worlds × 20 Levels = 100 levels
- Each world introduces new mechanics
- Progressive difficulty curve
- Boss levels every 20 stages

**Objectives Variety:**
- **Score Attack**: Reach target score in moves/time
- **Clear Colors**: Remove all pieces of specific color
- **Cascade Challenge**: Achieve X-chain combo
- **Speed Run**: Clear board in time limit
- **Perfect Clear**: Empty all three boards
- **Limited Moves**: Complete objective in N moves
- **Survival**: Prevent board overflow for duration

**World Themes:**
1. **Tutorial Cube**: Basic mechanics (5 colors, simple patterns)
2. **Cascade Canyon**: Focus on chain reactions
3. **Gravity Gardens**: Dual gravity mastery
4. **Chromatic Chambers**: Color management
5. **Infinity Corner**: Master challenges

**Progression Gating:**
- Linear progression through levels
- Optional side objectives for 3-star rating
- Unlock next world by completing previous
- Optional: Non-linear world map with branching paths

### 5.2 Endless Mode

**Mechanics:**
- Continuous piece spawning
- Increasing difficulty (faster spawns, more colors)
- Survive as long as possible
- Game over when any board overflows

**Scoring:**
- Points for matches
- Multiplier for chains
- Bonus for board clears
- Time survival bonus

**Leaderboards:**
- Global high scores
- Friend rankings
- Weekly challenges
- Regional leaderboards

### 5.3 Puzzle Mode

**Design:**
- Hand-crafted puzzle scenarios
- Specific board configurations
- Single-solution challenges
- "Chess problems" of match-3

**Examples:**
- Clear entire board in 5 moves
- Create 8-chain cascade
- Match specific pattern
- Navigate impossible situation

**Content:**
- 50+ curated puzzles at launch
- Weekly puzzle challenges
- Community puzzle creator (future)

### 5.4 Daily Challenges

**Structure:**
- New challenge every 24 hours
- Same puzzle for all players
- Leaderboard competition
- Rewards for participation

**Variations:**
- Score attack with set seed
- Specific objective completion
- Speed run challenges
- Perfect execution tests

### 5.5 Multiplayer (Future)

**Competitive:**
- 1v1 racing (first to objective wins)
- Battle mode (send garbage to opponent)
- Time attack (best score in 2 minutes)

**Cooperative:**
- Shared board (players alternate)
- Team challenges (combined score)
- Versus AI boss fights

---

## 6. Progression Systems

### 6.1 Level Progression

**Unlock System:**
```
Level 1 → Level 2 → Level 3 → ... → Level 20 → Boss
  ↓         ↓         ↓                  ↓         ↓
 ⭐       ⭐⭐      ⭐⭐⭐          World 2    Next
                                                  World
```

**Star Ratings:**
- ⭐ Complete level (unlock next)
- ⭐⭐ Complete with bonus objective
- ⭐⭐⭐ Complete with perfect score

**Rewards:**
- Coins (in-game currency)
- Unlock cosmetics
- Power-up currency
- Achievement progress

### 6.2 Difficulty Curve

**Early Game (Levels 1-20):**
- 3-4 colors only
- Simple match requirements
- Generous move limits
- Slow piece spawning
- Focus: Learning topology

**Mid Game (Levels 21-60):**
- 5 colors
- Complex objectives
- Moderate move limits
- Introduce special pieces
- Focus: Strategic planning

**Late Game (Levels 61-80):**
- 5 colors + special pieces
- Multi-stage objectives
- Tight move limits
- Fast piece spawning
- Focus: Optimization

**End Game (Levels 81-100):**
- All mechanics active
- Perfect execution required
- Creative solutions needed
- Focus: Mastery

### 6.3 Skill Progression

**Beginner (0-10 hours):**
- Learn basic matching
- Understand gravity
- Recognize simple cascades
- Basic wall/floor relationship

**Intermediate (10-30 hours):**
- Plan 2-3 moves ahead
- Create intentional cascades
- Manage multiple boards
- Use special pieces

**Advanced (30-60 hours):**
- Plan 5+ moves ahead
- Create complex cascades
- Optimize board states
- Master corner control

**Expert (60+ hours):**
- Perfect puzzle solutions
- Maximum cascade chains
- Speed run optimization
- Community leader

### 6.4 Collection & Achievements

**Achievements:**
- **Discovery**: First 5-match, first 10-chain, etc.
- **Mastery**: Perfect all levels, max score on X levels
- **Challenge**: Complete without power-ups, win with 1 move remaining
- **Collection**: Try all themes, unlock all skins
- **Social**: Beat friend's score, reach leaderboard top 100

**Collections:**
- Board Themes (visual skins)
- Piece Styles (shape variants)
- Color Palettes (accessibility + style)
- Particle Effects (cascade animations)
- Music Tracks (background ambiance)

---

## 7. Scoring & Rewards

### 7.1 Base Scoring

**Match Points:**
```
3-match:   30 points  (10 per piece)
4-match:  100 points  (25 per piece)
5-match:  300 points  (60 per piece)
6-match:  600 points  (100 per piece)
7-match: 1000 points  (142 per piece)
```

**Match Bonuses:**
- **Multi-board Match**: +50% (matches on 2+ boards same turn)
- **Speed Bonus**: +25% (match within 3 seconds of last)
- **Perfect Column**: +100 (entire column single color match)
- **Corner Clear**: +200 (clear bottom-left corner piece)

### 7.2 Combo System

**Chain Multipliers:**
```
1-chain: 1× (no bonus)
2-chain: 2×
3-chain: 3×
4-chain: 5×
5-chain: 10×
6-chain: 15×
7-chain: 25×
8+ chain: 50×
```

**Example Calculation:**
```
Turn 1: 3-match = 30 points
  ↓ Cascade
Turn 2: 4-match = 100 × 2 (2-chain) = 200 points
  ↓ Cascade
Turn 3: 3-match = 30 × 3 (3-chain) = 90 points
  ↓ Cascade
Turn 4: 5-match = 300 × 5 (4-chain) = 1,500 points

Total: 1,820 points from one move!
```

### 7.3 Move Efficiency

**Move Bonuses:**
- Complete with 10+ moves remaining: +1,000
- Complete with 5-9 moves remaining: +500
- Complete with 1-4 moves remaining: +100
- Complete with 0 moves: +0

**Perfect Clear Bonus:**
- Empty all three boards: +5,000
- (Rare achievement, extremely difficult)

### 7.4 Currency System

**Coins (Soft Currency):**
- Earned through gameplay
- Level completion: 10-100 coins
- Daily login: 50 coins
- Achievements: 100-1,000 coins
- Used for cosmetics & continues

**Gems (Premium Currency):**
- Purchased with real money
- Daily challenge rewards: 1-5 gems
- Used for power-ups & special unlocks
- Optional, not required for progression

### 7.5 Reward Schedule

**Per Level:**
- Coins (scaled to difficulty)
- XP toward player level
- Star rating (1-3)
- First-time bonus (2× coins)

**Per World:**
- Unlock next world
- Cosmetic unlock
- Achievement progress
- Special reward (theme/skin)

**Daily:**
- Login bonus (coins)
- Daily challenge (coins + gems)
- Streak rewards (increasing value)

---

## 8. Visual Design

### 8.1 Art Style

**Overall Aesthetic:**
- **Modern Minimalist**: Clean lines, clear shapes
- **3D Depth**: Subtle shadows and perspective
- **Vibrant Colors**: High contrast, colorblind-friendly
- **Satisfying Animations**: Smooth, responsive, juicy

**Visual Hierarchy:**
```
Most Important:
1. Pieces (largest, most colorful)
2. Board edges (clear boundaries)
3. Match indicators (highlight feedback)
4. UI elements (score, moves)
5. Background (subtle, non-distracting)
```

### 8.2 Board Design

**The Corner Visualization:**

**Option A: Side-by-Side (2D Layout)**
- Three boards displayed flat
- Clear labels (Red, Green, Blue)
- Visual arrows showing connections
- Best for mobile/smaller screens

**Option B: 3D Isometric**
- Boards rendered in 3D space
- Rotatable camera view
- True spatial representation
- Best for desktop/tablet

**Option C: Hybrid**
- Default: 2D side-by-side
- Toggle: 3D view for visualization
- Tutorial: Animated 3D transitions

**Board Appearance:**
- **Background**: Translucent glass with subtle grid
- **Cells**: Defined by thin borders, slight inset
- **Empty Cells**: Low opacity, minimal detail
- **Occupied Cells**: Bright, high-contrast pieces

### 8.3 Piece Design

**Basic Pieces:**
- **Shape**: Rounded squares with beveled edges
- **Size**: Fill ~80% of cell
- **Material**: Glossy with gradient
- **Depth**: Subtle 3D appearance via shading

**Color Palette (Default):**
1. **Red**: #FF6B6B (warm, energetic)
2. **Green**: #51CF66 (fresh, balanced)
3. **Blue**: #4DABF7 (cool, calming)
4. **Yellow**: #FFD43B (bright, attention)
5. **Purple**: #DA77F2 (mystical, contrasting)

**Accessibility Palettes:**
- Deuteranopia (red-green)
- Protanopia (red-green variant)
- Tritanopia (blue-yellow)
- Monochrome (pattern-based)

**Visual States:**
- **Idle**: Gentle breathing animation
- **Falling**: Motion blur + trail
- **Landing**: Squash & stretch
- **Matched**: Pulse & glow
- **Clearing**: Particle explosion

### 8.4 Special Pieces (Future)

**Bomb:**
- Black sphere with glowing core
- Clears surrounding 3×3 area
- Created by 4-match

**Lightning:**
- Electric blue with arcing bolts
- Clears entire row/column
- Created by 5-match

**Rainbow:**
- Prismatic, shifting colors
- Matches with any color
- Created by 6-match

**Cascade Star:**
- Glowing white star
- Triggers multi-board clear
- Created by 8+ chain

### 8.5 Visual Feedback

**Match Detection:**
- Matched pieces: Outline glow
- Animation: Pulse for 0.3s
- Sound: Satisfying chime
- Particle: Small sparkles

**Cascade:**
- Chain counter: Large number
- Rising animation with multiplier
- Color: Scales with chain length
- Sound: Pitch increases with chain

**Perfect Move:**
- Screen flash
- Particle burst
- Slow-motion moment
- Special sound effect

**Board States:**
- **Warning**: Red pulse when near full
- **Clear**: Green glow when empty
- **Active**: Highlight board receiving pieces

### 8.6 UI Visual Design

**Menu System:**
- Card-based layout
- Smooth transitions
- Clear hierarchy
- Touch/click targets: 44px minimum

**HUD (In-Game):**
- Top: Score, Moves Remaining
- Side: Level Objective
- Bottom: Power-up buttons (if available)
- Minimal, non-intrusive
- Fade when inactive

**Themes:**
- Default: Dark gradient background
- Unlockables: 
  - Cosmic space
  - Underwater
  - Crystal cave
  - Abstract geometry
  - Nature/garden

---

## 9. Audio Design

### 9.1 Music

**Layered Adaptive System:**
- **Base Layer**: Ambient pad, always playing
- **Rhythm Layer**: Adds when pieces drop
- **Melody Layer**: Intensifies with cascades
- **Climax Layer**: Full mix during big combos

**Mood Progression:**
- **Menus**: Calm, inviting
- **Early Levels**: Light, playful
- **Mid Levels**: Focused, rhythmic
- **Late Levels**: Intense, driving
- **Boss Levels**: Epic, dramatic

**Track Length:**
- 2-3 minute loops
- Seamless transitions
- No jarring cuts
- Fade system for mode changes

### 9.2 Sound Effects

**Piece Actions:**
- **Spawn**: Soft "pop"
- **Drop**: Descending whoosh
- **Land**: Satisfying "thunk"
- **Slide**: Smooth swoosh (floor horizontal)

**Match Sounds:**
- **3-match**: Pleasant chime (C major chord)
- **4-match**: Richer chime + harmony
- **5-match**: Powerful resonance
- **6+ match**: Explosive crescendo

**Cascade Feedback:**
- **Chain Counter**: Rising pitch per chain
- **Multiplier**: Layered harmonics
- **Final Clear**: Resolution chord

**UI Sounds:**
- **Button Click**: Crisp tap
- **Menu Slide**: Smooth whoosh
- **Star Earned**: Magical twinkle
- **Level Complete**: Victory fanfare
- **Game Over**: Descending tone (not punishing)

### 9.3 Spatial Audio (Future)

**3D Sound Positioning:**
- Pieces on left wall → left speaker
- Pieces on right wall → right speaker
- Pieces on floor → center/front
- Creates spatial awareness through audio

### 9.4 Accessibility

**Audio Settings:**
- Master volume
- Music volume (separate)
- SFX volume (separate)
- Mute option
- Audio presets: 
  - Balanced
  - Music focus
  - SFX focus
  - Quiet (minimal audio)

---

## 10. User Interface

### 10.1 Main Menu

**Layout:**
```
┌─────────────────────────────┐
│   CUBE CORNER MATCH-3       │
│         [Logo]              │
│                             │
│    [▶ PLAY STORY]          │
│    [∞ ENDLESS MODE]        │
│    [🧩 PUZZLE MODE]        │
│    [🏆 DAILY CHALLENGE]    │
│                             │
│  [Settings] [Collection]   │
└─────────────────────────────┘
```

**Features:**
- Clean, uncluttered
- Large touch targets
- Current player stats visible
- Daily challenge notification
- Settings accessible

### 10.2 Level Select

**World Map:**
```
World 1: Tutorial Cube
[1] → [2] → [3] → ... → [20] → [BOSS]
 ⭐    ⭐⭐   ⭐⭐⭐        🔒      🔒

[Level Details]
- Level 3: "Cascade Training"
- Objective: Create a 3-chain combo
- Best Score: 1,250 ⭐⭐⭐
- [Play] [Practice]
```

**Information Shown:**
- Level number & name
- Star rating (0-3)
- Best score
- Objective preview
- Locked/unlocked status

### 10.3 In-Game HUD

**Layout:**
```
┌─────────────────────────────┐
│ Score: 1,250    Moves: 12   │
│                             │
│   [Red]  [Green]  [Blue]    │
│   [Wall] [Wall]   [Floor]   │
│                             │
│ Objective: Score 2,000      │
│ Progress: [▓▓▓▓▓░░░] 62%   │
└─────────────────────────────┘
```

**Elements:**
- Score (top-left)
- Moves remaining (top-right)
- Board displays (center)
- Objective tracker (bottom)
- Pause button (top-corner)
- Power-up buttons (side, if available)

### 10.4 Results Screen

**Post-Level:**
```
┌─────────────────────────────┐
│      LEVEL COMPLETE!        │
│          ⭐⭐⭐            │
│                             │
│  Score:      3,450          │
│  Best Chain: 5×             │
│  Moves Left: 8              │
│                             │
│  Rewards:                   │
│  + 150 coins                │
│  + Unlocked: Blue Theme     │
│                             │
│  [Next Level] [Replay]      │
└─────────────────────────────┘
```

**Elements:**
- Star rating (animated reveal)
- Final statistics
- Personal bests (if beaten)
- Rewards earned
- Navigation options

### 10.5 Settings Menu

**Categories:**

**Display:**
- 2D/3D view toggle
- Animation speed
- Particle density
- Colorblind modes

**Audio:**
- Master volume
- Music volume
- SFX volume
- Mute all

**Gameplay:**
- Tutorial hints (on/off)
- Auto-gravity (on/off)
- Confirm moves (on/off)
- Input speed (for mobile)

**Account:**
- Player name
- Statistics
- Achievements
- Cloud save sync

### 10.6 Mobile Considerations

**Touch Optimization:**
- Minimum 44×44px touch targets
- Swipe gestures for board rotation
- Long-press for piece info
- Pinch-to-zoom (3D view)

**Responsive Layout:**
- Portrait: Vertical stack of boards
- Landscape: Side-by-side boards
- Tablet: Hybrid view options

**Performance:**
- Reduce particles on low-end devices
- Simplified shadows
- Lower poly models
- Frame rate targeting (30fps minimum)

---

## 11. Controls & Interaction

### 11.1 PC/Desktop Controls

**Mouse:**
- **Click empty cell**: Drop piece in that column
- **Click board name**: Select which wall to spawn on
- **Drag**: Rotate 3D view (if enabled)
- **Scroll**: Zoom in/out (3D view)

**Keyboard:**
- **1, 2, 3**: Select Red, Green, or inspect Blue
- **Arrow Keys**: Highlight column to drop
- **Space/Enter**: Drop piece in highlighted column
- **G**: Apply gravity manually (if enabled)
- **Esc**: Pause menu
- **R**: Restart level
- **Tab**: Cycle between boards

**Shortcuts (Advanced):**
- **Ctrl+Z**: Undo last move (if available)
- **Ctrl+R**: Restart level
- **H**: Hint (if available)

### 11.2 Mobile/Touch Controls

**Primary Interaction:**
- **Tap board**: Select wall (Red/Green)
- **Tap column**: Drop piece in that column
- **Swipe on board**: Quick column select + drop

**3D View (Optional):**
- **One-finger drag**: Rotate view
- **Pinch**: Zoom
- **Two-finger tap**: Reset view

**Gestures:**
- **Long-press piece**: Show info/hint
- **Swipe up on HUD**: Hide/show UI
- **Pull down**: Pause menu

### 11.3 Gamepad Support (Future)

**Button Mapping:**
- **D-pad/Stick**: Navigate columns
- **A/Cross**: Drop piece
- **B/Circle**: Cancel/Back
- **X/Square**: Change wall
- **Y/Triangle**: Rotate 3D view
- **Bumpers**: Cycle between boards
- **Triggers**: Quick drop
- **Start**: Pause
- **Select**: Settings

### 11.4 Interaction Feedback

**Visual:**
- Column highlight on hover
- Preview piece at top of column
- Drop trajectory line (optional)
- Piece glow when selected

**Audio:**
- Hover sound
- Click sound
- Invalid action sound
- Confirmation sound

**Haptic (Mobile):**
- Light buzz on touch
- Medium buzz on piece drop
- Strong buzz on match
- Intense buzz on cascade

---

## 12. Difficulty Progression

### 12.1 Difficulty Variables

**Core Adjustments:**
1. **Colors**: 3 (easy) → 5 (hard)
2. **Board Size**: 5×5 (fixed for topology)
3. **Move Limit**: 50 (easy) → 15 (hard)
4. **Score Target**: Low → High
5. **Starting Pieces**: Empty → Pre-filled
6. **Spawn Rate**: Slow → Fast (Endless mode)

### 12.2 Level Pacing

**Tutorial (Levels 1-5):**
- 3 colors only
- Simple objectives (Score 500)
- 40-50 moves
- Empty starting boards
- On-screen hints
- No time pressure

**Early Game (Levels 6-20):**
- 4 colors
- Score targets + specific clears
- 30-40 moves
- Few pre-filled pieces
- Optional hints
- Introduce basic strategies

**Mid Game (Levels 21-60):**
- 5 colors
- Complex objectives (Multi-board clears)
- 20-30 moves
- Moderate pre-filled boards
- Combo requirements
- Strategic thinking required

**Late Game (Levels 61-80):**
- 5 colors + special pieces
- Advanced objectives (Perfect clears)
- 15-25 moves
- Heavily pre-filled boards
- High combo requirements
- Optimal play required

**End Game (Levels 81-100):**
- All mechanics
- Expert objectives
- 10-20 moves
- Complex starting configurations
- Perfect execution required
- Puzzle-like precision

### 12.3 Difficulty Curves

**Smooth Curve:**
```
Level 1  ●
Level 10  ●──●
Level 20    ●─●  [Boss]
Level 30       ●─●
Level 40         ●─●
Level 50           ●──●
Level 60             ●──●
Level 80                ●─●
Level 100                 ●● [Final Boss]
```

**Challenge Spikes:**
- Boss levels (20, 40, 60, 80, 100)
- Introduce new mechanic levels
- "Mastery check" levels

### 12.4 Dynamic Difficulty (Optional)

**Adaptive System:**
- Track player performance
- If failing repeatedly (3+ attempts):
  - Reduce spawn rate
  - Add +2 moves
  - Reduce score target by 10%
  - Offer power-up
- If succeeding easily:
  - Suggest challenge mode
  - Unlock hard mode variant

**Player Choice:**
- Easy Mode: +50% moves, -30% score target
- Normal Mode: Standard difficulty
- Hard Mode: -20% moves, +50% score target
- Expert Mode: No power-ups, perfect execution

---

## 13. Power-Ups & Special Pieces

### 13.1 Power-Up Philosophy

**Design Goals:**
- Optional, not required
- Strategic tools, not crutches
- Limited use to maintain challenge
- Earned through gameplay OR purchased

### 13.2 Pre-Game Power-Ups

**Hammer (Earned/Purchased):**
- Destroy any single piece
- Use before or during level
- Cost: 100 coins or 1 gem
- Strategic: Remove blocking pieces

**Color Filter (Earned/Purchased):**
- Start level with one fewer color
- Use before level starts
- Cost: 150 coins or 2 gems
- Strategic: Easier matching

**Extra Moves (Earned/Purchased):**
- Start with +5 moves
- Use before level starts
- Cost: 50 coins or 1 gem
- Strategic: More room for error

### 13.3 In-Game Power-Ups

**Gravity Boost (Earned):**
- Instantly resolve all gravity
- Trigger all cascades immediately
- Use during level (limited uses)
- Free: Given at level start

**Board Clear (Rare):**
- Remove all pieces of one color
- Use during level
- Earned: 5-chain combo OR purchased (500 coins)
- Strategic: Reset board state

**Shuffle (Rescue):**
- Rearrange all pieces
- Only available when no moves left
- Free once per level, then 100 coins
- Strategic: Escape impossible situations

### 13.4 Special Pieces (Created In-Game)

**Bomb (4-Match):**
- Match 4 pieces → Create bomb
- Activate: Match bomb with its color
- Effect: Destroy 3×3 area around it
- Can chain with other specials

**Lightning (5-Match):**
- Match 5 in a line → Create lightning
- Activate: Match with its color
- Effect: Clear entire row AND column
- Creates cross-shaped clear

**Rainbow Piece (L or T Shape):**
- Match 5 in L or T formation
- Activate: Match with ANY color
- Effect: Clear all pieces of that color
- Most powerful regular special

**Cascade Star (8+ Chain):**
- Create via 8+ cascade chain
- Activate: Automatically on creation
- Effect: Multi-board wave clear
- Extremely rare and powerful

### 13.5 Special Piece Combos

**Bomb + Bomb:**
- Creates larger 5×5 explosion
- Destroys two areas

**Bomb + Lightning:**
- Lightning expands to 3× width
- Massive row/column clear

**Lightning + Lightning:**
- Clears entire board (rare)
- Ultimate clear move

**Rainbow + Bomb:**
- All pieces of matched color become bombs
- Chain explosion effect

**Rainbow + Lightning:**
- All pieces of matched color become lightning
- Cross-pattern across entire board

**Rainbow + Rainbow:**
- Clear entire board on all three surfaces
- Rarest combo, massive points

---

## 14. Tutorial & Onboarding

### 14.1 First-Time Experience

**Opening Sequence (30 seconds):**
```
1. Logo splash
2. Brief 3D animation of corner forming
3. Tagline: "Think in 3D. Match in Space."
4. Main menu appears
```

**New Player Prompt:**
```
"Welcome! Would you like to:"
[Play Tutorial] [Skip to Game]

Recommendation: Tutorial teaches unique mechanics
```

### 14.2 Interactive Tutorial

**Level 1: Basic Matching**
```
Objective: Make your first 3-match

1. "Welcome to Cube Corner!"
2. "This is the Red Wall" [Highlight Red board]
3. "Click a column to drop a piece" [Highlight column]
4. [Player drops piece]
5. "Pieces fall down" [Animate gravity]
6. "Match 3 of the same color!" [Show example]
7. [Player makes match]
8. "Great job! Matches disappear" [Clear animation]
```

**Level 2: The Corner**
```
Objective: Understand the 3D topology

1. "Three boards meet at a corner"
2. [Show 3D animation of corner]
3. "This is the Red Wall (back)" [Highlight]
4. "This is the Green Wall (right)" [Highlight]
5. "This is the Blue Floor (bottom)" [Highlight]
6. "They all connect at this corner" [Highlight corner]
```

**Level 3: Wall to Floor**
```
Objective: Transfer pieces from Red to Floor

1. "Pieces on walls can fall to the floor"
2. "Red Wall column" [Highlight col 2] "falls to"
3. "Blue Floor column" [Highlight col 2]
4. [Demonstrate with animated piece]
5. "Try it! Drop a piece on Red Wall column 2"
6. [Player drops]
7. [Piece falls through to floor]
8. "See how it moved to the floor?"
```

**Level 4: Green Wall Connection**
```
Objective: Transfer from Green to Floor rows

1. "Green Wall connects differently"
2. "Green Wall column" [Highlight] "falls to"
3. "Blue Floor row" [Highlight]
4. "Green column 0 → Blue row 0"
5. "Green column 4 → Blue row 4"
6. [Demonstrate]
7. "Your turn! Create a match on the floor"
```

**Level 5: Cascades**
```
Objective: Create your first cascade

1. "When matches disappear, pieces fall"
2. "This can create NEW matches!"
3. "This is called a CASCADE"
4. [Show example cascade animation]
5. "Cascades give bonus points!"
6. "Try to create a 2-chain cascade"
7. [Player creates cascade]
8. "Perfect! You're ready to play!"
```

### 14.3 Progressive Teaching

**Just-In-Time Tutorials:**
- First 4-match: "You created a Bomb!"
- First 5-match: "Lightning piece clears lines!"
- First cascade: "Chain multiplier explanation"
- First multi-board match: "Bonus points!"
- First board full warning: "Make matches to create space"

**Tutorial Hints (Toggle-able):**
- Arrow indicators for best moves
- Highlight of possible matches
- Warning for dangerous situations
- Suggestion bubbles
- Can be disabled in settings

### 14.4 Help System

**In-Game Help:**
- "?" button accessible anytime
- Context-sensitive tips
- Video demonstrations
- Practice mode (no pressure)

**Reference Guide:**
- How to play (basic rules)
- Scoring breakdown
- Special pieces guide
- Strategy tips
- FAQ

---

## 15. Accessibility

### 15.1 Visual Accessibility

**Colorblind Modes:**
- **Deuteranopia**: Red → Orange, Green → Cyan
- **Protanopia**: Red → Brown, Green → Blue
- **Tritanopia**: Blue → Pink, Yellow → Red
- **Achromatopsia**: Pattern-based (shapes + textures)

**High Contrast Mode:**
- Increased piece borders
- Stronger board outlines
- Darker/lighter backgrounds
- Larger text

**Visual Options:**
- Text size: 80% - 150%
- UI scale: 80% - 120%
- Animation speed: 0.5× - 2×
- Particle effects: Off, Low, Medium, High
- Screen shake: Off/On

### 15.2 Auditory Accessibility

**Audio Settings:**
- Individual volume controls
- Mono audio option (for single-ear users)
- Subtitles for audio cues
- Visual alternatives for sound

**Visual Sound Cues:**
- Match: Screen flash
- Cascade: Number display
- Warning: Pulsing border
- Victory: Confetti animation

### 15.3 Motor Accessibility

**Input Options:**
- Mouse-only play
- Keyboard-only play
- Gamepad support
- Touch accessibility

**Timing Options:**
- No time limits in Story mode
- Pause anytime
- Undo moves (limited)
- Auto-gravity (pieces drop automatically)

**Simplified Controls:**
- One-button mode (cycle + confirm)
- Large touch targets (55×55px option)
- Reduced swipe sensitivity
- Sticky cursor (assist mode)

### 15.4 Cognitive Accessibility

**Difficulty Options:**
- Tutorial always available
- Practice mode (no failure)
- Reduced complexity mode (fewer colors)
- Extended move timers
- Step-by-step hints

**UI Simplification:**
- Reduced visual clutter
- Clear objective display
- Color-coded feedback
- Consistent layouts

**Save Options:**
- Autosave every move
- Quick save/load
- Level skip (after multiple failures)
- Resume from any point

### 15.5 Text & Localization

**Text Accessibility:**
- Dyslexic-friendly fonts (OpenDyslexic option)
- Adjustable text size
- High contrast text
- Icons + text labels

**Localization:**
- Launch: English, Spanish, French, German, Japanese
- Planned: Chinese, Korean, Portuguese, Italian, Russian
- Text expansion buffer (30% space)
- Cultural color considerations

---

## 16. Target Audience

### 16.1 Primary Audience

**Demographic:**
- **Age**: 18-45 years old
- **Gender**: All (slight female skew expected)
- **Geography**: Global (mobile-first countries priority)
- **Income**: $30k-$80k (F2P with optional purchases)

**Psychographics:**
- Puzzle game enthusiasts
- Casual gamers with strategic interest
- Mobile gamers seeking depth
- Fans of match-3 evolution
- Players who enjoy spatial reasoning

### 16.2 Player Archetypes

**The Casual Achiever (40%):**
- Plays during commute/breaks
- Completes levels casually
- Enjoys progression
- Occasional spender
- Session: 5-15 minutes

**The Puzzle Master (30%):**
- Seeks challenging puzzles
- Optimizes scores
- Studies mechanics
- Completes achievements
- Session: 20-60 minutes

**The Competitor (20%):**
- Focused on leaderboards
- Daily challenge devotee
- Compares with friends
- Regular spender
- Session: Variable (peaks)

**The Collector (10%):**
- Loves unlocking content
- Aesthetic customization
- Achievement hunting
- Moderate spender
- Session: 10-30 minutes

### 16.3 Experience Levels

**Puzzle Game Experience:**
- **High** (50%): Played match-3 before, wants innovation
- **Medium** (35%): Familiar with basics, needs gentle curve
- **Low** (15%): New to genre, needs strong tutorial

**3D Spatial Reasoning:**
- **High** (20%): Engineers, architects, gamers
- **Medium** (50%): Average spatial skills
- **Low** (30%): Needs visual aids and practice

### 16.4 Platform Preferences

**Primary Platforms:**
- **Mobile** (60%): iOS/Android
- **Web** (30%): Browser casual play
- **Desktop** (10%): Steam/Epic wishlisters

**Session Expectations:**
- **Mobile**: Short sessions (5-15 min)
- **Web**: Medium sessions (15-30 min)
- **Desktop**: Long sessions (30-90 min)

---

## 17. Competitive Analysis

### 17.1 Direct Competitors

**Candy Crush Saga:**
- **Strengths**: Brand recognition, large player base, polished
- **Weaknesses**: Stale mechanics, aggressive monetization
- **Differentiator**: We offer true innovation (3D topology)

**Bejeweled:**
- **Strengths**: Classic gameplay, accessible, solid mechanics
- **Weaknesses**: Dated, no innovation, shrinking audience
- **Differentiator**: We modernize with spatial complexity

**Two Dots:**
- **Strengths**: Minimalist design, unique connection mechanic
- **Weaknesses**: Limited depth, narrow audience
- **Differentiator**: We offer more strategic depth

### 17.2 Indirect Competitors

**Monument Valley:**
- **Strengths**: Stunning visuals, innovative 3D puzzles
- **Weaknesses**: Short, premium price, no replayability
- **Comparison**: We combine their spatial innovation with match-3 accessibility

**Tetris:**
- **Strengths**: Timeless, pure gameplay, universal appeal
- **Weaknesses**: No modern evolution, repetitive
- **Comparison**: We modernize falling-block mechanics with 3D corner topology

**Portal (Puzzle Mechanics):**
- **Strengths**: Mind-bending 3D spatial challenges
- **Weaknesses**: Core-gamer focused, high barrier
- **Comparison**: We distill spatial reasoning into casual-friendly match-3

### 17.3 Market Gap

**Opportunity:**
The market lacks a match-3 game with genuine spatial innovation. Most "3D match-3" games are just 2D games with 3D graphics. We offer actual 3D topology that changes gameplay fundamentally.

**Unique Position:**
"The thinking person's match-3" - bridges casual accessibility and strategic depth through spatial mechanics.

---

## 18. Technical Requirements

### 18.1 Minimum Specifications

**Web (HTML5):**
- Browser: Chrome 90+, Firefox 88+, Safari 14+
- RAM: 2GB
- GPU: WebGL 2.0 support
- Connection: Not required (after initial load)

**Mobile:**
- iOS: iPhone 8+ (iOS 13+)
- Android: Android 8.0+ (2GB RAM)
- Storage: 100MB (with assets)

**Desktop:**
- OS: Windows 10, macOS 10.14, Linux (Ubuntu 20.04)
- RAM: 4GB
- GPU: Integrated graphics (Intel HD 4000+)
- Storage: 150MB

### 18.2 Technology Stack

**Core Engine:**
- **Web**: Vanilla JavaScript (ES6+) / Three.js for 3D
- **Mobile**: Native (Swift/Kotlin) OR React Native
- **Desktop**: Electron OR native (C++/Rust)

**Rendering:**
- 2D Canvas / WebGL for web
- Metal (iOS) / Vulkan (Android)
- OpenGL 3.3+ for desktop

**Audio:**
- Web Audio API
- Native audio engines (mobile)
- OpenAL (desktop)

**Save System:**
- LocalStorage (web)
- Core Data (iOS) / SQLite (Android)
- Cloud sync via backend API

### 18.3 Performance Targets

**Frame Rate:**
- 60 FPS (target)
- 30 FPS (minimum acceptable)
- Adaptive quality scaling

**Load Times:**
- Initial load: <3 seconds
- Level load: <1 second
- Asset streaming in background

**Memory:**
- Peak usage: <512MB (mobile)
- Peak usage: <1GB (desktop)
- Texture streaming for memory management

### 18.4 Online Features

**Required:**
- Leaderboards (daily, weekly, all-time)
- Daily challenges
- Cloud save sync
- Achievement tracking

**Optional:**
- Social features (friend challenges)
- Replays (share best solutions)
- User-generated content (puzzle creator)
- Live events

### 18.5 Analytics & Telemetry

**Tracked Metrics:**
- Level completion rates
- Average attempts per level
- Session length and frequency
- Cascade chain distribution
- Power-up usage rates
- Tutorial completion rate
- Monetization conversion
- Retention (D1, D7, D30)

**Privacy:**
- Anonymized data
- GDPR compliant
- COPPA compliant (no players under 13)
- Opt-out available

---

## 19. Monetization Strategy

### 19.1 Business Model

**Free-to-Play with Optional Purchases**
- Core game: Free, fully playable
- No paywalls blocking content
- No "energy" system
- No forced ads

**Philosophy:**
"Respect player time and money. Offer value, not manipulation."

### 19.2 Revenue Streams

**1. Cosmetic Purchases (Primary):**
- Board themes: $0.99 - $2.99
- Piece skins: $0.99 - $1.99
- Color palettes: $0.99
- Particle effects: $1.99
- Music packs: $1.99
- Bundles: $4.99 - $9.99

**2. Power-Up Packs (Secondary):**
- Small pack (5 uses): $0.99
- Medium pack (15 uses): $1.99
- Large pack (50 uses): $4.99
- Monthly subscription (unlimited): $2.99/month

**3. Remove Ads (One-Time):**
- $4.99 removes all ads permanently
- Includes bonus: Exclusive theme

**4. Premium Currency (Optional):**
- Gems purchasable with real money
- $0.99 = 100 gems
- $4.99 = 600 gems (+20% bonus)
- $9.99 = 1,400 gems (+40% bonus)

### 19.3 Earning Without Paying

**Free Power-Ups:**
- 1 free hint per level
- Earn power-ups via level completion
- Daily login rewards
- Achievement rewards

**Free Cosmetics:**
- Unlock themes via world completion
- Earn pieces skins through achievements
- Special event rewards
- Daily challenge prizes

### 19.4 Ethical Monetization

**What We DON'T Do:**
- ❌ No pay-to-win mechanics
- ❌ No loot boxes / gacha
- ❌ No energy/timer systems
- ❌ No forced ads between levels
- ❌ No predatory dark patterns

**What We DO:**
- ✅ Transparent pricing
- ✅ Cosmetic focus
- ✅ Fair free experience
- ✅ Generous rewards
- ✅ Respect player time

### 19.5 Advertisement Strategy

**Opt-In Ads (Only):**
- Watch ad → Earn power-up
- Watch ad → Earn coins
- Watch ad → Revive failed level
- Player chooses when to watch

**Ad Frequency:**
- Maximum 1 per 10 minutes
- Never interrupt gameplay
- Always skippable after 5 seconds
- Mute option available

**Ad-Free Option:**
- $4.99 permanent removal
- OR subscribe ($2.99/month)

### 19.6 Revenue Projections (Hypothetical)

**Conservative Estimates:**
- 10,000 DAU (Daily Active Users)
- 3% conversion rate (purchasers)
- $2 ARPU (Average Revenue Per User)
- 5% ad engagement rate

**Projected Monthly Revenue:**
- Cosmetics: 300 purchases × $2 = $600
- Power-ups: 200 purchases × $2 = $400
- Ads: 10,000 DAU × 5% × $0.01 = $5/day = $150/month
- **Total**: ~$1,150/month (10k DAU)

**Scaling:**
- 100k DAU → $11,500/month
- 1M DAU → $115,000/month

*(Note: Actual performance varies widely)*

---

## 20. Future Features

### 20.1 Post-Launch Roadmap

**Month 1-3:**
- Bug fixes and balance
- Additional levels (World 6)
- Quality-of-life improvements
- Performance optimization

**Month 4-6:**
- Multiplayer mode (async)
- Puzzle creator tool
- New special pieces
- Seasonal events

**Month 7-12:**
- Ranked competitive mode
- Live tournaments
- Major content expansion (Worlds 7-10)
- Advanced 3D visualization options

### 20.2 Potential Expansions

**New Board Topologies:**
- 4-board cube (add top wall)
- 7×7 boards (larger puzzle)
- Non-square grids (hexagonal)
- Multiple corners (complex 3D)

**New Game Modes:**
- **Versus Mode**: 1v1 racing
- **Co-op Mode**: Shared board
- **Battle Royale**: 100 players, last standing wins
- **Time Attack**: Speed-based challenges

**Special Pieces Expansion:**
- **Earthquake**: Shuffles entire board
- **Magnet**: Pulls pieces toward corner
- **Freeze**: Stops gravity temporarily
- **Portal**: Teleports pieces between boards

### 20.3 Community Features

**Social:**
- Friend system
- Guilds/Clans
- Gift exchange
- Challenge friends directly

**User-Generated Content:**
- Puzzle creator (share levels)
- Board themes (custom skins)
- Color palette creator
- Music remixes

**Competitive:**
- Global leaderboards
- Regional rankings
- Weekly tournaments
- Seasonal leagues (Bronze → Master)

### 20.4 Cross-Platform

**Cloud Save:**
- Play on phone, continue on PC
- Sync progress across devices
- Cross-platform purchases

**Platform-Specific:**
- Steam achievements
- iOS Game Center
- Google Play Games
- Discord Rich Presence

### 20.5 Experimental Ideas

**VR Mode:**
- Actually manipulate boards in 3D space
- Physical corner in virtual space
- Hand tracking for piece placement
- Immersive puzzle-solving

**AR Mode:**
- Project boards onto real surfaces
- Physical table becomes game board
- Multi-player AR battles

**AI Opponent:**
- Practice against AI
- Learn from AI solutions
- AI difficulty scaling
- Co-op with AI partner

**Procedural Generation:**
- Endless unique levels
- Dynamic difficulty adjustment
- Infinite puzzle mode
- Seed-based sharing

---

## Appendix

### A. Design Pillars

1. **Accessible Depth**: Easy to learn, hard to master
2. **Spatial Innovation**: Genuine 3D thinking in match-3
3. **Fair Monetization**: Respect players, earn trust
4. **Satisfying Feedback**: Juice, polish, "game feel"
5. **Strategic Variety**: Multiple valid approaches

### B. Success Metrics

**Player Engagement:**
- D1 retention: >40%
- D7 retention: >20%
- D30 retention: >10%
- Session length: 10-15 minutes average
- Sessions per day: 2-3

**Monetization:**
- Conversion rate: 3-5%
- ARPDAU: $0.10 - $0.30
- Lifetime value: $2 - $5

**Quality:**
- App store rating: >4.5 stars
- Review sentiment: >80% positive
- Bug rate: <0.1% crash rate
- Load time: <3 seconds

### C. Risk Assessment

**High Risk:**
- 3D topology too complex for casual audience
- **Mitigation**: Strong tutorial, 2D fallback mode

**Medium Risk:**
- Market saturation in match-3 genre
- **Mitigation**: Emphasize innovation, differentiate clearly

**Low Risk:**
- Technical performance on low-end devices
- **Mitigation**: Scalable graphics, performance testing

### D. Development Timeline

**Pre-Production (2 months):**
- Finalize design document
- Create detailed specifications
- Build core prototype
- Art style validation

**Production (6 months):**
- Core systems implementation
- Content creation (100 levels)
- Art asset production
- Audio implementation

**Alpha (1 month):**
- Internal testing
- Balance tuning
- Bug fixing
- Performance optimization

**Beta (2 months):**
- External testing (500-1000 players)
- Feedback integration
- Polish pass
- Localization

**Launch (1 month):**
- Marketing campaign
- Soft launch (select regions)
- Full release
- Post-launch support

**Total: 12 months from concept to launch**

---

## Document Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Nov 2024 | Design Team | Initial comprehensive design document |
| 1.1 | Nov 2024 | Claude Code | Added Section 2: Current Implementation Status to reconcile design vision with working prototype. Clarified swap-based mechanic vs. drop-based design. |

---

**END OF DOCUMENT**

---

## Notes for Implementation Team

This design document serves as the north star for development. Key priorities:

1. **Core Loop First**: Ensure basic match-3 + 3D topology feels good before adding features
2. **Tutorial is Critical**: Players must understand unique mechanics quickly
3. **Performance Matters**: 60fps on target hardware or gameplay suffers
4. **Juice Everything**: Animation, sound, feedback make or break feel
5. **Playtest Early**: 3D topology is novel—validate with real users ASAP

Questions or clarifications needed? Contact design lead.

**Next Steps:**
1. Technical design document (architecture, systems)
2. Art bible (detailed visual specifications)
3. Audio design document (music, SFX details)
4. Level design document (100 level specifications)
5. Monetization implementation plan
