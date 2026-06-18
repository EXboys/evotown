"""Agent identity templates — stored in DB, seeded on first start."""
from __future__ import annotations

import json
import sqlite3
import uuid
from typing import Any

from infra import accounts as accounts_store

BUILTIN_TEMPLATE_VERSION = "2.4.1"
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
            "1. 理解需求 → 确认涉及的数据表和权限维度\n"
            "2. 查看 {server}/mcp-dev/ 下的 database.py 了解可用数据库，permissions.py 了解已注册维度\n"
            "3. 确定 category（分类目录名）和 name（接口名）\n"
            "   命名规范：仅允许 a-z 0-9 _ -，推荐全小写，如 shop、platform_order\n"
            "4. 在 mcp-dev/{category}/{name}/ 下创建 manifest.json 和 handler.py"
            "5. 检查是否已有同名 MCP → 首次用 v1.0.0，更新则 bump 版本号\n"
            "6. 用 mcp_dev_call(service_id, args, permissions) 在开发目录调试验证\n"
            "7. 发布：调用 mcp_call(\"internal_mcp_deploy\", {\"category\": \"实际的category\", \"name\": \"实际的name\"})\n"
            "   将 category 和 name 替换为步骤3确定的实际值\n"
            "8. 发布后告知用户「MCP 已提交审核，等待管理员审批」\n"
            "9. 若返回 error「版本正在审核中」→ 告知用户等待审核完成后再提交"
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
            "7. 发布：使用 mcp_call(\"internal_mcp_deploy\", {\"category\": \"...\", \"name\": \"...\"}) 提交审核\n"
            "   不要使用 python publish.py 或直接操作文件系统\n"
            "8. 禁止修改 database.py、permissions.py 等系统生成文件\n"
            "9. 调试用 mcp_dev_call()，发布用 mcp_call(\"internal_mcp_deploy\", ...)"
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
        "description": "开发 evotown Skill 技能包",
        "category": "personal",
        "soul": "你是 Skill 开发专家。",
        "paradigm": "1. 理解需求 → 2. 设计 SKILL.md → 3. 编写脚本 → 4. 测试 → 5. 打包",
        "standards": "遵循 evotown Skill 规范",
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
