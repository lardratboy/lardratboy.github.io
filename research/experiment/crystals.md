# Crystal Connections: Energy Cascade
## Game Design Document

---

## Overview

**Crystal Connections: Energy Cascade** is a 3D match-puzzle game and spiritual sequel to *Eight Neighbors*. Players match crystalline shapes on a dynamic grid, creating cascading energy reactions that charge powerful mega-crystals. The game combines strategic matching with physics-based column collapse mechanics.

**Genre**: 3D Puzzle, Match-3 Variant
**Platform**: Web (HTML5)
**Technology**: Three.js, Tween.js, Vanilla JavaScript

---

## Core Concept

Instead of simply clearing pieces, players create **energy cascades** that flow through the grid. Matching crystals explode and release energy pulses that charge nearby crystals and mega-crystals. The objective is to fully charge all mega-crystals on the board by creating strategic chain reactions.

---

## Game Elements

### Crystal Types (Shape Atlas)

Crystals are identified by their **3D shape**, with each shape having a unique color:

| Shape | Color | Hex Code | Geometry |
|-------|-------|----------|----------|
| **Sphere** | Cyan | `0x00ffff` | `SphereGeometry` (20 segments) |
| **Cube** | Magenta | `0xff00ff` | `BoxGeometry` |
| **Tetrahedron** | Yellow | `0xffff00` | `TetrahedronGeometry` |
| **Octahedron** | Green | `0x00ff00` | `OctahedronGeometry` |
| **Icosahedron** | Pink | `0xff0066` | `IcosahedronGeometry` |

**Design Principle**: Shape is the primary visual identifier for matching. Color enhances recognition but shape silhouette is what players should use to make quick decisions.

### Crystal Properties

```javascript
{
  geometry: THREE.Geometry,
  color: 0xRRGGBB,
  shapeType: String,
  energyLevel: 0-100,
  emissiveIntensity: 0.2-1.0  // Increases with energy
}
```

- **Base State**: Emissive intensity at 0.2, gently glowing
- **Energized State**: Emissive intensity increases to 0.8 when charged
- **Rotation**: All crystals rotate continuously (Spheres rotate less obviously)

### Mega-Crystals

**Visual Design**:
- Shape: Golden Icosahedron (20-sided)
- Material: Transparent with `opacity: 0.3` (base state)
- Rendering: `depthWrite: false` to avoid occluding crystals beneath
- Size: 1.5× larger than regular crystals
- Position: Hover 0.1 units above their base crystal

**Behavior**:
- **Translucent Ghost**: Start at 30% opacity, increase to 70% when fully charged
- **Color Shift**: Gold → Green as charge increases (HSL hue shift)
- **Magnetic Following**: Track underlying crystal position via animation loop
- **Charge Display**: Visual intensity reflects charge level (0-100)

**Charge Sources**:
1. Energy pulses from nearby cleared crystals (within 2 spaces)
2. Auto-charge when their column is completely cleared

**Victory Condition**: All mega-crystals fully charged (100/100)

---

## Core Mechanics

### 1. Matching System

**Match Detection**:
- **Eight-neighbor connectivity**: Crystals connect horizontally, vertically, and diagonally
- **Minimum group size**: 2 crystals (configurable by difficulty)
- **Match criteria**: Same `shapeType` (not just color)

**Algorithm**:
```javascript
findConnectedCrystals(row, col, targetType) {
  // Depth-first search with 8-directional neighbors
  // Returns array of {row, col} positions
}
```

### 2. Energy Pulse System

When crystals are cleared, they release energy pulses:

**Pulse Priority**:
1. **Mega-Crystals First**: Within 2 Manhattan distance
   - +20 charge per pulse
   - Golden particle animation
2. **Adjacent Crystals**: All 8 neighbors
   - +10 energy per pulse
   - Color-matched particle animation

**Visual Representation**:
```javascript
class EnergyPulse {
  // Small glowing sphere (0.1 radius)
  // Animates from source → target (300ms)
  // Fades opacity from 1.0 → 0.0
  // Color matches target crystal
}
```

**Energy Flow**:
```
[Cleared Crystal] → (Energy Pulse) → [Mega-Crystal]
                  ↘ (Energy Pulse) → [Adjacent Crystal]
```

### 3. Combo System

**Combo Mechanics**:
- Each match within 2 seconds increases combo counter
- Score multiplier: `1.0 + (combo - 1) × 0.5`
- Visual feedback: Large pulsing display shows "Nx COMBO!"
- Combo breaks after 2 seconds of inactivity

