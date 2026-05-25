# MDM 批量下发：员工 OpenClaw / Hermes 接入

IT 将 **`evotown.agent.env`**（两行）放到员工机，并用 **`evotown-agent-setup`** 完成 gateway 校验与 SkillHub 自动同步。

---

## 1. IT 准备

部署 Evotown 后（见 [ENTERPRISE_QUICKSTART.md](./ENTERPRISE_QUICKSTART.md)）：

```bash
# 安装 CLI 到员工机 golden image（可选）
sudo install -m 755 scripts/evotown-agent-setup.py /usr/local/bin/evotown-agent-setup.py

# 准备 IT 主 env 文件（Jamf 文件 payload / Ansible template）
cat >/tmp/evotown.agent.env <<EOF
EVOTOWN_URL=https://evotown.company.internal
EVOTOWN_API_KEY=evk_xxxxxxxx
EOF
```

macOS 建议路径：`/Library/Application Support/Evotown/evotown.agent.env`  
Linux 建议路径：`/etc/evotown/evotown.agent.env`

---

## 2. 批量安装脚本

| 平台 | 脚本 |
|------|------|
| macOS | [scripts/mdm/install-evotown-agent-macos.sh](../../scripts/mdm/install-evotown-agent-macos.sh) |
| Linux | [scripts/mdm/install-evotown-agent-linux.sh](../../scripts/mdm/install-evotown-agent-linux.sh) |

脚本会：

1. 复制 env → `~/.config/evotown/evotown.agent.env`
2. 运行 `evotown-agent-setup check`
3. 运行 `evotown-agent-setup sync`
4. 添加 cron：每 4 小时自动 sync SkillHub

---

## 3. 员工本机一条命令（自助）

```bash
# 已有 evotown.agent.env
python3 /usr/local/bin/evotown-agent-setup.py check
python3 /usr/local/bin/evotown-agent-setup.py sync

# 写入 shell profile
eval "$(python3 evotown-agent-setup.py print-env)"
```

OpenClaw / Hermes 指向：

```bash
OPENAI_BASE_URL=$EVOTOWN_URL/api/gateway/v1
OPENAI_API_KEY=$EVOTOWN_API_KEY
```

Gateway **已支持 SSE streaming**（`stream: true`）。

---

## 4. 自动 sync（watch 模式）

```bash
python3 evotown-agent-setup.py watch --interval 3600
```

或由 cron / launchd 调用 `sync`（安装脚本已配置）。

---

## 5. Engine 注册（可选，IT token）

```bash
export EVOTOWN_INGEST_TOKEN=<ingest-token>
python3 evotown-agent-setup.py register
```

---

## 相关文档

- [ENTERPRISE_KEY_LIFECYCLE.md](./ENTERPRISE_KEY_LIFECYCLE.md)
- [ENTERPRISE_QUICKSTART.md](./ENTERPRISE_QUICKSTART.md)
