import Phaser from "phaser";
import { useEvotownStore } from "../store/evotownStore";
import { evotownEvents, EvotownEventMap } from "./events";
import { createCharacterContainer } from "./characterAssets";
import { getWarriorForAgent } from "./warriorPortraits";
import { getRandomWanderPoint, TaskNpcManager } from "./taskNpc";
import { VIEW_SCALE_Y, VIEW_FILL_SCALE, LABEL_TO_XY, TO_LABEL } from "./sceneAssets";
import { AgentManager, AgentState } from "./AgentManager";
import { TerrainRenderer } from "./TerrainRenderer";
import { UIRenderer } from "./TerrainRenderer";
import { EventEffects } from "./EventEffects";

export default class TownScene extends Phaser.Scene {
  private agentManager!: AgentManager;
  private terrainRenderer!: TerrainRenderer;
  private uiRenderer!: UIRenderer;
  private eventEffects!: EventEffects;
  private taskNpcManager!: TaskNpcManager;
  private worldInner!: Phaser.GameObjects.Container;
  private worldContainer!: Phaser.GameObjects.Container;
  private eventHandlers: Array<{
    ev: "sprite_move" | "task_complete" | "agent_eliminated" | "agent_created" | "evolution_event" | "task_available" | "task_taken" | "task_expired" | "team_formed" | "rescue_event" | "agent_last_stand" | "subtitle_broadcast" | "agent_defected" | "team_creed_generated";
    fn: (d: unknown) => void;
  }> = [];

  private lastTeamFormedFingerprint = "";

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

    // 世界容器
    this.worldInner = this.add.container(0, 0);
    this.worldInner.setScale(1, VIEW_SCALE_Y);
    this.worldContainer = this.add.container(w / 2, h / 2);
    this.worldContainer.setScale(1, VIEW_FILL_SCALE);
    this.worldContainer.add(this.worldInner);

    // 初始化渲染器
    this.terrainRenderer = new TerrainRenderer({
      scene: this,
      worldInner: this.worldInner,
      worldContainer: this.worldContainer,
      width: w,
      height: h,
    });

    this.uiRenderer = new UIRenderer({
      scene: this,
      width: w,
      height: h,
    });

    // 初始化 Agent 管理器
    this.agentManager = new AgentManager({
      scene: this,
      worldInner: this.worldInner,
      getCx: () => this.scale.width / 2,
      getCy: () => this.scale.height / 2,
      getWanderSpeed: () => 0.6,
      getTaskSpeed: () => 1.8,
      getMoveThreshold: () => 1.5,
    });

    // 设置交付完成回调
    this.agentManager.setDeliverCallback((agent, cx, cy, agentId) => {
      this.onDeliverComplete(agent, cx, cy, agentId);
    });

    // 初始化事件特效
    this.eventEffects = new EventEffects({
      scene: this,
      worldInner: this.worldInner,
      getBuilding: (key) => this.terrainRenderer.getBuilding(key),
      getCx: () => this.scale.width / 2,
      getCy: () => this.scale.height / 2,
      getAgents: () => this.agentManager.getAll(),
    });

    // 任务 NPC 管理器
    this.taskNpcManager = new TaskNpcManager({
      scene: this,
      parent: this.worldInner,
      originX: w / 2,
      originY: h / 2,
    });

    this.setupEventListeners();

