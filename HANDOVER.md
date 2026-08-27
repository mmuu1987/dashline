# Dashline 项目交接书（HANDOVER）

> 交接日期：2026-06（core.6 版本，commit `2fd2a74`）
> 本文档写给接手本仓库的开发者。读完约 15 分钟，配合 `docs/` 下三份设计文档一起食用。

---

## 0. 一句话项目简介

**Dashline** 是一款「超休闲手感 + 异步多人」的每日冲刺跑酷游戏：

- **每日一图**：按日期确定性生成同一条赛道，全球玩家跑同一张图；
- **异步对抗**：榜单 + Ghost 残影挑战 + 好友复仇链接（纯 URL 传递输入流）；
- **单指操作**：点按小跳 / 长按蓄力大跳，唯一输入；
- **零后端也能玩**：API 不在线时自动降级为"挑战今日最佳之你"（本地 localStorage）。

线上地址：https://mmuu1987.github.io/dashline/ （GitHub Pages，gh-pages 分支）
仓库：https://github.com/mmuu1987/dashline （账号 mmuu1987，本机 `gh` CLI 已登录）

---

## 1. 技术栈与仓库结构

| 层 | 技术 | 位置 |
|---|---|---|
| 逻辑核（确定性模拟） | TypeScript 纯函数（无 DOM/时钟/随机） | `packages/core/` |
| 共享常量/PRNG/每日种子 | TypeScript | `packages/shared/` |
| 反作弊重放验证 | TypeScript（复用 core） | `apps/validator/` |
| API | Fastify 4 + postgres.js（内存态兜底） | `apps/api/` |
| 客户端 | Vite 5 + PixiJS v8（无 UI 框架，DOM 只做 HUD） | `apps/client/` |
| 本地数据库 | docker-compose → postgres:16（宿主端口 **55432**） | `docker-compose.yml` |

```text
packages/shared  ← 常量/PRNG/种子/输入编解码（唯一时间真相 TICK_RATE=60）
packages/core    ← 赛道生成 + 物理模拟 + 快照（确定性铁律）
packages/validator ← 服务端重放校验（与客户端同源同版本 core）
apps/api         ← Fastify：鉴权/提交/榜单/Ghost/每日种子
apps/client      ← PixiJS 渲染 + 输入录制 + 本地最佳 + 战报卡
scripts/deploy-pages.ps1 ← 一键发布 Pages
```

### 依赖方向（禁止反向）
`client → core/shared`、`api → core/shared/validator`、`validator → core/shared`。
core 包内**禁止**：DOM/BOM、`Math.random`、`Date.now`、网络、三角函数（`Math.sin` 引擎间可能不一致！用纯四则+abs 的三角波替代）。

---

## 2. 核心架构（必读，三条红线）

### 2.1 确定性模拟核（整个项目的地基）
- 固定步长 60Hz（`TICK_RATE`），时间只来自 tick 计数；
- 随机只用 `shared/prng.ts` 的 splitmix32（种子化）；
- **同一 `(seed, 输入流)` 在浏览器与 Node 中必须逐位一致** —— 这是服务端重放反作弊的前提；
- 玩家输入每 tick 编码为 1 字节位掩码（PRESS/HELD/DOWN），整局输入流经 RLE+varint+base64url 压缩后仅 100~400 字符，可塞进 URL 分享。

### 2.2 版本红线（改物理必看）
- **任何 core 物理改动必须 bump `CORE_VERSION`**（`packages/shared/src/constants.ts`，当前 `core.6`）；
- `seedForDate = fnv1a('dashline:' + CORE_VERSION + ':' + date)`：换版本即换图；
- 榜单/Ghost/排名全部按 `client_version` 分桶过滤 —— 老版本成绩不会污染新版本；
- 调参中心：`packages/core/src/tuning.ts`。坑宽/梁高/环位等全部按派生跳跃能力的**比例**取值，改 TUNING 即整体重排难度，护栏测试（`test/tuning.test.ts`）锁定安全边际。

### 2.3 轨道对象只读铁律（血的教训，core.6 刚修过）
- `track`（grounds/hazards/coins/plats/rings…）是**共享只读**数据；
- 动态收集态（金币/环的"已拾取"、碎裂板血量）必须放 **world 内部账本**（`_coinsGotIdx`/`_ringsGotIdx`/`platHp`），**严禁**写回 track 上的 `got` 字段；
- 教训：此前环的 `got` 写在共享 track 上，求解器 `clone()` 预演穿过环区会把真实轨迹的环"提前吃掉"，导致二段跳永不触发 —— 排查了两小时。

---

## 3. 当前手感参数（core.6）

| 参数 | 值 | 说明 |
|---|---|---|
| vx / jumpV / grav | 360 / 760 / 2150 | 恒定前进速度 / 起跳初速 / 重力 |
| holdGravFactor / HOLD_MAX_TICKS | 0.34 / 20t(333ms) | 满蓄高度 ≈ **2.05×** 点按（蓄力反差刻意拉大） |
| COYOTE_TICKS / BUFFER_TICKS | 7 / 8 | 土狼时间 / 预输入缓冲 |
| 满蓄射程 holdJumpRange | ≈388px | 所有坑宽的基准 |
| CRUMBLE_TICKS | 26（≈0.43s） | 碎裂板倒计时 |

