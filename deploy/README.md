# 部署入口

- `mobile/nginx.conf`：HTTP 入口；`/api/mobile/v1/` 代理多用户移动 API，`/` 代理原 Web 工作台，`/download/` 提供 APK。
- `mobile/study-helper-mobile.service`：Node.js 24 多用户移动 API，服务器源码目录 `/opt/study-helper-mobile`，数据目录 `/var/lib/study-helper-mobile`。本轮整理仓库不会移动服务器现有数据。
- 根目录 `compose.yml`：原 Web 工作台，构建上下文已改为 `apps/web`，继续使用现有 `garden-data` 卷。

仓库源码发布对应关系：`services/mobile-api/{server,ai}.mjs` → 移动 API 服务目录；`apps/web` → 网页应用发布目录。不要将 Android 工程、签名文件或本机依赖上传到后端运行目录。

原网页服务若从本仓库构建，应在 `apps/web` 安装依赖、生成 Prisma 并构建。Next.js standalone 相对目录保持以该应用为根；原先已部署的发布目录不受本次本地移动影响。
