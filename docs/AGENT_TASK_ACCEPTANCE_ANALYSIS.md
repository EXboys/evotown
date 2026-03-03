# EvoTown Agent 任务接受逻辑 — 分析报告与方案

## 一、问题描述

当前 EvoTown 存在以下问题：

1. **Agent 无选择权**：任务分发器（TaskDispatcher）选中空闲 agent 后，直接注入任务并**立即扣费、标记 in_task**，agent 没有机会判断是否要接这个任务。
2. **无目的乱逛**：Agent 无法根据自身能力、余额、任务难度做理性决策，导致盲目接任务、失败率高、余额耗尽被淘汰。
3. **进化效率低**：没有"选择性接任务"的机制，难以形成"量力而行、稳健进化"的策略。

---

## 二、现状分析

### 2.1 当前任务分发流程

```
TaskDispatcher._tick()
  → get_idle_agents()
  → _pick_task_for_agent(agent_id)  # 按难度均衡选任务
  → inject_fn(agent_id, task_text, difficulty)  # 即 dispatch_inject
      → process_mgr.inject_task(agent_id, task)   # ⚠️ context 未传入！
      → arena.add_balance(agent_id, -cost_accept) # 立即扣费
      → arena.set_in_task(agent_id, True)        # 立即标记执行中
```

**关键发现**：

| 环节 | 现状 | 问题 |
|------|------|------|
| `callbacks._format_arena_context` | 已实现：构建余额、接任务成本、奖励、惩罚、难度 | 设计正确 |
| `callbacks.dispatch_inject` | 传入 `context=context` | 正确 |
| `process_manager.inject_task` | **签名只有 `(agent_id, task)`，未接收 context** | context 被丢弃 |
| `process_manager` 请求体 | 只有 `message`, `session_key`, `skill_dirs`, `config` | 无 `context.append` |
| SkillLite RPC 协议 | 文档支持 `context.append` | 通用能力 |
| `rpc.handle_agent_chat` | **未解析 `params.context`** | 未实现 |
| `AgentConfig.context_append` | 类型定义中缺失（有编译错误） | 未完成 |
| `prompt.build_system_prompt` | 无 `context_append` 参数 | 未追加 |
| `ARENA_SOUL_TEMPLATE` | **未定义** | `process_manager._ensure_agent_structure` 会 NameError |

### 2.2 设计意图 vs 实际

`_format_arena_context` 的文案已明确：

> "Only proceed if you believe you can complete this task. If not, reply with a short refusal and do not use tools."

说明设计上希望 agent 能感知规则并拒绝，但：

1. **Context 从未传到 agent**，agent 看不到余额、成本、奖励。
2. **扣费在 inject 成功时立即发生**，即使 agent 回复"我拒绝"也已扣费。
3. **SOUL 模板缺失**，Arena 定制的身份/边界未写入。

---

## 三、SkillLite vs EvoTown 边界（重要）

### 3.1 原则

- **SkillLite**：通用 Agent 引擎，**不包含任何游戏/竞技场概念**。
- **EvoTown**：游戏逻辑、Arena 规则、经济、进化、淘汰，全部在 evotown 侧。

### 3.2 应放在 SkillLite 的（通用逻辑）

| 能力 | 说明 | 是否游戏相关 |
|------|------|--------------|
| RPC `context.append` | 调用方注入额外 system prompt 片段 | 否，通用 |
| `AgentConfig.context_append` | 运行时追加到 system prompt | 否，通用 |
| SOUL 加载机制 | 从 `--soul` / `.skilllite/SOUL.md` 加载 | 否，通用 |
| 两阶段"预览-确认"协议 | 若设计为通用"先返回决策再执行" | 待定，见下 |

### 3.3 应放在 EvoTown 的（游戏逻辑）

| 能力 | 说明 |
|------|------|
| Arena 规则文案 | `_format_arena_context` 的 balance、cost、reward、penalty |
| Arena SOUL 模板 | `ARENA_SOUL_TEMPLATE`，定义竞技场 agent 的身份与边界 |
| 两阶段任务分发 | 先发"任务预览"→ agent 返回 accept/reject → 再扣费、正式执行 |
| 每个 agent 的 soul 定制 | 不同性格、风险偏好（保守/激进） |
| 任务池、难度均衡、judge、进化触发 | 全部游戏逻辑 |

