/**
 * 角色资产 — NES/FC 吞食天地2 风格 16×16 像素精灵
 * 双层结构：char_base（身体/轮廓）+ char_helmet（头盔填充，可 tint 变色）
 */
import type Phaser from "phaser";
import { NES_HEX } from "./nesColors";

type PixelRow = (string | null)[];

const _ = null; // 透明
const O = NES_HEX.OUTLINE;
const F = NES_HEX.CHAR_SKIN;
const W = NES_HEX.CHAR_ARMOR;
const G = NES_HEX.CHAR_WEAPON;

/** char_base 正面（朝下走）：身体、面部、铠甲、腿、武器 */
const BASE_FRONT: PixelRow[] = [
  [_,_,_,_,_,O,_,_,_,O,_,_,_,_,_,_],
  [_,_,_,_,O,_,_,_,_,_,O,_,_,_,_,_],
  [_,_,_,_,O,_,_,_,_,_,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,F,O,_,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,F,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,F,O,_,_,_,_,_,_],
  [_,_,_,O,O,W,W,W,W,W,O,O,_,_,_,_],
  [_,_,_,O,W,W,W,W,W,W,W,O,_,_,_,_],
  [_,_,_,O,W,O,O,O,O,O,W,O,_,_,_,_],
  [_,_,_,O,W,W,W,W,W,W,W,O,G,_,_,_],
  [_,_,_,O,W,O,O,O,O,O,W,O,G,_,_,_],
  [_,_,_,O,W,W,W,W,W,W,W,O,G,_,_,_],
  [_,_,_,_,O,W,W,W,W,W,O,_,_,_,_,_],
  [_,_,_,_,O,W,O,_,O,W,O,_,_,_,_,_],
  [_,_,_,_,O,W,O,_,O,W,O,_,_,_,_,_],
  [_,_,_,_,O,O,O,_,O,O,O,_,_,_,_,_],
];

/** char_base 正面 走动帧（腿微动，幅度小：左腿略前） */
const BASE_FRONT_WALK: PixelRow[] = [
  ...BASE_FRONT.slice(0, 12),
  [_,_,_,O,W,O,_,_,O,W,O,_,_,_,_,_],
  [_,_,_,O,W,O,_,_,O,W,O,_,_,_,_,_],
  [_,_,_,O,W,O,_,_,O,W,O,_,_,_,_,_],
  [_,_,_,O,O,O,_,_,O,O,O,_,_,_,_,_],
];

/** char_base 背面（朝上走）：头盔、铠甲、腿 */
const BASE_BACK: PixelRow[] = [
  [_,_,_,_,_,O,O,O,O,O,O,_,_,_,_,_],
  [_,_,_,_,O,O,O,O,O,O,O,O,_,_,_,_],
  [_,_,_,_,O,O,O,O,O,O,O,O,_,_,_,_],
  [_,_,_,_,_,O,O,O,O,O,O,_,_,_,_,_],
  [_,_,_,_,O,O,O,O,O,O,O,O,_,_,_,_],
  [_,_,_,_,O,O,O,O,O,O,O,O,_,_,_,_],
  [_,_,_,O,O,W,W,W,W,W,O,O,_,_,_,_],
  [_,_,_,O,W,W,W,W,W,W,W,O,_,_,_,_],
  [_,_,_,O,W,O,O,O,O,O,W,O,_,_,_,_],
  [_,_,_,O,W,W,W,W,W,W,W,O,G,_,_,_],
  [_,_,_,O,W,O,O,O,O,O,W,O,G,_,_,_],
  [_,_,_,O,W,W,W,W,W,W,W,O,G,_,_,_],
  [_,_,_,_,O,W,W,W,W,W,O,_,_,_,_,_],
  [_,_,_,_,O,W,O,_,O,W,O,_,_,_,_,_],
  [_,_,_,_,O,W,O,_,O,W,O,_,_,_,_,_],
  [_,_,_,_,O,O,O,_,O,O,O,_,_,_,_,_],
];

/** char_base 背面 走动帧（腿微动，幅度小） */
const BASE_BACK_WALK: PixelRow[] = [
  ...BASE_BACK.slice(0, 12),
  [_,_,_,O,W,O,_,_,O,W,O,_,_,_,_,_],
  [_,_,_,O,W,O,_,_,O,W,O,_,_,_,_,_],
  [_,_,_,O,W,O,_,_,O,W,O,_,_,_,_,_],
  [_,_,_,O,O,O,_,_,O,O,O,_,_,_,_,_],
];

