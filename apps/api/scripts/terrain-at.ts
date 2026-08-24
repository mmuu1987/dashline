/** 打印指定 x 附近的地形与用 solve 输入流重放的死亡状态 */
import { createWorld } from '@dashline/core';
import { seedForDate, todayUTC } from '@dashline/shared';

const seed = seedForDate(todayUTC());
const w = createWorld(seed);
const X = Number(process.env.AROUND_X ?? 5294);

const t = w.track;
console.log(`赛道总长 ${t.length}，finishX=${t.finishX}`);
console.log(`x=${X} 附近地形:`);
for (const seg of t.grounds) {
  if (seg.x1 > X - 600 && seg.x0 < X + 600) console.log(`  地面 [${seg.x0}, ${seg.x1}]`);
}
for (const hz of t.hazards) {
  if (hz.x > X - 300 && hz.x < X + 300) {
    const elev = hz.y + hz.h < GROUND_Y - 60 ? ' [悬空]' : '';
    console.log(`  刺盒 x=${Math.round(hz.x)} w=${hz.w} y=${Math.round(hz.y)}${elev}`);
  }
}
for (const p of t.plats) {
  if (p.x > X - 500 && p.x < X + 500)
    console.log(`  板 x=${p.x} w=${p.w} y=${p.y} crumble=${!!p.crumble}`);
}
for (const pad of t.pads) {
  if (pad.x > X - 800 && pad.x < X + 800) console.log(`  菇 x=${pad.x} w=${pad.w}`);
}

import { GROUND_Y } from '@dashline/core';
void GROUND_Y;
