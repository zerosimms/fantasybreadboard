// @ts-nocheck
'use strict';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const TILE      = 40;        // pixels per grid tile
const WORLD_W   = 64;        // grid columns (8x8 blocks of 8x8 tiles)
const WORLD_H   = 64;        // grid rows (8x8 blocks of 8x8 tiles)
const MINE_RATE = 90;        // frames between ore outputs

// ── Component Area ──
// The outermost ring of 8x8 blocks (one block deep on every side) is set aside
// as the "component area" — a visually distinct strip where the level's LEDs
// (and future activatable components) live, separate from the open factory
// floor where the player builds their circuit.
const COMPONENT_MARGIN = 8;  // tiles deep (= one block)
const inComponentArea = (x, y) =>
  x < COMPONENT_MARGIN || y < COMPONENT_MARGIN ||
  x >= WORLD_W - COMPONENT_MARGIN || y >= WORLD_H - COMPONENT_MARGIN;

// Extractor (miner) upgrades — tiered: 0 = base, 1 = 2x, 2 = 3x, 3 = 4x
const MINER_UPGRADE_MULTS = [1, 2, 3, 4];     // output-speed multiplier per tier
const MINER_UPGRADE_COSTS = [50, 120, 250];   // cost to advance FROM tier i TO tier i+1
const MINER_MAX_TIER = MINER_UPGRADE_MULTS.length - 1;
// Backward-compatible tier lookup (older saves only have a boolean `upgraded` flag)
function minerTier(cell) { return cell.tier ?? (cell.upgraded ? 1 : 0); }
// A colorizer is "committed" once the player has clicked it and then left it idle for
// COLORIZER_COMMIT_FRAMES frames — after that its color is locked and it's non-interactive.
function colorizerCommitted(cell) { return cell.commitFrame != null && frame >= cell.commitFrame; }

// Node placement costs (dollars)
const NODE_COST = {
  belt:      1,
  miner:     25,
  receiver:  15,
  switch:    20,
  battery:   30,
  colorizer: 20,
  delay:     25,
  ledscreen: 80,
  button:    15,
  trigate:   35,
  vein:      150
};
const DELAY_PRESETS = [0.2, 0.4, 0.6, 0.8, 1.0];   // selectable hold durations (seconds), cycled by clicking a placed delay module
const COLORIZER_COMMIT_FRAMES = 180;   // frames of idle after last click before color locks (~3s)
const STARTING_CREDIT = 200;
const canAfford = t => isPlaypen || (levelKit != null ? (levelKit[t] ?? 0) > 0 : money >= (NODE_COST[t] ?? 0));
const ITEM_SPD  = 0.022;     // item progress per frame (0→1 per cell)
const ELECTRON_LIFESPAN = 20;   // tiles an electron can travel before it fades out and dies
const ELECTRON_FADE_FRAMES = 16;   // frames spent fading out once lifespan is reached

const DIR = { R:0, D:1, L:2, U:3 };
const DIR_VEC   = [[1,0],[0,1],[-1,0],[0,-1]];
const DIR_ANGLE = [0, Math.PI/2, Math.PI, -Math.PI/2];
const DIR_LABEL = ['→','↓','←','↑'];

// LED / challenge constants
const LED_SIZE        = 4;    // LEDs occupy a 4x4-tile component block
const LED_MAX_CHARGE  = 24;   // electrons for a full LED
const LED_LIT_THRESH  = 12;   // charge needed to count as "lit" (50%)
const LED_DRAIN       = 0.006; // charge lost per frame (~0.36/s)
const SCREEN_SIZE         = 6;     // LED screen occupies a 6×6-tile footprint
const SCREEN_PIXEL_MAX    = 16;    // electrons to fully saturate one pixel
const SCREEN_PIXEL_THRESH = 4;     // min charge for a pixel to count as lit
const SCREEN_DRAIN        = 0.6;   // charge lost per frame per pixel — pixel goes dark ~20 frames (~0.3s) after electron passes
const WIN_HOLD_FRAMES    = 1200; // frames all-lit required to win (20s)
const NO_LED_WIN_FRAMES  =  180; // frames of steady electron flow to win a no-LED job (3s)

// Electron / LED color matching — each LED wants electrons of a specific color;
// a "colorizer" node tints passing electrons so they can charge matching LEDs.
const COLOR_NAMES = ['red', 'green', 'blue', 'orange'];
const COLOR_HEX = {
  red:    '#ff5d5d',
  green:  '#6dff8a',
  blue:   '#1a6fd4',
  orange: '#ffb155'
};
const COLOR_RGB = {
  red:    '255,93,93',
  green:  '109,255,138',
  blue:   '26,111,212',
  orange: '255,177,85'
};
const COLOR_GLOW = {
  red:    'rgba(255,90,90,0.55)',
  green:  'rgba(110,255,140,0.5)',
  blue:   'rgba(26,111,212,0.6)',
  orange: 'rgba(255,175,85,0.5)'
};

// Battery constants
const BATTERY_MAX        = 100;
const BATTERY_RATE_SLOW  = 90;  // frames between discharges when no output wire
const BATTERY_RATE_FAST  = 5;   // frames between discharges when output is connected (gives spacing margin so electrons don't overlap)

// Pre-placed LED positions — between ore clusters so routing is required
// Placed inside the component area ring (the outer band of blocks around the
// factory floor) — one per side, so the player has to route wires out to the
// edges of the build space to reach them. Each entry is the TOP-LEFT anchor of
// a LED_SIZE x LED_SIZE (4x4) footprint, sized to fit fully within the
// COMPONENT_MARGIN-deep band without spilling onto the factory floor.
const LED_POSITIONS = [
  { x: 20, y:  2 },                          // top strip
  { x: WORLD_W - 6, y: 22 },                 // right strip
  { x: 38, y: WORLD_H - 6 },                 // bottom strip
  { x:  2, y: 38 },                          // left strip
  { x:  2, y:  2 },                          // top-left corner
];

// Blueprint Palette
const PAL = {
  bg:          '#060e1a',
  bgBorder:    'rgba(60,130,230,0.35)',
  grid:        'rgba(40,100,200,0.1)',
  gridMajor:   'rgba(55,120,210,0.2)',
  componentArea:       'rgba(150,90,230,0.07)',   // tint over the outer ring of blocks
  componentAreaBorder: 'rgba(180,120,255,0.3)',   // divider between component area & factory floor
  componentAreaLabel:  'rgba(190,150,255,0.45)',

  oreBg:       'rgba(15,50,120,0.18)',
  oreBorder:   'rgba(70,150,255,0.45)',
  oreHatch:    'rgba(60,130,240,0.12)',
  oreMarker:   'rgba(100,180,255,0.65)',

  minerFill:   'rgba(10,35,90,0.55)',
  minerBorder: 'rgba(80,170,255,0.9)',
  minerAccent: '#78d4ff',
  minerHatch:  'rgba(60,140,255,0.1)',

  beltFill:    'rgba(6,20,60,0.45)',
  beltBorder:  'rgba(60,130,255,0.65)',
  beltChevron: 'rgba(100,180,255,0.85)',
  beltTrack:   'rgba(50,110,220,0.3)',

  recvFill:    'rgba(5,30,30,0.5)',
  recvBorder:  'rgba(40,210,150,0.85)',
  recvAccent:  '#40e8a0',
  recvFlash:   '#80ffcc',
  recvHatch:   'rgba(30,180,120,0.1)',

  item:        '#78e8ff',
  itemGlow:    'rgba(100,220,255,0.5)',

  hoverValid:  'rgba(60,130,255,0.1)',
  hoverBorder: 'rgba(80,160,255,0.6)',
  hoverBad:    'rgba(255,60,60,0.1)',
  hoverBadBrd: 'rgba(255,80,80,0.5)',
  deleteFill:  'rgba(255,50,50,0.12)',
  deleteBrd:   'rgba(255,80,80,0.65)',

  popupColor:  '#00e890',

  switchFill:   'rgba(8,16,50,0.55)',
  switchBorder: 'rgba(80,150,255,0.75)',
  switchAccent: '#90c4ff',
  switchActive: '#78e8ff',
  switchDim:    'rgba(50,90,200,0.28)',

  battFill:     'rgba(5,22,14,0.6)',
  battBorder:   'rgba(40,200,110,0.75)',
  battAccent:   '#40e890',
  battCharge:   'rgba(40,210,110,0.55)',
  battDischarge:'rgba(80,230,160,0.85)',

  // Universal connection-point markers — used across every rotatable module so the
  // player can tell entry from exit at a glance, regardless of the module's own palette
  portIn:  '#ffe033',   // yellow dot — "connect a wire here"
  portOut: '#ffe033',   // yellow dot — "connect a wire here"
};

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

const canvas = document.getElementById('c');
const ctx    = canvas.getContext('2d');
let W = canvas.width  = window.innerWidth;
let H = canvas.height = window.innerHeight;

// Camera
const cam = { x: 0, y: 0, zoom: 1.0 };

// Grid  key="x,y" → { type:'miner'|'belt'|'receiver', dir, tick, flash }
const grid = new Map();
const ores = new Set();    // Set of "x,y" strings — Power Point tiles (one per 8x8 block, plus any purchased)
const boughtVeins = new Set();   // Set of "x,y" strings — extra veins the player has purchased (persisted across saves)
const veinYield = new Map();     // "x,y" → { remaining, total } — finite extraction budget before a vein burns out
const burntVeins = new Set();    // Set of "x,y" strings — veins that have been fully depleted (persisted so they stay dead on reload)
const VEIN_YIELD_MIN = 60;
const VEIN_YIELD_MAX = 220;
function randomVeinYield() {
  return VEIN_YIELD_MIN + Math.floor(Math.random() * (VEIN_YIELD_MAX - VEIN_YIELD_MIN + 1));
}

// Flowing items: { cx, cy, progress, dir }
let items = [];

// Economy
let money     = STARTING_CREDIT;
let moneyLast = 0;
let moneyRate = 0;

// Floating +$ popups: { x, y, life }
let popups = [];

// Frame counter
let frame = 0;

// Tool state
let tool     = 'belt';
let beltDir  = DIR.R;
let hovCell  = null;    // { x, y }

// Drag-place state
let placing      = false;
let lastPlaced   = null;   // avoid re-placing same cell during drag
let lastDragCell = null;   // previous cell, used to infer belt direction

// Pan state
let panning  = false;
let panStart = null;
let camSnap  = null;
let spaceDown = false;

// Held arrow keys
const keysHeld = new Set();

// Challenge state
let allLitTimer        = 0;    // frames all LEDs have been simultaneously lit
let challengeWon       = false;
let challengeStartFrame = -1;  // frame first electron was delivered (or circuit first worked)
let winFrame           = -1;
let totalElectrons     = 0;    // electrons delivered to LEDs
let activeLedCount     = 5;    // how many LEDs are placed for the current job (0 = none)
let challengeStartMoney = 0;   // money snapshot at challenge start (kept for win-screen stats)
let bankIncome         = 0;    // credits earned by receivers during this challenge (never decrements)
let levelKit           = null; // { belt:12, colorizer:2, ... } in puzzle mode; null otherwise
let puzzleOres         = new Set<string>(); // ore tiles placed by loadPuzzle, cleaned up on exit

// Tutorial callout state
let tutCalloutShown: Record<string, boolean> = {};  // tracks which one-shot callouts have fired

// Cached DOM refs for challenge HUD
const chalDots  = LED_POSITIONS.map((_, i) => document.getElementById(`cl${i}`));
const chalFill  = document.getElementById('chal-fill');
const chalTime  = document.getElementById('chal-time');
const chalCount = document.getElementById('chal-lit-count');

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const key    = (x, y)  => `${x},${y}`;
const getG   = (x, y)  => grid.get(key(x, y));
const setG   = (x, y, v) => grid.set(key(x, y), v);
const delG   = (x, y)  => grid.delete(key(x, y));
const inBnd  = (x, y)  => x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H;

function w2s(wx, wy) {   // world → screen
  return {
    x: (wx * TILE + cam.x) * cam.zoom + W / 2,
    y: (wy * TILE + cam.y) * cam.zoom + H / 2,
  };
}
function s2w(sx, sy) {   // screen → world (float)
  return {
    x: (sx - W / 2) / cam.zoom / TILE - cam.x / TILE,
    y: (sy - H / 2) / cam.zoom / TILE - cam.y / TILE,
  };
}
function s2c(sx, sy) {   // screen → cell (int)
  const w = s2w(sx, sy);
  return { x: Math.floor(w.x), y: Math.floor(w.y) };
}

// Simple deterministic pseudo-random from a seed
function hash(n) {
  n = (n ^ 61) ^ (n >>> 16);
  n = n + (n << 3);
  n = n ^ (n >>> 4);
  n = Math.imul(n, 0x27d4eb2d);
  n = n ^ (n >>> 15);
  return (n >>> 0) / 0xFFFFFFFF;
}
function cellHash(x, y, salt = 0) {
  return hash(x * 73856093 ^ y * 19349663 ^ salt * 83492791);
}

// ═══════════════════════════════════════════════════════════════
// ORE GENERATION
// ═══════════════════════════════════════════════════════════════

function generateOres() {
  // Tile the world into 8x8 blocks and drop exactly one single-tile Power
  // Vein into each — guarantees a source is always within reach, and that no
  // 8x8 area ever ends up with zero or more than one. Players can purchase
  // additional veins later (see boughtVeins / NODE_COST.vein) if they want more.
  const BLOCK = 8;
  const cols = Math.ceil(WORLD_W / BLOCK);
  const rows = Math.ceil(WORLD_H / BLOCK);
  const margin = 1;   // keep the vein off the block edges
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      // Skip blocks that fall entirely within the component area ring — the
      // component area is a no-power zone reserved for LEDs/components.
      if (bx === 0 || by === 0 || bx === cols - 1 || by === rows - 1) continue;
      const x0 = bx * BLOCK, y0 = by * BLOCK;
      const bw = Math.min(BLOCK, WORLD_W - x0);
      const bh = Math.min(BLOCK, WORLD_H - y0);
      const rx = cellHash(bx, by, 11);
      const ry = cellHash(bx, by, 23);
      const innerW = Math.max(1, bw - margin * 2);
      const innerH = Math.max(1, bh - margin * 2);
      const x = x0 + margin + Math.floor(rx * innerW);
      const y = y0 + margin + Math.floor(ry * innerH);
      const k = key(x, y);
      ores.add(k);
      if (!boughtVeins.has(k) && !burntVeins.has(k) && !veinYield.has(k)) {
        const total = randomVeinYield();
        veinYield.set(k, { remaining: total, total });
      }

      // The four central blocks (the 2x2 heart of the factory floor) get a
      // bonus second vein each — a richer "resource cluster" worth building
      // toward, on top of the one-per-block guarantee everywhere else.
      const midLo = Math.floor(cols/2) - 1, midHi = Math.floor(cols/2);
      if (bx >= midLo && bx <= midHi && by >= midLo && by <= midHi) {
        const rx2 = cellHash(bx, by, 37);
        const ry2 = cellHash(bx, by, 53);
        let x2 = x0 + margin + Math.floor(rx2 * innerW);
        let y2 = y0 + margin + Math.floor(ry2 * innerH);
        // Nudge away from the block's primary vein so they don't collide
        if (x2 === x && y2 === y) x2 = x0 + margin + ((Math.floor(rx2*innerW) + 1) % innerW);
        const k2 = key(x2, y2);
        if (k2 !== k) {
          ores.add(k2);
          if (!boughtVeins.has(k2) && !burntVeins.has(k2) && !veinYield.has(k2)) {
            const total2 = randomVeinYield();
            veinYield.set(k2, { remaining: total2, total: total2 });
          }
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// PLACEMENT
// ═══════════════════════════════════════════════════════════════

function placeLEDs() {
  // Playpen always gets 0 LEDs; jobs use their leds field (default 5); no-job defaults to 5
  const count = isPlaypen ? 0 : (currentJob ? (currentJob.leds ?? 5) : 5);
  activeLedCount = count;
  // Show challenge HUD when there are LEDs to track, or an earn target, or a puzzle
  const hasChallenge = count > 0 || !!(currentJob && (currentJob.earn || currentJob.fillBattery || currentJob.isPuzzle));
  const chalSection = document.getElementById('toolbar-challenge');
  if (chalSection) chalSection.style.display = hasChallenge ? 'flex' : 'none';
  // Update dot visibility
  for (let i = 0; i < 5; i++) {
    const dot = document.getElementById(`cl${i}`);
    if (dot) dot.style.display = i < count ? '' : 'none';
  }
  const countEl = document.getElementById('chal-lit-count');
  if (countEl) countEl.textContent = `0/${count} LIT`;
  if (count === 0) return;
  for (const [i, pos] of LED_POSITIONS.slice(0, count).entries()) {
    const color = COLOR_NAMES[Math.floor(Math.random() * COLOR_NAMES.length)];
    // `pos` is the top-left ORIGIN of the 4x4 visual block. The real,
    // wireable LED cell — the one that actually holds charge/color and
    // accepts electrons — is placed at the BOTTOM-CENTER tile of that block,
    // so its only open (unreserved) neighbor is the tile directly below it.
    // That naturally puts the component's single connection point at the
    // bottom of the LED, exactly where players should route a wire in.
    const lx = pos.x + Math.floor((LED_SIZE - 1) / 2);
    const ly = pos.y + LED_SIZE - 1;
    ores.delete(key(lx, ly));
    setG(lx, ly, {
      type: 'led', charge: 0, flash: 0, id: i, color, size: LED_SIZE,
      originX: pos.x, originY: pos.y   // top-left of the visual block, for drawing
    });
    // The remaining tiles of the 4x4 footprint are reserved "led_part" stubs —
    // they block placement/ore-spawns and render nothing themselves (the real
    // cell's drawLED paints across the whole block), keeping the component
    // visually solid without duplicating its logic across 16 cells.
    for (let oy = 0; oy < LED_SIZE; oy++) {
      for (let ox = 0; ox < LED_SIZE; ox++) {
        const px2 = pos.x + ox, py2 = pos.y + oy;
        if (px2 === lx && py2 === ly) continue;
        ores.delete(key(px2, py2));
        setG(px2, py2, { type: 'led_part', anchor: { x: lx, y: ly } });
      }
    }
  }
}

// ── Remove a building ──
function removeBuilding(cx, cy) {
  const e = getG(cx, cy);
  if (!e) return;
  if (e.locked) return;   // puzzle-locked components can't be removed
  if ((e.type === 'led' && !e.placed) || (e.type === 'led_part' && !e.placed)) return;   // fixed challenge LEDs (and their reserved footprint) are permanent
  // Placed 4×4 LED: remove all 16 tiles (works for both anchor and part clicks)
  if ((e.type === 'led' || e.type === 'led_part') && e.placed) {
    const ox = e.originX ?? cx, oy = e.originY ?? cy;
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        delG(ox + dx, oy + dy);
        items = items.filter(it => !(it.cx === ox + dx && it.cy === oy + dy));
      }
    }
    return;
  }
  // LED screen: remove all 36 tiles in its footprint at once
  if (e.type === 'ledscreen' || e.type === 'ledscreen_part') {
    const ox = e.originX, oy = e.originY;
    for (let dy = 0; dy < SCREEN_SIZE; dy++) {
      for (let dx = 0; dx < SCREEN_SIZE; dx++) {
        const tx = ox + dx, ty = oy + dy;
        delG(tx, ty);
        items = items.filter(it => !(it.cx === tx && it.cy === ty));
      }
    }
    if (levelKit && 'ledscreen' in levelKit) { levelKit.ledscreen++; updateKitDisplay(); }
    return;
  }
  // Trigate: remove all 3 tiles in its footprint
  if (e.type === 'trigate' || e.type === 'trigate_part') {
    const main = e.type === 'trigate' ? e : getG(e.originX, e.originY);
    if (!main) { delG(cx, cy); return; }
    const isH = (main.dir === DIR.U || main.dir === DIR.D);
    for (let i = 0; i < 3; i++) {
      const tx = isH ? main.originX + i : main.originX;
      const ty = isH ? main.originY     : main.originY + i;
      delG(tx, ty);
      items = items.filter(it => !(it.cx === tx && it.cy === ty));
    }
    if (levelKit && 'trigate' in levelKit) { levelKit.trigate++; updateKitDisplay(); }
    return;
  }
  const removedType = e.type === 'trigate_part' ? 'trigate' : e.type;
  delG(cx, cy);
  items = items.filter(it => !(it.cx === cx && it.cy === cy));
  if (levelKit && removedType in levelKit) { levelKit[removedType]++; updateKitDisplay(); }
}

function canPlace(cx, cy) {
  if (!tool) return false;   // nothing selected
  if (!inBnd(cx, cy)) return false;
  const e = getG(cx, cy);
  // Fixed challenge LEDs (and their footprint stubs) and switches are immovable —
  // but a player-placed playpen LED (cell.placed) is just another component.
  if (e && ((e.type === 'led' && !e.placed) || (e.type === 'led_part' && !e.placed) || e.type === 'switch' || e.type === 'ledscreen' || e.type === 'ledscreen_part' || e.type === 'trigate' || e.type === 'trigate_part')) return false;
  // Wires (belts) — and playpen LEDs — can be replaced by any other component, makes swapping nodes easy
  const replaceable = !e || e.type === 'belt' || (e.type === 'led' && e.placed);
  if (tool.startsWith('led_')) {
    if (!isPlaypen) return false;
    const lox = cx - 2, loy = cy - 2;
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        if (!inBnd(lox + dx, loy + dy)) return false;
        const t = getG(lox + dx, loy + dy);
        if (!t || t.type === 'belt') continue;
        if ((t.type === 'led' || t.type === 'led_part') && t.placed) continue;
        return false;
      }
    }
    return true;
  }
  if (tool === 'miner')    return replaceable && ores.has(key(cx, cy)) && canAfford('miner');
  if (tool === 'belt') {
    if (e) return e.type === 'belt';      // rotating an existing wire is free
    return canAfford('belt');
  }
  if (tool === 'receiver') return replaceable && canAfford('receiver');
  if (tool === 'battery')  return replaceable && canAfford('battery');
  if (tool === 'switch')   return replaceable && canAfford('switch');
  if (tool === 'colorizer') return replaceable && canAfford('colorizer');
  if (tool === 'delay')    return replaceable && canAfford('delay');
  if (tool === 'button')   return replaceable && canAfford('button');
  if (tool === 'trigate') {
    if (!canAfford('trigate')) return false;
    const isH = (beltDir === DIR.U || beltDir === DIR.D);
    const ox = isH ? cx - 1 : cx, oy = isH ? cy : cy - 1;
    for (let i = 0; i < 3; i++) {
      const tx = isH ? ox + i : ox, ty = isH ? oy : oy + i;
      if (!inBnd(tx, ty)) return false;
      const t = getG(tx, ty);
      if (t && t.type !== 'belt') return false;
    }
    return true;
  }
  if (tool === 'ledscreen') {
    if (!canAfford('ledscreen')) return false;
    for (let dy = 0; dy < SCREEN_SIZE; dy++) {
      for (let dx = 0; dx < SCREEN_SIZE; dx++) {
        if (!inBnd(cx + dx, cy + dy)) return false;
        const t = getG(cx + dx, cy + dy);
        if (t && t.type !== 'belt') return false;
      }
    }
    return true;
  }
  if (tool === 'vein') return !e && !ores.has(key(cx, cy)) && canAfford('vein');
  if (tool === 'delete')   return !!e;
  return false;
}

// Replace whatever's in a cell (e.g. a wire) with a new component, clearing any electrons on it
function replaceBuilding(cx, cy, comp) {
  setG(cx, cy, comp);
  items = items.filter(it => !(it.cx === cx && it.cy === cy));
}

// Smart belt direction: continue from neighbouring output if possible
function smartDir(cx, cy) {
  // Check if any neighbour is pointing here → continue same direction
  for (const [dx, dy, d] of [[-1,0,DIR.R],[0,-1,DIR.D],[1,0,DIR.L],[0,1,DIR.U]]) {
    const nb = getG(cx + dx, cy + dy);
    if (nb && (nb.type === 'belt' || nb.type === 'miner') && nb.dir === d) {
      return d;
    }
  }
  return beltDir;
}

