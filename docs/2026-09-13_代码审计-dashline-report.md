# Dashline 代码审计报告（2026-09-13）

> 审计对象：`https://github.com/mmuu1987/dashline` @ `76ad182`（fix: harden rewarded revive state flow）
>
> 审计类型：白盒静态审计 + 可执行验证（单元测试 / 类型检查 / 生产构建 / 真实 Chromium E2E / 确定性与赛道可通行性探针）
>
> 审计范围：`packages/shared`、`packages/core`、`apps/client`、`scripts`、`.github`、构建与发布配置
>
> 基线对照：[AGENTS.md](../AGENTS.md)、[HANDOVER.md](../HANDOVER.md)、[上一轮审计报告](./2026-09-04_代码审计-dashline-report.md)（F-001～F-011 已全部修复，本轮复核确认未回归）

---

## 1. 执行摘要

工程整体质量高于同类个人项目：确定性核心边界守得很干净（`packages/core`/`shared` 全文无 DOM/BOM/网络/`Date.now`/`Math.random`），存档全部收口到 `storage.ts` 并做了运行时校验与版本化迁移，广告适配层有超时、状态码白名单和降级路径，CI 在部署前跑满测试 + 类型检查 + 浏览器验收。上一轮 11 项发现全部修复且未回归。

本轮发现 **6 项高危、约 28 项中危、约 20 项低危**。最需要立刻处理的是三类：

1. **纯单机产品边界在默认构建下已经破了**：`auto` 模式只凭「页面被放进 iframe」就向 `h.api.4399.com` 注入第三方脚本，而 GitHub Pages 的公开构建没有设置 `VITE_DASHLINE_PLATFORM`。任意第三方站点用 iframe 嵌入线上产物，即可让 4399 脚本以同源权限进入页面（可读写全部 `dl_*` 存档）。
2. **PixiJS 资源泄漏 + 无谓重建**：`setTrack()` 用 `destroy()` 不带 `{ children: true }`，每次重开都把上一局的嵌套 `Graphics`/`TilingSprite` 泄漏掉；而赛道每天恒定，本就不该每局重建整棵场景树。
3. **弹窗期间的状态机漏洞与键盘可访问性硬伤**：功能弹窗打开时点 ⏸ 或按 R/Enter 会让游戏在弹窗背后继续跑/重开一局；全局 `preventDefault` 吞掉空格导致纯键盘用户无法激活任何按钮，且四个弹窗均无 `role="dialog"`、焦点管理与 Escape 关闭。

### 本轮可执行验证结果

| 验证 | 命令 | 结果 |
|---|---|---|
| 单元 / 回归测试 | `pnpm test` | ✅ 10 个文件、72 个测试全部通过 |
| 全仓类型检查 | `pnpm -r exec tsc --noEmit` | ✅ 退出码 0 |
| 生产构建 | `pnpm build` | ✅ 752 模块，`index-*.js` 375.78 kB / gzip 119.46 kB |
| 真实浏览器 E2E | `pnpm test:browser` | ✅ 6 步全流程通过（含 iframe + h5api 桩的激励复活场景）；需先 `pnpm exec playwright install chromium` |
| 工作树整洁 | `git status --short` | ✅ 克隆后无未提交改动 |
| 确定性复核 | 自建探针 | ✅ 同 seed 的 `buildTrack` 逐字节一致；`Track.coins[].got` 等只读字段未被 `World` 写回 |

---

## 2. 发现汇总

