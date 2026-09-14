# 系统架构（供下一位 AI）

## 运行拓扑

```text
浏览器 ──HTTPS/公共子路径──> Nginx ──回环──> Fastify/Node
  │                                  ├─ /api/admin  会话 + CSRF
  │                                  ├─ /api/v1     Bearer 调用方 key
  │                                  └─ /health
  │                                           │
  │                                           v
  └─ React/Vite 静态资源                  MariaDB utf8mb4
                                             │
          batch article transaction ──> articles + notifications
                                             │
                              NotificationWorker（DB 锁/租约）
                                             │
                              企业微信固定 webhook（Markdown）
```

应用和 worker 在同一 Node 进程中启动；MariaDB advisory lock 保证同一数据库只有一个 dispatcher。Nginx 和 systemd 模板见 `deploy/`，生产 Node 不直接暴露公网。

## 代码边界

```text
server/app.ts       路由、权限、OpenAPI、文章事务和静态文件兜底
server/db.ts        mysql2 pool、行读取、事务封装
server/config.ts    APP_BASE_PATH、端口、cookie、加密 key、worker 开关
server/security.ts  secret/hash、URL 规范化、AES-GCM、通知 Markdown
server/validation.ts Zod schema（文章、评分、分页、订阅等）
server/worker.ts    取任务、租约、发送、错误分类、退避、恢复
server/index.ts     启动 Fastify/worker、优雅退出
server/cli.ts       migrate 和 admin:create
client/src/         React 页面、管理端 fetch 客户端、样式
migrations/         按序执行且 checksum 固定的 SQL
tests/              单元、真实 MariaDB 集成、运行时和浏览器 smoke
deploy/             ECS 初始化、systemd、Nginx、原子发布/回滚
.github/workflows/  CI 和 main 发布 ECS
```

## 数据关系

- `admins` → `sessions`：管理员会话哈希和过期时间；禁用或改密会撤销会话。
- `topics` → `articles`：热点停用不删除文章；`articles.caller_id` 保留来源调用方。
- `callers` → `articles`：调用方只拥有 Bearer 权限，不能访问管理路由。
- `subscribers` ↔ `topics`：`all_topics=1` 覆盖未来热点，否则由 `subscriber_topics` 指定范围。
- `articles` → `notifications` ← `subscribers`：通知任务唯一约束防止同订阅方重复入队；`notification_attempts` 保留每次投递尝试。
- `schema_migrations` 保存 SQL checksum；当前代码需要 `001_initial.sql` 和 `002_article_heat_score.sql`。

## 关键请求流

1. **管理员**：登录验证 bcrypt 哈希后写入 12 小时会话 cookie；后续请求必须带同源 cookie 和 `X-Requested-With: PulseAdmin`。OpenAPI 页面也受管理员保护。
2. **读取热点**：调用方 Bearer key 经哈希查找启用调用方并更新 `last_used_at`；`GET /api/v1/topics` 只返回启用热点，调用方自行分页和调度。
3. **批量写入**：校验 1–10 条和 `heatScore`；按 topic 顺序锁热点行，再锁 `(topic_id,url_hash)` 已有记录，插入新文章；按本批次新文章评分降序取 3 条，在同一事务为匹配启用订阅方插入通知。重复记录返回原 ID，不覆盖且不通知。
4. **发送通知**：worker 取得数据库 advisory lock，回收过期租约/禁用订阅任务，锁定一条可发送任务并写入 attempt；解密 key 后向固定企业微信地址发送 Markdown，再持久化 `sent/retry/failed`。网络超时接收状态未知，按 1、5、15、60 分钟退避，最多 5 次。

## 必须保持的设计决定

- `APP_BASE_PATH` 必须同时匹配 Vite base、Fastify prefix、cookie path、静态资源和 Nginx；当前线上是 `/davyluiy/fetch-news/`。
- MariaDB 使用 `utf8mb4`，连接层按 UTC 读写；列表分页有上限，调用方请求体上限 1 MiB，调用方接口默认 120 次/分钟。
- 只接受 HTTP/HTTPS URL；去 fragment、规范协议/主机/默认端口但保留路径和查询。唯一性按热点隔离，服务端不抓取链接。
- 文章和通知入队必须同事务；通知不是信息保存的前置条件。批次前三规则只针对新写入，不能因重复提交或修改订阅而补发。
- 企业微信 key 加密存储，只展示后四位；日志和错误只保留脱敏控制字符串。Markdown 上限 4096 UTF-8 字节，单机器人间隔至少 3.1 秒。
- 迁移追加且向后兼容；代码回滚不回滚数据库。当前线上旧版本尚未执行评分迁移，发布 `3ac8890` 前需先按发布脚本完成迁移并验证。