### 3.4 结论

- **SkillLite 只提供"可注入 context"的通用能力**，不感知 Arena、余额、任务难度。
- **EvoTown 负责**：构建 context 内容、定义 SOUL 模板、实现两阶段分发、处理 accept/reject 后的状态更新。

---

## 四、方案设计

### 4.1 方案 A：最小改动（仅传递 context，不改变流程）

**思路**：把 Arena context 正确传到 agent，让 agent 在 system prompt 中看到规则。Agent 仍可"拒绝"（回复文字、不调用工具），但**扣费仍发生在 inject 时**。

**SkillLite 改动**（通用）：

1. 在 `AgentConfig` 中增加 `context_append: Option<String>`。
2. 在 `prompt::build_system_prompt` 中增加 `context_append` 参数，追加到 system prompt 末尾。
3. 在 `rpc::handle_agent_chat` 中解析 `params.context.append`，设置 `config.context_append`。
4. 在 `planning.rs` 的 task-planning 路径中同样支持 `context_append`。

**EvoTown 改动**：

1. 定义 `ARENA_SOUL_TEMPLATE` 常量。
2. 修改 `process_manager.inject_task(agent_id, task, context=None)`，接收 context，写入请求的 `context.append`。

**优点**：改动小，agent 至少能感知规则。  
**缺点**：拒绝时仍已扣费，逻辑不完美。

---

### 4.2 方案 B：两阶段任务分发（推荐）✅ 已实现

**思路**：先发"任务预览"请求，agent 返回 accept/reject，**只有 accept 时才扣费并正式执行**。

**流程**：

```
Phase 1 — 预览
  EvoTown 发送 agent_chat，message = "【任务预览】{task}\n请回复 ACCEPT 或 REFUSE，并简要说明理由。"
  context.append = _format_arena_context(...)
  → Agent 返回纯文本，不调用工具

Phase 2 — 决策
  EvoTown 解析 agent 回复，若包含 REFUSE/拒绝 → 任务回池，不扣费
  若 ACCEPT/接受 → 扣费、set_in_task、再发一次 agent_chat 正式执行任务
```

**实现**：
- `process_manager.preview_task()`：发送预览请求，等待 done 事件，解析 ACCEPT/REFUSE
- `callbacks.dispatch_inject`：先 preview_task，拒绝则 `return_task_to_pool`；接受则 inject_task
- `task_dispatcher.return_task_to_pool()`：任务回池

---

### 4.3 方案 C：每个 Agent 定制 Soul（进阶）✅ 已实现

**思路**：不同 agent 有不同的"性格"和风险偏好，影响接任务策略。

**实现**：
- `ARENA_SOUL_TEMPLATES`：conservative（保守）、aggressive（激进）、balanced（均衡）三种模板
- 创建 Agent 时可选 soul_type，spawn 时写入对应模板到 `agent_home/SOUL.md`
- Agent 详情页新增 Soul 标签：展示、编辑、保存

---

## 五、推荐实施顺序

1. **修复基础能力（SkillLite 通用）**
   - 补全 `context_append` 支持（AgentConfig、prompt、rpc、planning）。
   - 确保 RPC 协议文档与实现一致。

2. **修复 EvoTown 集成**
   - 定义 `ARENA_SOUL_TEMPLATE`。
   - 修改 `inject_task` 接收并传递 context。

3. **实现两阶段分发（EvoTown）**
   - 新增 `preview_task`，修改 `dispatch_inject` 流程。

4. **可选：Soul 定制**
   - 为不同 agent 生成不同 Soul 变体，提升差异化与进化效果。

---

## 六、总结表

| 改动项 | 归属 | 是否通用 |
|--------|------|----------|
| `AgentConfig.context_append` | SkillLite | 是 |
| `build_system_prompt` 追加 context | SkillLite | 是 |
| RPC 解析 `params.context.append` | SkillLite | 是 |
| `ARENA_SOUL_TEMPLATE` | EvoTown | 否，游戏 |
| `inject_task` 传 context | EvoTown | 否，游戏 |
| 两阶段 preview → inject | EvoTown | 否，游戏 |
| 每 agent 定制 Soul | EvoTown | 否，游戏 |

**核心原则**：SkillLite 只提供"可注入任意 context"的能力；Arena 规则、任务接受逻辑、Soul 模板全部在 EvoTown 实现。