**Example Scoring**:
```
Match 5 crystals = 50 base points
Combo 1: 50 × 1.0 = 50 pts
Combo 2: 50 × 1.5 = 75 pts
Combo 3: 50 × 2.0 = 100 pts
```

### 4. Gravity & Column Collapse

**Gravity Application**:
1. After crystals clear, empty spaces appear
2. Crystals above fall to fill gaps (bounce animation, 400ms)
3. Mega-crystals automatically follow their base crystal

**Column Collapse**:
1. Detect completely empty columns
2. Auto-charge any mega-crystals in cleared columns
3. Award +100 points per cleared column
4. Slide remaining columns together (smooth animation, 500ms)
5. Recenter camera to new board dimensions
6. Update all crystal/mega-crystal column indices

**Special Rule**: Mega-crystals in cleared columns count as fully charged and contribute to victory.

### 5. Camera & Positioning

**Adaptive Camera**:
```javascript
// Calculate distances for both dimensions
distH = (boardHeight / 2) / tan(FOV / 2)
distW = (boardWidth / 2) / (tan(FOV / 2) × aspect)

// Use maximum with padding
camera.position.z = max(distH, distW) × 1.3
```

**Design Goal**: Entire board always visible on any aspect ratio (mobile, tablet, desktop, ultrawide)

---

## Scoring System

| Action | Points |
|--------|--------|
| Clear crystal | 10 pts × count × combo multiplier |
| Clear column | 100 pts |
| Fully charge mega-crystal | 100 pts |
| Auto-charge mega (column clear) | 100 pts |

**Example Game**:
```
Clear 5 cubes (combo 1): 50 pts
Clear 3 spheres (combo 2): 45 pts
Clear 8 tetrahedrons (combo 3): 160 pts
Column collapse: 100 pts
Mega-crystal charged: 100 pts
Total: 455 pts
```

---

## Visual Design

### Color Palette

**Neon Cyberpunk Theme**:
- Primary: Cyan `#00ffff`
- Secondary: Magenta `#ff00ff`
- Accent: Yellow `#ffff00`
- Background: Deep space `#0a0a1a`
- Overlays: Dark purple `#1a0a2e`

### Lighting

**Three-Point Lighting Setup**:
1. **Ambient Light**: 0.3 intensity (soft fill)
2. **Point Light 1**: Cyan (10, 10, 10), intensity 1.0
3. **Point Light 2**: Magenta (-10, -10, 10), intensity 1.0

**Material Properties**:
- Shininess: 100 (high specular highlights)
- Specular: White `#ffffff`
- Emissive: Matches base color
- Emissive Intensity: Dynamic (0.2 → 1.0 based on energy)

### Animation States

**Crystal Animations**:
- **Pop In**: Scale 0.01 → 1.0, Elastic.Out easing, staggered by (row + col) × 30ms
- **Explosion**: Scale 1.0 → 2.0 → 0.01, Quadratic easing, 350ms total
- **Rotation**: Continuous slow rotation on X, Y, Z axes
- **Pulse**: Quick scale to 1.2× on energy absorption, 100ms

**Mega-Crystal Animations**:
- **Charge Pulse**: Scale 1.0 → 1.2 → 1.0, 150ms
- **Rotation**: 0.03 rad/frame on Y, 0.01 rad/frame on X
- **Opacity Shift**: 0.3 → 0.7 based on charge ratio
- **Color Shift**: HSL hue 0.15 → 0.21 (gold → green)

**Board Animations**:
- **Gravity**: Bounce.Out easing, 400ms
- **Column Slide**: Quadratic.Out easing, 500ms
- **Camera Reframe**: Instant repositioning after column collapse

---

## User Interface

### HUD Elements

**Top Bar**:
```
☰ Menu          [Nx COMBO!]          Score: 9999
```

- **Menu Button**: Return to splash screen
- **Combo Display**: Center-aligned, only visible during combo
- **Score**: Right-aligned, real-time updates

**Bottom Info Panel**:
```
Match shapes to create combos • Charge all mega-crystals to win!
```

### Settings

**Configurable Options**:
- **Grid Size**: 7×7, 9×9, 11×11
- **Difficulty**:
  - Easy: Min group 2
  - Normal: Min group 2
  - Hard: Min group 3

### Overlays

**Game Over**:
```
╔═══════════════════════╗
║  Energy Depleted!     ║
║  No more connections  ║
║  [Play Again]         ║
╚═══════════════════════╝
```

