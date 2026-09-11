# Dashline 维护说明

## 产品边界

当前工程是纯单机静态 Web 游戏：

- 不包含账号、API、数据库、排行榜、房间赛或远程 Ghost。
- 不录制或上传逐 tick 输入流。
- 所有进度只保存在当前浏览器的 localStorage。
- 战报功能只在本地生成图片，不携带在线挑战数据。
- 唯一的 sanctioned 例外是 4399 运营版平台能力（见下文），必须通过独立适配层、功能开关和失败降级接入，不得污染 `core`。

## 核心约束

1. 游戏逻辑固定以 60Hz tick 推进，不在 core 中读取真实时间。
2. core 中禁止 DOM、网络、localStorage、`Date.now()` 和 `Math.random()`。
3. 赛道随机只使用 `packages/shared/src/prng.ts`。
4. 修改物理或赛道生成规则时更新 `CORE_VERSION`，确保每日赛道随版本变化。
5. `Track` 是只读定义，金币、道具和碎裂状态必须保存在 `World` 内部。

## 常用命令

```bash
pnpm dev
pnpm test
pnpm -r exec tsc --noEmit
pnpm build
pnpm test:browser
```

## 关键文件

| 需求 | 文件 |
|---|---|
| 手感参数 | `packages/core/src/tuning.ts` |
| 物理和计分 | `packages/core/src/world.ts` |
| 程序化赛道 | `packages/core/src/chunks.ts` |
| 客户端主循环 | `apps/client/src/main.ts` |
| HUD 与弹窗 | `apps/client/src/hud.ts` |
| 渲染 | `apps/client/src/render.ts`、`apps/client/src/render/` |
| 本地历史 | `apps/client/src/meta.ts` |
| 本地存储封装 | `apps/client/src/storage.ts` |
| 天赋、成就、衣橱 | `apps/client/src/talents.ts`、`achievements.ts`、`wardrobe.ts` |
| 4399 平台适配 | `apps/client/src/platform.ts`、`platform-h5mini.ts`、`platform-config.ts` |

## 发布

`pnpm build` 生成纯静态产物。GitHub Actions 会在 main 分支更新时运行单元测试、类型检查、浏览器测试和生产构建，随后部署 `apps/client/dist`。

手工发布会覆盖远端 `gh-pages` 分支，因此必须显式确认：

```bash
pnpm pages:deploy -- --allow-force
```

脚本默认读取当前仓库的 `origin`；如确需发布到其他仓库，额外传入 `--target <git-url>`。PowerShell 版本使用 `-AllowForce` 和可选的 `-Target <git-url>`。

## 4399 运营版（进行中，代码侧已就绪）

对接产品线是 4399 开放平台「**HTML5小游戏**」（原创平台 h5mini-2.0，`window.h5api`），不是「HTML5页游联运」（企业限定+服务端接口）也不是「游戏盒小游戏」（gb4399 SDK）。

### 平台层结构

| 文件 | 职责 |
|---|---|
| `apps/client/src/platform.ts` | `GamePlatform` 稳定接口、平台选择优先级（官方 SDK → `__DASHLINE_PLATFORM__` 宿主桥 → 本地）、宿主桥实现（测试用） |
| `apps/client/src/platform-h5mini.ts` | 官方 h5mini-2.0 适配器：iframe 嵌入自动检测、SDK 动态注入与就绪轮询、`canPlayAd` 库存探测、`playAd` 状态码映射、`progress` 进度上报、全路径安全降级 |
| `apps/client/src/platform-config.ts` | 构建期开关与官方 SDK 地址 |

### 关键行为约定

- 构建变量 `VITE_DASHLINE_PLATFORM`：`auto`（默认，仅在 iframe 嵌入时接入）/ `4399`（强制，平台预览联调用）/ `local` / `off`（禁用）。
- 本地直开**零网络请求**，任何平台失败（SDK 缺失、脚本超时、非 4399 宿主、回调异常）一律静默降级为纯单机，不向游戏主循环抛错。
- 初始化（脚本等待 + 库存探测）共享 2.5 秒总预算，保证启动阻塞上限。
- 激励复活每局一次；仅 `playAd` 回调 `code=10001`（播放结束）发放复活，`10010`/超时不发放；`canPlayAd` 无库存时入口不展示、不消耗复活机会。
- 撞毁后自动后台刷新库存（`refreshAds`），异步结果会安全重绘当前局结算面板；广告回调绑定局次，重开后不会污染新一局。
- 官方 API 完整清单、资料来源与联调边界见 [docs/4399-minimal-operations-plan.md](./docs/4399-minimal-operations-plan.md) 第 12 节。

### 测试覆盖

- 单元：`apps/client/test/platform.test.ts`（宿主桥与降级）、`platform-h5mini.test.ts`（官方状态码映射、库存探测、预算共享、超时降级）。
- 端到端：`scripts/browser-human-test.ts` 两个平台场景——宿主桥注入、iframe 嵌入 + 官方 h5api 桩（自动检测、进度上报、激励复活全流程）。

### 剩余待办（需要平台环境，代码侧不阻塞）

1. 4399 后台完成「HTML5小游戏」项目资料并上传静态包（图标已就绪：`apps/client/public/assets/dashline-icon-124.png`）；
2. 平台预览页验证真实 SDK 加载、广告库存与真实广告播放；
3. 走平台评测、提审、上线流程；
4. 上线后按数据决定是否启用插屏、匿名排行榜等可选能力（启用前需重新评估纯单机文案边界）。