/** char_base 侧面（朝左/右走）：站立时双腿，与身体对齐 */
const BASE_SIDE: PixelRow[] = [
  [_,_,_,_,_,_,O,O,O,O,_,_,_,_,_,_],
  [_,_,_,_,_,O,O,O,O,O,O,_,_,_,_,_],
  [_,_,_,_,_,O,O,O,O,O,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,O,O,W,W,W,O,O,_,_,_,_,_],
  [_,_,_,_,O,W,W,W,W,W,O,_,_,_,_,_],
  [_,_,_,_,O,W,O,O,O,W,O,_,_,_,_,_],
  [_,_,_,_,O,W,W,W,W,W,O,G,_,_,_,_],
  [_,_,_,_,O,W,O,O,O,W,O,G,_,_,_,_],
  [_,_,_,_,O,W,W,W,W,W,O,G,_,_,_,_],
  [_,_,_,_,O,W,W,O,W,W,O,_,_,_,_,_],
  [_,_,_,_,O,W,O,O,O,W,O,_,_,_,_,_],
  [_,_,_,_,O,W,O,O,O,W,O,_,_,_,_,_],
  [_,_,_,_,O,O,O,_,O,O,O,_,_,_,_,_],
];

/** char_base 侧面 走动帧（单腿前伸，与身体对齐） */
const BASE_SIDE_WALK: PixelRow[] = [
  ...BASE_SIDE.slice(0, 12),
  [_,_,_,_,O,W,W,W,W,O,_,_,_,_,_,_],
  [_,_,_,_,O,W,O,O,W,O,_,_,_,_,_,_],
  [_,_,_,_,O,W,O,O,W,O,_,_,_,_,_,_],
  [_,_,_,_,O,O,O,O,O,O,_,_,_,_,_,_],
];

