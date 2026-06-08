#!/usr/bin/env python3
from __future__ import annotations

import uvicorn

from database_mcp_proxy.app import app
from database_mcp_proxy.config import listen_host, listen_port


def main() -> None:
    uvicorn.run(app, host=listen_host(), port=listen_port(), log_level="info")


if __name__ == "__main__":
    main()