function placeTile(cx, cy, opts = {}) {
  if (!inBnd(cx, cy)) return;

  const e = getG(cx, cy);

  // ── Clicking an existing battery toggles on/off ──
  if (e && e.type === 'battery' && tool !== 'delete') {
    e.on = !e.on;
    return;
  }

  // ── Clicking an existing colorizer cycles its tint color ──
  // Each click resets the commit timer; after COLORIZER_COMMIT_FRAMES of idle the color locks.
  if (e && e.type === 'colorizer' && tool !== 'delete' && !colorizerCommitted(e)) {
    const idx = COLOR_NAMES.indexOf(e.color);
    e.color = COLOR_NAMES[(idx + 1) % COLOR_NAMES.length];
    e.flash = 10;
    e.commitFrame = frame + COLORIZER_COMMIT_FRAMES;
    return;
  }

  // ── Clicking an existing button toggles it open/closed (not on drag) ──
  if (e && e.type === 'button' && tool !== 'delete' && !opts.dragging) {
    e.on = !e.on;
    e.flash = 10;
    return;
  }

  // ── Clicking an existing trigate (or any of its parts) arms/disarms it ──
  // When armed (ON), electrons fill each channel and auto-fire once all 3 are loaded.
  if (e && (e.type === 'trigate' || e.type === 'trigate_part') && tool !== 'delete') {
    const main = e.type === 'trigate' ? e : getG(e.originX, e.originY);
    if (!main) return;
    main.on = !main.on;
    main.flash = 10;
    return;
  }

  // ── Clicking an existing delay module cycles its hold duration through the presets ──
  if (e && e.type === 'delay' && tool !== 'delete') {
    const idx = DELAY_PRESETS.indexOf(e.delaySec);
    e.delaySec = DELAY_PRESETS[(idx + 1) % DELAY_PRESETS.length];
    e.flash = 10;
    return;
  }

  // ── Clicking an LED screen pixel mutes/unmutes it — muted pixels stay dark even with electrons ──
  if (e && (e.type === 'ledscreen' || e.type === 'ledscreen_part') && tool !== 'delete') {
    const main = e.type === 'ledscreen' ? e : getG(e.originX, e.originY);
    if (!main) return;
    const idx = e.type === 'ledscreen' ? 0 : e.pixelIdx;
    if (!main.pixelMuted) main.pixelMuted = new Array(SCREEN_SIZE * SCREEN_SIZE).fill(false);
    main.pixelMuted[idx] = !main.pixelMuted[idx];
    if (main.pixelMuted[idx]) main.pixels[idx] = 0;
    main.flash = 6;
    return;
  }

  // ── Clicking an existing playpen LED (or any of its parts) with an LED tool re-colors it ──
  if (e && e.type === 'led' && e.placed && tool && tool.startsWith('led_') && tool !== 'delete') {
    e.color = tool.slice(4);
    e.flash = 10;
    return;
  }
  if (e && e.type === 'led_part' && e.placed && tool && tool.startsWith('led_') && tool !== 'delete') {
    const ox = e.originX, oy = e.originY;
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        const t = getG(ox + dx, oy + dy);
        if (t && t.type === 'led' && t.placed) { t.color = tool.slice(4); t.flash = 10; break; }
      }
    }
    return;
  }

  // ── Clicking an existing source: purchase the next speed-tier upgrade ──
  if (e && e.type === 'miner' && tool !== 'delete') {
    const tier = minerTier(e);
    if (tier < MINER_MAX_TIER) {
      const cost = MINER_UPGRADE_COSTS[tier];
      if (isPlaypen || money >= cost) {
        if (!isPlaypen) money -= cost;
        e.tier = tier + 1;
        delete e.upgraded;   // superseded by numeric tier
        e.flash = 16;
        popups.push({ wx: cx + 0.5, wy: cy - 0.6, life: 40, text: `${MINER_UPGRADE_MULTS[e.tier]}x SPEED!` });
      }
    }
    return;
  }

  if (tool === 'delete') {
    removeBuilding(cx, cy);
    return;
  }

  if (tool === 'vein') {
    if (inComponentArea(cx, cy)) return;   // no-power zone — can't drop veins here
    if (e || ores.has(key(cx, cy))) return;
    if (!canAfford('vein')) return;
    if (!isPlaypen) money -= NODE_COST.vein;
    const vk = key(cx, cy);
    ores.add(vk);
    boughtVeins.add(vk);
    burntVeins.delete(vk);
    veinYield.delete(vk);   // purchased veins have unlimited charge — never burn out
    popups.push({ wx: cx + 0.5, wy: cy - 0.4, life: 40, text: 'NEW POWER POINT!' });
    return;
  }

  if (tool === 'miner') {
    if (!ores.has(key(cx, cy)) || (e && e.type !== 'belt')) return;
    if (!canAfford('miner')) return;
    if (!isPlaypen) money -= NODE_COST.miner;
    replaceBuilding(cx, cy, { type: 'miner', dir: beltDir, tick: 0, tier: 0 });
    // First-time tut-1: explain what the Power Point circle is
    if (currentJob && currentJob.id === 'tut-1-first-circuit') {
      showTutCallout(
        'tut1-power-point',
        cx, cy,
        '⚡ Power Point',
        'This glowing circle is a <b>Power Point</b> — a raw energy source buried in the board. ' +
        'Your Extractor drills into it and pumps electrons outward. ' +
        'Without a Power Point underneath, an Extractor won\'t run.'
      );
    }
    return;
  }

  if (tool === 'belt') {
    if (e && e.type !== 'belt') return;
    if (e && e.type === 'belt') {
      if (opts.dragging) {
        // While drawing a path, steer the existing wire toward the drag direction
        // instead of rotating it — keeps loops/junctions intact when crossing back over wire.
        if (opts.dragDir != null) e.dir = opts.dragDir;
      } else {
        e.dir = (e.dir + 1) % 4;
      }
      return;   // rotating an existing wire is free
    }
    if (!canAfford('belt')) return;
    if (levelKit != null) { levelKit.belt = (levelKit.belt ?? 0) - 1; updateKitDisplay(); }
    else if (!isPlaypen) money -= NODE_COST.belt;
    setG(cx, cy, { type: 'belt', dir: smartDir(cx, cy) });
    return;
  }

  if (tool === 'receiver') {
    if (e && e.type !== 'belt') return;
    if (!canAfford('receiver')) return;
    if (levelKit != null) { levelKit.receiver = (levelKit.receiver ?? 0) - 1; updateKitDisplay(); }
    else if (!isPlaypen) money -= NODE_COST.receiver;
    replaceBuilding(cx, cy, { type: 'receiver', dir: beltDir, flash: 0 });
    return;
  }

  if (tool === 'battery') {
    if (e && e.type !== 'belt') return;
    if (!canAfford('battery')) return;
    if (levelKit != null) { levelKit.battery = (levelKit.battery ?? 0) - 1; updateKitDisplay(); }
    else if (!isPlaypen) money -= NODE_COST.battery;
    replaceBuilding(cx, cy, { type: 'battery', dir: beltDir, charge: 0, dischargeTick: 0, flash: 0, on: true });
    return;
  }

  if (tool === 'switch') {
    if (e && e.type !== 'belt') return;
    if (!canAfford('switch')) return;
    if (levelKit != null) { levelKit.switch = (levelKit.switch ?? 0) - 1; updateKitDisplay(); }
    else if (!isPlaypen) money -= NODE_COST.switch;
    replaceBuilding(cx, cy, { type:'switch', dir:beltDir, state:0 });
    return;
  }

  if (tool === 'colorizer') {
    if (e && e.type !== 'belt') return;
    if (!canAfford('colorizer')) return;
    if (levelKit != null) { levelKit.colorizer = (levelKit.colorizer ?? 0) - 1; updateKitDisplay(); }
    else if (!isPlaypen) money -= NODE_COST.colorizer;
    replaceBuilding(cx, cy, { type: 'colorizer', dir: beltDir, color: COLOR_NAMES[0], flash: 0 });
    return;
  }

  if (tool === 'delay') {
    if (e && e.type !== 'belt') return;
    if (!canAfford('delay')) return;
    if (levelKit != null) { levelKit.delay = (levelKit.delay ?? 0) - 1; updateKitDisplay(); }
    else if (!isPlaypen) money -= NODE_COST.delay;
    replaceBuilding(cx, cy, { type: 'delay', dir: beltDir, delaySec: DELAY_PRESETS[0], flash: 0 });
    return;
  }

  if (tool === 'button') {
    if (e && e.type !== 'belt') return;
    if (!canAfford('button')) return;
    if (levelKit != null) { levelKit.button = (levelKit.button ?? 0) - 1; updateKitDisplay(); }
    else if (!isPlaypen) money -= NODE_COST.button;
    replaceBuilding(cx, cy, { type: 'button', dir: beltDir, on: true, flash: 0 });
    return;
  }

  if (tool === 'trigate') {
    const isH = (beltDir === DIR.U || beltDir === DIR.D);
    const ox = isH ? cx - 1 : cx, oy = isH ? cy : cy - 1;
    // Validate all 3 tiles
    for (let i = 0; i < 3; i++) {
      const tx = isH ? ox + i : ox, ty = isH ? oy : oy + i;
      if (!inBnd(tx, ty)) return;
      const t = getG(tx, ty);
      if (t && t.type !== 'belt') return;
    }
    if (!canAfford('trigate')) return;
    if (levelKit != null) { levelKit.trigate = (levelKit.trigate ?? 0) - 1; updateKitDisplay(); }
    else if (!isPlaypen) money -= NODE_COST.trigate;
    // Place anchor at tile 0
    setG(ox, oy, { type: 'trigate', dir: beltDir, on: false, flash: 0, originX: ox, originY: oy });
    items = items.filter(it => !(it.cx === ox && it.cy === oy));
    // Place part tiles 1 and 2
    for (let i = 1; i < 3; i++) {
      const tx = isH ? ox + i : ox, ty = isH ? oy : oy + i;
      setG(tx, ty, { type: 'trigate_part', dir: beltDir, originX: ox, originY: oy, partIdx: i });
      items = items.filter(it => !(it.cx === tx && it.cy === ty));
    }
    return;
  }

  if (tool === 'ledscreen') {
    // Check full 6×6 footprint is clear (belts are OK to overwrite)
    for (let dy = 0; dy < SCREEN_SIZE; dy++) {
      for (let dx = 0; dx < SCREEN_SIZE; dx++) {
        if (!inBnd(cx + dx, cy + dy)) return;
        const t = getG(cx + dx, cy + dy);
        if (t && t.type !== 'belt') return;
      }
    }
    if (!canAfford('ledscreen')) return;
    if (levelKit != null) { levelKit.ledscreen = (levelKit.ledscreen ?? 0) - 1; updateKitDisplay(); }
    else if (!isPlaypen) money -= NODE_COST.ledscreen;
    // Place origin tile (top-left) with the pixel state arrays
    setG(cx, cy, {
      type: 'ledscreen', originX: cx, originY: cy,
      pixels: new Array(SCREEN_SIZE * SCREEN_SIZE).fill(0),
      pixelColors: new Array(SCREEN_SIZE * SCREEN_SIZE).fill(null),
      pixelMuted: new Array(SCREEN_SIZE * SCREEN_SIZE).fill(false),
      flash: 0
    });
    items = items.filter(it => !(it.cx === cx && it.cy === cy));
    // Fill the remaining 35 tiles with back-reference stubs
    for (let dy = 0; dy < SCREEN_SIZE; dy++) {
      for (let dx = 0; dx < SCREEN_SIZE; dx++) {
        if (dx === 0 && dy === 0) continue;
        const tx = cx + dx, ty = cy + dy;
        setG(tx, ty, { type: 'ledscreen_part', originX: cx, originY: cy, pixelIdx: dy * SCREEN_SIZE + dx });
        items = items.filter(it => !(it.cx === tx && it.cy === ty));
      }
    }
    return;
  }

  // ── Playpen LEDs — 4×4 rotatable lights with a single directional input ──
  if (tool && tool.startsWith('led_')) {
    if (!isPlaypen) return;
    const ox = cx - 2, oy = cy - 2;   // centre the 4×4 block on the cursor
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        if (!inBnd(ox + dx, oy + dy)) return;
        const t = getG(ox + dx, oy + dy);
        if (t && t.type !== 'belt' && !((t.type === 'led' || t.type === 'led_part') && t.placed)) return;
      }
    }
    const color = tool.slice(4);
    // Remove any existing placed LED whose footprint overlaps these 16 tiles
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        const t = getG(ox + dx, oy + dy);
        if (t && (t.type === 'led' || t.type === 'led_part') && t.placed) {
          const oox = t.originX ?? (ox + dx), ooy = t.originY ?? (oy + dy);
          for (let iy = 0; iy < 4; iy++) for (let ix = 0; ix < 4; ix++) delG(oox + ix, ooy + iy);
        }
      }
    }
    // Anchor tile is the center of the input edge, determined by direction
    const [aox, aoy] = beltDir === DIR.R ? [0, 1] :
                        beltDir === DIR.D ? [1, 0] :
                        beltDir === DIR.L ? [3, 1] : [1, 3]; // DIR.U
    setG(ox + aox, oy + aoy, { type: 'led', charge: 0, flash: 0, color, size: 4, dir: beltDir, originX: ox, originY: oy, placed: true });
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        if (dx === aox && dy === aoy) continue;
        setG(ox + dx, oy + dy, { type: 'led_part', originX: ox, originY: oy, placed: true });
      }
    }
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        items = items.filter(it => !(it.cx === ox + dx && it.cy === oy + dy));
      }
    }
    return;
  }
}

// ═══════════════════════════════════════════════════════════════
// GAME UPDATE
// ═══════════════════════════════════════════════════════════════

