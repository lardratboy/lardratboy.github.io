# Space Vortex - Arcade Shooter Design Document

## Overview
Space Vortex is a retro arcade-style shooter inspired by classics like 1942, Galaga, Glaxians, and Space Invaders. The game features complex enemy movement patterns using polar coordinates and circular motions, creating visually stunning attack formations.

## Technical Specifications

### Technology Stack
- **HTML5** for structure
- **THREE.js** for 3D graphics rendering
- **TWEEN.js** for smooth animations
- **Vanilla JavaScript** with ES6 classes
- Single HTML file architecture

### Camera Setup
- Position: `(0, 0, 15)`
- Look At: `(0, 0, 0)`
- Provides top-down view of the playfield
- Perspective camera for depth effects

## Game Mechanics

### Player
- **Position**: Bottom center of screen
- **Movement**: Horizontal only (left/right) using arrow keys or A/D
- **Shooting**: Space bar or click to fire projectiles upward
- **Speed**: Responsive movement with smooth acceleration
- **Lives**: 3 lives per game
- **Visual**: Distinctive ship design (wedge/triangle shape)

### Enemy System

#### Enemy Types
1. **Scout (Cyan)**
   - Health: 1 hit
   - Speed: Medium
   - Score: 10 points
   - Pattern: Simple swooping attacks

2. **Fighter (Magenta)**
   - Health: 2 hits
   - Speed: Fast
   - Score: 25 points
   - Pattern: Aggressive diving attacks

3. **Bomber (Yellow)**
   - Health: 3 hits
   - Speed: Slow
   - Score: 50 points
   - Pattern: Slow circular approach with heavy fire

4. **Elite (Green)**
   - Health: 4 hits
   - Speed: Variable
   - Score: 100 points
   - Pattern: Complex spiral attacks

#### Formation System
Enemies spawn in organized formations using polar coordinate patterns:
- **Circle Formation**: Enemies arranged in circular pattern
- **Spiral Formation**: Enemies in expanding/contracting spiral
- **Wave Formation**: Synchronized sine wave patterns
- **V Formation**: Classic V-shape attack pattern

#### Movement Patterns (Polar Coordinates)
All enemy movements use polar coordinate transformations:

```javascript
// Basic circular motion
x = radius * cos(angle + time)
y = radius * sin(angle + time)

// Spiral motion
radius = baseRadius + spiralRate * time
x = radius * cos(angle + angularVelocity * time)
y = radius * sin(angle + angularVelocity * time)

// Lissajous curves
x = A * sin(a * time + delta)
y = B * sin(b * time)

// Epitrochoid patterns
x = (R + r) * cos(t) - d * cos((R + r) / r * t)
y = (R + r) * sin(t) - d * sin((R + r) / r * t)
```

### Sortie Attack System
Enemies in formation will periodically break off to attack in "sorties":
1. Enemy detaches from formation
2. Follows attack pattern (dive, spiral, or sweep)
3. Fires projectiles at player
4. Returns to formation or exits screen

### Projectile System

#### Player Projectiles
- **Visual**: Bright white/cyan energy bolts
- **Speed**: Fast, travels upward
- **Damage**: 1 hit point
- **Rate of Fire**: 5 shots per second maximum

#### Enemy Projectiles
- **Visual**: Colored to match enemy type
- **Speed**: Medium, travels toward player
- **Patterns**:
  - Single shot
  - Spread shot (3-way)
  - Aimed shot (targets player position)
  - Spiral pattern

### Collision Detection
- Player ship vs enemy projectiles → lose life
- Player projectiles vs enemies → damage enemy
- Player ship vs enemies → lose life, enemy destroyed
- Efficient raycasting for hit detection

### Scoring System
- Enemy destruction points based on type
- Combo multiplier for consecutive hits (1.5x, 2x, 2.5x, 3x max)
- Wave completion bonus
- Perfect wave bonus (no lives lost)

### Wave System
Progressive difficulty through waves:
- **Wave 1-3**: Introduction, simple patterns
- **Wave 4-7**: Mixed enemy types, faster spawns
- **Wave 8-12**: Complex formations, aggressive attacks
- **Wave 13+**: Maximum difficulty, all patterns active

Wave composition formula:
```javascript
scouts = 5 + wave * 2
fighters = Math.floor(wave / 2)
bombers = Math.floor(wave / 3)
elites = Math.floor(wave / 5)
```

## Visual Design

