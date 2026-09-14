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

两条与高速移动相关的约束，改动碰撞逻辑时不要回退：

- **碰撞查询使用"本 tick 推进后"的 `x`**。加速带（`vx × BOOST_FACTOR` ≈ 9.3px/tick）和空中冲刺
  （11.3px/tick）的单帧位移已接近半个身位宽（`half = 0.6R = 9.6px`）。若沿用推进前的 `x`，
  判定框会稳定落后身体一帧，高速撞上坑沿时"检测到"的时刻人已经嵌进地形。因此 `step()` 先算出
  本 tick 的 `adv`，碰撞查询与实际推进共用同一个值（`dashTicksAfter` 复刻冲刺分支的自减，
  保证冲刺距离不变）。
- **落地判据是 `feet >= g.y && prevFeet <= g.y + GROUND_STEP_MAX`**，而不是
  `prevFeet <= g.y && feet >= g.y`。后者只接受"自上而下穿过表面"，当玩家在空中横向跨到高一级的
  地面时，脚底在越过表面那一帧就已经低于新表面（`prevFeet > g.y`），旧判据永远不成立，
  玩家会贴着坑沿侧面穿进地形坠到坑底。新判据的第二个条件限定了允许的穿透深度
  （`g.y >= prevFeet - GROUND_STEP_MAX`），所以取最高段最多把玩家抬高一个台阶容差，不会变成穿墙电梯。

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

美术统一为 Kenney New Platformer Pack 1.0 的圆润卡通原野风格，界面采用奶油白、薄荷绿、深青描边及金黄收集色。不再混用旧像素森林、水晶球与系统 emoji。

- 场景与角色资源位于 `public/assets/kenney/`，作者 Kenney，CC0-1.0，可免费商用；来源为 https://kenney.nl/assets/new-platformer-pack ，实际导入的是作者上传 OpenGameArt 的 1.0 压缩包。原始许可保存在同目录 `LICENSE.txt`。
- 操作、护盾和磁铁图标位于 `public/assets/icons/`，来自 Lucide；ISC 与部分 Feather 衍生图标的 MIT 声明完整保存在 `icons/LICENSE.txt`。运行时仅加载同源静态文件，不调用素材站或 CDN。
- `public/assets/asset-provenance.json` 记录压缩包校验值、源路径、裁切/去底处理及最终文件 SHA-256；新增或编辑图片后需同步校验值。`art-assets.test.ts` 校验许可与素材完整性。
- 使用双倍分辨率 PNG 和线性采样。128px 地形格按 `ART_SCALE = 48 / 128` 显示；宝石与装饰沿用该比例。平台 22px、碎裂板 20px，板身在碰撞面下方，不修改物理尺寸。
- 同一角色所有姿态使用统一 168×204 画布裁切，渲染尺寸 34×42；脚底锚定 `snap.y + PLAYER_R`，姿态只由快照选择。衣橱原有 ID、价格、存档 key 保持不变，映射到绿、粉、紫、黄四款角色。
- 背景从原图去除平铺底色，并恢复边缘透明度，再以四层视差叠加；八种每日主题使用同一浅色视觉体系。地面装饰位于交互物后方，无碰撞装饰不再使用木箱。
- UI 样式集中在 `src/ui.css`，图标和按钮状态集中在 `src/ui-icons.ts`。HUD 与 16:9 canvas 同尺寸，面板内部滚动，静音/暂停状态以 `aria-pressed` 表达。
- 在 `pnpm dev` 已启动后运行 `pnpm test:art`，验证 1440×900、960×540、640×360 的画布/HUD对齐、面板边界、资源本地化及战报绘制。截图默认输出至已忽略的 `outputs/art-review/`，不作为源代码提交。

## 数据边界

本地数据包括每日最佳、近七日记录、连续完赛天数、金币、皮肤、成就、天赋、每日复活额度和管理员通道开关。存档通过 `storage.ts` 安全访问，复杂结构使用带版本的 key，并在读取时校验字段、兼容旧 key 迁移。清除浏览器站点数据会清除这些进度；当前没有云同步或导入导出。平台桥不会上传逐 tick 输入流或完整本地存档。
