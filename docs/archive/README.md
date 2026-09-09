# docs/archive

历史快照归档区。这里的文件是**特定日期的调研/决策记录**，内容可能已过时，不代表工程现状。

当前工程现状以 [AGENTS.md](../../AGENTS.md)、[README.md](../../README.md)、[HANDOVER.md](../../HANDOVER.md) 为准。

| 文件 | 说明 |
|---|---|
| `2026-08-31_技术调研-*-report.*` | 平台选型调研（微信小游戏 / 国内外轻量平台、成本对比）。当时的调研结论已反映在后续决策中：先转纯单机（commit `3f191d3`），后选择 4399 HTML5小游戏线（见 [4399 方案](../4399-minimal-operations-plan.md)）。 |
| `fish-eats-fish-design/` | 《潮汐猎场》完整游戏策划案（另一个独立项目的设计资料，与 Dashline 无关）及其 docx 导出脚本 `export-fish-design-docx.py`（脚本在归档目录内运行，输出同名 docx）。 |

注意：`docs/2026-09-04_代码审计-dashline-report.md` 保留在 `docs/` 原位——它与已提交的 `work/dashline-code-audit/` 工作目录存在双向相对链接，不宜移动；其 11 项发现已全部在 commit `33b12e2` 中修复，报告头部有归档状态说明。
