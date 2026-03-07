"""竞技场内存状态"""
from __future__ import annotations

import random
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from infra.persistence import load_state as load_persisted, save_state as save_persisted

# 待办任务元数据：task, difficulty, task_id
PendingTaskMeta = dict[str, Any]

# Agent 展示名字池（三国武将名，与前端 warriorPortraits.ts 匹配）
_AGENT_NAME_POOL: list[str] = [
    "诸葛孔明", "赵子龙", "司马仲达", "周公瑾",
    "关云长",   "张翼德", "刘玄德",   "曹孟德",
    "孙仲谋",   "张文远", "郭奉孝",   "黄公覆",
    "鲁子敬",
]

# 进化方向选项（evolution_focus 合法值，空串 = 无偏好）
EVOLUTION_FOCUS_OPTIONS: dict[str, str] = {
    "scholar":   "学者 — prefers research, knowledge-retrieval and analysis tasks",
    "warrior":   "武者 — prefers hard/combat tasks with high risk and high reward",
    "craftsman": "工匠 — prefers skill-building, refinement and quality tasks",
    "diplomat":  "外交官 — prefers coordination, social and team-synergy tasks",
    "explorer":  "探险家 — prefers novel, unknown and boundary-pushing tasks",
}

# 三国阵营名字池（结阵用）
_TEAM_NAME_POOL: list[str] = [
    "蜀汉联盟", "曹魏阵营", "东吴水军", "汉室遗风",
    "西凉铁骑", "荆州义军", "并州狼骑", "江东虎卫",
]


@dataclass
class ReorganizeResult:
    """重组事件的结构化结果"""
    survived_teams: list[str]        # 存活队伍的 team_id
    dissolved_teams: list[str]       # 解散队伍的 team_id
    dissolved_team_names: list[str]  # 解散队伍的名称（用于日志/广播）
    refugees: list[str]              # 进入流民池的 agent_id
    cost_stay: int                   # 每名强队成员扣除的维系成本

    def to_dict(self) -> dict[str, Any]:
        return {
            "survived_teams": self.survived_teams,
            "dissolved_teams": self.dissolved_teams,
            "dissolved_team_names": self.dissolved_team_names,
            "refugees": self.refugees,
            "cost_stay": self.cost_stay,
        }


@dataclass
class TeamRecord:
    """结阵：一支三国队伍的内存记录"""
    team_id: str
    name: str                        # 三国队伍名，如「蜀汉联盟」
    members: list[str]               # agent_id 列表
    shared_skills: list[str] = field(default_factory=list)  # 共享技能池
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def to_serializable(self) -> dict[str, Any]:
        return {
            "team_id": self.team_id,
            "name": self.name,
            "members": list(self.members),
            "shared_skills": list(self.shared_skills),
            "created_at": self.created_at,
        }


class AgentRecord:
    """单个 Agent 的内存记录"""

    __slots__ = (
        "agent_id", "display_name", "agent_home", "chat_dir",
        "balance", "status", "in_task", "soul_type", "_observer",
        # 结阵字段
        "team_id", "rescue_given", "rescue_received",
        # 自治与多样性字段
        "solo_preference",   # True = 主动选择不加入队伍（自由人）
        "evolution_focus",   # 期望进化方向，空串 = 无偏好，可选值见 EVOLUTION_FOCUS_OPTIONS
    )

    def __init__(
        self,
        agent_id: str,
        agent_home: str,
        chat_dir: str,
        balance: int = 100,
        status: str = "active",
        in_task: bool = False,
        soul_type: str = "balanced",
        observer: Any = None,
        display_name: str = "",
        team_id: Optional[str] = None,
        rescue_given: int = 0,
        rescue_received: int = 0,
        solo_preference: bool = False,
        evolution_focus: str = "",
    ) -> None:
        self.agent_id = agent_id
        self.display_name = display_name or agent_id
        self.agent_home = agent_home
        self.chat_dir = chat_dir
        self.balance = balance
        self.status = status
        self.in_task = in_task
        self.soul_type = soul_type
        self._observer = observer
        self.team_id = team_id
        self.rescue_given = rescue_given
        self.rescue_received = rescue_received
        self.solo_preference = solo_preference
        self.evolution_focus = evolution_focus

    def to_serializable(self) -> dict[str, Any]:
        return {
            "id": self.agent_id,
            "display_name": self.display_name,
            "balance": self.balance,
            "status": self.status,
            "soul_type": self.soul_type,
            "team_id": self.team_id,
            "rescue_given": self.rescue_given,
            "rescue_received": self.rescue_received,
            "solo_preference": self.solo_preference,
            "evolution_focus": self.evolution_focus,
        }


