import { Color } from '../engine/types';

export type ThemeId = 'cosmic' | 'classic';

export type OwnerColor = 'black' | 'white';

export interface Theme {
  id: ThemeId;
  name: string;
  description: string;

  // Backgrounds
  canvasBackground: string;
  boardBackground: string;
  boardBorderRadius: number;

  // Grid
  lineColor: string;
  lineWidth: number;
  starColor: string;
  starRadius: number;
  coordinateColor: string;

  // Overlays
  atariGlow: string;
  hoverValid: string;

  // Last-move marker
  lastMoveHalo: string;         // Ring drawn around the just-placed stone
  lastMoveTextOnBlack: string;  // Move-number color when displayed on a black stone
  lastMoveTextOnWhite: string;  // Move-number color when displayed on a white stone

  // Stone rendering
  drawStone: (ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: Color) => void;

  // Solid stone colors — used by placement animation and dead-stone rendering
  stoneBlackSolid: string;
  stoneWhiteSolid: string;
  stoneBlackOutline: string;
  stoneWhiteOutline: string;

  // Capture animation colors
  captureFragmentBlack: string;
  captureFragmentWhite: string;
  captureFlashSmall: string;
  captureFlashBig: string;
  shockwaveSmall: string;
  shockwaveBig: string;
  placementRippleBlack: string;
  placementRippleWhite: string;

  // Territory rendering
  drawTerritory: (
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    cellSize: number,
    owner: OwnerColor,
  ) => void;
  territoryMarkerBlack: string;
  territoryMarkerWhite: string;

  // Dead-stone rendering
  deadStoneBlack: string;
  deadStoneWhite: string;

  // Animation density — 1 = full cosmic celebration, 0.3 = restrained classic
  animationIntensity: number;

  // Sound pack id
  soundPack: 'cosmic' | 'classic';
}

// ---------- Cosmic theme ----------

function drawCosmicStone(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: Color,
) {
  if (color === Color.Black) {
    // Outer ring for visibility against dark board
    ctx.beginPath();
    ctx.arc(x, y, r + 1, 0, Math.PI * 2);
    ctx.fillStyle = '#4a4a6a';
    ctx.fill();
    // Main body
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(x - r * 0.25, y - r * 0.25, r * 0.1, x, y, r);
    g.addColorStop(0, '#3d3d5c');
    g.addColorStop(0.7, '#252540');
    g.addColorStop(1, '#1a1a30');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(100,100,150,0.6)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // Specular highlight
    ctx.beginPath();
    ctx.arc(x - r * 0.22, y - r * 0.22, r * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(120,120,180,0.35)';
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(x - r * 0.2, y - r * 0.2, r * 0.1, x, y, r);
    g.addColorStop(0, '#f0f0ff');
    g.addColorStop(0.6, '#d8d8ee');
    g.addColorStop(1, '#c0c0d8');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,160,190,0.6)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x - r * 0.18, y - r * 0.18, r * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fill();
  }
}

function drawCosmicTerritory(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cellSize: number,
  owner: OwnerColor,
) {
  const halfCell = cellSize / 2;
  const g = ctx.createRadialGradient(x, y, 0, x, y, halfCell);
  if (owner === 'black') {
    g.addColorStop(0, 'rgba(100, 120, 220, 0.6)');
    g.addColorStop(0.6, 'rgba(80, 100, 200, 0.3)');
    g.addColorStop(1, 'rgba(60, 80, 180, 0)');
  } else {
    g.addColorStop(0, 'rgba(230, 220, 200, 0.6)');
    g.addColorStop(0.6, 'rgba(210, 200, 180, 0.3)');
    g.addColorStop(1, 'rgba(190, 180, 160, 0)');
  }
  ctx.fillStyle = g;
  ctx.fillRect(x - halfCell, y - halfCell, cellSize, cellSize);
}

