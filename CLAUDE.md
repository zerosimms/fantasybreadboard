# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # start Electron app with hot-reload (electron-vite dev)
npm run build      # compile TypeScript → out/ (used before running)
npm run typecheck  # tsc type-check only, no emit
npm run dist       # build + package to dist/ installer (electron-builder)
```

There are no tests and no linter configured. After any change, `npm run build` is the verification step — it catches TypeScript errors even though the file uses `// @ts-nocheck` (the compiler still validates imports and explicit types).

## Architecture

### Process model
Standard Electron two-process split:
- **`src/main/index.ts`** — thin main process: creates a fullscreen `BrowserWindow`, no preload/IPC.
- **`src/renderer/index.html`** + **`src/renderer/game.ts`** — entire game lives here. No frontend framework; the renderer is a single TypeScript module loaded via a `<script type="module">` tag in `index.html`.

### The game file (`src/renderer/game.ts`)
All game logic (~4500+ lines) is in one file with `// @ts-nocheck`. The file is structured in sections marked with `═══` banners: CONSTANTS → STATE → HELPERS → ORE GENERATION → (component logic) → DRAW → UPDATE → JOBS/PUZZLES → UI/INPUT.

**Coordinate systems**
- World space: tile grid, `WORLD_W × WORLD_H = 64×64` tiles, `TILE = 40` px each.
- Camera: `cam.{x, y, zoom}`. World→screen: `sx = (wx*TILE + cam.x)*cam.zoom + W/2`. Helpers: `w2s`, `s2w`, `s2c`.
- Tiles use `key(x, y) = "x,y"` as Map/Set keys throughout.

**Core data structures**
- `grid: Map<string, cell>` — placed components. Cell objects hold `type`, `dir`, `flash`, and type-specific fields. Grid helpers: `getG/setG/delG`.
- `ores: Set<string>` — Power Point (extraction) tiles; no grid cell unless a miner is placed on one.
- `items: {cx,cy,progress,dir,color,...}[]` — moving electrons. `progress` goes 0→1 across one tile per move step. `ELECTRON_LIFESPAN = 20` tiles before fading.
- `boughtVeins`, `veinYield`, `burntVeins` — track purchased/depleted ore state (persisted in save).

**Game modes / state machine**
`gameState` cycles through: `'welcome'` → `'jobboard'` → `'playing'` → (back to jobboard or win screen). Inside `'playing'`, the character of the session is determined by three flags:
- `isPlaypen` — free sandbox, no money/LEDs
- `currentJob` — active job definition (null in playpen)
- `currentJob.isPuzzle` — puzzle mode; `levelKit` tracks remaining component counts
- `isPuzzleEditor` — puzzle editor overlay is active

**Job/puzzle system**
Jobs are defined as plain objects in `TUTORIAL_JOBS`, `JOBS`, and `PUZZLE_LEVELS` arrays, then merged into `ALL_JOBS`. Puzzle levels additionally have `kit` (component allowances), `fixedBatteries`, `fixedLeds`, `fixedExtra`, `fixedOres`, `winHold`, and optional `timeLimit`. `loadPuzzle(def)` places locked cells from the definition and sets `levelKit`. Cells with `locked:true` cannot be removed or have their color overridden by miners.

Custom (user-made) puzzles are stored in `localStorage` under `breadboard_custom_puzzles_v1` and managed by `loadCustomPuzzles / saveCustomPuzzle / deleteCustomPuzzle`.

Win condition is checked each frame in the game loop: for puzzles, all `locked` LEDs must reach `charge >= LED_LIT_THRESH (12)` and hold for `winHold` frames. `triggerWin()` shows the overlay; `finishJob()` cleans up and returns to the job board. `failJob()` is called when `jobTimeLeft` hits 0.

**Electron flow**
Miners (`type:'miner'`) sit on ore tiles and emit electrons at `MINE_RATE = 90` frames (modified by tier). Electrons travel through belts and into components. Batteries store charge (capped at `BATTERY_MAX = 100`) and re-emit at `BATTERY_RATE_FAST = 5` frames when `on:true` and connected. LEDs drain at `LED_DRAIN = 0.006/frame` and light up when `charge >= LED_LIT_THRESH`.

**Rendering**
Canvas 2D, drawn every frame via `requestAnimationFrame`. Camera transform applied once at the top of the draw pass: `ctx.translate(W/2, H/2); ctx.scale(zoom,zoom); ctx.translate(cam.x,cam.y)`. All component draw functions operate in world-pixel space (`cx*TILE, cy*TILE`).

**Persistence**
`saveGame()` / `loadGame()` use `localStorage` key `breadboard_save_v1`. The puzzle editor saves to a separate key `breadboard_custom_puzzles_v1`.

### Key constants to know before editing
| Constant | Value | Effect if changed |
|---|---|---|
| `ELECTRON_LIFESPAN` | 20 | Max path length — raising allows longer circuits |
| `LED_LIT_THRESH` | 12 | Min charge to count a LED as "lit" |
| `BATTERY_RATE_FAST` | 5 | Frames between battery discharges when connected |
| `MINE_RATE` | 90 | Frames between miner outputs (~1.5s at 60fps) |
| `COMPONENT_MARGIN` | 8 | Tile-depth of the outer component-area ring |
