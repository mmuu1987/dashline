# 技术架构

## 分层

```text
apps/client
  ├─ main / input / hud
  ├─ render / audio
  └─ meta / best-record / talents / achievements / wardrobe / storage
              │
              ▼
packages/core
  ├─ World：固定步长模拟
  ├─ Chunks：程序化赛道
  └─ Tuning：物理参数
              │
              ▼
packages/shared
  ├─ 输入位掩码
  ├─ 每日种子
  └─ 确定性 PRNG
```

工程没有服务端。客户端构建为静态 HTML、CSS、JavaScript 和图片资源。

## 运行流程

1. 客户端以 UTC 日期和 `CORE_VERSION` 计算当天种子。
2. core 根据种子生成固定赛道。
3. InputBuffer 把键盘、鼠标和触控操作转换成输入位掩码。
4. 主循环按 60Hz 调用 `World.step(input)`。
5. 渲染层读取 WorldSnapshot，并消费 jump、coin、crash 等事件。
6. 结算后把个人最佳与成长进度写入 localStorage。

## 确定性规则

- 时间只取自 tick 数。
- 随机只取自种子化 PRNG。
- core 不访问浏览器环境。
- 动态状态不写回共享 Track。
- 物理改动必须同步调整测试和 `CORE_VERSION`。

## 平台运营边界

客户端通过 `apps/client/src/platform.ts` 访问可选的平台能力，平台选择优先级为：官方 4399 HTML5小游戏 SDK（`platform-h5mini.ts`，仅在 iframe 嵌入环境自动接入）→ 宿主注入桥 `window.__DASHLINE_PLATFORM__`（测试用）→ 本地实现。本地直开时不加载 SDK、不发起平台请求。平台初始化、广告或统计失败必须降级，不能阻断核心游戏。

## 赛道与地形

赛道生成在 `packages/core/src/chunks.ts`。`Track.grounds` 的每个 `GroundSeg` 都带自己的顶面高度 `y`：

```ts
interface GroundSeg { x0: number; x1: number; y: number }
```

`y` 相对基准地面 `GROUND_Y = 460` 起伏，允许区间为 `[GROUND_Y - TERRAIN_UP_MAX, GROUND_Y + TERRAIN_DOWN_MAX]`
（即抬升 ≤120px、下沉 ≤40px）。上限受相机约束——相机只做水平跟随（`camX`），抬得更高会让角色跑出视口顶部；
下限受坑深判定约束——再深会让谷底接近坠落判定线。

地形积木（`chHill` / `chValley` / `chMesa` / `chRolling`）通过 `Builder.rampTo(dx, targetY)` 改变地面高度，
并且**结束前必须把地面收回 `GROUND_Y`**，这样其余 22 种积木可以继续假定"地面在基准高度"，不必逐个适配。
`rampTo` 接收绝对目标高度而非相对落差：相对量会在多次调用之间累积，一旦某块忘记抵消就会把地面越推越高。

坡道由阶梯拼成，单级高差 ≤`RAMP_STEP_PX = 10`，玩家靠 `GROUND_STEP_MAX = 12` 的贴地容差自动上下坡，
因此没有斜坡碰撞体。`World` 的贴地、落地与支撑判定全部按 `g.y` 逐段计算：

- `groundTopUnder(x, half)` 取脚下最近的地面段高度；
- 贴地状态下若脚底与新高度差 ≤`GROUND_STEP_MAX` 则吸附（上/下坡），否则转入离地坠落（悬崖）；
- `landingTopAt` 在落地时按各段自身高度判断穿越，多个候选取最高的一块。

渲染侧对应使用 `WorldView.terrainTopAt(x)` 贴合地面高度（地面段、装饰、弹跳菇、加速带、刺梁分类），
坑底暗色不再是"从 `GROUND_Y` 起的通栏矩形"，而是"全局底色从最低地面开始 + 每个坑单独补齐"，
否则谷地上方会出现一条横贯屏幕的黑带。

## 复活

复活入口与每日额度由 `apps/client/src/revive.ts` 的 `ReviveBank` 管理：每天 3 次免费复活，按 UTC 日期日切，存档 key 为 `dl_revives_v1`。激励广告复活只在平台能力可用时出现，每局最多一次，与免费次数互不影响。

