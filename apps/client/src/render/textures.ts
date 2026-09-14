/** Curated local CC0 Kenney assets. No runtime CDN, remote API or generated character art. */
import { Assets, Texture } from 'pixi.js';

export const CHARACTER_COLORS = ['green', 'pink', 'purple', 'yellow'] as const;
export type CharacterColor = typeof CHARACTER_COLORS[number];
export const CHARACTER_POSES = ['front', 'idle', 'walk_a', 'walk_b', 'jump', 'hit', 'duck'] as const;
export type CharacterPose = typeof CHARACTER_POSES[number];
export type CharacterFrames = Record<CharacterPose, Texture>;

export interface GameAssets {
  sparkle: Texture;
  goldDot: Texture;
  whiteDot: Texture;
  redTex: Texture;
  vignette: Texture;
  ball: Texture;
  glow: Texture;
  spike: Texture;
  flagCloth: Texture;
  flagFrames: Texture[];
  confetti: Texture;
  skyTopColor: number;
  skyBottomColor: number;
  clouds: Texture;
  hills: Texture;
  forestLayer: Texture;
  nearForest: Texture;
  groundTop: Texture;
  groundFill: Texture;
  gemFrames: Texture[];
  bush: Texture;
  rock: Texture;
  platformLong: Texture;
  crate: Texture;
  groundDecor: Texture[];
  spring: Texture;
  saw: Texture;
  shield: Texture;
  magnet: Texture;
  arrowUp: Texture;
  star: Texture;
  warning: Texture;
  conveyor: Texture;
  characters: Record<CharacterColor, CharacterFrames>;
}

export const assetUrl = (p: string): string => import.meta.env.BASE_URL + p.replace(/^\//, '');
export const skinColor = (id: string): CharacterColor =>
  ({ lumina: 'green', sakura: 'pink', midnight: 'purple', cyber: 'yellow' } as const)[id as 'lumina'] ?? 'green';

const KENNEY_FILES = [
  'terrain_grass_block_top', 'terrain_grass_block_center', 'terrain_grass_horizontal_middle',
  'bridge_logs', 'block_planks', 'bush', 'rock', 'grass', 'mushroom_brown', 'mushroom_red',
  'gem_yellow', 'star', 'spikes', 'spring', 'saw', 'flag_green_a', 'flag_green_b',
  'coin_gold', 'background_clouds', 'background_fade_hills', 'background_fade_trees',
  'background_color_trees', 'conveyor', 'block_empty_warning',
  ...CHARACTER_COLORS.flatMap(color => CHARACTER_POSES.map(pose => `character_${color}_${pose}`)),
];

/** Only lightweight neutral support textures; all visible illustration comes from the pack. */
function supportTexture(kind: 'glow' | 'dot' | 'vignette'): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  if (kind === 'glow') {
    const gradient = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,0.7)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
  } else if (kind === 'dot') {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(32, 32, 20, 0, Math.PI * 2);
    ctx.fill();
  }
  return Texture.from(canvas);
}

export async function loadAssets(onProgress?: (done: number, total: number) => void): Promise<GameAssets> {
  const paths = [...KENNEY_FILES.map(name => `assets/kenney/${name}.png`), 'assets/icons/shield.svg', 'assets/icons/magnet.svg', 'assets/icons/arrow-up.svg'];
  const textures = new Map<string, Texture>();
  let done = 0;
  try {
    await Promise.all(paths.map(async path => {
      const texture = await Assets.load<Texture>(assetUrl(path));
      texture.source.scaleMode = 'linear';
      textures.set(path, texture);
      onProgress?.(++done, paths.length);
    }));
  } catch (error) {
    throw new Error('游戏素材读取失败，请刷新页面重试', { cause: error });
  }
  const k = (name: string): Texture => textures.get(`assets/kenney/${name}.png`)!;
  const characters = Object.fromEntries(CHARACTER_COLORS.map(color => [color,
    Object.fromEntries(CHARACTER_POSES.map(pose => [pose, k(`character_${color}_${pose}`)])),
  ])) as Record<CharacterColor, CharacterFrames>;
  const dot = supportTexture('dot');
  return {
    sparkle: k('star'), goldDot: k('coin_gold'), whiteDot: dot, redTex: k('gem_yellow'),
    vignette: supportTexture('vignette'), ball: characters.green.front, glow: supportTexture('glow'),
    spike: k('spikes'), flagCloth: k('flag_green_a'), flagFrames: [k('flag_green_a'), k('flag_green_b')],
    confetti: dot, skyTopColor: 0xc7e7ed, skyBottomColor: 0xf2f8ed,
    clouds: k('background_clouds'), hills: k('background_fade_hills'),
    forestLayer: k('background_fade_trees'), nearForest: k('background_color_trees'),
    groundTop: k('terrain_grass_block_top'), groundFill: k('terrain_grass_block_center'),
    gemFrames: [k('gem_yellow')], bush: k('bush'), rock: k('rock'),
    platformLong: k('bridge_logs'), crate: k('block_planks'),
    groundDecor: [k('grass'), k('bush'), k('mushroom_brown')],
    spring: k('spring'), saw: k('saw'), shield: textures.get('assets/icons/shield.svg')!,
    magnet: textures.get('assets/icons/magnet.svg')!, arrowUp: textures.get('assets/icons/arrow-up.svg')!, star: k('star'),
    warning: k('block_empty_warning'), conveyor: k('conveyor'), characters,
  };
}
