# Linux 云服务器部署指南

面向「云服务器（CVM / 宁美云等）+ 私有 GitHub 仓库 + 手动 git pull 更新」的生产部署。空白服务器从零到可访问约需 20–40 分钟。

> 文中「安全组」泛指云厂商安全组或主机商提供的防火墙面板，规则都是放行 22 / 80 / 443，3000 只对本机开放。
> 若服务器位于香港或海外节点：域名无需备案，Let's Encrypt 可直接签发；拉取 GitHub 顺畅；但**务必实测上游 AI 接口的连通性**（见 §4）。

> ⚠ 本文档中的自动化脚本尚未在真实服务器上跑通，请在首次执行时留意终端输出；每一步都给出了手工等价命令，便于逐段验证。

---

## 0. 架构与端口

```
浏览器 ──HTTPS(443)──▶ Nginx ──HTTP──▶ 127.0.0.1:3000 (Express/tsx)
                                          ├─ /api/*        业务接口
                                          ├─ /infinite-canvas/*  智能画布静态产物
                                          └─ /             React 静态产物（dist/）
```

- Node 进程只监听 `127.0.0.1` 语义下的 3000 端口（代码中 `app.listen(PORT, '0.0.0.0')`），公网入口一律经 Nginx。
- 运行时数据（账号、积分、任务、作品、上传文件、会话密钥）全部在 `data/`，**不在 Git 仓库中**，升级不覆盖、需单独备份。

## 1. 前置条件清单

| 项 | 要求 | 说明 |
|---|---|---|
| 服务器 | 2 核 2G 以上，Ubuntu 22.04/24.04、Debian 12、CentOS Stream 9、TencentOS 4 | 首次构建需要约 2GB 内存 |
| 磁盘 | 20 GB 以上 | 依赖 + 构建产物 + 作品图片 |
| Node.js | 由脚本安装 22.x | 源码要求 ≥ 22.12 |
| 域名 | 已解析 A 记录到服务器公网 IP | 未解析可先用 `http://IP:3000` 验证 |
| 安全组 | 放行 22 / 80 / 443 | 3000 不必对公网开放 |
| GitHub | 私有仓库 + 只读 Deploy Key | 不建议用 PAT 长期驻留服务器 |

## 2. 一次性准备（在本地 Windows / Mac 上完成）

### 2.1 创建私有仓库

GitHub → New repository：

- 名称：`celano-ppt`
- 可见性：**Private**（素材与上游接口信息不宜公开）
- 不要勾选 "Add a README"，本地已有提交

### 2.2 把本地基线推上去

本机已生成专用推送密钥，需要先把它的公钥加到 GitHub：

```bash
cat ~/.ssh/id_ed25519_github_celano.pub
# ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIP3Yj251+iFi4qLmcmkU/VtoyzLntHVej84p7P41H1fc celano-ppt-deploy@NereusGlide
```

添加路径：GitHub → Settings → SSH and GPG keys → New SSH key（粘贴上面那行）。随后：

```bash
cd /d/Work/CelanoLtd/PPT
git remote add origin git@github.com:NereusGlide/celano-ppt.git
git push -u origin main
```

### 2.3 服务器部署密钥

部署脚本会在服务器上自动生成一对 Deploy Key 并打印公钥，按提示添加到仓库
Settings → **Deploy keys** → Add deploy key（只读即可）。

## 3. 执行部署

### 3.1 让本机可以免密登录服务器

把本机的服务器访问公钥交给服务器管理员（或自己登录后粘贴）：

```bash
cat ~/.ssh/id_ed25519_celano_server.pub
# ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ0s8WEFG9MBJUUSq0G7fI9JPyfF6V3X5DJoUNz2+pQS celano-ppt-server-access
```

在服务器上执行：

```bash
sudo mkdir -p ~/.ssh && sudo chmod 700 ~/.ssh
echo 'ssh-ed25519 AAAA...celano-ppt-server-access' >> ~/.ssh/authorized_keys
sudo chmod 600 ~/.ssh/authorized_keys
```

