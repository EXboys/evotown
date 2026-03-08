"""结阵（队伍）路由 — 组队分配、救援转账、自治偏好、社交图谱"""
import json
import logging
from collections import defaultdict
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core.auth import require_admin
from core.deps import arena, ws
from core.config import load_team_config
from domain.arena import EVOLUTION_FOCUS_OPTIONS

_SOCIAL_LOG_PATH = Path(__file__).parent.parent.parent / "social_log.jsonl"

logger = logging.getLogger("evotown.routers.teams")

router = APIRouter(prefix="/teams", tags=["teams"])


# ── 请求/响应模型 ─────────────────────────────────────────────────────────────

class AssignTeamsRequest(BaseModel):
    num_teams: int = Field(default=2, ge=2, description="队伍数量（最少 2 队）")


class AgentPreferenceRequest(BaseModel):
    solo_preference: Optional[bool] = Field(
        default=None,
        description="True = 主动选择自由人（不被强制入队）；False = 愿意入队",
    )
    evolution_focus: Optional[str] = Field(
        default=None,
        description=(
            f"进化方向偏好。合法值：{list(EVOLUTION_FOCUS_OPTIONS.keys())} 或空串（无偏好）"
        ),
    )


class RescueRequest(BaseModel):
    target_id: str = Field(..., description="被救 agent 的 ID")
    amount: int = Field(..., gt=0, description="转移的军功值（> 0）")


# ── 路由实现 ──────────────────────────────────────────────────────────────────

@router.post("/assign", dependencies=[Depends(require_admin)])
async def assign_teams(body: AssignTeamsRequest):
    """将当前所有活跃 agent 随机分成 num_teams 队（结阵）。

    硬约束：
    - num_teams >= 2
    - 活跃 agent 数 >= num_teams（每队至少 1 人）
    - 全员不能同队（num_teams >= 2 已保证）
    """
    try:
        teams = arena.assign_teams(body.num_teams)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # 构建 WS 广播用的 TeamInfo 列表
    teams_info = []
    for t in teams:
        members_info = []
        for aid in t.members:
            a = arena.get_agent(aid)
            members_info.append({
                "agent_id": aid,
                "display_name": a.display_name if a else aid,
            })
        teams_info.append({
            "team_id": t.team_id,
            "name": t.name,
            "members": members_info,
        })

    await ws.send_team_formed(teams_info)  # type: ignore[arg-type]
    logger.info("结阵完成：%d 队，成员分布 %s",
                len(teams), [len(t.members) for t in teams])

    # 后台为每支新队伍生成文言文军团宗旨（不阻塞响应）
    import asyncio as _asyncio
    async def _gen_creeds():
        from services.belief_engine import generate_team_creed
        for t in teams:
            members_info = [
                {"display_name": arena.get_agent(aid).display_name if arena.get_agent(aid) else aid,
                 "soul_type": (arena.get_agent(aid).soul_type if arena.get_agent(aid) else "")}
                for aid in t.members
            ]
            creed = await generate_team_creed(t, members_info)
            if creed:
                t.creed = creed
                try:
                    from core.deps import experiment_id
                    arena.persist(experiment_id or None)
                    await ws.send_team_creed_generated(
                        team_id=t.team_id,
                        team_name=t.name,
                        creed=creed,
                    )
                except Exception as _e:
                    pass
    _asyncio.create_task(_gen_creeds())

    return {"ok": True, "teams": [t.to_serializable() for t in teams]}


@router.get("")
async def list_teams():
    """查询当前所有队伍及成员信息"""
    teams = arena.list_teams()
    result = []
    for t in teams:
        members_info = []
        for aid in t.members:
            a = arena.get_agent(aid)
            members_info.append({
                "agent_id": aid,
                "display_name": a.display_name if a else aid,
                "balance": a.balance if a else 0,
                "in_task": a.in_task if a else False,
            })
        result.append({**t.to_serializable(), "members_detail": members_info})
    return {"teams": result, "total": len(result)}


@router.delete("", dependencies=[Depends(require_admin)])
async def dissolve_teams():
    """解散所有队伍，清空 agent.team_id"""
    arena.dissolve_teams()
    logger.info("所有队伍已解散")
    return {"ok": True, "message": "所有队伍已解散"}


