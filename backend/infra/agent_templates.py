"""Agent identity templates — stored in DB, seeded on first start."""
from __future__ import annotations

import json
import sqlite3
import uuid
from typing import Any

from infra import accounts as accounts_store

BUILTIN_TEMPLATE_VERSION = "2.0.0"
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
            "3. 确认服务分类目录和接口名称（用户提供，如「订单服务/mcp_order_query」）\n"
            "4. 检查 mcp-dev/{分类}/{接口名}/ 是否已存在 → 首次发布用 v1.0.0，更新则 bump 版本号\n"
            "5. 在 mcp-dev/{分类}/{接口名}/ 下创建/更新 manifest.json（含 version 字段）和 handler.py\n"
            "6. 用 mcp_dev_call(service_id, args, permissions) 在开发目录调试验证\n"
            "7. 检查返回的 ok/data/error/version，修复后重新调试通过\n"
            "8. 调试通过后执行 `python publish.py {分类}/{接口名}` 部署到生产\n"
            "9. 生产环境热更新生效，其他 Agent 通过 mcp_call() 调用"
        ),
        "standards": (
            "1. manifest.json：dimensions 只能引用已注册维度，无权限需求时留空数组\n"
            "2. handler.py：入参/出参必须对应 manifest 的 input/output 定义\n"
            "3. 数据库连接：from database import get_{表名} 获取连接\n"
            "4. 权限过滤：用 permissions.get(\"维度名\", []) 拼 WHERE，全量权限时 key 不在 permissions 中 → 不过滤\n"
            "5. 开发目录结构（共享）：\n"
            "   {server}/mcp-dev/\n"
            "   ├── database.py               ← 系统生成，只读\n"
            "   ├── permissions.py            ← 系统生成，只读\n"
            "   ├── publish.py               ← 系统生成，部署脚本\n"
            "   └── {分类}/{接口名}/           ← 你创建\n"
            "       ├── manifest.json         ← 你生成，含 version 字段\n"
            "       └── handler.py            ← 你生成: def process(args, permissions)\n"
            "6. 版本号：manifest.json 中声明 version，首次 v1.0.0，更新时递增\n"
            "7. 标准返回：{ ok: bool, data: ..., error: ..., version: \"x.y.z\" }\n"
            "8. 部署：`python publish.py {分类}/{接口名}`，自动校验+复制+清缓存\n"
            "   部署后生产调用 mcp_call(id, args)，权限由网关自动注入\n"
            "9. 禁止修改 database.py、permissions.py、publish.py 等系统生成文件\n"
            "10. 修复后重新执行 publish.py 即可热更新"
        ),
        "default_model": "",
        "default_skills": [],
        "has_workspace_dir": True,
        "workspace_dir_root": "shared",
        "workspace_dir_prefix": "mcp-dev/",
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
        "has_workspace_dir": True,
        "workspace_dir_root": "workspace",
        "workspace_dir_prefix": "skills/",
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
            has_workspace_dir     INTEGER NOT NULL DEFAULT 0,
            workspace_dir_root    TEXT NOT NULL DEFAULT 'workspace',
            workspace_dir_prefix  TEXT NOT NULL DEFAULT '',
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
            default_model, default_skills, has_workspace_dir, workspace_dir_root,
            workspace_dir_prefix, seed_version)
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
            int(tpl.get("has_workspace_dir", False)),
            tpl.get("workspace_dir_root", "workspace"),
            tpl.get("workspace_dir_prefix", ""),
            BUILTIN_TEMPLATE_VERSION,
        ),
    )


def _update_builtin(conn: sqlite3.Connection, tpl: dict[str, Any]) -> None:
    conn.execute(
        """UPDATE agent_identity_templates SET
           name=?, description=?, category=?, soul=?, paradigm=?, standards=?,
           default_model=?, default_skills=?, has_workspace_dir=?, workspace_dir_root=?,
           workspace_dir_prefix=?, seed_version=?, updated_at=datetime('now')
           WHERE template_id=?""",
        (
            tpl["name"], tpl["description"], tpl["category"],
            tpl["soul"], tpl["paradigm"], tpl["standards"],
            tpl["default_model"], json.dumps(tpl.get("default_skills", [])),
            int(tpl.get("has_workspace_dir", False)),
            tpl.get("workspace_dir_root", "workspace"),
            tpl.get("workspace_dir_prefix", ""),
            BUILTIN_TEMPLATE_VERSION,
            tpl["template_id"],
        ),
    )


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    d["default_skills"] = json.loads(d.get("default_skills", "[]"))
    d["has_workspace_dir"] = bool(d.get("has_workspace_dir"))
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
    wd = int(fields.pop("has_workspace_dir", False))
    conn.execute(
        """INSERT INTO agent_identity_templates
           (template_id, name, description, category, soul, paradigm, standards,
            default_model, default_skills, has_workspace_dir, workspace_dir_root, workspace_dir_prefix)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            tid, fields.get("name", ""), fields.get("description", ""),
            fields.get("category", "department"),
            fields.get("soul", ""), fields.get("paradigm", ""), fields.get("standards", ""),
            fields.get("default_model", ""), skills, wd,
            fields.get("workspace_dir_root", "workspace"),
            fields.get("workspace_dir_prefix", ""),
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
           default_model=?, default_skills=?, has_workspace_dir=?, workspace_dir_root=?,
           workspace_dir_prefix=?, updated_at=datetime('now')
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
            int(fields.get("has_workspace_dir", existing.get("has_workspace_dir", False))),
            fields.get("workspace_dir_root", existing.get("workspace_dir_root", "workspace")),
            fields.get("workspace_dir_prefix", existing.get("workspace_dir_prefix", "")),
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
