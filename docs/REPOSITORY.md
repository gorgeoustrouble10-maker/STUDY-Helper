# 客户端、网页端与服务端文件管理

2026-10-21，工作分支 `android-app`。本地原有 Android / 移动 API 改动先提交为 `981cbc0`，再合并远程 `workspace-ai` 的 `2176e65`，合并提交 `f708ad8`。`main` 和远程 `workspace-ai` 的历史未重写。

## 运行边界

```text
STUDY-Helper/
  apps/
    mobile/              Android 客户端，独立依赖与锁文件
    web/                 Next.js 原网页应用及所有者 API
      src/               网页界面、服务端业务及 AI 工具
      prisma/            网页数据库模型、迁移
      scripts/           网页初始化、备份、模拟模型及旧手机配对验证
      tests/             网页业务、AI、旧手机配对和浏览器测试
  services/
    mobile-api/          多用户移动后端及其测试，Node.js 24 内置模块
  deploy/mobile/         Nginx / systemd 配置
  docs/                  跨应用文档及交付报告
  artifacts/             APK（忽略 Git）与验证元数据
  package.json           命令转发；不存放应用依赖
  compose.yml            原网页应用 Docker 入口
```

不使用共享 node_modules 或根依赖提升，避免 Expo / Next.js 工具链互相影响。各应用的 package.json、package-lock.json、TypeScript 配置和环境文件都在自己的目录中；移动 API 也有独立启动和测试命令。

本轮拆分的是工程与部署边界。Web 保留 Next.js 全栈，尚未把网页后端改造为多用户移动 API，也没有自动迁移旧网站私人数据。`/api/mobile/...` 是旧网页的所有者配对协议，`/api/mobile/v1/...` 是 Android 的多用户协议，两者继续保留且不可混用。

## 常用命令（仓库根目录）

| 命令 | 范围 |
| --- | --- |
| `npm run install:all` | 分别安装 Web 和 Android 依赖 |
| `npm run db:generate` | 仅生成 Web Prisma 客户端 |
| `npm run web:dev` / `web:build` | 原网页开发 / 生产构建 |
| `npm run mobile:start` / `mobile:apk` | Android 开发 / 本机签名构建 |
| `npm run server:start` | 多用户移动 API |
| `npm run check` | 两端类型检查、移动端 Lint、全部单元/集成测试 |
| `npm run test:e2e` | 原网页浏览器测试，仍需独立测试实例 |
| `npm run mobile:prepare` / `verify:mobile` | 原网页手机配对数据库准备 / HTTP 验证，非 APK 构建 |

## 路径迁移

原根目录 `src`、`prisma`、`scripts`、`tests`、Next.js 配置和应用依赖移至 `apps/web`，内部相对导入保持不变。Next.js 的 Turbopack 和 standalone tracing 显式限定在 `apps/web`，不会扫描 Android 的包或签名目录。Compose 的构建上下文对应改为 `./apps/web`，已有数据卷名称保留。

旧 Web 的相对 `DATA_DIR`、`backups`、`.test-data` 基于 `apps/web`；已有运行目录不得直接当成新数据目录初始化，部署时继续指定原有绝对数据路径。Android 本地数据库、包名、签名目录、API 地址及服务器的 `/var/lib/study-helper-mobile` 不变。

历史文档记录的是当时结构；按其中原网页命令操作时应进入 `apps/web`。最新入口以根 README 和本文件为准。

## Git 管理

- 业务源码、迁移、测试、配置模板与锁文件提交 Git。
- `.env`、数据库/WAL、node_modules、构建目录、APK、签名和本机工具配置忽略 Git。
- 移除未被 Expo Router 使用的空白模板入口 `App.tsx` 与 `index.ts`；实际入口仍为 `expo-router/entry`。
- 新分支保留合并父提交，可用 Git 历史追溯来自网页和 Android 的改动，避免复制远程文件后失去合并记录。