function update() {
  if (gameState !== 'playing') return; // freeze simulation on welcome/pause screens

  frame++;

  // ── Arrow-key camera pan ──
  const PAN_SPD = 6 / cam.zoom;
  if (keysHeld.has('ArrowLeft')  || keysHeld.has('a') || keysHeld.has('A')) cam.x += PAN_SPD;
  if (keysHeld.has('ArrowRight') || keysHeld.has('d') || keysHeld.has('D')) cam.x -= PAN_SPD;
  if (keysHeld.has('ArrowUp')    || keysHeld.has('w') || keysHeld.has('W')) cam.y += PAN_SPD;
  if (keysHeld.has('ArrowDown')  || keysHeld.has('s') || keysHeld.has('S')) cam.y -= PAN_SPD;

  // ── Miners output items ──
  for (const [k, cell] of grid) {
    if (cell.type !== 'miner') continue;
    const mineRate = MINE_RATE / MINER_UPGRADE_MULTS[minerTier(cell)];
    cell.tick++;
    if (cell.tick < mineRate) continue;
    cell.tick = 0;

    const [kx, ky] = k.split(',').map(Number);

    // Power Point depletion — an Extractor sitting on a Power Point draws down its finite reserve
    // (purchased veins are unlimited and never burn out)
    if (burntVeins.has(k)) continue;
    const veinInfo = boughtVeins.has(k) ? null : veinYield.get(k);
    if (veinInfo) {
      veinInfo.remaining--;
      if (veinInfo.remaining <= 0) {
        ores.delete(k);
        veinYield.delete(k);
        burntVeins.add(k);
        removeBuilding(kx, ky);   // the Power Point dies and takes the Extractor with it
        popups.push({ wx: kx + 0.5, wy: ky - 0.4, life: 55, text: 'VEIN BURNT OUT — MODULE FRIED!' });
        continue;
      }
    }

    const [dx, dy] = DIR_VEC[cell.dir];
    const nx = kx + dx, ny = ky + dy;
    if (!inBnd(nx, ny)) continue;

    const nextCell = getG(nx, ny);
    if (!nextCell) continue;

    // Miner directly adjacent to battery, feeding into its input side (opposite its discharge `dir`)
    if (nextCell.type === 'battery') {
      if (cell.dir === nextCell.dir) {
        nextCell.charge = Math.min(BATTERY_MAX, nextCell.charge + 1);
        if (!nextCell.locked) nextCell.color = undefined;  // raw ore clears color; locked (puzzle) batteries keep theirs
        nextCell.flash  = 8;
      }
      continue;
    }

    // Miner directly adjacent to switch → enter it
    if (nextCell.type === 'switch') {
      const blocked = items.some(it => it.cx === nx && it.cy === ny && it.progress < 0.15);
      if (!blocked) {
        const exitDir = nextCell.state === 0
          ? (nextCell.dir + 3) % 4
          : (nextCell.dir + 1) % 4;
        items.push({ cx: nx, cy: ny, progress: 0, dir: exitDir });
        nextCell.armFromDir = exitDir;
        nextCell.armFlipFrame = frame;
        nextCell.state = 1 - nextCell.state;   // auto-toggle: alternate routing on every pass
        nextCell.flash = 10;
      }
      continue;
    }

    // Miner directly adjacent to receiver → instant collect
    if (nextCell.type === 'receiver') {
      money++; bankIncome++;
      nextCell.flash = 12;
      popups.push({ wx: nx + 0.5, wy: ny - 0.2, life: 40 });
      continue;
    }

    // Miner directly adjacent to colorizer → enter it, gets tinted immediately
    if (nextCell.type === 'colorizer') {
      const blocked = items.some(it => it.cx === nx && it.cy === ny && it.progress < 0.15);
      if (!blocked) {
        items.push({ cx: nx, cy: ny, progress: 0, dir: nextCell.dir, color: nextCell.color });
        nextCell.flash = 8;
      }
      continue;
    }

    // Miner directly adjacent to delay → enter it and hold for the configured duration
    // Miner must fire along the delay's axis (same dir as delay's output)
    if (nextCell.type === 'delay') {
      if (cell.dir === nextCell.dir) {
        const blocked = items.some(it => it.cx === nx && it.cy === ny && it.progress < 0.15);
        if (!blocked) {
          items.push({ cx: nx, cy: ny, progress: 0, dir: nextCell.dir, waitTick: Math.round((nextCell.delaySec ?? 0.2) * 60) });
          nextCell.flash = 8;
        }
      }
      continue;
    }

    // Miner directly adjacent to LED → instant charge (raw electrons are uncolored,
    // so this only lights an LED that doesn't require a specific color — i.e. never,
    // since every LED now wants a color. Route through a colorizer instead.)
    if (nextCell.type === 'led') {
      if (!nextCell.color && (nextCell.dir == null || cell.dir === nextCell.dir)) {
        nextCell.charge = Math.min(LED_MAX_CHARGE, nextCell.charge + 1);
        nextCell.flash = 8;
        if (challengeStartFrame < 0) challengeStartFrame = frame;
        totalElectrons++;
      }
      continue;
    }

    // Miner directly adjacent to LED screen → spawn electron onto the screen edge tile (it will pass through)
    if (nextCell.type === 'ledscreen' || nextCell.type === 'ledscreen_part') {
      const blocked = items.some(it => it.cx === nx && it.cy === ny && it.progress < 0.15);
      if (!blocked) {
        items.push({ cx: nx, cy: ny, progress: 0, dir: cell.dir });
        const mainCell = nextCell.type === 'ledscreen' ? nextCell : getG(nextCell.originX, nextCell.originY);
        if (mainCell && mainCell.pixels) {
          const idx = nextCell.type === 'ledscreen' ? 0 : nextCell.pixelIdx;
          mainCell.pixels[idx] = Math.min(SCREEN_PIXEL_MAX, (mainCell.pixels[idx] || 0) + 1);
          mainCell.flash = 8;
        }
      }
      continue;
    }

    if (nextCell.type !== 'belt') continue;

    // Don't spawn if there's already an item there at low progress
    const blocked = items.some(it => it.cx === nx && it.cy === ny && it.progress < 0.15);
    if (blocked) continue;

    items.push({ cx: nx, cy: ny, progress: 0, dir: nextCell.dir });
  }

  // ── Battery discharge ──
  for (const [k, cell] of grid) {
    if (cell.type !== 'battery' || cell.charge <= 0 || cell.on === false) continue;

    const [bkx, bky] = k.split(',').map(Number);
    const [bodx, body] = DIR_VEC[cell.dir ?? DIR.U];
    const outX = bkx + bodx, outY = bky + body;   // output from the battery's `dir` side
    if (!inBnd(outX, outY)) continue;
    const outCell = getG(outX, outY);

    // Rate depends on whether something is connected on the output side
    const connected = outCell && (
      outCell.type === 'belt' || outCell.type === 'switch' ||
      outCell.type === 'receiver' || outCell.type === 'led' ||
      outCell.type === 'colorizer' || outCell.type === 'delay' ||
      outCell.type === 'ledscreen' || outCell.type === 'ledscreen_part' ||
      outCell.type === 'button'    || outCell.type === 'trigate' || outCell.type === 'trigate_part'
    );
    const rate = connected ? BATTERY_RATE_FAST : BATTERY_RATE_SLOW;

    cell.dischargeTick = (cell.dischargeTick || 0) + 1;
    if (cell.dischargeTick < rate) continue;
    cell.dischargeTick = 0;
    if (!outCell) continue;

    if (outCell.type === 'receiver') {
      money++; bankIncome++; outCell.flash = 12;
      popups.push({ wx: outX + 0.5, wy: outY - 0.2, life: 40 });
      cell.charge--; cell.flash = -6; continue;
    }
    if (outCell.type === 'led') {
      // Directional LED: only accept if battery fires in the LED's expected direction
      if (outCell.dir != null && cell.dir !== outCell.dir) { continue; }
      // Batteries now remember the color of whatever last charged them (cell.color) and
      // discharge electrons of that same color — so a battery fed red electrons lights a
      // red-requiring LED directly, just like a colorizer-tinted stream would.
      const matches = !outCell.color || cell.color === outCell.color;
      if (matches) {
        outCell.charge = Math.min(LED_MAX_CHARGE, outCell.charge + 1);
        outCell.flash  = 8;
        if (challengeStartFrame < 0) challengeStartFrame = frame;
        totalElectrons++;
      } else {
        outCell.flash = -6;
        popups.push({ wx: outX + 0.5, wy: outY - 0.4, life: 36, text: 'WRONG COLOR' });
      }
      cell.charge--; cell.flash = -6; continue;
    }
    if (outCell.type === 'belt' || outCell.type === 'switch' || outCell.type === 'colorizer' || outCell.type === 'delay' || outCell.type === 'ledscreen' || outCell.type === 'ledscreen_part' || outCell.type === 'button' || outCell.type === 'trigate' || outCell.type === 'trigate_part') {
      // Spawn at the battery edge (progress -0.5 = tile boundary) so the electron rolls out smoothly.
      // Blocked threshold shifted by the same -0.5 so effective discharge spacing is unchanged.
      const blocked = items.some(it => it.cx === outX && it.cy === outY && it.progress < -0.2);
      if (blocked) continue;
      cell.charge--; cell.flash = -6;
      items.push({
        cx: outX, cy: outY, progress: -0.5,
        // entryDir is the battery's own discharge direction — used only while progress < 0
        // so the rollout animation always tracks back toward the battery regardless of
        // which way the receiving belt faces.
        entryDir: cell.dir ?? DIR.U,
        // Screen tiles have no dir of their own — use the battery's discharge direction so electrons
        // travel straight through the screen row/column they land on
        dir: outCell.type === 'colorizer' ? outCell.dir
           : (outCell.type === 'ledscreen' || outCell.type === 'ledscreen_part') ? (cell.dir ?? DIR.U)
           : outCell.dir,
        // A colorizer overrides whatever color rides through it; otherwise the battery
        // discharges electrons in the color it remembers from its last charge.
        color: outCell.type === 'colorizer' ? outCell.color : cell.color,
        waitTick: outCell.type === 'delay' ? Math.round((outCell.delaySec ?? 0.2) * 60) : undefined
      });
      if (outCell.type === 'colorizer' || outCell.type === 'delay') outCell.flash = 8;
      if (outCell.type === 'ledscreen' || outCell.type === 'ledscreen_part') {
        const mc = outCell.type === 'ledscreen' ? outCell : getG(outCell.originX, outCell.originY);
        if (mc && mc.pixels) { const idx = outCell.type === 'ledscreen' ? 0 : outCell.pixelIdx; mc.pixels[idx] = Math.min(SCREEN_PIXEL_MAX, (mc.pixels[idx]||0)+1); if (cell.color) mc.pixelColors[idx] = cell.color; mc.flash = 8; }
      }
      continue;
    }
  }

  // ── Move items ──
  const remove = [];

  for (let i = 0; i < items.length; i++) {
    const it = items[i];

    // ── LED entry animation: electron travels along the wire stub to the ring junction ──
    if (it.enteringLed) {
      it.progress += ITEM_SPD;
      if (it.progress >= 1) remove.push(i);
      continue;
    }

    // ── Lifespan: once an electron has traveled too far, let it fade out and die in place ──
    if (it.fading) {
      it.fadeTick--;
      if (it.fadeTick <= 0) remove.push(i);
      continue;
    }

    // ── Freeze: skip ticking while waitTick is counting down ──
    if ((it.waitTick || 0) > 0) { it.waitTick--; continue; }

    // ── Switch: kill the electron if its routed output has no wire to follow ──
    const swCell = getG(it.cx, it.cy);
    if (swCell && swCell.type === 'switch') {
      // Use the electron's own (already-locked) travel direction — NOT a fresh
      // lookup of swCell.state, which has already been toggled for the *next*
      // electron and would give the wrong exit for this one mid-transit.
      const exitDir = it.dir;
      const [edx, edy] = DIR_VEC[exitDir];
      const ex = it.cx + edx, ey = it.cy + edy;
      const outCell = inBnd(ex, ey) ? getG(ex, ey) : null;
      const canExit = outCell && (
        outCell.type === 'belt'     || outCell.type === 'receiver' ||
        outCell.type === 'led'      || outCell.type === 'switch'   ||
        outCell.type === 'battery'  || outCell.type === 'colorizer' ||
        outCell.type === 'delay'    || outCell.type === 'ledscreen' ||
        outCell.type === 'ledscreen_part' || outCell.type === 'button' ||
        outCell.type === 'trigate'  || outCell.type === 'trigate_part'
      );
      if (!canExit) {
        swCell.flash = -8;
        popups.push({ wx: it.cx + 0.5, wy: it.cy - 0.4, life: 36, text: 'DEAD END' });
        remove.push(i);
        continue;
      }
    }

    it.progress += ITEM_SPD;

    if (it.progress < 1) continue;

    it.progress -= 1;



    const [dx, dy] = DIR_VEC[it.dir];
    const nx = it.cx + dx;
    const ny = it.cy + dy;

    if (!inBnd(nx, ny)) { remove.push(i); continue; }

    const nextCell = getG(nx, ny);

    // Receiver: collect
    if (nextCell && nextCell.type === 'receiver') {
      money++; bankIncome++;
      nextCell.flash = 12;
      popups.push({ wx: nx + 0.5, wy: ny - 0.2, life: 40 });
      remove.push(i);
      continue;
    }

    // LED: charge — only if the electron's color matches the LED's required color
    if (nextCell && nextCell.type === 'led') {
      // Directional LED: only accept electrons arriving from the correct direction
      if (nextCell.dir != null && it.dir !== nextCell.dir) { remove.push(i); continue; }
      const matches = !nextCell.color || it.color === nextCell.color;
      if (matches) {
        nextCell.charge = Math.min(LED_MAX_CHARGE, nextCell.charge + 1);
        nextCell.flash = 8;
        if (challengeStartFrame < 0) challengeStartFrame = frame;
        totalElectrons++;
        // Move into LED tile for wire-stub entry animation
        it.cx = nx; it.cy = ny;
        it.progress = 0;
        it.enteringLed = true;
      } else {
        nextCell.flash = -6;
        popups.push({ wx: nx + 0.5, wy: ny - 0.4, life: 36, text: 'WRONG COLOR' });
        remove.push(i);
      }
      continue;
    }

    // LED Screen: electrons travel through the screen lighting each pixel in their row/column.
    // On the last pixel (next tile in direction is no longer a screen tile) the electron is absorbed.
    if (nextCell && (nextCell.type === 'ledscreen' || nextCell.type === 'ledscreen_part')) {
      // Don't enter if another electron is already at the leading edge of that tile
      const blocked = items.some((it2, j) =>
        j !== i && it2.cx === nx && it2.cy === ny && it2.progress < 0.15
      );
      if (blocked) { it.progress = 0.99; continue; }
      // Light this pixel
      const mainCell = nextCell.type === 'ledscreen'
        ? nextCell
        : getG(nextCell.originX, nextCell.originY);
      if (mainCell && mainCell.pixels) {
        const idx = nextCell.type === 'ledscreen' ? 0 : nextCell.pixelIdx;
        mainCell.pixels[idx] = Math.min(SCREEN_PIXEL_MAX, (mainCell.pixels[idx] || 0) + 1);
        if (it.color) mainCell.pixelColors[idx] = it.color;
        mainCell.flash = 8;
      }
      // Check whether the tile one step further is still inside the screen
      const [cdx, cdy] = DIR_VEC[it.dir];
      const nx2 = nx + cdx, ny2 = ny + cdy;
      const beyond = inBnd(nx2, ny2) ? getG(nx2, ny2) : null;
      const stillInScreen = beyond && (beyond.type === 'ledscreen' || beyond.type === 'ledscreen_part');
      if (stillInScreen) {
        // More pixels ahead — move into this tile and keep going.
        // Screen traversal is exempt from lifespan: the electron must reach the
        // far edge regardless of how long the wire before the screen was.
        // Natural absorption happens at the last pixel below.
        it.cx = nx; it.cy = ny;
      } else {
        // Last pixel in the beam — move here then let the electron linger for a few
        // frames so the screen-pixel update (which runs AFTER item removal) still sees
        // it occupying this tile and keeps the pixel lit.  Without this the pixel was
        // removed from items before the update ran and instantly went dark.
        it.cx = nx; it.cy = ny;
        it.fading   = true;
        it.fadeTick = 4;
      }
      continue;
    }

    // Colorizer: tints the passing electron to its selected color
    if (nextCell && nextCell.type === 'colorizer') {
      const blocked = items.some((it2, j) =>
        j !== i && it2.cx === nx && it2.cy === ny && it2.progress < 0.15
      );
      if (blocked) { it.progress = 0.99; continue; }
      it.cx = nx; it.cy = ny;
      it.dir = nextCell.dir;   // redirect like a belt
      it.color = nextCell.color;
      nextCell.flash = 8;
      it.dist = (it.dist || 0) + 1;
      if (it.dist >= ELECTRON_LIFESPAN) { it.fading = true; it.fadeTick = ELECTRON_FADE_FRAMES; }
      continue;
    }

    // Delay: pass-through that holds the electron for its configured duration before releasing it onward
    // Only accepts electrons entering from the input side (moving in the same direction as cell.dir)
    if (nextCell && nextCell.type === 'delay') {
      if (it.dir !== nextCell.dir) { remove.push(i); continue; }
      const blocked = items.some((it2, j) =>
        j !== i && it2.cx === nx && it2.cy === ny && it2.progress < 0.15
      );
      if (blocked) { it.progress = 0.99; continue; }
      it.cx = nx; it.cy = ny;
      it.dir = nextCell.dir;
      it.waitTick = Math.round((nextCell.delaySec ?? 0.2) * 60);
      nextCell.flash = 8;
      it.dist = (it.dist || 0) + 1;
      if (it.dist >= ELECTRON_LIFESPAN) { it.fading = true; it.fadeTick = ELECTRON_FADE_FRAMES; }
      continue;
    }

    // Button: passes electrons straight through when ON; blocks only electrons entering from the facing (closed) side
    if (nextCell && nextCell.type === 'button') {
      if (it.dir === (nextCell.dir + 2) % 4) { it.progress = 0.99; continue; } // block electrons entering from the facing side
      if (!nextCell.on) { nextCell.flash = -6; remove.push(i); continue; } // gate is closed — kill the electron
      const blocked = items.some((it2, j) =>
        j !== i && it2.cx === nx && it2.cy === ny && it2.progress < 0.15
      );
      if (blocked) { it.progress = 0.99; continue; }
      it.cx = nx; it.cy = ny;
      // pass straight through — keep same direction
      nextCell.flash = 6;
      it.dist = (it.dist || 0) + 1;
      if (it.dist >= ELECTRON_LIFESPAN) { it.fading = true; it.fadeTick = ELECTRON_FADE_FRAMES; }
      continue;
    }

    // Trigate: 3-channel synchronized gate
    // When OFF: electrons are blocked before the gate tile entirely.
    // When ON: each electron snaps onto its channel tile and waits.
    //   As soon as ALL 3 channels hold an electron they fire simultaneously —
    //   the gate never releases a partial batch.
    if (nextCell && (nextCell.type === 'trigate' || nextCell.type === 'trigate_part')) {
      const main = nextCell.type === 'trigate' ? nextCell : getG(nextCell.originX, nextCell.originY);
      if (!main) continue;
      // Block electrons coming FROM the output side (traveling against the gate's flow)
      if (it.dir === (main.dir + 2) % 4) { it.progress = 0.99; continue; }
      // Gate OFF — kill electrons that reach it
      if (!main.on) { main.flash = -6; remove.push(i); continue; }
      // Channel already occupied — hold the approaching electron back
      const occupied = items.some((it2, j) => j !== i && it2.cx === nx && it2.cy === ny);
      if (occupied) { it.progress = 0.99; continue; }
      // Snap electron into channel, redirect to gate's flow direction, and park until all 3 fill
      it.cx = nx; it.cy = ny;
      it.dir = main.dir;
      it.progress = 0;
      it.waitTick = 0x7FFFFFFF;
      it.dist = (it.dist || 0) + 1;
      if (it.dist >= ELECTRON_LIFESPAN) { it.fading = true; it.fadeTick = ELECTRON_FADE_FRAMES; }
      // Check if all 3 channels are now loaded — if so, fire simultaneously
      const isH = (main.dir === DIR.U || main.dir === DIR.D);
      let filled = 0;
      for (let ci = 0; ci < 3; ci++) {
        const tx = isH ? main.originX + ci : main.originX;
        const ty = isH ? main.originY      : main.originY + ci;
        if (items.some(z => z.cx === tx && z.cy === ty && z.dir === main.dir)) filled++;
      }
      if (filled === 3) {
        for (let ci = 0; ci < 3; ci++) {
          const tx = isH ? main.originX + ci : main.originX;
          const ty = isH ? main.originY      : main.originY + ci;
          for (const z of items) {
            if (z.cx === tx && z.cy === ty && z.dir === main.dir) z.waitTick = 0;
          }
        }
        main.flash = 14;
      }
      continue;
    }

    // Switch: lock exit direction on entry, then auto-toggle for the next electron
    if (nextCell && nextCell.type === 'switch') {
      const blocked = items.some((it2, j) =>
        j !== i && it2.cx === nx && it2.cy === ny && it2.progress < 0.15
      );
      if (blocked) { it.progress = 0.45; it.waitTick = 20; continue; }
      it.cx = nx; it.cy = ny;
      it.dir = nextCell.state === 0
        ? (nextCell.dir + 3) % 4   // outputA (e.g. left, when input is from the bottom)
        : (nextCell.dir + 1) % 4;  // outputB (e.g. right, when input is from the bottom)
      nextCell.armFromDir = it.dir;   // it.dir is already the exit direction locked above
      nextCell.armFlipFrame = frame;
      nextCell.state = 1 - nextCell.state;   // flip so the NEXT electron routes the other way
      nextCell.flash = 10;
      it.dist = (it.dist || 0) + 1;
      if (it.dist >= ELECTRON_LIFESPAN) { it.fading = true; it.fadeTick = ELECTRON_FADE_FRAMES; }
      continue;
    }

    // Battery: charges when the electron arrives from the input side (opposite the discharge `dir`);
    // on/off only affects discharge, not charging
    if (nextCell && nextCell.type === 'battery') {
      const battDir = nextCell.dir ?? DIR.U;
      if (it.dir === battDir) {
        // Entering from the negative (input) terminal — charge the battery
        nextCell.charge = Math.min(BATTERY_MAX, nextCell.charge + 1);
        nextCell.color  = it.color;
        nextCell.flash  = 8;
        remove.push(i);
      } else if (it.dir === (battDir + 2) % 4) {
        // Entering from the positive (output) terminal — backwards flow, destroy the electron
        remove.push(i);
      } else {
        // Entering from a perpendicular side — battery is mis-oriented; stall the electron
        it.progress = 0.45; it.waitTick = 20;
      }
      continue;
    }

    // Belt: advance
    if (nextCell && nextCell.type === 'belt') {
      const blocked = items.some((it2, j) =>
        j !== i && it2.cx === nx && it2.cy === ny && it2.progress < 0.15
      );
      if (blocked) { it.progress = 0.99; continue; }
      it.cx = nx;
      it.cy = ny;
      it.dir = nextCell.dir;
      it.dist = (it.dist || 0) + 1;
      if (it.dist >= ELECTRON_LIFESPAN) { it.fading = true; it.fadeTick = ELECTRON_FADE_FRAMES; }
      continue;
    }

    // No component in target cell — kill the electron
    if (!nextCell) { remove.push(i); continue; }

    // Impassable building (miner, etc.) — freeze inside cell, retry later
    it.progress = 0.45;
    it.waitTick  = 20;
  }

  // Remove in reverse order
  for (let i = remove.length - 1; i >= 0; i--) items.splice(remove[i], 1);

  // ── Collision: electrons whose rendered positions overlap kill each other (except on battery / near switches) ──
  // Use actual world-space positions (same formula as drawItem) so electrons in
  // neighboring cells moving toward each other are also detected, not just same-cell pairs.
  const COLLIDE_D2 = 0.05; // squared distance threshold — roughly two glow radii touching
  // An electron currently inside a switch, or about to step into one, shouldn't be eligible
  // for collision-cancellation — otherwise two electrons arriving close together can wipe
  // each other out right at the switch's boundary before each gets to register its pass
  // (which is what flips the switch's routing). Skipping collision here guarantees every
  // electron that reaches a switch actually passes through and toggles it.
  const nearSwitch = it => {
    const cell = getG(it.cx, it.cy);
    if (cell && cell.type === 'switch') return true;
    const [ndx, ndy] = DIR_VEC[it.dir];
    const next = getG(it.cx + ndx, it.cy + ndy);
    return !!(next && next.type === 'switch');
  };
  // An electron currently inside a battery, OR about to step into one, is exempt from
  // collision — otherwise two streams converging on the same battery from adjacent cells
  // can overlap and wipe each other out a hair before either one actually registers its
  // charge, silently under-counting the very thing the user is feeding in.
  const nearBattery = it => {
    const cell = getG(it.cx, it.cy);
    if (cell && cell.type === 'battery') return true;
    const [ndx, ndy] = DIR_VEC[it.dir];
    const next = getG(it.cx + ndx, it.cy + ndy);
    if (next && next.type === 'battery') return true;
    // Electrons with negative progress are still visually inside the battery tile — exempt them too
    if (it.progress < 0) {
      const behind = getG(it.cx - ndx, it.cy - ndy);
      if (behind && behind.type === 'battery') return true;
    }
    return false;
  };
  // An electron currently parked inside a delay module (waiting out its hold), or about to
  // step into one, is exempt from collision — multiple electrons queued on/around the same
  // delay tile sit at nearly identical positions while frozen, and would otherwise wipe each
  // other out instead of each being held and released on schedule as the module promises.
  const nearDelay = it => {
    const cell = getG(it.cx, it.cy);
    if (cell && cell.type === 'delay') return true;
    const [ndx, ndy] = DIR_VEC[it.dir];
    const next = getG(it.cx + ndx, it.cy + ndy);
    return !!(next && next.type === 'delay');
  };
  // Electrons converging on the same LED screen pixel are each valid charges — exempt from cancellation
  const nearScreen = it => {
    const cell = getG(it.cx, it.cy);
    if (cell && (cell.type === 'ledscreen' || cell.type === 'ledscreen_part')) return true;
    const [ndx, ndy] = DIR_VEC[it.dir];
    const next = getG(it.cx + ndx, it.cy + ndy);
    return !!(next && (next.type === 'ledscreen' || next.type === 'ledscreen_part'));
  };
  const worldPos = items.map(it => {
    const [dx, dy] = (it.progress < 0 && it.entryDir != null) ? DIR_VEC[it.entryDir] : DIR_VEC[it.dir];
    return [it.cx + 0.5 + dx * it.progress, it.cy + 0.5 + dy * it.progress];
  });
  const collide = new Set();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      // Only compare electrons that are in or near each other's cells
      if (Math.abs(a.cx - b.cx) > 1 || Math.abs(a.cy - b.cy) > 1) continue;
      const cellA = getG(a.cx, a.cy), cellB = getG(b.cx, b.cy);
      if ((cellA && cellA.type === 'battery') || (cellB && cellB.type === 'battery')) continue; // batteries absorb all
      if (nearBattery(a) || nearBattery(b)) continue; // let every electron reach & charge the battery — none should be lost to a last-instant collision
      if (nearDelay(a)  || nearDelay(b))  continue; // let every electron be held & released by the delay module on schedule, not cancelled while queued
      if (nearScreen(a) || nearScreen(b)) continue; // every electron reaching a screen pixel is a valid charge — don't let convergence cancel them
      if (nearSwitch(a) || nearSwitch(b)) continue; // let every electron reach & toggle the switch
      { const ca = getG(a.cx, a.cy), cb = getG(b.cx, b.cy); if ((ca && (ca.type==='trigate'||ca.type==='trigate_part')) || (cb && (cb.type==='trigate'||cb.type==='trigate_part'))) continue; } // 3 channels gate — each channel valid
      const [ax, ay] = worldPos[i], [bx, by] = worldPos[j];
      const dx = ax - bx, dy = ay - by;
      if (dx * dx + dy * dy > COLLIDE_D2) continue; // not actually overlapping
      collide.add(i);
      collide.add(j);
    }
  }
  [...collide].sort((a, b) => b - a).forEach(i => items.splice(i, 1));

  // ── Flash decay (all buildings) ──
  for (const cell of grid.values()) {
    if (cell.flash > 0) cell.flash--;
    else if (cell.flash < 0) cell.flash++;
  }

  // ── Popup decay ──
  popups = popups.filter(p => { p.life--; p.wy -= 0.008; return p.life > 0; });

  // ── LED drain ──
  for (const cell of grid.values()) {
    if (cell.type === 'led') {
      cell.charge = Math.max(0, cell.charge - LED_DRAIN);
    }
  }

  // ── LED Screen pixel presence — pixels are lit only while an electron is physically on them ──
  // Build a set of occupied tile keys once, then flip each pixel on/off in O(1) per pixel.
  {
    const occupied = new Map();   // tileKey → electron color (for per-pixel color memory)
    for (const it of items) occupied.set(key(it.cx, it.cy), it.color || null);
    for (const cell of grid.values()) {
      if (cell.type !== 'ledscreen' || !cell.pixels) continue;
      for (let dy = 0; dy < SCREEN_SIZE; dy++) {
        for (let dx = 0; dx < SCREEN_SIZE; dx++) {
          const idx = dy * SCREEN_SIZE + dx;
          const tk  = key(cell.originX + dx, cell.originY + dy);
          const muted = cell.pixelMuted && cell.pixelMuted[idx];
          if (occupied.has(tk) && !muted) {
            cell.pixels[idx] = SCREEN_PIXEL_MAX;
            const c = occupied.get(tk);
            if (c) cell.pixelColors[idx] = c;   // update remembered color while electron is live
          } else {
            cell.pixels[idx] = Math.max(0, (cell.pixels[idx] || 0) - SCREEN_DRAIN);
          }
        }
      }
    }
  }

  // ── Challenge: hold timer + win check (skipped in playpen) ──
  if (!challengeWon && !isPlaypen) {
    let winCondMet = false;
    let holdTarget = WIN_HOLD_FRAMES;
    if (currentJob && currentJob.isPuzzle) {
      // Puzzle mode: all locked LEDs on the grid must reach charge threshold
      const puzzleLeds = [...grid.values()].filter(c => c.type === 'led' && c.locked);
      winCondMet = puzzleLeds.length > 0 && puzzleLeds.every(c => c.charge >= LED_LIT_THRESH);
      holdTarget = currentJob.winHold ?? 180;
      if (winCondMet && challengeStartFrame < 0) challengeStartFrame = frame;
    } else if (activeLedCount === 0) {
      if (currentJob && currentJob.fillBattery) {
        // Battery-fill job: win when any placed battery reaches BATTERY_MAX charge
        const maxCharge = Math.max(0, ...Array.from(grid.values())
          .filter(c => c.type === 'battery').map(c => c.charge ?? 0));
        winCondMet = jobRequirementsMet() && maxCharge >= BATTERY_MAX;
        holdTarget = 60; // 1s so "FULLY CHARGED" text is visible
        if (jobRequirementsMet() && challengeStartFrame < 0 && maxCharge > 0)
          challengeStartFrame = frame;
      } else if (currentJob && currentJob.earn) {
        // Earn-target job: win when circuit generates the required credits
        winCondMet = jobRequirementsMet() && bankIncome >= currentJob.earn;
        holdTarget = 60;
        if (jobRequirementsMet() && challengeStartFrame < 0 && bankIncome > 0)
          challengeStartFrame = frame;
      } else {
        // Generic no-LED job: win by holding steady electron flow for a few seconds
        winCondMet = jobRequirementsMet() && money > challengeStartMoney;
        holdTarget = NO_LED_WIN_FRAMES;
        if (winCondMet && challengeStartFrame < 0) challengeStartFrame = frame;
      }
    } else {
      // LED cells sit at bottom-centre of their 4×4 footprint (pos.x+1, pos.y+3),
      // not at the top-left origin stored in LED_POSITIONS.
      const leds = LED_POSITIONS.slice(0, activeLedCount).map(p =>
        getG(p.x + Math.floor((LED_SIZE - 1) / 2), p.y + LED_SIZE - 1)
      ).filter(Boolean);
      winCondMet = leds.length === activeLedCount
                && leds.every(c => c.charge >= LED_LIT_THRESH)
                && jobRequirementsMet();
    }
    if (winCondMet) {
      allLitTimer++;
      if (allLitTimer >= holdTarget) {
        challengeWon = true;
        winFrame = frame;
        triggerWin();
      }
    } else {
      allLitTimer = Math.max(0, allLitTimer - 1);
    }
  }

  // ── Job countdown ──
  if (currentJob && currentJob.timeLimit && !challengeWon && jobTimeLeft > 0) {
    jobTimeLeft--;
    if (jobTimeLeft <= 0) {
      jobTimeLeft = 0;
      failJob();
    }
  }

  // ── Money rate (per second @ ~60fps) — not tracked in the playpen ──
  if (!isPlaypen && frame % 60 === 0) {
    moneyRate = money - moneyLast;
    moneyLast = money;
    document.getElementById('moneyRate').textContent =
      moneyRate > 0 ? `+$${moneyRate}/s` : '$0/s';
  }
}

// ═══════════════════════════════════════════════════════════════
// RENDERING
// ═══════════════════════════════════════════════════════════════

