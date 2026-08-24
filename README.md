# Dashline《每日冲刺》— 架构总览

**🎮 在线试玩：<https://mmuu1987.github.io/dashline/>**（本地模式：每日种子/最佳记录/好友复仇链接全离线可用；榜单与 Ghost 需自建 API）

一句话定位：**单指操作的种子赛道竞速小游戏 —— 每天全世界同一张图，跑赢朋友的 Ghost，晒出你的排名卡片。**

## 三大支柱

| 支柱 | 设计体现 | 技术体现 |
|---|---|---|
| 超休闲手感 | 单指操作、45–75 秒一局、死亡 <1 秒重开 | 确定性逻辑核 + 60fps 固定步长渲染 |
| 轻量异步多人 | Ghost 对战 / 房间赛 / 排行榜 | 输入流录制（每次几十字节），无需实时服务器 |
| 每日挑战 | 全球同种子赛道、每日重置、连胜 | 每日种子签发 + 服务端重放验证 |

## 文档导航

- [docs/game-design.md](./docs/game-design.md) — 游戏架构：玩法、模式、元游戏、数值、传播与商业化
- [docs/tech-architecture.md](./docs/tech-architecture.md) — 技术架构：选型、Monorepo、确定性模拟、网络与后端、部署
- [docs/api-and-data.md](./docs/api-and-data.md) — API 契约、数据模型、反作弊、排行榜实现

## 架构一张图

```mermaid
flowchart LR
    subgraph Client["客户端 (浏览器, Vite + TS + PixiJS)"]
        CORE["@dashline/core<br/>确定性模拟核"]
        R["渲染/音频/UI 层"]
        CORE --> R
    end
    subgraph Server["服务端 (Node 20 + Fastify)"]
        API["REST API"]
        VAL["Validator Worker<br/>服务端重放验证"]
        DB[(PostgreSQL)]
        Q[[任务队列 pg-boss]]
        API --> Q --> VAL
        API --> DB
        VAL --> DB
    end
    CDN["静态资源 CDN"] --> Client
    Client -->|"提交成绩+输入流"| API
    Client -->|"拉取每日种子/Ghost/榜单"| API
```

## 关键决策速览

1. **为什么是"输入流"而不是"录像回放"？** 一局 60 秒的单指操作，编码后只有 40–120 字节。Ghost 对战、好友挑战、反作弊重放全部复用这一份数据。
2. **为什么逻辑核必须确定性？** 同一 `(每日种子, 输入流)` 在任何机器上跑出同一结果 → 服务端可以用同一个代码包重放验分，Ghost 精确同步，未来升级实时对战也只需帧同步。
3. **为什么不需要 WebSocket？** 所有"多人"都是异步的：比的是同一张图上的历史成绩。v1 零长连接，运维成本极低。

## 快速开始（M1：异步对战闭环 + Postgres 持久化）

```bash
pnpm install
pnpm test            # core 确定性 + 手感护栏测试（vitest）
pnpm dev             # 客户端 http://localhost:5173 —— 直接玩今日赛道
pnpm dev:api         # 可选：REST 服务 :8787（默认内存态，重启清零）
```

### 持久化模式（Postgres）

```bash
docker compose up -d db                    # 启动 PostgreSQL 16（宿主端口 55432）
# Windows PowerShell
$env:DATABASE_URL='postgres://dashline:dashline@127.0.0.1:55432/dashline'
pnpm --filter @dashline/api start          # 建表自动完成（IF NOT EXISTS）
# bash/zsh
DATABASE_URL=postgres://dashline:dashline@127.0.0.1:55432/dashline pnpm --filter @dashline/api start
```

不设 `DATABASE_URL` 即回落内存态；数据模型见 `apps/api/src/store.ts`（players / days / runs / attempts）。

玩法：点按/空格跳跃，长按跳更高，R 重开；撞毁自动重开。完赛后可打开**今日榜单**、
点 ⚔ 挑战前三名 Ghost；「复制战绩」会把你的输入流编码成复仇链接 `…/#g=…&n=…&t=…`，
对方打开即与你竞速（离线也有效）。每日计分上限 5 次（服务端强制），超出进入练习模式。

### E2E 冒烟

```bash
pnpm --filter @dashline/api exec tsx scripts/e2e-ghosts.ts    # 完赛上榜→Ghost下发→链接回环
E2E_BASE=http://127.0.0.1:8788 pnpm --filter @dashline/api exec tsx scripts/e2e-attempts.ts  # 计次限制
```

## Monorepo 结构

| 路径 | 说明 |
|---|---|
| `packages/shared` | PRNG、输入流编解码、每日种子、常量与协议类型 |
| `packages/core` | ★ 确定性模拟核：`createWorld/step`、种子关卡生成 |
| `apps/client` | Vite + PixiJS 客户端（固定步长主循环、本地 Ghost） |
| `apps/api` | Fastify REST（Store 抽象：内存态 / Postgres，契约见 docs/api-and-data.md） |
| `apps/validator` | 重放验证器（与客户端共用同一个 core 包） |
