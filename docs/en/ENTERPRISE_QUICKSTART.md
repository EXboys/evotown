# Enterprise Quickstart: IT One-Click Deploy + Two-Line Agent Config

For companies where employees run **OpenClaw** or **Hermes** locally: deploy Evotown on-prem for a unified **LLM gateway** and **private SkillHub**. Agents need only **two env lines**.

See the full guide (Chinese, primary): [zh-CN/ENTERPRISE_QUICKSTART.md](zh-CN/ENTERPRISE_QUICKSTART.md)

## IT deploy

```bash
export UPSTREAM_BASE_URL=https://api.openai.com/v1
export UPSTREAM_API_KEY=sk-your-key
export EVOTOWN_PUBLIC_URL=https://evotown.company.internal
chmod +x scripts/enterprise-deploy.sh
./scripts/enterprise-deploy.sh
```

Output: `deploy-output/evotown.agent.env` and runtime YAML snippets.

## Employee config (two lines)

```bash
EVOTOWN_URL=https://evotown.company.internal
EVOTOWN_API_KEY=evk_xxxxxxxx
```

Maps to:

- `OPENAI_BASE_URL=$EVOTOWN_URL/api/gateway/v1`
- Skills manifest: `$EVOTOWN_URL/api/v1/market/bundles/default-agent-skills/manifest?runtime_target=openclaw|hermes`

Templates: [docs/templates/](../templates/)
