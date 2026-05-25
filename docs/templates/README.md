# Evotown 配置模板

IT 一键部署后，`scripts/enterprise-deploy.sh` 会在 `deploy-output/` 生成同名文件。

| 文件 | 用途 |
|------|------|
| [evotown.agent.env](./evotown.agent.env) | **员工两行配置**（`EVOTOWN_URL` + `EVOTOWN_API_KEY`） |
| [openclaw.evotown.yaml](./openclaw.evotown.yaml) | OpenClaw 模型 + SkillHub manifest |
| [hermes.evotown.yaml](./hermes.evotown.yaml) | Hermes 模型 + SkillHub manifest |
| [env.enterprise.example](./env.enterprise.example) | IT Docker 部署 `.env` 模板 |

控制台也可在 **`/market`** 与 **`/gateway`** 页一键复制上述配置。

员工 CLI：`scripts/evotown-agent-setup.py`（`check` / `sync` / `watch` / `print-env`）

完整文档：[ENTERPRISE_QUICKSTART.md](../zh-CN/ENTERPRISE_QUICKSTART.md) · [MDM_AGENT_ROLLOUT.md](../zh-CN/MDM_AGENT_ROLLOUT.md)
