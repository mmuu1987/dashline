# API 契约与数据模型 — Dashline《每日冲刺》

> 版本前缀 `/v1`，JSON over HTTPS，鉴权用 Bearer Token（匿名设备态即可玩）。
> 类型契约统一在 `packages/shared` 用 zod 定义，前后端共用。

---

## 1. 数据模型

```mermaid erDiagram
    PLAYERS ||--o{ RUNS : submits
    DAYS ||--o{ RUNS : "每日赛道"
    ROOMS ||--o{ RUNS : "房间赛"

    PLAYERS {
        uuid id PK
        text provider "anon | wechat | discord"
        text external_id UK "设备指纹/openid"
        text nickname
        int streak_days "当前连胜"
        timestamptz created_at
    }
    DAYS {
        date date PK
        bigint seed "全球统一种子"
        int theme_id
        jsonb meta "积木版本等"
    }
    ROOMS {
        uuid id PK
        text code UK "6位邀请码"
        bigint seed
        timestamptz starts_at
        timestamptz ends_at
        uuid owner_id FK
    }
    RUNS {
        uuid id PK
        uuid player_id FK
        text scope "daily | room"
        date day_date
        uuid room_id
        int score "排序键"
        boolean finished
        int time_ms
        int distance_m
        text inputs_b64 "40~120B 输入流"
        text inputs_hash
        text client_version
        text status "pending | valid | rejected"
        jsonb reject_reason
        timestamptz created_at
    }
```

### 关键 DDL（节选）

```sql
CREATE TABLE days (
  date DATE PRIMARY KEY,
  seed BIGINT NOT NULL,
  theme_id INT NOT NULL DEFAULT 0,
  meta JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id),
  scope TEXT NOT NULL CHECK (scope IN ('daily','room')),
  day_date DATE REFERENCES days(date),
  room_id UUID,
  score INT NOT NULL,
  finished BOOLEAN NOT NULL,
  time_ms INT,
  distance_m INT,
  inputs_b64 TEXT NOT NULL,
  inputs_hash TEXT NOT NULL,
  client_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','valid','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 每人每日/每房只保留最优一条有效成绩的语义由应用层保证
  UNIQUE (player_id, scope, COALESCE(day_date, room_id), attempt_no)
);

-- 榜单主查询路径
CREATE INDEX idx_runs_board ON runs (scope, day_date, status, score DESC);
CREATE INDEX idx_runs_room  ON runs (room_id, status, score DESC);
```

> 注：PostgreSQL 的 UNIQUE 里不能用 COALESCE，落地时改为生成列 `board_key TEXT` =
> `'d:'||day_date` / `'r:'||room_id`，对其做唯一约束。此处示意意图。

---

## 2. API 契约

| Method | Path | 说明 |
|---|---|---|
| POST | `/v1/auth/device` | 匿名设备注册，换取 token |
| GET | `/v1/daily/today` | 今日种子与元信息 |
| POST | `/v1/runs` | 提交一次完赛成绩（含输入流） |
| GET | `/v1/leaderboards/daily/:date?scope=global` | 日榜（global/me） |
| GET | `/v1/ghosts/daily/:date?kinds=top1,top10,self` | 拉 Ghost 输入流 |
| POST | `/v1/rooms` | 创建房间 |
| GET | `/v1/rooms/:code` | 房间信息 |
| GET | `/v1/rooms/:code/leaderboard` | 房间榜 |

### 2.1 `POST /v1/auth/device`

```jsonc
// req
{ "deviceId": "uuid-v4(本地生成,持久化)", "platform": "web", "nickname": null }
// res 200
{ "token": "jwt(30天)", "player": { "id": "...", "streakDays": 3 } }
```

幂等：同 deviceId 重复调用返回同一账号。

### 2.2 `GET /v1/daily/today`

```jsonc
{ "date": "2025-06-01", "seed": "7231845029", "themeId": 12,
  "resetAtLocal": "2025-06-02T00:00:00+08:00",
  "attemptsUsed": 2, "attemptsMax": 5 }
```

服务端按 UTC 日切惰性生成 days 行；CDN 缓存 60s，键含日期。

### 2.3 `POST /v1/runs`

```jsonc
// req
{ "scope": "daily", "date": "2025-06-01",
  "score": 9994769, "finished": true, "timeMs": 52310,
  "distanceM": 512, "coins": 84,
  "attemptNo": 3, "clientVersion": "1.0.0+core.7",
  "inputsB64": "AQECAwQFBg...",           // RLE+base64url
  "inputsHash": "9f2ac1d0e5b83a47" }
// res 202 —— 成绩先 pending，重放通过后定榜
{ "runId": "...", "status": "pending",
  "best": { "rank": 128, "total": 45210, "percentile": 0.997 } }
```

