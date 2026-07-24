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


EngineType = Literal["openclaw", "hermes", "skilllite", "custom", "hosted_coding"]
DeploymentKind = Literal["laptop", "server", "ci", "container"]
RunStatus = Literal["running", "succeeded", "failed", "cancelled"]
TerminalRunStatus = Literal["succeeded", "failed", "cancelled"]
HostedAgentRunStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]
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
SkillStatus = Literal["draft", "pending", "approved", "deprecated", "rejected"]
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
    rotate_ingest_token: bool = False


class WorkspaceCreate(BaseModel):
    name: str = Field(default="Personal Sandbox", min_length=1, max_length=128)
    account_id: str = Field(default="", max_length=128)
    owner_account_id: str = Field(default="", max_length=128)
    tenant_id: str = Field(default="", max_length=128)
    team_id: str = Field(default="", max_length=128)
    model_policy: Literal["all", "routes_only"] = "all"
    category: Literal["employee", "department", "dedicated"] = "employee"
    template_id: str = Field(default="", max_length=128)
    role_ids: list[str] = Field(default_factory=list)


class WorkspaceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    status: Literal["active", "archived", "deleted"] | None = None
    storage_quota_mb: int | None = Field(default=None, ge=0, le=1048576)
    model_policy: Literal["all", "routes_only"] | None = None
    owner_account_id: str | None = Field(default=None, max_length=128)


class WorkspaceProfileUpdate(BaseModel):
    agent_type: str = Field(default="", max_length=64)
    runtime_engine: Literal["claude", "codex"] = "claude"
    soul: str = Field(default="", max_length=8000)
    paradigm: str = Field(default="", max_length=8000)
    standards: str = Field(default="", max_length=8000)
    default_model: str = Field(default="", max_length=128)
    default_skills: list[str] = Field(default_factory=list, max_length=32)
    default_mcp: list[str] = Field(default_factory=list, max_length=16)


class ClaudeAgentRunCreate(BaseModel):
    prompt: str = Field(min_length=1, max_length=32000)
    model: str = Field(default="", max_length=128)
    skills: list[str] = Field(default_factory=list)
    mcp: list[str] = Field(default_factory=list)
    previous_run_id: str = Field(default="", max_length=64)
    attachments: list[str] = Field(default_factory=list, max_length=20)


class AgentExternalTriggerRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=32000)
    session_id: str = Field(default="", max_length=64)
    skills: list[str] = Field(default_factory=list)
    model: str = Field(default="", max_length=128)
    attachments: list[str] = Field(default_factory=list, max_length=20)


class ApiResponse(BaseModel):
    code: int
    message: str
    data: Any | None = None


class AgentShareRequest(BaseModel):
    paths: list[str] = Field(min_length=1, max_length=50)
    target_agent_id: str = Field(min_length=1, max_length=128)
    dest_prefix: str = Field(default="", max_length=256)
    overwrite: bool = False


class SetupAgentRequest(BaseModel):
    workspace_name: str = Field(default="", max_length=128)  # 专属账号时必填，其他自动生成


class ClaudeAgentRunStatusUpdate(BaseModel):
    status: HostedAgentRunStatus


DispatchJobKind = Literal["dispatch", "handoff", "notify"]
DispatchJobStatus = Literal["queued", "leased", "running", "completed", "failed", "cancelled"]


class EngineHeartbeat(BaseModel):
    engine_version: str | None = None
    connector_version: str = ""
    gateway_reachable: bool | None = None
    meta: dict[str, Any] = Field(default_factory=dict)


class DispatchJobCreate(BaseModel):
    kind: DispatchJobKind = "dispatch"
    source_engine_id: str | None = Field(default=None, max_length=128)
    target_engine_id: str | None = Field(default=None, max_length=128)
    target_team_id: str | None = Field(default=None, max_length=128)
    title: str = Field(default="", max_length=256)
    message: str = Field(min_length=1, max_length=32000)
    payload: dict[str, Any] = Field(default_factory=dict)
    refs: dict[str, Any] = Field(default_factory=dict)


class DispatchJobAck(BaseModel):
    engine_id: str = Field(min_length=1, max_length=128)