export const cosmicTheme: Theme = {
  id: 'cosmic',
  name: 'Cosmic',
  description: 'Deep space — gradient stones, gold-tinted board, nebula territory.',

  canvasBackground: '#0d1117',
  boardBackground: 'rgba(50, 38, 20, 0.6)',
  boardBorderRadius: 8,

  lineColor: 'rgba(140, 115, 65, 0.45)',
  lineWidth: 1,
  starColor: 'rgba(180, 150, 80, 0.7)',
  starRadius: 3,
  coordinateColor: '#555',

  atariGlow: 'rgba(255, 107, 107, 0.5)',
  hoverValid: 'rgba(88, 166, 255, 0.25)',

  lastMoveHalo: 'rgba(88, 166, 255, 0.9)',
  lastMoveTextOnBlack: 'rgba(230,230,255,0.95)',
  lastMoveTextOnWhite: 'rgba(30,30,60,0.9)',

  drawStone: drawCosmicStone,

  stoneBlackSolid: '#2d2d48',
  stoneWhiteSolid: '#d8d8ee',
  stoneBlackOutline: 'rgba(100,100,150,0.6)',
  stoneWhiteOutline: 'rgba(160,160,190,0.6)',

  captureFragmentBlack: '#5555aa',
  captureFragmentWhite: '#ddddff',
  captureFlashSmall: '#58a6ff',
  captureFlashBig: '#ffd700',
  shockwaveSmall: '#58a6ff',
  shockwaveBig: '#ffd700',
  placementRippleBlack: '#7777bb',
  placementRippleWhite: '#aaaadd',

  drawTerritory: drawCosmicTerritory,
  territoryMarkerBlack: '#6677cc',
  territoryMarkerWhite: '#ccbbaa',

  deadStoneBlack: '#2d2d48',
  deadStoneWhite: '#c8c8dd',

  animationIntensity: 1,

  soundPack: 'cosmic',
};

// ---------- Classic theme ----------

function drawClassicStone(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: Color,
) {
  if (color === Color.Black) {
    // Slate/obsidian — near-black with subtle highlight
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    g.addColorStop(0, '#2a2a2a');
    g.addColorStop(0.7, '#111111');
    g.addColorStop(1, '#000000');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // Very subtle specular
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
  } else {
    // Clamshell — warm off-white
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(x - r * 0.25, y - r * 0.25, r * 0.1, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.6, '#f4ede0');
    g.addColorStop(1, '#e0d4bf');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,100,70,0.35)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // Highlight
    ctx.beginPath();
    ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fill();
  }
}

function drawClassicTerritory(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cellSize: number,
  owner: OwnerColor,
) {
  const halfCell = cellSize / 2;
  ctx.fillStyle = owner === 'black' ? 'rgba(40, 40, 40, 0.28)' : 'rgba(245, 240, 225, 0.35)';
  ctx.fillRect(x - halfCell, y - halfCell, cellSize, cellSize);
}

export const classicTheme: Theme = {
  id: 'classic',
  name: 'Classic',
  description: 'Kaya wood board, slate and clamshell stones, crisp lines.',

  canvasBackground: '#2a1f14',
  boardBackground: '#e4b870',
  boardBorderRadius: 4,

  lineColor: 'rgba(40, 25, 10, 0.85)',
  lineWidth: 1,
  starColor: 'rgba(25, 15, 5, 0.95)',
  starRadius: 3.5,
  coordinateColor: 'rgba(60, 40, 20, 0.7)',

  atariGlow: 'rgba(200, 60, 60, 0.55)',
  hoverValid: 'rgba(60, 40, 20, 0.18)',

  lastMoveHalo: 'rgba(180, 30, 30, 0.85)',
  lastMoveTextOnBlack: 'rgba(255,255,255,0.95)',
  lastMoveTextOnWhite: 'rgba(0,0,0,0.85)',

  drawStone: drawClassicStone,

  stoneBlackSolid: '#0f0f0f',
  stoneWhiteSolid: '#f2ecdc',
  stoneBlackOutline: 'rgba(0,0,0,0.6)',
  stoneWhiteOutline: 'rgba(120,100,70,0.35)',

  captureFragmentBlack: '#333333',
  captureFragmentWhite: '#e8dfc9',
  captureFlashSmall: 'rgba(255,255,255,0.6)',
  captureFlashBig: 'rgba(255,240,200,0.7)',
  shockwaveSmall: 'rgba(40,25,10,0.4)',
  shockwaveBig: 'rgba(40,25,10,0.5)',
  placementRippleBlack: 'rgba(30,20,10,0.5)',
  placementRippleWhite: 'rgba(30,20,10,0.35)',

  drawTerritory: drawClassicTerritory,
  territoryMarkerBlack: '#2a2a2a',
  territoryMarkerWhite: '#6b5d45',

  deadStoneBlack: '#0f0f0f',
  deadStoneWhite: '#f2ecdc',

  animationIntensity: 0.35,

  soundPack: 'classic',
};

// ---------- Registry ----------

export const THEMES: Record<ThemeId, Theme> = {
  cosmic: cosmicTheme,
  classic: classicTheme,
};

export function getTheme(id: ThemeId): Theme {
  return THEMES[id] ?? cosmicTheme;
}

/**
 * Apply a density multiplier to the theme's animation intensity. Used so the
 * "zen" density setting dampens visuals globally without each animation
 * needing to know about the user's preference.
 */
export function withDensity(theme: Theme, multiplier: number): Theme {
  if (multiplier === 1) return theme;
  return { ...theme, animationIntensity: theme.animationIntensity * multiplier };
}
