# Dashline AI 协作说明

> 适用范围：整个仓库。任何 AI、自动化代理或新接手的开发者开始任务前，必须先读完本文件。

## 开始任务前

按顺序执行：

1. 阅读本文件，确认产品边界和工程红线。
2. 阅读 [README.md](./README.md)，了解当前功能与启动方式。
3. 根据任务阅读 [技术架构](./docs/tech-architecture.md) 或 [游戏设计](./docs/game-design.md)。
4. 运行 `git status --short`，识别其他开发者或模型留下的改动；不得覆盖、回滚或格式化无关文件。
5. 先搜索现有实现和测试，再决定修改位置。代码描述与文档冲突时，以当前代码和测试为准，并同步修正文档。

## 当前产品边界

Dashline 当前是一个**纯单机、纯静态 Web 跑酷游戏**。

必须保持：

- 没有账号、登录、远程 API、数据库、排行榜、房间赛或远程 Ghost。
- 不录制、上传或分享逐 tick 输入流。
- 不加入 WebSocket、遥测、广告 SDK、云存档或外部业务服务。
- 玩家进度只保存在浏览器 localStorage。
- 每日赛道由 UTC 日期、`CORE_VERSION` 和确定性 PRNG 在本地生成。
- 战报只在本地生成图片，不包含在线挑战或排名信息。

除非用户明确改变产品方向，否则不得重新引入已经删除的网络竞技架构。加载本项目贴图等同源静态资源不属于业务联网。

## 工程结构

| 路径 | 职责 | 主要依赖 |
|---|---|---|
| `packages/shared` | 输入位掩码、PRNG、每日种子、版本常量 | 无 |
| `packages/core` | 赛道生成、物理、碰撞、计分、世界快照 | `shared` |
| `apps/client` | PixiJS 渲染、输入、HUD、音频、本地成长和存档 | `core`、`shared` |
| `scripts` | 浏览器测试、静态页面部署 | 开发工具 |
| `docs` | 当前游戏设计和技术架构 | 当前实现 |

正确依赖方向：

```text
apps/client → packages/core → packages/shared
            ↘ packages/shared
```

禁止让 `core` 或 `shared` 反向依赖客户端。

## 修改代码时

### 维护确定性核心

`packages/core` 是项目地基，必须遵守：

- 固定以 60Hz tick 推进；逻辑时间只能来自 tick。
- 不得使用 DOM、BOM、网络、localStorage、`Date.now()`、`performance.now()` 或 `Math.random()`。
- 随机只能使用 `packages/shared/src/prng.ts`。
- `Track` 是只读关卡定义；金币、道具、碎裂平台等动态状态必须保存在 `World` 内部。
- 修改物理、碰撞、计分或赛道生成规则时，必须评估并更新 `CORE_VERSION`。
- 调整手感优先修改 `packages/core/src/tuning.ts`，同时更新相应测试护栏。

### 维护客户端

- [main.ts](./apps/client/src/main.ts) 只负责装配和游戏状态流；新增大型功能优先拆成独立模块。
- 渲染只读取 `WorldSnapshot` 和模拟事件，不把视觉状态写回 core。
- localStorage 统一通过 [storage.ts](./apps/client/src/storage.ts) 安全访问。
- 新增本地持久化数据时使用带版本的稳定 key，并兼容旧数据缺字段的情况。
- 不直接修改 `dist/`、`node_modules/` 或其他生成产物。
- UI 文案必须符合纯单机定位，避免“榜首”“在线”“对手”“上榜”等失效概念。

### 维护文档

以下变化必须同步更新本文件和相关文档：产品边界改变，顶层模块增删或移动，开发命令改变，确定性规则、存档格式或发布流程改变。

不要把尚未实现的规划写成现状。

## 验证要求

普通改动完成前至少运行：

```bash
pnpm test
pnpm -r exec tsc --noEmit
pnpm build
```

涉及浏览器交互、HUD、输入或渲染时，再运行：

```bash
pnpm test:browser
```

验收标准：

- 所有相关测试和类型检查通过，生产构建成功。
- `git diff --check` 无空白错误。
- 搜索确认没有遗留的旧符号、旧入口或失效文案。
- 不提交构建产物、截图、缓存或本地环境文件。
- 无法运行的验证必须在交接时明确说明。

## 多模型协作规则

- 修改前先检查工作树；默认现有未提交改动属于其他协作者。
- 只修改当前任务所需文件，不顺手清理无关代码。
- 不使用 `git reset --hard`、`git checkout --` 等命令覆盖他人工作。
- 同一文件已有改动时，先理解并保留其意图，再做最小兼容修改。
- 发现相邻问题但不在本任务范围时，记录在交接说明中，不擅自扩大改动。
- 完成后说明：改了什么、保留了什么、运行了哪些验证、还有什么风险。
- 不提交、推送、部署或发布，除非用户明确要求。

## 常用文件地图

| 任务 | 首选文件 |
|---|---|
| 跳跃、重力、冲刺手感 | `packages/core/src/tuning.ts`、`world.ts` |
| 新增或调整赛道积木 | `packages/core/src/chunks.ts` |
| 输入映射 | `apps/client/src/input.ts`、`packages/shared/src/types.ts` |
| 主循环与结算流程 | `apps/client/src/main.ts` |
| HUD、弹窗、按钮 | `apps/client/src/hud.ts`、`index.html` |
| 玩家和赛道渲染 | `apps/client/src/render.ts`、`apps/client/src/render/` |
| 音频 | `apps/client/src/audio.ts` |
| 本地历史与连胜 | `apps/client/src/meta.ts` |
| 天赋、成就、衣橱 | `apps/client/src/talents.ts`、`achievements.ts`、`wardrobe.ts` |
| 每日种子和版本 | `packages/shared/src/daily.ts`、`constants.ts` |
| 单元测试 | `packages/core/test/` |
| 浏览器流程测试 | `scripts/browser-human-test.ts` |

## 当前基线

- 包管理器：pnpm 9 workspace。
- 运行环境：Node.js 20 及以上。
- 客户端：Vite 5、TypeScript、PixiJS 8。
- 核心版本：以 `packages/shared/src/constants.ts` 中的 `CORE_VERSION` 为准。
- 标准命令：`pnpm dev`、`pnpm test`、`pnpm build`。

本节只记录稳定基线，不写易过期的测试数量、构建 hash 或临时工作状态。
