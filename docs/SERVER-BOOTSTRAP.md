# ECS 首次连接与部署准备

已知环境：`121.43.32.47`，阿里云 ECS e 实例，2 核 / 2 GB，无域名。用户原报 Ubuntu 22.04，2026-10-21 SSH 实测为 Ubuntu 24.04.5 LTS；已成功使用用户授权的 root 密码登录并完成只读检查。当前已有应用部署，见 [SERVER-INSPECTION.md](./SERVER-INSPECTION.md)。下文保留为首次连接和后续配置密钥的参考，不表示已执行这些配置步骤。

## 1. 先使用控制台登录

在阿里云 ECS 控制台选择对应实例，点击“远程连接”，使用 Workbench 登录。具体认证及安全组提示以控制台为准；不需要先在 Mac 配置 SSH。

登录后确认实际账号、系统及资源，避免假设 Ubuntu 镜像的默认登录名：

```bash
whoami
uname -m
cat /etc/os-release
free -h
df -h /
sudo ss -lntp
```

这些信息用于确定 SSH 用户名、容器构建架构、磁盘余量与端口占用，不包含登录密码或私钥。

## 2. 在 Mac 上生成专用 SSH 密钥

先查看目标文件是否已存在：

```bash
ls -l ~/.ssh/study-helper_ed25519 ~/.ssh/study-helper_ed25519.pub
```

若不存在再生成；若已存在应复用或选其他文件名，不要覆盖。以下命令在 Mac 终端执行，按提示设置密钥口令：

```bash
ssh-keygen -t ed25519 -f ~/.ssh/study-helper_ed25519 -C study-helper-deploy
cat ~/.ssh/study-helper_ed25519.pub
```

只把以 `ssh-ed25519` 开头的 `.pub` 公钥复制到服务器。没有 `.pub` 后缀的文件是私钥，留在本机。

## 3. 将公钥写入服务器当前账号

以下操作在 Workbench 的服务器终端执行。先确认当前账号是希望用于后续连接的账号，并保留 Workbench 会话。

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
nano ~/.ssh/authorized_keys
```

在文件末尾新增一整行刚才复制的公钥，保留已有内容，保存退出。若当前账号是 root，建议后续建立独立的部署账号，再为该账号配置公钥；应用容器不以 root 身份运行业务进程。

## 4. 配置安全组并测试本机连接

在阿里云控制台设置 TCP 22 入方向仅允许当前可信公网 IP（单个 IPv4 地址使用 `/32`），同时保留 Workbench 正常工作所需的访问配置。首次连接先不修改 SSH 服务配置，不关闭尚未验证的登录方式。

在 Mac 执行以下命令，把 `实际用户名` 替换为第 1 步确认的账号：

```bash
ssh -i ~/.ssh/study-helper_ed25519 实际用户名@121.43.32.47
```

首次连接前，可在 Workbench 查看服务器 Ed25519 主机公钥指纹，并与本机 SSH 提示核对：

```bash
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

成功后执行 `whoami` 确认登录身份，再进行部署。若出现 Permission denied，检查用户名、公钥位置和权限；若超时，检查安全组、服务器防火墙和 SSH 监听。不要通过关闭全部防火墙来排查。

## 5. 后续部署边界

- 网站与 API：公网 TCP 443；TCP 80 用于 ACME HTTP 验证及跳转。服务器防火墙需与安全组一致。
- Next.js 3000、PostgreSQL 5432：只在本机或容器内部网络使用。
- 应用构建：在本机或 CI 构建与服务器 CPU 架构匹配的 Linux 镜像。不能把 macOS 的 node_modules 复制到 Ubuntu，SQLite 等原生依赖不通用。
- 首期仅部署反向代理、单个应用实例和 PostgreSQL，记录实际资源占用后评估容量。
- 尚未具备多用户隔离的当前版本不作为开放注册服务对外运行。

## 6. 无域名 HTTPS

计划使用 `https://121.43.32.47` 和受信任的 IP 证书。根据 Let's Encrypt 当前官方说明，IP 证书有效期 160 小时，应自动续期、部署证书并重新加载代理，监控续期失败。

Certbot 官方教程要求支持 IP 和 shortlived profile 的版本；其中 webroot 示例要求 5.4 或更新版本。不要假设 Ubuntu 22.04 系统仓库自带的旧版满足要求。具体安装方式和版本在部署时核实。

先使用 ACME staging 验证申请及续期链路，再申请生产证书；staging 证书不被正式 App 信任。服务器证书申请成功后，验证 HTTPS、证书续期和真机 API 访问，再将其写入 APK 配置。

参考：[Workbench 登录](https://help.aliyun.com/zh/ecs/user-guide/connect-to-a-linux-instance-by-using-a-password-or-key)、[安全组配置](https://help.aliyun.com/zh/ecs/user-guide/start-using-security-groups)、[IP 证书](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability)、[Certbot 支持](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)。
