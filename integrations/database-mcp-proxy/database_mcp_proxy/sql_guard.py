from __future__ import annotations

import re

_FORBIDDEN = re.compile(
    r"\b("
    r"INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|"
    r"COPY|EXECUTE|CALL|MERGE|REPLACE|ATTACH|DETACH|PRAGMA|VACUUM|"
    r"INTO\s+OUTFILE|LOAD\s+DATA"
    r")\b",
    re.IGNORECASE,
)
_READ_START = re.compile(r"^\s*(WITH|SELECT|EXPLAIN(\s+\(?\s*ANALYZE)?)\b", re.IGNORECASE)


def sanitize_readonly_sql(sql: str, *, max_rows: int = 1000) -> str:
    text = (sql or "").strip()
    if not text:
        raise ValueError("sql is required")
    # Strip trailing semicolon; reject multi-statement batches.
    if ";" in text.rstrip(";"):
        raise ValueError("multiple SQL statements are not allowed")
    text = text.rstrip(";").strip()
    if _FORBIDDEN.search(text):
        raise ValueError("only read-only SELECT / EXPLAIN queries are allowed")
    if not _READ_START.match(text):
        raise ValueError("query must start with SELECT, WITH, or EXPLAIN")
    if not re.search(r"\bLIMIT\b", text, re.IGNORECASE):
        text = f"{text} LIMIT {max_rows}"
    return text
