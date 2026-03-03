# EvoTown 进化机制分析 — 现状与改进方向

## 一、你的核心诉求

> 需要重点让 agent 去进化 skills、memory、rules 等，而不是仅仅看他是否完成任务。  
> 仅仅测试大模型的效果有用吗？

**结论**：进化机制**已存在**，但当前设计**以任务完成为主**，进化是附属触发，经济系统**不奖励进化**。

---

## 二、现有进化机制（SkillLite + EvoTown）

### 2.1 SkillLite 进化引擎（已实现）

`skilllite-evolution` 会进化：

| 维度 | 内容 | 触发条件 |
|------|------|----------|
| **rules** | planning rules（`rules.json`）、examples | `meaningful >= 5` 且 `failures >= 2` 或 `replans >= 2` |
| **memory** | 记忆检索增强 | `meaningful >= 3` |
| **skills** | 新技能生成、已有技能精炼 | `meaningful >= 3` 且 `failures > 0` 或 `repeated_patterns > 0` |

数据来源：agent 执行产生的 `decisions` 表（工具调用、成功/失败、重规划等）。

### 2.2 EvoTown 进化触发（已实现）

`callbacks.on_task_done` 中：

```python
# 每 interval_tasks（默认 3）个任务触发一次
periodic = count % interval_tasks == 0
# 或：任务失败 + 距上次进化 >= 2 个任务
failure_trigger = on_fail and task_failed and (count - last_evolve) >= 2
should_evolve = periodic or failure_trigger
→ trigger_evolve(agent_id, agent_home)  # skilllite evolution run
```

### 2.3 进化事件推送（已实现）

- `log_watcher` 监听 `evolution.log`
- `skilllite evolution run` 写入 `rule_added`、`skill_generated`、`evolution_run` 等
- 通过 WebSocket 推 `evolution_event` 到前端
- 进化时间线、Agent 详情可展示进化事件

---

## 三、问题：进化未被经济系统奖励

### 3.1 Judge 只评任务完成

`judge.py` 评分维度：

- **completion**：是否完成用户意图
- **quality**：回答质量
- **efficiency**：工具调用效率

→ 映射到 `reward`：-5 ~ +10，**完全基于任务表现**。

### 3.2 经济系统不奖励进化

- 余额变化：接任务扣费、完成奖励、失败惩罚
- **没有任何进化奖励**：`rule_added`、`skill_generated`、`memory` 更新都不影响余额

### 3.3 淘汰只看余额

- `balance <= 0` → 淘汰
- 进化再多，任务失败多、余额耗尽仍会被淘汰

### 3.4 结果

- 系统本质在测「大模型能否完成任务」
- 进化是附带产物，没有形成「进化 → 生存/奖励」的正向循环
- 难以形成「越进化越强、越强越能活」的选择压力

---

## 四、改进方向

### 4.1 经济系统：进化奖励（推荐）

在 `on_task_done` 或进化事件回调中：

- `rule_added` → +2 ~ +5
- `skill_generated` → +5 ~ +10
- `skill_refined` → +2 ~ +3
- `memory` 更新 → +1 ~ +2

实现：`trigger_evolve` 返回进化结果（或解析 `evolution run --json`），在 callbacks 中根据变更类型加余额并广播。

### 4.2 Judge：增加进化维度（可选）

在 Judge 输入中增加「本次任务是否触发进化、进化类型」：

- 新增维度 `evolution`：0–10，衡量本次任务带来的进化价值
- 或：`total_score` 中给进化一定权重，例如 `0.7 * task_score + 0.3 * evolution_score`

### 4.3 进化触发更积极

- 将 `interval_tasks` 从 3 降到 2 或 1
- 任务失败时更早触发进化（例如失败即触发，不必等 2 个任务）

### 4.4 观测面板：进化优先

- 在 Agent 列表中突出展示：规则数、技能数、最近进化事件
- 进化时间线作为主 Tab，与「任务完成」并列
- 增加「进化贡献度」等指标，便于比较不同 agent 的进化表现

### 4.5 淘汰逻辑：考虑进化（进阶）

- 不单看余额，也看进化趋势
- 例如：近期有有效进化（新规则/技能）的 agent 可减免一次淘汰，或淘汰阈值略放宽

---

## 五、总结

| 能力 | 现状 | 建议 |
|------|------|------|
| 进化引擎（rules/memory/skills） | ✅ 已有 | 保持 |
| 进化触发 | ✅ 已有（周期性 + 失败） | 可更积极 |
| 进化事件推送 | ✅ 已有 | 保持 |
| **进化经济奖励** | ❌ 无 | **优先实现** |
| Judge 进化维度 | ❌ 无 | 可选 |
| 观测面板进化展示 | 有基础 | 可加强 |

**核心改动**：在 `callbacks` 中，当 `trigger_evolve` 产生 `rule_added`、`skill_generated` 等时，给对应 agent 加余额并广播，让「进化」成为生存和竞争的主线之一，而不只是任务完成的副产品。

---

## 六、已实现优化（2025-03）

| 改动 | 说明 |
|------|------|
| **进化经济奖励** | rule_added +3、example_added +2、skill_confirmed +8（人工 confirm 后）、skill_refined +3；skill_pending 不奖励 |
| **进化触发** | `interval_tasks` 默认 5，`failure_cooldown` 默认 3（失败后 3 个任务可再触发） |
| **进化奖励配置** | `evotown_config.json` 的 `evolution.rewards` 可配置各类型奖励值 |
| **前端余额同步** | `evolution_event` 带 `balance` 时更新 store，Phaser 标签同步 |
| **观测面板** | Agent 列表中有进化事件的 agent 显示 ✨ 标识 |
