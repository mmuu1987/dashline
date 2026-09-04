# Dashline 代码审计 case 索引

完整报告：[docs/2026-09-04_代码审计-dashline-report.md](../../../docs/2026-09-04_代码审计-dashline-report.md)。以下元数据用于 case traceability 校验。

### F-001
- severity: medium
- evidence_ids: [E-004, E-010, E-012]
- confidence: high
- location: apps/client/src/storage.ts
- status: validated

### F-002
- severity: medium
- evidence_ids: [E-005, E-010, E-011]
- confidence: high
- location: apps/client/src/meta.ts
- status: validated

### F-003
- severity: medium
- evidence_ids: [E-003, E-011]
- confidence: high
- location: scripts/browser-human-test.ts
- status: validated

### F-004
- severity: medium
- evidence_ids: [E-006, E-012]
- confidence: high
- location: .gitignore and .github/workflows/deploy.yml
- status: validated

### F-005
- severity: medium
- evidence_ids: [E-008, E-012]
- confidence: high
- location: apps/client/src/main.ts
- status: validated

### F-006
- severity: medium
- evidence_ids: [E-008, E-012]
- confidence: high
- location: scripts/deploy-pages.ts and scripts/deploy-pages.ps1
- status: validated

### F-007
- severity: low
- evidence_ids: [E-008, E-010, E-012]
- confidence: high
- location: packages/core/src/chunks.ts
- status: validated

### F-008
- severity: low
- evidence_ids: [E-007, E-010]
- confidence: high
- location: packages/core/src/world.ts and apps/client/src/main.ts
- status: validated

### F-009
- severity: low
- evidence_ids: [E-008, E-011]
- confidence: high
- location: apps/client/src/hud.ts
- status: validated

### F-010
- severity: low
- evidence_ids: [E-008, E-011]
- confidence: high
- location: apps/client/src/input.ts and apps/client/src/main.ts
- status: validated

### F-011
- severity: low
- evidence_ids: [E-008, E-011, E-012]
- confidence: high
- location: apps/client/src/render/worldview.ts
- status: validated

### P-001
- path_type: callflow
- steps: localStorage 输入经校验和迁移后进入业务状态；修复证据 E-010、E-012。

### P-002
- path_type: callflow
- steps: 手工发布先校验目标并要求显式 force 确认；修复证据 E-012。
