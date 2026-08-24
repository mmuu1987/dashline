/**
 * 确定性随机数工具 —— core 内唯一合法的随机来源。
 * 禁止在 core 中使用 Math.random()。
 */

/** FNV-1a 32bit 字符串哈希（用于日期→种子） */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 混合两个整数，输出稳定 uint32（用于派生子流种子） */
export function mix2(a: number, b: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h, 0x85ebca6b) ^ b;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** splitmix32 —— 返回 [0,1) 均匀分布的确定性 PRNG */
export function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

/** [min,max] 整数 */
export function rngInt(r: Rng, min: number, max: number): number {
  return min + Math.floor(r() * (max - min + 1));
}

/** [min,max) 浮点 */
export function rngRange(r: Rng, min: number, max: number): number {
  return min + r() * (max - min);
}

/** 按权重挑选索引 */
export function rngPickWeighted(r: Rng, weights: number[]): number {
  let sum = 0;
  for (const w of weights) sum += w;
  let x = r() * sum;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x < 0) return i;
  }
  return weights.length - 1;
}
