# Dashline 单机版维护说明

## 产品边界

当前工程是纯单机静态 Web 游戏：

- 不包含账号、API、数据库、排行榜、房间赛或远程 Ghost。
- 不录制或上传逐 tick 输入流。
- 所有进度只保存在当前浏览器的 localStorage。
- 战报功能只在本地生成图片，不携带在线挑战数据。

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

## 发布

`pnpm build` 生成纯静态产物。GitHub Actions 会在 main 分支更新时运行单元测试、类型检查、浏览器测试和生产构建，随后部署 `apps/client/dist`。

手工发布会覆盖远端 `gh-pages` 分支，因此必须显式确认：

```bash
pnpm pages:deploy -- --allow-force
```

脚本默认读取当前仓库的 `origin`；如确需发布到其他仓库，额外传入 `--target <git-url>`。PowerShell 版本使用 `-AllowForce` 和可选的 `-Target <git-url>`。