| ID | 等级 | 结论 | 位置 |
|---|---|---|---|
| H-01 | 高 | `auto` 模式仅凭 `parent !== window` 就注入 4399 远程脚本，公开构建未关闭 | `platform.ts:105`、`platform-config.ts:27`、`deploy.yml:43` |
| H-02 | 高 | 第三方脚本注入无 `onerror`、无 SRI、无 CSP，失败节点不清理 | `platform-h5mini.ts:83-86` |
| H-03 | 高 | 天赋升级先落盘、扣费在调用方另一次写入，非原子 | `talents.ts:121-124`、`main.ts:183-185` |
| H-04 | 高 | `destroy()` 不销毁子节点 + 每局重建同一棵场景树 | `worldview.ts:51`、`main.ts:226` |
| H-05 | 高 | 弹窗打开时 ⏸ 按钮与 R/Enter 无 `isModalOpen()` 守卫 | `main.ts:113`、`main.ts:242`、`input.ts:51` |
| H-06 | 高 | 全局吞空格 + 弹窗无 dialog 语义/焦点管理，键盘不可用 | `input.ts:34`、`hud.ts:80/125/157/200` |
| M-01 | 中 | 插屏广告无回调却直接返回 `completed`（发奖判据被污染） | `platform-h5mini.ts:198-199` |
| M-02 | 中 | 广告超时后迟到的 `10001` 被丢弃；SDK 迟到后整局广告入口消失 | `platform-h5mini.ts:156-158/177` |
| M-03 | 中 | 适配层无并发锁，双 `playAd` 只靠 UI 变量兜底 | `platform-h5mini.ts:163-191`、`platform.ts:80-84` |
| M-04 | 中 | `track()` 无条件把游玩事件转发给宿主桥，等于离机遥测且无独立开关 | `platform.ts:91`、`main.ts:216/235/357/373-383` |
| M-05 | 中 | 非法 `VITE_DASHLINE_PLATFORM` 值 fail-open（想关反而开着） | `platform-config.ts:27` |
| M-06 | 中 | `lsSet` 静默吞掉配额/隐私模式失败，进度无声丢失 | `storage.ts:12-14` |
| M-07 | 中 | 无 `lsRemove`，旧 key 迁移永远不完成，存在数据分叉源 | `storage.ts:2-25` |
| M-08 | 中 | 损坏存档在 `load()` 末尾被无条件 `save()` 覆盖，无备份 | `wardrobe.ts:90/120`、`talents.ts:86`、`achievements.ts:79` |
| M-09 | 中 | `dl_history_v1` 无上限增长，每局全量重写 | `meta.ts:71` |
| M-10 | 中 | 每日最佳按日期散成无限多个 key，且与历史重复存储 | `best-record.ts:17` |
| M-11 | 中 | 读取即回写，产生无谓写放大 | `best-record.ts:37` 等 |
| M-12 | 中 | `saveDayRecord` 把两局字段拼成一条「已完赛但用时来自撞毁局」的假记录 | `meta.ts:64-70` |
| M-13 | 中 | `getRecentHistory` 用本地时区推 UTC 日期键，与 `calculateStreak` 口径不一致 | `meta.ts:119` |
| M-14 | 中 | 视觉动画按帧累加，144Hz 下速度是 60Hz 的 2.4 倍 | `actors.ts:216/241/342`、`render.ts:181`、`particles.ts:220` |
| M-15 | 中 | 固定步长无插值，非 60Hz 刷新率规律抖动 | `main.ts:617/634` |
| M-16 | 中 | 竖屏遮罩分支不清输入，横过来后按键批量回放 | `main.ts:612` |
| M-17 | 中 | `pointerup` 挂 window 且不校验起点，点 HUD 会产生幽灵冲刺并打断蓄力 | `input.ts:90` |
| M-18 | 中 | 多点触控下任意一指抬起即清空按住状态 | `input.ts:98` |
| M-19 | 中 | BGM 调度器无追赶钳制，切回前台音符堆叠爆音 | `audio.ts:332` |
| M-20 | 中 | `setRingsGot` 非空断言写下标，越界会终止整个 ticker | `worldview.ts:558` |
| M-21 | 中 | 每次吃金币强制同步重排（layout thrash） | `hud.ts:40` |
| M-22 | 中 | 结算面板每次 `innerHTML` 重建，广告流程中按钮被换掉导致点击丢失 | `hud.ts:80`、`main.ts:388/553/630` |
| M-23 | 中 | 完赛时间用 `toLocaleString()`，同一局出现三套时间数字 | `hud.ts:82` |
| M-24 | 中 | 结算遮罩「点背景=重开」与 window pointerdown 重开路径重叠 | `hud.ts:97`、`main.ts:256-262` |
| M-25 | 中 | 5 份贴图从未使用，`sky.png` 被下载两次且 `ImageBitmap` 不 `close()` | `textures.ts:294/311-320/353` |
| M-26 | 中 | 重开不清粒子，上一局碎片飘进新一局 | `render.ts:136`、`particles.ts` |
| M-27 | 中 | 加速带坑宽超出满蓄跳距，且无任何护栏测试 | `chunks.ts:299-315`、`tuning.test.ts` |
| M-28 | 中 | 发布脚本把可能含凭证的远端地址打进日志；gh-pages 临时仓库缺 git identity 与 `.nojekyll` | `deploy-pages.ts:61/85-88` |
| L-01 | 低 | `WorldSnapshot` 的 `readonly` 只是类型约束，调用方可真实篡改缓存快照 | `world.ts:198-234` |
| L-02 | 低 | `coinCount` 同时承担「拾取枚数」「货币收益」「成就计数」三种语义 | `world.ts:532`、`main.ts:564/570` |
| L-03 | 低 | `Track` 上残留 `got` 死字段，与「动态状态只在 World」约定互相误导 | `chunks.ts:61/88`、`tuning.ts:228/235` |
| L-04 | 低 | `world.ts` 导入 `UPDRAFT_G_FACTOR` 却未使用；`factor > 1` 的气流被静默忽略 | `world.ts:50/385` |
| L-05 | 低 | `landingTopAt` 的碎裂副作用会触发「未落脚」的板（当前生成器不可达） | `world.ts:711-713` |
| L-06 | 低 | `moverUnder` 不校验垂直距离与 `inverted`，存在瞬移隐患（当前生成器不可达） | `world.ts:671-679` |
| L-07 | 低 | 成就文案与实际解锁条件不符；复活后局内计数器不回滚，可重复计数 | `achievements.ts:41/53`、`main.ts:361-366/531` |
| L-08 | 低 | `attach()` 返回的清理函数被丢弃，全局监听与 WebGL 上下文终生不释放 | `main.ts:79-81/256/288-293` |
| L-09 | 低 | 残留已删除排行榜功能的 `.board-list` 选择器 | `main.ts:260` |
| L-10 | 低 | 大段死代码：蓄力音效、输入触发器、主题切换、角色隐藏全部零调用 | `audio.ts:214-247`、`input.ts:131-141`、`render.ts:51`、`actors.ts:421` |
| L-11 | 低 | `DATE_RE` 只验格式不验日历，`2026-13-45` 会被收进历史 | `meta.ts:30` |
| L-12 | 低 | `reportLoadProgress` 的 clamp 不过滤 `NaN` | `platform-h5mini.ts:212` |
| L-13 | 低 | 存档数字被当作游戏事实：`best.score` 被写死后真实成绩永远无法刷新 | `best-record.ts:22`、`main.ts:304` |
| L-14 | 低 | CI `cancel-in-progress: true` 会中断进行中的部署；actions 未钉 SHA | `deploy.yml:15/21-57` |
| L-15 | 低 | CI 用 Node 22 跑、按 `@types/node@20` 检查类型，且无 `engines`/`.nvmrc` | `deploy.yml:29`、`package.json:16` |
| L-16 | 低 | `attempts` 跨会话少计 1（刷新后当天首局复用上次序号） | `main.ts:203/229` |
| L-17 | 低 | 战报卡有一条从未被填充的圆角路径；`srcOf` 无校验强转 | `share-card.ts:38-41/134` |
| L-18 | 低 | 每帧无条件拼 HUD 字符串后才比较；每帧写 `classList.toggle` | `hud.ts:48`、`main.ts:611` |
| L-19 | 低 | 视口内每帧 `Graphics.clear()` + 重画，重建 GPU 几何 | `worldview.ts:522-548/668` |
| L-20 | 低 | 禁用缩放、低对比度提示文字、无 live region、无 `h1`/地标 | `index.html:5/49-50/205-208` |