> 若你用 root 账号，注意 `~` 展开为 `/root`。

### 3.2 首次部署（可重复执行，升级时同一条命令）

```bash
ssh root@<服务器IP>
bash -c 'cd /tmp && true'   # 确认已登录

# 把仓库拉到服务器需要 Git 访问权，这里先上传脚本与配置
# 方式一：git clone（需先完成 3.3 的 Deploy Key）
# 方式二：从本机 scp 整个项目（不含 node_modules）
```

推荐做法 —— 先在服务器上准备脚本：

```bash
# 在服务器上手动完成首次 clone
sudo useradd -r -m -s /bin/bash celano
sudo mkdir -p /opt/celano-ppt && sudo chown celano:celano /opt/celano-ppt
git clone --branch main --single-branch git@github.com:NereusGlide/celano-ppt.git /opt/celano-ppt
cd /opt/celano-ppt
sudo bash scripts/server-bootstrap.sh \
  --repo git@github.com:NereusGlide/celano-ppt.git \
  --branch main \
  --domain ppt.example.com \
  --email ops@example.com
```

脚本会依次完成：装依赖 → 装 Node 22 → 建服务用户 → 生成 Deploy Key（打印公钥后暂停）→ 拉代码 → 生成 `.env`（含随机密钥与初始管理员口令）→ `npm ci` → `npm run build` → 装 systemd → 配 Nginx + 签发证书。

**首次运行会因 Deploy Key 尚未添加而中止**，这是预期行为：把打印出的公钥加到 GitHub 后重跑同一条命令即可。

### 3.3 手工等价步骤（脚本失败时的兜底）

```bash
# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
# 依赖与构建
cd /opt/celano-ppt && npm ci && npm run build
# 密钥（务必用随机值，不要照抄示例）
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# systemd
sudo cp deploy/systemd/celano-ppt.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now celano-ppt
# Nginx
sudo cp deploy/nginx/celano-ppt.conf /etc/nginx/conf.d/celano-ppt.conf
sudo sed -i 's/example.com/ppt.example.com/g' /etc/nginx/conf.d/celano-ppt.conf
sudo certbot --nginx -d ppt.example.com -d www.ppt.example.com -m ops@example.com
```

## 4. 部署后验证

```bash
systemctl status celano-ppt                      # active (running)
journalctl -u celano-ppt -f                      # 观察启动日志
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/   # 期望 200
curl -sS -o /dev/null -w '%{http_code}\n' https://ppt.example.com/ # 期望 200
```

登录后台 `https://ppt.example.com/admin`，用脚本输出的初始口令登录，**立刻修改密码**，然后进入「AI 接口配置」填写 2K / 4K 生图接口与内容规划模型。

**海外/香港节点必做：上游连通性与时延实测。** 生图与内容规划走第三方中转，往返多轮请求对延迟敏感，先确认网络可达再调模型：

```bash
# 401 说明网络通、只是没带 Key；超时或 DNS 失败才需要处理出口
curl -sS -o /dev/null -w 'piao.world: %{http_code}  握手 %{time_connect}s  总计 %{time_total}s\n' https://piao.world/v1/models
curl -sS -o /dev/null -w 'xiaoyiapi:  %{http_code}  握手 %{time_connect}s  总计 %{time_total}s\n' https://image.xiaoyiapi.xyz/v1/models
```

连通但偏慢（>1s）属正常；连接超时优先怀疑服务器出口线路，此时可考虑在 `.env` 里改 `PIAO_BASE_URL` 指向自建或更近的转发节点。

日志里出现下面这行属正常提示，表示仍在使用初始口令，改密后重启即消失：

```
[安全提示] 当前使用初始管理员口令 admin123，仅供本地开发；生产部署请设置 ADMIN_INITIAL_PASSWORD。
```

## 5. 日常更新流程

本地 → GitHub → 服务器，服务器侧一条命令完成：

