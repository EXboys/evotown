# Evotown 源码索引

> 用途：快速定位代码。按功能模块分类，每个文件一行说明。找到目标后直接 read_file 深入。

---

## 一、项目入口与启动

| 文件 | 作用 |
|------|------|
| `backend/main.py` | FastAPI 应用入口，lifespan 初始化所有全局单例和路由，启动 3 个后台循环（超时检查、状态持久化、战报生成） |
| `backend/requirements.txt` | Python 依赖清单（13 个包） |
| `frontend/src/main.tsx` | React 入口，渲染 `<App />` |
| `frontend/src/App.tsx` | 路由定义，所有页面路由映射 |
| `frontend/package.json` | 前端依赖（React 18 + Phaser 3 + Zustand + Recharts） |
| `docker-compose.yml` | Docker 编排：backend + litellm + frontend |
| `Dockerfile.backend` | 后端镜像构建 |
| `Dockerfile.frontend` | 前端两阶段构建镜像 |

---

## 二、配置系统

| 文件 | 作用 |
|------|------|
| `backend/core/config.py` | 配置加载中心：经济/进化/队伍/派发/超时，环境变量 > JSON > 硬编码默认 |
| `backend/evotown_config.json` | 运行时 JSON 配置（经济参数、派发策略、进化规则） |
| `backend/economy_config.py` | 经济配置兼容层（转发到 core.config） |
| `backend/experiment_meta.json` | 实验 ID + 配置快照 |
| `frontend/src/lib/employeeConfig.ts` | 员工入职配置生成器（.env / YAML / 脚本片段） |
| `.env.example` | 环境变量模板 |

---

## 三、认证体系

| 文件 | 作用 |
|------|------|
| `backend/core/auth.py` | 多角色认证：Admin / Engine Ingest / Gateway / Console，prompt injection 检测 |
| `backend/infra/accounts.py` | 网关账户 + API Key CRUD（`accounts.db`），速率/配额检查 |
| `backend/infra/oidc.py` | OIDC/SSO 登录（Authorization Code 流程） |
| `backend/api/routers/console_auth.py` | 控制台认证路由：注册/登录/OIDC |
| `frontend/src/hooks/useAdminToken.ts` | 前端认证层：sessionStorage 存 key，adminFetch 自动注入 header |

---

## 四、全局单例与依赖注入

| 文件 | 作用 |
|------|------|
| `backend/core/deps.py` | 全局单例容器：arena、manager、ws、process_mgr、monitor、task_dispatcher |

---

## 五、Domain 层（纯业务逻辑）

| 文件 | 作用 |
|------|------|
| `backend/domain/models.py` | 全部 Pydantic 请求/响应模型（Agent、Task、Event、Engine、Policy、Skill、Gateway、Knowledge 等） |
| `backend/domain/arena.py` | 竞技场内存状态：AgentRecord、TeamRecord、队伍管理、重组逻辑、邮箱通信、持久化 |
| `backend/domain/policy/types.py` | 策略评估类型：PolicyCheckKind、PolicyDecisionAction、PolicyEvaluation |
| `backend/domain/policy/evaluator.py` | 无状态策略评估器：tool/workspace/network/artifact/text 五类检查 |
| `backend/models.py` | 兼容层，转发 domain.models |

---

## 六、Services 层（业务协调）

| 文件 | 作用 |
|------|------|
| `backend/services/agent_service.py` | Agent 生命周期管理：创建/删除/进化/数据查询/技能管理/Soul 管理 |
| `backend/services/task_service.py` | 任务注入：单条/批量注入到 agent 进程 |
| `backend/services/belief_engine.py` | 文化信仰引擎：忠诚度、叛逃判定、军团宗旨生成（LLM） |
| `backend/services/chronicle.py` | 组织运行日报：数据汇总 → LLM 生成 → 持久化 → WS 广播 |
| `backend/services/snapshot.py` | 分享卡片生成：Pillow 绘制三国武将战报 PNG |
| `backend/services/social_decision.py` | 社会决策：LLM 驱动 Agent 更新 solo_preference + evolution_focus |
| `backend/services/agent_comms.py` | Agent 间通信：LLM 生成社交消息 → 邮箱投递 → WS 广播 |