@router.post("/agents/{agent_id}/rescue", dependencies=[Depends(require_admin)])
async def rescue_agent(agent_id: str, body: RescueRequest):
    """队内救援：agent_id（施救者）向 target_id（受救者）转移军功值。

    约束：
    - 双方必须在同一队伍
    - 转移量 > 0
    - 施救者余额 >= 转移量
    触发后广播 rescue_event；若受救者余额仍低于危机阈值则追加 rescue_needed。
    """
    ok, msg = arena.rescue_transfer(agent_id, body.target_id, body.amount)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)

    donor = arena.get_agent(agent_id)
    target = arena.get_agent(body.target_id)
    team = arena.get_agent_team(agent_id)

    # 持久化
    from core.deps import experiment_id
    arena.persist(experiment_id or None)

    # 信仰层：救援行为更新 loyalty
    try:
        from services.belief_engine import update_loyalty
        if donor:
            update_loyalty(donor, "rescue_given")
        if target:
            update_loyalty(target, "rescue_received")
    except Exception as _be:
        pass  # 信仰层失败不影响主流程

    # 广播救援事件
    await ws.send_rescue_event(
        donor_id=agent_id,
        donor_display_name=donor.display_name if donor else agent_id,
        target_id=body.target_id,
        target_display_name=target.display_name if target else body.target_id,
        amount=body.amount,
        donor_balance=donor.balance if donor else 0,
        target_balance=target.balance if target else 0,
        team_id=team.team_id if team else "",
        team_name=team.name if team else "",
    )

    # 危机预警：受救者余额仍偏低（< 30）时广播 rescue_needed
    RESCUE_THRESHOLD = 30
    if target and target.balance < RESCUE_THRESHOLD and team:
        await ws.send_rescue_needed(
            agent_id=body.target_id,
            display_name=target.display_name,
            balance=target.balance,
            team_id=team.team_id,
            team_name=team.name,
        )

    logger.info("[rescue] %s → %s 转移军功 %d；%s", agent_id, body.target_id, body.amount, msg)
    return {"ok": True, "message": msg,
            "donor_balance": donor.balance if donor else 0,
            "target_balance": target.balance if target else 0}


@router.post("/reorganize", dependencies=[Depends(require_admin)])
async def manual_reorganize():
    """手动触发一次社会重组（无需等定时器，便于测试）。

    规则同自动重组：弱队解散→流民池，强队扣维系成本，流民随机补入强队或重新组队。
    """
    teams = arena.list_teams()
    if not teams:
        raise HTTPException(status_code=400, detail="当前没有队伍，请先调用 /teams/assign 结阵")

    team_cfg = load_team_config()
    cost_stay = team_cfg["cost_stay"]
    max_team_ratio = team_cfg["max_team_ratio"]

    result = arena.reorganize_teams(cost_stay=cost_stay, max_team_ratio=max_team_ratio)

    # 持久化
    from core.deps import experiment_id
    arena.persist(experiment_id or None)

    global_count = arena.global_task_counter
    await ws.send_team_reorganized(
        survived_teams=result.survived_teams,
        dissolved_teams=result.dissolved_teams,
        dissolved_team_names=result.dissolved_team_names,
        refugees=result.refugees,
        cost_stay=result.cost_stay,
        global_task_count=global_count,
    )

    logger.info(
        "[reorganize/manual] 存活 %d 队，解散 %d 队（%s），流民 %d 人",
        len(result.survived_teams), len(result.dissolved_teams),
        "、".join(result.dissolved_team_names) or "无",
        len(result.refugees),
    )
    return {"ok": True, **result.to_dict(), "global_task_count": global_count}



class SendMessageRequest(BaseModel):
    from_id: str = Field(..., description="发送方 agent ID")
    to_id: str = Field(..., description="接收方 agent ID")
    msg_type: Optional[str] = Field(
        default=None,
        description="消息类型：greeting / challenge / alliance / strategy / chat（留空自动选）",
    )


@router.post("/messages/send", dependencies=[Depends(require_admin)])
async def send_agent_message(body: SendMessageRequest):
    """手动触发一条 agent 间 LLM 社交消息（管理员测试用）。
    会将消息投递到接收方邮箱，并广播 WS agent_message 事件。
    """
    from services.agent_comms import generate_and_deliver_message
    ok = await generate_and_deliver_message(arena, ws, body.from_id, body.to_id, msg_type=body.msg_type)
    if not ok:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="消息发送失败：agent 不存在或 LLM 调用失败")
    return {"ok": True}


@router.get("/agents/{agent_id}/mailbox")
async def get_agent_mailbox(agent_id: str):
    """查看 agent 邮箱中的待读消息（只读，不消费）。"""
    a = arena.get_agent(agent_id)
    if a is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")
    msgs = arena.peek_agent_messages(agent_id)
    return {"agent_id": agent_id, "messages": msgs, "count": len(msgs)}


@router.post("/agents/{agent_id}/decision", dependencies=[Depends(require_admin)])
async def trigger_social_decision(agent_id: str):
    """手动触发 agent 的自主社会决策（LLM 更新 solo_preference / evolution_focus）。"""
    from services.social_decision import run_social_decision
    ok = await run_social_decision(arena, ws, agent_id)
    if not ok:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="决策失败：agent 不存在或 LLM 调用失败")
    a = arena.get_agent(agent_id)
    return {
        "ok": True,
        "agent_id": agent_id,
        "solo_preference": a.solo_preference if a else None,
        "evolution_focus": a.evolution_focus if a else None,
    }


