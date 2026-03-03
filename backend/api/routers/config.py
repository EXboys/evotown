"""配置路由"""
from fastapi import APIRouter

from core.config import load_economy_config
from core.deps import experiment_id
from infra.experiment import load_experiment_id

router = APIRouter(prefix="/config", tags=["config"])


@router.get("/economy")
async def get_economy_config():
    return load_economy_config()


@router.get("/experiment")
async def get_experiment_info():
    """实验 ID 与配置快照"""
    exp_id = load_experiment_id() or experiment_id
    if not exp_id:
        return {"experiment_id": None, "config": None}
    import json
    from pathlib import Path
    backend_dir = Path(__file__).resolve().parent.parent.parent
    meta_path = backend_dir / "experiment_meta.json"
    config_snapshot = None
    if meta_path.exists():
        try:
            config_snapshot = json.loads(meta_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {"experiment_id": exp_id, "config": config_snapshot}