/** char_helmet 正面 */
const HELMET_FRONT: PixelRow[] = [
  [_,_,_,_,_,_,'#FFFFFF','#FFFFFF','#FFFFFF',_,_,_,_,_,_,_],
  [_,_,_,_,_,'#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF',_,_,_,_,_,_],
  [_,_,_,_,_,'#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF',_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
];

/** char_helmet 背面（#FFFFFF 为 tint 填充区） */
const HELMET_BACK: PixelRow[] = [
  [_,_,_,_,_,_,'#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF',_,_,_,_,_,_],
  [_,_,_,_,_,'#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF',_,_,_,_,_],
  [_,_,_,_,_,'#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF',_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
];

/** char_helmet 侧面（#FFFFFF 为 tint 填充区） */
const HELMET_SIDE: PixelRow[] = [
  [_,_,_,_,_,_,'#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF',_,_,_,_,_,_],
  [_,_,_,_,_,'#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF',_,_,_,_,_],
  [_,_,_,_,_,'#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF','#FFFFFF',_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
];

// ── 武将独特形状精灵 ─────────────────────────────────────────────

// 武将颜色快捷引用
const KMh = "#1060C8", KMg = "#D4A800";                                    // 孔明：蓝帽甲，金扇
const ZYh = "#C0C8D8", ZYa = "#D0D8E8", ZYg = "#B8C0CC";                   // 子龙：银盔，白甲，银枪
const SMh = "#3C1060", SMa = "#4C1870", SMg = "#282830";                    // 仲达：紫帽，紫甲，暗器
const ZUh = "#C82010", ZUg = "#D4A800";                                     // 周瑜：红盔甲，金饰
const GYh = "#186038", GYg = "#C83020", GYs = "#C85020", GYb = "#302018";   // 关羽：绿巾甲，红刀，红肤，黑须
const ZFh = "#282828", ZFa = "#383838", ZFg = "#604820", ZFb = "#201810";   // 张飞：黑盔，灰甲，棕器，黑须
// ── 新增7位武将颜色 ──
const LBh = "#D4A010", LBa = "#C89820", LBg = "#A87810";                   // 刘备：金冠，金黄甲，金剑
const CCh = "#601010", CCa = "#481818", CCg = "#A02020";                    // 曹操：暗红冠，黑红甲，红刀
const SQh = "#582898", SQa = "#4C2080", SQg = "#D4A010";                   // 孙权：紫金冠，紫甲，金饰
const ZLh = "#485058", ZLa = "#586068", ZLg = "#889098";                   // 张辽：铁灰盔，灰甲，银戟
const GJh = "#203878", GJa = "#2C4888", GJg = "#C8C8D0";                   // 郭嘉：深蓝巾，蓝袍，白扇
const HGh = "#784020", HGa = "#8C4828", HGg = "#606060";                   // 黄盖：棕铁盔，棕甲，铁鞭
const LSh = "#3878A0", LSa = "#4888B0", LSg = "#E8E0D0";                   // 鲁肃：蓝灰帽，蓝袍，白卷轴

// ── 每位武将独特头部（6行） ──────────────────────────────────────

/** 孔明 — 高冠纶巾（尖顶→宽檐），一眼认出 */
const HEAD_KM: PixelRow[] = [
  [_,_,_,_,_,_,_,KMh,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,O,KMh,O,_,_,_,_,_,_,_],
  [_,_,_,_,O,KMh,KMh,KMh,KMh,KMh,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,F,O,_,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,F,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,F,O,_,_,_,_,_,_],
];
/** 子龙 — 银甲龙角盔（两侧角突出） */
const HEAD_ZY: PixelRow[] = [
  [_,_,_,O,_,_,ZYh,ZYh,ZYh,_,_,O,_,_,_,_],
  [_,_,_,_,O,ZYh,ZYh,ZYh,ZYh,ZYh,O,_,_,_,_,_],
  [_,_,_,_,O,ZYh,ZYh,ZYh,ZYh,ZYh,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,F,O,_,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,F,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,F,O,_,_,_,_,_,_],
];
/** 仲达 — 超宽深紫帽檐（比脸宽很多） */
const HEAD_SM: PixelRow[] = [
  [_,_,_,_,_,O,SMh,SMh,SMh,O,_,_,_,_,_,_],
  [_,_,_,O,SMh,SMh,SMh,SMh,SMh,SMh,SMh,O,_,_,_,_],
  [_,_,O,SMh,SMh,SMh,SMh,SMh,SMh,SMh,SMh,SMh,O,_,_,_],
  [_,_,_,_,_,O,F,F,F,O,_,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,F,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,F,O,_,_,_,_,_,_],
];
/** 周瑜 — 红金帅盔（顶部金缨装饰） */
const HEAD_ZU: PixelRow[] = [
  [_,_,_,_,_,_,_,ZUg,_,_,_,_,_,_,_,_],
  [_,_,_,_,O,ZUh,ZUh,ZUg,ZUh,ZUh,O,_,_,_,_,_],
  [_,_,_,_,O,ZUh,ZUh,ZUh,ZUh,ZUh,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,F,O,_,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,F,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,F,O,_,_,_,_,_,_],
];
/** 关羽 — 绿巾＋红脸＋长须（下巴开始生须） */
const HEAD_GY: PixelRow[] = [
  [_,_,_,_,_,O,_,_,_,O,_,_,_,_,_,_],
  [_,_,_,_,O,GYh,GYh,GYh,GYh,GYh,O,_,_,_,_,_],
  [_,_,_,_,O,GYh,GYh,GYh,GYh,GYh,O,_,_,_,_,_],
  [_,_,_,_,_,O,GYs,GYs,GYs,O,_,_,_,_,_,_],
  [_,_,_,_,O,GYs,O,GYs,O,GYs,O,_,_,_,_,_],
  [_,_,_,_,_,O,GYs,GYb,GYs,O,_,_,_,_,_,_],
];
/** 张飞 — 超宽铁盔（方形轮廓）＋浓须 */
const HEAD_ZF: PixelRow[] = [
  [_,_,_,O,O,ZFh,ZFh,ZFh,ZFh,ZFh,O,O,_,_,_,_],
  [_,_,_,O,ZFh,ZFh,ZFh,ZFh,ZFh,ZFh,ZFh,O,_,_,_,_],
  [_,_,_,O,ZFh,ZFh,ZFh,ZFh,ZFh,ZFh,ZFh,O,_,_,_,_],
  [_,_,_,_,_,O,F,F,F,O,_,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,F,O,_,_,_,_,_],
  [_,_,_,_,O,O,F,ZFb,F,O,O,_,_,_,_,_],
];

/** 刘备 — 金冠双耳帽（皇帝范，两侧翼展） */
const HEAD_LB: PixelRow[] = [
  [_,_,_,_,LBh,O,LBh,LBh,LBh,O,LBh,_,_,_,_,_],
  [_,_,_,_,O,LBh,LBh,LBh,LBh,LBh,O,_,_,_,_,_],
  [_,_,_,_,O,LBh,LBh,LBh,LBh,LBh,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,F,O,_,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,F,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,F,O,_,_,_,_,_,_],
];
/** 曹操 — 暗红束冠（窄高冠+前额横带） */
const HEAD_CC: PixelRow[] = [
  [_,_,_,_,_,O,CCh,CCh,CCh,O,_,_,_,_,_,_],
  [_,_,_,_,O,CCh,CCh,CCh,CCh,CCh,O,_,_,_,_,_],
  [_,_,_,_,O,CCh,CCh,CCh,CCh,CCh,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,F,O,_,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,F,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,F,O,_,_,_,_,_,_],
];
/** 孙权 — 紫金帝冠（宽翼外展，顶部金饰） */
const HEAD_SQ: PixelRow[] = [
  [_,_,_,_,_,_,_,SQg,_,_,_,_,_,_,_,_],
  [_,_,_,O,SQh,SQh,SQh,SQg,SQh,SQh,SQh,O,_,_,_,_],
  [_,_,_,_,O,SQh,SQh,SQh,SQh,SQh,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,F,O,_,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,F,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,F,O,_,_,_,_,_,_],
];
/** 张辽 — 重型战盔（护颊宽，顶部尖） */
const HEAD_ZL: PixelRow[] = [
  [_,_,_,_,_,_,O,ZLh,O,_,_,_,_,_,_,_],
  [_,_,_,O,O,ZLh,ZLh,ZLh,ZLh,ZLh,O,O,_,_,_,_],
  [_,_,_,O,ZLh,ZLh,ZLh,ZLh,ZLh,ZLh,ZLh,O,_,_,_,_],
  [_,_,_,O,_,O,F,F,F,O,_,O,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,F,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,F,O,_,_,_,_,_,_],
];
/** 郭嘉 — 文士平巾（矮扁帽，儒雅） */
const HEAD_GJ: PixelRow[] = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,O,GJh,GJh,GJh,GJh,GJh,O,_,_,_,_,_],
  [_,_,_,_,O,GJh,GJh,GJh,GJh,GJh,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,F,O,_,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,F,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,F,O,_,_,_,_,_,_],
];
/** 黄盖 — 铁盔宽檐（老将风范，粗犷） */
const HEAD_HG: PixelRow[] = [
  [_,_,_,_,_,O,HGh,HGh,HGh,O,_,_,_,_,_,_],
  [_,_,_,O,HGh,HGh,HGh,HGh,HGh,HGh,HGh,O,_,_,_,_],
  [_,_,_,O,O,HGh,HGh,HGh,HGh,HGh,O,O,_,_,_,_],
  [_,_,_,_,_,O,F,F,F,O,_,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,F,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,F,O,_,_,_,_,_,_],
];
/** 鲁肃 — 文官帽（圆顶帽，文质彬彬） */
const HEAD_LS: PixelRow[] = [
  [_,_,_,_,_,_,LSh,LSh,LSh,_,_,_,_,_,_,_],
  [_,_,_,_,_,O,LSh,LSh,LSh,O,_,_,_,_,_,_],
  [_,_,_,_,O,LSh,LSh,LSh,LSh,LSh,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,F,O,_,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,F,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,F,O,_,_,_,_,_,_],
];

// ── 侧面武将头部（6行，朝左，右用flipX） ────────────────────────

/** 孔明侧面 — 高冠侧影 */
const SIDE_KM: PixelRow[] = [
  [_,_,_,_,_,_,O,KMh,O,_,_,_,_,_,_,_],
  [_,_,_,_,_,O,KMh,KMh,KMh,O,_,_,_,_,_,_],
  [_,_,_,_,O,KMh,KMh,KMh,KMh,KMh,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,O,O,_,_,_,_,_,_],
];
/** 子龙侧面 — 龙角盔侧影 */
const SIDE_ZY: PixelRow[] = [
  [_,_,_,_,_,O,ZYh,ZYh,ZYh,O,O,_,_,_,_,_],
  [_,_,_,_,_,O,ZYh,ZYh,ZYh,ZYh,O,_,_,_,_,_],
  [_,_,_,_,_,O,ZYh,ZYh,ZYh,ZYh,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,O,O,_,_,_,_,_,_],
];
/** 仲达侧面 — 超宽帽檐侧影 */
const SIDE_SM: PixelRow[] = [
  [_,_,_,_,O,SMh,SMh,SMh,SMh,O,_,_,_,_,_,_],
  [_,_,_,O,SMh,SMh,SMh,SMh,SMh,SMh,O,_,_,_,_,_],
  [_,_,O,SMh,SMh,SMh,SMh,SMh,SMh,SMh,SMh,O,_,_,_,_],
  [_,_,_,_,_,O,F,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,O,O,_,_,_,_,_,_],
];
/** 周瑜侧面 — 红盔金缨侧影 */
const SIDE_ZU: PixelRow[] = [
  [_,_,_,_,_,_,_,ZUg,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,O,ZUh,ZUg,ZUh,ZUh,O,_,_,_,_,_],
  [_,_,_,_,_,O,ZUh,ZUh,ZUh,ZUh,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,O,O,_,_,_,_,_,_],
];
/** 关羽侧面 — 绿巾+红脸+侧须 */
const SIDE_GY: PixelRow[] = [
  [_,_,_,_,_,_,O,O,O,O,_,_,_,_,_,_],
  [_,_,_,_,_,O,GYh,GYh,GYh,GYh,O,_,_,_,_,_],
  [_,_,_,_,_,O,GYh,GYh,GYh,GYh,O,_,_,_,_,_],
  [_,_,_,_,_,O,GYs,GYs,O,O,_,_,_,_,_,_],
  [_,_,_,_,O,GYs,O,GYs,O,O,_,_,_,_,_,_],
  [_,_,_,_,GYb,O,GYs,GYb,O,O,_,_,_,_,_,_],
];
/** 张飞侧面 — 宽铁盔+浓须侧影 */
const SIDE_ZF: PixelRow[] = [
  [_,_,_,_,O,ZFh,ZFh,ZFh,ZFh,ZFh,O,_,_,_,_,_],
  [_,_,_,O,ZFh,ZFh,ZFh,ZFh,ZFh,ZFh,ZFh,O,_,_,_,_],
  [_,_,_,O,ZFh,ZFh,ZFh,ZFh,ZFh,ZFh,ZFh,O,_,_,_,_],
  [_,_,_,_,_,O,F,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,ZFb,O,F,ZFb,O,O,_,_,_,_,_,_],
];

/** 刘备侧面 — 金冠双翼侧影 */
const SIDE_LB: PixelRow[] = [
  [_,_,_,_,_,LBh,O,LBh,LBh,O,_,_,_,_,_,_],
  [_,_,_,_,_,O,LBh,LBh,LBh,LBh,O,_,_,_,_,_],
  [_,_,_,_,_,O,LBh,LBh,LBh,LBh,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,O,O,_,_,_,_,_,_],
];
/** 曹操侧面 — 暗红束冠侧影 */
const SIDE_CC: PixelRow[] = [
  [_,_,_,_,_,O,CCh,CCh,CCh,O,_,_,_,_,_,_],
  [_,_,_,_,_,O,CCh,CCh,CCh,CCh,O,_,_,_,_,_],
  [_,_,_,_,_,O,CCh,CCh,CCh,CCh,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,O,O,_,_,_,_,_,_],
];
/** 孙权侧面 — 紫金帝冠侧影（宽翼） */
const SIDE_SQ: PixelRow[] = [
  [_,_,_,_,_,_,_,SQg,_,_,_,_,_,_,_,_],
  [_,_,_,_,O,SQh,SQh,SQg,SQh,SQh,O,_,_,_,_,_],
  [_,_,_,_,_,O,SQh,SQh,SQh,SQh,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,O,O,_,_,_,_,_,_],
];
/** 张辽侧面 — 重型战盔侧影（护颊宽） */
const SIDE_ZL: PixelRow[] = [
  [_,_,_,_,_,_,O,ZLh,O,_,_,_,_,_,_,_],
  [_,_,_,_,O,ZLh,ZLh,ZLh,ZLh,ZLh,O,_,_,_,_,_],
  [_,_,_,_,O,ZLh,ZLh,ZLh,ZLh,ZLh,ZLh,O,_,_,_,_],
  [_,_,_,_,O,_,O,F,F,O,O,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,O,O,_,_,_,_,_,_],
];
/** 郭嘉侧面 — 文士平巾侧影 */
const SIDE_GJ: PixelRow[] = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,O,GJh,GJh,GJh,GJh,O,_,_,_,_,_],
  [_,_,_,_,_,O,GJh,GJh,GJh,GJh,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,O,O,_,_,_,_,_,_],
];
/** 黄盖侧面 — 铁盔宽檐侧影 */
const SIDE_HG: PixelRow[] = [
  [_,_,_,_,_,O,HGh,HGh,HGh,O,_,_,_,_,_,_],
  [_,_,_,_,O,HGh,HGh,HGh,HGh,HGh,O,_,_,_,_,_],
  [_,_,_,_,O,O,HGh,HGh,HGh,HGh,O,O,_,_,_,_],
  [_,_,_,_,_,O,F,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,O,O,_,_,_,_,_,_],
];
/** 鲁肃侧面 — 文官帽侧影（圆顶） */
const SIDE_LS: PixelRow[] = [
  [_,_,_,_,_,_,LSh,LSh,LSh,_,_,_,_,_,_,_],
  [_,_,_,_,_,O,LSh,LSh,LSh,O,_,_,_,_,_,_],
  [_,_,_,_,_,O,LSh,LSh,LSh,LSh,O,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,O,F,O,F,O,O,_,_,_,_,_,_],
  [_,_,_,_,_,O,F,F,O,O,_,_,_,_,_,_],
];

