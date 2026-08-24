/**
 * 输入流编解码：字节序列 → RLE(varint 对) → base64url。
 * 一局 60 秒的单指操作典型只有 40~120 字节 —— Ghost 与重放验证的全部原料。
 */

function b64urlEncode(bytes: number[]): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b & 0xff);
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): number[] {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin =
    typeof atob === 'function'
      ? atob(norm)
      : Buffer.from(norm, 'base64').toString('binary');
  const out: number[] = [];
  for (let i = 0; i < bin.length; i++) out.push(bin.charCodeAt(i) & 0xff);
  return out;
}

/** RLE 编码：(value, varint(count)) 重复对 */
export function encodeInputs(bytes: ArrayLike<number>): string {
  const out: number[] = [];
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const v = bytes[i] & 0xff;
    let c = 1;
    while (i + c < n && (bytes[i + c]! & 0xff) === v && c < 0xfffffff) c++;
    out.push(v);
    let cnt = c;
    while (cnt >= 0x80) {
      out.push((cnt & 0x7f) | 0x80);
      cnt >>>= 7;
    }
    out.push(cnt);
    i += c;
  }
  return b64urlEncode(out);
}

/** 解码回原始逐 tick 字节流。非法数据抛 Error。 */
export function decodeInputs(s: string): Uint8Array {
  const data = b64urlDecode(s);
  const arr: number[] = [];
  let i = 0;
  while (i < data.length) {
    const v = data[i++]!;
    if (i >= data.length) throw new Error('codec: truncated run');
    let count = 0;
    let shift = 0;
    let b: number;
    do {
      b = data[i++]!;
      count |= (b & 0x7f) << shift;
      shift += 7;
      if (shift > 35) throw new Error('codec: bad varint');
    } while (b & 0x80);
    if (count > 10_000_000) throw new Error('codec: run too long');
    for (let k = 0; k < count; k++) arr.push(v);
  }
  if (arr.length > 10_000_000) throw new Error('codec: stream too long');
  return Uint8Array.from(arr);
}