**积木库（在池）**：平地 / 三档坑 / 尖刺簇×3档 / 浮空台阶 / 奖励拱弧 / 弹跳菇大峡谷(35%) / 低空刺梁(22%) / 碎裂桥(35%) / 升降电梯(35%) / 加速带+超远坑(55%) / 二段跳环带(55%，4 枚阶梯低空环) / 横扫钉球(55%) / 碎裂天梯(45%)。

**⏸ 暂缓入池**：上升气流柱（`chUpdraft`，代码与测试保留在 `chunks.ts`/`blocks3.test.ts`）。原因：柱内减重让落点窗口收窄到 ±40px 量级，Bot 与新手都易坠。重新开放前需要：①调小柱高/系数让落点容错回到 ±100px；②Bot 风区起跳逻辑验证。开放时把 `pickChunk` 里 `'updraft'` 一行从注释恢复即可（权重 2，p≥0.35）。

---

## 4. 本地开发速查

```powershell
# 依赖安装（Node ≥20，pnpm 9）
pnpm install

# 客户端开发（热更，局域网可访问）
pnpm dev                      # = vite，默认 http://localhost:5173

# API（内存态，无需数据库；推荐先这样）
pnpm dev:api                  # http://127.0.0.1:8787

# 单元测试（core 五个测试文件，40 条护栏）
pnpm test

# 全量类型检查
pnpm -r exec tsc --noEmit

# Postgres 形态（可选）：
docker compose up -d          # dashline-db @ localhost:55432
$env:DATABASE_URL='postgres://dashline:dashline@127.0.0.1:55432/dashline'
pnpm --filter @dashline/api start   # 此时 store.kind=postgres
```

### 端口冲突警告（踩过的坑）
8787 端口**历史遗留过 Python/其它服务**（精确绑定 127.0.0.1 会抢占 Fastify 的 0.0.0.0 监听，导致所有请求返回 `{"detail":"Not Found"}`）。
排查：`netstat -ano | findstr :8787`，看到两个 LISTENING 就杀旧 PID。
本机 5432 同样有历史残留，所以 docker-compose 用 55432。

---

## 5. 求解器 Bot（重要工具，不是玩具）

`apps/api/scripts/solve-bot.ts` —— 用 `World.clone()` + 预演搜索的 AI 跑者。

**它的三重身份**：
1. **发布门槛**：每次 core 改动后必须 `pnpm --filter @dashline/api exec tsx scripts/solve-bot.ts`，`ok:true` 才算可发布（保证赛道对"最优输入"可通关）；
2. **e2e 数据源**：`e2e-ghosts.ts` / `e2e-attempts.ts` 用它生成真完赛输入流测试 API；
3. 未来上线在线模式后，可作"官方种子选手"。

**决策结构**（grounded 时四选一）：`wait / tap(hold2) / full(满蓄) / late(延迟12tick满蓄)`，各跑 200 tick 预演，评分规则：**完赛(1e6-耗时) >> 存活tick数 >> 距离**。另有：
- **坑沿强制起飞窗口**：距下一坑沿 < `388-坑宽-100` px 时剥夺投票权直接满蓄跳（防候选在悬崖边瞎选）；
- **滞空反射**：恐慌二段跳（环带记账，脚本层几何判定）+ 土狼窗口内的段尽头抢救跳；
- **反应式规则**：坑沿/宽刺毯/浮台边缘起跳、尖刺短跳等。

> 改动注意：`rollout` 与主循环共用 `reactivePolicy`/`airborneReflect`/`trackRings`，改规则务必两处同步。

---

## 6. 测试体系（发布前全跑）

| 项 | 命令 | 内容 |
|---|---|---|
| 单测 40 条 | `pnpm test` | tuning 护栏7 / core 9 / blocks 7 / blocks2 9 / blocks3 8 |
| 类型检查 | `pnpm -r exec tsc --noEmit` | 全部包 |
| Bot 完赛 | 见 §5 | `ok:true` 且成绩合理 |
| e2e-ghosts | `pnpm --filter @dashline/api exec tsx scripts/e2e-ghosts.ts` | 前提：API 在 :8787 运行 |
| e2e-attempts | `pnpm --filter @dashline/api exec tsx scripts/e2e-attempts.ts` | 5 次/日限制 |
| 客户端构建 | `pnpm --filter @dashline/client exec vite build --base=./` | 产物 gzip ≈107KB |

**建议顺序**：单测 → tsc → Bot → 起 API → 双 e2e → build → 部署。

---

## 7. 发布流程（GitHub Pages）

> 手动流程（**不用** GitHub Actions：token 缺 workflow scope，历史被拒过，见 `.github/` 已 gitignore 的 deploy.yml）。