// ── 精灵构建器 ──────────────────────────────────────────────────

/** 自定义头(6行) + 标准身体(10行)，可通过 ovr 覆盖身体行（如胡须） */
function buildFront(head: PixelRow[], a: string, g: string, walk: boolean, ovr?: Record<number, PixelRow>): PixelRow[] {
  const legs: PixelRow[] = walk ? [
    [_,_,_,O,a,O,_,_,O,a,O,_,_,_,_,_],
    [_,_,_,O,a,O,_,_,O,a,O,_,_,_,_,_],
    [_,_,_,O,a,O,_,_,O,a,O,_,_,_,_,_],
    [_,_,_,O,O,O,_,_,O,O,O,_,_,_,_,_],
  ] : [
    [_,_,_,_,O,a,a,a,a,a,O,_,_,_,_,_],
    [_,_,_,_,O,a,O,_,O,a,O,_,_,_,_,_],
    [_,_,_,_,O,a,O,_,O,a,O,_,_,_,_,_],
    [_,_,_,_,O,O,O,_,O,O,O,_,_,_,_,_],
  ];
  const body: PixelRow[] = [
    [_,_,_,O,O,a,a,a,a,a,O,O,_,_,_,_],
    [_,_,_,O,a,a,a,a,a,a,a,O,_,_,_,_],
    [_,_,_,O,a,O,O,O,O,O,a,O,_,_,_,_],
    [_,_,_,O,a,a,a,a,a,a,a,O,g,_,_,_],
    [_,_,_,O,a,O,O,O,O,O,a,O,g,_,_,_],
    [_,_,_,O,a,a,a,a,a,a,a,O,g,_,_,_],
    ...legs,
  ];
  if (ovr) { for (const [i, row] of Object.entries(ovr)) body[Number(i)] = row; }
  return [...head, ...body];
}

