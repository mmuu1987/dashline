import { GROUND_Y, createWorld } from '@dashline/core';
import { makeInput, seedForDate, todayUTC } from '@dashline/shared';

const w = createWorld(seedForDate(todayUTC()));
let holding = false;
let holdLeft = 0;

while (w.snapshot.alive && !w.snapshot.finished && w.tick < 7200) {
  const s = w.snapshot;
  const x = s.x;
  let inp = 0;
  if (s.grounded) {
    let spikeAhead = false;
    for (const hz of w.track.hazards) {
      if (hz.x + hz.w < x - 10) continue;
      if (hz.x > x + 130) break;
      if (hz.x + hz.w > x) spikeAhead = true;
    }
    let gapAhead = false;
    for (const seg of w.track.grounds) {
      if (x >= seg.x0 && x <= seg.x1 && seg.x1 - x < 45) gapAhead = true;
    }
    if (spikeAhead || gapAhead) {
      inp = makeInput(true, true);
      holding = true;
      holdLeft = gapAhead ? 18 : 9;
    } else holding = false;
  } else if (holding && holdLeft > 0) {
    inp = makeInput(false, true);
    holdLeft--;
  } else holding = false;

  w.step(inp);
  if (!w.snapshot.alive) {
    const X = w.snapshot.x;
    console.log(`死亡 @tick=${w.snapshot.tick} x=${Math.round(X)} y=${Math.round(w.snapshot.y)} distM=${w.snapshot.distanceM}`);
    console.log('附近地形:');
    for (const hz of w.track.hazards) {
      if (hz.x > X - 120 && hz.x < X + 300) {
        const elev = hz.y + hz.h < GROUND_Y - 60 ? ' [悬空]' : '';
        console.log(`  刺盒 rel=${Math.round(hz.x - X)} w=${hz.w} y=${Math.round(hz.y)}${elev}`);
      }
    }
    for (const seg of w.track.grounds) {
      if (seg.x1 >= X - 20 && seg.x1 < X + 420) console.log(`  断崖边 rel=${Math.round(seg.x1 - X)}`);
    }
    for (const p of w.track.plats) {
      if (p.x > X - 100 && p.x < X + 400) console.log(`  板 rel=${Math.round(p.x - X)} w=${p.w} crumble=${!!p.crumble}`);
    }
    for (const pad of w.track.pads) {
      if (pad.x > X - 200 && pad.x < X + 500) console.log(`  弹跳菇 rel=${Math.round(pad.x - X)} w=${pad.w}`);
    }
    break;
  }
}
if (w.snapshot.finished) console.log(`完赛 ${w.snapshot.timeMs}ms`);
if (w.tick >= 7200) console.log('超时未死也未完赛?!');