**Victory**:
```
╔═══════════════════════╗
║  Cascade Complete!    ║
║  All mega-crystals    ║
║  charged!             ║
║  [Next Level]         ║
╚═══════════════════════╝
```

---

## Technical Architecture

### Class Structure

```
CrystalConnections (Main Game)
├── Crystal
│   ├── geometry: THREE.Geometry
│   ├── material: MeshPhongMaterial
│   ├── mesh: THREE.Mesh
│   └── methods: popIn(), explode(), pulse(), rotate()
│
├── MegaCrystal
│   ├── chargeLevel: 0-100
│   ├── material: Transparent MeshPhongMaterial
│   └── methods: charge(), isFullyCharged(), collect()
│
└── EnergyPulse
    ├── Particle animation
    └── Callback on completion
```

### Game State

```javascript
{
  crystals: Crystal[][],        // 2D grid
  megaCrystals: MegaCrystal[],  // Array with {row, col, charged}
  gridSize: number,             // Dynamic (changes on column collapse)
  score: number,
  comboCount: number,
  isAnimating: boolean,
  gamePaused: boolean
}
```

### Core Loops

**Animation Loop** (60 FPS):
```javascript
animate() {
  // Update TWEEN animations
  // Rotate all crystals
  // Position mega-crystals above their crystals
  // Render scene
}
```

**Game Logic Flow**:
```
Click Crystal
  ↓
Find Connected Group
  ↓
Check Min Size → (fail) → Highlight and return
  ↓
Explode Crystals
  ↓
Send Energy Pulses
  ↓
Apply Gravity
  ↓
Remove Empty Columns
  ↓
Check Win/Lose Conditions
```

### Performance Considerations

**Optimization Strategies**:
1. **Single Material per Shape**: Reuse materials, only modify emissive intensity
2. **Geometry Instancing**: Share geometry across similar crystals
3. **Render Order**: Mega-crystals render last with transparency
4. **Animation Batching**: Use single tween update per frame
5. **Raycasting**: Only check crystal meshes, exclude mega-crystals from click detection

---

## Design Principles

### 1. Shape Over Color
Players identify matches by 3D shape silhouette, not color. This makes the game accessible to colorblind players while maintaining visual appeal.

### 2. Energy as Feedback
Every action generates visible energy flow. Players see:
- Where energy goes (pulses animate toward targets)
- What receives energy (crystals glow brighter)
- Progress toward victory (mega-crystals change opacity/color)

### 3. Physics-Based Feel
All movements use physics-inspired easing:
- Explosions: Quick expand, faster collapse
- Gravity: Bounce on landing
- Pulses: Quadratic motion curves

### 4. Strategic Depth
- Clear crystals near mega-crystals for maximum charging
- Build combos for higher scores
- Plan column collapses to auto-charge difficult mega-crystals
- Balance clearing for points vs. charging for victory

### 5. Always Visible
Camera positioning ensures no hidden pieces. Players never need to pan, zoom, or scroll. Board dynamically reframes as it shrinks.

---

## Future Enhancements

### Potential Features

**Power-Ups**:
- Energy Bomb: Sends pulses to all mega-crystals
- Shape Shifter: Change a crystal's shape
- Column Clear: Instantly clear a chosen column

**Progression**:
- Board templates (diamond, circle, cross shapes)
- Increasing mega-crystal counts per level
- Time-based challenges
- Score targets

**Visual Effects**:
- Particle systems for explosions
- Glow trails on energy pulses
- Screen shake on large combos
- Rainbow effect on victory

**Multiplayer**:
- Competitive: Race to charge mega-crystals
- Cooperative: Share a board, coordinate clears

---

## Accessibility

**Considerations**:
- Shape-based matching (colorblind friendly)
- High contrast ratios (neon on dark)
- Clear visual feedback on hover
- Touch and mouse support
- Scalable UI text
- No time pressure in default mode

---

## File Structure

```
research/experiment/
├── experiment.html          # Single-file game
└── crystals.md             # This design document
```

**Single File Architecture**:
- All HTML, CSS, JS in one file
- External dependencies: CDN (Three.js, Tween.js)
- Fully portable and self-contained
- No build process required

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-01-18 | Initial design document |

---

## Credits

**Inspiration**: Eight Neighbors (Fireworks Edition)
**Framework**: Three.js r128, Tween.js 18.6.4
**Design**: Neon cyberpunk aesthetic with energy flow mechanics