@router.patch("/agents/{agent_id}/preference", dependencies=[Depends(require_admin)])
async def set_agent_preference(agent_id: str, body: AgentPreferenceRequest):
    """设置 agent 的自治偏好：solo_preference（自由人模式）和 evolution_focus（进化方向）。

    - `solo_preference=true`  → 下次结阵/重组时该 agent 不会被强制入队
    - `solo_preference=false` → 恢复普通入队资格
    - `evolution_focus`       → 设置进化方向（biases LLM prompt），空串清除偏好

    合法的 evolution_focus 值：
    """ + "\n    ".join(f"- `{k}`: {v}" for k, v in EVOLUTION_FOCUS_OPTIONS.items()) + """
    """
    a = arena.get_agent(agent_id)
    if a is None:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")

    changed: dict = {}

    if body.solo_preference is not None:
        a.solo_preference = body.solo_preference
        changed["solo_preference"] = a.solo_preference
        # 若切回普通模式且当前在队伍里，不做额外操作（下次结阵自然参与）
        # 若切为 solo 且当前在队伍里，也不强制退队（保留当前队伍直到下次重组）
        logger.info(
            "[%s] solo_preference → %s", agent_id, a.solo_preference
        )

    if body.evolution_focus is not None:
        focus = body.evolution_focus.strip()
        if focus and focus not in EVOLUTION_FOCUS_OPTIONS:
            raise HTTPException(
                status_code=400,
                detail=f"无效的 evolution_focus '{focus}'，合法值：{list(EVOLUTION_FOCUS_OPTIONS.keys())}",
            )
        a.evolution_focus = focus
        changed["evolution_focus"] = a.evolution_focus
        logger.info("[%s] evolution_focus → '%s'", agent_id, a.evolution_focus)

    if not changed:
        raise HTTPException(status_code=400, detail="请至少提供 solo_preference 或 evolution_focus 其中一个字段")

    # 持久化
    from core.deps import experiment_id
    arena.persist(experiment_id or None)

    return {
        "ok": True,
        "agent_id": agent_id,
        "display_name": a.display_name,
        "solo_preference": a.solo_preference,
        "evolution_focus": a.evolution_focus,
        "evolution_focus_desc": EVOLUTION_FOCUS_OPTIONS.get(a.evolution_focus, "无偏好"),
        "changed": changed,
    }


@router.get("/social/graph")
async def get_social_graph(limit: int = 500):
    """社交图谱：聚合 social_log.jsonl，返回节点（agent）和边（通信权重）。

    返回格式：
    {
      "nodes": [{"id": str, "name": str, "team_id": str|null, "team_name": str|null}],
      "edges": [{"source": str, "target": str, "weight": int, "types": {msg_type: count}}]
    }
    """
    if not _SOCIAL_LOG_PATH.exists():
        return {"nodes": [], "edges": []}

    agent_names: dict[str, str] = {}
    edge_weights: dict[tuple[str, str], int] = defaultdict(int)
    edge_types: dict[tuple[str, str], dict[str, int]] = defaultdict(lambda: defaultdict(int))

    try:
        with open(_SOCIAL_LOG_PATH, "r", encoding="utf-8") as f:
            lines = f.readlines()
        # 只取最近 limit 条
        for line in lines[-limit:]:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
                fid = r.get("from_id", "")
                tid = r.get("to_id", "")
                fname = r.get("from_name", fid)
                tname = r.get("to_name", tid)
                mtype = r.get("msg_type", "chat")
                if not fid or not tid:
                    continue
                agent_names[fid] = fname
                agent_names[tid] = tname
                key = (fid, tid)
                edge_weights[key] += 1
                edge_types[key][mtype] += 1
            except (json.JSONDecodeError, KeyError):
                continue
    except OSError as e:
        logger.warning("Failed to read social log for graph: %s", e)
        return {"nodes": [], "edges": []}

    # 查询当前队伍归属
    team_map: dict[str, tuple[str, str]] = {}  # agent_id -> (team_id, team_name)
    for team in arena.list_teams():
        for aid in team.members:
            team_map[aid] = (team.team_id, team.name)

    nodes = []
    for aid, name in agent_names.items():
        tid, tname = team_map.get(aid, (None, None))
        nodes.append({"id": aid, "name": name, "team_id": tid, "team_name": tname})

    edges = []
    for (src, tgt), weight in edge_weights.items():
        edges.append({
            "source": src,
            "target": tgt,
            "weight": weight,
            "types": dict(edge_types[(src, tgt)]),
        })

    return {"nodes": nodes, "edges": edges}