---

## 3. 高危发现详述

### H-01：纯单机产品边界在默认构建下已经破了

- **位置**：`apps/client/src/platform.ts:105`、`apps/client/src/platform-config.ts:27`、`apps/client/src/platform-h5mini.ts:41-43`、`.github/workflows/deploy.yml:43`
- **证据**：

```ts
// platform.ts:104-105
if (PLATFORM_CONFIG.mode === '4399') return new H5MiniPlatform(true);
if (isEmbedded()) return new H5MiniPlatform(true);

// platform-h5mini.ts:41-43
export function isEmbedded(): boolean {
  try { return typeof window !== 'undefined' && window.parent !== window; }

// platform-config.ts:27
enabled: mode !== 'off' && mode !== 'local',
```

- **影响**：宿主识别只判断「是否处在 iframe 里」，不校验 `document.referrer` / `location.ancestorOrigins`。任意第三方站点把 GitHub Pages 上的产物放进 iframe，就会触发向 `https://h.api.4399.com/h5mini-2.0/h5api-interface.php` 的请求，并把返回脚本注入**同源**页面——该脚本随后拥有读写全部 `dl_*` 存档、改 DOM、发任意请求的权限。而 `deploy.yml:43` 的公开构建命令是 `pnpm --filter @dashline/client exec vite build --base=./`，没有设置 `VITE_DASHLINE_PLATFORM`，所以线上产物走的就是 `auto`。这与 AGENTS.md「当前纯单机基线不加入广告 SDK」「平台能力必须通过功能开关接入」直接冲突，README「本地直开不受影响」的表述也只覆盖了非 iframe 情形。
- **修复建议**：①默认改为 `local`，把 `auto`/`4399` 变成显式构建选项；②Pages 工作流显式传 `VITE_DASHLINE_PLATFORM=local`，4399 提审包单独出一次构建；③`isEmbedded()` 升级为宿主域白名单（`ancestorOrigins`/`referrer` 命中 4399 域名才接入）。