---

## 七、事件回调（核心业务编排）

| 文件 | 作用 |
|------|------|
| `backend/core/callbacks.py` | 最核心业务文件：TaskDoneEvent 总线，5 步流水线（Judge → 余额 → 记录 → 进化 → 社交重组） |

---

## 八、运行时引擎

| 文件 | 作用 |
|------|------|
| `backend/process_manager.py` | SkillLite 子进程管理：spawn/stdout 解析/工具统计/内存看门狗/自动重启/inject_task/trigger_evolve |
| `backend/task_dispatcher.py` | 任务分发器：LLM 生成任务 → 任务板 → 空闲 agent 领取，动态难度，进化感知 |
| `backend/task_injector.py` | 兼容层，转发到 process_manager.inject_task |
| `backend/judge.py` | LLM 裁判：三维度评分（completion/quality/efficiency），JSON 多策略解析，降级机制 |
| `backend/llm_client.py` | LLM 客户端：分层模型路由、熔断器、并发限流、Token 统计 |
| `backend/log_watcher.py` | 日志看门狗：watchdog 监听 evolution.log → WS 推送进化事件 |
| `backend/arena_monitor.py` | 竞技场监控：记录每次任务执行的完整上下文（工具调用/文本/耗时） |

---

## 九、WebSocket 系统

| 文件 | 作用 |
|------|------|
| `backend/ws_dispatcher.py` | WS 连接管理 + 消息广播：20+ 种出站消息构建器 |
| `backend/ws_messages.py` | WS 消息类型定义（TypedDict）：21 种服务端消息 |
| `backend/api/routers/websocket.py` | WS 端点：`/ws` 连接，心跳，连接时发送快照 |
| `backend/ws_incoming_dispatcher.py` | 入站消息处理（预留） |
| `frontend/src/hooks/useWebSocket.ts` | 前端 WS 客户端：连接/重连/心跳/20+ 事件类型处理 |

---

## 十、持久化层（Infra）

### SQLite 数据库
| 文件 | 数据库 | 作用 |
|------|--------|------|
| `backend/infra/persistence.py` | `arena_state.db` | 竞技场状态持久化（SQLite WAL + JSON 原子备份双写） |
| `backend/infra/accounts.py` | `accounts.db` | 网关账户、API Key、OIDC 状态 |
| `backend/infra/engine_ingest.py` | `engine_ingest.db` | 引擎注册、运行记录、事件流、策略违规 |
| `backend/infra/gateway.py` | `gateway.db` | 网关请求审计记录 + 重试轨迹存储 |
| `backend/infra/gateway_models.py` | `gateway.db` | 上游模型注册表 |
| `backend/infra/gateway_routes.py` | `gateway.db` | 模型别名路由 + 重试策略/降级链/auto-policy |
| `backend/infra/gateway_retry.py` | (无独立DB) | 上游重试/降级链执行引擎（per-model retry + cross-model fallback） |
| `backend/infra/gateway_auto.py` | (无独立DB) | 启发式自动模型分级（fast/balanced/strong） |
| `backend/infra/gateway_upstream.py` | (无独立DB) | 构建 per-model 上游调用（managed / LiteLLM 双模式） |
| `backend/infra/knowledge.py` | `knowledge.db` | 企业知识库（FTS 全文检索） |
| `backend/infra/policies.py` | `policies.db` | 企业策略存储 |
| `backend/infra/skill_market.py` | `skills_market.db` | Skills 市场：技能/候选/bundle |
| `backend/infra/asset_registry.py` | `asset_registry.db` | 资产注册表 |

### JSONL 文件日志
| 文件 | 文件名 | 作用 |
|------|--------|------|
| `backend/infra/task_history.py` | `task_history.jsonl` | 任务/评分历史 |
| `backend/infra/execution_log.py` | `execution_log.jsonl` | 任务拒绝记录 |
| `backend/infra/tool_execution_stream.py` | `tool_execution_stream.jsonl` | 工具执行流 |
| `backend/infra/social_log.py` | `social_log.jsonl` | Agent 社交消息 |
| `backend/infra/eliminated_agents.py` | `eliminated_agents.jsonl` | 淘汰 Agent 归档 |
| `backend/infra/replay.py` | `replays/*.jsonl` | WS 事件录制回放 |
| `backend/infra/experiment.py` | `experiment_meta.json` | 实验 ID 快照 |

