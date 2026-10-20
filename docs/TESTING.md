# 浏览器测试

先运行 `npm run setup` 与 `npm test`。浏览器测试在独立目录中进行，避免影响个人数据。

```powershell
$env:DATA_DIR='.test-data/e2e'
$env:SITE_URL='http://127.0.0.1:3001'
npm run db:migrate
npm run db:seed
$env:INIT_OWNER_USERNAME='qa-owner'
$env:INIT_OWNER_PASSWORD='qa-only-password-2026'
npm run owner:init
Remove-Item Env:INIT_OWNER_PASSWORD
npm run build
npx next start -p 3001
```

`SITE_URL` 必须与测试实例的实际访问地址完全一致（来源校验做精确匹配），缺失或不一致时登录返回 403「请求来源不正确」。若项目根目录存在 `.env`，其中被 shell 环境变量覆盖的项以 shell 为准。

另一个终端运行 `npm run test:e2e`。默认测试账号仅用于上述隔离目录，生产账号仍通过交互命令初始化。可用 `TEST_USERNAME`、`TEST_PASSWORD`、`TEST_BASE_URL`调整测试配置。

**必须用生产服务器跑 E2E，不要用 dev 模式。** dev 模式的 HMR WebSocket 在 Windows 下返回 `ERR_INVALID_HTTP_RESPONSE`，导致页面二次加载、React hydration 失败、登录表单退化为原生 GET 提交（密码出现在 URL 中），全部用例会失败。生产构建+`next start` 无此问题。

**浏览器二进制：** Playwright 自带的 Chromium 在当前网络环境下下载失败（npmmirror 镜像 404、官方源超时）。`playwright.config.ts` 已配置 `channel: 'chrome'`，直接使用本机安装的 Chrome（需 Chrome 100+）。若本机没有 Chrome，先安装后运行；`npx playwright install chromium` 仅在官方源可访问时可用。

## AI 助手用例（可选）

AI 用例依赖本地模拟模型（`scripts/mock-llm.mjs`，绝不访问真实供应商）。先在另一个终端启动 mock LLM（固定端口 4510）：

```powershell
node scripts/mock-llm.mjs 4510
```

并在启动测试实例的同一个 shell 中追加 AI 环境变量（与上面的 `$env:` 设置方式相同）：

```powershell
$env:AI_ENABLED='true'
$env:AI_PROVIDER='openai-compatible'
$env:AI_MODEL='mock-model'
$env:AI_BASE_URL='http://127.0.0.1:4510/v1'
$env:AI_API_KEY='mock-key'
npx next start -p 3001
```

未提供这些变量时 AI 用例会因面板未启用而失败，其余用例不受影响。mock 通过消息首行 `[scenario:…]` 指令切换场景（创建、提议、多工具、思考流、流中断、坏响应、坏工具参数等），场景定义见 `scripts/mock-llm.mjs`。

桌面与 Pixel 7 宽度分别验证课程实验、博客项目记录与复盘、资源整理推荐和访问隔离。测试为单 worker 串行执行，桌面与手机两个项目共用同一隔离数据库，运行后生成 HTML 报告（`playwright-report/`）与失败 trace（`test-results/`）。