### H-02：第三方脚本注入没有任何失败与完整性保护

- **位置**：`apps/client/src/platform-h5mini.ts:79-90`
- **证据**：

```ts
const script = document.createElement('script');
script.src = url;
script.async = true;
document.head.appendChild(script);
```

- **影响**：没有 `script.onerror`，加载失败只能靠 `waitForApi` 轮询满 2.5 秒才间接降级（启动被白白阻塞）；没有 `crossOrigin`/`integrity`，没有页面级 CSP（全仓无 `Content-Security-Policy`/`integrity=`）；失败的 `<script>` 节点不移除，`document.querySelector` 去重反而会让后续重试被跳过。
- **修复建议**：加 `onerror` 立即标记降级并 `remove()` 节点；在 `index.html` 增加 `script-src` 白名单 CSP；把「脚本就绪」与「轮询超时」分成两条独立信号。

### H-03：天赋升级与扣费不是原子操作

- **位置**：`apps/client/src/talents.ts:113-125`、`apps/client/src/main.ts:182-192`
- **证据**：

```ts
// talents.ts
const newLevel = curLevel + 1;
this.levels[id] = newLevel;   // 先落盘等级
this.save();
return { ok: true, cost, newLevel };

// main.ts
const res = talents.upgrade(id, wardrobe.getTotalCoins());
if (res.ok) { wardrobe.deductCoins(res.cost); ... }   // 返回值被忽略
```

- **影响**：等级写入与扣费是两次独立的 localStorage 写。`deductCoins` 的布尔返回值被丢弃，`lsSet` 又静默吞异常（见 M-06），任一失败或将来漏调即「免费升级」；两次写之间浏览器崩溃同样留下不一致状态。
- **修复建议**：把扣费下沉进一次事务（`upgrade(id, wardrobe)` 内部先扣费成功再 `save()` 等级），或返回待提交句柄由调用方 commit。

### H-04：每局重开都泄漏并重建整棵场景树

- **位置**：`apps/client/src/render/worldview.ts:51`、`apps/client/src/main.ts:226`
- **证据**：

```ts
// worldview.ts
this.root.removeChildren().forEach((c) => c.destroy());
// main.ts::resetAttempt()
view.setTrack(world.track);
```

- **影响**：PixiJS v8 的 `Container.destroy(options = false)` 默认**不**销毁子节点。碎裂板、升降台、传送门、护盾、磁铁、加速带、钉球、二段跳环、气流柱、激光闸门都是 `Container` 包裹的子 `Graphics`/`TilingSprite`，其 `GraphicsContext` 与 GPU 几何只被 detach、从不释放——每次重开都累积一份。更根本的问题是：赛道由 seed 决定、当天恒定，`resetAttempt()` 本就不需要重建；现状是每次撞毁重开都重跑 `worldview.ts:49-450` 的数百个对象构造，既放大泄漏也造成重开掉帧。
- **修复建议**：`c.destroy({ children: true })`；`setTrack` 只在 `track` 引用变化时调用，重开走 `restoreDynamicState()` 复位可见性即可。

### H-05：弹窗打开期间的状态机漏洞

- **位置**：`apps/client/src/main.ts:113`、`apps/client/src/main.ts:242`、`apps/client/src/input.ts:51`
- **证据**：

```ts
pauseBtn.addEventListener('click', togglePause);                 // 无守卫
input.onPause(() => { if (!hud.isModalOpen()) togglePause(); }); // 键盘路径有守卫
input.onRestart(() => { if (phase !== 'dead') resetAttempt(); });// 无守卫
```

- **影响**：底部功能按钮 `z-index:30` 高于 `#result` 遮罩。衣橱/天赋/成就弹窗打开时 `phase === 'pause'`，此时点 ⏸ 会把 `phase` 改回 `'run'`、清掉暂停徽章，游戏在弹窗背后继续跑直到撞毁；在弹窗里按 Enter 激活「关闭」按钮的同时还会静默 `resetAttempt()`（attempts++ 并丢弃当前局）。同一份代码里键盘暂停路径有守卫、按钮与重开路径没有，属于明确的一致性缺陷。
- **修复建议**：所有破坏性回调统一走一个 `if (hud.isModalOpen()) return;` 前置守卫。