复活使用客户端内存中的安全落地检查点。检查点由 `revive.ts` 的 `ReviveCheckpointTracker` 管理：只在踩实地面时取样，并**滞后 `REVIVE_BACKOFF_PX`（320px）才提交**，因此复活点永远落在死亡点身后一段距离。早期实现把"当前落地位置"直接当检查点，玩家在坑口前十几像素处踩地存点、下一帧掉坑，复活出来就贴着坑沿重生、原速再掉一次；滞后取样修掉了这个"复活即秒死"。复活会恢复 `World` 的确定性动态状态，并由 `WorldSnapshot` 精确恢复金币、圆环、护盾、磁铁和碎裂平台的显示状态；赛道对象未变，所以只回灌动态状态，不重建赛道精灵树。`World.reviveFrom` 给出的保护期只抵扣尖刺、钉球和激光，坠坑始终立即判死，否则玩家会在复活保护期内一直坠落到保护结束。

4399 官方 h5mini-2.0 接口已按官方文档与 SDK 源码完成适配（`canPlayAd` 库存探测、`playAd` 状态码映射、`progress` 进度上报），剩余为平台预览环境的真实广告联调，详见 [4399 最简运营方案](./4399-minimal-operations-plan.md) 第 12 节。

## 管理员通道

`apps/client/src/admin.ts` 提供一条仅供仓库所有者使用的调试通道：开启后跳过每日复活额度。

| 用途 | 参数 | 说明 |
|---|---|---|
| **开启** | `?admin=dashline-admin` | 默认口令；写入存档后长期生效，不用每次带参数 |
| **关闭** | `?admin=off` | 同时接受 `0` / `false` / `no`；会清掉存档状态 |

GitHub Pages 演示站的完整链接（建议只把「开启」存书签）：

- 开启：`https://mmuu1987.github.io/dashline/?admin=dashline-admin`
- 关闭：`https://mmuu1987.github.io/dashline/?admin=off`

口令可用构建变量 `VITE_DASHLINE_ADMIN_TOKEN` 覆盖；未设置时就是上表里的默认口令。开关持久化在 `dl_admin_v1`，开启时 HUD 右下角与复活按钮都会显示管理员标识，不会静默生效。口令打错时参数会被忽略（而不是强制关闭），避免误输入丢掉已开启的通道。

**它不是权限校验。** 项目没有服务端，口令随产物一起下发，任何人都能从 bundle 里读出来；它的目标是防止普通玩家误触或顺手打开，不是防破解。

### ⚠️ 正式发包前必须移除

4399 审核包与运营包必须用 `VITE_DASHLINE_ADMIN=0` 构建，否则包里会带上一条**能绕过广告复活的无限复活后门**：

```bash
VITE_DASHLINE_ADMIN=0 pnpm --filter @dashline/client exec vite build --base=./
grep -c dashline-admin apps/client/dist/assets/*.js   # 必须输出 0
```

该变量会把整段逻辑连同口令字面量一起编译掉。`admin.ts` 里的判断刻意只做字面量比较、不调用 `.trim()` 之类的方法，否则打包器无法常量折叠，口令会残留在 bundle 里（早期写法踩过这个坑：`VITE_DASHLINE_ADMIN=0` 时两次构建产物字节数完全相同，开关形同虚设）。发布前务必执行上面的 `grep` 自检，确认输出为 `0`。

## 渲染素材约定

Sunny Land 像素素材按 384×216 绘制，视口 960×540 正好是它的 2.5 倍，因此所有 16px 素材格统一使用 `render/consts.ts` 的 `ART_SCALE`。混用倍率会让同一画面出现多种像素密度，看起来既糊又比例失调。像素素材一律 `scaleMode = 'nearest'`。

- 草皮与泥土从 `art/tileset.png` 各取三个变体横向拼成 48×16 的条带再平铺，避免 16px 图案硬重复。早期版本的 `art/ground_top.png`、`art/ground_fill.png` 以及整图 `ground.png`、`plank.png`、`coin.png`、`cloud.png` 已被取代，连同全透明的 `art/shrooms.png` 与未使用的 `art/gem-5.png`、`art/gem-6.png` 一并从仓库删除；新增素材前请先确认它真的会被 `textures.ts` 的 `ASSET_URLS` 加载。
- 地面装饰（草簇、高草、小灌木）取自 tileset 第 7 行的透明底格子。
- 平台与碎裂板受关卡设计约束（平台离地最低 24px、层间 42px），厚度保持薄板 22px，不随 `ART_SCALE` 放大；但板身必须贴在判定面之下，与判定线对齐。
- `art/forest.png` 上半部是透明底树冠、下半部是一整块纯色暗块，因此只截取树冠条带并按整数倍放大，不再整张缩小。

## 数据边界

本地数据包括每日最佳、近七日记录、连续完赛天数、金币、皮肤、成就、天赋、每日复活额度和管理员通道开关。存档通过 `storage.ts` 安全访问，复杂结构使用带版本的 key，并在读取时校验字段、兼容旧 key 迁移。清除浏览器站点数据会清除这些进度；当前没有云同步或导入导出。平台桥不会上传逐 tick 输入流或完整本地存档。
