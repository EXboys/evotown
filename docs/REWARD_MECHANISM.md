# EvoTown 奖励机制 — 完整梳理

## 一、余额变动来源总览

| 时机 | 变动 | 配置来源 | 说明 |
|------|------|----------|------|
| **接任务** | -3 | economy.cost_accept | 两阶段：agent 接受任务后扣费 |
| **任务完成** | -5 ~ +5 | judge 内部映射 | 由 Judge 评分决定 |
| **进化事件** | +2 ~ +8 | evolution.rewards | rule_added、skill_confirmed 等 |
| **淘汰** | — | balance ≤ 0 | 余额归零时移除 agent |

---

## 二、任务相关奖励（Judge）

### 2.1 流程

```
任务完成 (on_task_done)
  → judge_task(task, response, tool_total, tool_failed)
  → JudgeResult.reward  # 内部映射，不读 economy 配置
  → arena.add_balance(agent_id, judge_result.reward)
```

### 2.2 Judge 评分维度

- **completion** (0–10)：是否完成用户意图
- **quality** (0–10)：回答质量
- **efficiency** (0–10)：工具调用效率  
- **total_score** = completion + quality + efficiency（0–30）

### 2.3 Judge → 奖励映射（硬编码）

| total_score | reward |
|-------------|--------|
| 0–5 | -5 |
| 6–10 | 0 |
| 11–20 | +3 |
| 21–30 | +5 |

### 2.4 快速短路（不调 LLM）

- 全工具失败 → reward = -5
- 空响应 → reward = -5
- Judge 超时 → 按 tool 成功率估算 score，再映射 reward

### 2.5 潜在问题

**economy 与 Judge 不一致**：

- `_format_arena_context` 告诉 agent：`Success: +{reward_complete}, Fail: {penalty_fail}`（默认 +10 / -5）
- 实际奖励来自 Judge 的 `JudgeResult.reward`（-5 / 0 / +5 / +10）
- 成功时可能是 +5 或 +10，失败时是 -5 或 0，与 agent 看到的文案不完全一致

---

## 三、进化相关奖励

### 3.1 流程

```
skilllite evolution run
  → 写入 evolution.log (rule_added, skill_confirmed 等)
  → log_watcher 检测
  → broadcast_evolution_event(data)
  → 按 event_type 查 evolution.rewards
  → arena.add_balance(agent_id, reward)
  → WS 推送 evolution_event（含 balance）
```

### 3.2 进化奖励配置（evolution.rewards）

| event_type | 默认奖励 | 说明 |
|------------|----------|------|
| rule_added | +5 | 新增 planning rule |
| example_added | +3 | 新增 few-shot 示例 |
| skill_confirmed | +12 | 人工 confirm 后 |
| skill_refined | +5 | 技能优化 |
| skill_pending | +4 | 进化生成新技能（待确认） |

### 3.3 配置路径

- `evotown_config.json` → `evolution.rewards`
- 示例：`evotown_config.json.example`

---

## 四、接任务扣费（两阶段）

### 4.1 流程

```
dispatch_inject(agent_id, task, difficulty)
  Phase 1: preview_task → agent 返回 ACCEPT/REFUSE
  Phase 2: 若 ACCEPT → inject_task
    → arena.add_balance(agent_id, cost_accept)  # 负数
    → arena.set_in_task(agent_id, True)
```

### 4.2 配置

- `economy.cost_accept`：默认 -5（接任务即扣 5）

---

## 五、淘汰逻辑

- `economy.eliminate_on_zero`：默认 true
- 当 `balance <= 0` 时：移除 agent、kill 进程、WS 推送 agent_eliminated

---

## 六、配置汇总

### economy（evotown_config.json）

```json
{
  "economy": {
    "initial_balance": 100,
    "cost_accept": -5,
    "reward_complete": 10,   // ⚠️ 仅用于展示给 agent，Judge 不读
    "penalty_fail": -5,      // ⚠️ 仅用于展示给 agent，Judge 不读
    "eliminate_on_zero": true
  }
}
```

### evolution.rewards

```json
{
  "evolution": {
    "rewards": {
      "rule_added": 5,
      "example_added": 3,
      "skill_confirmed": 12,
      "skill_refined": 5,
      "skill_pending": 4
    }
  }
}
```

---

## 七、可能的问题与改进方向

| 问题 | 建议 |
|------|------|
| **Judge 与 economy 不一致** | 让 Judge 使用 `reward_complete` / `penalty_fail`，或统一 arena context 文案 |
| **Judge 映射过粗** | 可改为连续映射或更多档位（如 0–30 → -5 ~ +15） |
| **进化奖励无上限** | 可加单日/单次进化奖励上限，防刷 |
| **难度未参与奖励** | 可让 hard 任务成功时奖励更高 |
| **超时惩罚** | 超时走 on_task_done，目前与失败相同（Judge 给低分） |
