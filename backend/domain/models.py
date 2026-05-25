"""Evotown API 数据模型（Pydantic）"""
from typing import Any, Literal
from pydantic import BaseModel, Field


# 社会分工：进化方向（对应 SKILLLITE_EVOLUTION）
EvolutionDivision = Literal["all", "prompts", "skills", "memory"]


class AgentCreate(BaseModel):
    chat_dir: str | None = None
    soul_type: Literal["conservative", "aggressive", "balanced"] = "balanced"
    """社会分工：进化方向。不传则可由后端用大模型推断或系统分配，默认 all"""
    evolution_division: EvolutionDivision | None = None


class AgentInfo(BaseModel):
    id: str
    display_name: str = ""
    chat_dir: str
    balance: int = 100
    status: Literal["active", "stopped", "eliminated"] = "active"
    in_task: bool = False
    soul_type: str = "balanced"
    task_count: int = 0
    success_count: int = 0
    evolution_count: int = 0
    evolution_success_count: int = 0
    team_id: str | None = None
    team_name: str | None = None
    """社会分工：进化方向（规则与示例 / 技能 / 记忆 / 全能）"""
    evolution_division: str = "all"


class TaskInject(BaseModel):
    agent_id: str
    task: str


class TaskBatch(BaseModel):
    agent_id: str | Literal["all"] = "all"
    tasks: list[str]


class EvolutionEvent(BaseModel):
    type: Literal["evolution_event"] = "evolution_event"
    agent_id: str
    timestamp: str
    detail: dict[str, Any]


class TaskCompleteEvent(BaseModel):
    type: Literal["task_complete"] = "task_complete"
    agent_id: str
    success: bool
    elapsed_ms: int
    replans: int


class SpriteMoveEvent(BaseModel):
    type: Literal["sprite_move"] = "sprite_move"
    agent_id: str
    from_: str = Field(alias="from")
    to: str
    reason: str


class RepairSkillsBody(BaseModel):
    """仅修复指定技能时传 skill_names；不传或空数组则修复全部失败技能。"""
    skill_names: list[str] = []


EngineType = Literal["openclaw", "hermes", "skilllite", "custom"]
DeploymentKind = Literal["laptop", "server", "ci", "container"]
RunStatus = Literal["running", "succeeded", "failed", "cancelled"]
TerminalRunStatus = Literal["succeeded", "failed", "cancelled"]
RunEventType = Literal[
    "run.started",
    "run.progress",
    "run.completed",
    "run_started",
    "step_started",
    "user_message",
    "assistant_message",
    "tool_call",
    "tool_result",
    "model_call",
    "artifact_written",
    "policy_violation",
    "run_finished",
]
RiskSeverity = Literal["low", "medium", "high", "critical"]
PolicyAction = Literal["allowed", "warned", "blocked", "needs_review"]
RuntimeTarget = Literal["openclaw", "hermes", "skilllite", "custom"]
SkillStatus = Literal["approved", "deprecated"]
SkillCandidateStatus = Literal["pending", "approved", "rejected"]
SkillVisibility = Literal["private", "team", "company"]


class EngineRegister(BaseModel):
    engine_id: str = Field(min_length=1, max_length=128)
    engine_version: str = Field(min_length=1, max_length=128)
    engine_type: EngineType | None = None
    display_name: str = ""
    owner_team: str = ""
    deployment_kind: DeploymentKind = "server"
    dispatch_url: str | None = None
    capabilities: dict[str, Any] = Field(default_factory=dict)


class ArtifactManifestItem(BaseModel):
    path: str = Field(min_length=1)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    bytes: int = Field(ge=0)


class RunComplete(BaseModel):
    engine_id: str = Field(min_length=1, max_length=128)
    engine_version: str = Field(min_length=1, max_length=128)
    status: TerminalRunStatus
    exit_code: int
    finished_at: str
    log_excerpt: str = Field(default="", max_length=65536)
    artifact_manifest: list[ArtifactManifestItem] = Field(default_factory=list)
    artifact_bundle_url: str | None = None
    signals: dict[str, Any] = Field(default_factory=dict)


