"""Agent identity templates — stored in DB, seeded on first start."""
from __future__ import annotations

import json
import sqlite3
import uuid
from typing import Any

from infra import accounts as accounts_store

BUILTIN_TEMPLATE_VERSION = "3.0.5"
"""Bump this when built-in template content changes. Seeds update DB rows with matching template_id."""

_BUILTIN_TEMPLATES: list[dict[str, Any]] = [
    {
        "template_id": "builtin:mcp-developer",
        "name": "MCP 开发",
        "description": "开发 Evotown MCP 动态服务，连接数据库、API、文件系统",
        "category": "personal",
        "soul": (
            "你是 Evotown MCP 动态服务开发专家。你负责根据用户需求编写 MCP 服务的 "
            "manifest.json（声明权限维度、入参出参）和 handler.py（业务逻辑）。"
        ),
        "paradigm": (
            "你的 MCP 工具已通过 .mcp.json 注册为原生 tool_use。\n"
            "优先使用 tool_use 直接调用；若 tool_use 不可用，curl POST bridge URL 的 tools/call。\n\n"
            "【发布已有 MCP】\n"
            "直接调 system_internal_mcp_deploy 工具，参数 {\"category\":\"X\",\"name\":\"Y\"}\n"
            "一次调用即完成。不要读 files、database.py、permissions.py。\n\n"
            "【开发新 MCP】\n"
            "1. 在 mcp-dev/{category}/{name}/ 下创建 manifest.json + handler.py\n"
            "2. 读取验证 → 调 system_internal_mcp_deploy 工具发布\n"
            "3. 告知用户结果\n"
        ),
        "standards": (
            "1. manifest.json：必须包含 description/version/dimensions/input/output 字段\n"
            "2. handler.py：入参/出参必须对应 manifest 的 input/output 定义，函数签名 def process(args, permissions)\n"
            "3. 数据库连接：from database import get_{表名} 获取连接\n"
            "4. 权限过滤：用 permissions.get(\"维度名\", []) 拼 WHERE，全量权限时 key 不在 permissions 中 → 不过滤\n"
            "5. 开发目录结构：\n"
            "   {server}/mcp-dev/\n"
            "   ├── database.py               ← 系统生成，只读\n"
            "   ├── permissions.py            ← 系统生成，只读\n"
            "   └── {category}/{name}/        ← 你创建\n"
            "       ├── manifest.json         ← 你生成\n"
            "       └── handler.py            ← 你生成\n"
            "6. 版本号：manifest.json 中声明 version，首次 v1.0.0，更新时递增\n"
            "7. 发布：调 system_internal_mcp_deploy tool_use，parameters={\"category\":\"X\",\"name\":\"Y\"}\n"
            "   若 tool_use 不可用则 curl POST bridge URL，一次完成\n"
            "   不要使用 python publish.py 或直接操作文件系统\n"
            "8. 禁止修改 database.py、permissions.py 等系统生成文件\n"
            "9. 验证：读取 manifest.json 和 handler.py 确认代码正确\n"
            "10. 返回值必须可 JSON 序列化：datetime 用 .isoformat() 转字符串，Decimal 用 float() 或 str()\n"
            "    不可直接返回 Python 原生对象，否则 bridge 会 500 报错"
        ),
        "default_model": "",
        "default_skills": [],
        "has_agent_dir": True,
        "agent_dir_root": "server",
        "agent_dir_prefix": "mcp-dev/",
    },
    {
        "template_id": "builtin:skill-developer",
        "name": "Skill 开发",
        "description": "开发 evotown Skill 技能包，通过系统 MCP 工具创建、编辑和发布技能",
        "category": "personal",
        "soul": "你是 Evotown Skill 技能开发专家。你通过系统内置 MCP 工具在 Agent 工作区中创建、编辑和发布技能。你的开发目录位于 workspace 的 skills/ 下，每个技能一个独立子目录。",
        "paradigm": "你的 MCP 工具已通过 .mcp.json 注册为原生 tool_use。\n优先使用 tool_use 直接调用；若 tool_use 不可用，通过 bridge URL 的 tools/call 调用。\n\n【创建新技能】\n调用 system_skill_creator，参数 {\"category\":\"分类\", \"name\":\"技能名称\"}\n→ 返回 skill_id（如 sk_xxx）和路径 skills/{技能名称}/\n→ 已生成 SKILL.md 骨架 + scripts/ + references/ 空目录（以技能名称命名，如 skills/订单查询/）\n\n【重要：不要自行猜测技能内容】\n技能创建后，不要根据技能名称自行想象功能并生成脚本。先向用户提问收集关键信息：\n  - 输入参数有哪些？（字段名、类型、是否必填）\n  - 期望输出什么？（字段结构）\n  - 处理流程是怎样的？（步骤、逻辑、条件分支）\n  - 需要调用哪些 MCP 或外部服务？\n  - 是否需要依赖其他技能？\n收集完信息后再逐步填充 SKILL.md 和编写脚本。\n\n【编写技能内容】\n1. 编辑 skills/{技能名称}/SKILL.md 的 frontmatter（必填项）：\n   name:          技能名称\n   description:   功能描述\n   version:       版本号（x.y.z 格式，初始 0.1.0）\n   category:      分类（skill_creator 已填）\n   requires_mcp:  依赖的 MCP 列表，如 [\"shop_platform_order\"]\n   requires_skills: 依赖的其他技能列表，如 [\"sk_xxx\"]\n   requires_knowledge: 依赖的知识库列表\n2. 在 scripts/ 下编写脚本\n3. 在 references/ 下放置参考文档\n\n【版本号迭代规则】\n每次修改 SKILL.md 后需要更新 version 字段（x.y.z）：\n  小幅修改（修 bug、改描述、调参）：    z+1，如 0.1.0 → 0.1.1\n  中幅修改（增减功能、改脚本逻辑）：   y+1, z=0，如 0.1.3 → 0.2.0\n  大幅修改（重写、改接口、改依赖）：   x+1, y=0, z=0，如 0.2.1 → 1.0.0\n\n【提交审核】\n调用 system_internal_skill_deploy：\n  submit: {\"action\":\"submit\",\"skill_id\":\"sk_xxx\"}  → 提交审核（自动校验循环依赖和 frontmatter）\n  status: {\"action\":\"status\",\"skill_id\":\"sk_xxx\"}   → 查询审核状态/反馈\n\n【Webview 静态产出】\n技能运行时可产出 HTML/前端页面到 Webview 目录，产物通过 URL 直接访问，可在对话窗 iframe 渲染。\n  产出目录: /app/data/webview/{当前 agent_id}/\n  访问 URL: {EVOTOWN_PUBLIC_BASE_URL}/api/v1/webview/{agent_id}/{文件名}\n\n获取 agent_id 和 base_url 的方法（按优先级）：\n  1. 读取环境变量: EVOTOWN_PUBLIC_BASE_URL（系统已注入，如 https://ai-center.ecethink.com）\n  2. agent_id 从 workspace 路径获取: 当前工作目录即 /app/data/agents/{agent_id}/\n  3. 回退: 从 .evotown/AGENT_CONTEXT.md 中提取 Workspace ID\n\n产出流程：\n  1. 在 references/ 下放置 HTML 模板文件（如 report-template.html）\n  2. scripts/ 中的脚本读取模板，填入数据\n  3. 写入 /app/data/webview/{agent_id}/{文件名}\n  4. 返回最终 URL 给用户，前端自动以 iframe 渲染",
        "standards": "1. SKILL.md frontmatter 必填：name、description、version\n2. requires_mcp / requires_skills / requires_knowledge 均为数组格式（JSON array）\n3. 脚本入口放 scripts/ 下，Agent 按需加载\n4. 所有文件编码 UTF-8\n5. 开发目录路径格式：skills/{技能名称}/（目录以技能名称命名，非 skill_id）\n6. 提交前确认 version 号已按迭代规则更新\n7. Webview 产出：读取 EVOTOWN_PUBLIC_BASE_URL 环境变量拼接完整 URL，不可硬编码域名\n8. 产出文件写入 /app/data/webview/{agent_id}/ 目录，确保文件名不含路径分隔符",
        "default_model": "",
        "default_skills": [],
        "has_agent_dir": True,
        "agent_dir_root": "workspace",
        "agent_dir_prefix": "skills/",
    },
]


