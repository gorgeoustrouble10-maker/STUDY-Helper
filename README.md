# 知行花园 / STUDY-Helper

仓库包含独立 Android 客户端、原有 Web 工作台及移动端多用户后端。当前开发分支为 `android-app`，已合并 `workspace-ai` 的网页 AI 与手机配对更新。

## 目录与职责

| 目录 | 内容 | 独立运行方式 |
| --- | --- | --- |
| [apps/mobile](apps/mobile/README.md) | Android / Expo Router 客户端、本地 SQLite、离线同步、AI 分析 | `npm run mobile:start`；`npm run mobile:apk` |
| [apps/web](apps/web/README.md) | 原 Next.js 网站、网页 UI、所有者 API、Prisma 与网页 AI | `npm run web:dev`；`npm run web:build` |
| [services/mobile-api](services/mobile-api/README.md) | 多用户注册、Bearer 认证、同步与 AI 分析 API | `npm run server:start` |
| [deploy](deploy/README.md) | Nginx / systemd 配置 | 按部署说明操作 |
| [docs](docs/REPOSITORY.md) | 架构、开发、功能对齐及各版本交付记录 | 文档 |
| artifacts | APK（Git 忽略）及签名/完整性验证结果 | 本机构建输出 |

每个应用维护独立依赖和锁文件。根目录只提供命令入口，不安装或混用两端的 React、TypeScript、SQLite 与构建工具。Web 仍保留其 Next.js 全栈实现；本次目录拆分不等于已统一旧网站与移动端用户数据。

## 本地开发

准备 Node.js 24 后，在根目录运行：

```bash
npm run install:all
npm run db:generate
npm run check
```

只开发 Android 时，仅需 `npm --prefix apps/mobile ci`。移动 API 无第三方运行依赖。两个应用的环境文件分别位于 `apps/web/.env` 和 `services/mobile-api/.env`，参考各自 `.env.example`；私有配置不提交 Git。运行 Node 移动服务时需通过 shell 或服务管理器注入环境变量；环境文件不会自动加载。

首次启动 Web 工作台需在 `apps/web` 按原说明迁移数据库、初始化所有者。相对 `DATA_DIR`、备份和测试路径现在基于 `apps/web`；已有数据库应通过原有绝对路径配置接入，不能当成空目录重新初始化。根目录 `npm run setup` 仍转发网页初始化命令。

## Android 安装包

```bash
npm run mobile:apk
```

按用户要求在本机构建、使用 HTTP，不安装到模拟器。签名保存在 `apps/mobile/.credentials`，后续覆盖升级须沿用该密钥；APK 输出到 `artifacts/study-helper-<version>.apk`。

功能完成情况见 [移动端路线](docs/ANDROID-ROADMAP.md)，本次分支合并、目录迁移和日期修复见 [合并与修复记录](docs/ANDROID-MERGE-0.2.1.md)。网页 AI 的分析/工作模式和确认协议保留在 [AI 指南](docs/AI_GUIDE.md)。
