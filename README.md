# Evotown — 进化测试实现

将进化引擎（如 SkillLite）置于可控环境中做**进化效果验证**，经济规则可调、可重现、全本地，**不依赖虚拟币/加密货币**。

## 前置条件

- SkillLite 已安装（`skilllite evolution run`、`skilllite agent-rpc` 可用）
- Python 3.10+
- Node.js 18+
- 后端需在含 `.skills` 或 `skills` 的目录运行；每个 agent 会复制一份到 `~/.skilllite/arena/{agent_id}/.skills`，进化产物独立

## 快速开始

### 1. 启动后端

```bash
cd evotown/backend
pip install -r requirements.txt
python main.py
# 或: uvicorn main:app --host 0.0.0.0 --port 8765
```

### 2. 启动前端

```bash
cd evotown/frontend
npm install
npm run dev
```

访问 http://localhost:5174

## 经济规则（丛林法则）

可配置，支持 `evotown_config.json` 或环境变量：

| 配置项 | 默认 | 环境变量 |
|--------|------|----------|
| initial_balance | 100 | EVOTOWN_INITIAL_BALANCE |
| cost_accept | -5 | EVOTOWN_COST_ACCEPT |
| reward_complete | 10 | EVOTOWN_REWARD_COMPLETE |
| penalty_fail | -5 | EVOTOWN_PENALTY_FAIL |
| eliminate_on_zero | true | EVOTOWN_ELIMINATE_ON_ZERO |

`GET /config/economy` 可查询当前配置。

## 目录结构

```
evotown/
├── backend/              # FastAPI 后端
│   ├── main.py           # API + WebSocket
│   ├── economy_config.py # 经济规则配置
│   ├── evotown_config.json  # 可编辑的规则（可选）
│   ├── process_manager.py
│   ├── sqlite_reader.py
│   └── ...
├── frontend/         # React + Phaser 3 前端
│   └── src/
└── README.md
```

## 发布说明

Evotown 在 skillLite 仓库内开发，**发布时拆分为独立仓库**（如 `evotown` / `evotown-org/evotown`）。

```bash
# 拆分示例
git subtree split -P evotown -b evotown-main
```

## 关联文档

- [13-EVOLUTION-ARENA.md](../todo/13-EVOLUTION-ARENA.md) — 完整设计
- [12-SELF-EVOLVING-ENGINE.md](../todo/12-SELF-EVOLVING-ENGINE.md) — 进化引擎