def _db() -> sqlite3.Connection:
    conn = accounts_store._ensure_conn()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS agent_identity_templates (
            template_id           TEXT PRIMARY KEY,
            name                  TEXT NOT NULL,
            description           TEXT NOT NULL DEFAULT '',
            category              TEXT NOT NULL DEFAULT 'department',
            soul                  TEXT NOT NULL DEFAULT '',
            paradigm              TEXT NOT NULL DEFAULT '',
            standards             TEXT NOT NULL DEFAULT '',
            default_model         TEXT NOT NULL DEFAULT '',
            default_skills        TEXT NOT NULL DEFAULT '[]',
            has_agent_dir     INTEGER NOT NULL DEFAULT 0,
            agent_dir_root    TEXT NOT NULL DEFAULT 'workspace',
            agent_dir_prefix  TEXT NOT NULL DEFAULT '',
            seed_version          TEXT NOT NULL DEFAULT '',
            created_at            TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_templates_category ON agent_identity_templates(category);
        """
    )
    _migrate(conn)
    _seed_builtin_templates(conn)
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(agent_identity_templates)").fetchall()}
    if "seed_version" not in cols:
        conn.execute("ALTER TABLE agent_identity_templates ADD COLUMN seed_version TEXT NOT NULL DEFAULT ''")
    # Rename legacy workspace_dir columns to agent_dir
    if "has_workspace_dir" in cols:
        conn.execute("ALTER TABLE agent_identity_templates RENAME COLUMN has_workspace_dir TO has_agent_dir")
    if "workspace_dir_root" in cols:
        conn.execute("ALTER TABLE agent_identity_templates RENAME COLUMN workspace_dir_root TO agent_dir_root")
    if "workspace_dir_prefix" in cols:
        conn.execute("ALTER TABLE agent_identity_templates RENAME COLUMN workspace_dir_prefix TO agent_dir_prefix")


def _seed_builtin_templates(conn: sqlite3.Connection) -> None:
    """Idempotent seed: insert if new, update if version bumped, delete if removed from code."""
    current_ids = {t["template_id"] for t in _BUILTIN_TEMPLATES}
    # Delete built-in templates no longer in code
    conn.execute(
        "DELETE FROM agent_identity_templates WHERE category='personal' AND template_id LIKE 'builtin:%' AND template_id NOT IN ({})".format(
            ",".join("?" * len(current_ids))
        ),
        tuple(current_ids),
    )
    for tpl in _BUILTIN_TEMPLATES:
        row = conn.execute(
            "SELECT seed_version FROM agent_identity_templates WHERE template_id=?",
            (tpl["template_id"],),
        ).fetchone()
        if row is None:
            _insert_builtin(conn, tpl)
        elif row["seed_version"] != BUILTIN_TEMPLATE_VERSION:
            _update_builtin(conn, tpl)


def _insert_builtin(conn: sqlite3.Connection, tpl: dict[str, Any]) -> None:
    conn.execute(
        """INSERT INTO agent_identity_templates
           (template_id, name, description, category, soul, paradigm, standards,
            default_model, default_skills, has_agent_dir, agent_dir_root,
            agent_dir_prefix, seed_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            tpl["template_id"],
            tpl["name"],
            tpl["description"],
            tpl["category"],
            tpl["soul"],
            tpl["paradigm"],
            tpl["standards"],
            tpl["default_model"],
            json.dumps(tpl.get("default_skills", [])),
            int(tpl.get("has_agent_dir", False)),
            tpl.get("agent_dir_root", "workspace"),
            tpl.get("agent_dir_prefix", ""),
            BUILTIN_TEMPLATE_VERSION,
        ),
    )


