from __future__ import annotations

import sqlite3
from typing import Any


def _rows_to_dicts(columns: list[str], rows: list[tuple[Any, ...]]) -> list[dict[str, Any]]:
    return [dict(zip(columns, row, strict=False)) for row in rows]


def run_query(connection: dict[str, Any], sql: str) -> dict[str, Any]:
    db_type = str(connection.get("db_type") or "").lower()
    config = connection.get("config") or {}
    if db_type == "sqlite":
        return _run_sqlite(config, sql)
    if db_type == "postgres":
        return _run_postgres(config, sql)
    if db_type == "mysql":
        return _run_mysql(config, sql)
    raise ValueError(f"unsupported db_type: {db_type}")


def list_tables(connection: dict[str, Any]) -> list[str]:
    db_type = str(connection.get("db_type") or "").lower()
    if db_type == "sqlite":
        result = run_query(connection, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name LIMIT 500")
        return [str(row["name"]) for row in result["rows"] if row.get("name")]
    if db_type == "postgres":
        result = run_query(
            connection,
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema NOT IN ('pg_catalog', 'information_schema') "
            "ORDER BY table_name LIMIT 500",
        )
        return [str(row["table_name"]) for row in result["rows"] if row.get("table_name")]
    if db_type == "mysql":
        result = run_query(
            connection,
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = DATABASE() ORDER BY table_name LIMIT 500",
        )
        return [str(row["table_name"]) for row in result["rows"] if row.get("table_name")]
    raise ValueError(f"unsupported db_type: {db_type}")


def _sqlite_path(config: dict[str, Any]) -> str:
    path = str(config.get("path") or config.get("database") or "").strip()
    if not path:
        raise ValueError("sqlite config requires path or database")
    return path


def _run_sqlite(config: dict[str, Any], sql: str) -> dict[str, Any]:
    path = _sqlite_path(config)
    conn = sqlite3.connect(path)
    try:
        conn.row_factory = sqlite3.Row
        cur = conn.execute(sql)
        if cur.description is None:
            return {"columns": [], "rows": [], "row_count": 0}
        columns = [col[0] for col in cur.description]
        rows = cur.fetchall()
        return {
            "columns": columns,
            "rows": [dict(row) for row in rows],
            "row_count": len(rows),
        }
    finally:
        conn.close()


def _run_postgres(config: dict[str, Any], sql: str) -> dict[str, Any]:
    import psycopg
    from psycopg.rows import dict_row

    host = str(config.get("host") or "localhost")
    port = int(config.get("port") or 5432)
    database = str(config.get("database") or "")
    username = str(config.get("username") or "")
    password = str(config.get("password") or "")
    if not database:
        raise ValueError("postgres config requires database")
    conninfo = f"host={host} port={port} dbname={database} user={username} password={password}"
    with psycopg.connect(conninfo, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
            if cur.description is None:
                return {"columns": [], "rows": [], "row_count": 0}
            columns = [desc.name for desc in cur.description]
            rows = cur.fetchall()
            return {"columns": columns, "rows": rows, "row_count": len(rows)}


def _run_mysql(config: dict[str, Any], sql: str) -> dict[str, Any]:
    import pymysql

    host = str(config.get("host") or "localhost")
    port = int(config.get("port") or 3306)
    database = str(config.get("database") or "")
    username = str(config.get("username") or "")
    password = str(config.get("password") or "")
    if not database:
        raise ValueError("mysql config requires database")
    conn = pymysql.connect(
        host=host,
        port=port,
        user=username,
        password=password,
        database=database,
        cursorclass=pymysql.cursors.DictCursor,
    )
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
            if cur.description is None:
                return {"columns": [], "rows": [], "row_count": 0}
            columns = [col[0] for col in cur.description]
            rows = cur.fetchall()
            return {"columns": columns, "rows": rows, "row_count": len(rows)}
    finally:
        conn.close()