/** 自定义侧面头(6行) + 标准侧面身体(10行) */
function buildSide(head: PixelRow[], a: string, g: string, walk: boolean, ovr?: Record<number, PixelRow>): PixelRow[] {
  const legs: PixelRow[] = walk ? [
    [_,_,_,_,O,a,a,a,a,O,_,_,_,_,_,_],
    [_,_,_,_,O,a,O,O,a,O,_,_,_,_,_,_],
    [_,_,_,_,O,a,O,O,a,O,_,_,_,_,_,_],
    [_,_,_,_,O,O,O,O,O,O,_,_,_,_,_,_],
  ] : [
    [_,_,_,_,O,a,a,O,a,a,O,_,_,_,_,_],
    [_,_,_,_,O,a,O,O,O,a,O,_,_,_,_,_],
    [_,_,_,_,O,a,O,O,O,a,O,_,_,_,_,_],
    [_,_,_,_,O,O,O,_,O,O,O,_,_,_,_,_],
  ];
  const body: PixelRow[] = [
    [_,_,_,_,O,O,a,a,a,O,O,_,_,_,_,_],
    [_,_,_,_,O,a,a,a,a,a,O,_,_,_,_,_],
    [_,_,_,_,O,a,O,O,O,a,O,_,_,_,_,_],
    [_,_,_,_,O,a,a,a,a,a,O,g,_,_,_,_],
    [_,_,_,_,O,a,O,O,O,a,O,g,_,_,_,_],
    [_,_,_,_,O,a,a,a,a,a,O,g,_,_,_,_],
    ...legs,
  ];
  if (ovr) { for (const [i, row] of Object.entries(ovr)) body[Number(i)] = row; }
  return [...head, ...body];
}