function render() {
  ctx.clearRect(0, 0, W, H);

  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(cam.x, cam.y);

  const wPx = WORLD_W * TILE;
  const hPx = WORLD_H * TILE;

  // ── World background ──
  ctx.fillStyle = PAL.bg;
  ctx.fillRect(0, 0, wPx, hPx);

  // ── Component Area ── (outer ring of blocks — tinted, holds the level's LEDs)
  const cmPx = COMPONENT_MARGIN * TILE;
  ctx.fillStyle = PAL.componentArea;
  ctx.fillRect(0, 0, wPx, cmPx);                                   // top strip
  ctx.fillRect(0, hPx - cmPx, wPx, cmPx);                          // bottom strip
  ctx.fillRect(0, cmPx, cmPx, hPx - 2*cmPx);                       // left strip
  ctx.fillRect(wPx - cmPx, cmPx, cmPx, hPx - 2*cmPx);              // right strip

  // Dashed divider separating the component area from the factory floor
  ctx.strokeStyle = PAL.componentAreaBorder;
  ctx.lineWidth = 1.5 / cam.zoom;
  ctx.setLineDash([6 / cam.zoom, 4 / cam.zoom]);
  ctx.strokeRect(cmPx, cmPx, wPx - 2*cmPx, hPx - 2*cmPx);
  ctx.setLineDash([]);

  // Label
  ctx.fillStyle = PAL.componentAreaLabel;
  ctx.font = `${11 / cam.zoom}px monospace`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('COMPONENT AREA', 6 / cam.zoom, 6 / cam.zoom);

  // ── Blueprint grid ──
  const lw = 1 / cam.zoom;
  ctx.lineWidth = lw;

  for (let x = 0; x <= WORLD_W; x++) {
    ctx.strokeStyle = (x % 8 === 0) ? PAL.gridMajor : PAL.grid;
    ctx.lineWidth = (x % 8 === 0) ? 1.5 / cam.zoom : lw;
    ctx.beginPath();
    ctx.moveTo(x * TILE, 0);
    ctx.lineTo(x * TILE, hPx);
    ctx.stroke();
  }
  for (let y = 0; y <= WORLD_H; y++) {
    ctx.strokeStyle = (y % 8 === 0) ? PAL.gridMajor : PAL.grid;
    ctx.lineWidth = (y % 8 === 0) ? 1.5 / cam.zoom : lw;
    ctx.beginPath();
    ctx.moveTo(0, y * TILE);
    ctx.lineTo(wPx, y * TILE);
    ctx.stroke();
  }

  // Crosshairs at major intersections
  ctx.fillStyle = 'rgba(70,140,255,0.25)';
  for (let x = 0; x <= WORLD_W; x += 8) {
    for (let y = 0; y <= WORLD_H; y += 8) {
      ctx.fillRect(x * TILE - 1.5 / cam.zoom, y * TILE - 0.5 / cam.zoom, 3 / cam.zoom, 1 / cam.zoom);
      ctx.fillRect(x * TILE - 0.5 / cam.zoom, y * TILE - 1.5 / cam.zoom, 1 / cam.zoom, 3 / cam.zoom);
    }
  }

  // ── World border ──
  ctx.strokeStyle = PAL.bgBorder;
  ctx.lineWidth = 2 / cam.zoom;
  ctx.setLineDash([8 / cam.zoom, 4 / cam.zoom]);
  ctx.strokeRect(0, 0, wPx, hPx);
  ctx.setLineDash([]);

  // ── Ore deposits ──
  for (const k of ores) {
    const [ox, oy] = k.split(',').map(Number);
    if (!getG(ox, oy)) drawOre(ox, oy);
  }
  for (const k of burntVeins) {
    const [ox, oy] = k.split(',').map(Number);
    if (!getG(ox, oy)) drawBurntVein(ox, oy);
  }

  // ── Buildings ──
  for (const [k, cell] of grid) {
    const [bx, by] = k.split(',').map(Number);
    if      (cell.type === 'belt')     drawBelt(bx, by, cell);
    else if (cell.type === 'miner')    drawMiner(bx, by, cell);
    else if (cell.type === 'receiver')               drawReceiver(bx, by, cell);
    else if (cell.type === 'battery')  drawBattery(bx, by, cell);
    else if (cell.type === 'switch')   drawSwitch(bx, by, cell);
    else if (cell.type === 'colorizer') drawColorizer(bx, by, cell);
    else if (cell.type === 'delay')     drawDelay(bx, by, cell);
    else if (cell.type === 'button')    drawButton(bx, by, cell);
    else if (cell.type === 'trigate')   drawTrigate(bx, by, cell);
    // trigate_part: rendered by drawTrigate on the anchor tile — nothing to draw here
    else if (cell.type === 'led')                    drawLED(bx, by, cell);
    else if (cell.type === 'ledscreen')              drawLEDScreenBg(bx, by, cell);

    // Marching-ants border on directly-interactable nodes (click to toggle / purchase)
    if (cell.type === 'battery' || (cell.type === 'colorizer' && !colorizerCommitted(cell)) || cell.type === 'delay' ||
        cell.type === 'button'  ||
        (cell.type === 'miner' && minerTier(cell) < MINER_MAX_TIER && money >= MINER_UPGRADE_COSTS[minerTier(cell)])) {
      drawInteractBorder(bx, by);
    }
    // Trigate gets one unified border spanning all 3 tiles (drawn on anchor cell only)
    if (cell.type === 'trigate') {
      drawTrigateBorder(bx, by, cell);
    }
  }

  // ── Items ──
  for (const it of items) drawItem(it);

  // ── LED Screen pixels (drawn after items so the glowing dots sit behind the pixel layer) ──
  for (const [k, cell] of grid) {
    if (cell.type === 'ledscreen') {
      const [bx, by] = k.split(',').map(Number);
      drawLEDScreenPixels(bx, by, cell);
    }
  }

  // ── Hover preview ──
  if (hovCell && inBnd(hovCell.x, hovCell.y)) {
    drawHover(hovCell.x, hovCell.y);
  }

  // ── Popups ──
  for (const p of popups) {
    const alpha = Math.min(1, p.life / 40);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = PAL.popupColor;
    ctx.font = `bold ${11 / cam.zoom}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.text || '+$1', p.wx * TILE, p.wy * TILE);
    ctx.restore();
  }

  ctx.restore();

  // ── Screen-space vignette — darkens the corners/edges of the viewport ──
  const vg = ctx.createRadialGradient(
    W / 2, H / 2, Math.min(W, H) * 0.32,
    W / 2, H / 2, Math.max(W, H) * 0.72
  );
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,4,12,0.5)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

// ── Rounded rect helper ──
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ── Blueprint hatch fill helper ──
function hatch(x, y, w, h, color, spacing = 7, angle = Math.PI / 4) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth   = 0.7;
  const d = Math.ceil(Math.sqrt(w * w + h * h)) + spacing * 2;
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(angle);
  for (let i = -d; i <= d; i += spacing) {
    ctx.beginPath();
    ctx.moveTo(i, -d);
    ctx.lineTo(i,  d);
    ctx.stroke();
  }
  ctx.restore();
}

// ── Helper: edges feeding into cell (x,y) ──
function inputEdges(x, y) {
  const cx2 = (x + 0.5) * TILE, cy2 = (y + 0.5) * TILE;
  const edges = [];
  for (const [dx, dy, d] of [[-1,0,DIR.R],[0,-1,DIR.D],[1,0,DIR.L],[0,1,DIR.U]]) {
    const nb = getG(x+dx, y+dy);
    // Belt, miner, or battery pointing toward this cell (battery discharges from its `dir` side)
    if (nb && (nb.type==='belt'||nb.type==='miner'||nb.type==='battery'||nb.type==='delay') && nb.dir===d)
      edges.push({ ex: cx2 + dx*TILE/2, ey: cy2 + dy*TILE/2 });
    // Button: 3-open-side gate — connects on all sides except the facing (input) side
    if (nb && nb.type==='button' && d !== (nb.dir + 2) % 4)
      edges.push({ ex: cx2 + dx*TILE/2, ey: cy2 + dy*TILE/2 });
    // Trigate: draws wire on input side (d === gate's flow dir) and output side (d === opposite)
    if (nb && (nb.type==='trigate'||nb.type==='trigate_part')) {
      const mg = nb.type==='trigate' ? nb : getG(nb.originX, nb.originY);
      if (mg && (d === mg.dir || d === (mg.dir + 2) % 4))
        edges.push({ ex: cx2 + dx*TILE/2, ey: cy2 + dy*TILE/2 });
    }
    // Colorizer: bidirectional on its axis — connects both sides (R/L axis, or U/D axis)
    if (nb && nb.type==='colorizer' && nb.dir % 2 === d % 2)
      edges.push({ ex: cx2 + dx*TILE/2, ey: cy2 + dy*TILE/2 });
    // Switch: always connect to both output sides and the input side
    if (nb && nb.type==='switch') {
      const outA = (nb.dir + 3) % 4;
      const outB = (nb.dir + 1) % 4;
      const inp  = (nb.dir + 2) % 4;
      if (d === outA || d === outB || d === inp)
        edges.push({ ex: cx2 + dx*TILE/2, ey: cy2 + dy*TILE/2 });
    }
  }
  return edges;
}

// ── Shared: depletion ring for a Power Point at (x,y), drawn at the given radius ──
function drawVeinDepletionRing(x, y, cx2, cy2, radius) {
  const vInfo = veinYield.get(key(x, y));
  if (!vInfo) return;
  const ratio = Math.max(0, Math.min(1, vInfo.remaining / vInfo.total));
  const ringColor = ratio > 0.5
    ? 'rgba(90,220,140,0.6)'
    : (ratio > 0.2 ? 'rgba(255,190,70,0.65)' : 'rgba(255,90,90,0.7)');
  // Faint full-circle track so the ring reads clearly against busy backgrounds
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(cx2, cy2, radius, 0, Math.PI*2); ctx.stroke();
  // Filled portion = remaining charge
  ctx.strokeStyle = ringColor;
  ctx.lineWidth = 1.8; ctx.lineCap = 'round';
  if (ratio < 0.25) { ctx.shadowColor = ringColor; ctx.shadowBlur = 5; }
  ctx.beginPath();
  ctx.arc(cx2, cy2, radius, -Math.PI/2, -Math.PI/2 + ratio * Math.PI*2);
  ctx.stroke();
  ctx.lineCap = 'butt'; ctx.shadowBlur = 0;
}

// ── Power Point (buildable power-source tile — drop an Extractor on it) ──
function drawOre(x, y) {
  const px = x * TILE, py = y * TILE, T = TILE;
  const cx2 = px + T/2, cy2 = py + T/2;

  // Subtle fill + hatch
  ctx.fillStyle = PAL.oreBg;
  ctx.fillRect(px+3, py+3, T-6, T-6);
  hatch(px+3, py+3, T-6, T-6, PAL.oreHatch, 9);

  // Dashed border
  ctx.strokeStyle = PAL.oreBorder;
  ctx.lineWidth = 0.8;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(px+3.5, py+3.5, T-7, T-7);
  ctx.setLineDash([]);

  // Voltage-source symbol: circle with + inside
  ctx.strokeStyle = PAL.oreMarker;
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(cx2, cy2, 7, 0, Math.PI*2); ctx.stroke();
  ctx.lineWidth = 1.5; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx2-4, cy2); ctx.lineTo(cx2+4, cy2);
  ctx.moveTo(cx2, cy2-4); ctx.lineTo(cx2, cy2+4);
  ctx.stroke();
  ctx.lineCap = 'butt';

  // Depletion ring — shows remaining extraction budget before the vein burns out
  // (only drawn here when there's no miner on top; drawMiner renders its own
  // larger ring outside the component body so it stays visible)
  if (!getG(x, y)) drawVeinDepletionRing(x, y, cx2, cy2, 10);

  // Vertical power-rail tick at top edge
  ctx.strokeStyle = 'rgba(80,150,255,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx2, py+3); ctx.lineTo(cx2, cy2-7);
  ctx.stroke();

  // "VCC" corner label
  ctx.fillStyle = 'rgba(70,140,255,0.32)';
  ctx.font = '7px monospace';
  ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  ctx.fillText('VCC', px+T-5, py+T-5);
}

// ── Burnt-out Power Point (depleted — scorched, dead patch) ──
function drawBurntVein(x, y) {
  const px = x * TILE, py = y * TILE, T = TILE;
  const cx2 = px + T/2, cy2 = py + T/2;

  ctx.fillStyle = 'rgba(40,34,32,0.55)';
  ctx.fillRect(px+3, py+3, T-6, T-6);
  hatch(px+3, py+3, T-6, T-6, 'rgba(90,70,60,0.25)', 9);

  ctx.strokeStyle = 'rgba(120,90,80,0.4)';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(px+3.5, py+3.5, T-7, T-7);
  ctx.setLineDash([]);

  // Cracked/scorched circle with an X — burnt-out marker
  ctx.strokeStyle = 'rgba(200,90,70,0.45)';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(cx2, cy2, 7, 0, Math.PI*2); ctx.stroke();
  ctx.lineWidth = 1.5; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx2-3.5, cy2-3.5); ctx.lineTo(cx2+3.5, cy2+3.5);
  ctx.moveTo(cx2+3.5, cy2-3.5); ctx.lineTo(cx2-3.5, cy2+3.5);
  ctx.stroke();
  ctx.lineCap = 'butt';

  ctx.fillStyle = 'rgba(200,110,90,0.4)';
  ctx.font = '7px monospace';
  ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  ctx.fillText('DEAD', px+T-5, py+T-5);
}

// ── Belt (PCB trace wire) ──
function drawBelt(x, y, cell) {
  const px = x * TILE, py = y * TILE, T = TILE;
  const cx2 = px+T/2, cy2 = py+T/2;
  const [odx, ody] = DIR_VEC[cell.dir];
  const inE = inputEdges(x, y);

  ctx.strokeStyle = PAL.beltBorder;
  ctx.lineWidth   = 2.5;
  ctx.lineCap     = 'round';

  // Input trace(s) → center
  for (const e of inE) {
    ctx.beginPath(); ctx.moveTo(e.ex, e.ey); ctx.lineTo(cx2, cy2); ctx.stroke();
  }
  // Faint stub if isolated (so solo belts are still legible)
  if (!inE.length) {
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.moveTo(cx2 - odx*T*0.22, cy2 - ody*T*0.22);
    ctx.lineTo(cx2, cy2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // Center → output edge
  ctx.beginPath();
  ctx.moveTo(cx2, cy2);
  ctx.lineTo(cx2 + odx*T/2, cy2 + ody*T/2);
  ctx.stroke();

  // Junction node dot
  ctx.fillStyle   = PAL.beltBorder;
  ctx.globalAlpha = inE.length ? 0.9 : 0.35;
  ctx.beginPath(); ctx.arc(cx2, cy2, 2.5, 0, Math.PI*2); ctx.fill();
  ctx.globalAlpha = 1;

  // Directional chevron at ~65% along output segment
  const ax = cx2 + odx*T*0.33, ay = cy2 + ody*T*0.33;
  ctx.strokeStyle = PAL.beltChevron;
  ctx.lineWidth   = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(DIR_ANGLE[cell.dir]);
  ctx.beginPath();
  ctx.moveTo(-5, -4); ctx.lineTo(0, 0); ctx.lineTo(-5, 4);
  ctx.stroke();
  ctx.restore();
}

// ── Miner (IEEE current-source symbol) ──
function drawMiner(x, y, cell) {
  const px = x * TILE, py = y * TILE, T = TILE;
  const cx2 = px+T/2, cy2 = py+T/2;
  const [dx, dy] = DIR_VEC[cell.dir];
  const R = 12;

  if (cell.burntOut) drawBurntVein(x, y);  // depleted vein — scorched patch beneath
  else drawOre(x, y);  // show source patch beneath

  // Vein depletion ring — drawn out beyond the component body/progress arc so it
  // stays visible even though the miner sits directly on top of the vein tile
  drawVeinDepletionRing(x, y, cx2, cy2, R + 8);

  // Terminal lead: circle edge → cell output edge
  const outX = cx2 + dx*T/2, outY = cy2 + dy*T/2;
  ctx.strokeStyle = PAL.minerBorder;
  ctx.lineWidth   = 2.5; ctx.lineCap = 'square';
  ctx.beginPath();
  ctx.moveTo(cx2 + dx*R, cy2 + dy*R);
  ctx.lineTo(outX, outY);
  ctx.stroke();
  // Terminal dot at cell edge
  ctx.fillStyle = PAL.minerBorder;
  ctx.beginPath(); ctx.arc(outX, outY, 2.5, 0, Math.PI*2); ctx.fill();
  // Exit chevron — cyan, points OUT through this edge: generated electrons leave here
  // (an Extractor has no input side — it draws straight from the Power Point beneath it,
  // and the chevron hides once a belt/wire is actually connected on that side)
  if (cell.preview && !getG(x + dx, y + dy)) drawPortArrow(outX, outY, dx, dy, PAL.portOut, 4);

  // Progress arc (outer ring, fills as mine cycle progresses)
  const effRate = MINE_RATE / MINER_UPGRADE_MULTS[minerTier(cell)];
  const prog = (cell.tick||0) / effRate;
  ctx.strokeStyle = 'rgba(60,120,220,0.18)';
  ctx.lineWidth   = 2.5; ctx.lineCap = 'butt';
  ctx.beginPath(); ctx.arc(cx2, cy2, R+4, 0, Math.PI*2); ctx.stroke();
  if (prog > 0) {
    if (prog > 0.85) { ctx.shadowColor = PAL.minerAccent; ctx.shadowBlur = 8; }
    ctx.strokeStyle = PAL.minerAccent;
    ctx.lineWidth   = 2.5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx2, cy2, R+4, -Math.PI/2, -Math.PI/2 + Math.PI*2*prog);
    ctx.stroke();
    ctx.lineCap = 'butt'; ctx.shadowBlur = 0;
  }

  // Component circle body
  ctx.fillStyle   = PAL.minerFill;
  ctx.beginPath(); ctx.arc(cx2, cy2, R, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = PAL.minerBorder; ctx.lineWidth = 1.8;
  ctx.stroke();

  // Arrow inside circle (current direction)
  ctx.strokeStyle = PAL.minerAccent;
  ctx.lineWidth   = 1.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.save();
  ctx.translate(cx2, cy2); ctx.rotate(DIR_ANGLE[cell.dir]);
  ctx.beginPath();
  ctx.moveTo(-6, 0); ctx.lineTo(4, 0);    // shaft
  ctx.moveTo(1, -3.5); ctx.lineTo(5, 0); ctx.lineTo(1, 3.5);  // head
  ctx.stroke();
  ctx.restore();

  // "SRC" label above the component
  ctx.fillStyle = 'rgba(120,200,255,0.5)';
  ctx.font = 'bold 7px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText('SRC', cx2, cy2 - R - 6);

  // Upgrade badge — shows current speed tier, plus the next purchasable tier (if any)
  const tier = minerTier(cell);
  const mult = MINER_UPGRADE_MULTS[tier];
  ctx.textAlign = 'center';
  if (tier > 0) {
    ctx.fillStyle = 'rgba(255,200,60,0.95)';
    ctx.font = 'bold 8px monospace';
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(255,200,60,0.6)'; ctx.shadowBlur = 6;
    ctx.fillText(`⚡${mult}x`, cx2, cy2 + R + 4);
    ctx.shadowBlur = 0;
  }
  if (tier < MINER_MAX_TIER) {
    const cost   = MINER_UPGRADE_COSTS[tier];
    const afford = money >= cost;
    ctx.fillStyle = afford ? 'rgba(255,200,60,0.9)' : 'rgba(160,170,190,0.55)';
    ctx.font = 'bold 7px monospace';
    ctx.textBaseline = 'top';
    const yOff = tier > 0 ? R + 14 : R + 4;
    ctx.fillText(`${MINER_UPGRADE_MULTS[tier+1]}x — $${cost}`, cx2, cy2 + yOff);
  }
}

// ── Receiver (IEC resistor + ground symbol) ──
function drawReceiver(x, y, cell) {
  const px = x * TILE, py = y * TILE, T = TILE;
  const fl  = (cell.flash||0) > 0;
  const cx2 = px+T/2, cy2 = py+T/2;
  const col = fl ? PAL.recvFlash : PAL.recvBorder;
  const acc = fl ? PAL.recvFlash : PAL.recvAccent;

  // Rotatable: the symbol is drawn in its natural orientation (ground stack
  // pointing toward the bottom of the tile, dir = D) then rotated to face
  // cell.dir. Lead wires are computed in world space (via inputEdges, so they
  // always reach the real neighboring belts) and aimed at the ROTATED junction
  // point, keeping the wiring visually connected at any orientation.
  const angle = ((cell.dir ?? DIR.D) - DIR.D) * (Math.PI / 2);
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  const baseJx = cx2, baseJy = cy2 - 4;   // junction point in natural orientation
  const relX = baseJx - cx2, relY = baseJy - cy2;
  const jx = cx2 + relX*cosA - relY*sinA;
  const jy = cy2 + relX*sinA + relY*cosA;

  // Suggested wiring side — the Bank actually accepts electrons from any
  // adjacent belt (inputEdges is omnidirectional), but cell.dir still controls
  // which way the symbol visually faces, so we use that as the "intended" side
  // and hint it with an amber entry chevron (hidden once something's wired up there).
  const [rdx, rdy] = DIR_VEC[cell.dir ?? DIR.D];
  if (cell.preview && !getG(x + rdx, y + rdy)) drawPortArrow(cx2 + rdx*T/2, cy2 + rdy*T/2, -rdx, -rdy, PAL.portIn);

  // Lead wires from any belt/miner pointing here → rotated component junction
  for (const e of inputEdges(x, y)) {
    if (fl) { ctx.shadowColor = PAL.recvFlash; ctx.shadowBlur = 10; }
    ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(e.ex, e.ey); ctx.lineTo(jx, jy); ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // ── Symbol (resistor box + zigzag + ground bars), rotated as a whole ──
  ctx.save();
  ctx.translate(cx2, cy2);
  ctx.rotate(angle);
  ctx.translate(-cx2, -cy2);

  const jx2 = baseJx, jy2 = baseJy;   // work in natural-orientation coordinates

  if (fl) { ctx.shadowColor = PAL.recvFlash; ctx.shadowBlur = 12; }

  // ── IEC resistor box (sits above the junction) ──
  const rw = 20, rh = 11;
  const rbx = cx2 - rw/2, rby = cy2 - 22;
  ctx.fillStyle = fl ? 'rgba(0,70,50,0.65)' : PAL.recvFill;
  ctx.fillRect(rbx, rby, rw, rh);
  ctx.strokeStyle = col; ctx.lineWidth = 1.5;
  ctx.strokeRect(rbx, rby, rw, rh);
  ctx.shadowBlur = 0;

  // Zigzag inside resistor
  const segs = 5, sw = rw / segs;
  ctx.strokeStyle = acc; ctx.lineWidth = 1;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(rbx, rby + rh/2);
  for (let i = 0; i < segs; i++) {
    ctx.lineTo(rbx + (i+0.5)*sw, rby + (i%2===0 ? rh-1 : 1));
  }
  ctx.lineTo(rbx + rw, rby + rh/2);
  ctx.stroke();

  // Vertical stub: bottom of box → junction
  ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.lineCap = 'square';
  ctx.beginPath();
  ctx.moveTo(cx2, rby + rh); ctx.lineTo(cx2, jy2);
  ctx.stroke();

  // ── Ground symbol (3 horizontal bars) ──
  if (fl) { ctx.shadowColor = PAL.recvFlash; ctx.shadowBlur = 10; }
  ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(cx2-9, jy2);    ctx.lineTo(cx2+9, jy2);     // wide
  ctx.moveTo(cx2-6, jy2+4);  ctx.lineTo(cx2+6, jy2+4);   // medium
  ctx.moveTo(cx2-3, jy2+8);  ctx.lineTo(cx2+3, jy2+8);   // narrow (tip)
  ctx.stroke();
  ctx.shadowBlur = 0;

  // "$" label on the resistor box
  ctx.fillStyle = acc;
  ctx.font = 'bold 8px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('$', cx2, rby + rh/2);

  ctx.restore();
}

// ── LED (circuit LED symbol: anode/cathode + emission rays) ──
// Rendered as a large 4x4-tile component block (LED_SIZE). `x,y` is the real,
// wireable cell — placed at the bottom-center of the block (see placeLEDs) so
// its only open neighbor is the tile directly below it. `cell.originX/originY`
// give the block's top-left corner, which is what the big symbol is drawn
// around; the lead wire still terminates at the true single-tile anchor so
// wiring lines up with the belt grid right at the bottom edge of the LED.
function drawLED(x, y, cell) {
  const T = TILE;
  const size = cell.size || 1;
  const blockPx = T * size;
  const ox = cell.originX ?? x, oy = cell.originY ?? y;   // block top-left (tile coords)
  const bpx = ox * TILE, bpy = oy * TILE;                  // block top-left (px)
  const px = x * TILE, py = y * TILE;                      // real anchor tile (px)
  const pct = cell.charge / LED_MAX_CHARGE;
  const lit  = cell.charge >= LED_LIT_THRESH;
  const fl   = (cell.flash || 0) > 0;
  // Symbol is centered on the whole 4x4 footprint; geometry scales up with it
  const cx2  = bpx + blockPx/2, cy2 = bpy + blockPx/2;
  const S    = 1 + (size - 1) * 0.55;   // symbol scale factor (gentler than full tile scale)
  const R    = 10 * S;  // circle body radius
  const ts   = 6 * S;   // diode triangle half-size

  // Each LED requires a specific color of electron — drive its glow off that color
  const ledColor = cell.color || 'blue';
  const rgb  = COLOR_RGB[ledColor] || '100,220,255';
  const hex  = COLOR_HEX[ledColor] || '#78e8ff';
  const lc8  = `rgb(${rgb})`; // bright lit color, shorthand

  // Directional input: placed LEDs have a single input side determined by `dir`.
  // Challenge LEDs (placed=false) accept from any side (no dir).
  const dir = cell.placed ? (cell.dir ?? DIR.R) : null;
  const ax2 = px + T/2, ay2 = py + T/2;   // anchor tile center
  // Ring junction point on the circle surface facing the input side
  const [inDx, inDy] = dir != null ? DIR_VEC[(dir + 2) % 4] : [0, 1];
  const ringJx = cx2 + inDx * (R + 5 * S);
  const ringJy = cy2 + inDy * (R + 5 * S);

  const inE = inputEdges(x, y);
  // For directional LEDs, only accept edges that arrive from the input side
  const filteredE = dir != null ? inE.filter(e =>
    Math.abs(e.ex - (ax2 + inDx * T/2)) < 2 && Math.abs(e.ey - (ay2 + inDy * T/2)) < 2
  ) : inE;

  // Wiring hint — show where to connect. Directional LED shows one hint only;
  // multi-side (challenge) LED shows hints on all open sides.
  if (!filteredE.length) {
    if (dir != null) {
      // Single hint on the input side (inDx/inDy points from center toward the input edge)
      if (!getG(x + inDx, y + inDy))
        drawPortArrow(ax2 + inDx*(T/2 - 8), ay2 + inDy*(T/2 - 8), -inDx, -inDy, PAL.portIn, 4);
    } else {
      for (const [adx, ady] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        if (!getG(x + adx, y + ady))
          drawPortArrow(ax2 + adx*(T/2 - 8), ay2 + ady*(T/2 - 8), -adx, -ady, PAL.portIn, 4);
      }
    }
  }

  const col  = lit ? (fl ? '#ffffff' : hex) : `rgba(60,110,230,${0.4 + pct*0.45})`;
  if (lit) { ctx.shadowColor = hex; ctx.shadowBlur = 6; }
  ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  if (dir != null) {
    // Directional LED: always draw the single input stub from the tile edge to the ring surface.
    // When a belt is present (filteredE), its edge-point aligns with this stub automatically.
    const edgeX = ax2 + inDx * T/2, edgeY = ay2 + inDy * T/2;
    ctx.beginPath(); ctx.moveTo(edgeX, edgeY); ctx.lineTo(ringJx, ringJy); ctx.stroke();
  } else {
    // Non-directional (challenge) LED: draw each connected wire to anchor, then anchor to ring
    for (const e of filteredE) {
      ctx.beginPath(); ctx.moveTo(e.ex, e.ey); ctx.lineTo(ax2, ay2); ctx.stroke();
    }
    if (filteredE.length) {
      ctx.beginPath(); ctx.moveTo(ax2, ay2); ctx.lineTo(ringJx, ringJy); ctx.stroke();
    }
  }
  ctx.shadowBlur = 0;
  // Terminal dot at the ring junction
  if (lit) { ctx.shadowColor = hex; ctx.shadowBlur = 5; }
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(ringJx, ringJy, 2.3 * S, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;

  // ── Charge ring ──
  ctx.strokeStyle = 'rgba(30,60,140,0.25)';
  ctx.lineWidth   = 3 * S; ctx.lineCap = 'butt';
  ctx.beginPath(); ctx.arc(cx2, cy2, R+5*S, 0, Math.PI*2); ctx.stroke();
  if (pct > 0) {
    const rc = lit ? (fl ? '#ffffff' : hex) : `rgba(${rgb},${0.4+pct*0.5})`;
    if (lit) { ctx.shadowColor = hex; ctx.shadowBlur = 16; }
    ctx.strokeStyle = rc; ctx.lineWidth = 3 * S; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx2, cy2, R+5*S, -Math.PI/2, -Math.PI/2 + Math.PI*2*pct);
    ctx.stroke();
    ctx.lineCap = 'butt'; ctx.shadowBlur = 0;
  }

  // ── Bloom glow (lit only) ──
  if (lit) {
    // Inner tight bloom
    const glowR = R * 4.5 * (fl ? 1.4 : 1);
    const grad = ctx.createRadialGradient(cx2, cy2, R * 0.5, cx2, cy2, glowR);
    grad.addColorStop(0,   `rgba(${rgb},${fl ? 0.90 : 0.75})`);
    grad.addColorStop(0.25, `rgba(${rgb},${fl ? 0.55 : 0.40})`);
    grad.addColorStop(0.6, `rgba(${rgb},${fl ? 0.20 : 0.14})`);
    grad.addColorStop(1,   `rgba(${rgb},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx2, cy2, glowR, 0, Math.PI*2); ctx.fill();
  }

  // ── LED component circle ──
  if (lit) { ctx.shadowColor = fl ? '#fff' : hex; ctx.shadowBlur = fl ? 55 : 38; }
  ctx.fillStyle = lit
    ? `rgba(${rgb},${0.12 + pct*0.18})`
    : `rgba(${rgb},${0.20 + pct*0.22})`;
  ctx.beginPath(); ctx.arc(cx2, cy2, R, 0, Math.PI*2); ctx.fill();

  ctx.strokeStyle = lit ? (fl ? '#fff' : hex) : `rgba(${rgb},0.72)`;
  ctx.lineWidth   = (lit ? 1.8 : 1.6) * S;
  ctx.beginPath(); ctx.arc(cx2, cy2, R, 0, Math.PI*2); ctx.stroke();
  ctx.shadowBlur = 0;

  // ── Color label on unlit challenge LEDs — tells player what color to route ──
  if (!lit && size > 1) {
    ctx.fillStyle = `rgba(${rgb},0.80)`;
    ctx.font      = `bold ${Math.round(6.5*S)}px monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(ledColor.toUpperCase(), cx2, cy2 + R + 5*S);
  }

  // ── Emission rays (two angled dashes, upper-left, per convention) ──
  if (lit) {
    const rayCol = fl ? 'rgba(255,255,255,0.8)' : `rgba(${rgb},0.65)`;
    if (fl) { ctx.shadowColor = '#fff'; ctx.shadowBlur = 6; }
    ctx.strokeStyle = rayCol; ctx.lineWidth = 1.2 * S; ctx.lineCap = 'round';
    const rays = [{ ox: -2*S, oy: -ts-1*S, angle: -Math.PI*0.75 },
                  { ox:  3*S, oy: -ts-2*S, angle: -Math.PI*0.6  }];
    for (const r of rays) {
      const sx = cx2 + r.ox + Math.cos(r.angle)*4*S;
      const sy = cy2 + r.oy + Math.sin(r.angle)*4*S;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(r.angle)*6*S, sy + Math.sin(r.angle)*6*S);
      ctx.stroke();
    }
    ctx.shadowBlur = 0; ctx.lineCap = 'butt';
  }

}

// ── LED Screen — pass 1: background + border (drawn before items so electrons appear in front) ──
function drawLEDScreenBg(x, y, cell) {
  const T  = TILE;
  const S  = SCREEN_SIZE;
  const px = x * T, py = y * T;
  const W  = S * T, H = S * T;
  ctx.fillStyle = 'rgba(0, 4, 14, 0.92)';
  ctx.beginPath();
  ctx.roundRect(px + 2, py + 2, W - 4, H - 4, 4);
  ctx.fill();

  ctx.strokeStyle = 'rgba(50, 100, 180, 0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(px + 2, py + 2, W - 4, H - 4, 4);
  ctx.stroke();

  ctx.fillStyle    = 'rgba(70, 130, 220, 0.5)';
  ctx.font         = '7px monospace';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('SCREEN', px + 5, py + 5);
}

// ── LED Screen — pass 2: pixel dots (drawn after items so pixels sit on top of electrons) ──
function drawLEDScreenPixels(x, y, cell) {
  const T  = TILE;
  const S  = SCREEN_SIZE;
  const px = x * T, py = y * T;

  const pixels      = cell.pixels      || [];
  const pixelColors = cell.pixelColors || [];
  const PAD = 5;
  for (let row = 0; row < S; row++) {
    for (let col = 0; col < S; col++) {
      const idx    = row * S + col;
      const charge = pixels[idx] || 0;
      const lit    = charge >= SCREEN_PIXEL_THRESH;
      const pct    = charge / SCREEN_PIXEL_MAX;
      const pcol   = pixelColors[idx];
      const hex    = pcol ? (COLOR_HEX[pcol]  || '#aaddff') : '#aaddff';
      const rgb    = pcol ? (COLOR_RGB[pcol]  || '170,221,255') : '170,221,255';

      const cpx = px + col * T + PAD;
      const cpy = py + row * T + PAD;
      const cw  = T - PAD * 2;
      const cx2 = cpx + cw / 2;
      const cy2 = cpy + cw / 2;
      const r   = cw / 2 - 1;

      if (lit) {
        ctx.shadowColor = hex;
        ctx.shadowBlur  = 10;
        ctx.fillStyle   = `rgba(${rgb}, ${0.65 + pct * 0.35})`;
      } else if (pct > 0) {
        ctx.shadowBlur = 0;
        ctx.fillStyle  = `rgba(${rgb}, ${0.08 + pct * 0.18})`;
      } else {
        ctx.shadowBlur = 0;
        ctx.fillStyle  = 'rgba(25, 50, 100, 0.18)';
      }
      ctx.beginPath();
      ctx.arc(cx2, cy2, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = lit ? `rgba(${rgb}, 0.35)` : 'rgba(30, 55, 110, 0.25)';
      ctx.lineWidth   = 0.6;
      ctx.beginPath();
      ctx.arc(cx2, cy2, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

// Legacy alias used by the hover/preview path
function drawLEDScreen(x, y, cell) { drawLEDScreenBg(x, y, cell); drawLEDScreenPixels(x, y, cell); }

// ── Switch (1-tile SPDT: input from side, outputs top & bottom) ──
// dir = facing direction; input arrives from opposite side (dir+2)%4
// outputA = (dir+3)%4  — top when dir=RIGHT
// outputB = (dir+1)%4  — bottom when dir=RIGHT
// Animated orange "marching ants" border to signal a node can be clicked/toggled
function drawInteractBorder(x, y) {
  const px = x * TILE, py = y * TILE, T = TILE;
  ctx.save();
  ctx.strokeStyle   = 'rgba(255,160,40,0.85)';
  ctx.lineWidth     = 1.6 / cam.zoom;
  ctx.setLineDash([5 / cam.zoom, 4 / cam.zoom]);
  ctx.lineDashOffset = -(frame * 0.4) % 9;
  ctx.strokeRect(px + 1.5, py + 1.5, T - 3, T - 3);
  ctx.setLineDash([]);
  ctx.restore();
}

// Unified marching-ants border for the full 3-tile trigate footprint
function drawTrigateBorder(x, y, cell) {
  const T   = TILE;
  const isH = (cell.dir === DIR.U || cell.dir === DIR.D);
  const px  = x * T + 1.5;
  const py  = y * T + 1.5;
  const w   = (isH ? 3 * T : T) - 3;
  const h   = (isH ? T : 3 * T) - 3;
  ctx.save();
  ctx.strokeStyle   = 'rgba(255,160,40,0.85)';
  ctx.lineWidth     = 1.6 / cam.zoom;
  ctx.setLineDash([5 / cam.zoom, 4 / cam.zoom]);
  ctx.lineDashOffset = -(frame * 0.4) % 9;
  ctx.strokeRect(px, py, w, h);
  ctx.setLineDash([]);
  ctx.restore();
}

// ── Shared: small filled chevron at a connection point, pointing in the direction
// electrons travel there. Used on every rotatable module (switch, battery, receiver,
// colorizer, miner) so the player knows exactly where to connect a wire. ──
function drawPortArrow(ex, ey, fdx, fdy, color, size = 4.5) {
  const r = size * 0.85;
  ctx.shadowColor = '#ffe033'; ctx.shadowBlur = 7;
  ctx.fillStyle = '#ffe033';
  ctx.beginPath();
  ctx.arc(ex, ey, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(ex, ey, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawSwitch(x, y, cell) {
  const px = x * TILE, py = y * TILE, T = TILE;
  const cx2 = px + T/2, cy2 = py + T/2;

  const enterSide = (cell.dir + 2) % 4;   // side the electron enters from
  const outA = (cell.dir + 3) % 4;
  const outB = (cell.dir + 1) % 4;

  // While an electron is transiting, state has already flipped for the next electron —
  // pin the active arm to the transiting electron's locked exit so it matches the L path.
  const transit   = items.find(it => it.cx === x && it.cy === y);
  const activeOut = transit ? transit.dir : (cell.state === 0 ? outA : outB);
  const inactOut  = activeOut === outA ? outB : outA;

  const [ex,  ey]  = DIR_VEC[enterSide];
  const [aox, aoy] = DIR_VEC[activeOut];
  const [iox, ioy] = DIR_VEC[inactOut];

  // World-space edge midpoints
  const entX  = cx2 + ex  * T/2,  entY  = cy2 + ey  * T/2;
  const actX  = cx2 + aox * T/2,  actY  = cy2 + aoy * T/2;
  const inactX = cx2 + iox * T/2, inactY = cy2 + ioy * T/2;

  // Box background
  ctx.fillStyle = PAL.switchFill;
  ctx.fillRect(px + 4, py + 4, T - 8, T - 8);

  // Box border (solid, no dash)
  ctx.strokeStyle = PAL.switchBorder; ctx.lineWidth = 1.5;
  ctx.strokeRect(px + 4.5, py + 4.5, T - 9, T - 9);

  // Inactive output stub — always visible so both exits are clear
  ctx.strokeStyle = PAL.switchDim; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx2, cy2); ctx.lineTo(inactX, inactY); ctx.stroke();
  ctx.fillStyle = PAL.switchDim;
  ctx.beginPath(); ctx.arc(inactX, inactY, 2.5, 0, Math.PI * 2); ctx.fill();

  // L-shaped arm: entry edge → pivot → active output edge.
  // After each flip, sweep the arm tip from the old direction to the new one over ARM_FLIP_FRAMES.
  const ARM_FLIP_FRAMES = 10;
  let armTipX = actX, armTipY = actY;
  if (!transit && cell.armFlipFrame != null && cell.armFromDir != null) {
    const elapsed = frame - cell.armFlipFrame;
    if (elapsed < ARM_FLIP_FRAMES) {
      const t = elapsed / ARM_FLIP_FRAMES;
      const [fdx, fdy] = DIR_VEC[cell.armFromDir];
      const fromX = cx2 + fdx * T/2, fromY = cy2 + fdy * T/2;
      armTipX = fromX + (actX - fromX) * t;
      armTipY = fromY + (actY - fromY) * t;
    }
  }
  ctx.strokeStyle = PAL.switchActive; ctx.lineWidth = 2.5;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(entX, entY);
  ctx.lineTo(cx2, cy2);
  ctx.lineTo(armTipX, armTipY);
  ctx.stroke();
  ctx.lineJoin = 'miter';

  // Pivot dot
  ctx.fillStyle = PAL.switchAccent;
  ctx.beginPath(); ctx.arc(cx2, cy2, 3, 0, Math.PI * 2); ctx.fill();

  // Entry dot — filled ring in the switch's own border/accent palette, not a yellow port marker
  ctx.shadowColor = PAL.switchActive; ctx.shadowBlur = 6;
  ctx.strokeStyle = PAL.switchActive; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(entX, entY, 4, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = PAL.switchFill;
  ctx.beginPath(); ctx.arc(entX, entY, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;

  // SW label
  ctx.fillStyle = 'rgba(120,180,255,0.45)'; ctx.font = '7px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lblX = cx2 + (ex + iox) * T * 0.22;
  const lblY = cy2 + (ey + ioy) * T * 0.22;
  ctx.fillText('SW', lblX, lblY);
}

// ── Colorizer (tints passing electrons; click to cycle its color) ──
function drawColorizer(x, y, cell) {
  const px = x * TILE, py = y * TILE, T = TILE;
  const cx2 = px+T/2, cy2 = py+T/2;
  const color = cell.color || COLOR_NAMES[0];
  const hex   = COLOR_HEX[color] || '#ffffff';
  const rgb   = COLOR_RGB[color] || '255,255,255';
  const fl    = (cell.flash || 0) > 0;

  // Direction-agnostic: draw a lead toward every side that actually has a connecting
  // belt/miner/switch/battery (whether feeding in or continuing out), so the wires
  // always line up no matter how the surrounding belts are routed.
  // Rotatable: dir R/L = horizontal pass-through, dir U/D = vertical pass-through.
  // Press R while hovering a placed colorizer to flip its axis.
  const horiz = (cell.dir === DIR.R || cell.dir === DIR.L);
  const dirs = horiz ? [[1,0],[-1,0]] : [[0,1],[0,-1]];
  const leads = [];
  for (const [dx, dy] of dirs) {
    const nb = getG(x+dx, y+dy);
    // Any adjacent placed building (belt, miner, switch, battery, colorizer, LED,
    // receiver, ...) is something an electron could arrive from or continue into —
    // draw a wire toward it along the colorizer's chosen axis. (Ore patches aren't
    // stored in the building grid, so this never connects to bare ore tiles.)
    if (nb) leads.push([dx, dy]);
  }

  // Background tinted with the selected color
  ctx.fillStyle = `rgba(${rgb},0.16)`;
  ctx.fillRect(px+3, py+3, T-6, T-6);

  // Dashed border in the tint color
  ctx.strokeStyle = `rgba(${rgb},0.7)`; ctx.lineWidth = 1;
  ctx.setLineDash([4,3]);
  ctx.strokeRect(px+3.5, py+3.5, T-7, T-7);
  ctx.setLineDash([]);

  // Single entry-point dot on the input side (opposite cell.dir)
  if (cell.preview) {
    const [idx, idy] = DIR_VEC[(cell.dir + 2) % 4];
    if (!getG(x + idx, y + idy)) drawPortArrow(cx2 + idx*T/2, cy2 + idy*T/2, 0, 0, PAL.portIn);
  }

  // Wires: pivot → each connected edge
  if (fl) { ctx.shadowColor = hex; ctx.shadowBlur = 8; }
  ctx.strokeStyle = `rgba(${rgb},0.85)`; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  for (const [dx, dy] of leads) {
    // Slightly overshoot the tile edge so the lead visually bridges into the
    // neighbor cell and the circuit reads as continuous (no gap at the seam),
    // even when the neighbor's own wire stub doesn't reach exactly to the edge.
    ctx.beginPath();
    ctx.moveTo(cx2, cy2);
    ctx.lineTo(cx2 + dx*T*0.62, cy2 + dy*T*0.62);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  // Pivot: a glowing droplet of the chosen color (the "dye")
  ctx.shadowColor = hex; ctx.shadowBlur = fl ? 14 : 8;
  ctx.fillStyle = hex;
  ctx.beginPath(); ctx.arc(cx2, cy2, fl ? 5.5 : 4.5, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx2, cy2, fl ? 5.5 : 4.5, 0, Math.PI*2); ctx.stroke();

  // Label
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '7px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('COLOURIZE', cx2, py+4);
  ctx.fillStyle = hex; ctx.font = 'bold 7px monospace';
  ctx.textBaseline = 'bottom';
  ctx.fillText(color.toUpperCase(), cx2, py+T-3);
}

// ── Delay (holds passing electrons for a configurable duration; click to cycle the hold time) ──
function drawDelay(x, y, cell) {
  const px = x * TILE, py = y * TILE, T = TILE;
  const cx2 = px+T/2, cy2 = py+T/2;
  const inputDir = (cell.dir + 2) % 4;
  const [idx, idy] = DIR_VEC[inputDir];
  const [odx, ody] = DIR_VEC[cell.dir];
  const fl = (cell.flash || 0) > 0;
  const sec = cell.delaySec ?? 0.2;
  const accent = '#c98cff';

  // Background
  ctx.fillStyle = 'rgba(60,30,90,0.22)';
  ctx.fillRect(px+3, py+3, T-6, T-6);
  ctx.strokeStyle = `rgba(201,140,255,0.7)`; ctx.lineWidth = 1;
  ctx.setLineDash([4,3]);
  ctx.strokeRect(px+3.5, py+3.5, T-7, T-7);
  ctx.setLineDash([]);

  // Through-wire: input edge → pivot → output edge
  if (fl) { ctx.shadowColor = accent; ctx.shadowBlur = 8; }
  ctx.strokeStyle = `rgba(201,140,255,0.85)`; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx2 + idx*T/2, cy2 + idy*T/2);
  ctx.lineTo(cx2, cy2);
  ctx.lineTo(cx2 + odx*T/2, cy2 + ody*T/2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  if (cell.preview && !getG(x + idx, y + idy)) drawPortArrow(cx2 + idx*T/2, cy2 + idy*T/2, -idx, -idy, PAL.portIn);
  if (cell.preview && !getG(x + odx, y + ody)) drawPortArrow(cx2 + odx*T/2, cy2 + ody*T/2, odx, ody, PAL.portOut);

  // Clock-face pivot — hands point out toward the fraction of a second the module holds
  ctx.shadowColor = accent; ctx.shadowBlur = fl ? 12 : 6;
  ctx.fillStyle = 'rgba(40,15,60,0.9)';
  ctx.beginPath(); ctx.arc(cx2, cy2, fl ? 5.5 : 4.5, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = accent; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(cx2, cy2, fl ? 5.5 : 4.5, 0, Math.PI*2); ctx.stroke();
  // Hand sweeps further round the dial the longer the configured hold is (0.2s→short, 1.0s→full turn)
  const ang = -Math.PI/2 + (sec / 1.0) * Math.PI * 2;
  ctx.beginPath();
  ctx.moveTo(cx2, cy2);
  ctx.lineTo(cx2 + Math.cos(ang) * 3.4, cy2 + Math.sin(ang) * 3.4);
  ctx.stroke();

  // Label
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '7px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('DELAY', cx2, py+4);
  ctx.fillStyle = accent; ctx.font = 'bold 7px monospace';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${sec.toFixed(1)}s`, cx2, py+T-3);
}