### H-06：键盘用户无法操作界面

- **位置**：`apps/client/src/input.ts:33-34/102`、`apps/client/src/hud.ts:80/125/157/200`、`apps/client/index.html:5/197-221`
- **证据**：

```ts
window.addEventListener('keydown', kd);
// kd: if (isJumpKey(e)) { e.preventDefault(); ... }   // Space/ArrowUp/KeyW
```

- **影响**：监听挂在 `window` 且无条件 `preventDefault`，焦点落在「关闭 / 再跑一次 / 装备」按钮时空格被吞——纯键盘用户没有安全的关闭弹窗方式（Enter 会额外重开一局，见 H-05）。四个弹窗全部由 `innerHTML` 重建，没有 `role="dialog"`、`aria-modal`、`aria-labelledby`、焦点移入/归还、Escape 关闭、背景 `inert`，Tab 会直接跑到弹窗背后的按钮上。叠加 `index.html:5` 的 `user-scalable=no`（违反 WCAG 1.4.4）与 `#hud-hint{opacity:.65}` / `#hud-mode{opacity:.5}` 的低对比度，可访问性整体不达标。
- **修复建议**：`kd` 开头判断 `document.activeElement` 是否为 button/可交互元素并提前 return；弹窗结构静态化并补齐 dialog 语义与焦点管理；移除 `user-scalable=no`；toast/combo/暂停徽章加 live region。

---

## 4. 值得单独说明的中危问题

### M-01 / M-02 / M-03：广告发奖链路的三个薄弱点

```ts
// platform-h5mini.ts:196-202  插屏：没有回调，却把"没抛错"当成"播放完成"
api.playInterstitialAd();
return 'completed';

// platform-h5mini.ts:177  30s 后判 failed，真实终态迟到 1ms 也不发奖、不解释
const timer = setTimeout(() => finish('failed'), PLATFORM_CONFIG.adTimeoutMs);

// platform-h5mini.ts:156-158  init 期未就绪 → 整局 refreshAds() 恒为 false
if (!this.api) { this.adsAvailable = false; return false; }
```

`AdResult` 是 `main.ts:361` 的发奖判据，`showInterstitialAd` 现在返回的 `'completed'` 是"调用没抛错"而不是"广告播完"——当前插屏未接入所以无害，但这是典型的「广告失败照样发奖」结构，一旦复用即成白嫖漏洞。建议无回调能力的接口返回 `'unavailable'`；超时后仍记录迟到终态用于提示；`refreshAds()` 在 `api` 缺失时重试一次 `waitForApi`；适配层内部维护 `pendingAd` Promise 做并发去重（目前唯一的去重在 `main.ts` 的 `rewardBusy`）。

### M-04：`track()` 是当前唯一的离机数据通路

`platform.ts:91` 的 `this.bridge.track?.(event, data)` 会把 `main.ts` 的 7 处事件（含 `{ attempt: attempts }`）无条件转发给宿主注入的桥，而宿主桥来自外部页面注入的 `window.__DASHLINE_PLATFORM__`。这与 AGENTS.md「不加入遥测」冲突，且没有独立开关。建议给 `track` 单独的 feature flag，纯单机构建直接编译掉。

### M-12 / M-13：历史记录语义问题

```ts
// meta.ts:64-70 —— 高分那局的 timeMs/distanceM/coins 会和另一局的 finished 组合
const best = !existing || incoming.score > existing.score ? incoming : existing;
h.days[rec.date] = { ...best, finished: Boolean(existing?.finished || incoming.finished), ... };

// meta.ts:119 —— 同文件其余位置一律 setUTCDate，只有这里用本地时区
d.setDate(d.getDate() - i);
```

前者能产出「已完赛，但用时来自撞毁局」的记录，污染 UI 与 `streak_7` 的可信度；后者在跨夏令时时区（如 `Europe/Lisbon`、`America/Santiago`）会让 UTC 日期串重复或跳过，而 `meta.ts:121-123` 又没有去重。

### M-27：加速带坑宽没有护栏测试（本轮实测）

`chunks.ts:299-315` 的加速带坑宽取 `boostRange * [0.62, 0.76]`，实测 120 天种子共出现 **36 处「坑内无任何中继物」且宽度超出满蓄跳距**的坑（最宽 449px）：

| 指标 | 数值 |
|---|---|
| 理论满蓄跳距 `holdJumpRange` | 388.4 px |
| **实测**纯长按跳最大可越坑宽 | 389 px |
| **实测**长按跳 + 空中冲刺最大可越坑宽 | 540 px |
| **实测**再加「破风突进」天赋 | 586 px |
| 生成器实际产出的最宽「无中继」坑 | 449 px |

