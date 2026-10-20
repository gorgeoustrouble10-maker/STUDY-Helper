# 知行花园 Android

独立的 React Native / Expo Android 客户端。正式 APK 内含运行代码，不需要 Expo Go、Metro 或开发电脑在线。

## 开发

需要 Node.js 24。此工程维护独立 package-lock.json，不需要先安装根目录网站依赖。

```bash
cd apps/mobile
npm ci
npm start
```

```bash
npm run typecheck
npm run lint
node --test tests/repository.test.mjs
```

## 本机构建 APK

准备 JDK 21、Android SDK Platform 37.0、Build Tools 37.0.0、NDK 27.1.12297006、CMake 3.22.1（Gradle 也会按需准备 JDK 17 编译工具链）。设置 JAVA_HOME 和 ANDROID_HOME，或沿用构建脚本中的本机默认路径。

```bash
npm run android:release
```

脚本读取 app.json 版本，生成 Android 工程并构建签名 release APK，当前输出到项目根目录 `artifacts/study-helper-0.2.0.apk`，同时生成 SHA-256 校验文件。当前仅构建 arm64-v8a，最低 Android 7.0（API 24），适用于支持该 ABI 的安卓设备。

首次构建生成 `.credentials/upload.jks` 与 `.credentials/store-password`，该目录已忽略 Git。请安全备份这两个文件；后续覆盖升级必须沿用同一签名。构建脚本通过环境变量传递口令，口令不写入 Gradle 源码。

## 云端连接

按用户要求使用 `http://121.43.32.47/api/mobile/v1`，Android 明文访问配置仅放行此 IP。服务端源码位于 `services/mobile-api`，与服务器上旧 `personal-garden` 网站运行在独立进程和数据库中。

邀请码由服务端注册接口校验，客户端不包含正确邀请码。已有旧网站所有者账号与数据尚未迁入移动端用户库，需在 App 新建账号。账号凭据保存于 SecureStore，业务数据按用户保存在 SQLite。

## 当前实现范围

- 邀请码注册、登录、令牌刷新与退出。
- 今日、行动、课程/项目/领域、笔记/资源、更多业务类型的通用记录表单。
- 标签、记录关联、Markdown 基础阅读、编辑草稿、归档与回收站。
- 本地即时保存、持久化待同步操作、增量拉取、冲突比较与选择。
- 设备字体偏好、同步状态与错误提示。
- AI 分析页面、云端多轮会话、参考记录查询、停止与恢复、离线历史缓存、回复转笔记草稿。服务器需配置真实模型后启用，密钥不进入客户端。

当前仍是逐步完善的试用版本。复杂 Markdown 公式/表格渲染、附件上传、复盘专用快照操作、公开发布、专用财务页面、AI 工作模式和旧网站数据迁移尚未提供；通用记录表单不等于这些完整专用流程。AI 分析采用异步任务轮询，尚无流式逐字展示；当前服务器的真实 DeepSeek 调用已验证。

## 代码入口

- `src/app/`：Expo Router 路由。
- `src/context.tsx`：登录状态、仓储生命周期与同步调度。
- `src/repository.ts`：可测试的本地 SQL、待提交操作及冲突处理。
- `src/data.ts`：Expo SQLite/UUID 接入。
- `src/api.ts`：HTTP 协议、同步提交与拉取。
- `src/app/ai.tsx`、`src/ai-types.ts`：AI 会话页面与接口类型；服务端实现见 `services/mobile-api/ai.mjs`。
- `plugins/`：可重建的 Android 网络及签名配置，避免手工修改生成目录。

测试报告和实际构建结果见根目录 `docs/ANDROID-DELIVERY-0.2.md`，后续完整功能见 `docs/ANDROID-ROADMAP.md`。`docs/ANDROID-DELIVERY.md` 保留 0.1.0 历史交付记录。