class RunEventIngest(BaseModel):
    run_id: str = Field(min_length=1, max_length=128)
    engine_id: str = Field(min_length=1, max_length=128)
    event_type: RunEventType
    ts: str
    seq: int = Field(default=0, ge=0)
    tenant_id: str = Field(default="", max_length=128)
    team_id: str = Field(default="", max_length=128)
    agent_id: str = Field(default="", max_length=128)
    engine_type: EngineType = "custom"
    engine_version: str = Field(default="", max_length=128)
    task_id: str = Field(default="", max_length=128)
    status: RunStatus | None = None
    exit_code: int | None = None
    log_excerpt: str = Field(default="", max_length=65536)
    artifact_manifest: list[ArtifactManifestItem] = Field(default_factory=list)
    artifact_bundle_url: str | None = None
    signals: dict[str, Any] = Field(default_factory=dict)
    payload: dict[str, Any] = Field(default_factory=dict)


class PolicyViolationIngest(BaseModel):
    run_id: str = Field(min_length=1, max_length=128)
    engine_id: str = Field(min_length=1, max_length=128)
    policy_id: str = Field(min_length=1, max_length=128)
    severity: RiskSeverity
    action: PolicyAction
    resource_type: str = Field(min_length=1, max_length=128)
    resource: str = ""
    message: str = Field(default="", max_length=2000)
    ts: str
    context: dict[str, Any] = Field(default_factory=dict)


class SkillCandidateCreate(BaseModel):
    candidate_id: str = Field(min_length=1, max_length=128)
    source_run_id: str = Field(min_length=1, max_length=128)
    tenant_id: str = Field(default="", max_length=128)
    team_id: str = Field(default="", max_length=128)
    agent_id: str = Field(default="", max_length=128)
    engine_id: str = Field(min_length=1, max_length=128)
    runtime_target: RuntimeTarget
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=2000)
    package_url: str | None = None
    inline_manifest: dict[str, Any] = Field(default_factory=dict)
    signals: dict[str, Any] = Field(default_factory=dict)


class SkillCandidateReview(BaseModel):
    decision: Literal["approved", "rejected"]
    reviewer: str = Field(min_length=1, max_length=128)
    reason: str = Field(default="", max_length=2000)
    visibility: SkillVisibility = "team"
    promotion_channel: str | None = Field(default=None, max_length=64)


class SkillDeprecate(BaseModel):
    reason: str = Field(default="", max_length=2000)
    reviewer: str = Field(default="admin", min_length=1, max_length=128)


class SkillPackageUpload(BaseModel):
    skill_id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=2000)
    version: str = Field(default="0.1.0", max_length=64)
    runtime_targets: list[RuntimeTarget] = Field(default_factory=lambda: ["custom"])
    visibility: SkillVisibility = "team"
    team_id: str = Field(default="", max_length=128)
    tags: list[str] = Field(default_factory=list)
    filename: str = Field(min_length=1, max_length=256)
    content_base64: str = Field(min_length=1)
    source_run_id: str = Field(default="", max_length=128)
    readme: str = Field(default="", max_length=20000)
    dependencies: list[str] = Field(default_factory=list)


AccountStatus = Literal["active", "disabled"]
ApiKeyStatus = Literal["active", "revoked"]


class GatewayAccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    team_id: str = Field(default="", max_length=128)
    owner_email: str = Field(default="", max_length=256)
    notes: str = Field(default="", max_length=2000)


class GatewayAccountUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    team_id: str | None = Field(default=None, max_length=128)
    owner_email: str | None = Field(default=None, max_length=256)
    status: AccountStatus | None = None
    notes: str | None = Field(default=None, max_length=2000)


class GatewayApiKeyCreate(BaseModel):
    label: str = Field(default="", max_length=128)
    scopes: list[str] = Field(default_factory=lambda: ["gateway.chat"])
    expires_at: str | None = None
    monthly_token_limit: int = Field(default=0, ge=0)
    monthly_cost_limit_usd: float = Field(default=0, ge=0)
    burst_rpm_limit: int = Field(default=0, ge=0)


