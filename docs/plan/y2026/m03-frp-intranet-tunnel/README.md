# FRP 内网穿透：通过公网服务器安全暴露内网 SSH 服务

> **文档日期**：2026-03  
> **FRP 版本**：v0.67.0（最新稳定版）  
> **目标**：从任意位置通过 FRP 隧道 SSH 连接到内网 Linux 服务器

---

## 目录

1. [架构概览](#1-架构概览)
2. [安装](#2-安装)
3. [配置](#3-配置)
4. [安全加固](#4-安全加固)
5. [配置系统服务（开机自启）](#5-配置系统服务开机自启)
6. [从外部连接](#6-从外部连接)
7. [监控与故障排查](#7-监控与故障排查)
8. [其他方案参考](#8-其他方案参考)

---

## 1. 架构概览

### 连接流程

```
┌─────────────────────────────────────────────────────────────────┐
│                        连接发起方（你）                           │
│                   任意位置的电脑 / 手机                           │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            │  ssh -p 6022 user@公网IP
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   公网服务器（Public Machine）                    │
│                    IP: <your-public-ip>                         │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   frps（服务端）                          │   │
│  │   bindPort: 7000  ←─── frpc 客户端长连接注册于此          │   │
│  │   remotePort: 6022 ←── 外部 SSH 流量进入此端口            │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  防火墙开放端口：7000（frp通信）、6022（SSH转发）                 │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            │  持久加密隧道（frpc ←→ frps）
                            │  frpc 主动发起，穿透内网 NAT
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   内网服务器（LAN Machine）                       │
│                 仅在局域网内可访问，无公网 IP                     │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   frpc（客户端）                          │   │
│  │   serverAddr: <公网IP>    serverPort: 7000               │   │
│  │   将 127.0.0.1:22 → 公网 remotePort:6022                 │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  sshd 监听 127.0.0.1:22                                         │
└─────────────────────────────────────────────────────────────────┘
```

### 角色说明

| 角色 | 机器 | 程序 | 职责 |
|------|------|------|------|
| **frps**（服务端） | 公网服务器 | `frps` | 监听来自 frpc 的注册连接；对外暴露映射端口 |
| **frpc**（客户端） | 内网服务器 | `frpc` | 主动连接 frps，建立隧道；将内网端口流量转发回公网 |

> **核心原理**：frpc 由内网**主动**连接公网 frps，绕过 NAT 限制。frps 收到外部 SSH 流量后，通过已建立的隧道转发给 frpc，再由 frpc 转发到本机 sshd。

---

## 2. 安装

### 推荐方式：下载预编译二进制

**不建议**从源码编译，预编译版本经过充分测试且开箱即用。

#### 查看最新版本

```bash
# 当前最新版本：v0.67.0
# 发布页：https://github.com/fatedier/frp/releases/latest
```

#### 在公网服务器安装 frps

```bash
# 以 amd64 Linux 为例（根据实际架构选择）
FRP_VERSION="0.67.0"
ARCH="amd64"  # 或 arm64、arm 等

cd /tmp
wget https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/frp_${FRP_VERSION}_linux_${ARCH}.tar.gz
tar -xzf frp_${FRP_VERSION}_linux_${ARCH}.tar.gz
cd frp_${FRP_VERSION}_linux_${ARCH}

# 只需要 frps
sudo cp frps /usr/local/bin/
sudo chmod +x /usr/local/bin/frps

# 创建配置目录
sudo mkdir -p /etc/frp
```

#### 在内网服务器安装 frpc

```bash
FRP_VERSION="0.67.0"
ARCH="amd64"

cd /tmp
wget https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/frp_${FRP_VERSION}_linux_${ARCH}.tar.gz
tar -xzf frp_${FRP_VERSION}_linux_${ARCH}.tar.gz
cd frp_${FRP_VERSION}_linux_${ARCH}

# 只需要 frpc
sudo cp frpc /usr/local/bin/
sudo chmod +x /usr/local/bin/frpc

sudo mkdir -p /etc/frp
```

#### 验证安装

```bash
# 公网服务器
frps --version

# 内网服务器
frpc --version
```

---

## 3. 配置

> **注意**：FRP v0.52+ 已将配置格式从 `.ini` 迁移到 **TOML**，本文所有示例均使用 TOML 格式。

### 3.1 公网服务器：frps.toml

```bash
sudo nano /etc/frp/frps.toml
```

```toml
# /etc/frp/frps.toml
# ────────────────────────────────────────────────
# frps - 公网服务器端配置
# ────────────────────────────────────────────────

[common]
# frpc 客户端连接到此端口注册隧道
bindPort = 7000

# ── 认证 ──────────────────────────────────────
[auth]
method = "token"
# 强烈建议设置足够随机的 token（frpc 端必须一致）
token = "your-very-strong-secret-token-here"

# ── 日志 ──────────────────────────────────────
[log]
to = "/var/log/frps.log"
level = "info"       # debug | info | warn | error
maxDays = 7          # 日志保留天数

# ── 可选：管理面板（Web UI）─────────────────────
# 如需启用，取消以下注释；建议仅绑定本地地址，通过 SSH 隧道访问
# [webServer]
# addr = "127.0.0.1"
# port = 7500
# user = "admin"
# password = "your-dashboard-password"
```

### 3.2 内网服务器：frpc.toml

```bash
sudo nano /etc/frp/frpc.toml
```

```toml
# /etc/frp/frpc.toml
# ────────────────────────────────────────────────
# frpc - 内网服务器端配置
# ────────────────────────────────────────────────

[common]
# 公网服务器的 IP 或域名
serverAddr = "your-public-server-ip"
# 与 frps.toml 中 bindPort 一致
serverPort = 7000

# ── 认证（必须与 frps 端 token 完全一致）────────
[auth]
method = "token"
token  = "your-very-strong-secret-token-here"

# ── 日志 ──────────────────────────────────────
[log]
to = "/var/log/frpc.log"
level = "info"
maxDays = 7

# ── SSH 隧道代理配置 ───────────────────────────
[[proxies]]
name       = "lan-ssh"          # 任意唯一名称
type       = "tcp"
localIP    = "127.0.0.1"        # 本机 sshd 地址
localPort  = 22                 # 本机 sshd 端口
remotePort = 6022               # 公网服务器对外暴露的端口
                                # 外部用户通过 公网IP:6022 访问
```

### 3.3 配置说明汇总

| 配置项 | 说明 | 建议值 |
|--------|------|--------|
| `bindPort` | frpc 注册连接的端口 | `7000`（或自定义） |
| `auth.token` | 认证令牌，frps/frpc 必须一致 | 随机强密码，≥32位 |
| `serverAddr` | 公网服务器 IP/域名 | 你的公网 IP |
| `localPort` | 内网 sshd 端口 | `22` |
| `remotePort` | 对外暴露的端口 | `6022`（避开 22，减少扫描） |

---

## 4. 安全加固

### 4.1 认证令牌

```bash
# 生成强随机 token（推荐方式）
openssl rand -base64 32
# 输出示例：kH3mPqR7xLwN2vB8yJ5dF0tG6cA9sE1u...
```

- Token 至少 **32 位**，包含字母+数字+特殊字符
- 两台机器配置文件中的 token **必须完全一致**
- 定期轮换 token（建议每季度更换）

### 4.2 公网服务器防火墙配置

```bash
# 使用 ufw（Ubuntu/Debian）
sudo ufw allow 7000/tcp comment "frp bind port"
sudo ufw allow 6022/tcp comment "frp SSH tunnel"
sudo ufw enable

# 如果 SSH 端口改为非标准端口，确保也开放
# sudo ufw allow 2222/tcp comment "SSH custom port"

# 可选：限制 frp 端口仅允许特定 IP 访问
# sudo ufw allow from <your-home-ip> to any port 6022
```

```bash
# 使用 firewalld（CentOS/RHEL/Fedora）
sudo firewall-cmd --permanent --add-port=7000/tcp
sudo firewall-cmd --permanent --add-port=6022/tcp
sudo firewall-cmd --reload
```

### 4.3 SSH 服务加固（内网服务器）

```bash
sudo nano /etc/ssh/sshd_config
```

```
# ── 禁用密码登录，仅允许密钥认证 ────────────────
PasswordAuthentication no
ChallengeResponseAuthentication no
UsePAM no

# ── 禁用 root 直接登录 ─────────────────────────
PermitRootLogin no

# ── 限制允许登录的用户 ─────────────────────────
AllowUsers your-username

# ── 启用密钥认证 ───────────────────────────────
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
```

```bash
# 重启 sshd 使配置生效
sudo systemctl restart sshd
```

#### 配置 SSH 密钥认证

```bash
# 在你的本地电脑上生成密钥对（如果没有）
ssh-keygen -t ed25519 -C "your-comment"

# 将公钥上传到内网服务器
# 由于内网不可直达，先传到公网服务器，再中转
scp ~/.ssh/id_ed25519.pub user@public-ip:/tmp/
ssh user@public-ip "cat /tmp/id_ed25519.pub" | ssh lan-user@lan-ip "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"

# 或：在 frp 隧道建好后，直接上传
ssh-copy-id -p 6022 lan-user@public-ip
```

### 4.4 安装 fail2ban（内网服务器）

```bash
sudo apt install fail2ban -y    # Debian/Ubuntu
sudo yum install fail2ban -y    # CentOS/RHEL

sudo systemctl enable fail2ban
sudo systemctl start fail2ban

# 查看 SSH 保护状态
sudo fail2ban-client status sshd
```

### 4.5 启用 TLS 加密（frps ↔ frpc 之间）

在 `frps.toml` 中：

```toml
[transport]
tls.force = true    # 强制要求客户端使用 TLS
```

在 `frpc.toml` 中：

```toml
[transport]
tls.enable = true   # 启用 TLS 连接到 frps
```

> TLS 对 frps↔frpc 的通信链路加密，但 SSH 协议本身已加密，此项为额外纵深防御。

### 4.6 最小暴露原则

- **只映射 SSH 端口**，不暴露数据库、HTTP 等其他服务
- 定期审查 `frpc.toml` 中的 `[[proxies]]` 列表，删除不需要的映射
- 如果目标用户来源固定（如家里），在防火墙层面限制 `remotePort` 的访问 IP

---

## 5. 配置系统服务（开机自启）

### 5.1 公网服务器：frps.service

```bash
sudo nano /etc/systemd/system/frps.service
```

```ini
[Unit]
Description=FRP Server (frps)
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=nobody
Group=nogroup
ExecStart=/usr/local/bin/frps -c /etc/frp/frps.toml
Restart=always
RestartSec=5
LimitNOFILE=65536

# 安全沙箱限制
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
# 启用并启动
sudo systemctl daemon-reload
sudo systemctl enable frps
sudo systemctl start frps

# 查看状态
sudo systemctl status frps
```

### 5.2 内网服务器：frpc.service

```bash
sudo nano /etc/systemd/system/frpc.service
```

```ini
[Unit]
Description=FRP Client (frpc)
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=nobody
Group=nogroup
ExecStart=/usr/local/bin/frpc -c /etc/frp/frpc.toml
Restart=always
RestartSec=5
LimitNOFILE=65536

NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable frpc
sudo systemctl start frpc

sudo systemctl status frpc
```

### 5.3 保护配置文件权限

```bash
# frp 配置文件包含 token，严格限制读取权限
sudo chmod 600 /etc/frp/frps.toml
sudo chmod 600 /etc/frp/frpc.toml
sudo chown root:root /etc/frp/*.toml
```

---

## 6. 从外部连接

### 6.1 基础 SSH 命令

```bash
# 通过 FRP 隧道连接到内网服务器
ssh -p 6022 lan-username@<公网服务器IP>

# 使用密钥文件（如果密钥不在默认位置）
ssh -p 6022 -i ~/.ssh/id_ed25519 lan-username@<公网服务器IP>
```

### 6.2 配置 ~/.ssh/config（推荐）

在本地机器的 `~/.ssh/config` 中添加：

```
# 内网服务器（通过 FRP 隧道）
Host lan-server
    HostName <公网服务器IP>       # 或公网域名
    Port 6022
    User lan-username
    IdentityFile ~/.ssh/id_ed25519
    ServerAliveInterval 60       # 每 60 秒发送心跳，保持连接
    ServerAliveCountMax 3
```

之后只需：

```bash
ssh lan-server
```

### 6.3 SCP / SFTP 文件传输

```bash
# 从内网服务器下载文件
scp -P 6022 lan-username@<公网IP>:/remote/path/file.txt ./local/

# 上传文件到内网服务器
scp -P 6022 ./local/file.txt lan-username@<公网IP>:/remote/path/

# 如果已配置 ~/.ssh/config
scp lan-server:/remote/path/file.txt ./local/
```

### 6.4 SSH 端口转发（进阶）

```bash
# 本地端口转发：将本地 8080 映射到内网服务器的 3000
ssh -L 8080:localhost:3000 -p 6022 lan-username@<公网IP>

# 同样，配置好 config 后：
ssh -L 8080:localhost:3000 lan-server
```

---

## 7. 监控与故障排查

### 7.1 检查服务状态

```bash
# 公网服务器
sudo systemctl status frps
sudo journalctl -u frps -f          # 实时查看日志
sudo tail -f /var/log/frps.log

# 内网服务器
sudo systemctl status frpc
sudo journalctl -u frpc -f
sudo tail -f /var/log/frpc.log
```

### 7.2 验证端口监听

```bash
# 公网服务器：确认 frp 端口已监听
sudo ss -tlnp | grep -E "7000|6022"

# 预期输出：
# LISTEN  0  128  0.0.0.0:7000  ...  frps
# LISTEN  0  128  0.0.0.0:6022  ...  frps
```

### 7.3 测试连通性

```bash
# 从外部测试端口是否开放
nc -zv <公网IP> 6022

# 测试 frp 绑定端口
nc -zv <公网IP> 7000
```

### 7.4 常见问题排查

| 问题现象 | 可能原因 | 排查步骤 |
|----------|----------|----------|
| `Connection refused` on port 6022 | frpc 未连接 / frpc 未运行 | 检查 `frpc` 服务状态；查看 frpc 日志 |
| `Connection timed out` | 防火墙屏蔽 | 检查公网服务器防火墙；确认端口已开放 |
| `Permission denied (publickey)` | SSH 密钥未配置 | 确认公钥已添加到 `~/.ssh/authorized_keys` |
| frpc 日志显示 `auth failed` | token 不匹配 | 仔细核对两端 `auth.token` 是否完全一致（区分大小写） |
| frpc 频繁重连 | 网络不稳定 / 公网服务器重启 | `Restart=always` 已处理；检查 frps 端日志 |
| 端口冲突 | `remotePort` 被其他进程占用 | `sudo ss -tlnp | grep 6022`；更换端口 |

### 7.5 开启 frp 管理面板（可选）

在 `frps.toml` 中启用（**注意：务必绑定 127.0.0.1**）：

```toml
[webServer]
addr     = "127.0.0.1"
port     = 7500
user     = "admin"
password = "your-dashboard-password"
```

通过 SSH 隧道安全访问面板：

```bash
# 本地转发公网服务器的 7500 端口
ssh -L 7500:127.0.0.1:7500 user@<公网IP>
# 然后在本地浏览器访问：http://127.0.0.1:7500
```

---

## 8. 其他方案参考

> 用户已选定 FRP，以下方案仅供知识储备，不建议替换。

| 方案 | 优点 | 缺点 |
|------|------|------|
| **Tailscale** | 零配置，基于 WireGuard，Mesh 网络，无需公网服务器 | 依赖第三方协调服务器（有免费限额）；需在每台设备安装 |
| **WireGuard** | 内核级 VPN，性能极高，完全自托管 | 配置相对复杂；需要管理密钥和路由 |
| **SSH 反向隧道** | 无需额外软件，原生 SSH 支持 | 不稳定（断线需手动重连）；需配合 autossh 使用 |
| **ngrok** | 极简配置，免费层可用 | 免费版域名随机；商业软件，有数据流量隐私顾虑 |

**为什么选 FRP**：
- 完全自托管，数据不经过第三方
- 配置灵活，支持多种协议（TCP/UDP/HTTP/HTTPS）
- 性能优秀，社区活跃，持续更新维护
- 开源（Apache 2.0 License）

---

## 快速部署检查清单

```
公网服务器（frps）：
  [ ] 下载并安装 frps v0.67.0
  [ ] 创建 /etc/frp/frps.toml（设置 bindPort + 强 token）
  [ ] 防火墙开放 7000/tcp 和 6022/tcp
  [ ] 配置 systemd 服务并 enable
  [ ] 确认 frps 正常运行

内网服务器（frpc）：
  [ ] 下载并安装 frpc v0.67.0
  [ ] 创建 /etc/frp/frpc.toml（serverAddr + 同一 token + SSH 代理）
  [ ] 配置 systemd 服务并 enable
  [ ] 确认 frpc 正常连接（查看日志）

SSH 安全加固：
  [ ] 生成 SSH 密钥对，配置密钥登录
  [ ] 禁用密码认证（PasswordAuthentication no）
  [ ] 安装并配置 fail2ban
  [ ] 测试密钥登录后再禁用密码

连接测试：
  [ ] 从外部执行 ssh -p 6022 user@公网IP
  [ ] 配置 ~/.ssh/config 别名，测试 ssh lan-server
  [ ] 验证 SCP 文件传输正常
```

---

*参考资料：*
- *FRP 官方文档：https://gofrp.org/zh-cn/docs/*
- *FRP GitHub：https://github.com/fatedier/frp*
- *FRP 最新 Release：https://github.com/fatedier/frp/releases/latest*
