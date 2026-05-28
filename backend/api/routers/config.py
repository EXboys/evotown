"""配置路由"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core.auth import require_admin
from core.config import load_display_config, load_economy_config, save_display_timezone
from core.deps import experiment_id
from infra.experiment import load_experiment_id

router = APIRouter(prefix="/config", tags=["config"])


class DisplayTimezoneUpdate(BaseModel):
    timezone: str = Field(..., min_length=1, max_length=64)


@router.get("/economy")
async def get_economy_config():
    return load_economy_config()


@router.get("/display")
async def get_display_config():
    """界面时间显示时区（IANA），供前端初始化与日报周期标签。"""
    return load_display_config()


@router.put("/display", dependencies=[Depends(require_admin)])
async def update_display_config(body: DisplayTimezoneUpdate):
    try:
        return save_display_timezone(body.timezone)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