### Color Scheme
- **Background**: Deep space black (#000814) with star field
- **Player**: Bright white/blue (#00D9FF)
- **Enemies**: Type-specific colors (cyan, magenta, yellow, green)
- **Projectiles**: Glowing energy effects
- **UI**: Retro green/cyan (#00FF41, #00D9FF)

### Effects
- **Particle Systems**:
  - Explosions on enemy destruction
  - Engine trails for ships
  - Projectile trails
  - Star field parallax

- **Screen Shake**: On player hit or boss destruction
- **Flash Effects**: Damage feedback
- **Glow Effects**: All objects have subtle bloom/glow

### UI Elements
- **Score Display**: Top left
- **Lives Display**: Top left (below score)
- **Wave Indicator**: Top center
- **Combo Multiplier**: Dynamic display when active
- **Game Over/Victory Screen**: Center overlay
- **Start Menu**: Title and instructions

## Audio Design (Visual Indicators)
Since this is silent, use visual feedback:
- Flash screen border on events
- Shake effects for impacts
- Color pulses for state changes
- Text notifications for events

## Game States

### 1. Title Screen
- Game title with animated logo
- "Press SPACE to Start"
- High score display
- Controls instructions

### 2. Playing
- Active gameplay
- All systems running
- Score tracking
- Wave progression

### 3. Wave Transition
- Brief pause between waves
- Display wave number
- Show wave composition
- 2-second countdown

### 4. Game Over
- Display final score
- High score check
- "Press SPACE to Restart"
- Return to title option

### 5. Victory
- Triggered after completing Wave 20
- Victory animation
- Final score display
- Replay option

## Controls

### Keyboard
- **Arrow Left / A**: Move left
- **Arrow Right / D**: Move right
- **Space**: Fire weapon
- **P**: Pause game
- **ESC**: Return to menu (when paused)

### Mouse/Touch
- **Click/Touch Left Side**: Move left
- **Click/Touch Right Side**: Move right
- **Auto-fire** when holding down

## Class Structure

### Core Classes
```javascript
class Game {
  // Main game controller
  // Manages states, waves, scoring
}

class Player {
  // Player ship
  // Movement, shooting, lives
}

class Enemy {
  // Base enemy class
  // Movement patterns, health, shooting
}

class Formation {
  // Formation controller
  // Manages enemy groups and patterns
}

class Projectile {
  // Bullet/shot handler
  // Movement, collision
}

class ParticleEffect {
  // Visual effects
  // Explosions, trails, etc.
}

class PatternGenerator {
  // Movement pattern calculations
  // Polar coordinate transformations
}

class UIManager {
  // Heads-up display
  // Score, lives, wave info
}
```

## Performance Considerations

- Object pooling for projectiles and particles
- Efficient collision detection (spatial partitioning)
- Limit particle counts on lower-end devices
- Smooth 60 FPS target
- Responsive to window resize

## Difficulty Progression

### Easy Curve (Waves 1-5)
- Slower enemy movement
- Less frequent shooting
- Simple patterns
- More time between sorties

### Medium Curve (Waves 6-12)
- Increased speed
- Mixed patterns
- More enemies per wave
- Combo patterns

### Hard Curve (Waves 13-20)
- Maximum speed
- Complex overlapping patterns
- Dense bullet curtains
- Aggressive sorties
- Boss enemy at wave 20

## Power-ups (Optional Enhancement)
If time permits, add collectible power-ups:
- **Rapid Fire**: Increased fire rate
- **Spread Shot**: Fire 3 projectiles
- **Shield**: Temporary invulnerability
- **Bomb**: Clear screen of enemies
- **Extra Life**: +1 life

## Future Enhancements
- Multiple weapon types
- Boss battles every 5 waves
- Persistent high scores (localStorage)
- Sound effects and music
- Additional enemy types
- More formation patterns
- Co-op mode (2 player)

## Success Criteria
1. Smooth 60 FPS performance
2. Responsive controls (< 16ms input lag)
3. Visually appealing retro aesthetic
4. 20+ unique enemy movement patterns
5. Satisfying shooting mechanics
6. Progressive difficulty curve
7. Clear win/loss conditions
8. Polished UI and feedback

## Development Phases

### Phase 1: Core Engine (Foundation)
- Setup THREE.js scene with camera
- Implement player movement
- Basic projectile system
- Collision detection

### Phase 2: Enemy System
- Enemy class with health
- Basic movement patterns (3-5 patterns)
- Enemy shooting
- Formation system basics

### Phase 3: Pattern Library
- Implement 10+ polar coordinate patterns
- Sortie attack system
- Formation-to-sortie transitions
- Return to formation logic

### Phase 4: Game Loop
- Wave system
- Scoring
- Lives/game over
- Victory condition

### Phase 5: Polish
- Visual effects (particles, explosions)
- UI refinement
- Balance and difficulty tuning
- Bug fixes and optimization

This design provides a comprehensive blueprint for creating an engaging, visually stunning arcade shooter that captures the essence of classic games while leveraging modern web technologies.