---

## 十一、Infra 其他模块

| 文件 | 作用 |
|------|------|
| `backend/infra/agent_dispatch.py` | 任务调度队列：创建/领取/确认/完成，引擎间交接 |
| `backend/infra/dispatch_notify.py` | WS 广播调度任务变更 |
| `backend/infra/gateway_auto.py` | 启发式自动模型分级（fast/balanced/strong） |
| `backend/infra/gateway_retry.py` | 上游重试/降级链（per-model retry + cross-model fallback） |
| `backend/infra/gateway_upstream.py` | 构建 per-model 上游调用（managed / LiteLLM 双模式） |
| `backend/infra/knowledge_chunks.py` | 文档分块 + FTS 索引 |
| `backend/infra/knowledge_adapters/base.py` | 知识源适配器 Protocol |
| `backend/infra/knowledge_adapters/feishu.py` | 飞书知识库适配器 |
| `backend/infra/knowledge_adapters/yuque.py` | 语雀知识库适配器 |
| `backend/infra/litellm_sync.py` | 同步上游模型到 LiteLLM 代理 |
| `backend/infra/policy_engine.py` | 策略评估编排 + 违规记录 |
| `backend/infra/redaction.py` | 密钥脱敏（API key/token/secret） |
| `backend/infra/skill_catalog.py` | 技能目录（starter + ecosystem） |
| `backend/infra/skill_signing.py` | Skill 包 HMAC 签名验证 |

---

## 十二、API 路由（全部 24 个）

| 路由文件 | 前缀 | 核心端点 |
|----------|------|----------|
| `api/routers/agents.py` | `/agents` | Agent CRUD、进化、数据查询、技能管理、Soul 管理 |
| `api/routers/tasks.py` | `/tasks` | 任务注入（单条/批量） |
| `api/routers/dispatcher.py` | `/dispatcher` | 任务分发器启停、手动生成任务 |
| `api/routers/teams.py` | `/teams` | 队伍分配/解散/重组、救援、社交消息/图谱 |
| `api/routers/monitor.py` | `/monitor` | Token 用量、活跃任务、历史统计、淘汰 Agent |
| `api/routers/replay.py` | `/replay` | 录制会话管理 |
| `api/routers/snapshot.py` | `/snapshot` | 分享卡片 PNG 生成 |
| `api/routers/chronicle.py` | `/chronicle` | 组织运行日报生成/查询 |
| `api/routers/config.py` | `/config` | 经济配置、实验快照 |
| `api/routers/console_auth.py` | `/api/v1/auth` | 注册/登录/OIDC |
| `api/routers/accounts.py` | `/api/v1` | 网关账户 + API Key CRUD |
| `api/routers/agent_dispatch.py` | `/api/v1` | 引擎调度队列、引擎心跳 |
| `api/routers/engine_ingest.py` | `/api/v1` | 引擎注册、运行上报、事件流、策略违规 |
| `api/routers/gateway.py` | `/api/gateway/v1` | OpenAI 兼容聊天（含重试/降级链）、使用量审计 |
| `api/routers/gateway_models.py` | `/api/gateway/v1` | 上游模型 CRUD + LiteLLM 同步 |
| `api/routers/gateway_routes.py` | `/api/gateway/v1` | 模型别名路由 + 重试策略/降级链/auto-policy |
| `api/routers/policies.py` | `/api/v1` | 策略管理 + 策略评估 |
| `api/routers/knowledge.py` | `/api/v1/knowledge` | 知识库 CRUD + 搜索 + 飞书/语雀同步 |
| `api/routers/skill_catalog.py` | `/api/v1/skill-catalog` | Starter/Ecosystem 目录管理 |
| `api/routers/skill_market.py` | `/api/v1` | Skills 管理端：包上传、候选审核、Bundle 发布 |
| `api/routers/market.py` | `/api/v1/market` | Skills 员工端：浏览/下载 |
| `api/routers/assets.py` | `/api/v1/assets` | 资产提案/审核 |
| `api/routers/integrations.py` | `/api/v1/integrations` | OpenClaw 插件下载 |
| `api/routers/websocket.py` | `/ws` | WebSocket 连接 |