class ArenaState:
    """竞技场内存状态"""

    def __init__(self) -> None:
        self._agents: dict[str, AgentRecord] = {}
        self._agent_counter = 0
        self._task_counter = 0
        self._global_task_counter = 0   # 全局任务完成计数（用于触发定时重组）
        self._pending_tasks: dict[str, PendingTaskMeta] = {}
        self._agent_task_count: dict[str, int] = {}
        self._last_evolve_at: dict[str, int] = {}
        self._agent_difficulty_count: dict[str, dict[str, int]] = {}  # agent_id -> {easy:N, medium:N, hard:N}
        self._used_names: set[str] = set()
        self._teams: dict[str, TeamRecord] = {}          # team_id → TeamRecord
        self._used_team_names: set[str] = set()

    def assign_display_name(self) -> str:
        """从名字池随机分配一个未被使用的展示名（池用尽后加数字后缀）"""
        available = [n for n in _AGENT_NAME_POOL if n not in self._used_names]
        if available:
            name = random.choice(available)
        else:
            # 全部用完，加数字后缀
            i = 1
            while True:
                name = f"{random.choice(_AGENT_NAME_POOL)}{i}"
                if name not in self._used_names:
                    break
                i += 1
        self._used_names.add(name)
        return name

    def release_display_name(self, name: str) -> None:
        """Agent 退场时归还名字"""
        self._used_names.discard(name)

    @property
    def agent_counter(self) -> int:
        return self._agent_counter

    @property
    def agents(self) -> dict[str, AgentRecord]:
        return self._agents

    def next_agent_id(self) -> str:
        self._agent_counter += 1
        return f"agent_{self._agent_counter}"

    def add_agent(self, record: AgentRecord) -> None:
        self._agents[record.agent_id] = record
        # 确保名字被标记为已使用（恢复状态时也需要注册）
        if record.display_name:
            self._used_names.add(record.display_name)

    def remove_agent(self, agent_id: str) -> Optional[AgentRecord]:
        rec = self._agents.pop(agent_id, None)
        if rec:
            self.release_display_name(rec.display_name)
        return rec

    def get_agent(self, agent_id: str) -> Optional[AgentRecord]:
        return self._agents.get(agent_id)

    def has_agent(self, agent_id: str) -> bool:
        return agent_id in self._agents

    def add_balance(self, agent_id: str, delta: int, default: int = 100) -> None:
        if a := self._agents.get(agent_id):
            a.balance = a.balance + delta

    def set_in_task(self, agent_id: str, in_task: bool) -> None:
        if a := self._agents.get(agent_id):
            a.in_task = in_task

    def next_task_id(self) -> str:
        self._task_counter += 1
        return f"task_{self._task_counter}"

    def set_pending_task(
        self,
        agent_id: str,
        task: str,
        difficulty: str = "medium",
        task_id: str | None = None,
    ) -> None:
        tid = task_id or self.next_task_id()
        self._pending_tasks[agent_id] = {"task": task, "difficulty": difficulty, "task_id": tid}

    def record_task_difficulty(self, agent_id: str, difficulty: str) -> None:
        """任务完成后记录难度，用于均衡分发"""
        counts = self._agent_difficulty_count.setdefault(agent_id, {"easy": 0, "medium": 0, "hard": 0})
        counts[difficulty] = counts.get(difficulty, 0) + 1

    def pop_pending_task(self, agent_id: str) -> PendingTaskMeta | None:
        meta = self._pending_tasks.pop(agent_id, None)
        if meta and isinstance(meta, dict):
            return meta
        if isinstance(meta, str):
            return {"task": meta, "difficulty": "medium", "task_id": ""}
        return None

    def inc_task_count(self, agent_id: str) -> int:
        self._agent_task_count[agent_id] = self._agent_task_count.get(agent_id, 0) + 1
        return self._agent_task_count[agent_id]

    def get_last_evolve_at(self, agent_id: str) -> int:
        return self._last_evolve_at.get(agent_id, 0)

    def set_last_evolve_at(self, agent_id: str, count: int) -> None:
        self._last_evolve_at[agent_id] = count

    def get_idle_agent_ids(self) -> list[str]:
        return [aid for aid, a in self._agents.items() if a.status == "active" and not a.in_task]

    def get_agent_difficulty_counts(self, agent_id: str) -> dict[str, int]:
        """返回该 agent 各难度已执行任务数，用于均衡分发"""
        return dict(self._agent_difficulty_count.get(agent_id, {"easy": 0, "medium": 0, "hard": 0}))

    def restore_counter(self, counter: int) -> None:
        self._agent_counter = counter

    def restore_task_counter(self, counter: int) -> None:
        self._task_counter = counter

    def restore_global_task_counter(self, counter: int) -> None:
        self._global_task_counter = counter

    def restore_teams(self, teams_data: list[dict[str, Any]]) -> None:
        """从持久化数据恢复队伍结构。

        teams_data 格式：[{"team_id": ..., "name": ..., "members": [...], ...}]
        同时根据 members 将 agent.team_id 写回内存（需在 add_agent 之后调用）。
        """
        for t in teams_data:
            tid = t.get("team_id")
            name = t.get("name", "")
            members = t.get("members", [])
            if not tid or not name:
                continue
            # 只恢复成员仍在 arena 中的队伍
            valid_members = [m for m in members if m in self._agents]
            if not valid_members:
                continue
            team = TeamRecord(
                team_id=tid,
                name=name,
                members=valid_members,
                shared_skills=t.get("shared_skills", []),
                created_at=t.get("created_at", datetime.now(timezone.utc).isoformat()),
            )
            self._teams[tid] = team
            self._used_team_names.add(name)
            # 写回 agent.team_id
            for aid in valid_members:
                a = self._agents.get(aid)
                if a:
                    a.team_id = tid

    # ── 结阵：队伍管理 ─────────────────────────────────────────────────────────

    def _pick_team_name(self) -> str:
        available = [n for n in _TEAM_NAME_POOL if n not in self._used_team_names]
        if available:
            name = random.choice(available)
        else:
            i = 1
            while True:
                name = f"{random.choice(_TEAM_NAME_POOL)}{i}"
                if name not in self._used_team_names:
                    break
                i += 1
        self._used_team_names.add(name)
        return name

    def assign_teams(self, num_teams: int = 2) -> list[TeamRecord]:
        """将愿意入队的活跃 agent 按多样性原则分配到 num_teams 支队伍。

        硬约束：
        - num_teams >= 2（至少 2 队对抗）
        - 有入队意愿的 agent 数 >= num_teams（否则无法均分）
        - solo_preference=True 的 agent 保持自由人状态，不强制入队

        多样性策略：
        - 按 soul_type 分桶，轮转填入各队，使同一 soul_type 尽量分散
        - 剩余 agent 随机填充
        """
        # 仅挑选愿意入队的活跃 agent
        willing = [
            a for a in self._agents.values()
            if a.status == "active" and not a.solo_preference
        ]
        solo_agents = [
            a for a in self._agents.values()
            if a.status == "active" and a.solo_preference
        ]

        if num_teams < 2:
            raise ValueError("num_teams 必须 >= 2（至少 2 队对抗）")
        if len(willing) < num_teams:
            raise ValueError(
                f"愿意入队的活跃 agent 数 ({len(willing)}) 不足以分成 {num_teams} 队；"
                f"共 {len(solo_agents)} 人选择了自由人状态"
            )

        # 解散旧阵（solo agent 的 team_id 也一并清空）
        self.dissolve_teams()

        # ── 多样性排列：按 soul_type 分桶后轮转，使类型尽量分散 ──────────────
        buckets: dict[str, list] = {}
        for a in willing:
            buckets.setdefault(a.soul_type, []).append(a)
        for v in buckets.values():
            random.shuffle(v)

        # 将各桶按轮转顺序合并 → 同类型尽量不相邻
        diversity_sorted: list = []
        bucket_lists = list(buckets.values())
        random.shuffle(bucket_lists)   # 桶间顺序随机
        while any(bucket_lists):
            for bl in bucket_lists:
                if bl:
                    diversity_sorted.append(bl.pop())
            bucket_lists = [bl for bl in bucket_lists if bl]

        # 创建队伍后轮转填入
        teams: list[TeamRecord] = []
        for _ in range(num_teams):
            tid = str(uuid.uuid4())[:8]
            name = self._pick_team_name()
            teams.append(TeamRecord(team_id=tid, name=name, members=[]))

        for idx, agent in enumerate(diversity_sorted):
            team = teams[idx % num_teams]
            team.members.append(agent.agent_id)
            agent.team_id = team.team_id

        for team in teams:
            self._teams[team.team_id] = team

        return teams

    def list_teams(self) -> list[TeamRecord]:
        return list(self._teams.values())

    def get_team(self, team_id: str) -> Optional[TeamRecord]:
        return self._teams.get(team_id)

    def get_agent_team(self, agent_id: str) -> Optional[TeamRecord]:
        a = self._agents.get(agent_id)
        if a and a.team_id:
            return self._teams.get(a.team_id)
        return None

    def dissolve_teams(self) -> None:
        """解散所有队伍，清空 agent.team_id"""
        for a in self._agents.values():
            a.team_id = None
        self._teams.clear()
        self._used_team_names.clear()

    def get_team_context(self, agent_id: str) -> dict[str, Any] | None:
        """返回指定 agent 的队伍社会状态，供注入 system prompt。

        返回 None 表示当前无队伍（流民状态）。
        返回字段：
          team_name   : str          — 队伍三国名称
          teammates   : list[(str,int)] — [(display_name, balance), ...]，不含自己
          team_avg    : float        — 本队平均军功
          team_rank   : int          — 本队排名（1=最强，按均值降序）
          total_teams : int          — 场上总队数
          global_avg  : float        — 全场平均军功
          is_strong   : bool         — 本队均值 >= 全场均值（强队=True，弱队=False）
        """
        a = self._agents.get(agent_id)
        if not a or not a.team_id:
            return None
        team = self._teams.get(a.team_id)
        if not team:
            return None

        # 队友信息（排除自己，按军功降序）
        teammates: list[tuple[str, int]] = []
        for mid in team.members:
            if mid == agent_id:
                continue
            m = self._agents.get(mid)
            if m:
                teammates.append((m.display_name or mid, m.balance))
        teammates.sort(key=lambda x: x[1], reverse=True)

        # 本队均值
        all_members = [self._agents[mid] for mid in team.members if mid in self._agents]
        team_avg = sum(m.balance for m in all_members) / max(len(all_members), 1)

        # 全场均值
        active = [ag for ag in self._agents.values() if ag.status == "active"]
        global_avg = sum(ag.balance for ag in active) / max(len(active), 1) if active else 0.0

        # 各队按均值排名
        team_avgs: list[tuple[str, float]] = []
        for t in self._teams.values():
            ms = [self._agents[mid] for mid in t.members if mid in self._agents]
            if ms:
                team_avgs.append((t.team_id, sum(m.balance for m in ms) / len(ms)))
        team_avgs.sort(key=lambda x: x[1], reverse=True)
        rank = next(
            (i + 1 for i, (tid, _) in enumerate(team_avgs) if tid == team.team_id),
            len(team_avgs),
        )

        return {
            "team_name": team.name,
            "teammates": teammates,
            "team_avg": round(team_avg, 1),
            "team_rank": rank,
            "total_teams": len(self._teams),
            "global_avg": round(global_avg, 1),
            "is_strong": team_avg >= global_avg,
            "shared_skills": list(team.shared_skills),
        }

    # ── 技能共享 ──────────────────────────────────────────────────────────────────

    _MAX_SHARED_SKILLS = 20
    _SKILL_IGNORE: frozenset[str] = frozenset({"update_task_plan"})

    def add_team_skill(self, agent_id: str, tool_names: list[str]) -> None:
        """将成功工具名写入所属队伍的共享技能池（去重，保留最近 20 条）。"""
        a = self._agents.get(agent_id)
        if not a or not a.team_id:
            return
        team = self._teams.get(a.team_id)
        if not team:
            return
        for name in tool_names:
            if name in self._SKILL_IGNORE:
                continue
            if name not in team.shared_skills:
                team.shared_skills.append(name)
        if len(team.shared_skills) > self._MAX_SHARED_SKILLS:
            team.shared_skills = team.shared_skills[-self._MAX_SHARED_SKILLS:]

    def inc_global_task_count(self) -> int:
        """全局任务计数 +1，返回最新值。每次任务完成后调用。"""
        self._global_task_counter += 1
        return self._global_task_counter

    @property
    def global_task_counter(self) -> int:
        return self._global_task_counter

    def reorganize_teams(
        self,
        cost_stay: int = 10,
        max_team_ratio: float = 0.4,
    ) -> ReorganizeResult:
        """人类社会进化模型：弱队自然瓦解，强队缴税留队。

        流程：
        1. 计算各队平均军功 vs 全场平均军功
        2. 弱队（均值 < 全场均值）解散 → 成员进流民池
        3. 强队（均值 >= 全场均值）扣每人 cost_stay 维持费，保留原阵
        4. 防垄断：强队成员数 > 总 agent * max_team_ratio 时强制流放超员部分
        5. 流民随机补入强队（每队最多补 1 人）或重新组成新队
        """
        active_agents = [a for a in self._agents.values() if a.status == "active"]
        if not active_agents:
            return ReorganizeResult([], [], [], [], cost_stay)

        teams = list(self._teams.values())
        if not teams:
            return ReorganizeResult([], [], [], [], cost_stay)

        # ── 1. 计算全场均值 ─────────────────────────────────────────────────
        total_balance = sum(a.balance for a in active_agents)
        global_avg = total_balance / len(active_agents)

        # ── 2. 按队伍平均军功分为强/弱 ───────────────────────────────────────
        survived_teams: list[TeamRecord] = []
        dissolved_teams: list[TeamRecord] = []
        for team in teams:
            members = [self._agents[aid] for aid in team.members if aid in self._agents]
            if not members:
                dissolved_teams.append(team)
                continue
            avg = sum(m.balance for m in members) / len(members)
            if avg >= global_avg:
                survived_teams.append(team)
            else:
                dissolved_teams.append(team)

        # ── 3. 解散弱队，成员入流民池（solo agent 直接恢复自由状态，不入流民池）──
        refugees: list[str] = []          # 真正需要重新安置的流民（非 solo）
        dissolved_ids = [t.team_id for t in dissolved_teams]
        dissolved_names = [t.name for t in dissolved_teams]
        for team in dissolved_teams:
            for aid in list(team.members):
                a = self._agents.get(aid)
                if a:
                    a.team_id = None
                    if not a.solo_preference:   # solo agent 不进流民池
                        refugees.append(aid)
            self._used_team_names.discard(team.name)
            del self._teams[team.team_id]

        # ── 4. 强队扣维系成本 & 防垄断流放 ────────────────────────────────────
        total_count = len(active_agents)
        max_size = max(1, int(total_count * max_team_ratio))
        for team in survived_teams:
            members = [self._agents[aid] for aid in team.members if aid in self._agents]
            # 防垄断：超员部分强制流放（末位军功者先出；solo agent 不流放）
            if len(members) > max_size:
                members.sort(key=lambda a: a.balance)
                excess = members[: len(members) - max_size]
                for a in excess:
                    a.team_id = None
                    team.members.remove(a.agent_id)
                    if not a.solo_preference:
                        refugees.append(a.agent_id)
                members = members[len(excess):]
            # 扣维系成本
            for a in members:
                a.balance = max(0, a.balance - cost_stay)

        # ── 5. 流民重新分配（仅分配非 solo 的流民）────────────────────────────
        willing_refugees = [
            aid for aid in refugees
            if not (self._agents.get(aid) and self._agents[aid].solo_preference)
        ]
        random.shuffle(willing_refugees)
        remaining_refugees: list[str] = list(willing_refugees)

        # 优先补入现有强队（每队最多 +1 人）
        for team in survived_teams:
            if not remaining_refugees:
                break
            recruit_id = remaining_refugees.pop(0)
            team.members.append(recruit_id)
            a = self._agents.get(recruit_id)
            if a:
                a.team_id = team.team_id

        # 剩余愿意入队的流民重新随机分成若干小队（≥2 人；单人保持无队状态）
        if len(remaining_refugees) >= 2:
            random.shuffle(remaining_refugees)
            num_new = max(2, len(remaining_refugees) // 3)
            new_teams: list[TeamRecord] = []
            for _ in range(num_new):
                tid = str(uuid.uuid4())[:8]
                name = self._pick_team_name()
                new_teams.append(TeamRecord(team_id=tid, name=name, members=[]))
            for idx, aid in enumerate(remaining_refugees):
                team = new_teams[idx % num_new]
                team.members.append(aid)
                a = self._agents.get(aid)
                if a:
                    a.team_id = team.team_id
            for t in new_teams:
                self._teams[t.team_id] = t

        survived_ids = [t.team_id for t in survived_teams]
        return ReorganizeResult(
            survived_teams=survived_ids,
            dissolved_teams=dissolved_ids,
            dissolved_team_names=dissolved_names,
            refugees=refugees,
            cost_stay=cost_stay,
        )

    def rescue_transfer(
        self, donor_id: str, target_id: str, amount: int
    ) -> tuple[bool, str]:
        """队内救援：donor 向 target 转移军功值。

        硬约束：
        - 双方必须同队
        - 转移数量 > 0
        - donor 余额必须 >= amount（转后 donor 不会归零但会减少）
        返回 (ok, message)。
        """
        if amount <= 0:
            return False, "转移数量必须 > 0"

        donor = self._agents.get(donor_id)
        target = self._agents.get(target_id)
        if not donor:
            return False, f"donor {donor_id} 不存在"
        if not target:
            return False, f"target {target_id} 不存在"

        if not donor.team_id or donor.team_id != target.team_id:
            return False, "救援仅限同队 agent 之间（跨队转账为非法操作）"
        if donor.balance < amount:
            return False, f"donor 军功不足（现有 {donor.balance}，请求转 {amount}）"

        donor.balance -= amount
        target.balance += amount
        donor.rescue_given += amount
        target.rescue_received += amount
        return True, f"{donor_id} → {target_id} 转移军功 {amount}"

    def persist(self, experiment_id: str | None = None) -> None:
        agents_payload = [a.to_serializable() for a in self._agents.values()]
        teams_payload = [t.to_serializable() for t in self._teams.values()]
        save_persisted(
            self._agent_counter,
            agents_payload,
            experiment_id=experiment_id,
            task_counter=self._task_counter,
            global_task_counter=self._global_task_counter,
            teams=teams_payload,
        )
