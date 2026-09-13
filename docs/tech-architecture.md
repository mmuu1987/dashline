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

## 复活

复活入口与每日额度由 `apps/client/src/revive.ts` 的 `ReviveBank` 管理：每天 3 次免费复活，按 UTC 日期日切，存档 key 为 `dl_revives_v1`。激励广告复活只在平台能力可用时出现，每局最多一次，与免费次数互不影响。

复活使用客户端内存中的安全落地检查点。复活会恢复 `World` 的确定性动态状态，并由 `WorldSnapshot` 精确恢复金币、圆环、护盾、磁铁和碎裂平台的显示状态；赛道对象未变，所以只回灌动态状态，不重建赛道精灵树。`World.reviveFrom` 给出的保护期只抵扣尖刺、钉球和激光，坠坑始终立即判死，否则玩家会在复活保护期内一直坠落到保护结束。

4399 官方 h5mini-2.0 接口已按官方文档与 SDK 源码完成适配（`canPlayAd` 库存探测、`playAd` 状态码映射、`progress` 进度上报），剩余为平台预览环境的真实广告联调，详见 [4399 最简运营方案](./4399-minimal-operations-plan.md) 第 12 节。

## 渲染素材约定

Sunny Land 像素素材按 384×216 绘制，视口 960×540 正好是它的 2.5 倍，因此所有 16px 素材格统一使用 `render/consts.ts` 的 `ART_SCALE`。混用倍率会让同一画面出现多种像素密度，看起来既糊又比例失调。像素素材一律 `scaleMode = 'nearest'`。

- 草皮与泥土从 `art/tileset.png` 各取三个变体横向拼成 48×16 的条带再平铺，避免 16px 图案硬重复；`art/ground_top.png` 与 `art/ground_fill.png` 已不再用于跑道渲染。
- 地面装饰（草簇、高草、小灌木）取自 tileset 第 7 行的透明底格子。
- 平台与碎裂板受关卡设计约束（平台离地最低 24px、层间 42px），厚度保持薄板 22px，不随 `ART_SCALE` 放大；但板身必须贴在判定面之下，与判定线对齐。
- `art/forest.png` 上半部是透明底树冠、下半部是一整块纯色暗块，因此只截取树冠条带并按整数倍放大，不再整张缩小。

## 数据边界

本地数据包括每日最佳、近七日记录、连续完赛天数、金币、皮肤、成就、天赋和每日复活额度。存档通过 `storage.ts` 安全访问，复杂结构使用带版本的 key，并在读取时校验字段、兼容旧 key 迁移。清除浏览器站点数据会清除这些进度；当前没有云同步或导入导出。平台桥不会上传逐 tick 输入流或完整本地存档。
