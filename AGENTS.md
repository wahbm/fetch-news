# AI 接手规则

这是 Pulse 热点追踪管理后台仓库。开始任何开发前，先检查 `git status --short --branch`，阅读 `docs/PROJECT_CONTEXT.md`、`docs/ARCHITECTURE.md`、`docs/TODO.md`、`docs/DEPLOYMENT.md`，确认当前代码提交和生产提交是否一致。

## 工作约束

- 使用 Node.js 22（项目提供 `.nvmrc`）。依赖安装用 `npm ci`；常用检查是 `npm run typecheck`、`npm test`、隔离 `*_test` 库上的 `npm run test:integration`，交付构建用 `npm run build`。
- 集成、运行时和浏览器测试会清空测试库；绝不能让 `.env` 或命令行指向生产数据库。不要执行 `DROP`、`git reset --hard`、删除发布目录等破坏性操作，除非用户明确要求并已确认影响。
- 不要输出、提交或写入日志：`.env`、`/etc/fetch-news.env` 内容、初始管理员密码、调用方 API key、企业微信机器人 key、SSH 私钥。文档只记录受保护文件路径和脱敏后缀。
- 数据库迁移是追加且 checksum 校验的；已应用的 SQL 不要修改。结构变更必须新增迁移，并补充集成测试和运维说明。
- 保持 `APP_BASE_PATH` 同时作用于 Vite、前端路由、API 和 Nginx。调用方接口必须使用 `Authorization: Bearer <key>`；管理员接口使用 HttpOnly 会话和 `X-Requested-With: PulseAdmin`。
- 不要随意改变热点与规范化 URL 的唯一约束、事务内通知入队、批量最多 10 条、`heatScore` 0–100（最多两位小数）、本批次新写入评分前三通知等契约；若必须改变，连同 API 文档、调用方指南和测试一起更新。
- 通知 worker 的数据库租约、单 worker advisory lock、每机器人 3.1 秒间隔、1/5/15/60 分钟退避和最多 5 次尝试是低资源部署的关键假设。
- 功能提交 `3ac8890` 已推送并发布到生产；当前发布保留 `eae80c2` 作为上一正常版本。未来发布仍需明确用户指令，并按 `docs/DEPLOYMENT.md` 执行迁移、预检、原子切换和健康检查。
- 用户已选择不配置数据库备份；不要擅自加入定时备份或改变部署边界。gh 凭据失效时先确认运行环境，必要时在授权范围内提升权限重试。

修改代码时保持差异小而可审查，优先使用补丁编辑；行为变化后同步更新 `docs/PROJECT_CONTEXT.md`、`docs/ARCHITECTURE.md` 或 `docs/TODO.md`。