服务端 L1 校验（内联）：zod schema、hash 重算、`score ≤ 理论上限`、
`timeMs ∈ (10s, 600s]`、`inputs 解压长度 == timeMs*60 ticks`、每用户 10 req/min。
失败返回 `422 VALIDATION_FAILED` 并附原因码。

### 2.4 `GET /v1/ghosts/daily/:date?kinds=top1,self&excludeMe=1`

```jsonc
{ "ghosts": [
  { "kind": "top1", "player": {"nickname":"Flash"}, "timeMs": 48120,
    "inputsB64": "...", "inputsHash": "..." } ] }
```

只回 `valid` 成绩的输入流；响应 CDN 缓存至当日结束。

---

## 3. 错误码

| HTTP | code | 说明 |
|---|---|---|
| 401 | AUTH_REQUIRED | token 缺失/过期 → 客户端静默重新注册设备 |
| 403 | ATTEMPTS_EXHAUSTED | 当日计分次数用尽（M1 已强制：5 次/日，attempts 表计数） |
| 409 | STALE_SEED | 提交所带 date 与当前不符 |
| 422 | VALIDATION_FAILED | L1 校验失败，附 reason |
| 429 | RATE_LIMITED | 带 Retry-After |

### 3.1 版本分桶（M1 已强制）

`runs.client_version` 落库；榜单 / 排名 / Ghost 下发查询一律过滤
`client_version = CORE_VERSION`（当前 `core.2`）。旧版本成绩保留在库中但不参与展示，
配合 `seedForDate` 掺入版本号（换版本即换图），实现"改代码不改排名"。

---

## 4. 排行榜实现

**阶段一（≤ 百万级日成绩，纯 Postgres 够用）**：

```sql
SELECT rank_filter.* FROM (
  SELECT player_id, score, time_ms,
         RANK() OVER (ORDER BY score DESC) AS rank,
         COUNT(*) OVER () AS total
  FROM runs
  WHERE scope='daily' AND day_date=$1 AND status='valid'
) rank_filter WHERE player_id = $me OR rank <= 50;
```

配合 `idx_runs_board` 走索引扫描；"我的百分位"由 rank/total 得出。

**阶段二（日千万级再上）**：Redis ZSET `lb:daily:{date}`，ZADD score member=playerId，
`ZRANK` 取名次；Postgres 降级为持久真相源。**不要第一天就引入 Redis。**

---

## 5. Validator Worker（反作弊核心）

```ts
// apps/validator/src/job.ts —— 与客户端 import 同一个包
import { createWorld } from '@dashline/core';
import { decodeInputs } from '@dashline/shared';

export function validate(run: RunRow, day: DayRow): Verdict {
  const world = createWorld(BigInt(day.seed));
  const inputs = decodeInputs(run.inputsB64);

  let score = 0, finished = false;
  for (const byte of inputs) {
    score = applyScore(world, world.step(byte));
    finished ||= world.isFinished();
    if (!Number.isFinite(world.player.x)) return reject('SIM_NAN'); // 防炸核
  }

  if (!finished && run.finished)               return reject('FINISH_MISMATCH');
  if (Math.abs(score - run.score) > 0)         return reject('SCORE_MISMATCH');
  if (sha16(day.seed, run.inputsB64) !== run.inputsHash) return reject('HASH');
  return { ok: true };
}
```

三层防线（对应 tech-architecture §6）之外，补充两条软规则：

- **输入熵检测**：真人操作熵显著高于脚本固定模式，低于阈值标记人工复核而非直接封禁；
- **申诉通道**：误杀可通过结果页一键申诉，进人工队列——宁可漏判不可错杀真实玩家。

---

## 6. 观测指标（上线必看）

| 指标 | 目标 |
|---|---|
| runs 提交成功率 / rejected 率 | rejected < 1% |
| 验证延迟 P95 | < 60s（影响"定榜"体感） |
| GET /daily/today P95 | < 80ms（CDN 命中后 <20ms） |
| 次留 / 7留 | ≥35% / ≥12%（北极星） |

---

架构文档到此闭环：玩法见 [game-design.md](./game-design.md)，工程见 [tech-architecture.md](./tech-architecture.md)。下一步可以基于本结构搭建 monorepo 代码骨架（core 的 step/createWorld + 主循环 + 一个可跑的原型关卡）。