结论：这些坑**踩到加速带**或**使用空中冲刺**都能过，不是必死局；但玩家若在加速带上方处于空中（未触发 boost）且不会用空中冲刺，就只能靠一个进阶机制自救。`tuning.test.ts` 的护栏只覆盖 `GAP_TIERS` 对 `holdJumpRange` 的比例，完全没有覆盖 `chBoost`/`chRing`/`chUpdraft`/`chGravityPortal` 这些「依赖特殊机制才能通过」的积木——一旦有人调 `BOOST_TICKS`、`dashTicks` 或 `TUNING.vx`，会静默产出真正不可通行的赛道而 CI 全绿。建议为每个依赖机制的积木补一条「在最坏随机取值下仍可通行」的护栏测试。

---

## 5. `packages/core` 确定性与正确性复核

确定性红线**守得很干净**，本轮逐项复核通过：

- `packages/core`、`packages/shared` 全文无 DOM/BOM/网络/`localStorage`/`Date.now()`/`performance.now()`/`Math.random()`（唯二命中是 `prng.ts:3`、`world.ts:4` 的注释）。
- 随机全部来自 `splitmix32`；`chunks.ts` 已按上一轮 F-007 的结论把金币弧线换成四则运算抛物线 `arch01()`，core 内无三角函数；`moverOffsetY`/`pendulumBob`/`isGateActive` 都是 tick 的纯函数（三角波 + 整数取模）。
- `Track` 确为只读：`World` 把金币、碎裂板、圆环、护盾、磁铁的拾取态收敛到内部 `Set`/数组，实测跑完一局后 `track.coins[].got` 仍全为 `false`。
- `CORE_VERSION` 纪律良好：最新一次改 `world.ts`（复活流程）的提交同步把版本升到 `core.12`。
- 同 seed 的 `buildTrack` 输出逐字节一致，`regressions.test.ts:62` 还锁了黄金摘要。
- 性能无热点：满载一局（255 tick 到死亡）耗时 2.9ms；每 tick 的金币/尖刺线性扫描在 69 枚金币、12 处尖刺规模下可忽略。

仍需改进的四点（均为低危）：

**L-01 快照的 `readonly` 只是类型约束**（`world.ts:198-234`）。`snapshot` 缓存整个对象返回，`coinsGot` 等虽标注 `readonly number[]`，运行时仍是可变数组。实测 `snap.coinsGot.push(12345)` 后再读 `world.snapshot.coinsGot` 依然含 `12345`——渲染层一次误操作就能污染缓存快照。建议 `Object.freeze` 或返回防御性拷贝。

**L-02 `coinCount` 一个字段三种语义**（`world.ts:517-536`）。`gemMultiplierChance` 暴击时 `this._coinsGot += 2`，实测「2 枚金币 + 100% 暴击」得到 `coinCount = 4` 而 `coinsGot.length = 2`。这个值同时被用作 HUD 显示的拾取枚数（`main.ts:636`）、结算发放的货币（`main.ts:564`）、`coin_master` 成就的判定（`main.ts:570`，≥15）和完赛分的加成（`world.ts:613`，×50000）。天赋本意只是「货币双倍」，却连带让显示、成就、分数一起膨胀。建议拆成 `coinsCollected`（枚数）与 `coinReward`（货币）两个字段。

**L-04 死导入与被吞掉的气流参数**（`world.ts:50/385`）。`world.ts` 导入了 `UPDRAFT_G_FACTOR` 却从未使用；`let g = TUNING.grav * (windF < 1 ? windF : 1) * this._gravDir;` 意味着 `factor > 1` 的「下压气流」会被静默忽略——当前生成器只产出 `0.40` 所以无害，但接口承诺与实现不符。另外整段气流判定写死 `GROUND_Y` 坐标系，重力反转时行为未定义。

