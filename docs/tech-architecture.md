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

## 数据边界

本地数据包括每日最佳、近七日记录、连续完赛天数、金币、皮肤、成就和天赋。存档通过 `storage.ts` 安全访问，复杂结构使用带版本的 key，并在读取时校验字段、兼容旧 key 迁移。清除浏览器站点数据会清除这些进度；当前没有云同步或导入导出。
