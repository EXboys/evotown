# EvoTown Arena 默认 Prompts/Rules 种子

新建 Agent 时，若 `chat/prompts/` 为空，会从此目录复制：

- `rules.json` — 规划规则（与 SkillLite seed 一致）
- `planning.md` — 任务规划 prompt
- `execution.md` — 执行 prompt
- `system.md` — 系统 prompt
- `examples.md` — 示例

来源：`crates/skilllite-evolution/src/seed/`。SkillLite 的 `ensure_seed_data` 需首次请求才触发，evotown 在创建 agent 时主动写入，确保详情页立即可见。