/** 后面仅做颜色替换（背面看不到帽子细节） */
function bakeSprite(base: PixelRow[], helmet: PixelRow[], h: string, a: string, g: string, sk: string): PixelRow[] {
  return base.map((row, y) => row.map((cell, x) => {
    const hl = helmet[y]?.[x];
    if (hl === "#FFFFFF") return h;
    if (cell === W) return a;
    if (cell === G) return g;
    if (cell === F) return sk;
    return cell;
  }));
}

// ── 武将帧集合 ──────────────────────────────────────────────────

const WARRIOR_IDS = ["kongming", "zhaoyun", "simayi", "zhouyu", "guanyu", "zhangfei", "liubei", "caocao", "sunquan", "zhangliao", "guojia", "huanggai", "lusu"] as const;
export type WorldWarriorId = typeof WARRIOR_IDS[number];

type WDef = {
  head: PixelRow[]; sideHead: PixelRow[];
  h: string; a: string; g: string; sk: string;
  ovr?: Record<number, PixelRow>; sideOvr?: Record<number, PixelRow>;
};
const WDEFS: Record<string, WDef> = {
  kongming: { head: HEAD_KM, sideHead: SIDE_KM, h: KMh, a: KMh, g: KMg, sk: F },
  zhaoyun:  { head: HEAD_ZY, sideHead: SIDE_ZY, h: ZYh, a: ZYa, g: ZYg, sk: F },
  simayi:   { head: HEAD_SM, sideHead: SIDE_SM, h: SMh, a: SMa, g: SMg, sk: F },
  zhouyu:   { head: HEAD_ZU, sideHead: SIDE_ZU, h: ZUh, a: ZUh, g: ZUg, sk: F },
  guanyu:   { head: HEAD_GY, sideHead: SIDE_GY, h: GYh, a: GYh, g: GYg, sk: GYs,
              ovr: { 0: [_,_,_,O,O,GYh,GYb,GYb,GYb,GYh,O,O,_,_,_,_],
                      1: [_,_,_,O,GYh,GYh,GYb,GYb,GYb,GYh,GYh,O,_,_,_,_] },
              sideOvr: { 0: [_,_,_,_,O,O,GYh,GYb,GYh,O,O,_,_,_,_,_] } },
  zhangfei: { head: HEAD_ZF, sideHead: SIDE_ZF, h: ZFh, a: ZFa, g: ZFg, sk: F,
              ovr: { 0: [_,_,_,O,O,ZFa,ZFb,ZFb,ZFb,ZFa,O,O,_,_,_,_] },
              sideOvr: { 0: [_,_,_,_,O,O,ZFa,ZFb,ZFa,O,O,_,_,_,_,_] } },
  liubei:   { head: HEAD_LB, sideHead: SIDE_LB, h: LBh, a: LBa, g: LBg, sk: F },
  caocao:   { head: HEAD_CC, sideHead: SIDE_CC, h: CCh, a: CCa, g: CCg, sk: F },
  sunquan:  { head: HEAD_SQ, sideHead: SIDE_SQ, h: SQh, a: SQa, g: SQg, sk: F },
  zhangliao:{ head: HEAD_ZL, sideHead: SIDE_ZL, h: ZLh, a: ZLa, g: ZLg, sk: F },
  guojia:   { head: HEAD_GJ, sideHead: SIDE_GJ, h: GJh, a: GJa, g: GJg, sk: F },
  huanggai: { head: HEAD_HG, sideHead: SIDE_HG, h: HGh, a: HGa, g: HGg, sk: F },
  lusu:     { head: HEAD_LS, sideHead: SIDE_LS, h: LSh, a: LSa, g: LSg, sk: F },
};