---

## 十三、前端组件（按区域）

### 布局与页面
| 文件 | 作用 |
|------|------|
| `frontend/src/components/TownLayout.tsx` | 竞技场布局：Phaser + 扫描线 + 事件跑马灯 |
| `frontend/src/components/LandingPage.tsx` | 企业门户首页 |
| `frontend/src/components/EnterpriseConsole.tsx` | 管理控制台（12 个 tab） |
| `frontend/src/components/ConsoleLoginPage.tsx` | 登录/注册/OIDC |

### 观察者面板
| 文件 | 作用 |
|------|------|
| `frontend/src/components/ObserverPanel.tsx` | 右侧栏：排行榜/调度/协作/智能体/墓园/EGL |
| `frontend/src/components/Leaderboard.tsx` | 军功值排名 + 健康条 |
| `frontend/src/components/ArenaControl.tsx` | 分发器控制 + 裁判评分卡片 |
| `frontend/src/components/SocialGraph.tsx` | 社交网络力导向图 |
| `frontend/src/components/AgentGraveyard.tsx` | 已淘汰 Agent 墓园 |
| `frontend/src/components/MetricsDashboard.tsx` | Recharts 折线图（FSR/Replans/UCR） |
| `frontend/src/components/EvolutionTimeline.tsx` | 多 Agent 进化时间线 |

### Agent 详情
| 文件 | 作用 |
|------|------|
| `frontend/src/components/AgentDetail.tsx` | Agent 详情面板（8 个 tab） |
| `frontend/src/components/agent/AgentHeader.tsx` | Agent 头部（余额编辑、统计） |
| `frontend/src/components/agent/ExecutionTab.tsx` | 任务执行记录 |
| `frontend/src/components/agent/DecisionList.tsx` | 决策卡片 |
| `frontend/src/components/agent/SkillTab.tsx` | 技能管理（流式修复） |
| `frontend/src/components/agent/EvolutionTab.tsx` | 进化指标 + 事件时间线 |
| `frontend/src/components/agent/PromptTab.tsx` | Prompt 编辑器 |
| `frontend/src/components/agent/PromptDiffView.tsx` | Prompt 差异查看器（LCS） |
| `frontend/src/components/agent/RuleTab.tsx` | 规则列表 |
| `frontend/src/components/agent/SoulTab.tsx` | Soul 文件编辑器 |
| `frontend/src/components/agent/CompactionTab.tsx` | 记忆压缩记录 |

### 网关管理
| 文件 | 作用 |
|------|------|
| `frontend/src/components/GatewayConsole.tsx` | 网关管理（4 个 tab：账户、上游模型、路由、试调） |
| `frontend/src/components/GatewayAccountsPanel.tsx` | 账户 + API Key 管理 |
| `frontend/src/components/GatewayUpstreamModelsPanel.tsx` | 上游模型注册 |
| `frontend/src/components/GatewayModelRoutesPanel.tsx` | 模型别名路由（支持配置 fallback_models、retry_policy、auto_policy） |
| `frontend/src/components/gateway/GatewayAdvancedPanel.tsx` | LiteLLM 健康状态 |
| `frontend/src/components/gateway/GatewayDrawer.tsx` | 滑出式抽屉组件 |
| `frontend/src/components/gateway/GatewayPlaygroundPanel.tsx` | 网关试调面板（在线测试 chat/completions + 查看重试轨迹） |

### 技能市场
| 文件 | 作用 |
|------|------|
| `frontend/src/components/SkillsConsole.tsx` | 管理端技能控制台（4 个 tab） |
| `frontend/src/components/market/SkillsMarketPage.tsx` | 公开技能市场 |
| `frontend/src/components/market/EmployeeConfigPanel.tsx` | 员工入职指南 |
| `frontend/src/components/market/EasyInstallWizard.tsx` | 快速安装向导 |

