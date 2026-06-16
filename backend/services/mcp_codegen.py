"""MCP code generation: permissions.py + database.py auto-generation."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

MCP_SERVICES_DIR = Path(os.environ.get("MCP_SERVICES_DIR", "/app/data/mcp-services"))


def _ensure_dir() -> None:
    MCP_SERVICES_DIR.mkdir(parents=True, exist_ok=True)


def load_permissions_dims() -> set[str]:
    """Load valid dimension IDs from generated permissions.py. Returns empty set if not found."""
    path = MCP_SERVICES_DIR / "permissions.py"
    if not path.is_file():
        return set()
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location("_permissions", str(path))
        if spec is None:
            return set()
        mod = importlib.util.module_from_spec(spec)
        if spec.loader is None:
            return set()
        spec.loader.exec_module(mod)
        dims = getattr(mod, "DIMENSIONS", {})
        return set(dims.keys())
    except Exception:
        return set()


def regenerate_permissions() -> None:
    """Regenerate permissions.py from system_dimension_registry."""
    from infra import mcp_registry
    dims = mcp_registry.list_dimensions()
    _ensure_dir()

    lines = [
        "# Auto-generated from system_dimension_registry. Do not edit manually.",
        f"# {len(dims)} dimensions registered.",
        "",
        "DIMENSIONS = {",
    ]
    for d in dims:
        lines.append(f'    "{d["dim_id"]}": {{')
        lines.append(f'        "label": "{d["label"]}",')
        lines.append(f'        "source_table": "{d["db_connection_id"]}.{d["table_name"]}",')
        lines.append(f'        "source_column": "{d["column_name"]}",')
        lines.append(f'    }},')
    lines.append("}")
    lines.append("")

    (MCP_SERVICES_DIR / "permissions.py").write_text("\n".join(lines), encoding="utf-8")


def regenerate_database() -> None:
    """Regenerate database.py for dev & prod environments based on connection environment field."""
    from infra import database_registry
    conns = database_registry.list_connections(status="active", include_secrets=True)
    _ensure_dir()

    dev_dir = Path(os.environ.get("EVOTOWN_MCP_DEV_DIR", "/app/data/mcp-dev"))
    dev_dir.mkdir(parents=True, exist_ok=True)

    # Separate by environment
    dev_conns = [c for c in conns if c.get("environment") in ("development", "both")]
    prod_conns = [c for c in conns if c.get("environment") in ("production", "both","")]

    for target_dir, target_conns in [(dev_dir, dev_conns), (MCP_SERVICES_DIR, prod_conns)]:
        lines = [
            "# Auto-generated from database_connections. Do not edit manually.",
            f"# {len(target_conns)} active connections in this environment.",
            "",
        ]
        db_types_seen: set[str] = set()
        for c in target_conns:
            db_types_seen.add(c.get("db_type", ""))

        if "postgres" in db_types_seen:
            lines.append("import psycopg")
        if "mysql" in db_types_seen:
            lines.append("import pymysql")
        if "sqlite" in db_types_seen:
            lines.append("import sqlite3")
        lines.append("")

        for c in target_conns:
            name = c.get("name", c["connection_id"])
            safe_name = name.lower().replace(" ", "_").replace("-", "_")
            db_type = c.get("db_type", "")
            config = c.get("config", {})

            lines.append(f"def get_{safe_name}():")
            lines.append(f'    """{name} ({db_type})"""')

            if db_type == "postgres":
                host = config.get("host", "localhost")
                port = config.get("port", 5432)
                database = config.get("database", "")
                user = config.get("username", "")
                pwd = config.get("password", "")
                lines.append(f"    import psycopg")
                lines.append(f"    return psycopg.connect(")
                lines.append(f'        host="{host}", port={port},')
                lines.append(f'        dbname="{database}", user="{user}", password="{pwd}",')
                lines.append(f"        connect_timeout=10)")
            elif db_type == "mysql":
                host = config.get("host", "localhost")
                port = int(config.get("port", 3306))
                database = config.get("database", "")
                user = config.get("username", "")
                pwd = config.get("password", "")
                lines.append(f"    import pymysql")
                lines.append(f"    return pymysql.connect(")
                lines.append(f'        host="{host}", port={port},')
                lines.append(f'        user="{user}", password="{pwd}",')
                lines.append(f'        database="{database}",')
                lines.append(f"        connect_timeout=10)")
            elif db_type == "sqlite":
                path = config.get("path") or config.get("database", "")
                lines.append(f"    import sqlite3")
                lines.append(f'    return sqlite3.connect("{path}", timeout=10)')
            lines.append("")

        (target_dir / "database.py").write_text("\n".join(lines), encoding="utf-8")
