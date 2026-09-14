import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { CHARACTER_COLORS, CHARACTER_POSES, skinColor } from '../src/render/textures.js';
const root = resolve(import.meta.dirname, '../public/assets');
const manifest = JSON.parse(readFileSync(resolve(root, 'asset-provenance.json'), 'utf8')) as {
  license: string;
  files: { file: string; sha256: string; size: [number, number]; source: string }[];
  icons: { files: { file: string; sha256: string }[] };
};
const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

describe('licensed art migration', () => {
  it('ships the source license and exact imported bitmap hashes', () => {
    expect(manifest.license).toBe('CC0-1.0');
    expect(readFileSync(resolve(root, 'kenney/LICENSE.txt'), 'utf8')).toContain('commercial');
    for (const entry of manifest.files) expect(sha(resolve(root, 'kenney', entry.file))).toBe(entry.sha256);
  });
  it('ships both Lucide and Feather license notices with local icons', () => {
    const license = readFileSync(resolve(root, 'icons/LICENSE.txt'), 'utf8');
    expect(license).toContain('ISC License');
    expect(license).toContain('The MIT License');
    for (const entry of manifest.icons.files) expect(sha(resolve(root, 'icons', entry.file))).toBe(entry.sha256);
  });
  it('uses the same character canvas for all poses to avoid foot position jitter', () => {
    for (const color of CHARACTER_COLORS) {
      const sizes = CHARACTER_POSES.map(pose => manifest.files.find(f => f.file === `character_${color}_${pose}.png`)?.size);
      expect(sizes.every(size => size?.[0] === 168 && size?.[1] === 204)).toBe(true);
    }
  });
  it('retains existing wardrobe IDs with a deterministic fallback', () => {
    expect(['lumina', 'sakura', 'midnight', 'cyber'].map(skinColor)).toEqual(['green', 'pink', 'purple', 'yellow']);
    expect(skinColor('old-or-unknown')).toBe('green');
  });
  it('does not ship the replaced mixed-style textures', () => {
    for (const name of ['art/tileset.png', 'art/forest.png', 'art/sky.png', 'gold.png', 'p-red.png', 'sparkle1.png', 'white.png']) {
      expect(existsSync(resolve(root, name))).toBe(false);
    }
  });
});