### 其他面板
| 文件 | 作用 |
|------|------|
| `frontend/src/components/AssetsPanel.tsx` | 资产审核队列 |
| `frontend/src/components/KnowledgePanel.tsx` | 知识库管理 + 搜索 |
| `frontend/src/components/PoliciesPanel.tsx` | 策略管理 |
| `frontend/src/components/DispatchPanel.tsx` | 任务分发管理 + 引擎队列 |
| `frontend/src/components/TaskHistoryPage.tsx` | 完整任务历史页 |
| `frontend/src/components/ChronicleBook.tsx` | 战报阅读器 |
| `frontend/src/components/EventTicker.tsx` | 底部事件跑马灯 |
| `frontend/src/components/ScanlineOverlay.tsx` | CRT 扫描线 + 暗角效果 |
| `frontend/src/components/ShareCard.tsx` | 分享卡片（Canvas 绘制） |
| `frontend/src/components/TaskInjectorBar.tsx` | 装饰性任务输入栏 |
| `frontend/src/components/PhaserTownCanvas.tsx` | Phaser 游戏容器 |

### UI 原语
| 文件 | 作用 |
|------|------|
| `frontend/src/components/ui/PixelBox.tsx` | FC 风格像素边框 |
| `frontend/src/components/ui/PixelMenu.tsx` | FC 风格像素菜单 |
| `frontend/src/components/AgentAvatarCanvas.tsx` | Agent 头像 Canvas 渲染 |
| `frontend/src/components/WarriorPortraitCanvas.tsx` | 武将肖像（已弃用） |

---

## 十四、前端状态管理

| 文件 | 作用 |
|------|------|
| `frontend/src/store/evotownStore.ts` | Zustand 主 store：Agent/Task/Evolution/Social/Dispatcher/Replay |
| `frontend/src/store/chronicleStore.ts` | 战报通知 store |
| `frontend/src/hooks/useWebSocket.ts` | WS 连接 + 消息处理 |
| `frontend/src/hooks/useAdminToken.ts` | 认证 + API 请求封装 |
| `frontend/src/hooks/useAgentSync.ts` | Agent 同步（5 层策略） |
| `frontend/src/hooks/useReplay.ts` | 录制回放控制 |

---

## 十五、Phaser 游戏引擎

| 文件 | 作用 |
|------|------|
| `frontend/src/phaser/config.ts` | Phaser 配置：640x448、像素艺术模式、3 个场景 |
| `frontend/src/phaser/events.ts` | 事件总线：React ↔ Phaser 桥接（18 种事件） |
| `frontend/src/phaser/BootScene.ts` | 启动场景（立即转 Preload） |
| `frontend/src/phaser/PreloadScene.ts` | 加载场景：注册纹理 + NES 风格加载条 |
| `frontend/src/phaser/TownScene.ts` | 主游戏场景：初始化所有系统、14 个事件监听 |
| `frontend/src/phaser/AgentManager.ts` | Agent 生命周期 + 移动（A* 路径、漫游） |
| `frontend/src/phaser/EventEffects.ts` | 事件视觉特效（进化/淘汰/救援/叛逃） |
| `frontend/src/phaser/TerrainRenderer.ts` | 办公室地板渲染 + UI（标题栏/字幕） |
| `frontend/src/phaser/taskNpc.ts` | 任务 NPC 系统（3 个上限） |
| `frontend/src/phaser/nesColors.ts` | NES 调色板（50+ 颜色） |
| `frontend/src/phaser/sceneAssets.ts` | 过程化纹理生成（建筑/植物/山/树） |
| `frontend/src/phaser/characterAssets.ts` | 16x16 像素角色精灵（吞食天地2 风格） |
| `frontend/src/phaser/agentAvatars.tsx` | 数字员工头像（13 种角色） |
| `frontend/src/phaser/warriorPortraits.ts` | 三国武将像素肖像（13 个） |
| `frontend/src/phaser/officeFloorPlan.ts` | 办公室布局定义（7 房间 + 寻路） |
| `frontend/src/phaser/index.ts` | 模块 re-exports |

---

## 十六、工具与辅助

| 文件 | 作用 |
|------|------|
| `backend/token_usage.py` | LLM Token 消耗统计（线程安全） |
| `backend/sqlite_reader.py` | SQLite + transcript 数据读取 |
| `backend/process_manager.py` | 子进程管理 |

---

## 十七、集成与部署

