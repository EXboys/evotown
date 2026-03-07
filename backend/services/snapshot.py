"""分享卡片生成服务 — 使用 Pillow 生成武将战报卡片 (Phase 0)

POST /snapshot/card?agent_id=xxx → PNG 图片（二进制流）
"""
from __future__ import annotations

import io
import os
from pathlib import Path
from typing import Any

# ── 颜色主题（三国墨风） ──────────────────────────────────────────────────────
_C_BG       = (20, 18, 40)          # 深夜蓝
_C_BORDER   = (201, 162, 39)        # 金边
_C_TITLE_BG = (36, 30, 70)         # 标题栏深色
_C_TEXT     = (245, 230, 200)       # 羊皮纸白
_C_DIM      = (160, 148, 130)       # 暗淡辅助文字
_C_GREEN    = (80, 200, 120)        # 告捷绿
_C_RED      = (220, 80, 80)         # 兵败红
_C_GOLD     = (201, 162, 39)        # 金色高亮
_C_ACCENT   = (255, 120, 60)        # 橘红强调

# 卡片尺寸
_W, _H = 640, 380

# ── 字体加载（CJK优先，优雅降级） ────────────────────────────────────────────
def _load_font(size: int):
    """尝试加载支持 CJK 的字体，降级到 PIL 内置字体"""
    from PIL import ImageFont
    candidates = [
        "/System/Library/Fonts/STHeiti Medium.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    ]
    # also check env override
    env_font = os.environ.get("SNAPSHOT_FONT_PATH", "")
    if env_font:
        candidates.insert(0, env_font)
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def _draw_rounded_rect(draw, xy, radius: int, fill, outline=None, width: int = 2):
    """Draw a rounded rectangle (Pillow < 9.2 compat)"""
    try:
        draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)
    except AttributeError:
        draw.rectangle(xy, fill=fill, outline=outline, width=width)


def _soul_label(soul_type: str) -> str:
    return {"conservative": "保守型", "aggressive": "激进型", "balanced": "均衡型"}.get(soul_type, soul_type)


def _focus_label(focus: str) -> str:
    return {
        "scholar": "学者", "warrior": "武者",
        "craftsman": "工匠", "diplomat": "外交官", "explorer": "探险家",
    }.get(focus, focus or "—")