// ── Button (user-toggled gate — click to open/close; 3 inputs + 3 outputs, facing side is closed) ──
function drawButton(x, y, cell) {
  const px = x * TILE, py = y * TILE, T = TILE;
  const cx2 = px + T/2, cy2 = py + T/2;
  const on  = cell.on;
  const fl  = (cell.flash || 0) > 0;
  const dir = cell.dir ?? DIR.U;
  const accent = on ? '#44ee88' : '#888898';

  // Background
  ctx.fillStyle = on ? 'rgba(10,60,30,0.35)' : 'rgba(30,30,40,0.25)';
  ctx.fillRect(px+3, py+3, T-6, T-6);
  ctx.strokeStyle = on ? 'rgba(60,220,120,0.7)' : 'rgba(120,120,150,0.45)';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(px+3.5, py+3.5, T-7, T-7);

  // Single wire stub on the input side (opposite the facing/closed direction)
  const [fdx, fdy] = DIR_VEC[dir]; // facing / closed direction
  if (fl) { ctx.shadowColor = accent; ctx.shadowBlur = 10; }
  ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx2 - fdx * T/2, cy2 - fdy * T/2);
  ctx.lineTo(cx2 - fdx * (T/2 - 9), cy2 - fdy * (T/2 - 9));
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Button dome
  const r = fl ? 7.5 : 6.5;
  ctx.shadowColor = accent; ctx.shadowBlur = fl ? 14 : (on ? 8 : 3);
  ctx.fillStyle = on ? 'rgba(40,200,100,0.9)' : 'rgba(80,80,95,0.9)';
  ctx.beginPath(); ctx.arc(cx2, cy2, r, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = on ? 'rgba(100,255,160,0.9)' : 'rgba(160,160,180,0.7)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx2, cy2, r, 0, Math.PI*2); ctx.stroke();
  ctx.shadowBlur = 0;

  // Glint
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.beginPath(); ctx.arc(cx2 - 1.5, cy2 - 1.5, r * 0.4, 0, Math.PI*2); ctx.fill();

  // Labels
  ctx.fillStyle = on ? 'rgba(100,255,160,0.85)' : 'rgba(180,180,200,0.5)';
  ctx.font = '7px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('BTN', cx2, py + 4);
  ctx.textBaseline = 'bottom';
  ctx.fillText(on ? 'ON' : 'OFF', cx2, py + T - 3);
}