| 文件 | 作用 |
|------|------|
| `integrations/openclaw/evotown/index.js` | OpenClaw 插件：策略钩子注册（tool/fs/http） |
| `integrations/openclaw/evotown/openclaw.plugin.json` | OpenClaw 插件 manifest |
| `integrations/openclaw/evotown/skills/evotown-dispatch-complete/SKILL.md` | 任务完成上报技能 |
| `integrations/openclaw/evotown/skills/evotown-handoff/SKILL.md` | 跨引擎交接技能 |
| `scripts/evotown-agent-setup.py` | 员工端 agent 一站式管理 CLI |
| `scripts/policy_client.py` | 策略客户端（pull/evaluate/enforce） |
| `scripts/enterprise-deploy.sh` | IT 一键部署脚本 |
| `scripts/gateway-retry-smoke.sh` | Gateway 重试/降级快速验证脚本 |
| `scripts/mdm/install-evotown-agent-linux.sh` | MDM 批量部署（Linux） |
| `scripts/mdm/install-evotown-agent-macos.sh` | MDM 批量部署（macOS） |
| `scripts/package-openclaw-plugin.sh` | 插件打包脚本 |
| `Caddyfile` | 宿主机 Caddy 反向代理 |
| `nginx.conf` | 容器内 Nginx 配置 |
| `litellm.config.yaml` | LiteLLM 模型路由配置 |
| `seccomp-bwrap.json` | Docker seccomp 安全配置 |

---

## 十八、Arena 种子数据

| 文件 | 作用 |
|------|------|
| `backend/arena_prompts/` | 默认 Prompt 种子（rules.json、system.md、planning.md 等） |
| `backend/arena_skills/` | 默认技能种子（http-request、agent-browser、skill-creator、calculator、find-skills） |
| `backend/catalog/starter-skills.json` | Starter 技能目录 |
| `backend/catalog/ecosystem-skills.json` | 生态技能目录 |
| `backend/data/chronicle/` | 战报 JSON 文件 |

---

## 十九、测试

| 文件 | 作用 |
|------|------|
| `backend/tests/test_accounts.py` | 账户测试 |
| `backend/tests/test_agent_dispatch.py` | 调度测试 |
| `backend/tests/test_console_auth.py` | 控制台认证测试 |
| `backend/tests/test_engine_ingest_tokens.py` | 引擎 Ingest Token 测试 |
| `backend/tests/test_gateway_auth.py` | 网关认证测试 |
| `backend/tests/test_gateway_routes.py` | 网关路由测试 |
| `backend/tests/test_gateway_stream.py` | 网关流式响应测试 |
| `backend/tests/test_gateway_retry.py` | 网关重试/降级链单元测试 |
| `backend/tests/test_gateway_upstream_models.py` | 上游模型测试 |
| `backend/tests/test_integrations.py` | 集成测试 |
| `backend/tests/test_knowledge.py` | 知识库测试 |
| `backend/tests/test_market.py` | 技能市场测试 |
| `backend/tests/test_oidc.py` | OIDC 测试 |
| `backend/tests/test_p0_policy_assets.py` | P0 策略资产测试 |
| `backend/tests/test_policy_enforcement.py` | 策略执行测试 |
| `backend/tests/test_security.py` | 安全测试 |
| `backend/tests/test_skill_catalog.py` | 技能目录测试 |
| `backend/tests/test_skill_market.py` | 技能市场测试 |
| `backend/tests/test_skill_signing.py` | 技能签名测试 |

---

## 二十、文档

| 文件 | 作用 |
|------|------|
| `README.md` | 项目总览 |
| `zh-CN/README.md` | 中文 README |
| `en/README.md` | 英文 README |
| `docs/README.md` | 文档索引 |
| `docs/zh-CN/*.md` | 中文文档（快速启动、解决方案、部署等） |
| `docs/en/*.md` | 英文文档（产品规格、机制分析等） |
| `spec/README.md` | 规格索引 |
| `spec/*.md` | 产品/架构决策文档 |
| `tasks/README.md` | 任务记录规范 |
| `tasks/TASK-*/` | 具体任务执行记录 |
| `backend/LOG_ANALYSIS.md` | 日志分析指南 |
