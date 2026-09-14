# 项目上下文（供下一位 AI）

## 目标与当前状态

Pulse 是中文热点追踪管理后台：管理员配置追踪热点，外部调用方按备注采集并提交信息，后台提供检索和企业微信订阅通知。采集来源、定时调度和 AI 总结由调用方负责，后台不抓取原文链接。

本轮开发已完成并通过本地与 CI 验证。功能提交 `3ac88903` 已推送到 `main` 并于 2026-09-14 发布到 ECS；上下文文档提交为 `9031dff`。当前线上已执行 `002_article_heat_score.sql`，具备 `heat_score` 和批量接口；生产数据库仍不得用于本地测试。

线上交接事实：公网地址为 `https://8.130.116.192/davyluiy/fetch-news/`，Nginx 终止 HTTPS，Node/systemd 仅监听 `127.0.0.1:3107`，候选端口为 `3108`；项目目录 `/srv/fetch-news`，服务 `fetch-news.service`，数据库 `fetch_news`。当前运行功能提交 `3ac88903`，上一正常版本为 `eae80c2`。用户明确选择不配置数据库备份，生产未录入真实热点、调用方或企业微信 key。

## 技术栈

- Node.js 22+、TypeScript、Fastify 5、mysql2、MariaDB 10.11+（`utf8mb4`）。
- React 19、Vite 7、Ant Design 5；服务端用 tsup 构建，浏览器验收用 Playwright。
- Zod 输入校验、bcryptjs 密码哈希、HttpOnly cookie 会话、AES-GCM 加密企业微信 key；不依赖 Docker、Redis 或外部队列。

## 已完成模块

- 管理员：命令行初始化首个账号；登录、退出、12 小时服务端会话、CSRF、防登录限流；创建、禁用、重置密码，最后一个有效管理员不可禁用。
- 热点：名称去首尾空格且唯一；备注、启停、搜索、分页；停用保留历史且拒绝新增。
- 调用方：随机 API key 创建/重置/禁用，数据库只存摘要，完整 key 只在创建或重置响应展示；`GET /api/v1/topics` 仅返回启用热点。
- 信息写入：单条兼容接口和 `POST /api/v1/articles/batch`；每批 1–10 条，`heatScore` 必填且为 0–100、最多两位小数；按热点和规范化 HTTP(S) URL 去重，并发安全。
- 通知：新信息与匹配订阅任务同事务入队；只为本批次新写入且评分最高的 3 条创建任务，重复提交不通知；worker 持久化队列、租约恢复、单 worker 锁、机器人限速、有限重试和永久失败分类。
- 管理界面：概览、热点、信息搜索/日期筛选/详情、调用方、订阅方、通知尝试记录/手动重试、管理员管理；信息列表和详情展示 AI 热度评分。
- 交付材料：OpenAPI、API curl 示例、调用方 AI 指南、运维说明、验证记录、Nginx/systemd/CI/CD 发布模板和已完成 ECS 交接记录。

## 目录速览

```text
server/app.ts              Fastify 路由、认证、OpenAPI、事务写入
server/validation.ts       Zod 输入与分页规则
server/security.ts         哈希、AES-GCM、URL/Markdown 安全处理
server/worker.ts           企业微信通知队列 worker
server/index.ts            生产启动与优雅退出
server/cli.ts               migrate/admin CLI
client/src/main.tsx         React 管理后台页面
client/src/api.ts           管理端 API 客户端、上海时区格式化
migrations/001_initial.sql  核心表
migrations/002_article_heat_score.sql  评分字段和索引
tests/                      单元、MariaDB 集成、运行时和浏览器验收
deploy/                     systemd、Nginx、ECS 初始化与原子发布脚本
.github/workflows/          CI 与 ECS 发布 workflow
docs/                       API、调用方、运维、部署、验证及本上下文
```

## 运行、测试、构建

先准备 MariaDB、独立数据库和 `.env`（`ENCRYPTION_KEY` 必须是稳定的 Base64 32 字节密钥）：

```bash
nvm use
npm ci
npm run db:migrate
ADMIN_PASSWORD_FILE=/absolute/path/to/protected-password.txt npm run admin:create -- admin
npm run dev
```

提交前至少运行：

```bash
npm run typecheck
npm test                         # 5 项单元测试
DB_NAME=fetch_news_test npm run test:integration  # 15 项；只连接 *_test 库
DB_NAME=fetch_news_test npm run test:runtime
npm run build
# 已构建且有 Chrome/Playwright 时：DB_NAME=fetch_news_test npm run test:browser
```

生产启动为 `NODE_ENV=production npm start`；迁移必须先完成。CI 在 Node 22 + MariaDB 10.11 上执行构建、单元、集成、运行时和浏览器测试。

## 不可忽略的契约

- 数据库时间以 UTC 保存，管理界面按 `Asia/Shanghai` 展示；`date` 是真实日历日期，不是抓取时间。
- URL 去除 fragment、规范协议/主机/默认端口、保留路径和查询；唯一键是 `(topic_id, url_hash)`。重复返回已有 ID，不覆盖、不再通知；不同热点可复用 URL。
- 调用方必须先分页同步启用热点，遵守备注；每周期只回传候选中热度最高的 10 条。超过 3 天不收集，超过 1 天降低评分。
- 通知前三只在同一批次的新写入中排序，评分相同按请求顺序；通知失败不回滚信息保存。
- 生产环境凭据只存在 `/etc/fetch-news.env` 和受保护的初始密码文件中；不要在上下文、日志或测试输出中显示其内容。

继续开发前先看 [ARCHITECTURE.md](./ARCHITECTURE.md)、[TODO.md](./TODO.md)、[API.md](./API.md)、[caller-ai-guide.md](./caller-ai-guide.md)、[OPERATIONS.md](./OPERATIONS.md) 和 [DEPLOYMENT.md](./DEPLOYMENT.md)。