// ── Trigate (3-channel synchronized gate: 3×1 footprint, button in centre, rotatable) ──
// dir = flow direction (electrons travel this way through all 3 channels simultaneously)
// anchor tile is always the "first" tile (left if horizontal, top if vertical)
function drawTrigate(x, y, cell) {
  const T = TILE;
  const px = x * T, py = y * T;
  const dir  = cell.dir ?? DIR.U;
  const on   = cell.on;
  const fl   = (cell.flash || 0) > 0;
  const isH  = (dir === DIR.U || dir === DIR.D);   // horizontal span
  const W    = isH ? 3 * T : T;
  const H    = isH ? T : 3 * T;
  const accent = on ? '#44ee88' : '#888898';
  const [fdx, fdy]   = DIR_VEC[dir];             // output direction vector
  const [bdx, bdy]   = DIR_VEC[(dir + 2) % 4];  // input direction vector

  // ── Background ──
  ctx.fillStyle = on ? 'rgba(8,55,28,0.45)' : 'rgba(22,22,38,0.4)';
  ctx.fillRect(px + 2, py + 2, W - 4, H - 4);
  ctx.strokeStyle = on ? 'rgba(55,210,115,0.75)' : 'rgba(90,90,120,0.55)';
  ctx.lineWidth = 1.4;
  ctx.strokeRect(px + 2.5, py + 2.5, W - 5, H - 5);

  // ── Channel divider lines ──
  ctx.strokeStyle = on ? 'rgba(55,210,115,0.2)' : 'rgba(90,90,120,0.18)';
  ctx.lineWidth = 0.8; ctx.setLineDash([3, 4]);
  if (isH) {
    for (const dv of [T, 2*T]) {
      ctx.beginPath(); ctx.moveTo(px + dv, py + 5); ctx.lineTo(px + dv, py + T - 5); ctx.stroke();
    }
  } else {
    for (const dv of [T, 2*T]) {
      ctx.beginPath(); ctx.moveTo(px + 5, py + dv); ctx.lineTo(px + T - 5, py + dv); ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  // ── Wire stubs: input + output for each of 3 channels ──
  if (fl) { ctx.shadowColor = accent; ctx.shadowBlur = 9; }
  ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const chx = isH ? px + (i + 0.5) * T : px + T / 2;
    const chy = isH ? py + T / 2         : py + (i + 0.5) * T;
    // Input stub (from edge inward)
    ctx.beginPath();
    ctx.moveTo(chx + bdx * T/2, chy + bdy * T/2);
    ctx.lineTo(chx + bdx * (T/2 - 9), chy + bdy * (T/2 - 9));
    ctx.stroke();
    // Output stub (from center toward edge)
    ctx.beginPath();
    ctx.moveTo(chx + fdx * T/2, chy + fdy * T/2);
    ctx.lineTo(chx + fdx * (T/2 - 9), chy + fdy * (T/2 - 9));
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  // ── Central button dome (middle of the 3-tile span) ──
  const cx2 = px + W / 2, cy2 = py + H / 2;
  const r = fl ? 8.5 : 7.5;
  ctx.shadowColor = accent; ctx.shadowBlur = fl ? 18 : (on ? 12 : 4);
  ctx.fillStyle = on ? 'rgba(35,190,95,0.92)' : 'rgba(65,65,88,0.92)';
  ctx.beginPath(); ctx.arc(cx2, cy2, r, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = on ? 'rgba(90,255,155,0.9)' : 'rgba(140,140,170,0.7)';
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(cx2, cy2, r, 0, Math.PI*2); ctx.stroke();
  ctx.shadowBlur = 0;
  // Glint
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath(); ctx.arc(cx2 - 2, cy2 - 2, r * 0.38, 0, Math.PI*2); ctx.fill();

  // ── Flow arrows through the 3 channels (dim chevrons showing direction) ──
  ctx.strokeStyle = on ? 'rgba(55,210,115,0.4)' : 'rgba(120,120,150,0.25)';
  ctx.lineWidth = 1.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let i = 0; i < 3; i++) {
    if (i === 1) continue; // middle tile has the dome, skip
    const chx = isH ? px + (i + 0.5) * T : px + T / 2;
    const chy = isH ? py + T / 2         : py + (i + 0.5) * T;
    const perp = isH ? 3 : 0, perpY = isH ? 0 : 3; // perpendicular offset for chevron arms
    // Small chevron pointing in flow direction
    ctx.beginPath();
    ctx.moveTo(chx - fdx*4 - perpY, chy - fdy*4 - perp);
    ctx.lineTo(chx + fdx*4,          chy + fdy*4);
    ctx.lineTo(chx - fdx*4 + perpY, chy - fdy*4 + perp);
    ctx.stroke();
  }

  // ── Labels — always horizontal text near the centre-top of the component ──
  ctx.fillStyle = on ? 'rgba(90,255,155,0.9)' : 'rgba(170,170,200,0.55)';
  ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('GATE', cx2, py + 4);
  ctx.fillStyle = on ? 'rgba(90,255,155,0.7)' : 'rgba(140,140,170,0.45)';
  ctx.font = '6px monospace'; ctx.textBaseline = 'bottom';
  ctx.fillText(on ? 'ON' : 'OFF', cx2, py + H - 4);
}

// ── Battery (charges from its back/input side, discharges out its `dir` side — rotatable) ──
function drawBattery(x, y, cell) {
  const px = x * TILE, py = y * TILE, T = TILE;
  const cx2 = px+T/2, cy2 = py+T/2;
  const pct  = cell.charge / BATTERY_MAX;
  const fl   = cell.flash !== 0;
  const isOn = cell.on !== false;
  const isCharging    = cell.flash > 0;
  const isDischarging = cell.flash < 0;

  // When off: dim everything significantly
  const dimAlpha = isOn ? 1 : 0.3;
  const brdCol = isOn
    ? (fl ? (isCharging ? '#40e890' : PAL.battDischarge) : PAL.battBorder)
    : 'rgba(80,80,80,0.5)';
  const accCol = isOn
    ? (fl ? (isCharging ? '#40e890' : PAL.battDischarge) : PAL.battAccent)
    : 'rgba(80,80,80,0.4)';

  // Tile background
  ctx.fillStyle = isOn ? PAL.battFill : 'rgba(8,8,12,0.7)';
  ctx.fillRect(px+3, py+3, T-6, T-6);
  ctx.globalAlpha = dimAlpha;

  // Charge bar (fills from bottom up) — draw track then fill
  {
    const barX = px + 5, barW = T - 10, barMaxH = T - 16, barY = py + 8;
    // Track background
    ctx.fillStyle = 'rgba(20,20,35,0.6)';
    ctx.fillRect(barX, barY, barW, barMaxH);
    ctx.strokeStyle = 'rgba(60,130,90,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barMaxH);
    if (pct > 0) {
      const barH = barMaxH * pct;
      const barFill = fl
        ? (isCharging ? 'rgba(60,230,130,0.95)' : 'rgba(80,200,255,0.9)')
        : 'rgba(40,210,110,0.82)';
      if (fl) { ctx.shadowColor = isCharging ? '#40e890' : PAL.battDischarge; ctx.shadowBlur = 8; }
      ctx.fillStyle = barFill;
      ctx.fillRect(barX, barY + barMaxH - barH, barW, barH);
      ctx.shadowBlur = 0;
      // Bright top edge on the filled portion
      ctx.strokeStyle = fl ? (isCharging ? 'rgba(120,255,180,0.9)' : 'rgba(160,230,255,0.9)') : 'rgba(80,230,150,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(barX, barY + barMaxH - barH);
      ctx.lineTo(barX + barW, barY + barMaxH - barH);
      ctx.stroke();
    }
  }

  if (fl) { ctx.shadowColor = brdCol; ctx.shadowBlur = 12; }

  // Symbol geometry (leads + plates) is drawn assuming the battery discharges
  // upward, then rotated about the tile center to match `cell.dir`. World-space
  // connection points are computed separately (via inputEdges) and never rotated.
  const battAngle = ((cell.dir ?? DIR.U) - DIR.U) * (Math.PI / 2);
  const [bDx, bDy] = DIR_VEC[cell.dir ?? DIR.U];
  const battOutConnected = !!getG(x + bDx, y + bDy);   // exit-side neighbor present?
  const battInConnected  = !!getG(x - bDx, y - bDy);   // entry-side neighbor present?
  ctx.save();
  ctx.translate(cx2, cy2); ctx.rotate(battAngle); ctx.translate(-cx2, -cy2);

  // ── OUTPUT side (top in unrotated = cell.dir) ──
  const outCol = isOn ? (isDischarging ? PAL.battDischarge : PAL.battAccent) : 'rgba(80,80,80,0.35)';

  // Lead wire from output edge to plates
  ctx.strokeStyle = brdCol; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx2, py + 2); ctx.lineTo(cx2, cy2 - 10); ctx.stroke();

  // "OUT" label + outward triangle arrow
  ctx.fillStyle = outCol; ctx.font = 'bold 7px monospace';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('OUT', px + 4, py + 4);
  ctx.beginPath();
  ctx.moveTo(cx2,     py + 3);
  ctx.lineTo(cx2 - 3, py + 9);
  ctx.lineTo(cx2 + 3, py + 9);
  ctx.closePath(); ctx.fill();

  if (cell.preview && !battOutConnected) drawPortArrow(cx2, py + 1.5, 0, -1, PAL.portOut);

  // ── INPUT side (bottom in unrotated = opposite cell.dir) ──
  const inCol = isOn ? PAL.portIn : 'rgba(80,80,80,0.35)';
  ctx.strokeStyle = inCol; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(px + 5, py + T - 2); ctx.lineTo(px + T - 5, py + T - 2); ctx.stroke();

  // Lead wire from input edge to plates
  ctx.strokeStyle = brdCol; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx2, py + T - 2); ctx.lineTo(cx2, cy2 + 10); ctx.stroke();

  // "IN" label + inward triangle arrow (pointing up into battery)
  ctx.fillStyle = inCol; ctx.font = 'bold 7px monospace';
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText('IN', px + 4, py + T - 4);
  ctx.beginPath();
  ctx.moveTo(cx2,     py + T - 3);
  ctx.lineTo(cx2 - 3, py + T - 9);
  ctx.lineTo(cx2 + 3, py + T - 9);
  ctx.closePath(); ctx.fill();

  if (cell.preview && !battInConnected) drawPortArrow(cx2, py + T - 1.5, 0, -1, PAL.portIn);

  ctx.shadowBlur = 0;

  // Battery plates (alternating long/short = positive/negative)
  const plates = [
    { y: cy2-10, w: 16, pos: true  },
    { y: cy2-5,  w: 10, pos: false },
    { y: cy2+1,  w: 16, pos: true  },
    { y: cy2+6,  w: 10, pos: false },
  ];
  for (const p of plates) {
    if (fl) { ctx.shadowColor = brdCol; ctx.shadowBlur = fl ? 6 : 0; }
    ctx.strokeStyle = p.pos ? brdCol : accCol;
    ctx.lineWidth   = p.pos ? 2 : 1.2;
    ctx.lineCap     = 'butt';
    ctx.beginPath();
    ctx.moveTo(cx2 - p.w/2, p.y); ctx.lineTo(cx2 + p.w/2, p.y);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.restore();

  // Charge level text
  ctx.fillStyle = isOn ? `rgba(40,200,110,${0.35 + pct*0.55})` : 'rgba(80,80,80,0.4)';
  ctx.font = '7px monospace'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  ctx.fillText(`${cell.charge}/${BATTERY_MAX}`, px+T-4, py+T-4);

  ctx.globalAlpha = 1;

  // ── On/off indicator (top-left corner) ──
  const dotR  = 3;
  const dotX  = px + 8, dotY = py + 8;
  if (isOn) {
    ctx.shadowColor = '#40e890'; ctx.shadowBlur = 6;
    ctx.fillStyle   = '#40e890';
  } else {
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = 'rgba(180,40,40,0.8)';
  }
  ctx.beginPath(); ctx.arc(dotX, dotY, dotR, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;

  // ── Remembered discharge color (top-right corner) — the battery now keeps the color of
  // whatever last charged it and discharges electrons to match, instead of always going bare ──
  if (cell.color) {
    const swHex = COLOR_HEX[cell.color] || '#ffffff';
    const swX = px + T - 8, swY = py + 8;
    ctx.shadowColor = swHex; ctx.shadowBlur = 6;
    ctx.fillStyle = swHex;
    ctx.beginPath(); ctx.arc(swX, swY, dotR, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(swX, swY, dotR, 0, Math.PI*2); ctx.stroke();
  }

  // "BAT" label
  ctx.fillStyle = isOn ? 'rgba(40,180,90,0.35)' : 'rgba(120,40,40,0.4)';
  ctx.font = '7px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(isOn ? 'BAT' : 'OFF', cx2, py+4);
}

// ── Item ──
function drawItem(it) {
  // Electrons inside a screen tile are invisible — the lit pixel is the visual feedback
  const itCell = getG(it.cx, it.cy);
  if (itCell && (itCell.type === 'ledscreen' || itCell.type === 'ledscreen_part')) return;

  // While progress is negative the electron is visually inside the battery tile —
  // use entryDir (the battery's discharge direction) so it tracks back toward the
  // battery regardless of which way the receiving belt faces.
  const [dx, dy] = (it.progress < 0 && it.entryDir != null) ? DIR_VEC[it.entryDir] : DIR_VEC[it.dir];
  let wx: number, wy: number;
  if (it.enteringLed) {
    // Interpolate along the wire stub: from the tile's input edge to the ring junction
    const T2 = TILE;
    const size2 = itCell.size || 1;
    const S2 = 1 + (size2 - 1) * 0.55;
    const R2 = 10 * S2;
    const ox2 = itCell.originX ?? it.cx, oy2 = itCell.originY ?? it.cy;
    const cx3 = (ox2 + size2 / 2) * T2, cy3 = (oy2 + size2 / 2) * T2;
    const ledDir2 = itCell.placed ? (itCell.dir ?? DIR.R) : null;
    const [inDx2, inDy2] = ledDir2 != null ? DIR_VEC[(ledDir2 + 2) % 4] : [0, 1];
    // Start from the anchor tile center — that's where the electron physically is at progress=0
    const entryX = (it.cx + 0.5) * T2;
    const entryY = (it.cy + 0.5) * T2;
    const ringX2 = cx3 + inDx2 * (R2 + 5 * S2);
    const ringY2 = cy3 + inDy2 * (R2 + 5 * S2);
    wx = entryX + (ringX2 - entryX) * it.progress;
    wy = entryY + (ringY2 - entryY) * it.progress;
  } else {
    wx = (it.cx + 0.5 + dx * it.progress) * TILE;
    wy = (it.cy + 0.5 + dy * it.progress) * TILE;
  }

  // Tinted electrons (passed through a colorizer) glow in their assigned color
  const glow = it.color ? (COLOR_GLOW[it.color] || PAL.itemGlow) : PAL.itemGlow;
  const fill = it.color ? (COLOR_HEX[it.color]  || PAL.item)     : PAL.item;

  // Fading out at end of lifespan: shrink and fade rather than blink out
  const fadeT = it.fading ? Math.max(0, it.fadeTick / ELECTRON_FADE_FRAMES) : 1;
  const alpha = fadeT;
  const radius = 5 * (0.4 + 0.6 * fadeT);

  ctx.save();
  ctx.globalAlpha = alpha;

  // Glow
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur  = 8 * fadeT;
  ctx.fillStyle   = fill;
  ctx.beginPath();
  ctx.arc(wx, wy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Inner bright core
  ctx.fillStyle = it.color ? 'rgba(255,255,255,0.85)' : 'rgba(200,240,255,0.85)';
  ctx.beginPath();
  ctx.arc(wx, wy, radius * 0.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ── Hover Preview ──
function drawHover(cx, cy) {
  if (!tool) return;   // nothing selected — no ghost or validity tint
  const px = cx * TILE, py = cy * TILE, T = TILE;
  const e = getG(cx, cy);

  if (tool === 'delete') {
    ctx.fillStyle   = PAL.deleteFill;
    ctx.strokeStyle = PAL.deleteBrd;
    ctx.lineWidth   = 1.5;
    ctx.fillRect(px + 1, py + 1, T - 2, T - 2);
    ctx.strokeRect(px + 1.5, py + 1.5, T - 3, T - 3);
    return;
  }

  const valid = canPlace(cx, cy);

  if (!valid) {
    ctx.fillStyle   = PAL.hoverBad;
    ctx.strokeStyle = PAL.hoverBadBrd;
    ctx.lineWidth   = 1.5;
    ctx.fillRect(px, py, T, T);
    ctx.strokeRect(px + 0.75, py + 0.75, T - 1.5, T - 1.5);
    return;
  }

  // Ghost preview
  ctx.globalAlpha = 0.5;
  if (tool === 'belt') {
    if (e && e.type === 'belt') {
      // Existing wire — just highlight it, no extra ghost-arrow clutter
    } else {
      const previewDir = beltDir;
      drawBelt(cx, cy, { dir: previewDir });
    }
  } else if (tool === 'miner') {
    drawMiner(cx, cy, { dir: beltDir, tick: 0, preview: true });
  } else if (tool === 'receiver') {
    drawReceiver(cx, cy, { dir: beltDir, flash: 0, preview: true });
  } else if (tool === 'battery') {
    drawBattery(cx, cy, { dir: beltDir, charge: 0, flash: 0, preview: true });
  } else if (tool === 'switch') {
    drawSwitch(cx, cy, { dir: beltDir, state: 0, preview: true });
  } else if (tool === 'colorizer') {
    drawColorizer(cx, cy, { dir: beltDir, color: COLOR_NAMES[0], flash: 0, preview: true });
  } else if (tool === 'delay') {
    drawDelay(cx, cy, { dir: beltDir, delaySec: DELAY_PRESETS[0], flash: 0, preview: true });
  } else if (tool === 'button') {
    drawButton(cx, cy, { dir: beltDir, on: false, flash: 0 });
  } else if (tool === 'trigate') {
    const isH = (beltDir === DIR.U || beltDir === DIR.D);
    drawTrigate(isH ? cx - 1 : cx, isH ? cy : cy - 1, { dir: beltDir, on: false, flash: 0, originX: isH ? cx-1 : cx, originY: isH ? cy : cy-1 });
  } else if (tool === 'ledscreen') {
    drawLEDScreen(cx, cy, { originX: cx, originY: cy, pixels: new Array(SCREEN_SIZE*SCREEN_SIZE).fill(0), pixelColors: new Array(SCREEN_SIZE*SCREEN_SIZE).fill(null), flash: 0 });
  } else if (tool === 'vein') {
    drawOre(cx, cy);
  } else if (tool.startsWith('led_')) {
    const lox = cx - 2, loy = cy - 2;   // centre block on cursor
    const [aox, aoy] = beltDir === DIR.R ? [0, 1] :
                        beltDir === DIR.D ? [1, 0] :
                        beltDir === DIR.L ? [3, 1] : [1, 3];
    drawLED(lox + aox, loy + aoy, { charge: 0, flash: 0, color: tool.slice(4), size: 4, dir: beltDir, originX: lox, originY: loy, placed: true });
  }
  ctx.globalAlpha = 1;

  // Border highlight
  ctx.strokeStyle = PAL.hoverBorder;
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(px + 0.75, py + 0.75, T - 1.5, T - 1.5);
}

// ═══════════════════════════════════════════════════════════════
// INPUT
// ═══════════════════════════════════════════════════════════════

// Returns the Set of tool names allowed in the current job/puzzle,
// or null when all tools are available.
function getEnabledTools() {
  if (currentJob && currentJob.isPuzzle && levelKit != null) {
    const allowed = new Set(['delete', ...Object.keys(levelKit)]);
    return allowed;
  }
  if (!currentJob || !currentJob.id.startsWith('tut-')) return null;
  const enabled = new Set(['miner', 'belt', 'receiver', 'delete']);
  for (const t of (currentJob.requires || [])) enabled.add(t);
  return enabled;
}

// Applies / removes the 'tool-disabled' class and the HTML disabled attribute
// on every toolbar button to match the current job's allowed tool set.
function updateToolbarState() {
  const enabled = getEnabledTools();
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    const t = btn.dataset.tool;
    const ok = !enabled || enabled.has(t) || (t && t.startsWith('led_') && enabled.has('led'));
    btn.classList.toggle('tool-disabled', !ok);
    btn.disabled = !ok;
  });
  // Power-menu toggle: accessible whenever miner or vein is allowed
  const powerToggle = document.getElementById('powerMenuToggle');
  if (powerToggle) {
    const ok = !enabled || enabled.has('miner') || enabled.has('vein');
    powerToggle.classList.toggle('tool-disabled', !ok);
    powerToggle.disabled = !ok;
  }
  // If the currently selected tool just got disabled, fall back to belt
  if (enabled && tool && !enabled.has(tool) && !tool.startsWith('led_')) {
    setTool('belt');
  }
}

function setTool(t) {
  // null = deselect: no tool active, nothing placed or previewed on click
  if (t == null) {
    tool = null;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active', 'active-red'));
    return;
  }
  // Block disabled tools (respects tutorial restrictions)
  const enabled = getEnabledTools();
  if (enabled && !enabled.has(t) && !t.startsWith('led_')) return;
  tool = t;
  document.querySelectorAll('.tool-btn').forEach(b => {
    b.classList.remove('active', 'active-red');
    if (b.dataset.tool === t) {
      b.classList.add(t === 'delete' ? 'active-red' : 'active');
    }
  });
}

function updateDirIcon() {
  const svgEl = document.getElementById('beltSvg');
  const degs  = [0, 90, 180, 270];
  svgEl.style.transform  = `rotate(${degs[beltDir]}deg)`;
  svgEl.style.transition = 'transform 0.15s ease';
}

function rotateBelt() {
  beltDir = (beltDir + 1) % 4;
  updateDirIcon();
}

function flipTool() {
  beltDir = (beltDir + 2) % 4;
  updateDirIcon();
}

document.querySelectorAll('.tool-btn').forEach(btn => {
  if (btn.classList.contains('menu-toggle')) return;
  btn.addEventListener('click', () => {
    setTool(btn.dataset.tool);
    btn.blur();
    const panel = btn.closest('.tool-menu-panel');
    if (panel) panel.classList.remove('open');
  });
  btn.addEventListener('mousedown', e => e.stopPropagation());
});

{
  const toggle = document.getElementById('powerMenuToggle');
  const panel  = document.getElementById('powerMenuPanel');
  toggle.addEventListener('mousedown', e => e.stopPropagation());
  toggle.addEventListener('click', e => {
    e.stopPropagation();
    panel.classList.toggle('open');
    toggle.blur();
  });
  document.addEventListener('click', e => {
    if (!panel.contains(e.target) && e.target !== toggle) panel.classList.remove('open');
  });
}

{
  const toggle = document.getElementById('ledMenuToggle');
  const panel  = document.getElementById('ledMenuPanel');
  toggle.addEventListener('mousedown', e => e.stopPropagation());
  toggle.addEventListener('click', e => {
    e.stopPropagation();
    panel.classList.toggle('open');
    toggle.blur();
  });
  document.addEventListener('click', e => {
    if (!panel.contains(e.target) && e.target !== toggle) panel.classList.remove('open');
  });
}

document.addEventListener('keydown', e => {
  if (gameState !== 'playing') return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (!spaceDown) { spaceDown = true; canvas.style.cursor = 'grab'; }
  }
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
    e.preventDefault();
    keysHeld.add(e.key);
  }
  if (['w','a','s','d','W','A','S','D'].includes(e.key)) {
    keysHeld.add(e.key);
  }
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === 'r' || e.key === 'R') {
    const hc = hovCell && getG(hovCell.x, hovCell.y);
    if (hc && hc.type === 'colorizer') {
      const horiz = (hc.dir === DIR.R || hc.dir === DIR.L);
      hc.dir = horiz ? DIR.D : DIR.R;
      hc.flash = 10;
    } else if (hc && hc.type === 'receiver') {
      hc.dir = ((hc.dir ?? DIR.D) + 1) % 4;
      hc.flash = 10;
    } else if (hc && hc.type === 'battery') {
      hc.dir = ((hc.dir ?? DIR.U) + 1) % 4;
      hc.flash = 10;
    } else if (hc && hc.type === 'delay') {
      hc.dir = ((hc.dir ?? DIR.R) + 1) % 4;
      hc.flash = 10;
    } else if (hc && hc.placed && (hc.type === 'led' || hc.type === 'led_part')) {
      const ox = hc.originX ?? hovCell.x, oy = hc.originY ?? hovCell.y;
      let anchor = hc.type === 'led' ? hc : null;
      if (!anchor) {
        for (let dy = 0; dy < 4 && !anchor; dy++)
          for (let dx = 0; dx < 4 && !anchor; dx++) {
            const t = getG(ox + dx, oy + dy);
            if (t && t.type === 'led' && t.placed) anchor = t;
          }
      }
      if (anchor) {
        const newDir = ((anchor.dir ?? DIR.R) + 1) % 4;
        const color = anchor.color;
        for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) delG(ox + dx, oy + dy);
        const [aox, aoy] = newDir === DIR.R ? [0, 1] :
                            newDir === DIR.D ? [1, 0] :
                            newDir === DIR.L ? [3, 1] : [1, 3];
        setG(ox + aox, oy + aoy, { type: 'led', charge: 0, flash: 0, color, size: 4, dir: newDir, originX: ox, originY: oy, placed: true });
        for (let dy = 0; dy < 4; dy++)
          for (let dx = 0; dx < 4; dx++) {
            if (dx === aox && dy === aoy) continue;
            setG(ox + dx, oy + dy, { type: 'led_part', originX: ox, originY: oy, placed: true });
          }
      }
    } else {
      rotateBelt();
    }
  }
  if (e.key === 'f' || e.key === 'F') flipTool();
  if (e.key === '1') setTool('miner');
  if (e.key === '2') setTool('belt');
  if (e.key === '3') setTool('receiver');
  if (e.key === '4') setTool('switch');
  if (e.key === '5') setTool('battery');
  if (e.key === '6') setTool('colorizer');
  if (e.key === '7' || e.key === 'Delete') setTool('delete');
  if (e.key === '8') setTool('vein');
  if (e.key === '9') setTool('delay');
  if (e.key === '0') setTool('ledscreen');
  if (e.key === 'b' || e.key === 'B') setTool('button');
  if (e.key === 'g' || e.key === 'G') setTool('trigate');
  if (e.key === 'p' || e.key === 'P' || e.key === '+' || e.key === '=') zoomBy(1.14);
  if (e.key === 'l' || e.key === 'L' || e.key === '-' || e.key === '_') zoomBy(0.88);
});

document.addEventListener('keyup', e => {
  if (e.code === 'Space') {
    spaceDown = false;
    canvas.style.cursor = 'crosshair';
  }
  keysHeld.delete(e.key);
});

canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('mousedown', e => {
  if (gameState !== 'playing') return;
  e.preventDefault();
  if (e.button === 1 || (e.button === 0 && (spaceDown || e.altKey))) {
    panning  = true;
    panStart = { x: e.clientX, y: e.clientY };
    camSnap  = { x: cam.x, y: cam.y };
    canvas.style.cursor = 'grabbing';
    return;
  }
  if (e.button === 2) {
    const c = s2c(e.clientX, e.clientY);
    if (inBnd(c.x, c.y) && getG(c.x, c.y)) {
      removeBuilding(c.x, c.y);
    } else {
      setTool(null);   // right-click on an empty tile clears the selected tool
    }
    return;
  }
  if (e.button === 0) {
    placing      = true;
    const c      = s2c(e.clientX, e.clientY);
    lastPlaced   = key(c.x, c.y);
    lastDragCell = { x: c.x, y: c.y };
    placeTile(c.x, c.y);
  }
});

canvas.addEventListener('mousemove', e => {
  if (gameState !== 'playing') return;
  hovCell = s2c(e.clientX, e.clientY);
  if (panning) {
    cam.x = camSnap.x + (e.clientX - panStart.x) / cam.zoom;
    cam.y = camSnap.y + (e.clientY - panStart.y) / cam.zoom;
    return;
  }
  if (placing) {
    const c  = s2c(e.clientX, e.clientY);
    const ck = key(c.x, c.y);
    if (tool === 'belt' && lastDragCell) {
      const w   = s2w(e.clientX, e.clientY);
      const dx  = w.x - (lastDragCell.x + 0.5);
      const dy  = w.y - (lastDragCell.y + 0.5);
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0.25) {
        const tailDir = Math.abs(dx) >= Math.abs(dy)
          ? (dx > 0 ? DIR.R : DIR.L)
          : (dy > 0 ? DIR.D : DIR.U);
        const tailCell = getG(lastDragCell.x, lastDragCell.y);
        if (tailCell && tailCell.type === 'belt') tailCell.dir = tailDir;
      }
    }
    if (ck !== lastPlaced) {
      let dragDir = null;
      if (tool === 'belt' && lastDragCell) {
        const ddx = c.x - lastDragCell.x;
        const ddy = c.y - lastDragCell.y;
        if (Math.abs(ddx) > Math.abs(ddy) && ddx !== 0)
          dragDir = ddx > 0 ? DIR.R : DIR.L;
        else if (Math.abs(ddy) > Math.abs(ddx) && ddy !== 0)
          dragDir = ddy > 0 ? DIR.D : DIR.U;
        if (dragDir !== null) { beltDir = dragDir; updateDirIcon(); }
      }
      lastDragCell = { x: c.x, y: c.y };
      lastPlaced   = ck;
      placeTile(c.x, c.y, { dragging: true, dragDir });
    }
  }
});

canvas.addEventListener('mouseup', e => {
  panning      = false;
  placing      = false;
  lastDragCell = null;
  if (!spaceDown) canvas.style.cursor = 'crosshair';
});

canvas.addEventListener('mouseleave', () => {
  hovCell      = null;
  panning      = false;
  placing      = false;
  lastDragCell = null;
});

function zoomBy(factor) {
  const newZoom = Math.max(0.25, Math.min(4.0, cam.zoom * factor));
  cam.zoom = newZoom;
}

canvas.addEventListener('wheel', e => {
  if (gameState !== 'playing' && gameState !== 'paused') return;
  e.preventDefault();
  const factor  = e.deltaY > 0 ? 0.88 : 1.14;
  const newZoom = Math.max(0.25, Math.min(4.0, cam.zoom * factor));
  const mx = e.clientX - W / 2;
  const my = e.clientY - H / 2;
  cam.x    = mx / newZoom - mx / cam.zoom + cam.x;
  cam.y    = my / newZoom - my / cam.zoom + cam.y;
  cam.zoom = newZoom;
}, { passive: false });

window.addEventListener('resize', () => {
  W = canvas.width  = window.innerWidth;
  H = canvas.height = window.innerHeight;
});

// ═══════════════════════════════════════════════════════════════
// MONEY DISPLAY
// ═══════════════════════════════════════════════════════════════

let displayedMoney = STARTING_CREDIT;
function updateMoneyDisplay() {
  if (isPlaypen) {
    document.getElementById('moneyVal').textContent = '∞';
    document.getElementById('moneyRate').textContent = 'FREE BUILD';
    return;
  }
  if (displayedMoney !== money) {
    displayedMoney = money;
    document.getElementById('moneyVal').textContent = '$' + money.toLocaleString();
  }
}

// ═══════════════════════════════════════════════════════════════
// TUTORIAL CALLOUTS
// ═══════════════════════════════════════════════════════════════

/**
 * Show a one-shot tutorial callout bubble anchored to a world tile (tx, ty).
 * `id`      — unique key; callout never shows twice per session
 * `title`   — bold heading
 * `body`    — explanation text
 * Dismisses on click anywhere or after `autoMs` ms (default 8s).
 */
function showTutCallout(id: string, tx: number, ty: number, title: string, body: string, autoMs = 8000) {
  if (tutCalloutShown[id]) return;
  tutCalloutShown[id] = true;

  // Convert world tile → screen pixels (matches w2s formula)
  function tileToScreen() {
    const cx2 = ((tx + 0.5) * TILE + cam.x) * cam.zoom + W / 2;
    const cy2 = ((ty + 0.5) * TILE + cam.y) * cam.zoom + H / 2;
    return { sx: cx2, sy: cy2 };
  }

  const el = document.createElement('div');
  el.className = 'tut-callout';
  el.innerHTML = `
    <div class="tut-callout-title">${title}</div>
    <div class="tut-callout-body">${body}</div>
    <div class="tut-callout-dismiss">Click anywhere to dismiss</div>
  `;
  document.body.appendChild(el);

  function position() {
    const { sx, sy } = tileToScreen();
    const ew = el.offsetWidth || 240;
    const eh = el.offsetHeight || 100;
    // Prefer to appear above the tile; clamp to viewport
    let left = sx - ew / 2;
    let top  = sy - eh - 18;
    if (top < 8) top = sy + TILE * cam.zoom + 12;
    left = Math.max(8, Math.min(window.innerWidth - ew - 8, left));
    el.style.left = left + 'px';
    el.style.top  = top  + 'px';
  }

  position();
  // Reposition each frame while visible in case the camera moves
  let rafId = 0;
  function track() { position(); rafId = requestAnimationFrame(track); }
  track();

  function dismiss() {
    cancelAnimationFrame(rafId);
    el.classList.add('tut-callout-out');
    setTimeout(() => el.remove(), 350);
    document.removeEventListener('click', dismiss);
  }

  // Slight delay before listening so the placement click doesn't immediately dismiss
  setTimeout(() => document.addEventListener('click', dismiss), 400);
  setTimeout(dismiss, autoMs);
}

// ═══════════════════════════════════════════════════════════════
// CHALLENGE HUD + WIN
// ═══════════════════════════════════════════════════════════════

