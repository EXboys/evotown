import Phaser from "phaser";
import { useEvotownStore } from "../store/evotownStore";
import { evotownEvents } from "./events";
import { createCharacterContainer, setCharFacing, type CharFacing } from "./characterAssets";
import { getWarriorForAgent } from "./warriorPortraits";
import { TaskNpcManager, getRandomWanderPoint } from "./taskNpc";
import { NES } from "./nesColors";
import {
  BUILDINGS,
  createBuilding,
  createCastle,
  drawPaths,
  drawRiverAndPond,
  drawForestClusters,
  drawMountainClusters,
  VIEW_SCALE_Y,
  VIEW_FILL_SCALE,
  LABEL_TO_XY,
  TO_LABEL,
} from "./sceneAssets";

type TaskPhase = "idle" | "accept" | "execute" | "deliver";

interface AgentState {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Container;
  base: Phaser.GameObjects.Sprite;
  helmet: Phaser.GameObjects.Sprite;
  target: { x: number; y: number };
  label: Phaser.GameObjects.Text;
  displayName: string;
  color: number;
  warriorId: string;
  phaseOffset: number;
  taskPhase: TaskPhase;
  wanderTimer: number;
  facing: CharFacing;
  pendingBalance: number | null;
  eliminating: boolean;
  /** 救援状态：施救中暂存原目标，救援完成后恢复 */
  rescueTarget?: { x: number; y: number };
  /** 队伍旗帜（小色块，显示在脚底） */
  teamFlag?: Phaser.GameObjects.Graphics;
  teamId?: string;
}

export default class TownScene extends Phaser.Scene {
  private agents: Map<string, AgentState> = new Map();
  /** 12 色高区分度调色板：红/橙/黄/绿/青/蓝/紫/品红/粉，按 agentId 哈希稳定分配 */
  private agentColors: number[] = [
    0xef4444, 0xf97316, 0xeab308, 0x22c55e, 0x06b6d4, 0x3b82f6,
    0x8b5cf6, 0xd946ef, 0xec4899, 0xf43f5e, 0x14b8a6, 0x84cc16,
  ];
  private buildingRects: Map<string, Phaser.GameObjects.Container> = new Map();
  private worldContainer!: Phaser.GameObjects.Container;
  private worldInner!: Phaser.GameObjects.Container;
  private taskNpcManager!: TaskNpcManager;
  private eventHandlers: Array<{
    ev: "sprite_move" | "task_complete" | "agent_eliminated" | "agent_created" | "evolution_event" | "task_available" | "task_taken" | "task_expired" | "team_formed" | "rescue_event" | "agent_last_stand" | "subtitle_broadcast" | "agent_defected" | "team_creed_generated";
    fn: (d: unknown) => void;
  }> = [];

