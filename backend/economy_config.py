"""兼容层 — 转发到 core.config"""
from core.config import load_economy_config, load_evolution_config

__all__ = ["load_economy_config", "load_evolution_config"]