def _update_builtin(conn: sqlite3.Connection, tpl: dict[str, Any]) -> None:
    conn.execute(
        """UPDATE agent_identity_templates SET
           name=?, description=?, category=?, soul=?, paradigm=?, standards=?,
           default_model=?, default_skills=?, has_agent_dir=?, agent_dir_root=?,
           agent_dir_prefix=?, seed_version=?, updated_at=datetime('now')
           WHERE template_id=?""",
        (
            tpl["name"], tpl["description"], tpl["category"],
            tpl["soul"], tpl["paradigm"], tpl["standards"],
            tpl["default_model"], json.dumps(tpl.get("default_skills", [])),
            int(tpl.get("has_agent_dir", False)),
            tpl.get("agent_dir_root", "workspace"),
            tpl.get("agent_dir_prefix", ""),
            BUILTIN_TEMPLATE_VERSION,
            tpl["template_id"],
        ),
    )


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    d["default_skills"] = json.loads(d.get("default_skills", "[]"))
    d["has_agent_dir"] = bool(d.get("has_agent_dir"))
    return d


def list_templates(category: str = "") -> list[dict[str, Any]]:
    conn = _db()
    if category:
        rows = conn.execute(
            "SELECT * FROM agent_identity_templates WHERE category=? ORDER BY name",
            (category,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM agent_identity_templates ORDER BY category, name"
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def count_template_agents(template_id: str) -> int:
    """Return how many agents use this template (builtin or department)."""
    import sqlite3 as _sqlite3
    from pathlib import Path as _Path
    agents_db_path = _Path("/app/data/agents.db")
    agents_db = _sqlite3.connect(str(agents_db_path))
    agents_db.row_factory = _sqlite3.Row
    try:
        row = agents_db.execute(
            "SELECT count(*) as cnt FROM agents WHERE template_id=?",
            (template_id,),
        ).fetchone()
        return row["cnt"] if row else 0
    finally:
        agents_db.close()


def list_template_agents(template_id: str) -> list[dict[str, Any]]:
    """Return agents that use this template."""
    import sqlite3 as _sqlite3
    agents_db = _sqlite3.connect("/app/data/agents.db")
    agents_db.row_factory = _sqlite3.Row
    try:
        rows = agents_db.execute(
            "SELECT agent_id, name, status, category, created_at FROM agents WHERE template_id=? ORDER BY name",
            (template_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        agents_db.close()


def sync_template_to_agents(
    template_id: str, agent_ids: list[str]
) -> dict[str, Any]:
    """Force-sync template soul/paradigm/standards to selected agents' profile.json."""
    import json as _json
    tpl = get_template(template_id)
    if tpl is None:
        return {"ok": False, "error": "template not found"}

    from infra.agents import _agent_dir

    synced: list[str] = []
    failed: list[dict[str, str]] = []

    for agent_id in agent_ids:
        try:
            profile_path = _agent_dir(agent_id) / ".evotown" / "profile.json"
            if not profile_path.is_file():
                failed.append({"agent_id": agent_id, "reason": "profile.json not found"})
                continue

            with open(profile_path, "r", encoding="utf-8") as f:
                profile = _json.load(f)

            profile["soul"] = tpl.get("soul", profile.get("soul", ""))
            profile["paradigm"] = tpl.get("paradigm", profile.get("paradigm", ""))
            profile["standards"] = tpl.get("standards", profile.get("standards", ""))

            with open(profile_path, "w", encoding="utf-8") as f:
                _json.dump(profile, f, ensure_ascii=False, indent=2)

            synced.append(agent_id)
        except Exception as exc:
            failed.append({"agent_id": agent_id, "reason": str(exc)})

    return {"ok": True, "synced": synced, "failed": failed}


def get_template(template_id: str) -> dict[str, Any] | None:
    conn = _db()
    row = conn.execute(
        "SELECT * FROM agent_identity_templates WHERE template_id=?", (template_id,)
    ).fetchone()
    return _row_to_dict(row) if row else None


def create_template(**fields: Any) -> dict[str, Any]:
    conn = _db()
    tid = fields.pop("template_id", "") or f"tpl_{uuid.uuid4().hex[:12]}"
    skills = json.dumps(fields.pop("default_skills", []), ensure_ascii=False)
    wd = int(fields.pop("has_agent_dir", False))
    conn.execute(
        """INSERT INTO agent_identity_templates
           (template_id, name, description, category, soul, paradigm, standards,
            default_model, default_skills, has_agent_dir, agent_dir_root, agent_dir_prefix)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            tid, fields.get("name", ""), fields.get("description", ""),
            fields.get("category", "department"),
            fields.get("soul", ""), fields.get("paradigm", ""), fields.get("standards", ""),
            fields.get("default_model", ""), skills, wd,
            fields.get("agent_dir_root", "workspace"),
            fields.get("agent_dir_prefix", ""),
        ),
    )
    return get_template(tid) or {}


def update_template(**fields: Any) -> dict[str, Any] | None:
    conn = _db()
    tid = fields.pop("template_id", "")
    if not tid: return None
    existing = get_template(tid)
    if not existing: return None
    skills = json.dumps(fields.pop("default_skills", existing.get("default_skills", [])), ensure_ascii=False)
    conn.execute(
        """UPDATE agent_identity_templates SET
           name=?, description=?, category=?, soul=?, paradigm=?, standards=?,
           default_model=?, default_skills=?, has_agent_dir=?, agent_dir_root=?,
           agent_dir_prefix=?, updated_at=datetime('now')
           WHERE template_id=?""",
        (
            fields.get("name", existing["name"]),
            fields.get("description", existing.get("description", "")),
            fields.get("category", existing.get("category", "department")),
            fields.get("soul", existing.get("soul", "")),
            fields.get("paradigm", existing.get("paradigm", "")),
            fields.get("standards", existing.get("standards", "")),
            fields.get("default_model", existing.get("default_model", "")),
            skills,
            int(fields.get("has_agent_dir", existing.get("has_agent_dir", False))),
            fields.get("agent_dir_root", existing.get("agent_dir_root", "workspace")),
            fields.get("agent_dir_prefix", existing.get("agent_dir_prefix", "")),
            tid,
        ),
    )
    return get_template(tid)


def delete_template(template_id: str) -> bool:
    conn = _db()
    # Only allow deleting department templates (personal are system-protected by seed)
    existing = get_template(template_id)
    if existing and existing.get("category") == "personal":
        return False
    conn.execute("DELETE FROM agent_identity_templates WHERE template_id=?", (template_id,))
    return conn.total_changes > 0