> ⚠️ git 操作用 **root** 执行（Deploy Key 与 `known_hosts` 在 root 名下）；`npm ci`/`build` 与运行仍用 `celano` 用户。首次更新前需给 root 加安全目录例外：
> `git config --global --add safe.directory /opt/celano-ppt`

```bash
cd /opt/celano-ppt
sudo git pull --ff-only origin main      # root 拉取
sudo -u celano npm ci
sudo -u celano npm run build
sudo systemctl restart celano-ppt
sudo journalctl -u celano-ppt -n 30 --no-pager
```

或直接重跑引导脚本（幂等，会保留既有 `.env` 与密钥）：

```bash
sudo bash scripts/server-bootstrap.sh --repo git@github.com:NereusGlide/celano-ppt.git --branch main --domain ppt.example.com --email ops@example.com
```

发布前请在本地或 PR 阶段跑通 `npm run lint && npm run test:image`，CI 也会在 Ubuntu 与 Windows 两个平台各跑一遍安装与类型检查。

## 6. 数据与备份

`data/` 目录包含全部运行时状态，**升级不会覆盖它**，但它不在 Git 里，需要单独备份：

| 路径 | 内容 | 重要性 |
|---|---|---|
| `data/store.json` | 账号、密码哈希、积分流水、任务、作品索引 | 最高，丢失等于业务数据清零 |
| `data/user-session.key` | 前台会话签名密钥 | 高，丢失会强制全员重新登录 |
| `data/images/`、`data/canvas-assets/` | 生成作品与画布素材 | 高，体积随使用增长 |
| `data/legacy-uploads/` | 参考文件与 Logo 上传 | 中，名称含 legacy 但仍在使用 |
| `data/admin-token.key` | 后台令牌签名密钥 | 中，丢失后台需重新登录 |
| `data/.env` 之外的服务端密钥 | `ADMIN_TOKEN_SECRET` 等 | 已在 `/opt/celano-ppt/.env` |

```bash
# 每日备份示例：保留 14 天
sudo tar czf /var/backups/celano-$(date +%F).tar.gz -C /opt/celano-ppt data .env
sudo find /var/backups -name 'celano-*.tar.gz' -mtime +14 -delete
```

数据库是单文件 JSON 全量落盘，**不支持多实例并发写**；如需水平扩展必须先替换为真正的数据库。

## 7. 故障排查

| 现象 | 排查 |
|---|---|
| `systemctl` 反复重启 | `journalctl -u celano-ppt -n 100 --no-pager`，多为依赖缺失或 `.env` 权限不足 |
| 502 | 应用没起来：`curl 127.0.0.1:3000/`；Nginx 日志 `/var/log/nginx/celano-ppt.error.log` |
| 页面能开但生图失败 | 后台「AI 接口配置」未配置 2K/4K 接口，或上游报错；日志有 `[ppt] 失败页面已退款` 说明已自动退点 |
| PPT 进度不流式 | Nginx 缓冲未关：确认 `proxy_buffering off;` |
| 上传大图 413 | `client_max_body_size` 需大于应用侧的 40MB |
| 智能画布空白 | 产物未生成：`cd /opt/celano-ppt && sudo -u celano npm run build:canvas` || 磁盘写满 | `du -sh /opt/celano-ppt/data/*`；作品图片是主要占用，配置定期清理策略 |
| HTTPS 证书过期 | `sudo certbot renew --dry-run`；系统 crontab 通常已有自动续期 |

## 8. 安全清单

- [ ] 初始管理员口令已修改，`ADMIN_INITIAL_PASSWORD` 仍留在 `.env`（仅影响新部署的首次初始化）
- [ ] 3000 端口未对公网开放，安全组只留 22/80/443
- [ ] SSH 禁用密码登录、仅允许密钥；`PermitRootLogin` 按需收紧
- [ ] 仓库 Deploy Key 为只读；服务器不使用个人 PAT
- [ ] `.env` 权限 600、属主 `celano`
- [ ] `data/` 已纳入每日备份并验证过恢复流程
- [ ] 云厂商安全组 / 主机防火墙定期复核，删除无用的来源 IP 白名单
