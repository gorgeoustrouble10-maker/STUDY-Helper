# Android 0.1.0 试用版交付记录

日期：2026-10-21（上海时区）。本报告记录实际实现范围；总体重构规划中未完成的能力不计入本次交付。

## 安装包

- 本地：`artifacts/study-helper-0.1.0.apk`。
- 手机直接下载：`http://121.43.32.47/download/study-helper-0.1.0.apk`。
- SHA-256：同目录 `.apk.sha256` 文件，始终以该文件对应的最终 APK 为准。
- 应用名称：知行花园；包名 `cn.studyhelper.garden`，versionName `0.1.0`，versionCode `1`。
- CPU：arm64-v8a；最低 Android 7.0 / API 24，target SDK 36，compile SDK 37。
- 本机 release 构建，包含 Hermes JavaScript 运行代码，不依赖 Expo Go、Metro 或开发电脑在线。
- APK Signature Scheme v2 校验通过；签名密钥在 `apps/mobile/.credentials`，未提交 Git。
- 最终文件大小 39,399,879 字节，SHA-256：`6965f7d9f44c1890af871de20b55a4dca1c926883048ba961e1aa694ff5cbad1`。静态检查结果保存在 `artifacts/apk-verification.json`；额外移除了悬浮窗与外部存储权限。

## 已实现

- 注册填写邀请码，服务端校验；缺失或错误时不创建用户。客户端未内置正确邀请码。
- 登录、设备令牌刷新轮换和退出；凭据保存于 Android SecureStore。
- 今日概览、行动、课程/项目/领域、笔记/资源及更多业务记录的通用编辑。
- 标题、正文、标签、关联、类型专用字段；支持基础 Markdown 阅读。
- 草稿持久保存、按账号隔离的 SQLite、本地即时保存及待同步状态。
- 持久化提交队列、幂等重试、增量拉取、删除标记、版本冲突比较与选择。
- 归档、回收站、重复行动唯一后继及月末锚点、父行动循环检查。
- 设备字体偏好、同步中心和可理解的失败提示。

## 服务端实际状态

按用户要求使用 HTTP：`http://121.43.32.47/api/mobile/v1`。Android 网络配置仅对这个 IP 放行 HTTP。

新增独立的 Node.js 24 服务 `study-helper-mobile.service`，监听 `127.0.0.1:13301`，Nginx 在 80 端口代理移动 API。业务数据保存在 `/var/lib/study-helper-mobile/mobile.db`，启用 SQLite WAL；试用服务尚未迁移 PostgreSQL。旧 `personal-garden.service` 继续运行，代码及业务数据库未被覆盖。

新服务的账号与数据独立于旧网站。首次安装需要在 App 注册账号，旧网站所有者账号和历史记录尚未迁入；不能使用服务器 SSH root 身份登录 App。

服务端源码在 `services/mobile-api`，部署配置在 `deploy/mobile`。本地与云端源码 SHA-256 已核对一致。测试创建的临时账号及其测试记录已清理。

## 已验证

| 检查 | 结果 |
| --- | --- |
| 客户端 TypeScript 检查 | 通过 |
| 客户端 ESLint | 通过 |
| 本地仓储测试 | 4/4 通过：队列持久性、发送中继续编辑、冲突与游标、草稿及旧版本隔离 |
| 移动 API 测试 | 5/5 通过：邀请码、认证轮换、用户隔离、幂等冲突、限速、重复行动与循环检查 |
| 公网 HTTP 邀请码注册 | 错误码 403，正确码注册 201，登录身份查询 200 |
| 公网 HTTP 同步 | 登录、提交、幂等重试、拉取及注销通过 |
| Android release 构建 | 已成功生成 APK |
| APK 完整性、签名与包信息 | ZIP 校验、v2 签名校验、包名/ABI/SDK 与 bundle 检查通过 |
| 模拟器安装与界面操作 | 按用户要求未执行 |
| 真实手机安装与操作 | 未执行，等待用户安装反馈 |

依赖审计仍报告 26 项告警（7 moderate、19 high，涉及 braces、node-forge、uuid 等工具链依赖及传播链）；未使用 npm audit 的跨大版本降级建议，也不将依赖审计记为零告警。构建期间保留了第三方依赖的弃用提示。

## 未完成范围

本次是首个可安装试用版，不是总体重构已全部完成。附件上传、复杂 Markdown 公式/表格、复盘专用快照操作、公开发布、专用财务统计、AI 能力、旧网站数据迁移及跨网页端同步尚未提供。通用业务记录表单不等于这些完整专用流程。

后台不保证常驻；App 启动、回到前台、前台定时及手动操作触发同步。离线修改保存在手机，卸载前应先同步。会话失效时保留本地记录，需重新认证后继续提交。

## 本机依赖与重新构建

Node.js 24、JDK 21、Android Platform 37.0、Build Tools 37.0.0、NDK 27.1.12297006、CMake 3.22.1。Gradle 根据模块要求另行准备了 JDK 17 编译工具链。Expo 58 / React Native 0.88 / React 19.3.0 / TypeScript 6 的依赖锁文件位于 `apps/mobile/package-lock.json`。

```bash
npm --prefix apps/mobile ci
npm run mobile:apk
```

构建脚本支持已有原生工程时传入 `--skip-prebuild` 复用中间产物；修改 app.json 或原生 config plugin 后需重新 prebuild。后续覆盖升级必须沿用当前签名并按发布策略递增 versionCode。详细步骤见 [移动端 README](../apps/mobile/README.md)。
