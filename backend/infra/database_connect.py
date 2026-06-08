"""One-shot connectivity checks for admin database registration (not used for agent queries)."""
from __future__ import annotations

import sqlite3
import time
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen


def test_database_connection(connection: dict[str, Any]) -> dict[str, Any]:
    db_type = str(connection.get("db_type") or "").lower()
    config = connection.get("config") or {}
    started = time.perf_counter()
    try:
        if db_type == "sqlite":
            _test_sqlite(config)
        elif db_type == "postgres":
            _test_postgres(config)
        elif db_type == "mysql":
            _test_mysql(config)
        elif db_type == "mssql":
            raise ValueError("SQL Server connectivity test is not supported yet")
        else:
            raise ValueError(f"unsupported db_type: {db_type}")
    except Exception as exc:
        latency_ms = int((time.perf_counter() - started) * 1000)
        return {"ok": False, "message": str(exc), "latency_ms": latency_ms}
    latency_ms = int((time.perf_counter() - started) * 1000)
    return {"ok": True, "message": "connection succeeded (SELECT 1)", "latency_ms": latency_ms}


def test_mcp_proxy_url(mcp_server_url: str) -> dict[str, Any]:
    url = (mcp_server_url or "").strip().rstrip("/")
    if not url:
        return {"ok": None, "message": "mcp_server_url not configured", "latency_ms": 0}
    health_url = f"{url}/health"
    started = time.perf_counter()
    try:
        req = Request(health_url, headers={"Accept": "application/json"})
        with urlopen(req, timeout=10) as resp:
            if resp.status >= 400:
                raise RuntimeError(f"HTTP {resp.status}")
    except URLError as exc:
        latency_ms = int((time.perf_counter() - started) * 1000)
        return {"ok": False, "message": str(exc.reason or exc), "latency_ms": latency_ms}
    except Exception as exc:
        latency_ms = int((time.perf_counter() - started) * 1000)
        return {"ok": False, "message": str(exc), "latency_ms": latency_ms}
    latency_ms = int((time.perf_counter() - started) * 1000)
    return {"ok": True, "message": "MCP proxy reachable", "latency_ms": latency_ms}


def _sqlite_path(config: dict[str, Any]) -> str:
    path = str(config.get("path") or config.get("database") or "").strip()
    if not path:
        raise ValueError("sqlite config requires path or database")
    return path


def _test_sqlite(config: dict[str, Any]) -> None:
    path = _sqlite_path(config)
    conn = sqlite3.connect(path, timeout=10)
    try:
        conn.execute("SELECT 1").fetchone()
    finally:
        conn.close()


def _test_postgres(config: dict[str, Any]) -> None:
    try:
        import psycopg
    except ImportError as exc:
        raise RuntimeError("postgres test requires psycopg (pip install 'psycopg[binary]')") from exc
    host = str(config.get("host") or "localhost")
    port = int(config.get("port") or 5432)
    database = str(config.get("database") or "")
    username = str(config.get("username") or "")
    password = str(config.get("password") or "")
    if not database:
        raise ValueError("postgres config requires database")
    conninfo = f"host={host} port={port} dbname={database} user={username} password={password} connect_timeout=10"
    with psycopg.connect(conninfo) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()


def _test_mysql(config: dict[str, Any]) -> None:
    try:
        import pymysql
    except ImportError as exc:
        raise RuntimeError("mysql test requires PyMySQL (pip install PyMySQL)") from exc
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
        connect_timeout=10,
    )
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
    finally:
        conn.close()
