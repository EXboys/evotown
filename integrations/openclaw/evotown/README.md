# Evotown OpenClaw Plugin

Official-format OpenClaw plugin descriptor for enterprise deployments.

## Install

From the Evotown repo:

```bash
openclaw plugins install ./integrations/openclaw/evotown
```

Or fetch the manifest from your control plane:

```bash
curl -s "$EVOTOWN_URL/api/v1/integrations/openclaw/manifest"
```

## Configure

1. IT sets `EVOTOWN_URL` and issues an employee `evk_` key (`gateway.chat` + `console.read`).
2. Run `openclaw configure --section providers` and select **Evotown Gateway**.
3. Paste URL + API key — the plugin exports:

   - `OPENAI_BASE_URL=$EVOTOWN_URL/api/gateway/v1`
   - `OPENAI_API_KEY=$EVOTOWN_API_KEY`
   - Skill manifest URL for private SkillHub sync

See also `docs/templates/openclaw.evotown.yaml` and `docs/zh-CN/ENTERPRISE_QUICKSTART.md`.