  // ── 字幕 HUD ──────────────────────────────────────────────────────────────
  private subtitleQueue: Array<{ text: string; level: string }> = [];
  private subtitlePlaying = false;
  private subtitleContainer!: Phaser.GameObjects.Container;
  private subtitleText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "TownScene" });
  }

  shutdown() {
    this.eventHandlers.forEach(({ ev, fn }) => evotownEvents.off(ev, fn as never));
    this.eventHandlers = [];
  }

  create() {
    const w = this.scale.width;
    const h = this.scale.height;

    // 世界容器 — 45° 俯视 Y 轴压缩
    this.worldInner = this.add.container(0, 0);
    this.worldInner.setScale(1, VIEW_SCALE_Y);
    this.worldContainer = this.add.container(w / 2, h / 2);
    this.worldContainer.setScale(1, VIEW_FILL_SCALE);
    this.worldContainer.add(this.worldInner);

    const cx = w / 2;
    const cy = h / 2;

    // 1. 地形层 — NES 草地
    const grass = this.add.tileSprite(0, 0, w + 64, h + 64, "grass");
    grass.setTileScale(1);
    this.worldInner.add(grass);

    // 2. 道路层
    drawPaths(this, this.worldInner, cx, cy);

    // 3. 河流
    drawRiverAndPond(this, this.worldInner, cx, cy);

    // 4. 装饰层 — 散落小石头
    const stonePositions = [
      { x: 255, y: 200 }, { x: 385, y: 280 },
      { x: 200, y: 240 }, { x: 440, y: 224 },
      { x: 280, y: 360 }, { x: 360, y: 120 },
      { x: 170, y: 300 }, { x: 460, y: 290 },
    ];
    stonePositions.forEach(({ x, y }) => {
      const stone = this.add.image(x - cx, y - cy, "stone");
      this.worldInner.add(stone);
    });

    // 5. 森林/山脉层 — 前后层叠
    drawForestClusters(this, this.worldInner, cx, cy);
    drawMountainClusters(this, this.worldInner, cx, cy);

    // 6. 建筑层（跳过任务中心，由分散 NPC 替代）
    Object.entries(BUILDINGS).forEach(([key, b]) => {
      if (key === "task") return;
      const container = key === "square"
        ? createCastle(this, b.x - cx, b.y - cy, b.label)
        : createBuilding(this, key, b.x - cx, b.y - cy, b.w, b.h, b.roof, b.label, b.color);
      this.worldInner.add(container);
      this.buildingRects.set(key, container);
    });

    // 6b. 任务 NPC 层 — 有任务才出现，任务数 = NPC 数，一一对应
    this.taskNpcManager = new TaskNpcManager({
      scene: this,
      parent: this.worldInner,
      originX: cx,
      originY: cy,
    });

    // 7. UI 覆盖层 — NES 黑底白边标题栏
    const titleBg = this.add.graphics();
    titleBg.fillStyle(NES.BLACK, 1);
    titleBg.fillRect(0, 0, w, 24);
    titleBg.lineStyle(1, NES.WHITE, 1);
    titleBg.strokeRect(0, 0, w, 24);
    titleBg.setDepth(900);
    titleBg.setScrollFactor(0);
    const titleText = this.add.text(w / 2, 12, "EVOTOWN", {
      fontSize: "14px",
      color: "#F8F8F8",
      fontStyle: "bold",
    }).setOrigin(0.5).setResolution(2);
    titleText.setDepth(901);
    titleText.setScrollFactor(0);

    // ── 字幕 HUD（底部固定栏）────────────────────────────────────────────────
    const subBg = this.add.graphics();
    subBg.fillStyle(0x000000, 0.82);
    subBg.fillRect(0, h - 36, w, 36);
    subBg.lineStyle(2, 0xf97316, 1);
    subBg.strokeRect(0, h - 36, w, 36);
    subBg.setDepth(950).setScrollFactor(0);
    this.subtitleText = this.add.text(w + 20, h - 18, "", {
      fontSize: "13px",
      color: "#fbbf24",
      fontStyle: "bold",
    }).setOrigin(0, 0.5).setDepth(951).setScrollFactor(0).setResolution(2);
    this.subtitleContainer = this.add.container(0, 0, [subBg, this.subtitleText]);
    this.subtitleContainer.setDepth(950).setScrollFactor(0).setVisible(false);

    // 事件订阅
    const h1 = (d: { agent_id: string; from: string; to: string; reason: string }) => this.onSpriteMove(d);
    const h2 = (d: { agent_id: string; success: boolean; balance: number }) => this.onTaskComplete(d);
    const h3 = (d: { agent_id: string; reason: string }) => this.onAgentEliminated(d);
    const h4 = (d: { agent_id: string; balance: number; display_name?: string }) => this.onAgentCreated(d);
    const h5 = (d: { agent_id: string; type?: string; [k: string]: unknown }) => this.onEvolutionEvent(d);
    const h6 = (d: { task_id: string; task: string; difficulty: string }) => this.onTaskAvailable(d);
    const h7 = (d: { task_id: string; agent_id: string; task: string }) => this.onTaskTaken(d);
    const h8 = (d: { task_id: string; task: string }) => this.onTaskExpired(d);
    const h9 = (d: { teams: { team_id: string; name: string; members: { agent_id: string; display_name: string }[] }[] }) => this.onTeamFormed(d);
    const h10 = (d: { donor_id: string; donor_display_name: string; target_id: string; target_display_name: string; amount: number; team_id: string; team_name: string }) => this.onRescueEvent(d);
    const h11 = (d: { agent_id: string; display_name: string; balance: number }) => this.onAgentLastStand(d);
    const h12 = (d: { text: string; level: string }) => this.pushSubtitle(d.text, d.level);
    const h13 = (d: { agent_id: string; display_name: string; old_team_id: string; old_team_name: string; new_team_id: string; new_team_name: string }) => this.onAgentDefected(d);
    const h14 = (d: { team_id: string; team_name: string; creed: string }) => this.onTeamCreedGenerated(d);
    evotownEvents.on("sprite_move", h1);
    evotownEvents.on("task_complete", h2);
    evotownEvents.on("agent_eliminated", h3);
    evotownEvents.on("agent_created", h4);
    evotownEvents.on("evolution_event", h5);
    evotownEvents.on("task_available", h6);
    evotownEvents.on("task_taken", h7);
    evotownEvents.on("task_expired", h8);
    evotownEvents.on("team_formed", h9);
    evotownEvents.on("rescue_event", h10);
    evotownEvents.on("agent_last_stand", h11);
    evotownEvents.on("subtitle_broadcast", h12);
    evotownEvents.on("agent_defected", h13);
    evotownEvents.on("team_creed_generated", h14);
    this.eventHandlers = [
      { ev: "sprite_move", fn: h1 as (d: unknown) => void },
      { ev: "task_complete", fn: h2 as (d: unknown) => void },
      { ev: "agent_eliminated", fn: h3 as (d: unknown) => void },
      { ev: "agent_created", fn: h4 as (d: unknown) => void },
      { ev: "evolution_event", fn: h5 as (d: unknown) => void },
      { ev: "task_available", fn: h6 as (d: unknown) => void },
      { ev: "task_taken", fn: h7 as (d: unknown) => void },
      { ev: "task_expired", fn: h8 as (d: unknown) => void },
      { ev: "team_formed", fn: h9 as (d: unknown) => void },
      { ev: "rescue_event", fn: h10 as (d: unknown) => void },
      { ev: "agent_last_stand", fn: h11 as (d: unknown) => void },
      { ev: "subtitle_broadcast", fn: h12 as (d: unknown) => void },
      { ev: "agent_defected", fn: h13 as (d: unknown) => void },
      { ev: "team_creed_generated", fn: h14 as (d: unknown) => void },
    ];

    this.time.delayedCall(150, () => {
      evotownEvents.emit("phaser_ready", {});
      this.syncAvailableTasksFromStore();
    });
  }

  private onEvolutionEvent(data: { agent_id: string; event_type?: string; [k: string]: unknown }) {
    const w = this.scale.width;
    const h = this.scale.height;
    const cx = w / 2;
    const cy = h / 2;
    const et = data.event_type as string;

    // ── 1. 神殿建筑强脉冲（连跳3次）──────────────────────────────────
    const templeContainer = this.buildingRects.get("temple");
    if (templeContainer) {
      this.tweens.add({
        targets: templeContainer,
        scaleX: 1.3,
        scaleY: 1.3,
        duration: 180,
        yoyo: true,
        repeat: 2,
        ease: "Power2",
      });
    }

    // ── 2. 全屏金色大闪光 ──────────────────────────────────────────
    this.cameras.main.flash(500, 255, 210, 50, false);

    // ── 3. 神殿位置金色扩散光环 ────────────────────────────────────
    // temple 屏幕坐标：scale 互消后 = (500, 100)
    const tSX = BUILDINGS.temple.x;
    const tSY = BUILDINGS.temple.y;
    const ringGfx = this.add.graphics();
    ringGfx.setDepth(850);
    let ringR = 4;
    const ringTick = this.time.addEvent({
      delay: 16,
      repeat: 28,
      callback: () => {
        ringGfx.clear();
        const alpha = Math.max(0, 1 - ringR / 220);
        ringGfx.lineStyle(3, NES.GOLD, alpha);
        ringGfx.strokeCircle(tSX, tSY, ringR);
        ringR += 8;
      },
      callbackScope: this,
    });
    this.time.delayedCall(500, () => { ringTick.destroy(); ringGfx.destroy(); });

    // ── 4. 粒子喷射（12颗金色小方块射出）──────────────────────────
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const spark = this.add.graphics();
      spark.fillStyle(NES.GOLD, 1);
      spark.fillRect(-3, -3, 6, 6);
      spark.setDepth(851);
      spark.x = tSX;
      spark.y = tSY;
      const dist = 55 + Math.random() * 50;
      this.tweens.add({
        targets: spark,
        x: tSX + Math.cos(angle) * dist,
        y: tSY + Math.sin(angle) * dist,
        alpha: 0,
        duration: 550 + Math.random() * 250,
        ease: "Cubic.easeOut",
        onComplete: () => spark.destroy(),
      });
    }

    // ── 5. 角色头顶气泡（放大 + 停留 8 秒 + 字体加粗）──────────────
    const agent = this.agents.get(data.agent_id);
    if (agent) {
      const msg = et === "rule_added" ? "🧠 学到了新规则！"
        : et === "skill_generated" ? "⚡ 生成了新技能！"
        : "✨ 进化完成！";
      const bubble = this.add.container(
        cx + agent.container.x,
        cy + agent.container.y * VIEW_SCALE_Y - 32,
      );
      bubble.setScale(0.3);
      bubble.setDepth(800);
      const bg = this.add.graphics();
      bg.fillStyle(NES.BLACK, 1);
      bg.fillRect(-68, -14, 136, 28);
      bg.lineStyle(2, NES.GOLD, 1);
      bg.strokeRect(-68, -14, 136, 28);
      const txt = this.add.text(0, 0, msg, {
        fontSize: "13px",
        color: "#FBBF24",
        fontStyle: "bold",
      }).setOrigin(0.5).setResolution(2);
      bubble.add([bg, txt]);
      // 弹出动画
      this.tweens.add({
        targets: bubble,
        scaleX: 1,
        scaleY: 1,
        duration: 250,
        ease: "Back.easeOut",
      });
      // 8 秒后淡出销毁
      this.time.delayedCall(7500, () => {
        this.tweens.add({
          targets: bubble,
          alpha: 0,
          y: bubble.y - 12,
          duration: 500,
          ease: "Cubic.easeIn",
          onComplete: () => bubble.destroy(),
        });
      });
    }

    // ── 6. 左上角 Toast 通知 ────────────────────────────────────────
    const agentName = this.agents.get(data.agent_id)?.displayName ?? data.agent_id;
    const toastMsg = et === "rule_added" ? `🧠 ${agentName} 获得新规则！`
      : et === "skill_generated" ? `⚡ ${agentName} 生成新技能！`
      : `✨ ${agentName} 进化完成！`;
    const toast = this.add.container(-200, 30);
    toast.setDepth(950);
    toast.setScrollFactor(0);
    const toastBg = this.add.graphics();
    toastBg.fillStyle(NES.BLACK, 0.92);
    toastBg.fillRect(0, 0, 188, 28);
    toastBg.lineStyle(2, NES.GOLD, 1);
    toastBg.strokeRect(0, 0, 188, 28);
    const toastTxt = this.add.text(94, 14, toastMsg, {
      fontSize: "11px",
      color: "#FBBF24",
      fontStyle: "bold",
    }).setOrigin(0.5).setResolution(2);
    toast.add([toastBg, toastTxt]);
    // 从左侧滑入
    this.tweens.add({
      targets: toast,
      x: 10,
      duration: 300,
      ease: "Cubic.easeOut",
    });
    // 3.5 秒后滑出销毁
    this.time.delayedCall(3500, () => {
      this.tweens.add({
        targets: toast,
        x: -220,
        duration: 350,
        ease: "Cubic.easeIn",
        onComplete: () => toast.destroy(),
      });
    });
  }

  private onAgentCreated(data: { agent_id: string; balance: number; display_name?: string }) {
    const agent = this.getOrCreateAgent(data.agent_id, data.display_name);
    if (data.display_name && agent.displayName !== data.display_name) {
      agent.displayName = data.display_name;
      agent.label.setText(this.agentLabel(data.display_name, data.agent_id));
    }
  }

  private onTaskAvailable(data: { task_id: string; task: string; difficulty: string }) {
    this.taskNpcManager.spawnForTask(data.task_id);
  }

  private onTaskTaken(data: { task_id: string; agent_id: string; task: string }) {
    this.taskNpcManager.assignAgentToTaskNpc(data.agent_id, data.task_id);
  }

  private onTaskExpired(data: { task_id: string; task: string }) {
    this.taskNpcManager.despawnByTaskId(data.task_id);
  }

  private syncAvailableTasksFromStore() {
    const tasks = useEvotownStore.getState().availableTasks;
    tasks.forEach((t) => this.taskNpcManager.spawnForTask(t.task_id));
  }

  /** 生成标签文本：主游戏界面只显示 agent_name */
  private agentLabel(displayName: string, _agentId: string): string {
    return displayName;
  }

  /** 将 team_id 哈希映射到阵营颜色（与 Leaderboard/SocialGraph 一致） */
  private teamHexColor(teamId: string): number {
    const hash = teamId.split("").reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0);
    const palette = [0xef4444, 0x3b82f6, 0x22c55e, 0xf97316, 0x8b5cf6, 0xeab308];
    return palette[Math.abs(hash) % palette.length];
  }

  /** 结阵事件：为每个 agent 添加/更新队伍彩色旗帜 */
  private onTeamFormed(data: { teams: { team_id: string; name: string; members: { agent_id: string; display_name: string }[] }[] }) {
    data.teams.forEach((team) => {
      const color = this.teamHexColor(team.team_id);
      team.members.forEach((m) => {
        const agent = this.agents.get(m.agent_id);
        if (!agent) return;
        agent.teamId = team.team_id;
        // 若旗帜已存在则更新颜色，否则创建新的
        if (agent.teamFlag) {
          agent.teamFlag.clear();
        } else {
          const flag = this.add.graphics();
          // 旗帜固定在角色脚底下方（容器局部坐标：y = +14, 宽6高4）
          agent.container.add(flag);
          agent.teamFlag = flag;
        }
        const flag = agent.teamFlag!;
        flag.fillStyle(color, 1);
        flag.fillRect(-3, 14, 6, 4);
        flag.lineStyle(1, 0x000000, 0.6);
        flag.strokeRect(-3, 14, 6, 4);
      });
    });

    // 结阵气泡提示（在城池中心位置）
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const bubble = this.add.container(cx, cy - 60);
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.88);
    bg.fillRect(-70, -12, 140, 24);
    bg.lineStyle(2, 0xf97316, 1);
    bg.strokeRect(-70, -12, 140, 24);
    const txt = this.add.text(0, 0, `⚔ 结阵完成 — ${data.teams.length} 支队伍`, {
      fontSize: "10px", color: "#f97316", fontStyle: "bold",
    }).setOrigin(0.5).setResolution(2);
    bubble.add([bg, txt]);
    bubble.setDepth(950);
    this.tweens.add({
      targets: bubble, y: bubble.y - 24, alpha: 0, duration: 2500,
      ease: "Cubic.easeOut", delay: 800,
      onComplete: () => bubble.destroy(),
    });
  }

  /** 救援事件：施救者快速走向受救者，显示爱心+金币特效 */
  private onRescueEvent(data: { donor_id: string; donor_display_name: string; target_id: string; target_display_name: string; amount: number; team_id: string; team_name: string }) {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const donor = this.agents.get(data.donor_id);
    const target = this.agents.get(data.target_id);
    if (!donor || !target || donor.eliminating) return;

    // 保存施救者原始目标（救援完成后恢复闲逛）
    donor.rescueTarget = { ...donor.target };
    // 施救者快速奔向受救者
    donor.taskPhase = "execute";
    donor.target = { x: target.container.x + 10, y: target.container.y };

    // 350ms 后在受救者位置爆出爱心+金币
    this.time.delayedCall(350, () => {
      if (!target || target.eliminating) return;
      const screenX = cx + target.container.x;
      const screenY = cy + target.container.y * VIEW_SCALE_Y - 24;
      const bubble = this.add.container(screenX, screenY);

      const bg = this.add.graphics();
      bg.fillStyle(0x000000, 0.85);
      bg.fillRect(-46, -12, 92, 24);
      bg.lineStyle(2, 0x22c55e, 1);
      bg.strokeRect(-46, -12, 92, 24);
      const heart = this.add.text(-32, 0, "❤", { fontSize: "12px" }).setOrigin(0.5).setResolution(2);
      const coin = this.add.text(-14, 0, "🪙", { fontSize: "12px" }).setOrigin(0.5).setResolution(2);
      const txt = this.add.text(16, 0, `+${data.amount}`, {
        fontSize: "10px", color: "#22c55e", fontStyle: "bold",
      }).setOrigin(0.5).setResolution(2);
      bubble.add([bg, heart, coin, txt]);
      bubble.setDepth(950);
      this.tweens.add({
        targets: bubble, y: bubble.y - 30, alpha: 0, duration: 2000,
        ease: "Cubic.easeOut",
        onComplete: () => bubble.destroy(),
      });

      // 柔和相机震动 + 金色 flash（比死亡动画温和）
      this.cameras.main.shake(300, 0.004);
      this.cameras.main.flash(300, 251, 191, 36, false); // NES.GOLD 金色

      // 施救者救援完成后恢复闲逛
      if (donor.rescueTarget) {
        donor.target = donor.rescueTarget;
        donor.rescueTarget = undefined;
        donor.taskPhase = "idle";
      }
    });
  }

  private getOrCreateAgent(agentId: string, displayName?: string): AgentState {
    let agent = this.agents.get(agentId);
    if (!agent) {
      const hash = agentId.split("").reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0);
      const color = this.agentColors[Math.abs(hash) % this.agentColors.length];
      const cx = this.scale.width / 2;
      const cy = this.scale.height / 2;
      // 无任务时到处闲逛：出生点随机分布在地图各处，不聚集在城池
      const spawn = getRandomWanderPoint();
      const name = displayName || agentId;
      const labelText = this.agentLabel(name, agentId);
      // 根据名字确定武将 ID，注入专属精灵
      const warriorId = getWarriorForAgent(name);
      const { container, label, body, base, helmet } = createCharacterContainer(
        this,
        spawn.x - cx,
        spawn.y - cy,
        color,
        labelText,
        warriorId,
      );
      this.worldInner.add(container);
      const wander = getRandomWanderPoint();
      agent = {
        container,
        body,
        base,
        helmet,
        target: { x: wander.x - cx, y: wander.y - cy },
        label,
        displayName: name,
        color,
        warriorId,
        phaseOffset: Math.random() * Math.PI * 2,
        taskPhase: "idle",
        wanderTimer: 0,
        facing: "front",
        pendingBalance: null,
        eliminating: false,
      };
      this.agents.set(agentId, agent);
    }
    return agent!;
  }

  private onSpriteMove(data: { agent_id: string; from: string; to: string; reason: string }) {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const agent = this.getOrCreateAgent(data.agent_id);
    if (agent.eliminating) return;

    // deliver 阶段不响应新的 sprite_move（正在回 NPC 交付）
    if (agent.taskPhase === "deliver") return;

    // 去任务中心 → accept 阶段：生成 NPC，agent 走向 NPC
    if (data.to === "任务中心") {
      agent.taskPhase = "accept";
      const npcPos = this.taskNpcManager.assignToAgent(data.agent_id);
      if (npcPos) {
        agent.target = { x: npcPos.x - cx, y: npcPos.y - cy };
      } else {
        agent.taskPhase = "idle";
        const wander = getRandomWanderPoint();
        agent.target = { x: wander.x - cx, y: wander.y - cy };
      }
      return;
    }

    // 广场/城池 = 闲逛
    if (["广场", "城池", "中央广场"].includes(data.to)) {
      agent.taskPhase = "idle";
      const wander = getRandomWanderPoint();
      agent.target = { x: wander.x - cx, y: wander.y - cy };
      return;
    }

    // 任务建筑（图书馆/工坊/档案馆/记忆仓库）→ execute 阶段
    const key = TO_LABEL[data.to];
    const taskBuildings = ["library", "workshop", "archive", "memory"];
    if (key && LABEL_TO_XY[key] && taskBuildings.includes(key)) {
      agent.taskPhase = "execute";
      this.taskNpcManager.assignToAgent(data.agent_id);
      const pos = LABEL_TO_XY[key];
      agent.target = { x: pos.x - cx, y: pos.y - cy + 12 };
      return;
    }

    // 进化神殿等其它建筑
    if (key && LABEL_TO_XY[key]) {
      agent.taskPhase = "execute";
      const pos = LABEL_TO_XY[key];
      agent.target = { x: pos.x - cx, y: pos.y - cy + 12 };
      return;
    }

    // 兜底：闲逛
    agent.taskPhase = "idle";
    const wander = getRandomWanderPoint();
    agent.target = { x: wander.x - cx, y: wander.y - cy };
  }

  private onTaskComplete(data: { agent_id: string; success: boolean; balance: number }) {
    const agent = this.agents.get(data.agent_id);
    if (!agent) {
      this.taskNpcManager.despawnByAgent(data.agent_id);
      return;
    }

    // deliver 阶段：先存余额，走回 NPC 交付后再更新显示
    agent.pendingBalance = data.balance;
    const npcPos = this.taskNpcManager.getAssignedNpcPosition(data.agent_id);
    if (npcPos) {
      agent.taskPhase = "deliver";
      const cx = this.scale.width / 2;
      const cy = this.scale.height / 2;
      agent.target = { x: npcPos.x - cx, y: npcPos.y - cy };
    } else {
      // 没有 NPC（边界情况）直接完成
      agent.pendingBalance = null;
      agent.taskPhase = "idle";
      const cx = this.scale.width / 2;
      const cy = this.scale.height / 2;
      const wander = getRandomWanderPoint();
      agent.target = { x: wander.x - cx, y: wander.y - cy };
      this.taskNpcManager.despawnByAgent(data.agent_id);
    }
  }

  private onAgentEliminated(data: { agent_id: string; reason?: string }) {
    const agent = this.agents.get(data.agent_id);
    if (!agent || agent.eliminating) return;

    // 回放切换时立即清除，不播放死亡动画
    if (data.reason === "replay_clear" || data.reason === "replay_end") {
      agent.container.destroy();
      this.agents.delete(data.agent_id);
      return;
    }

    agent.eliminating = true;
    agent.taskPhase = "idle"; // 停止移动

    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const screenX = cx + agent.container.x;
    const screenY = cy + agent.container.y * VIEW_SCALE_Y;

    // Step 1: 红色闪烁（3次）
    this.tweens.add({
      targets: agent.container,
      alpha: 0.2,
      duration: 120,
      yoyo: true,
      repeat: 4,
      ease: "Linear",
      onStart: () => {
        agent.base.setTint(0xff2222);
        agent.helmet.setTint(0xff2222);
      },
    });

    // Step 2: 骷髅气泡「兵败身死」+ 「气数已尽」文言文 + 像素骷髅旗
    this.time.delayedCall(200, () => {
      const name = agent.displayName;

      // 主气泡：💀 兵败身死
      const bubble = this.add.container(screenX, screenY - 30);
      const bg = this.add.graphics();
      bg.fillStyle(0x000000, 0.92);
      bg.fillRect(-60, -14, 120, 28);
      bg.lineStyle(2, 0xff4444, 1);
      bg.strokeRect(-60, -14, 120, 28);
      const skull = this.add.text(-46, 0, "💀", { fontSize: "14px" }).setOrigin(0.5).setResolution(2);
      const txt = this.add.text(12, 0, `${name} 兵败身死`, {
        fontSize: "9px",
        color: "#FF4444",
        fontStyle: "bold",
      }).setOrigin(0.5).setResolution(2);
      bubble.add([bg, skull, txt]);
      bubble.setDepth(900);
      this.tweens.add({
        targets: bubble,
        y: bubble.y - 30,
        alpha: 0,
        duration: 2500,
        ease: "Cubic.easeOut",
        onComplete: () => bubble.destroy(),
      });

      // 「气数已尽」向上飘散
      const qishu = this.add.text(screenX, screenY - 58, "气数已尽", {
        fontSize: "11px",
        color: "#ff8888",
        fontStyle: "bold",
      }).setOrigin(0.5).setDepth(902).setResolution(2);
      this.tweens.add({
        targets: qishu,
        y: qishu.y - 32,
        alpha: 0,
        duration: 3000,
        ease: "Cubic.easeOut",
        onComplete: () => qishu.destroy(),
      });

      // 像素骷髅旗：死亡位置，持续 5 秒后淡出
      const skullFlag = this.add.container(screenX, screenY);
      skullFlag.setDepth(750);
      const pole = this.add.graphics();
      pole.fillStyle(0x888888, 1);
      pole.fillRect(-1, -22, 2, 22); // 竖杆
      const flagBg = this.add.graphics();
      flagBg.fillStyle(0x111111, 0.95);
      flagBg.fillRect(-11, -34, 22, 14);
      flagBg.lineStyle(1, 0xff4444, 1);
      flagBg.strokeRect(-11, -34, 22, 14);
      const flagSkull = this.add.text(0, -27, "💀", { fontSize: "9px" }).setOrigin(0.5).setResolution(2);
      skullFlag.add([pole, flagBg, flagSkull]);
      // 5 秒后淡出销毁
      this.time.delayedCall(5000, () => {
        this.tweens.add({
          targets: skullFlag,
          alpha: 0,
          duration: 600,
          ease: "Linear",
          onComplete: () => skullFlag.destroy(),
        });
      });
    });

    // Step 3: 相机震动
    this.time.delayedCall(300, () => {
      this.cameras.main.shake(400, 0.008);
      this.cameras.main.flash(300, 255, 0, 0, false);
    });

    // Step 4: 精灵渐隐消失
    this.time.delayedCall(600, () => {
      this.tweens.add({
        targets: agent.container,
        alpha: 0,
        scaleX: 0.5,
        scaleY: 0.5,
        duration: 1200,
        ease: "Power2",
        onComplete: () => {
          agent.container.destroy();
          this.agents.delete(data.agent_id);
        },
      });
    });
  }

  /** 最后一战：agent 头顶红色脉冲圈 + 全屏血色 flash */
  private onAgentLastStand(data: { agent_id: string; display_name: string; balance: number }) {
    const agent = this.agents.get(data.agent_id);
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    // 全屏血红 flash
    this.cameras.main.flash(500, 200, 0, 0, false);
    this.cameras.main.shake(250, 0.006);

    if (agent && !agent.eliminating) {
      const screenX = cx + agent.container.x;
      const screenY = cy + agent.container.y * VIEW_SCALE_Y;

      // 红色脉冲圈（3层扩散）
      for (let i = 0; i < 3; i++) {
        const ring = this.add.graphics();
        ring.lineStyle(3, 0xff2222, 1);
        ring.strokeCircle(0, 0, 14);
        ring.setPosition(screenX, screenY - 8);
        ring.setDepth(870);
        this.tweens.add({
          targets: ring,
          scaleX: 3.5,
          scaleY: 3.5,
          alpha: 0,
          duration: 700,
          ease: "Cubic.easeOut",
          delay: i * 200,
          onComplete: () => ring.destroy(),
        });
      }

      // 「垂死挣扎」气泡
      const bubble = this.add.container(screenX, screenY - 36);
      const bg = this.add.graphics();
      bg.fillStyle(0x1a0000, 0.95);
      bg.fillRect(-52, -13, 104, 26);
      bg.lineStyle(2, 0xff2222, 1);
      bg.strokeRect(-52, -13, 104, 26);
      const txt = this.add.text(0, 0, `⚔ ${data.display_name} 最后一战！`, {
        fontSize: "9px", color: "#ff6666", fontStyle: "bold",
      }).setOrigin(0.5).setResolution(2);
      bubble.add([bg, txt]);
      bubble.setDepth(900);
      this.tweens.add({
        targets: bubble, y: bubble.y - 28, alpha: 0,
        duration: 2800, ease: "Cubic.easeOut", delay: 600,
        onComplete: () => bubble.destroy(),
      });

      // 精灵本身闪烁红色（5次）
      this.tweens.add({
        targets: agent.container,
        alpha: 0.15, duration: 100, yoyo: true, repeat: 5, ease: "Linear",
        onStart: () => { agent.base.setTint(0xff1111); agent.helmet.setTint(0xff1111); },
        onComplete: () => { agent.base.clearTint(); agent.helmet.clearTint(); },
      });
    }
  }

  /** 叛逃动画：红色「叛逃！」气泡 + 精灵橙闪 + 冲向地图中央（象征去往新队伍）*/
  private onAgentDefected(data: { agent_id: string; display_name: string; old_team_id: string; old_team_name: string; new_team_id: string; new_team_name: string }) {
    const agent = this.agents.get(data.agent_id);
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    // 全屏橙色 flash + 镜头轻震
    this.cameras.main.flash(400, 200, 80, 0, false);
    this.cameras.main.shake(300, 0.005);

    if (agent && !agent.eliminating) {
      const screenX = cx + agent.container.x;
      const screenY = cy + agent.container.y * VIEW_SCALE_Y;

      // 红色扩散圆环（2层）
      for (let i = 0; i < 2; i++) {
        const ring = this.add.graphics();
        ring.lineStyle(3, 0xff6600, 1);
        ring.strokeCircle(0, 0, 14);
        ring.setPosition(screenX, screenY - 8);
        ring.setDepth(870);
        this.tweens.add({
          targets: ring,
          scaleX: 3.2, scaleY: 3.2, alpha: 0,
          duration: 650, ease: "Cubic.easeOut", delay: i * 180,
          onComplete: () => ring.destroy(),
        });
      }

      // 「叛逃！」红色气泡
      const bubble = this.add.container(screenX, screenY - 36);
      const bg = this.add.graphics();
      bg.fillStyle(0x1a0500, 0.95);
      bg.fillRect(-52, -13, 104, 26);
      bg.lineStyle(2, 0xff6600, 1);
      bg.strokeRect(-52, -13, 104, 26);
      const destName = data.new_team_name || "流民";
      const txt = this.add.text(0, 0, `🔥 ${data.display_name} 叛逃！`, {
        fontSize: "9px", color: "#ff9933", fontStyle: "bold",
      }).setOrigin(0.5).setResolution(2);
      bubble.add([bg, txt]);
      bubble.setDepth(960);
      this.tweens.add({
        targets: bubble, y: bubble.y - 32, alpha: 0,
        duration: 2500, ease: "Cubic.easeOut", delay: 500,
        onComplete: () => bubble.destroy(),
      });

      // 精灵闪橙色后冲向地图中央（象征奔向新阵营）
      this.tweens.add({
        targets: agent.container,
        alpha: 0.15, duration: 120, yoyo: true, repeat: 4, ease: "Linear",
        onStart: () => { agent.base.setTint(0xff6600); agent.helmet.setTint(0xff6600); },
        onComplete: () => {
          agent.base.clearTint();
          agent.helmet.clearTint();
          // 冲向随机新位置（新队伍区域）
          const angle = Math.random() * Math.PI * 2;
          const radius = 60 + Math.random() * 60;
          agent.target = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
          agent.taskPhase = "execute";
          this.time.delayedCall(1200, () => { agent.taskPhase = "idle"; });
        },
      });

      void destName; // may use in future tooltip
    }
  }

  /** 军团宗旨生成：在地图中央短暂显示一条提示气泡 */
  private onTeamCreedGenerated(data: { team_id: string; team_name: string; creed: string }) {
    const w = this.scale.width;
    const h = this.scale.height;
    const bubble = this.add.container(w / 2, h / 2 - 60);
    const maxW = Math.min(w - 40, 340);
    const bg = this.add.graphics();
    bg.fillStyle(0x0a1a10, 0.92);
    bg.fillRoundedRect(-maxW / 2, -20, maxW, 40, 8);
    bg.lineStyle(1, 0x22c55e, 0.8);
    bg.strokeRoundedRect(-maxW / 2, -20, maxW, 40, 8);
    const txt = this.add.text(0, 0,
      `【${data.team_name}】宗旨：${data.creed}`,
      { fontSize: "9px", color: "#86efac", wordWrap: { width: maxW - 20 }, align: "center" }
    ).setOrigin(0.5).setResolution(2);
    bubble.add([bg, txt]);
    bubble.setDepth(955).setAlpha(0);
    this.tweens.add({
      targets: bubble, alpha: 1, duration: 400, ease: "Cubic.easeOut",
      onComplete: () => {
        this.time.delayedCall(4000, () => {
          this.tweens.add({
            targets: bubble, alpha: 0, duration: 600, ease: "Cubic.easeIn",
            onComplete: () => bubble.destroy(),
          });
        });
      },
    });
    void h;
  }

  /** 推入字幕队列，若当前无播放则立即开始 */
  private pushSubtitle(text: string, level: string) {
    this.subtitleQueue.push({ text, level });
    if (!this.subtitlePlaying) this._playNextSubtitle();
  }

  private _playNextSubtitle() {
    if (this.subtitleQueue.length === 0) {
      this.subtitlePlaying = false;
      this.subtitleContainer.setVisible(false);
      return;
    }
    this.subtitlePlaying = true;
    const { text, level } = this.subtitleQueue.shift()!;

    // 颜色根据 level 变化
    const colors: Record<string, string> = {
      last_stand: "#ff6666",
      elimination: "#ff4444",
      defection: "#ff9933",
      info: "#fbbf24",
    };
    const color = colors[level] ?? "#fbbf24";
    const w = this.scale.width;
    const h = this.scale.height;

    this.subtitleContainer.setVisible(true);
    this.subtitleText
      .setText(text)
      .setColor(color)
      .setAlpha(1)
      .setX(w + 20);

    // 滚入动画
    this.tweens.add({
      targets: this.subtitleText,
      x: 12,
      duration: 500,
      ease: "Cubic.easeOut",
      onComplete: () => {
        // 停留 3.5s 后淡出，再播下一条
        this.time.delayedCall(3500, () => {
          this.tweens.add({
            targets: this.subtitleText,
            alpha: 0,
            x: -w,
            duration: 600,
            ease: "Cubic.easeIn",
            onComplete: () => {
              this.subtitleText.setX(w + 20).setAlpha(1);
              this._playNextSubtitle();
            },
          });
        });
      },
    });
    // 消音提示：level=elimination 时顶部小 flash
    if (level === "elimination") {
      this.cameras.main.flash(200, 80, 0, 0, false);
    } else if (level === "last_stand") {
      this.cameras.main.flash(150, 60, 0, 0, false);
    }
    void h; // suppress unused warning — h used implicitly by setY
  }

  private getFacing(dx: number, dy: number): CharFacing {
    if (Math.abs(dy) > Math.abs(dx)) return dy > 0 ? "front" : "back";
    return dx > 0 ? "right" : "left";
  }

  update(time: number, delta: number) {
    this.taskNpcManager.update(time, delta);
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const speedWander = 0.6;
    const speedTask = 1.8;
    const moveThreshold = 1.5;
    this.agents.forEach((agent, agentId) => {
      const speed = agent.taskPhase === "idle" ? speedWander : speedTask;
      const dx = agent.target.x - agent.container.x;
      const dy = agent.target.y - agent.container.y;
      const isMoving = Math.abs(dx) > moveThreshold || Math.abs(dy) > moveThreshold;

      if (isMoving) {
        agent.facing = this.getFacing(dx, dy);
        const walkFrame = Math.floor((time + agent.phaseOffset) * 0.004) % 2;
        setCharFacing(agent.base, agent.helmet, agent.facing, walkFrame, agent.warriorId);
        agent.container.x += Phaser.Math.Clamp(dx, -speed, speed);
        agent.container.y += Phaser.Math.Clamp(dy, -speed, speed);
      } else {
        setCharFacing(agent.base, agent.helmet, agent.facing, 0, agent.warriorId);

        // deliver 到达 NPC：更新余额、销毁 NPC、切换 idle 闲逛
        if (agent.taskPhase === "deliver") {
          const screenX = cx + agent.container.x;
          const screenY = cy + agent.container.y * VIEW_SCALE_Y;

          // ── 金色星星爆炸（8颗射出）────────────────────────────────────
          for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const star = this.add.text(screenX, screenY - 10, "★", {
              fontSize: "11px", color: "#fbbf24",
            }).setOrigin(0.5).setDepth(850).setResolution(2);
            const dist = 26 + Math.random() * 18;
            this.tweens.add({
              targets: star,
              x: screenX + Math.cos(angle) * dist,
              y: screenY - 10 + Math.sin(angle) * dist,
              alpha: 0,
              duration: 550 + Math.random() * 200,
              ease: "Cubic.easeOut",
              onComplete: () => star.destroy(),
            });
          }

          // ── 军功浮动气泡（金色边框，显示余额）─────────────────────────
          if (agent.pendingBalance !== null) {
            const balBubble = this.add.container(screenX, screenY - 26);
            balBubble.setDepth(860);
            const balBg = this.add.graphics();
            balBg.fillStyle(NES.BLACK, 0.9);
            balBg.fillRect(-38, -11, 76, 22);
            balBg.lineStyle(2, NES.GOLD, 1);
            balBg.strokeRect(-38, -11, 76, 22);
            const balTxt = this.add.text(0, 0, `⭐ ${agent.pendingBalance}`, {
              fontSize: "10px", color: "#fbbf24", fontStyle: "bold",
            }).setOrigin(0.5).setResolution(2);
            balBubble.add([balBg, balTxt]);
            this.tweens.add({
              targets: balBubble, y: balBubble.y - 28, alpha: 0, duration: 2000,
              ease: "Cubic.easeOut", delay: 150,
              onComplete: () => balBubble.destroy(),
            });
            agent.pendingBalance = null;
          }

          this.taskNpcManager.despawnByAgent(agentId);
          agent.taskPhase = "idle";
          agent.wanderTimer = 0;
          const wander = getRandomWanderPoint();
          agent.target = { x: wander.x - cx, y: wander.y - cy };
        }

        // idle 定时换闲逛目标
        if (agent.taskPhase === "idle") {
          agent.wanderTimer += delta;
          if (agent.wanderTimer >= 4000) {
            agent.wanderTimer = 0;
            const wander = getRandomWanderPoint();
            agent.target = { x: wander.x - cx, y: wander.y - cy };
          }
        }
      }

      const t = (time + agent.phaseOffset) * 0.001;
      const scaleDelta = isMoving ? Math.sin(t * 8) * 0.006 : Math.sin(t * 2.5) * 0.005;
      agent.body.setScale(1 + scaleDelta);
    });
  }
}