function updateChallengeHUD() {
  // ── Puzzle mode: show locked-LED progress ──
  if (currentJob && currentJob.isPuzzle) {
    const puzzleLeds = [...grid.values()].filter(c => c.type === 'led' && c.locked);
    const total   = puzzleLeds.length;
    const litCount = puzzleLeds.filter(c => c.charge >= LED_LIT_THRESH).length;
    if (chalCount) chalCount.textContent = total > 0 ? `${litCount}/${total} LIT` : 'BUILD CIRCUIT';
    const holdPct = Math.min(1, allLitTimer / (currentJob.winHold ?? 180));
    if (chalFill) chalFill.style.width = `${holdPct * 100}%`;
    if (chalTime) chalTime.textContent = `HOLD ${(allLitTimer / 60).toFixed(1)}s`;
    const allLit = total > 0 && litCount === total;
    if (chalFill) chalFill.style.background = allLit
      ? 'linear-gradient(90deg,#2060ff,#78e8ff)'
      : 'linear-gradient(90deg,#601020,#ff4060)';
    updateGoalPanel();
    return;
  }

  const noLed = activeLedCount === 0;

  if (noLed) {
    if (currentJob && currentJob.fillBattery) {
      // ── Battery-fill job: show charge progress toward BATTERY_MAX ──
      const maxCharge = Math.max(0, ...Array.from(grid.values())
        .filter(c => c.type === 'battery').map(c => c.charge ?? 0));
      const pct  = Math.min(1, maxCharge / BATTERY_MAX);
      const reqs = jobRequirementsMet();
      const pctDisplay = Math.round(pct * 100);
      if (chalCount) chalCount.textContent = reqs ? `${pctDisplay}% CHARGED` : 'BUILD CIRCUIT';
      if (chalFill)  chalFill.style.width  = `${pct * 100}%`;
      if (chalTime)  chalTime.textContent  = maxCharge >= BATTERY_MAX
        ? 'FULLY CHARGED ✓'
        : reqs ? `${100 - pctDisplay}% TO GO` : 'PLACE COMPONENTS';
      if (chalFill)  chalFill.style.background = maxCharge >= BATTERY_MAX
        ? 'linear-gradient(90deg,#10a050,#78e8a0)'
        : reqs
          ? 'linear-gradient(90deg,#c07010,#f0c040)'
          : 'linear-gradient(90deg,#601020,#ff4060)';
    } else if (currentJob && currentJob.earn) {
      // ── Earn-target job (e.g. tut-1): show credit progress toward the earn goal ──
      const earned  = bankIncome;
      const target  = currentJob.earn;
      const pct     = Math.min(1, earned / target);
      const reqs    = jobRequirementsMet();
      if (chalCount) chalCount.textContent = reqs ? `$${earned} / $${target}` : 'BUILD CIRCUIT';
      if (chalFill)  chalFill.style.width  = `${pct * 100}%`;
      if (chalTime)  chalTime.textContent  = earned >= target
        ? 'TARGET MET ✓'
        : reqs ? `$${target - earned} TO GO` : 'PLACE COMPONENTS';
      if (chalFill)  chalFill.style.background = earned >= target
        ? 'linear-gradient(90deg,#10a050,#78e8a0)'
        : reqs
          ? 'linear-gradient(90deg,#1060c0,#60b8e8)'
          : 'linear-gradient(90deg,#601020,#ff4060)';
    } else {
      // ── Generic no-LED, no-earn job: just show flow status ──
      const flowing = jobRequirementsMet() && money > challengeStartMoney;
      if (chalCount) chalCount.textContent = flowing ? 'FLOWING ●' : 'BUILD CIRCUIT';
      const holdPct = Math.min(1, allLitTimer / NO_LED_WIN_FRAMES);
      if (chalFill)  chalFill.style.width = `${holdPct * 100}%`;
      if (chalTime)  chalTime.textContent = `HOLD ${(allLitTimer / 60).toFixed(1)}s`;
      if (chalFill)  chalFill.style.background = flowing
        ? 'linear-gradient(90deg,#10a050,#78e8a0)'
        : 'linear-gradient(90deg,#601020,#ff4060)';
    }
  } else {
    // ── LED job: update dot states and count ──
    let litCount = 0;
    for (const [i, pos] of LED_POSITIONS.slice(0, activeLedCount).entries()) {
      const cell = getG(pos.x + Math.floor((LED_SIZE - 1) / 2), pos.y + LED_SIZE - 1);
      if (!cell) continue;
      const pct = cell.charge / LED_MAX_CHARGE;
      const lit  = cell.charge >= LED_LIT_THRESH;
      if (lit) litCount++;
      const dot = chalDots[i];
      if (dot) {
        dot.classList.toggle('lit',      lit);
        dot.classList.toggle('charging', !lit && pct > 0.1);
      }
    }
    if (chalCount) chalCount.textContent = `${litCount}/${activeLedCount} LIT`;
    const holdPct = Math.min(1, allLitTimer / WIN_HOLD_FRAMES);
    if (chalFill) chalFill.style.width = `${holdPct * 100}%`;
    const holdSec = (allLitTimer / 60).toFixed(1);
    if (chalTime) chalTime.textContent = `HOLD ${holdSec}s`;
    const allLit = litCount === activeLedCount;
    const reqOk  = jobRequirementsMet();
    if (chalFill) chalFill.style.background = (allLit && reqOk)
      ? 'linear-gradient(90deg,#2060ff,#78e8ff)'
      : 'linear-gradient(90deg,#601020,#ff4060)';
  }

  // Update goal panel and requirement hint
  updateGoalPanel();
  const hint = document.getElementById('job-req-hint');
  const missing = missingRequirements();
  if (missing.length) {
    hint.style.display = 'block';
    hint.textContent = noLed
      ? `⚠ Circuit needs ${missing.map(t => COMPONENT_LABEL[t] || t).join(' + ')} before it will count.`
      : `⚠ Client requires ${missing.map(t => COMPONENT_LABEL[t] || t).join(' + ')} in the circuit — LEDs won't count until it's placed.`;
  } else {
    hint.style.display = 'none';
  }
}

// ── Rank system ────────────────────────────────────────────────────────────
function getRank(elapsedSec) {
  const t = parseFloat(elapsedSec);
  if (t < 60)  return { grade: 'S', label: 'Circuit Savant',      color: '#ffd700' };
  if (t < 180) return { grade: 'A', label: 'Sharp Technician',    color: '#7ed8ff' };
  if (t < 360) return { grade: 'B', label: 'Solid Craftsman',     color: '#78e890' };
  if (t < 600) return { grade: 'C', label: 'Circuit Builder',     color: '#e8c478' };
  return             { grade: 'D', label: 'Breadboard Graduate',  color: 'rgba(190,190,210,0.9)' };
}

// ── Confetti particle system ────────────────────────────────────────────────
let confettiParts = [];
let confettiAnimId = null;
const CONFETTI_COLORS = ['#ffd700','#7ed8ff','#78e890','#ff7eb3','#e8c478','#c4b5fd'];

function startConfetti() {
  const canvas = document.getElementById('confetti-canvas') as HTMLCanvasElement;
  if (!canvas) return;
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.display = 'block';
  const cctx = canvas.getContext('2d');
  confettiParts = [];
  // Burst from three launchers: left, center, right
  const launchers = [0.2, 0.5, 0.8].map(fx => ({ x: canvas.width * fx, y: canvas.height * 0.35 }));
  for (let i = 0; i < 160; i++) {
    const src = launchers[i % launchers.length];
    const angle = -Math.PI * 0.5 + (Math.random() - 0.5) * Math.PI * 1.1;
    const speed = 4 + Math.random() * 8;
    confettiParts.push({
      x: src.x + (Math.random() - 0.5) * 40,
      y: src.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      w: 7 + Math.random() * 7,
      h: 4 + Math.random() * 4,
      rot: Math.random() * Math.PI * 2,
      rotV: (Math.random() - 0.5) * 0.25,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      alpha: 1,
    });
  }
  if (confettiAnimId) cancelAnimationFrame(confettiAnimId);
  const animate = () => {
    cctx.clearRect(0, 0, canvas.width, canvas.height);
    let live = false;
    for (const p of confettiParts) {
      p.vy += 0.18;          // gravity
      p.vx *= 0.995;         // slight air resistance
      p.x  += p.vx;
      p.y  += p.vy;
      p.rot += p.rotV;
      p.alpha = Math.max(0, 1 - Math.max(0, p.y - canvas.height * 0.65) / (canvas.height * 0.35));
      if (p.y < canvas.height + 20) live = true;
      if (p.alpha <= 0) continue;
      cctx.save();
      cctx.globalAlpha = p.alpha;
      cctx.translate(p.x, p.y);
      cctx.rotate(p.rot);
      cctx.fillStyle = p.color;
      cctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      cctx.restore();
    }
    if (live) confettiAnimId = requestAnimationFrame(animate);
    else stopConfetti();
  };
  confettiAnimId = requestAnimationFrame(animate);
}

function stopConfetti() {
  if (confettiAnimId) { cancelAnimationFrame(confettiAnimId); confettiAnimId = null; }
  confettiParts = [];
  const canvas = document.getElementById('confetti-canvas') as HTMLCanvasElement;
  if (canvas) {
    const cctx = canvas.getContext('2d');
    cctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.style.display = 'none';
  }
}

function triggerWin() {
  const clockEl = document.getElementById('puzzle-clock');
  if (clockEl) clockEl.style.display = 'none';

  // ── Puzzle win: simpler screen, no rank ──
  if (currentJob && currentJob.isPuzzle) {
    lastJobRank = { grade: 'S', color: '#40e890', label: 'SOLVED' };
    const titleEl = document.getElementById('win-title');
    const subEl   = document.getElementById('win-sub');
    const rankBadge = document.getElementById('win-rank-badge');
    const rankLabel = document.getElementById('win-rank-label');
    if (titleEl) titleEl.textContent = 'PUZZLE SOLVED';
    if (subEl)   subEl.textContent   = currentJob.title.toUpperCase();
    if (rankBadge) { rankBadge.textContent = '✓'; rankBadge.style.color = '#40e890'; rankBadge.style.textShadow = '0 0 28px #40e89088'; rankBadge.style.display = 'block'; }
    if (rankLabel) { rankLabel.textContent = 'COMPLETE'; rankLabel.style.color = '#40e890'; rankLabel.style.display = 'block'; }
    const statsEl = document.getElementById('win-stats');
    statsEl.innerHTML = `<div style="font-size:10px;letter-spacing:1.5px;color:rgba(160,255,200,0.7);margin-bottom:8px">PUZZLE MODE</div>` +
      `WIRES LEFT &nbsp; <span>${Object.values(levelKit || {}).reduce((a, b) => a + b, 0)}</span><br>` +
      `ELECTRONS &nbsp;&nbsp; <span>${totalElectrons.toLocaleString()}</span>`;
    const btn = document.getElementById('win-btn');
    if (btn) { btn.textContent = 'BACK TO PUZZLES'; btn.onclick = finishJob; }
    document.getElementById('win').style.display = 'flex';
    startConfetti();
    return;
  }

  const elapsed = challengeStartFrame >= 0
    ? ((winFrame - challengeStartFrame) / 60).toFixed(1)
    : '?';
  const isTutOne = currentJob && currentJob.id === 'tut-1-first-circuit';
  const rank     = getRank(elapsed);
  lastJobRank    = rank;

  // Capture circuit earnings BEFORE adding the job reward to money
  const circuitEarned = (currentJob && currentJob.earn)
    ? bankIncome
    : null;

  let payoutLine = '';
  if (currentJob) {
    money += currentJob.reward;
    payoutLine = `JOB PAYOUT &nbsp; <span>+$${currentJob.reward.toLocaleString()}</span><br>`;
  }

  // Title + subtitle
  const titleEl = document.getElementById('win-title');
  const subEl   = document.getElementById('win-sub');
  if (titleEl) titleEl.textContent = isTutOne ? 'FIRST CIRCUIT COMPLETE' : 'CIRCUIT COMPLETE';
  if (subEl)   subEl.textContent   = isTutOne ? 'BREADBOARD ACADEMY — GRADUATION' : 'SYSTEM STATUS';

  // Rank badge
  const rankBadge = document.getElementById('win-rank-badge');
  const rankLabel = document.getElementById('win-rank-label');
  if (rankBadge) {
    rankBadge.textContent  = rank.grade;
    rankBadge.style.color  = rank.color;
    rankBadge.style.textShadow = `0 0 28px ${rank.color}88, 0 0 8px ${rank.color}44`;
    rankBadge.style.display = 'block';
  }
  if (rankLabel) {
    rankLabel.textContent = rank.label;
    rankLabel.style.color = rank.color;
    rankLabel.style.display = 'block';
  }

  const earnedLine = circuitEarned !== null
    ? `GENERATED &nbsp; <span>$${circuitEarned.toLocaleString()}</span><br>`
    : `ELECTRONS &nbsp; <span>${totalElectrons.toLocaleString()}</span><br>`;
  const statsEl = document.getElementById('win-stats');
  statsEl.innerHTML =
    (currentJob ? `<div style="font-size:10px;letter-spacing:1.5px;color:rgba(160,255,200,0.7);margin-bottom:8px">CLIENT SATISFIED — ${currentJob.client.split(',')[0].split('(')[0].trim().toUpperCase()}</div>` : '') +
    `TIME &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <span>${elapsed}s</span><br>` +
    earnedLine +
    payoutLine +
    `CREDITS &nbsp;&nbsp;&nbsp; <span>$${money.toLocaleString()}</span>`;

  const btn = document.getElementById('win-btn');
  if (currentJob) {
    btn.textContent = isTutOne ? 'START YOUR CAREER  →' : 'BACK TO JOB BOARD';
    btn.onclick = finishJob;
  } else {
    btn.textContent = 'RESET CIRCUIT';
    btn.onclick = resetChallenge;
  }

  document.getElementById('win').style.display = 'flex';
  if (isTutOne) startConfetti();
}

function finishJob() {
  stopConfetti();
  if (currentJob && lastJobRank) {
    const GRADE_ORDER = ['S','A','B','C','D'];
    const prev = completedJobs.get(currentJob.id);
    const prevIdx = prev ? GRADE_ORDER.indexOf(prev) : 999;
    const newIdx  = GRADE_ORDER.indexOf(lastJobRank.grade);
    if (newIdx < prevIdx) completedJobs.set(currentJob.id, lastJobRank.grade);
    else if (!prev)       completedJobs.set(currentJob.id, lastJobRank.grade);
  }
  levelKit = null;
  for (const k of puzzleOres) ores.delete(k);
  puzzleOres.clear();
  currentJob = null;
  jobTimeLeft = -1;
  document.getElementById('win').style.display = 'none';
  resetChallenge({ keepMoney: true });
  saveGame();
  showJobBoard();
}

function resetChallenge(opts = {}) {
  const keepMoney = !!opts.keepMoney;
  // Clear everything — placeLEDs() below re-places the correct LEDs for the current job
  grid.clear();
  items = [];
  if (!keepMoney) {
    money          = STARTING_CREDIT;
    displayedMoney = STARTING_CREDIT;
  }
  allLitTimer         = 0;
  challengeWon        = false;
  challengeStartFrame = -1;
  winFrame            = -1;
  totalElectrons      = 0;
  bankIncome          = 0;
  challengeStartMoney = money;  // snapshot after keepMoney is applied
  document.getElementById('win').style.display = 'none';
  document.getElementById('moneyVal').textContent = '$' + money.toLocaleString();
  document.getElementById('moneyRate').textContent = '$0/s';
  placeLEDs();
  updateKitDisplay();
}

// ═══════════════════════════════════════════════════════════════
// GAME STATE, SAVE / LOAD / CONTINUE
// ═══════════════════════════════════════════════════════════════

const SAVE_KEY = 'breadboard_save_v1';
let gameState = 'welcome';
let currentJob = null;
let jobTimeLeft = -1;
let isPlaypen = false;
let playpenStash = null;
let completedJobs = new Map();   // jobId → rank grade ('S'|'A'|'B'|'C'|'D')
let lastJobRank: { grade: string, color: string, label: string } | null = null;

// ═══════════════════════════════════════════════════════════════
// JOB BOARD
// ═══════════════════════════════════════════════════════════════

// ── Tutorial jobs — introduce one component each, played in order ──
const TUTORIAL_JOBS = [
  {
    id: 'tut-1-first-circuit',
    client: 'Breadboard Academy — Week 1',
    title: 'Your First Circuit',
    brief: '"Welcome to the trade. Before you take on client work, let\'s make sure you know which end of a wire goes where. Drop an Extractor on a Power Point, run some Wire to a Bank, and watch the electrons — and the credits — flow."',
    objective: 'Place an Extractor on a Power Point, run Wire to a Bank, and generate $30 in circuit earnings.',
    requires: ['miner', 'belt', 'receiver'],
    reward: 50,
    leds: 0,
    earn: 100,
    timeLimit: null,
  },
  {
    id: 'tut-2-switch',
    client: 'Breadboard Academy — Week 2',
    title: 'Power Up',
    brief: '"Good. You can move electrons. Now let\'s store them. Wire up an Extractor, run it through a Switch, into a Battery. The Switch lets you control the flow — useful when you\'re also running a Bank on the side. Charge that Battery all the way to 100%."',
    objective: 'Build a circuit with a Switch, Battery, and Bank. Charge the Battery to 100%.',
    requires: ['switch', 'battery', 'receiver'],
    reward: 70,
    leds: 0,
    fillBattery: true,
    timeLimit: null,
  },
  {
    id: 'tut-3-battery',
    client: 'Breadboard Academy — Week 3',
    title: 'Charge a Battery',
    brief: '"Power Points don\'t last forever, and sometimes you need to redirect flow. Wire electrons into the Battery\'s input side to charge it up, then let it discharge from its output. Click the on/off dot to enable or disable it."',
    objective: 'Include a charged, discharging Battery in your circuit. Hold all LEDs lit for 20 seconds.',
    requires: ['battery'],
    reward: 90,
    timeLimit: null,
  },
  {
    id: 'tut-4-colorizer',
    client: 'Breadboard Academy — Week 4',
    title: 'Paint Your Electrons',
    brief: '"Not all circuits are created equal — some components care about colour. A Colorizer tints every electron that passes through it. Drop one in-line and click it to cycle colours. Press R while hovering to flip its axis."',
    objective: 'Route electrons through a Colorizer in your working circuit. Hold all LEDs lit for 20 seconds.',
    requires: ['colorizer'],
    reward: 90,
    timeLimit: null,
  },
  {
    id: 'tut-5-delay',
    client: 'Breadboard Academy — Week 5',
    title: 'Add a Delay',
    brief: '"Sometimes electrons need to arrive fashionably late. A Delay module holds each electron for a configurable duration before letting it continue. Click the clock-face to cycle the hold time between 0.2s and 1.0s."',
    objective: 'Include a Delay module in your circuit. Hold all LEDs lit for 20 seconds.',
    requires: ['delay'],
    reward: 90,
    timeLimit: null,
  },
  {
    id: 'tut-6-button',
    client: 'Breadboard Academy — Week 6',
    title: 'Hit the Button',
    brief: '"Manual control: sometimes you just want to push something. A Button opens three sides and blocks one (the facing side). Click the dome to toggle the gate open or closed. Great for on-demand switching without a full Switch module."',
    objective: 'Use a Button to control electron flow in your circuit. Hold all LEDs lit for 20 seconds.',
    requires: ['button'],
    reward: 110,
    timeLimit: null,
  },
  {
    id: 'tut-7-trigate',
    client: 'Breadboard Academy — Week 7',
    title: 'Three at Once',
    brief: '"The Gate spans three tiles and controls three channels simultaneously — one click, three paths, perfectly in sync. Rotate with R to change orientation. Great for wide flows that need to switch together."',
    objective: 'Use a Gate to control electron flow across three channels. Hold all LEDs lit for 20 seconds.',
    requires: ['trigate'],
    reward: 130,
    timeLimit: null,
  },
];

const JOBS = [
  {
    id: 'lair-ambiance',
    client: 'V. Krelborn, "Definitely a Legitimate Business"',
    title: 'Mood Lighting for My Evil Lair (No Questions)',
    brief: '"I require five (5) lights to glow simultaneously, for AMBIANCE, in my totally-normal underground bunker. Also — and this is crucial — I need to FLIP A SWITCH dramatically when my nemesis arrives. Presentation matters. Stop reading the brief out loud."',
    objective: 'Light all 5 LEDs and hold for 20 seconds. The circuit must include a SWITCH — Krelborn insists on a dramatic, hands-on activation moment.',
    requires: ['switch'],
    reward: 170,
    timeLimit: null,
  },
];

// ── Puzzle Levels — self-contained routing puzzles with a fixed component kit ──
const PUZZLE_LEVELS = [
  {
    id: 'puz-01', isPuzzle: true,
    title: 'Hello Circuit',
    client: 'Puzzle — Stage 01',
    brief: '"One battery. One light. Thirteen wires. How hard could it be?"',
    objective: 'Connect the battery to the LED. Kit: 13 wires.',
    kit: { belt: 13 },
    fixedBatteries: [{ x: 31, y: 32, dir: DIR.R }],
    fixedLeds: [{ ox: 37, oy: 30, dir: DIR.R, color: null }],
    fixedExtra: [
      { x: 30, y: 32, cell: { type: 'miner', dir: DIR.R, tick: 0, tier: 0 } },
    ],
    fixedOres: [{ x: 30, y: 32 }],
    winHold: 180,
    leds: 0, reward: 0, timeLimit: null, requires: [],
  },
  {
    id: 'puz-02', isPuzzle: true,
    title: 'Power Surge',
    client: 'Puzzle — Stage 02',
    brief: '"The extractor is slowly charging the battery. Don\'t rush — wait for enough charge, then flip it ON."',
    objective: 'Wire the battery to the LED. Let it charge, then click the battery ON before time runs out. Kit: 8 wires. 40 seconds.',
    kit: { belt: 8 },
    fixedBatteries: [{ x: 31, y: 32, dir: DIR.R, charge: 3, on: false }],
    fixedLeds: [{ ox: 37, oy: 30, dir: DIR.R, color: null }],
    fixedExtra: [
      { x: 30, y: 32, cell: { type: 'miner', dir: DIR.R, tick: 0, tier: 0 } },
    ],
    fixedOres: [{ x: 30, y: 32 }],
    winHold: 120,
    timeLimit: 40,
    leds: 0, reward: 0, requires: [],
  },
  {
    id: 'puz-03', isPuzzle: true,
    title: 'Color Rush',
    client: 'Puzzle — Stage 03',
    brief: '"Red goes to red. Blue goes to blue. The LEDs will tell you if you\'re wrong."',
    objective: 'Route each colored battery to its matching LED. Kit: 28 wires.',
    kit: { belt: 28 },
    fixedBatteries: [
      { x: 31, y: 28, dir: DIR.R, color: 'red' },
      { x: 31, y: 35, dir: DIR.R, color: 'blue' },
    ],
    fixedLeds: [
      { ox: 38, oy: 26, dir: DIR.R, color: 'red' },
      { ox: 38, oy: 33, dir: DIR.R, color: 'blue' },
    ],
    fixedExtra: [
      { x: 30, y: 28, cell: { type: 'miner', dir: DIR.R, tick: 0, tier: 0 } },
      { x: 30, y: 35, cell: { type: 'miner', dir: DIR.R, tick: 0, tier: 0 } },
    ],
    fixedOres: [{ x: 30, y: 28 }, { x: 30, y: 35 }],
    winHold: 300,
    leds: 0, reward: 0, timeLimit: null, requires: [],
  },
  {
    id: 'puz-04', isPuzzle: true,
    title: 'Open Sesame',
    client: 'Puzzle — Stage 04',
    brief: '"The gate is closed. Wire it up first — then open it."',
    objective: 'Wire battery → button → LED, then click the button to open the gate. Kit: 14 wires.',
    kit: { belt: 14 },
    fixedBatteries: [{ x: 31, y: 32, dir: DIR.R }],
    fixedLeds: [{ ox: 38, oy: 30, dir: DIR.R, color: null }],
    fixedExtra: [
      { x: 30, y: 32, cell: { type: 'miner', dir: DIR.R, tick: 0, tier: 0 } },
      { x: 34, y: 32, cell: { type: 'button', dir: DIR.R, on: false, flash: 0 } },
    ],
    fixedOres: [{ x: 30, y: 32 }],
    winHold: 300,
    leds: 0, reward: 0, timeLimit: null, requires: [],
  },
];

const ALL_JOBS = [...TUTORIAL_JOBS, ...JOBS, ...PUZZLE_LEVELS];

function jobRequirementsMet() {
  if (!currentJob || !currentJob.requires || !currentJob.requires.length) return true;
  const have = new Set();
  for (const cell of grid.values()) have.add(cell.type);
  return currentJob.requires.every(t => have.has(t));
}

const COMPONENT_LABEL = {
  miner:     'Extractor',
  belt:      'Wire',
  receiver:  'Bank',
  vein:      'Power Point',
  battery:   'Battery',
  switch:    'Switch',
  colorizer: 'Colorizer',
  delay:     'Delay',
  button:    'Button',
  trigate:   'Gate',
  ledscreen: 'Screen',
};

function missingRequirements() {
  if (!currentJob || !currentJob.requires) return [];
  const have = new Set();
  for (const cell of grid.values()) have.add(cell.type);
  return currentJob.requires.filter(t => !have.has(t));
}

const JOB_FAIL_LINES = [
  'The client has left a strongly-worded voicemail. Several, actually.',
  'You ran out the clock. Somewhere, Greg is smirking.',
  'Time\'s up — the lights stayed dark, and so did your reputation, slightly.',
  'The investors have left. They took the toaster. It is unclear why.',
];

const FLAVOR_LINES = [
  'Remember: a confused capacitor is a dangerous capacitor.',
  'Ohm\'s Law is not a suggestion, no matter what the client says.',
  'Tip: progress autosaves between jobs — but hit Esc in-game to save manually too.',
  '"It worked on my breadboard" — your future excuse, probably.',
  'Smoke is the circuit\'s way of saying "thank you for trying."',
];

function snapshotState() {
  return {
    version: 1,
    savedAt: Date.now(),
    money,
    frame,
    grid: [...grid.entries()],
    allLitTimer,
    challengeWon,
    challengeStartFrame,
    totalElectrons,
    bankIncome,
    challengeStartMoney,
    currentJobId: currentJob ? currentJob.id : null,
    jobTimeLeft,
    completedJobs: [...completedJobs.entries()],  // [[id, grade], ...]
    boughtVeins: [...boughtVeins],
    veinYield: [...veinYield.entries()],
    burntVeins: [...burntVeins],
  };
}

function applySnapshot(data) {
  grid.clear();
  for (const [k, cell] of data.grid) grid.set(k, cell);
  for (const [k, cell] of [...grid]) {
    if (cell.type === 'led' || cell.type === 'led_part') grid.delete(k);
  }
  placeLEDs();
  money               = data.money ?? STARTING_CREDIT;
  displayedMoney      = money;
  frame               = data.frame ?? 0;
  allLitTimer         = data.allLitTimer ?? 0;
  challengeWon        = !!data.challengeWon;
  challengeStartFrame = data.challengeStartFrame ?? -1;
  totalElectrons      = data.totalElectrons ?? 0;
  bankIncome          = data.bankIncome ?? 0;
  challengeStartMoney = data.challengeStartMoney ?? 0;
  currentJob          = ALL_JOBS.find(j => j.id === data.currentJobId) || null;
  jobTimeLeft         = data.jobTimeLeft ?? -1;
  completedJobs.clear();
  for (const entry of (data.completedJobs ?? [])) {
    // Backwards-compat: old saves stored plain strings, new saves store [id, grade] pairs
    if (Array.isArray(entry)) completedJobs.set(entry[0], entry[1]);
    else completedJobs.set(entry, 'D');
  }
  boughtVeins.clear();
  for (const k of (data.boughtVeins ?? [])) { boughtVeins.add(k); ores.add(k); }
  burntVeins.clear();
  for (const k of (data.burntVeins ?? [])) {
    burntVeins.add(k);
    ores.delete(k);
    veinYield.delete(k);
    const [bx2, by2] = k.split(',').map(Number);
    const c = getG(bx2, by2);
    if (c && c.type === 'miner') delG(bx2, by2);
  }
  veinYield.clear();
  for (const [k, v] of (data.veinYield ?? [])) {
    if (!burntVeins.has(k) && !boughtVeins.has(k)) veinYield.set(k, v);
  }
  items = [];
  document.getElementById('moneyVal').textContent = '$' + money.toLocaleString();
  document.getElementById('win').style.display = 'none';
}

function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(snapshotState()));
    return true;
  } catch (e) {
    console.error('Save failed', e);
    return false;
  }
}

function hasSave() {
  return !!localStorage.getItem(SAVE_KEY);
}

function loadGame() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return false;
  try {
    applySnapshot(JSON.parse(raw));
    return true;
  } catch (e) {
    console.error('Load failed', e);
    return false;
  }
}

