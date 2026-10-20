# 移动端试用 API

Node.js 24 自带 HTTP、SQLite 与 crypto 实现的独立服务，无第三方运行依赖。使用单独数据库与进程，保留服务器上的旧 Next.js 网站。当前为移动试用服务，并非旧网站已经完成 PostgreSQL / 多用户迁移。

```bash
node --test services/mobile-api/*.test.mjs
```

启动前在服务端设置 `REGISTRATION_INVITE_CODE`；缺失时关闭注册。可设置 `PORT`（默认 13301）和 `MOBILE_DATA_DIR`（默认 `.data/mobile-api`）。仅监听 127.0.0.1，部署时通过 Nginx 提供 `/api/mobile/v1`。

协议：

- `POST /auth/register`：username、password、inviteCode；服务端校验邀请码。
- `POST /auth/login`：username、password。
- `POST /auth/refresh`：refreshToken；刷新时轮换并撤销旧令牌。
- `POST /auth/logout`、`GET /me`：Bearer accessToken。
- `GET /sync/pull?cursor=0`：按用户过滤的分页变更及删除标记。
- `POST /sync/push`：operations 数组，每项包含 operationId、baseVersion、record；逐条返回确认、冲突或错误。

密码使用随机盐 scrypt，令牌只保存哈希。记录、幂等操作、变更日志、编辑历史与会话按用户隔离。注册、登录、刷新及同步包含限速。重复行动由服务端生成唯一后继，父行动检查循环。

数据在 `mobile.db`，启用 WAL。完整备份应使用 SQLite 在线备份接口或在服务停止后一起处理数据库与 WAL 文件，不能仅复制运行中的主数据库文件。该数据库含多用户资料，管理员备份不能作为普通用户下载接口。

部署文件见 `deploy/mobile`。服务器实际为 Ubuntu 24.04.5，通过 systemd 运行 `study-helper-mobile.service`，数据位于 `/var/lib/study-helper-mobile`。按用户最新要求，当前使用 HTTP。

## AI 分析 API（0.2.0）

`ai.mjs` 使用 Node 内置 fetch 调用 DeepSeek / OpenAI-compatible / Ollama 的 Chat Completions 接口，无新增 npm 运行依赖。配置见 [.env.example](.env.example)。未启用或配置缺失时返回明确的禁用状态，不生成模拟回复。提供商密钥仅保存在服务器私有环境文件。

- `GET /ai/status`：启用状态、提供商、模型、分析模式，不返回密钥或内部 API 地址。
- `GET /ai/conversations`：当前用户最近 50 个会话；`POST` 同地址用 `{title}` 创建，每用户最多 200 个。
- `GET /ai/conversations/:id`：最近 100 条消息及在途任务。
- `POST /ai/conversations/:id/turns`：`{requestId,message,contextRecordIds}`，返回 202 任务；相同内容和请求 ID 重试返回同一任务，相同 ID 不同内容返回 409。
- `GET /ai/turns/:id`：轮询 `running/completed/failed/cancelled`；完整回复从会话接口读取。
- `POST /ai/turns/:id/cancel`：停止生成，迟到回复不保存。

以上接口均需 Bearer token，并在服务端按用户过滤。问题最多 4000 字、参考记录最多 3 条；每用户每 15 分钟最多 30 次、一个在途任务、全局最多两个。每次最多五轮模型请求及十二次只读工具调用、90 秒总超时。单次输出上限 2048 token，提供商响应最多 512KB。数据库新增 `ai_conversations/ai_turns/ai_messages` 表，历史属于云端业务数据，本机保存按账号隔离的缓存。服务重启保留历史并标记中断任务失败。

当前只读工具为搜索记录、读取正文、今日行动与本月整数分收支汇总。不会查询旧网页数据库或跨账号资料，也不支持业务写入。客户端的“另存为笔记”经过编辑器确认，走原业务保存与同步流程。
