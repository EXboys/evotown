"""WebSocket 消息类型定义 — 服务端广播与客户端请求"""
from typing import Any, Literal, TypedDict


# ── 服务端广播消息（Server → Client）────────────────────────────────────────────

class StateSnapshotAgent(TypedDict):
    agent_id: str
    display_name: str
    balance: int
    in_task: bool


class StateSnapshotMsg(TypedDict):
    type: Literal["state_snapshot"]
    agents: list[StateSnapshotAgent]


class SpriteMoveMsg(TypedDict):
    type: Literal["sprite_move"]
    agent_id: str
    to: str
    reason: str
    # 构建时 "from" 键单独传入（Python 保留字）


class TaskCompleteMsg(TypedDict, total=False):
    type: Literal["task_complete"]
    agent_id: str
    success: bool
    balance: int
    judge: dict[str, Any]
    task: str
    difficulty: str


class TaskDispatchedMsg(TypedDict):
    type: Literal["task_dispatched"]
    agent_id: str
    task: str


class TaskAvailableMsg(TypedDict):
    type: Literal["task_available"]
    task_id: str
    task: str
    difficulty: str
    created_at: str


class TaskTakenMsg(TypedDict):
    type: Literal["task_taken"]
    task_id: str
    agent_id: str
    task: str


class TaskExpiredMsg(TypedDict):
    type: Literal["task_expired"]
    task_id: str
    task: str


class AgentEliminatedMsg(TypedDict):
    type: Literal["agent_eliminated"]
    agent_id: str
    reason: str


class AgentCreatedMsg(TypedDict):
    type: Literal["agent_created"]
    agent_id: str
    display_name: str
    balance: int


class EvolutionEventMsg(TypedDict, total=False):
    type: Literal["evolution_event"]
    agent_id: str
    timestamp: str
    event_type: str
    target_id: str
    reason: str
    version: str


class PongMsg(TypedDict):
    type: Literal["pong"]
    ts: str


class TeamMemberInfo(TypedDict):
    agent_id: str
    display_name: str


class TeamInfo(TypedDict):
    team_id: str
    name: str
    members: list[TeamMemberInfo]


class TeamFormedMsg(TypedDict):
    """结阵事件：队伍分配完成，广播全量队伍信息"""
    type: Literal["team_formed"]
    teams: list[TeamInfo]


class RescueEventMsg(TypedDict):
    """救援事件：同队 agent 完成军功转移"""
    type: Literal["rescue_event"]
    donor_id: str
    donor_display_name: str
    target_id: str
    target_display_name: str
    amount: int
    donor_balance: int
    target_balance: int
    team_id: str
    team_name: str


class RescueNeededMsg(TypedDict):
    """危机预警：agent 军功值低于阈值，向同队广播救援请求"""
    type: Literal["rescue_needed"]
    agent_id: str
    display_name: str
    balance: int
    team_id: str
    team_name: str


class TeamReorganizedMsg(TypedDict):
    """社会重组事件：每 N 轮任务触发，弱队瓦解，强队缴税留存"""
    type: Literal["team_reorganized"]
    survived_teams: list[str]        # 存活队伍 team_id 列表
    dissolved_teams: list[str]       # 解散队伍 team_id 列表
    dissolved_team_names: list[str]  # 解散队伍名称（可读）
    refugees: list[str]              # 进入流民池的 agent_id 列表
    cost_stay: int                   # 强队每人扣除的维系军功
    global_task_count: int           # 触发重组时的全局任务累计数


class ChroniclePublishedMsg(TypedDict):
    """每日文言文战报发布事件"""
    type: Literal["chronicle_published"]
    date: str      # YYYY-MM-DD
    preview: str   # 战报前 200 字，供前端气泡展示


class AgentMessageMsg(TypedDict):
    """Agent 间通信事件 — 一条 agent 发给另一个 agent 的社会消息"""
    type: Literal["agent_message"]
    from_id: str
    from_name: str
    to_id: str
    to_name: str
    content: str         # 消息正文（文言文风格，20-80字）
    msg_type: str        # "greeting" | "challenge" | "alliance" | "strategy" | "chat"
    ts: str              # ISO 时间戳


class AgentDecisionMsg(TypedDict):
    """Agent 自主社会决策事件 — LLM 自主更新 solo_preference / evolution_focus"""
    type: Literal["agent_decision"]
    agent_id: str
    display_name: str
    solo_preference: bool
    evolution_focus: str          # 新的进化方向（空串=无偏好）
    prev_evolution_focus: str     # 旧的进化方向（空串=无偏好）
    reason: str                   # LLM 给出的决策理由（文言文风格，30-80字）
    ts: str


class AgentLastStandMsg(TypedDict):
    """最后一战事件 — agent 余额首次归零，获得一次复活机会"""
    type: Literal["agent_last_stand"]
    agent_id: str
    display_name: str
    balance: int   # 复活后的余额（固定值，如 30）


class SubtitleBroadcastMsg(TypedDict):
    """直播大字幕事件 — 高优先级文本广播，供前端显示醒目字幕"""
    type: Literal["subtitle_broadcast"]
    text: str    # 字幕内容（60字以内）
    level: str   # "info" | "last_stand" | "elimination" | "defection"


class AgentDefectedMsg(TypedDict):
    """叛逃事件 — agent 忠诚度崩溃，离队投奔更强队伍（或成为流民）"""
    type: Literal["agent_defected"]
    agent_id: str
    display_name: str
    old_team_id: str
    old_team_name: str
    new_team_id: str        # 空串表示成为流民
    new_team_name: str      # "流民" 或目标队伍名称


class TeamCreedGeneratedMsg(TypedDict):
    """军团宗旨生成事件 — LLM 为队伍生成文言文信条，全服广播"""
    type: Literal["team_creed_generated"]
    team_id: str
    team_name: str
    creed: str              # LLM 生成的文言文宗旨（20-40汉字）


# 服务端可广播的消息类型
WsOutgoingMsg = (
    StateSnapshotMsg
    | SpriteMoveMsg
    | TaskCompleteMsg
    | TaskDispatchedMsg
    | TaskAvailableMsg
    | TaskTakenMsg
    | TaskExpiredMsg
    | AgentEliminatedMsg
    | AgentCreatedMsg
    | EvolutionEventMsg
    | PongMsg
    | TeamFormedMsg
    | RescueEventMsg
    | RescueNeededMsg
    | TeamReorganizedMsg
    | ChroniclePublishedMsg
    | AgentMessageMsg
    | AgentDecisionMsg
    | AgentLastStandMsg
    | SubtitleBroadcastMsg
    | AgentDefectedMsg
    | TeamCreedGeneratedMsg
)


# ── 客户端请求消息（Client → Server）────────────────────────────────────────────

class PingMsg(TypedDict):
    type: Literal["ping"]


WsIncomingMsg = PingMsg