/** 预构建：13 武将 × 6 方向帧（export 供 LandingPage 立绘展示使用） */
export const WARRIOR_FRAMES: Record<string, Record<string, PixelRow[]>> = {};
for (const id of WARRIOR_IDS) {
  const d = WDEFS[id];
  WARRIOR_FRAMES[id] = {
    front:      buildFront(d.head, d.a, d.g, false, d.ovr),
    front_walk: buildFront(d.head, d.a, d.g, true, d.ovr),
    back:       bakeSprite(BASE_BACK,      HELMET_BACK, d.h, d.a, d.g, d.sk),
    back_walk:  bakeSprite(BASE_BACK_WALK, HELMET_BACK, d.h, d.a, d.g, d.sk),
    side:       buildSide(d.sideHead, d.a, d.g, false, d.sideOvr),
    side_walk:  buildSide(d.sideHead, d.a, d.g, true, d.sideOvr),
  };
}

/** 注册武将专属世界精灵纹理（PreloadScene 调用） */
export function registerWarriorTextures(scene: Phaser.Scene): void {
  const textures = scene.textures;
  const add = (key: string, pixels: PixelRow[]) => {
    const c = document.createElement("canvas");
    c.width = 16;
    c.height = 16;
    renderPixels(c.getContext("2d")!, pixels);
    textures.addCanvas(key, c);
  };
  for (const id of WARRIOR_IDS) {
    const frames = WARRIOR_FRAMES[id];
    add(`warrior_${id}_front`,      frames.front);
    add(`warrior_${id}_front_walk`, frames.front_walk);
    add(`warrior_${id}_back`,       frames.back);
    add(`warrior_${id}_back_walk`,  frames.back_walk);
    add(`warrior_${id}_side`,       frames.side);
    add(`warrior_${id}_side_walk`,  frames.side_walk);
  }
}

