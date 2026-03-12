import Phaser from "phaser";
import { NES } from "./nesColors";
import { AgentState } from "./AgentManager";
import { BUILDINGS, VIEW_SCALE_Y, LABEL_TO_XY, TO_LABEL } from "./sceneAssets";
import { getRandomWanderPoint } from "./taskNpc";

export interface EventEffectsConfig {
  scene: Phaser.Scene;
  worldInner: Phaser.GameObjects.Container;
  getBuilding: (key: string) => Phaser.GameObjects.Container | undefined;
  getCx: () => number;
  getCy: () => number;
  getAgents: () => Map<string, AgentState>;
}

export class EventEffects {
  private scene: Phaser.Scene;
  private worldInner: Phaser.GameObjects.Container;
  private getBuilding: (key: string) => Phaser.GameObjects.Container | undefined;
  private getCx: () => number;
  private getCy: () => number;
  private getAgents: () => Map<string, AgentState>;

  constructor(config: EventEffectsConfig) {
    this.scene = config.scene;
    this.worldInner = config.worldInner;
    this.getBuilding = config.getBuilding;
    this.getCx = config.getCx;
    this.getCy = config.getCy;
    this.getAgents = config.getAgents;
  }

  playEvolutionEvent(data: { agent_id: string; event_type?: string }) {
    const cx = this.getCx();
    const cy = this.getCy();

    // 1. 神殿建筑强脉冲
    const templeContainer = this.getBuilding("temple");
    if (templeContainer) {
      this.scene.tweens.add({
        targets: templeContainer,
        scaleX: 1.3,
        scaleY: 1.3,
        duration: 180,
        yoyo: true,
        repeat: 2,
        ease: "Power2",
      });
    }

    // 2. 全屏金色大闪光
    this.scene.cameras.main.flash(500, 255, 210, 50, false);

    // 3. 金色扩散光环
    const tSX = BUILDINGS.temple.x;
    const tSY = BUILDINGS.temple.y;
    const ringGfx = this.scene.add.graphics();
    ringGfx.setDepth(850);
    let ringR = 4;
    const ringTick = this.scene.time.addEvent({
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
    this.scene.time.delayedCall(500, () => { ringTick.destroy(); ringGfx.destroy(); });

    // 4. 粒子喷射
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const spark = this.scene.add.graphics();
      spark.fillStyle(NES.GOLD, 1);
      spark.fillRect(-3, -3, 6, 6);
      spark.setDepth(851);
      spark.x = tSX;
      spark.y = tSY;
      const dist = 55 + Math.random() * 50;
      this.scene.tweens.add({
        targets: spark,
        x: tSX + Math.cos(angle) * dist,
        y: tSY + Math.sin(angle) * dist,
        alpha: 0,
        duration: 550 + Math.random() * 250,
        ease: "Cubic.easeOut",
        onComplete: () => spark.destroy(),
      });
    }

    // 5. 角色头顶气泡
    const agent = this.getAgents().get(data.agent_id);
    if (agent) {
      const et = data.event_type as string;
      const msg = et === "rule_added" ? "🧠 学到了新规则！"
        : et === "skill_generated" ? "⚡ 生成了新技能！"
        : "✨ 进化完成！";
      const bubble = this.scene.add.container(
        cx + agent.container.x,
        cy + agent.container.y * VIEW_SCALE_Y - 32,
      );
      bubble.setScale(0.3);
      bubble.setDepth(800);
      const bg = this.scene.add.graphics();
      bg.fillStyle(NES.BLACK, 1);
      bg.fillRect(-68, -14, 136, 28);
      bg.lineStyle(2, NES.GOLD, 1);
      bg.strokeRect(-68, -14, 136, 28);
      const txt = this.scene.add.text(0, 0, msg, {
        fontSize: "13px",
        color: "#FBBF24",
        fontStyle: "bold",
      }).setOrigin(0.5).setResolution(2);
      bubble.add([bg, txt]);
      this.scene.tweens.add({
        targets: bubble,
        scaleX: 1,
        scaleY: 1,
        duration: 250,
        ease: "Back.easeOut",
      });
      this.scene.time.delayedCall(7500, () => {
        this.scene.tweens.add({
          targets: bubble,
          alpha: 0,
          y: bubble.y - 12,
          duration: 500,
          ease: "Cubic.easeIn",
          onComplete: () => bubble.destroy(),
        });
      });
    }

    // 6. Toast 通知
    const agentName = this.getAgents().get(data.agent_id)?.displayName ?? data.agent_id;
    const toastMsg = data.event_type === "rule_added" ? `🧠 ${agentName} 获得新规则！`
      : data.event_type === "skill_generated" ? `⚡ ${agentName} 生成新技能！`
      : `✨ ${agentName} 进化完成！`;
    const w = this.scene.scale.width;
    const toast = this.scene.add.container(-200, 30);
    toast.setDepth(950);
    toast.setScrollFactor(0);
    const toastBg = this.scene.add.graphics();
    toastBg.fillStyle(NES.BLACK, 0.92);
    toastBg.fillRect(0, 0, 188, 28);
    toastBg.lineStyle(2, NES.GOLD, 1);
    toastBg.strokeRect(0, 0, 188, 28);
    const toastTxt = this.scene.add.text(94, 14, toastMsg, {
      fontSize: "11px",
      color: "#FBBF24",
      fontStyle: "bold",
    }).setOrigin(0.5).setResolution(2);
    toast.add([toastBg, toastTxt]);
    this.scene.tweens.add({
      targets: toast,
      x: 10,
      duration: 300,
      ease: "Cubic.easeOut",
    });
    this.scene.time.delayedCall(3500, () => {
      this.scene.tweens.add({
        targets: toast,
        x: -220,
        duration: 350,
        ease: "Cubic.easeIn",
        onComplete: () => toast.destroy(),
      });
    });
  }

  playAgentEliminated(agentId: string): AgentState | undefined {
    const agents = this.getAgents();
    const agent = agents.get(agentId);
    if (!agent || agent.eliminating) return undefined;

    const cx = this.getCx();
    const cy = this.getCy();
    const screenX = cx + agent.container.x;
    const screenY = cy + agent.container.y * VIEW_SCALE_Y;

    agent.eliminating = true;
    agent.taskPhase = "idle";

    // Step 1: 红色闪烁
    this.scene.tweens.add({
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

    // Step 2: 气泡和特效
    this.scene.time.delayedCall(200, () => {
      const name = agent.displayName;
      const bubble = this.scene.add.container(screenX, screenY - 30);
      const bg = this.scene.add.graphics();
      bg.fillStyle(0x000000, 0.92);
      bg.fillRect(-60, -14, 120, 28);
      bg.lineStyle(2, 0xff4444, 1);
      bg.strokeRect(-60, -14, 120, 28);
      const skull = this.scene.add.text(-46, 0, "💀", { fontSize: "14px" }).setOrigin(0.5).setResolution(2);
      const txt = this.scene.add.text(12, 0, `${name} 兵败身死`, {
        fontSize: "9px",
        color: "#FF4444",
        fontStyle: "bold",
      }).setOrigin(0.5).setResolution(2);
      bubble.add([bg, skull, txt]);
      bubble.setDepth(900);
      this.scene.tweens.add({
        targets: bubble,
        y: bubble.y - 30,
        alpha: 0,
        duration: 2500,
        ease: "Cubic.easeOut",
        onComplete: () => bubble.destroy(),
      });

      const qishu = this.scene.add.text(screenX, screenY - 58, "气数已尽", {
        fontSize: "11px",
        color: "#ff8888",
        fontStyle: "bold",
      }).setOrigin(0.5).setDepth(902).setResolution(2);
      this.scene.tweens.add({
        targets: qishu,
        y: qishu.y - 32,
        alpha: 0,
        duration: 3000,
        ease: "Cubic.easeOut",
        onComplete: () => qishu.destroy(),
      });

      const skullFlag = this.scene.add.container(screenX, screenY);
      skullFlag.setDepth(750);
      const pole = this.scene.add.graphics();
      pole.fillStyle(0x888888, 1);
      pole.fillRect(-1, -22, 2, 22);
      const flagBg = this.scene.add.graphics();
      flagBg.fillStyle(0x111111, 0.95);
      flagBg.fillRect(-11, -34, 22, 14);
      flagBg.lineStyle(1, 0xff4444, 1);
      flagBg.strokeRect(-11, -34, 22, 14);
      const flagSkull = this.scene.add.text(0, -27, "💀", { fontSize: "9px" }).setOrigin(0.5).setResolution(2);
      skullFlag.add([pole, flagBg, flagSkull]);
      this.scene.time.delayedCall(5000, () => {
        this.scene.tweens.add({
          targets: skullFlag,
          alpha: 0,
          duration: 600,
          ease: "Linear",
          onComplete: () => skullFlag.destroy(),
        });
      });
    });

    // Step 3: 相机震动
    this.scene.time.delayedCall(300, () => {
      this.scene.cameras.main.shake(400, 0.008);
      this.scene.cameras.main.flash(300, 255, 0, 0, false);
    });

    // Step 4: 精灵渐隐消失
    this.scene.time.delayedCall(600, () => {
      this.scene.tweens.add({
        targets: agent.container,
        alpha: 0,
        scaleX: 0.5,
        scaleY: 0.5,
        duration: 1200,
        ease: "Power2",
        onComplete: () => {
          agent.container.destroy();
          agents.delete(agentId);
        },
      });
    });

    return agent;
  }

  playAgentLastStand(agentId: string, displayName: string, balance: number) {
    const agents = this.getAgents();
    const agent = agents.get(agentId);
    const cx = this.getCx();
    const cy = this.getCy();

    this.scene.cameras.main.flash(500, 200, 0, 0, false);
    this.scene.cameras.main.shake(250, 0.006);

    if (agent && !agent.eliminating) {
      const screenX = cx + agent.container.x;
      const screenY = cy + agent.container.y * VIEW_SCALE_Y;

      for (let i = 0; i < 3; i++) {
        const ring = this.scene.add.graphics();
        ring.lineStyle(3, 0xff2222, 1);
        ring.strokeCircle(0, 0, 14);
        ring.setPosition(screenX, screenY - 8);
        ring.setDepth(870);
        this.scene.tweens.add({
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

      const bubble = this.scene.add.container(screenX, screenY - 36);
      const bg = this.scene.add.graphics();
      bg.fillStyle(0x1a0000, 0.95);
      bg.fillRect(-52, -13, 104, 26);
      bg.lineStyle(2, 0xff2222, 1);
      bg.strokeRect(-52, -13, 104, 26);
      const txt = this.scene.add.text(0, 0, `⚔ ${displayName} 最后一战！`, {
        fontSize: "9px", color: "#ff6666", fontStyle: "bold",
      }).setOrigin(0.5).setResolution(2);
      bubble.add([bg, txt]);
      bubble.setDepth(900);
      this.scene.tweens.add({
        targets: bubble, y: bubble.y - 28, alpha: 0,
        duration: 2800, ease: "Cubic.easeOut", delay: 600,
        onComplete: () => bubble.destroy(),
      });

      this.scene.tweens.add({
        targets: agent.container,
        alpha: 0.15, duration: 100, yoyo: true, repeat: 5, ease: "Linear",
        onStart: () => { agent.base.setTint(0xff1111); agent.helmet.setTint(0xff1111); },
        onComplete: () => { agent.base.clearTint(); agent.helmet.clearTint(); },
      });
    }
  }

  playTeamFormed(teams: { team_id: string; name: string; members: { agent_id: string; display_name: string }[] }[]) {
    const cx = this.getCx();
    const cy = this.getCy();
    const w = this.scene.scale.width;
    const bubble = this.scene.add.container(w / 2, cy - 60);
    const bg = this.scene.add.graphics();
    bg.fillStyle(0x000000, 0.88);
    bg.fillRect(-70, -12, 140, 24);
    bg.lineStyle(2, 0xf97316, 1);
    bg.strokeRect(-70, -12, 140, 24);
    const txt = this.scene.add.text(0, 0, `⚔ 结阵完成 — ${teams.length} 支队伍`, {
      fontSize: "10px", color: "#f97316", fontStyle: "bold",
    }).setOrigin(0.5).setResolution(2);
    bubble.add([bg, txt]);
    bubble.setDepth(950);
    this.scene.tweens.add({
      targets: bubble, y: bubble.y - 24, alpha: 0, duration: 2500,
      ease: "Cubic.easeOut", delay: 800,
      onComplete: () => bubble.destroy(),
    });
  }

  playRescueEvent(donorId: string, targetId: string, amount: number) {
    const agents = this.getAgents();
    const donor = agents.get(donorId);
    const target = agents.get(targetId);
    if (!donor || !target || donor.eliminating) return;

    const cx = this.getCx();
    const cy = this.getCy();

    donor.rescueTarget = { ...donor.target };
    donor.taskPhase = "execute";
    donor.target = { x: target.container.x + 10, y: target.container.y };

    this.scene.time.delayedCall(350, () => {
      if (!target || target.eliminating) return;
      const screenX = cx + target.container.x;
      const screenY = cy + target.container.y * VIEW_SCALE_Y - 24;
      const bubble = this.scene.add.container(screenX, screenY);

      const bg = this.scene.add.graphics();
      bg.fillStyle(0x000000, 0.85);
      bg.fillRect(-46, -12, 92, 24);
      bg.lineStyle(2, 0x22c55e, 1);
      bg.strokeRect(-46, -12, 92, 24);
      const heart = this.scene.add.text(-32, 0, "❤", { fontSize: "12px" }).setOrigin(0.5).setResolution(2);
      const coin = this.scene.add.text(-14, 0, "🪙", { fontSize: "12px" }).setOrigin(0.5).setResolution(2);
      const txt = this.scene.add.text(16, 0, `+${amount}`, {
        fontSize: "10px", color: "#22c55e", fontStyle: "bold",
      }).setOrigin(0.5).setResolution(2);
      bubble.add([bg, heart, coin, txt]);
      bubble.setDepth(950);
      this.scene.tweens.add({
        targets: bubble, y: bubble.y - 30, alpha: 0, duration: 2000,
        ease: "Cubic.easeOut",
        onComplete: () => bubble.destroy(),
      });

      this.scene.cameras.main.shake(300, 0.004);
      this.scene.cameras.main.flash(300, 251, 191, 36, false);

      if (donor.rescueTarget) {
        donor.target = donor.rescueTarget;
        donor.rescueTarget = undefined;
        donor.taskPhase = "idle";
      }
    });
  }

  playAgentDefected(agentId: string, displayName: string, newTeamName?: string) {
    const agents = this.getAgents();
    const agent = agents.get(agentId);
    if (!agent || agent.eliminating) return;

    const cx = this.getCx();
    const cy = this.getCy();
    const screenX = cx + agent.container.x;
    const screenY = cy + agent.container.y * VIEW_SCALE_Y;

    this.scene.cameras.main.flash(400, 200, 80, 0, false);
    this.scene.cameras.main.shake(300, 0.005);

    for (let i = 0; i < 2; i++) {
      const ring = this.scene.add.graphics();
      ring.lineStyle(3, 0xff6600, 1);
      ring.strokeCircle(0, 0, 14);
      ring.setPosition(screenX, screenY - 8);
      ring.setDepth(870);
      this.scene.tweens.add({
        targets: ring,
        scaleX: 3.2, scaleY: 3.2, alpha: 0,
        duration: 650, ease: "Cubic.easeOut", delay: i * 180,
        onComplete: () => ring.destroy(),
      });
    }

    const bubble = this.scene.add.container(screenX, screenY - 36);
    const bg = this.scene.add.graphics();
    bg.fillStyle(0x1a0500, 0.95);
    bg.fillRect(-52, -13, 104, 26);
    bg.lineStyle(2, 0xff6600, 1);
    bg.strokeRect(-52, -13, 104, 26);
    const destName = newTeamName || "流民";
    const txt = this.scene.add.text(0, 0, `🔥 ${displayName} 叛逃！`, {
      fontSize: "9px", color: "#ff9933", fontStyle: "bold",
    }).setOrigin(0.5).setResolution(2);
    bubble.add([bg, txt]);
    bubble.setDepth(960);
    this.scene.tweens.add({
      targets: bubble, y: bubble.y - 32, alpha: 0,
      duration: 2500, ease: "Cubic.easeOut", delay: 500,
      onComplete: () => bubble.destroy(),
    });

    this.scene.tweens.add({
      targets: agent.container,
      alpha: 0.15, duration: 120, yoyo: true, repeat: 4, ease: "Linear",
      onStart: () => { agent.base.setTint(0xff6600); agent.helmet.setTint(0xff6600); },
      onComplete: () => {
        agent.base.clearTint();
        agent.helmet.clearTint();
        const angle = Math.random() * Math.PI * 2;
        const radius = 60 + Math.random() * 60;
        agent.target = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
        agent.taskPhase = "execute";
        this.scene.time.delayedCall(1200, () => { agent.taskPhase = "idle"; });
      },
    });

    void destName;
  }

  playTeamCreedGenerated(teamName: string, creed: string) {
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const bubble = this.scene.add.container(w / 2, h / 2 - 60);
    const maxW = Math.min(w - 40, 340);
    const bg = this.scene.add.graphics();
    bg.fillStyle(0x0a1a10, 0.92);
    bg.fillRoundedRect(-maxW / 2, -20, maxW, 40, 8);
    bg.lineStyle(1, 0x22c55e, 0.8);
    bg.strokeRoundedRect(-maxW / 2, -20, maxW, 40, 8);
    const txt = this.scene.add.text(0, 0,
      `【${teamName}】宗旨：${creed}`,
      { fontSize: "9px", color: "#86efac", wordWrap: { width: maxW - 20 }, align: "center" }
    ).setOrigin(0.5).setResolution(2);
    bubble.add([bg, txt]);
    bubble.setDepth(955).setAlpha(0);
    this.scene.tweens.add({
      targets: bubble, alpha: 1, duration: 400, ease: "Cubic.easeOut",
      onComplete: () => {
        this.scene.time.delayedCall(4000, () => {
          this.scene.tweens.add({
            targets: bubble, alpha: 0, duration: 600, ease: "Cubic.easeIn",
            onComplete: () => bubble.destroy(),
          });
        });
      },
    });
  }

  /** 任务完成时的胜负过场：成功则庆祝气泡+轻微弹跳，失败则“未竟”气泡+后退+红闪 */
  playTaskResult(agentId: string, success: boolean) {
    const agents = this.getAgents();
    const agent = agents.get(agentId);
    if (!agent || agent.eliminating) return;

    const cx = this.getCx();
    const cy = this.getCy();
    const screenX = cx + agent.container.x;
    const screenY = cy + agent.container.y * VIEW_SCALE_Y;

    if (success) {
      // 胜利：头顶“军令达成！”气泡 + 角色轻微弹跳
      const bubble = this.scene.add.container(screenX, screenY - 32);
      bubble.setDepth(900);
      const bg = this.scene.add.graphics();
      bg.fillStyle(NES.BLACK, 0.92);
      bg.fillRect(-52, -12, 104, 24);
      bg.lineStyle(2, NES.GOLD, 1);
      bg.strokeRect(-52, -12, 104, 24);
      const txt = this.scene.add.text(0, 0, "⚔ 军令达成！", {
        fontSize: "10px", color: "#FBBF24", fontStyle: "bold",
      }).setOrigin(0.5).setResolution(2);
      bubble.add([bg, txt]);
      this.scene.tweens.add({
        targets: bubble, y: bubble.y - 24, alpha: 0, duration: 2200,
        ease: "Cubic.easeOut", delay: 200,
        onComplete: () => bubble.destroy(),
      });
      // 用无 overshoot 的缓动，避免 yoyo 回弹时 Back.easeOut 把 scale 带到 1 以下导致角色变小
      this.scene.tweens.add({
        targets: agent.container,
        scaleX: 1.18, scaleY: 1.18, duration: 120, yoyo: true, ease: "Cubic.easeOut",
        onComplete: () => { agent.container.setScale(1); },
      });
    } else {
      // 失败：头顶“未竟”气泡 + 后退一步 + 红闪
      const bubble = this.scene.add.container(screenX, screenY - 32);
      bubble.setDepth(900);
      const bg = this.scene.add.graphics();
      bg.fillStyle(0x1a0000, 0.92);
      bg.fillRect(-40, -12, 80, 24);
      bg.lineStyle(2, 0xff4444, 1);
      bg.strokeRect(-40, -12, 80, 24);
      const txt = this.scene.add.text(0, 0, "未竟", {
        fontSize: "10px", color: "#ff6666", fontStyle: "bold",
      }).setOrigin(0.5).setResolution(2);
      bubble.add([bg, txt]);
      this.scene.tweens.add({
        targets: bubble, y: bubble.y - 28, alpha: 0, duration: 2400,
        ease: "Cubic.easeOut", delay: 300,
        onComplete: () => bubble.destroy(),
      });
      this.scene.cameras.main.flash(280, 180, 0, 0, false);
      this.scene.cameras.main.shake(200, 0.005);
      const origY = agent.container.y;
      this.scene.tweens.add({
        targets: agent.container,
        y: origY + 8, duration: 150, ease: "Cubic.easeOut",
        onStart: () => { agent.base.setTint(0xff4444); agent.helmet.setTint(0xff4444); },
        onComplete: () => {
          this.scene.tweens.add({
            targets: agent.container, y: origY, duration: 180, ease: "Cubic.easeIn",
            onComplete: () => { agent.base.clearTint(); agent.helmet.clearTint(); },
          });
        },
      });
    }
  }

  /** 接任务时的对话泡泡：NPC 头顶任务摘要，Agent 头顶「接令！」 */
  playTaskTakenBubbles(agentId: string, npcScreenX: number | null, npcScreenY: number | null, taskSummary: string) {
    const agents = this.getAgents();
    const agent = agents.get(agentId);
    const cx = this.getCx();
    const cy = this.getCy();

    if (npcScreenX != null && npcScreenY != null) {
      const summary = taskSummary.length > 20 ? taskSummary.slice(0, 20) + "…" : taskSummary;
      const npcBubble = this.scene.add.container(npcScreenX, npcScreenY - 28);
      npcBubble.setDepth(920);
      const npcBg = this.scene.add.graphics();
      npcBg.fillStyle(NES.BLACK, 0.9);
      npcBg.fillRect(-72, -10, 144, 20);
      npcBg.lineStyle(2, 0xe8a317, 1);
      npcBg.strokeRect(-72, -10, 144, 20);
      const npcTxt = this.scene.add.text(0, 0, summary, {
        fontSize: "9px", color: "#fcd34d", wordWrap: { width: 136 }, align: "center",
      }).setOrigin(0.5).setResolution(2);
      npcBubble.add([npcBg, npcTxt]);
      this.scene.tweens.add({
        targets: npcBubble, y: npcBubble.y - 20, alpha: 0, duration: 2200,
        ease: "Cubic.easeOut", delay: 400,
        onComplete: () => npcBubble.destroy(),
      });
    }

    // Agent 头顶：「接令！」
    if (agent && !agent.eliminating) {
      const ax = cx + agent.container.x;
      const ay = cy + agent.container.y * VIEW_SCALE_Y - 28;
      const agentBubble = this.scene.add.container(ax, ay);
      agentBubble.setDepth(921);
      const agentBg = this.scene.add.graphics();
      agentBg.fillStyle(0x0a1a0a, 0.95);
      agentBg.fillRect(-32, -10, 64, 20);
      agentBg.lineStyle(2, NES.GOLD, 1);
      agentBg.strokeRect(-32, -10, 64, 20);
      const agentTxt = this.scene.add.text(0, 0, "接令！", {
        fontSize: "10px", color: "#FBBF24", fontStyle: "bold",
      }).setOrigin(0.5).setResolution(2);
      agentBubble.add([agentBg, agentTxt]);
      this.scene.tweens.add({
        targets: agentBubble, y: agentBubble.y - 22, alpha: 0, duration: 2000,
        ease: "Cubic.easeOut", delay: 200,
        onComplete: () => agentBubble.destroy(),
      });
    }
  }

  playDeliveryEffect(screenX: number, screenY: number, pendingBalance: number | null) {
    // 金色星星爆炸
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const star = this.scene.add.text(screenX, screenY - 10, "★", {
        fontSize: "11px", color: "#fbbf24",
      }).setOrigin(0.5).setDepth(850).setResolution(2);
      const dist = 26 + Math.random() * 18;
      this.scene.tweens.add({
        targets: star,
        x: screenX + Math.cos(angle) * dist,
        y: screenY - 10 + Math.sin(angle) * dist,
        alpha: 0,
        duration: 550 + Math.random() * 200,
        ease: "Cubic.easeOut",
        onComplete: () => star.destroy(),
      });
    }

    // 军功气泡
    if (pendingBalance !== null) {
      const balBubble = this.scene.add.container(screenX, screenY - 26);
      balBubble.setDepth(860);
      const balBg = this.scene.add.graphics();
      balBg.fillStyle(NES.BLACK, 0.9);
      balBg.fillRect(-38, -11, 76, 22);
      balBg.lineStyle(2, NES.GOLD, 1);
      balBg.strokeRect(-38, -11, 76, 22);
      const balTxt = this.scene.add.text(0, 0, `⭐ ${pendingBalance}`, {
        fontSize: "10px", color: "#fbbf24", fontStyle: "bold",
      }).setOrigin(0.5).setResolution(2);
      balBubble.add([balBg, balTxt]);
      this.scene.tweens.add({
        targets: balBubble, y: balBubble.y - 28, alpha: 0, duration: 2000,
        ease: "Cubic.easeOut", delay: 150,
        onComplete: () => balBubble.destroy(),
      });
    }
  }
}
