# 服务器只读检查记录

记录日期：2026-10-21（上海时区）。使用用户授权的 root 凭据通过 SSH 连接；凭据未写入项目文件。

## 实测结果

| 项目 | 结果 |
| --- | --- |
| 地址 | 121.43.32.47 |
| 连接 | root 密码 SSH 登录成功 |
| 系统 | Ubuntu 24.04.5 LTS，x86_64 |
| 内存 | 总计约 1.7 GiB，检查时 available 约 1.0 GiB |
| swap | 已有约 1 GiB |
| 系统盘 | 40 GB，剩余约 31 GB |
| 既有服务 | personal-garden.service、宝塔面板及云厂商代理等 |
| 应用监听 | 127.0.0.1:13300 |
| 本机健康检查 | HEAD http://127.0.0.1:13300/ 返回 HTTP 200 |
| Node.js | /opt/personal-garden/runtime/node-v24.19.0-linux-x64/bin/node |
| 当前应用目录 | /opt/personal-garden/releases/20261019T042846Z/.next/standalone |
| 应用包 | personal-garden 1.0.0 |
| 防火墙 | UFW active；已有 22、80、443、宝塔/FTP 等规则 |

上述 HTTP 检查只证明服务器本机应用可响应，不代表公网 Web 访问、HTTPS 或 Android 连接已验证。CPU 核数及 ECS 型号沿用用户提供信息，尚未独立核实；内存占用是检查时的瞬时值。

## 与本地代码的差异

云端 package.json 包含 `@ai-sdk/deepseek`、`@ai-sdk/openai-compatible`、`@ai-sdk/react` 和 `ai`，当前本地 package.json 不含这些依赖。本地 Git 当前提交描述也是 AI 集成前的快照，因此不能将两端当作相同版本部署。

后续重构需先定位云端对应源代码或版本，比较差异，备份数据库、附件和部署配置，再制定增量升级及回滚步骤。当前只检查了运行目录和依赖清单，未下载云端完整源码或数据，尚不能确定具体功能差异。

## 本次操作范围

执行了系统、内存、磁盘、监听端口、进程目录、依赖清单、systemd 服务列表、HTTP 响应及 UFW 状态读取。本机 SSH 首次连接时记录了服务器主机公钥。未安装软件，未修改远端配置，未停止或重启服务，未改动远端代码或业务数据。