/** 将像素数组绘制到 Canvas */
function renderPixels(ctx: CanvasRenderingContext2D, pixels: PixelRow[]) {
  for (let y = 0; y < pixels.length; y++) {
    for (let x = 0; x < pixels[y].length; x++) {
      const c = pixels[y][x];
      if (c) {
        ctx.fillStyle = c;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
}

/** 注册角色纹理到场景（4 方向） */
export function registerCharacterTextures(scene: Phaser.Scene): void {
  const textures = scene.textures;
  const add = (key: string, pixels: PixelRow[]) => {
    const c = document.createElement("canvas");
    c.width = 16;
    c.height = 16;
    renderPixels(c.getContext("2d")!, pixels);
    textures.addCanvas(key, c);
  };
  add("char_base_front", BASE_FRONT);
  add("char_base_front_walk", BASE_FRONT_WALK);
  add("char_base_back", BASE_BACK);
  add("char_base_back_walk", BASE_BACK_WALK);
  add("char_base_side", BASE_SIDE);
  add("char_base_side_walk", BASE_SIDE_WALK);
  add("char_helmet_front", HELMET_FRONT);
  add("char_helmet_back", HELMET_BACK);
  add("char_helmet_side", HELMET_SIDE);
  add("char_base", BASE_FRONT);
  add("char_helmet", HELMET_FRONT);
}

/** 角色布局常量 */
export const CHAR_LAYOUT = {
  scale: 2,
  depth: 400,
  labelOffsetY: 14,
} as const;

export type CharFacing = "front" | "back" | "left" | "right";

/** 根据朝向与走动帧设置 base/helmet 纹理（walkFrame: 0=站立双腿, 1=迈步单腿）
 *  warriorId: 武将 ID，有则使用烘焙武将纹理并隐藏 helmet 层 */
export function setCharFacing(
  base: Phaser.GameObjects.Sprite,
  helmet: Phaser.GameObjects.Sprite,
  facing: CharFacing,
  walkFrame = 0,
  warriorId?: string,
): void {
  const flipX = facing === "right";
  const w = walkFrame ? "_walk" : "";
  if (warriorId) {
    // 武将：使用烘焙纹理，隐藏独立 helmet 层
    helmet.setVisible(false);
    if (facing === "front") {
      base.setTexture(`warrior_${warriorId}_front${w}`);
      base.setFlipX(false);
    } else if (facing === "back") {
      base.setTexture(`warrior_${warriorId}_back${w}`);
      base.setFlipX(false);
    } else {
      base.setTexture(`warrior_${warriorId}_side${w}`);
      base.setFlipX(flipX);
    }
  } else {
    // 通用角色：双层结构
    helmet.setVisible(true);
    if (facing === "front") {
      base.setTexture(`char_base_front${w}`);
      helmet.setTexture("char_helmet_front");
      base.setFlipX(false);
    } else if (facing === "back") {
      base.setTexture(`char_base_back${w}`);
      helmet.setTexture("char_helmet_back");
      base.setFlipX(false);
    } else {
      base.setTexture(`char_base_side${w}`);
      helmet.setTexture("char_helmet_side");
      base.setFlipX(flipX);
      helmet.setFlipX(flipX);
    }
  }
}

/** 创建角色容器（base + helmet + label），body 用于上下浮动与朝向
 *  warriorId: 传入则使用烘焙武将纹理，不传则使用通用 tint 双层结构 */
export function createCharacterContainer(
  scene: Phaser.Scene,
  x: number,
  y: number,
  color: number,
  labelText: string,
  warriorId?: string,
): {
  container: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  body: Phaser.GameObjects.Container;
  base: Phaser.GameObjects.Sprite;
  helmet: Phaser.GameObjects.Sprite;
} {
  const { scale, depth, labelOffsetY } = CHAR_LAYOUT;

  const container = scene.add.container(x, y);
  const body = scene.add.container(0, 0);

  const initBase = warriorId ? `warrior_${warriorId}_front` : "char_base_front";
  const base = scene.add.sprite(0, 0, initBase);
  const helmet = scene.add.sprite(0, 0, "char_helmet_front");
  if (warriorId) {
    helmet.setVisible(false);  // 武将使用烘焙纹理，不需要单独 helmet 层
  } else {
    helmet.setTint(color);
  }
  body.add([base, helmet]);

  const label = scene.add.text(0, labelOffsetY, labelText, {
    fontSize: "5px",
    color: "#F8F8F8",
    fontStyle: "bold",
    backgroundColor: "#000000",
    padding: { x: 2, y: 1 },
  }).setOrigin(0.5, 0).setResolution(2);

  container.add([body, label]);
  container.setScale(scale);
  container.setDepth(depth);

  return { container, label, body, base, helmet };
}
