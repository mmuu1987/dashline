# Dashline《每日冲刺》

Dashline 是一款纯单机、浏览器即开即玩的横版跑酷游戏。每天根据 UTC 日期生成固定赛道，玩家可以挑战自己的今日最佳，并通过本地成长系统解锁外观、成就和天赋。

> AI 或自动化代理参与开发前，必须先阅读 [AGENTS.md](./AGENTS.md)。

## 特性

- 单指操作：轻点小跳、长按大跳、下滑下砸、右滑或双击冲刺。
- 每日一图：日期、核心版本和确定性随机数共同决定赛道。
- 约 100 秒赛道：26 种积木按距离解锁难度，含高低起伏的山丘、谷地、高台与连绵坡道。
- 完全离线：无账号、无 API、无数据库、无排行榜和远程 Ghost。
- 复活续跑：每天 3 次免费复活，从最近的安全落地检查点继续，坠坑也能救回来。
- 本地成长：最佳成绩、连续完赛天数、金币、皮肤、成就和天赋保存在 localStorage。
- 确定性核心：固定 60Hz 逻辑，渲染帧率不影响物理结果。
- 统一卡通美术：Kenney CC0 角色与原野场景、浅色界面、Lucide 图标；全部素材随静态包本地提供。来源与完整许可见 `apps/client/public/assets/asset-provenance.json` 及对应目录 `LICENSE.txt`。

## 快速开始

```bash
pnpm install
pnpm test
pnpm dev
```

浏览器访问 `http://localhost:5173`。

开发服务启动后，可另开终端执行 `pnpm test:art` 检查多尺寸 UI 和素材加载；完整游戏流程执行 `pnpm test:browser`。

构建静态版本：

```bash
pnpm build
pnpm preview
```

构建产物位于 `apps/client/dist`，可部署到任意静态网站托管服务。

## 4399 运营版（可选能力）

游戏默认纯单机运行。当构建产物被 4399 平台以 iframe 嵌入时，客户端会自动接入官方 H5小游戏 SDK（激励广告复活、平台进度条），任何平台失败都降级为纯单机，本地直开不受影响。构建变量 `VITE_DASHLINE_PLATFORM` 可强制开关。详见 [4399 最简运营方案](./docs/4399-minimal-operations-plan.md)。

> ⚠️ **正式发包前必须移除管理员模式。** 演示构建带有一条调试用的管理员通道（开启口令见 [技术架构](./docs/tech-architecture.md) 的「管理员通道」一节），它会跳过每日复活额度，用在线上等于一条绕过广告复活的免费后门。4399 审核包与运营包必须以 `VITE_DASHLINE_ADMIN=0` 构建，并确认 `grep -c dashline-admin apps/client/dist/assets/*.js` 输出 `0`。

## 工程结构

| 路径 | 职责 |
|---|---|
| `packages/shared` | 输入位掩码、每日种子、PRNG、版本常量 |
| `packages/core` | 确定性赛道生成、物理、碰撞、计分 |
| `apps/client` | PixiJS 渲染、HUD、音频和本地存档 |
| `scripts` | 浏览器测试与静态页面部署 |
| `docs` | 游戏设计、技术架构、4399 运营方案与历史归档 |

更详细的维护信息见 [HANDOVER.md](./HANDOVER.md)。