**L-05 / L-06 两个潜伏隐患**（`world.ts:671-679/711-713）。`landingTopAt` 在选中 `bestTop` 的同时触发碎裂倒计时，若同一 tick 内先扫到较低的碎裂板、后扫到更高的板，较低那块会被"误触发"；`moverUnder` 只比对 x 区间，不校验垂直距离与 `inverted`，理论上站在地面而上方有升降台时会被瞬移到台面。两者在当前生成器下都不可达（碎裂板同 x 区间不重叠、升降台只出现在坑里），属于"改一版关卡就会踩中"的定时炸弹，建议顺手加约束。

---

## 6. 测试与验证缺口

现有 72 个测试的分布是「core 积木通行性」重、「客户端状态机与存档边界」轻。明确缺口：

**core**
- `chBoost` / `chRing` / `chUpdraft` / `chGravityPortal` 等「依赖机制才能通过」的积木没有可通行性护栏（见 M-27）。
- `reviveFrom` 只测了「检查点不匹配抛错」，没测复活后 `coinsGot`/`crumblesBroken`/`gravDir` 是否精确回滚、复活无敌期是否真的挡伤害。
- 重力反转态（`gravDir === -1`）下的落地、支撑、坠亡、气流判定无专门用例。
- 没有跨 JS 引擎的黄金 fixture 校验（上一轮遗留项，仍未闭环）。

**客户端**
- `Wardrobe`（`addCoins`/`deductCoins`/`equipOrBuy`）与 `Talents.upgrade`/`getPerksConfig` **零测试**——买不起、重复购买、未解锁 id、满级、扣费失败、倍率映射全无护栏，而 H-03 正出在这条链路上。
- `Achievements.unlock` 的幂等性、未知 id 未测。
- `getRecentHistory` 未被任何测试引用（M-13 的时区问题因此无人发现）。
- streak 只测了「连续 7 天全完赛」，未覆盖「今天未完赛 + 昨天完赛」分支、中间断档、跨月跨年。
- 存档测试用的 `MemoryStorage` 永不抛错，`storage.ts` 的 quota/隐私模式失败分支零覆盖；也没测 JSON 截断串、`1e999`→Infinity、上万条 `days` 的性能。
- `PLATFORM_CONFIG` 在模块加载期读一次，`mode=local/off` 与非法值 fail-open 无法被测；`isEmbedded()` 自动接入路径缺「被第三方站点嵌入时不得加载 4399 脚本」的**负向断言**（这正是 H-01）。
- `BridgePlatform` 的 30s 超时路径未用 fake timers 测，缺「超时判 failed 后桥迟到 resolve('completed') 不得发奖」的反作弊断言。
- 多标签页并发写（`wardrobe.ts:123`、`meta.ts:71` 都是整体覆盖写）无用例。
- `scripts/deploy-pages.ts` 的 `parseOptions`/`validateTarget` 是纯函数却无单测。

**工程**
- `pnpm test:browser` 依赖 Playwright 浏览器，仓库未在 README/HANDOVER 中说明需要先 `pnpm exec playwright install chromium`（本轮首次运行即因此失败）。
- `pnpm audit --prod` 仍是上一轮的遗留未验证项。当前 `pnpm outdated` 显示 `vite 5.4.21 → 8.3.0`、`vitest 2.1.9 → 5.0.0`、`@types/node 20 → 26`，依赖已明显滞后。

---

## 7. 保留的良好实践

- 确定性核心边界干净，`Track` 只读约定被严格遵守，`CORE_VERSION` 与物理改动同步升级。
- 存档访问全部收口 `storage.ts`，`toNonNegativeInteger`/`toBoundedInteger` 把 `NaN`/`Infinity`/负数/非法 id 全部挡在业务逻辑之外，key 版本化 + 旧 key 回退齐备。
- 广告适配层的失败路径设计完整：init 2.5 秒总预算、`playAd` 只认 `10001`、`settled` 去重、`result ?? 'failed'` 拒绝把未知返回值当成功。
- 旧广告回调不污染新一局（`main.ts:360` 的 `attemptId`/`world` 双重校验），且有 E2E 覆盖。
- 主循环有最大追赶钳制（`Math.min(..., 0.25)`）与死亡当帧停步，不会死亡螺旋。
- 渲染层真的不回写 core：`restoreDynamicState`、`surfaceYBelow` 全是只读操作。
- 粒子 swap-remove、快照缓存、视口裁剪等性能优化实现正确。
- 启动失败有可见兜底（`data-dashline-ready="failed"` + 错误面板 + 重载按钮），`textures.ts` 用 `new Error(..., { cause })` 不吞异常。
- 发布脚本的强制推送有 `--allow-force` 闸门与目标校验，CI 权限最小化、不写 `main`、无密钥明文、`base: './'` 三处一致。

---

## 8. 建议的处理顺序

1. **H-01 + H-02**（产品边界与第三方脚本）：默认 `local` + Pages 构建显式关闭 + 宿主域白名单 + `onerror`/CSP。**这条不修，线上产物就不是纯单机。**
2. **H-04**（Pixi 泄漏与重建）：`{ children: true }` + `setTrack` 只在 track 变化时调用。内存与性能收益最大，改动最小。
3. **H-05 + H-06**（弹窗守卫与键盘可访问性）：统一 `isModalOpen()` 守卫 + 空格 `preventDefault` 排除按钮焦点 + 弹窗 dialog 语义。
4. **H-03 + M-06 + M-07**（存档事务性）：`lsSet` 返回布尔、新增 `lsRemove`、扣费与升级合并为一次事务。
5. **M-27 + 测试缺口**：补积木可通行性护栏、Wardrobe/Talents 单测、平台负向断言。
6. 其余中低危按模块批量清理（帧率相关动画、输入指针 id、历史裁剪、死代码）。

---

## 9. 审计限制说明

- 本次为**只读审计**，未修改任何业务源码，未提交、未推送、未部署。
- `pnpm audit --prod` 未执行（沿用上一轮的未验证状态）；依赖漏洞状态应继续视为「未验证」。
- 跨 JS 引擎逐位一致性仍只由单引擎黄金摘要近似保护，本轮未引入第二种引擎验证。
- 4399 官方 SDK 的真实行为（`canPlayAd` 库存语义、`playAd` 回调时序）无法在无平台环境下验证，相关结论基于代码与官方文档描述。

---

## 10. 修复回填（2026-09-13 追加）

审计后按「优先游戏逻辑、玩法、视觉效果，4399 平台边界问题暂缓」的范围做了第一轮修复，已随同一次提交发布。

**已修**

| 编号 | 内容 |
|---|---|
| H-04（部分） | `WorldView.setTrack` 的 `destroy()` 补 `{ children: true }`，不再泄漏子节点；复活分支不再重建整棵赛道精灵树 |
| 素材缩放 | 同一画面混用 5 种像素密度（地面 2.5× / 平台 1.375× / 箱子 1.25× / 宝石 1.359× / 道具 ≈1.0×），且全项目无一处 `scaleMode: 'nearest'`，像素画被线性插值糊化。现统一 `ART_SCALE = 2.5` + 全量最近邻采样 |
| 空贴图 | `art/shrooms.png` 为 100% 全透明（0/240 不透明像素），占 1/3 的地面装饰实为隐形；连同矢量细草丛一起换成 `tileset.png` 第 7 行的透明底草簇 / 高草 / 小灌木 |
| 背景模糊 | `art/forest.png` 被整张缩到 0.598 倍，既模糊又在地平线糊出一堵暗墙；现只截树冠条带做 2× 整数放大 |
| 地面重复 | 草皮与泥土改为 tileset 三变体拼接的 48×16 条带，消除 16px 图案硬重复 |
| 坠坑判死 | `die()` 的复活无敌会吞掉坠坑判定，掉进坑后要继续坠落 2 秒才判死；现坠坑不受任何无敌与护盾抵扣，并补了护栏测试（改回旧写法即在 `tick = 120` 失败） |
| 视觉/判定错位 | 普通平台与升降台的板身画在判定面中间（`y - 11`），玩家踩上去会陷入 11px；现与碎裂板一致，顶边贴判定面 |
| 死资源 | 移出 5 张从不渲染的加载项、`sky.png` 的重复加载与未 `close()` 的 `ImageBitmap` |

**新增**

- 复活机制：每天 3 次免费复活（`dl_revives_v1`，UTC 日切）+ 每局最多 1 次激励广告复活，修掉「`platform.isAvailable()` 为假时完全没有复活入口」的根因。
- 测试从 72 增至 76：坠坑立即判死护栏、`ReviveBank` 单测，以及浏览器 E2E 新增的「纯单机模式免费复活」场景。
- `CORE_VERSION` 因死亡规则变更升至 `core.13`；它同时参与主题选择，因此当天赛道与配色主题一并更换（机制如此，非缺陷）。`dl_best_v1_<date>` 只按日期存 key，升版当天会与新赛道并存。

**仍暂缓**

- H-01 / H-02（产品边界与第三方脚本自动接入）、M-01～M-05（广告发奖链路与 `track()` 数据通路）等 4399 平台侧问题：用户明确表示 4399 平台设计与代码「都可以放过」，本轮未处理。
- H-03 / M-06 / M-07（存档事务性）、H-05 / H-06（弹窗守卫与键盘可访问性）、M-12 / M-13（历史记录语义）、M-27（积木可通行性护栏）及其余中低危项仍未处理。
- 平台与碎裂板的像素密度仍是 1.375×/1.25×：受关卡设计约束（平台离地最低 24px、层间 42px），按 16px 整格放大到 40px 会堵死通道；该取舍已写入 [技术架构](./tech-architecture.md) 的渲染素材约定。
