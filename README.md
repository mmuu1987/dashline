# Dashline《每日冲刺》

Dashline 是一款纯单机、浏览器即开即玩的横版跑酷游戏。每天根据 UTC 日期生成固定赛道，玩家可以挑战自己的今日最佳，并通过本地成长系统解锁外观、成就和天赋。

> AI 或自动化代理参与开发前，必须先阅读 [AGENTS.md](./AGENTS.md)。

## 特性

- 单指操作：轻点小跳、长按大跳、下滑下砸、右滑或双击冲刺。
- 每日一图：日期、核心版本和确定性随机数共同决定赛道。
- 完全离线：无账号、无 API、无数据库、无排行榜和远程 Ghost。
- 本地成长：最佳成绩、连续完赛天数、金币、皮肤、成就和天赋保存在 localStorage。
- 确定性核心：固定 60Hz 逻辑，渲染帧率不影响物理结果。

## 快速开始

```bash
pnpm install
pnpm test
pnpm dev
```

浏览器访问 `http://localhost:5173`。

构建静态版本：

```bash
pnpm build
pnpm preview
```

构建产物位于 `apps/client/dist`，可部署到任意静态网站托管服务。

## 工程结构

| 路径 | 职责 |
|---|---|
| `packages/shared` | 输入位掩码、每日种子、PRNG、版本常量 |
| `packages/core` | 确定性赛道生成、物理、碰撞、计分 |
| `apps/client` | PixiJS 渲染、HUD、音频和本地存档 |
| `scripts` | 浏览器测试与静态页面部署 |
| `docs` | 游戏设计和技术架构 |

更详细的维护信息见 [HANDOVER.md](./HANDOVER.md)。