```powershell
# 方式一：脚本一键（推荐）
.\scripts\deploy-pages.ps1

# 方式二：手动等价步骤
pnpm --filter @dashline/client exec vite build --base=./
# 把 apps/client/dist 复制进临时目录 → git init -b gh-pages → commit → push --force
# 详见 deploy-pages.ps1 内容（PowerShell 嵌套 pwsh 不可用，别拆脚本内部）
```

- 验证上线：CDN 有 ~1 分钟缓存。轮询 `https://mmuu1987.github.io/dashline/?v=$i` 的 HTML，找 `assets/index-*.js` 的新 hash。
- **每次发版同时**：`git push origin main` 源码（两分支各自独立）。

---

## 8. 上线在线模式（未完成，接手的下一件事）

用户已确认此方向**无限期搁置**，但如果你想推进，这是完整清单：

1. **client net.ts 注入 API 地址**：目前所有请求是相对路径 `/v1/...`（同源假设）。改为 `import.meta.env.VITE_API_BASE` 前缀（~5 行），否则线上 Pages 无法直连独立 API。
2. **免费容器跑 API**：Render / HuggingFace Spaces（Docker）二选一。`apps/api` 已有 Dockerfile 雏形？——没有，需自建（`docker-compose.yml` 仅本地 PG）。镜像：Node20 + `pnpm --filter @dashline/api start`。
3. **Neon 免费 Postgres**：设 `DATABASE_URL` 环境变量即可启用 `PgStore`（`apps/api/src/store.ts`，幂等建表，无需迁移脚本）。
4. Pages 重新部署 → 公网 e2e 回归（`E2E_BASE=https://你的域名`）。
5. 需要用户注册的账号：Neon、Render/HF。**卡点是注册，不是代码。**

### 本地 SQL 形态的已知边界
- `PgStore.consumeAttempt` 用两段式 INSERT+SELECT COUNT（曾因 RETURNING 子查询快照差一而失败，勿改回单条 RETURNING 计数）；
- 所有榜单查询按 `client_version = CORE_VERSION` 过滤（`store.ts` 内已强制）。

---

## 9. 已知技术债 / 待办

1. **上升气流柱未入池**（§3）：开放条件见上。
2. **主题轮换未做**：`shared/themeForSeed` 已预留接口（`/v1/daily/today` 返回 `themeId`），客户端尚未消费 —— 每日换配色皮肤是低投入高感知的留存项。
3. **打卡/进步曲线未做**：localStorage 存近 7 天成绩 + 结算面板折线，纯前端。
4. **BGM 是合成的**：`client/src/audio.ts` 内置芯片风循环（零素材），想换真人素材可直接替换 `Music` 类。
5. **房间制好友房**：依赖在线模式后端，排在 §8 之后。
6. **gh auth refresh -s workflow**：如果想让 Actions 自动部署，先 `gh auth refresh -s workflow` 恢复权限，再恢复 `.github/deploy.yml`。
7. **移动端全屏按钮**只在触屏显示；iOS 首次交互前音频不响（浏览器策略，`unlock()` 已处理）。

---

## 10. 关键文件地图（改需求先看这里）

| 需求 | 文件 |
|---|---|
| 改手感（跳高/重力/蓄力） | `packages/core/src/tuning.ts` + `shared/constants.ts`(HOLD/COYOTE/BUFFER) |
| 新增积木/关卡 | `packages/core/src/chunks.ts`（Builder+chunk 函数+pickChunk 权重+switch） |
| 物理规则（碰撞/重力/事件） | `packages/core/src/world.ts` |
| 赛道/玩家渲染 | `apps/client/src/render/worldview.ts` / `actors.ts` / `render.ts` |
| 音效/BGM | `apps/client/src/audio.ts` |
| HUD/结算/战报卡 | `apps/client/src/hud.ts` / `share-card.ts` |
| 每日种子/版本/输入编码 | `packages/shared/`（constants / daily / codec） |
| 反作弊校验 | `apps/validator/src/index.ts` |
| API 路由/存储 | `apps/api/src/server.ts` / `store.ts` |
| Bot 求解器 | `apps/api/scripts/solve-bot.ts` |

---

## 11. 交接时正在跑的东西（可能已停）

- 后台 API：`pnpm --filter @dashline/api start`（内存态 :8787）—— 重启后 token 会话失效，客户端会凭 deviceId 重新注册，无感；
- 本地 vite dev：`pnpm dev`；
- docker dashline-db 容器（如未启动：`docker compose up -d`）。

---

## 12. 给接班人的三条建议

1. **改任何 core 物理前**：先读 `tuning.ts` 头部注释 + `test/tuning.test.ts` 的护栏意图；改完跑全量单测 + Bot，别只跑自己的用例。
2. **遇到"明明改了却没生效"**：先怀疑端口残留/缓存（§4），再怀疑共享对象被污染（§2.3），最后才是逻辑本身。
3. **发布是低频动作但全手动**：按 §7 顺序做，`deploy-pages.ps1` 一次性到位；发布后一定轮询 hash 确认 CDN 已换新。