class DispatchJobComplete(BaseModel):
    engine_id: str = Field(min_length=1, max_length=128)
    status: TerminalRunStatus = "succeeded"
    exit_code: int = 0
    log_excerpt: str = Field(default="", max_length=65536)
    result_summary: str = Field(default="", max_length=8000)
    run_id: str | None = Field(default=None, max_length=128)
    signals: dict[str, Any] = Field(default_factory=dict)


class DispatchHandoffSpec(BaseModel):
    """Enqueue after parent job succeeds (payload.on_success_handoff)."""
    target_engine_id: str | None = Field(default=None, max_length=128)
    target_team_id: str | None = Field(default=None, max_length=128)
    kind: DispatchJobKind = "handoff"
    title: str = Field(default="", max_length=256)
    message: str = Field(min_length=1, max_length=32000)
    refs: dict[str, Any] = Field(default_factory=dict)


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


class PolicyUpsert(BaseModel):
    policy_id: str = Field(min_length=1, max_length=128)
    category: str = Field(default="custom", max_length=64)
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=2000)
    enabled: bool = True
    rules: dict[str, Any] = Field(default_factory=dict)


class PoliciesReplace(BaseModel):
    policies: list[PolicyUpsert] = Field(default_factory=list)


PolicyCheckKind = Literal["tool", "file_read", "file_write", "network", "artifact", "text"]


class PolicyEvaluateRequest(BaseModel):
    kind: PolicyCheckKind
    resource: str = Field(min_length=1, max_length=4096)
    run_id: str = Field(default="", max_length=128)
    engine_id: str = Field(default="", max_length=128)
    workspace_roots: list[str] = Field(default_factory=list)
    extra: dict[str, Any] = Field(default_factory=dict)


AssetType = Literal["skill", "prompt", "workflow", "playbook", "memory_snippet", "tool_config", "evaluation_case"]


class AssetPropose(BaseModel):
    asset_id: str = Field(default="", max_length=128)
    asset_type: AssetType = "prompt"
    source_run_id: str = Field(default="", max_length=128)
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=2000)
    author: str = Field(default="", max_length=128)
    team_id: str = Field(default="", max_length=128)
    engine_id: str = Field(default="", max_length=128)
    version: str = Field(default="0.1.0", max_length=64)
    tags: list[str] = Field(default_factory=list)
    content: dict[str, Any] = Field(default_factory=dict)


class AssetReview(BaseModel):
    decision: Literal["approved", "rejected"]
    reviewer: str = Field(default="admin", min_length=1, max_length=128)
    reason: str = Field(default="", max_length=2000)


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


class SkillBundlePublish(BaseModel):
    channel: str = Field(default="stable", min_length=1, max_length=32)
    version: str | None = Field(default=None, max_length=64)
    runtime_targets: list[RuntimeTarget] = Field(
        default_factory=lambda: ["openclaw", "hermes", "skilllite", "custom"],
    )
    skill_ids: list[str] = Field(default_factory=list)
    include_all_approved: bool = False
    team_id: str | None = Field(default=None, max_length=128)
    runtime_target: RuntimeTarget | None = None


class SkillCatalogStarterImport(BaseModel):
    catalog_id: str = Field(default="", max_length=128)
    import_all: bool = False
    auto_approve: bool = True


class SkillCatalogEcosystemImport(BaseModel):
    catalog_id: str = Field(min_length=1, max_length=128)
    runtime_target: RuntimeTarget = "skilllite"


AccountStatus = Literal["active", "disabled"]
ApiKeyStatus = Literal["active", "revoked"]


class GatewayAccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    org_id: str = Field(default="", max_length=128)
    owner_email: str = Field(default="", max_length=256)
    notes: str = Field(default="", max_length=2000)
    account_type: str = Field(default="employee", max_length=32)
    login_name: str = Field(default="", max_length=128)
    password: str = Field(default="", max_length=256)
    role: str = Field(default="employee", max_length=32)  # admin | employee


class GatewayAccountUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    org_id: str | None = Field(default=None, max_length=128)
    owner_email: str | None = Field(default=None, max_length=256)
    account_type: str | None = Field(default=None, max_length=32)
    status: AccountStatus | None = None
    notes: str | None = Field(default=None, max_length=2000)
    login_name: str | None = Field(default=None, max_length=128)
    role: str | None = Field(default=None, max_length=32)
    password: str | None = Field(default=None, max_length=256)


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


class StaffLogin(BaseModel):
    login_name: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=256)


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
    route_type: str = Field(default="static", max_length=32)
    fallback_models: list[str] = Field(default_factory=list)
    retry_policy: dict[str, Any] = Field(default_factory=dict)
    auto_policy: dict[str, Any] = Field(default_factory=dict)
    enable_fallback: bool = True


class GatewayModelRouteUpdate(BaseModel):
    alias: str | None = Field(default=None, min_length=1, max_length=128)
    target_model: str | None = Field(default=None, min_length=1, max_length=256)
    team_id: str | None = Field(default=None, max_length=128)
    account_id: str | None = Field(default=None, max_length=128)
    description: str | None = Field(default=None, max_length=512)
    priority: int | None = Field(default=None, ge=0, le=10000)
    enabled: bool | None = None
    route_type: str | None = Field(default=None, max_length=32)
    fallback_models: list[str] | None = None
    retry_policy: dict[str, Any] | None = None
    auto_policy: dict[str, Any] | None = None
    enable_fallback: bool | None = None


class GatewayUpstreamModelCreate(BaseModel):
    model_name: str = Field(min_length=1, max_length=128)
    api_base: str = Field(min_length=1, max_length=512)
    api_key: str = Field(min_length=1, max_length=512)
    anthropic_api_base: str = Field(default="", max_length=512)
    protocol: str = Field(default="openai", max_length=32)
    litellm_model: str = Field(default="", max_length=256)
    provider_label: str = Field(default="", max_length=128)
    description: str = Field(default="", max_length=512)
    enabled: bool = True
    is_vision: bool = False


class GatewayUpstreamModelUpdate(BaseModel):
    model_name: str | None = Field(default=None, min_length=1, max_length=128)
    api_base: str | None = Field(default=None, min_length=1, max_length=512)
    api_key: str | None = Field(default=None, min_length=1, max_length=512)
    anthropic_api_base: str | None = Field(default=None, max_length=512)
    protocol: str | None = Field(default=None, max_length=32)
    litellm_model: str | None = Field(default=None, max_length=256)
    provider_label: str | None = Field(default=None, max_length=128)
    description: str | None = Field(default=None, max_length=512)
    enabled: bool | None = None
    is_vision: bool | None = None


class GatewayOrgCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=2000)
    owner_email: str = Field(default="", max_length=256)


class GatewayOrgUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=2000)
    owner_email: str | None = Field(default=None, max_length=256)
    status: AccountStatus | None = None


DatabaseType = Literal["postgres", "mysql", "sqlite", "mssql"]
DatabasePrincipalType = Literal["account", "org", "team"]
DatabasePermission = Literal["read", "write", "admin"]


class DatabaseConnectionCreate(BaseModel):
    connection_id: str = Field(default="", max_length=128)
    name: str = Field(min_length=1, max_length=128)
    db_type: DatabaseType
    tenant_id: str = Field(default="", max_length=128)
    team_id: str = Field(default="", max_length=128)
    description: str = Field(default="", max_length=2000)
    config: dict[str, Any] = Field(default_factory=dict)


class DatabaseConnectionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    tenant_id: str | None = Field(default=None, max_length=128)
    team_id: str | None = Field(default=None, max_length=128)
    status: Literal["active", "paused"] | None = None
    description: str | None = Field(default=None, max_length=2000)
    environment: Literal["production", "development", "both"] | None = None
    config: dict[str, Any] | None = None


class DatabaseAccessGrantCreate(BaseModel):
    connection_id: str = Field(min_length=1, max_length=128)
    principal_type: DatabasePrincipalType
    principal_id: str = Field(min_length=1, max_length=128)
    permission: DatabasePermission = "read"


class DatabaseConnectionTestConfig(BaseModel):
    db_type: DatabaseType
    config: dict[str, Any] = Field(default_factory=dict)