    this.time.delayedCall(150, () => {
      evotownEvents.emit("phaser_ready", {});
      this.syncAvailableTasksFromStore();
    });
  }

  private setupEventListeners() {
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
    const h12 = (d: { text: string; level: string }) => this.uiRenderer.pushSubtitle(d.text, d.level);
    const h13 = (d: { agent_id: string; display_name: string; old_team_id: string; old_team_name: string; new_team_id: string; new_team_name: string }) => this.onAgentDefected(d);
    const h14 = (d: { team_id: string; team_name: string; creed: string }) => this.onTeamCreedGenerated(d);

type TownEventKey = "sprite_move" | "task_complete" | "agent_eliminated" | "agent_created" | "evolution_event" | "task_available" | "task_taken" | "task_expired" | "team_formed" | "rescue_event" | "agent_last_stand" | "subtitle_broadcast" | "agent_defected" | "team_creed_generated";

    // 注册事件监听器
    const registerHandler = <T extends TownEventKey>(ev: T, fn: (d: EvotownEventMap[T]) => void) => {
      evotownEvents.on(ev, fn);
      this.eventHandlers.push({ ev, fn: fn as (d: unknown) => void });
    };

    registerHandler("sprite_move", h1);
    registerHandler("task_complete", h2);
    registerHandler("agent_eliminated", h3);
    registerHandler("agent_created", h4);
    registerHandler("evolution_event", h5);
    registerHandler("task_available", h6);
    registerHandler("task_taken", h7);
    registerHandler("task_expired", h8);
    registerHandler("team_formed", h9);
    registerHandler("rescue_event", h10);
    registerHandler("agent_last_stand", h11);
    registerHandler("subtitle_broadcast", h12);
    registerHandler("agent_defected", h13);
    registerHandler("team_creed_generated", h14);
  }

  /** 关键事件时镜头短暂聚焦到该 agent，再拉回默认视角 */
  private focusCameraOnAgent(agentId: string, zoomIn = 1.1, focusDurationMs = 1600) {
    const agent = this.agentManager.get(agentId);
    if (!agent) return;
    const w = this.scale.width;
    const h = this.scale.height;
    const defX = w / 2;
    const defY = h / 2;
    const zoomScale = VIEW_FILL_SCALE * zoomIn;
    const targetX = defX - agent.container.x * zoomScale;
    const targetY = defY - agent.container.y * VIEW_SCALE_Y * zoomScale;
    const world = this.worldContainer;
    this.tweens.add({
      targets: world,
      x: targetX,
      y: targetY,
      scaleX: zoomScale,
      scaleY: zoomScale,
      duration: 400,
      ease: "Cubic.easeOut",
      onComplete: () => {
        this.time.delayedCall(focusDurationMs, () => {
          this.tweens.add({
            targets: world,
            x: defX,
            y: defY,
            scaleX: VIEW_FILL_SCALE,
            scaleY: VIEW_FILL_SCALE,
            duration: 500,
            ease: "Cubic.easeOut",
          });
        });
      },
    });
  }

  private onEvolutionEvent(data: { agent_id: string; event_type?: string; [k: string]: unknown }) {
    this.focusCameraOnAgent(data.agent_id);
    this.eventEffects.playEvolutionEvent(data);
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
    const npcPos = this.taskNpcManager.getAssignedNpcPosition(data.agent_id);
    this.eventEffects.playTaskTakenBubbles(
      data.agent_id,
      npcPos?.x ?? null,
      npcPos?.y ?? null,
      data.task || "军令",
    );
  }

  private onTaskExpired(data: { task_id: string; task: string }) {
    this.taskNpcManager.despawnByTaskId(data.task_id);
  }

  private syncAvailableTasksFromStore() {
    const tasks = useEvotownStore.getState().availableTasks;
    tasks.forEach((t) => this.taskNpcManager.spawnForTask(t.task_id));
  }

  private agentLabel(displayName: string, _agentId: string, teamName?: string): string {
    if (teamName && teamName.trim()) {
      const short = teamName.length > 2 ? teamName.slice(0, 2) : teamName;
      return `${short}·${displayName}`;
    }
    return displayName;
  }

  private onTeamFormed(data: { teams: { team_id: string; name: string; members: { agent_id: string; display_name: string }[] }[] }) {
    data.teams.forEach((team) => {
      team.members.forEach((m) => {
        const agent = this.agentManager.get(m.agent_id);
        if (!agent) return;
        agent.teamId = team.team_id;
        agent.teamName = team.name;
        agent.label.setText(this.agentLabel(agent.displayName, m.agent_id, team.name));
      });
    });

    const fingerprint = data.teams
      .map((t) => `${t.team_id}:${t.members.map((m) => m.agent_id).sort().join(",")}`)
      .sort()
      .join("|");
    if (fingerprint === this.lastTeamFormedFingerprint) return;
    this.lastTeamFormedFingerprint = fingerprint;

    this.eventEffects.playTeamFormed(data.teams);
  }

  private onRescueEvent(data: { donor_id: string; donor_display_name: string; target_id: string; target_display_name: string; amount: number; team_id: string; team_name: string }) {
    this.eventEffects.playRescueEvent(data.donor_id, data.target_id, data.amount);
  }

  private getOrCreateAgent(agentId: string, displayName?: string): AgentState {
    let agent = this.agentManager.get(agentId);
    if (!agent) {
      const color = this.agentManager.getColor(agentId);
      const cx = this.scale.width / 2;
      const cy = this.scale.height / 2;
      const spawn = getRandomWanderPoint();
      const name = displayName || agentId;
      const labelText = this.agentLabel(name, agentId);
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
        pendingSuccess: null,
        eliminating: false,
      };
      this.agentManager.getAll().set(agentId, agent);
    }
    return agent;
  }

  private onSpriteMove(data: { agent_id: string; from: string; to: string; reason: string }) {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const agent = this.agentManager.get(data.agent_id);
    if (!agent || agent.eliminating) return;

    if (agent.taskPhase === "deliver") return;

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

    if (["广场", "城池", "中央广场"].includes(data.to)) {
      agent.taskPhase = "idle";
      const wander = getRandomWanderPoint();
      agent.target = { x: wander.x - cx, y: wander.y - cy };
      return;
    }

    const key = TO_LABEL[data.to];
    const taskBuildings = ["library", "workshop", "archive", "memory"];
    if (key && LABEL_TO_XY[key] && taskBuildings.includes(key)) {
      agent.taskPhase = "execute";
      this.taskNpcManager.assignToAgent(data.agent_id);
      const pos = LABEL_TO_XY[key];
      agent.target = { x: pos.x - cx, y: pos.y - cy + 12 };
      return;
    }

    if (key && LABEL_TO_XY[key]) {
      agent.taskPhase = "execute";
      const pos = LABEL_TO_XY[key];
      agent.target = { x: pos.x - cx, y: pos.y - cy + 12 };
      return;
    }

    agent.taskPhase = "idle";
    const wander = getRandomWanderPoint();
    agent.target = { x: wander.x - cx, y: wander.y - cy };
  }

  private onTaskComplete(data: { agent_id: string; success: boolean; balance: number }) {
    const agent = this.agentManager.get(data.agent_id);
    if (!agent) {
      this.taskNpcManager.despawnByAgent(data.agent_id);
      return;
    }

    agent.pendingBalance = data.balance;
    agent.pendingSuccess = data.success;
    const npcPos = this.taskNpcManager.getAssignedNpcPosition(data.agent_id);
    if (npcPos) {
      agent.taskPhase = "deliver";
      const cx = this.scale.width / 2;
      const cy = this.scale.height / 2;
      agent.target = { x: npcPos.x - cx, y: npcPos.y - cy };
    } else {
      // 无 NPC 时在当前位置直接播胜负过场
      this.eventEffects.playTaskResult(data.agent_id, data.success);
      agent.pendingBalance = null;
      agent.pendingSuccess = null;
      agent.taskPhase = "idle";
      const cx = this.scale.width / 2;
      const cy = this.scale.height / 2;
      const wander = getRandomWanderPoint();
      agent.target = { x: wander.x - cx, y: wander.y - cy };
      this.taskNpcManager.despawnByAgent(data.agent_id);
    }
  }

  private onDeliverComplete(agent: AgentState, cx: number, cy: number, agentId: string) {
    const success = agent.pendingSuccess ?? true;
    this.eventEffects.playTaskResult(agentId, success);
    const screenX = cx + agent.container.x;
    const screenY = cy + agent.container.y * VIEW_SCALE_Y;
    if (success) {
      this.eventEffects.playDeliveryEffect(screenX, screenY, agent.pendingBalance);
    }
    this.taskNpcManager.despawnByAgent(agentId);
    agent.pendingBalance = null;
    agent.pendingSuccess = null;
    agent.taskPhase = "idle";
    agent.wanderTimer = 0;
    const wander = getRandomWanderPoint();
    agent.target = { x: wander.x - cx, y: wander.y - cy };
  }

  private onAgentEliminated(data: { agent_id: string; reason?: string }) {
    if (data.reason === "replay_clear" || data.reason === "replay_end") {
      this.agentManager.delete(data.agent_id);
      return;
    }
    this.focusCameraOnAgent(data.agent_id, 1.1, 1200);
    this.eventEffects.playAgentEliminated(data.agent_id);
  }

  private onAgentLastStand(data: { agent_id: string; display_name: string; balance: number }) {
    this.focusCameraOnAgent(data.agent_id, 1.12, 2000);
    this.eventEffects.playAgentLastStand(data.agent_id, data.display_name, data.balance);
  }

  private onAgentDefected(data: { agent_id: string; display_name: string; old_team_id: string; old_team_name: string; new_team_id: string; new_team_name: string }) {
    const agent = this.agentManager.get(data.agent_id);
    if (agent) {
      agent.teamId = data.new_team_id || undefined;
      agent.teamName = data.new_team_name || undefined;
      agent.label.setText(this.agentLabel(agent.displayName, data.agent_id, data.new_team_name));
    }
    this.focusCameraOnAgent(data.agent_id, 1.08, 1400);
    this.eventEffects.playAgentDefected(data.agent_id, data.display_name, data.new_team_name);
  }

  private onTeamCreedGenerated(data: { team_id: string; team_name: string; creed: string }) {
    this.eventEffects.playTeamCreedGenerated(data.team_name, data.creed);
  }

  update(time: number, delta: number) {
    const defX = this.scale.width / 2;
    const defY = this.scale.height / 2;
    const dx = this.worldContainer.x - defX;
    const dy = this.worldContainer.y - defY;
    this.terrainRenderer.setParallaxOffset(dx, dy);
    this.terrainRenderer.updateAmbient(time);

    const cx = defX;
    const cy = defY;
    const activeBuildings = new Set<string>();
    this.agentManager.getAll().forEach((agent, _id) => {
      if (agent.taskPhase !== "execute") return;
      const ax = agent.container.x;
      const ay = agent.container.y;
      for (const [key, pos] of Object.entries(LABEL_TO_XY)) {
        if (key === "task") continue;
        const ddx = ax - (pos.x - cx);
        const ddy = ay - (pos.y - cy);
        if (Math.sqrt(ddx * ddx + ddy * ddy) < 48) {
          activeBuildings.add(key);
          break;
        }
      }
    });
    this.terrainRenderer.setActiveBuildings(activeBuildings);

    this.taskNpcManager.update(time, delta);
    this.agentManager.update(time, delta);
  }
}