function saveToFile() {
  const blob = new Blob([JSON.stringify(snapshotState(), null, 0)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `breadboard-save-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function loadFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      applySnapshot(data);
      saveGame();
      enterGame();
    } catch (e) {
      flashWelcomeMsg('That file doesn\'t look like a valid save. Try another?');
    }
  };
  reader.readAsText(file);
}

function flashWelcomeMsg(text) {
  const el = document.getElementById('welcome-msg');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(flashWelcomeMsg._t);
  flashWelcomeMsg._t = setTimeout(() => el.classList.remove('show'), 2600);
}

function formatTime(frames) {
  const totalSec = Math.max(0, Math.ceil(frames / 60));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Shop keeper lines — rotate randomly each visit ──
const SHOPKEEPER_LINES = [
  'Everything you need to build something beautiful. Or dangerous. Up to you, really.',
  'Wire\'s cheap. Your time isn\'t. Keep that in mind.',
  'The Battery\'s on special. Well, it\'s not. But it feels like it should be.',
  'Pro tip: the Delete tool is half-price. It refunds half, too. Funny how that works.',
  'A Colorizer and a dream. That\'s all anyone really needs.',
  'You want the Gate? Bold choice. Respect.',
  'The Screen\'s popular with the artsy types. No judgment.',
];

function showShop() {
  // Populate table on first open (or every open — cheap)
  const tbody = document.getElementById('shop-table-body');
  const rows = [
    { key:'4', id:'switch',    cost: NODE_COST.switch    },
    { key:'5', id:'battery',   cost: NODE_COST.battery   },
    { key:'6', id:'colorizer', cost: NODE_COST.colorizer },
    { key:'9', id:'delay',     cost: NODE_COST.delay     },
    { key:'B', id:'button',    cost: NODE_COST.button    },
    { key:'G', id:'trigate',   cost: NODE_COST.trigate   },
    { key:'0', id:'ledscreen', cost: NODE_COST.ledscreen },
    { key:'8', id:'vein',      cost: NODE_COST.vein      },
  ];
  tbody.innerHTML = rows.map(r => {
    const tip = TOOL_TIPS[r.id];
    const name = tip ? tip.name : r.id;
    const desc = tip ? tip.desc : '';
    const costLabel = `$${r.cost}`;
    return `<tr>
      <td><span class="shop-name">${name}</span></td>
      <td><span class="shop-cost">${costLabel}</span></td>
      <td><span class="shop-desc">${desc}</span></td>
    </tr>`;
  }).join('');

  // Random keeper line
  document.getElementById('shop-keeper-line').textContent =
    SHOPKEEPER_LINES[Math.floor(Math.random() * SHOPKEEPER_LINES.length)];

  // Show current credits
  document.getElementById('shop-credits-val').textContent = '$' + money.toLocaleString();

  document.getElementById('welcome').style.display = 'none';
  document.getElementById('shop').style.display = 'flex';
}

function showWelcome() {
  gameState = 'welcome';
  document.getElementById('jobboard').style.display = 'none';
  document.getElementById('shop').style.display = 'none';
  document.getElementById('pause').style.display = 'none';
  document.getElementById('welcome-tagline').textContent =
    FLAVOR_LINES[Math.floor(Math.random() * FLAVOR_LINES.length)];
  document.getElementById('btn-continue').disabled = !hasSave();
  document.getElementById('btn-load').disabled = false;
  document.getElementById('welcome').style.display = 'flex';
}

function enterGame() {
  gameState = 'playing';
  document.getElementById('welcome').style.display = 'none';
  document.getElementById('jobboard').style.display = 'none';
  document.getElementById('pause').style.display = 'none';
  updateJobBanner();
  updateToolbarState();
}

function makeJobCard(job, jobnum) {
  const grade = completedJobs.get(job.id);   // undefined if not done
  const done  = !!grade;
  const rank  = grade ? getRank(grade === 'S' ? 0 : grade === 'A' ? 60 : grade === 'B' ? 180 : grade === 'C' ? 360 : 600) : null;
  const card = document.createElement('div');
  card.className = 'job-card' + (done ? ' job-done' : '');
  card.dataset.jobnum = jobnum;

  const reqBadges = (job.requires && job.requires.length)
    ? `<div class="job-row-requires">${job.requires.map(t =>
        `<span class="job-row-req-badge">${(COMPONENT_LABEL[t] || t).toUpperCase()}</span>`
      ).join('')}</div>`
    : '';

  const deadlineLabel = job.timeLimit
    ? `⏱&nbsp;${formatTime(job.timeLimit * 60)}`
    : 'No deadline';

  const rankBadgeHtml = done && rank
    ? `<div class="job-rank-badge" style="color:${rank.color};text-shadow:0 0 12px ${rank.color}66">${grade}</div>
       <div class="job-rank-label" style="color:${rank.color}">${rank.label}</div>`
    : '';

  card.innerHTML = `
    <div class="job-row-num">${jobnum}${rankBadgeHtml}</div>
    <div class="job-row-body">
      <div class="job-row-client">${job.client}</div>
      <div class="job-row-title">${job.title}</div>
      <div class="job-row-objective">${job.objective}</div>
      ${reqBadges}
      <div class="job-row-brief">${job.brief}</div>
    </div>
    <div class="job-row-side">
      <div>
        <div class="job-row-payout">$${job.reward.toLocaleString()}</div>
        <div class="job-row-deadline">${deadlineLabel}</div>
      </div>
      <button class="job-accept">${done ? 'REPLAY ↩' : 'ACCEPT →'}</button>
    </div>
  `;
  card.querySelector('.job-accept').addEventListener('click', () => acceptJob(job));
  return card;
}

function makePuzzleCard(def, num) {
  const done = completedJobs.has(def.id);
  const card = document.createElement('div');
  card.className = 'job-card puzzle-card' + (done ? ' job-done' : '');

  const kitBadges = Object.entries(def.kit).map(([t, n]) =>
    `<span class="job-row-req-badge" style="background:rgba(30,80,160,0.12);border-color:rgba(44,81,131,0.3);color:#1a4a90">${(COMPONENT_LABEL[t] || t).toUpperCase()} ×${n}</span>`
  ).join('');

  const doneBadge = done
    ? `<div class="job-rank-badge" style="color:#40e890;text-shadow:0 0 12px #40e89066">✓</div><div class="job-rank-label" style="color:#40e890">SOLVED</div>`
    : '';

  card.innerHTML = `
    <div class="job-row-num">${String(num).padStart(2,'0')}${doneBadge}</div>
    <div class="job-row-body">
      <div class="job-row-client">${def.client}</div>
      <div class="job-row-title">${def.title}</div>
      <div class="job-row-objective">${def.objective}</div>
      <div class="job-row-requires">${kitBadges}</div>
      <div class="job-row-brief">${def.brief}</div>
    </div>
    <div class="job-row-side">
      <div>
        <div class="job-row-payout" style="font-size:13px;color:var(--ink-faint);letter-spacing:1px">PUZZLE<br>MODE</div>
      </div>
      <button class="job-accept" style="background:linear-gradient(135deg,#163a66,#1a5090)">${done ? 'REPLAY ↩' : 'START →'}</button>
    </div>
  `;
  card.querySelector('.job-accept').addEventListener('click', () => loadPuzzle(def));
  return card;
}

function buildJobCards() {
  const wrap = document.getElementById('job-cards');
  wrap.innerHTML = '';

  // ── Playpen card ──
  const playpenCard = document.createElement('div');
  playpenCard.className = 'job-card playpen-card';
  playpenCard.innerHTML = `
    <div class="job-row-num">∞</div>
    <div class="job-row-body">
      <div class="job-row-client">Free Build</div>
      <div class="job-row-title">Playpen</div>
      <div class="job-row-objective">No rules. No goals. Unlimited components. Build anything.</div>
      <div class="job-row-brief">"The best way to learn is to blow something up. Safely. Hopefully."</div>
    </div>
    <div class="job-row-side">
      <div class="job-row-payout">🔧</div>
      <button class="job-accept" style="background:linear-gradient(135deg,#3a2a0a,#6a4a10)">ENTER →</button>
    </div>
  `;
  playpenCard.querySelector('.job-accept').addEventListener('click', () => {
    document.getElementById('jobboard').style.display = 'none';
    enterPlaypen();
  });
  wrap.appendChild(playpenCard);

  // ── Puzzle levels ──
  const puzzHeader = document.createElement('div');
  puzzHeader.className = 'job-section-header';
  puzzHeader.innerHTML = `
    <span>PUZZLE MODE</span>
    <span class="job-section-progress">${PUZZLE_LEVELS.filter(p => completedJobs.has(p.id)).length} / ${PUZZLE_LEVELS.length} solved</span>
  `;
  wrap.appendChild(puzzHeader);
  for (const [i, def] of PUZZLE_LEVELS.entries()) {
    wrap.appendChild(makePuzzleCard(def, i + 1));
  }
}

function showJobBoard() {
  gameState = 'jobboard';
  document.getElementById('welcome').style.display = 'none';
  document.getElementById('pause').style.display = 'none';
  buildJobCards();
  document.getElementById('jobboard').style.display = 'flex';
  updateToolbarState(); // re-enable all tools when no job is active
}

function acceptJob(job) {
  currentJob  = job;
  jobTimeLeft = job.timeLimit ? job.timeLimit * 60 : -1;
  resetChallenge({ keepMoney: true });
  enterGame();
  setTool('miner');
  popups.push({ wx: WORLD_W / 2, wy: WORLD_H / 2 - 3, life: 70, text: `JOB ACCEPTED: ${job.title}` });
}

// ── Update toolbar cost spans with kit counts (or restore prices) ──
function updateKitDisplay() {
  const toolbar = document.getElementById('toolbar');
  if (!toolbar) return;
  const inKit = levelKit != null;
  toolbar.classList.toggle('puzzle-mode', inKit);
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    const t = btn.dataset.tool;
    const costEl = btn.querySelector('.cost');
    if (!costEl) return;
    if (inKit) {
      const count = levelKit[t] ?? 0;
      costEl.textContent = `×${count}`;
      costEl.style.color = count > 0 ? '#1a6e3a' : '#a83030';
    } else {
      costEl.style.color = '';
      costEl.textContent = NODE_COST[t] != null ? `$${NODE_COST[t]}` : '';
    }
  });
  updateToolbarState();
}

// ── Place a 4×4 LED footprint for a puzzle level ──
function placePuzzleLed(ox, oy, dir, color) {
  const [aox, aoy] = dir === DIR.R ? [0,1] : dir === DIR.D ? [1,0] : dir === DIR.L ? [3,1] : [1,3];
  for (let dy = 0; dy < 4; dy++) {
    for (let dx = 0; dx < 4; dx++) {
      const isAnchor = dx === aox && dy === aoy;
      setG(ox+dx, oy+dy, isAnchor
        ? { type:'led', charge:0, flash:0, color, size:4, dir, originX:ox, originY:oy, locked:true }
        : { type:'led_part', originX:ox, originY:oy, locked:true });
    }
  }
}

// ── Load a puzzle level — places fixed tiles, sets kit, enters game ──
function loadPuzzle(def) {
  // Clean up ore tiles added by a previous puzzle
  for (const k of puzzleOres) ores.delete(k);
  puzzleOres.clear();

  isPlaypen   = false;
  currentJob  = def;
  jobTimeLeft = def.timeLimit ? def.timeLimit * 60 : -1;
  levelKit    = { ...def.kit };
  resetChallenge({ keepMoney: true });   // clears grid; placeLEDs places 0 LEDs (def.leds=0)

  // Register puzzle ore tiles (needed for locked miners to function)
  for (const o of (def.fixedOres || [])) {
    const k = key(o.x, o.y);
    ores.add(k);
    puzzleOres.add(k);
  }

  // Place fixed batteries (locked so player can't delete them)
  for (const b of (def.fixedBatteries || [])) {
    setG(b.x, b.y, { type:'battery', dir:b.dir, charge: b.charge ?? 0, dischargeTick:0, flash:0, on: b.on ?? true, color:b.color ?? undefined, locked:true });
  }
  // Place fixed LEDs
  for (const l of (def.fixedLeds || [])) {
    placePuzzleLed(l.ox, l.oy, l.dir, l.color);
  }
  // Place fixed components (miners, buttons, etc.) — all locked
  for (const ex of (def.fixedExtra || [])) {
    setG(ex.x, ex.y, { ...ex.cell, locked: true });
  }

  // Center camera on puzzle area (batteries and LEDs are around col 32, row 32)
  cam.x    = -32 * TILE;
  cam.y    = -32 * TILE;
  cam.zoom = 1.8;

  document.getElementById('chal-title').textContent = `PUZZLE ${def.id.split('-')[1]}`;
  document.getElementById('ledMenu').style.display = 'none';
  updateKitDisplay();
  enterGame();
  setTool('belt');
  popups.push({ wx: 32, wy: 29, life: 80, text: `PUZZLE: ${def.title.toUpperCase()}` });
}

function enterPlaypen() {
  isPlaypen   = true;
  currentJob  = null;
  jobTimeLeft = -1;
  resetChallenge({ keepMoney: true });
  const ledCells = [];
  for (const [k, cell] of [...grid]) {
    if (cell.type === 'led' || cell.type === 'led_part') {
      ledCells.push([k, cell]);
      grid.delete(k);
    }
  }
  playpenStash = { ores: new Set(ores), ledCells };
  ores.clear();
  document.getElementById('chal-title').textContent = 'PLAYPEN';
  document.getElementById('toolbar').classList.add('playpen');
  document.getElementById('ledMenu').style.display = '';
  enterGame();
  setTool('vein');
  popups.push({ wx: WORLD_W / 2, wy: WORLD_H / 2 - 3, life: 70, text: 'WELCOME TO THE PLAYPEN — BUILD ANYTHING, FREE' });
}

function exitPlaypen() {
  isPlaypen = false;
  currentJob = null;
  jobTimeLeft = -1;
  document.getElementById('chal-title').textContent = 'CIRCUIT BOARD';
  document.getElementById('toolbar').classList.remove('playpen');
  document.getElementById('ledMenu').style.display = 'none';
  document.getElementById('ledMenuPanel').classList.remove('open');
  if (tool && tool.startsWith('led_')) setTool('belt');
  resetChallenge({ keepMoney: true });
  if (playpenStash) {
    ores.clear();
    for (const k of playpenStash.ores) ores.add(k);
    for (const [k, cell] of playpenStash.ledCells) grid.set(k, cell);
    playpenStash = null;
  }
  showJobBoard();
}

function updateJobBanner() {
  const banner = document.getElementById('job-banner');
  const text   = document.getElementById('job-banner-text');
  const dl     = document.getElementById('job-deadline');
  const clock  = document.getElementById('puzzle-clock');

  // ── Puzzle countdown clock (top-centre) ──
  const showClock = !!(currentJob?.timeLimit && !challengeWon && !isPlaypen);
  if (clock) {
    clock.style.display = showClock ? 'flex' : 'none';
    if (showClock) {
      const total = currentJob.timeLimit * 60;
      const pct   = jobTimeLeft / total;
      const warn  = pct < 0.5 && pct >= 0.25;
      const danger = pct < 0.25;
      clock.classList.toggle('warn',   warn);
      clock.classList.toggle('danger', danger);
      const timeEl = document.getElementById('puzzle-clock-time');
      const barFill = document.getElementById('puzzle-clock-bar-fill');
      if (timeEl) timeEl.textContent = formatTime(jobTimeLeft);
      if (barFill) barFill.style.width = `${Math.max(0, pct * 100)}%`;
    }
  }

  if (isPlaypen) {
    banner.style.display = 'flex';
    text.textContent = 'PLAYPEN — FREE BUILD';
    text.title = 'Experiment freely: every module and component is free to place. Nothing here is graded or saved as a job.';
    dl.textContent = 'NO OBJECTIVES';
    dl.classList.remove('warn', 'danger');
    updateGoalPanel();
    return;
  }
  if (!currentJob) {
    banner.style.display = 'none';
    updateGoalPanel();
    return;
  }
  banner.style.display = 'flex';
  text.textContent = currentJob.client.split(',')[0].split('(')[0].trim();
  text.title = currentJob.title;
  // Hide inline deadline when the big clock is showing
  if (currentJob.timeLimit && !challengeWon) {
    dl.textContent = '';
    dl.classList.remove('warn', 'danger');
  } else {
    dl.textContent = 'NO DEADLINE';
    dl.classList.remove('warn', 'danger');
  }
  updateGoalPanel();
}

function updateGoalPanel() {
  const objEl = document.getElementById('goal-objective');
  const reqEl = document.getElementById('goal-requires');
  if (!objEl || !reqEl) return;

  if (!currentJob && !isPlaypen) {
    objEl.style.display = 'none';
    reqEl.style.display = 'none';
    return;
  }

  if (isPlaypen) {
    objEl.style.display = 'block';
    objEl.textContent = 'Build freely — place anything, no objectives.';
    reqEl.style.display = 'none';
    return;
  }

  // Show objective
  objEl.style.display = 'block';
  objEl.textContent = currentJob.objective;

  // Show requirements with live met/unmet status
  const requires = currentJob.requires || [];
  if (requires.length) {
    const have = new Set();
    for (const cell of grid.values()) have.add(cell.type);
    reqEl.style.display = 'flex';
    reqEl.innerHTML = requires.map(t => {
      const ok = have.has(t);
      const label = (COMPONENT_LABEL[t] || t).toUpperCase();
      return `<span class="goal-req-item${ok ? ' met' : ''}">${ok ? '✓' : '○'} ${label}</span>`;
    }).join('');
  } else {
    reqEl.style.display = 'none';
  }
}

function failJob() {
  levelKit = null;
  for (const k of puzzleOres) ores.delete(k);
  puzzleOres.clear();
  currentJob = null;
  jobTimeLeft = -1;
  gameState = 'jobboard';
  popups.push({ wx: WORLD_W / 2, wy: WORLD_H / 2 - 3, life: 80, text: JOB_FAIL_LINES[Math.floor(Math.random() * JOB_FAIL_LINES.length)] });
  setTimeout(() => {
    resetChallenge({ keepMoney: true });
    saveGame();
    showJobBoard();
  }, 1400);
}

function startNewGame() {
  if (hasSave()) {
    localStorage.removeItem(SAVE_KEY);
  }
  currentJob  = null;
  jobTimeLeft = -1;
  resetChallenge();
  showJobBoard();
}

function continueGame() {
  if (loadGame()) {
    if (currentJob) {
      enterGame();
    } else {
      showJobBoard();
    }
  } else {
    flashWelcomeMsg('No save file found yet — start a new game first.');
  }
}

function togglePause() {
  if (gameState === 'playing') {
    gameState = 'paused';
    document.getElementById('btn-quit').textContent = isPlaypen ? 'EXIT PLAYPEN' : 'QUIT TO TITLE';
    document.getElementById('btn-save').style.display = isPlaypen ? 'none' : '';
    document.getElementById('btn-savefile').style.display = isPlaypen ? 'none' : '';
    document.getElementById('pause').style.display = 'flex';
  } else if (gameState === 'paused') {
    gameState = 'playing';
    document.getElementById('pause').style.display = 'none';
  }
}

const loadFileInput = document.createElement('input');
loadFileInput.type = 'file';
loadFileInput.accept = '.json,application/json';
loadFileInput.style.display = 'none';
document.body.appendChild(loadFileInput);
loadFileInput.addEventListener('change', () => {
  const file = loadFileInput.files && loadFileInput.files[0];
  if (file) loadFromFile(file);
  loadFileInput.value = '';
});

document.getElementById('btn-jobboard-back').addEventListener('click', () => {
  currentJob = null;
  jobTimeLeft = -1;
  showWelcome();
});

document.getElementById('btn-newgame').addEventListener('click', startNewGame);
document.getElementById('btn-quit-app').addEventListener('click', () => window.close());
document.getElementById('btn-continue').addEventListener('click', continueGame);
document.getElementById('btn-load').addEventListener('click', () => loadFileInput.click());
document.getElementById('btn-shop').addEventListener('click', showShop);
document.getElementById('btn-playpen').addEventListener('click', enterPlaypen);
document.getElementById('btn-shop-back').addEventListener('click', showWelcome);

document.getElementById('btn-resume').addEventListener('click', togglePause);
document.getElementById('btn-menu').addEventListener('click', togglePause);
document.getElementById('btn-save').addEventListener('click', () => {
  saveGame();
  const btn = document.getElementById('btn-save');
  const old = btn.textContent;
  btn.textContent = 'SAVED ✓';
  setTimeout(() => { btn.textContent = old; }, 1100);
});
document.getElementById('btn-savefile').addEventListener('click', saveToFile);
document.getElementById('btn-quit').addEventListener('click', () => {
  if (isPlaypen) {
    document.getElementById('pause').style.display = 'none';
    exitPlaypen();
    return;
  }
  saveGame();
  showWelcome();
});

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (gameState === 'playing') {
    // First Esc clears the selected tool; with nothing selected it opens the menu
    if (tool) setTool(null);
    else togglePause();
  } else if (gameState === 'paused') {
    togglePause();
  }
});

// ═══════════════════════════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════════════════════════

function loop() {
  update();
  render();
  updateMoneyDisplay();
  updateChallengeHUD();
  if (gameState === 'playing') updateJobBanner();
  requestAnimationFrame(loop);
}

// ═══════════════════════════════════════════════════════════════
// TOOL TOOLTIPS
// ═══════════════════════════════════════════════════════════════

const TOOL_TIPS = {
  miner:     { name:'Extractor',   key:'1', desc:'Place on a Power Point to pull electrons out. Power Points have finite charge — they burn out when fully drained!',               tips:['R  rotate · right-click to delete','Click placed extractor: upgrade extraction tier'] },
  belt:      { name:'Wire',        key:'2', desc:'Drag across the grid to draw a wire path. Electrons flow in the direction shown by the arrow on each tile.',                     tips:['R  rotate 90°  ·  F  flip 180°','Click+drag existing wire to reroute'] },
  receiver:  { name:'Bank',        key:'3', desc:'Earns credits for every electron that arrives. The amber arrow shows the preferred input side.',                                  tips:['Hover + R  rotate facing'] },
  switch:    { name:'Switch',      key:'4', desc:'Alternates its output path each time an electron passes through — automatically splits flow between two directions.',              tips:['Hover + R  flip facing','Amber arrow = input  ·  Cyan = outputs'] },
  battery:   { name:'Battery',     key:'5', desc:'Buffers electrons: charges from the input side and discharges out the output side. Useful for redirecting or storing flow.',     tips:['Hover + R  rotate','Click placed battery: toggle on / off'] },
  colorizer: { name:'Colorizer',   key:'6', desc:'Tints every electron passing through it. Coloured electrons can only charge matching LED types.',                                tips:['Click placed colorizer: cycle colour','Hover + R  flip axis'] },
  delay:     { name:'Delay',       key:'9', desc:'Holds each electron for a set time before releasing it onward — great for timing and sequencing complex circuits.',              tips:['Click placed delay: cycle hold time (0.2 s → 1.0 s)','Hover + R  rotate'] },
  ledscreen: { name:'Screen',      key:'0', desc:'A 6×6 pixel display. Route electrons into individual pixel tiles to light them up. Any colour works.',                          tips:[] },
  button:    { name:'Button',      key:'B', desc:'Manually gates electron flow on all connected paths simultaneously. Open = electrons pass through freely.',                      tips:['Click placed button: open / close the gate'] },
  trigate:   { name:'Gate',        key:'G', desc:'A 3-tile wide gate controlling three parallel channels at once — one click toggles all three together.',                        tips:['Click placed gate: toggle all 3 channels','Hover + R  rotate'] },
  vein:      { name:'Power Point', key:'8', desc:'Place a permanent extra power source tile. Unlike wild Power Points on the map, purchased ones never burn out.',                tips:[] },
  delete:    { name:'Delete',      key:'7 / Del', desc:'Remove a placed component and recover half its original cost. Hold to keep deleting as you drag.',                        tips:['Right-click any placed component as a shortcut'] },
};

function initToolTips() {
  const ttEl   = document.getElementById('tool-tooltip');
  const ttName = document.getElementById('tt-name');
  const ttKey  = document.getElementById('tt-key');
  const ttDesc = document.getElementById('tt-desc');
  const ttTips = document.getElementById('tt-tips');
  if (!ttEl || !ttName || !ttDesc) return;

  let timer = null;

  const show = (btn) => {
    const tip = TOOL_TIPS[btn.dataset.tool];
    if (!tip) return;
    ttName.textContent = tip.name;
    ttKey.textContent  = tip.key ? `KEY  ${tip.key}` : '';
    ttDesc.textContent = tip.desc;
    if (tip.tips && tip.tips.length) {
      ttTips.innerHTML = tip.tips.map(t => `<div class="tt-tip">${t}</div>`).join('');
      ttTips.style.display = 'flex';
    } else {
      ttTips.style.display = 'none';
    }
    ttEl.style.display = 'block';
    const rect = btn.getBoundingClientRect();
    const ttW  = ttEl.offsetWidth;
    const ttH  = ttEl.offsetHeight;
    let left   = rect.left + rect.width / 2 - ttW / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - ttW - 8));
    ttEl.style.left = left + 'px';
    ttEl.style.top  = (rect.top - ttH - 10) + 'px';
    const caretX = (rect.left + rect.width / 2) - left;
    ttEl.style.setProperty('--caret-x', caretX + 'px');
  };

  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      if ((btn as HTMLElement).classList.contains('tool-disabled')) return;
      clearTimeout(timer);
      timer = setTimeout(() => show(btn as HTMLElement), 130);
    });
    btn.addEventListener('mouseleave', () => {
      clearTimeout(timer);
      ttEl.style.display = 'none';
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

generateOres();
placeLEDs();
initToolTips();

cam.x = -WORLD_W * TILE / 2 + 80;
cam.y = -WORLD_H * TILE / 2 + 40;

setTimeout(() => {
  const t = document.getElementById('toast');
  t.style.opacity = '0';
  setTimeout(() => t.style.display = 'none', 500);
}, 7000);

window.addEventListener('beforeunload', () => { if (gameState !== 'welcome' && !isPlaypen) saveGame(); });
window.addEventListener('blur', () => { if (gameState === 'playing' && !isPlaypen) saveGame(); });

showWelcome();
loop();