class GatewayApiKeyUpdate(BaseModel):
    label: str | None = Field(default=None, max_length=128)
    scopes: list[str] | None = None
    expires_at: str | None = None
    monthly_token_limit: int | None = Field(default=None, ge=0)
    monthly_cost_limit_usd: float | None = Field(default=None, ge=0)
    burst_rpm_limit: int | None = Field(default=None, ge=0)


class ConsoleRegister(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    owner_email: str = Field(default="", max_length=256)
    team_id: str = Field(default="", max_length=128)


class ConsoleLogin(BaseModel):
    api_key: str = Field(min_length=8, max_length=256)


KnowledgeSourceType = Literal["feishu", "yuque", "custom", "native"]
KnowledgePublishStatus = Literal["draft", "published", "deprecated"]


class KnowledgeSourceCreate(BaseModel):
    source_id: str = Field(min_length=1, max_length=128)
    source_type: KnowledgeSourceType
    name: str = Field(min_length=1, max_length=128)
    tenant_id: str = Field(default="", max_length=128)
    team_id: str = Field(default="", max_length=128)
    config: dict[str, Any] = Field(default_factory=dict)


class KnowledgeSourceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    tenant_id: str | None = Field(default=None, max_length=128)
    team_id: str | None = Field(default=None, max_length=128)
    status: Literal["active", "paused"] | None = None
    config: dict[str, Any] | None = None


class KnowledgeDocumentIngestItem(BaseModel):
    external_id: str = Field(min_length=1, max_length=256)
    title: str = Field(min_length=1, max_length=512)
    url: str = Field(default="", max_length=2000)
    space_name: str = Field(default="", max_length=256)
    content_text: str = Field(default="", max_length=50000)
    tags: list[str] = Field(default_factory=list)
    team_id: str = Field(default="", max_length=128)
    updated_at_source: str = Field(default="", max_length=64)


class KnowledgeDocumentIngestBatch(BaseModel):
    source_id: str = Field(min_length=1, max_length=128)
    documents: list[KnowledgeDocumentIngestItem] = Field(min_length=1, max_length=200)


class KnowledgeSpaceCreate(BaseModel):
    space_id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=2000)
    team_id: str = Field(default="", max_length=128)


class KnowledgeFolderCreate(BaseModel):
    folder_id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=128)
    parent_folder_id: str = Field(default="", max_length=128)


class KnowledgeNativeDocCreate(BaseModel):
    slug: str = Field(min_length=1, max_length=128)
    title: str = Field(min_length=1, max_length=512)
    folder_id: str = Field(default="", max_length=128)
    content_md: str = Field(default="", max_length=100000)
    author: str = Field(default="", max_length=128)
    publish_status: KnowledgePublishStatus = "draft"
    tags: list[str] = Field(default_factory=list)


class KnowledgeNativeDocUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=512)
    folder_id: str | None = Field(default=None, max_length=128)
    content_md: str | None = Field(default=None, max_length=100000)
    author: str | None = Field(default=None, max_length=128)
    publish_status: KnowledgePublishStatus | None = None
    tags: list[str] | None = None


class GatewayModelRouteCreate(BaseModel):
    alias: str = Field(min_length=1, max_length=128)
    target_model: str = Field(min_length=1, max_length=256)
    team_id: str = Field(default="", max_length=128)
    account_id: str = Field(default="", max_length=128)
    description: str = Field(default="", max_length=512)
    priority: int = Field(default=100, ge=0, le=10000)
    enabled: bool = True


class GatewayModelRouteUpdate(BaseModel):
    alias: str | None = Field(default=None, min_length=1, max_length=128)
    target_model: str | None = Field(default=None, min_length=1, max_length=256)
    team_id: str | None = Field(default=None, max_length=128)
    account_id: str | None = Field(default=None, max_length=128)
    description: str | None = Field(default=None, max_length=512)
    priority: int | None = Field(default=None, ge=0, le=10000)
    enabled: bool | None = None


class OidcExchange(BaseModel):
    code: str = Field(min_length=8, max_length=256)