def generate_card(agent_data: dict[str, Any]) -> bytes:
    """根据 agent_data 生成 PNG 分享卡片，返回字节流"""
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (_W, _H), color=_C_BG)
    draw = ImageDraw.Draw(img)

    # ── 字体 ────────────────────────────────────────────────────────────────
    font_lg  = _load_font(40)   # 武将名
    font_md  = _load_font(22)   # 副标题
    font_sm  = _load_font(17)   # 数据标签
    font_xs  = _load_font(13)   # 页脚

    # ── 外边框（双层金框） ──────────────────────────────────────────────────
    draw.rectangle([0, 0, _W - 1, _H - 1], outline=_C_BORDER, width=3)
    draw.rectangle([6, 6, _W - 7, _H - 7], outline=(120, 95, 20), width=1)

    # ── 标题栏 ──────────────────────────────────────────────────────────────
    title_h = 52
    draw.rectangle([3, 3, _W - 4, title_h], fill=_C_TITLE_BG)
    draw.line([(3, title_h), (_W - 4, title_h)], fill=_C_BORDER, width=2)
    _text_center(draw, "孔  明  进  化  小  镇  ·  英  雄  战  报", font_md, y=14, color=_C_GOLD)

    # ── 武将名 ──────────────────────────────────────────────────────────────
    name = agent_data.get("display_name") or agent_data.get("agent_id", "佚名")
    _text_center(draw, name, font_lg, y=68, color=_C_TEXT)

    # ── 副线（魂魄类型 + 军功） ─────────────────────────────────────────────
    soul    = _soul_label(agent_data.get("soul_type", "balanced"))
    balance = agent_data.get("balance", 0)
    subtitle = f"{soul}   ·   军功值  {balance:+d}"
    _text_center(draw, subtitle, font_md, y=122, color=_C_DIM)

    # ── 分割线 ──────────────────────────────────────────────────────────────
    draw.line([(40, 158), (_W - 40, 158)], fill=(80, 65, 30), width=1)

    # ── 统计数据 ────────────────────────────────────────────────────────────
    won  = agent_data.get("completed", 0)
    lost = agent_data.get("failed", 0)
    total = won + lost
    rate = int(won / max(total, 1) * 100)

    _stat_block(draw, font_sm, font_xs, x=60,  y=175, label="告捷", value=str(won),  color=_C_GREEN)
    _stat_block(draw, font_sm, font_xs, x=220, y=175, label="兵败", value=str(lost), color=_C_RED)
    _stat_block(draw, font_sm, font_xs, x=380, y=175, label="胜率", value=f"{rate}%", color=_C_GOLD)
    _stat_block(draw, font_sm, font_xs, x=520, y=175, label="总令", value=str(total), color=_C_TEXT)

    # ── 进度条（胜率） ──────────────────────────────────────────────────────
    bar_x, bar_y, bar_w, bar_h = 40, 248, _W - 80, 14
    draw.rectangle([bar_x, bar_y, bar_x + bar_w, bar_y + bar_h], fill=(40, 35, 70), outline=(80, 65, 30))
    fill_w = int(bar_w * rate / 100)
    if fill_w > 0:
        draw.rectangle([bar_x, bar_y, bar_x + fill_w, bar_y + bar_h], fill=_C_GREEN)

    # ── 标签行（进化方向 + 队伍） ────────────────────────────────────────────
    focus_label = _focus_label(agent_data.get("evolution_focus", ""))
    team_name   = agent_data.get("team_name") or "无阵营"
    _badge(draw, font_xs, x=40,  y=278, text=f"进化方向：{focus_label}", color=_C_ACCENT)
    _badge(draw, font_xs, x=340, y=278, text=f"所属阵营：{team_name}",    color=_C_BORDER)

    # ── 页脚 ────────────────────────────────────────────────────────────────
    draw.line([(3, _H - 38), (_W - 4, _H - 38)], fill=(80, 65, 30), width=1)
    _text_center(draw, "孔明进化小镇  ·  SkillLite Arena", font_xs, y=_H - 30, color=_C_DIM)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ── 绘图辅助 ─────────────────────────────────────────────────────────────────

def _text_center(draw, text: str, font, y: int, color):
    try:
        bbox = draw.textbbox((0, 0), text, font=font)
        w = bbox[2] - bbox[0]
    except AttributeError:
        w, _ = draw.textsize(text, font=font)  # type: ignore[attr-defined]
    draw.text(((_W - w) // 2, y), text, font=font, fill=color)


def _stat_block(draw, font_val, font_label, x: int, y: int, label: str, value: str, color):
    try:
        bbox = draw.textbbox((0, 0), value, font=font_val)
        vw = bbox[2] - bbox[0]
    except AttributeError:
        vw, _ = draw.textsize(value, font=font_val)  # type: ignore[attr-defined]
    draw.text((x, y), value, font=font_val, fill=color)
    draw.text((x, y + 32), label, font=font_label, fill=_C_DIM)


def _badge(draw, font, x: int, y: int, text: str, color):
    try:
        bbox = draw.textbbox((0, 0), text, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    except AttributeError:
        tw, th = draw.textsize(text, font=font)  # type: ignore[attr-defined]
    pad = 6
    draw.rounded_rectangle(
        [x - pad, y - pad // 2, x + tw + pad, y + th + pad],
        radius=4, fill=(36, 30, 70), outline=color, width=1,
    ) if hasattr(draw, "rounded_rectangle") else draw.rectangle(
        [x - pad, y - pad // 2, x + tw + pad, y + th + pad],
        fill=(36, 30, 70), outline=color,
    )
    draw.text((x, y), text, font=font, fill=color)

