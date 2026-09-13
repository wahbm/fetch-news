# 阿里云 ECS 部署准备与交接

本期没有创建 GitHub 仓库、修改 ECS 或发布。以下文件是待审核填参的模板，不代表部署完成。使用共享原生 MariaDB、宿主机 Nginx 和 systemd，不默认安装 Docker、Redis 或新的数据库引擎。

## 发布前确认

1. 目标仓库必须属于 `wahbm`。核实 owner、可见性、默认分支及权限。Free 组织级共享配置按 public 仓库契约使用；任何公开、迁移仓库操作都必须由用户明确决定。
2. `gh api user --jq .login` 确定 GitHub 登录名，默认路径为 `/<github-login>/fetch-news/`，不固定使用某个前缀。检查路由、服务、端口、目录、数据库名是否冲突。
3. 组织 Variables：`DEPLOY_HOST`、`DEPLOY_PORT`、`DEPLOY_USER`、`DEPLOY_KNOWN_HOSTS`；组织 Secret：`SSH_PRIVATE_KEY`。为新仓库授予该 Secret 的 Selected repositories 权限前必须获得用户批准，不复制组织密钥到仓库 Secret。
4. 仓库 Variables：`DEPLOY_PATH`（如 `/srv/fetch-news`）、`APP_BASE_PATH`、`SERVICE_NAME`（如 `fetch-news`）、`APP_PORT` 和 `CANDIDATE_PORT`。示例端口 3107/3108 仅是占位，实际选择前检查占用。
5. 确认 ECS 的 OS、Node 22 路径、MariaDB/Nginx、RAM、swap、磁盘、SSH sudo 权限以及 HTTPS。先决定备份方案，不默认调度备份。

若 gh 凭据错误，先检查运行环境；可在授权范围内提升权限重试。组织写权限故障需核实 CLI scope/SSO，不能把 CLI 认证错误等同于用户无权限。

## 服务器初始化（由有权限的运维执行）

- 项目运行账号使用专用 `fetch-news` 非 root 用户。部署账号可写项目 releases，并仅可 `sudo systemctl restart/stop fetch-news.service`。不得授权宽泛免密 sudo。
- 创建项目根 `/srv/fetch-news`、`incoming/`、`releases/`，确认无碰撞后创建 `.pulse-deployment` 标识。不要在已有业务目录创建标识。
- 部署账号和运行账号需通过专用组读取发布包及 `/etc/fetch-news.env`；环境文件建议 `root:<project-group>`、0640。不要输出其中凭据。
- 在现有 MariaDB 新建独立 `utf8mb4` schema 和仅限 `127.0.0.1` 的用户；权限限定该 schema 所需的 SELECT、INSERT、UPDATE、DELETE、CREATE、ALTER、INDEX、REFERENCES，不授予全局权限。MariaDB 不开放公网。
- `/etc/fetch-news.env` 参照 `.env.example`，设置生产数据库、稳定加密 key、`NODE_ENV=production`、`COOKIE_SECURE=true`、`HOST=127.0.0.1`、实际端口与公共路径。
- 填好 `deploy/fetch-news.service.example` 安装为 systemd unit，核实 `/usr/bin/node` 是 22+。首次发布前只执行 daemon-reload，不启动不存在的 current。模板用 384 MiB 内存上限；预计单进程常驻约 100–250 MiB，以实际测量为准。
- Nginx 模板放入独立的精确 include，填好 GitHub 登录名、根目录和后端端口。必须置于 HTTPS server 中，已有站点保持不变。执行 `nginx -t` 成功后才能 reload。不得向公网开放后端或候选端口。
- 构建包预计几十至数百 MiB（依赖会变动），规划当前和上一正常版本的磁盘空间；CI 构建，不在低资源 ECS 安装开发依赖。

## CI、发布与回滚

现有 `.github/workflows/ci.yml` 只测试与构建。完成上述检查和 Secret 授权验证后，将 `deploy/deploy-ecs.yml.example` 安装为 `.github/workflows/deploy-ecs.yml`，按已批准分支修改 `main`。PR 不部署；发布分支及手动触发可以部署，使用 concurrency 串行化。

CI 使用 Node 22，执行类型检查、构建、单元与 MariaDB 集成测试；打包生产依赖、静态资源、服务端产物和迁移。不得上传 Git 元数据、环境文件或数据库。

`release.sh` 的流程：校验路径与产物 → 迁移 → 用独立临时端口启动候选进程（禁用 worker）→ 数据库健康检查 → 原子切换 current → 重启 → 健康验证。失败回滚到记录为 known-good 的上一版本；首次发布失败停服务并保留诊断。成功后只保留当前及上一正常版本，失败目录供运维检查，不自动删诊断。

当前迁移只有建表，重复运行安全。未来迁移必须可向后兼容；破坏性修改、生产数据迁移需单独制定恢复方案并获批准。代码回滚不撤销数据库变更。

CI 之后人工/运维验证：对应提交、服务和数据库健康、HTTPS 公共 URL、子路径深链接、登录与 API、新信息检索、受控测试群通知、浏览器控制台、RSS/swap/磁盘余量。首次管理员通过服务环境下的 CLI 创建，密码只经受保护的文件传入，创建后删除文件。

## 待填写交接清单

```yaml
project: fetch-news
repository: wahbm/<待确认>
visibility: 待用户确认
branch: main（发布前确认）
server: 待确认目标 ECS、区域与授权运维
public_url: https://<domain>/<github-login>/fetch-news/
model: Nginx + native Node.js systemd + shared MariaDB
node: 22+（核实 /usr/bin/node）
root: /srv/fetch-news（先查碰撞）
service: fetch-news（先查碰撞）
ports: 待确认两个未占用的本机端口
schema: fetch_news（独立 schema，先查碰撞）
secrets: 仅服务器环境文件及组织 Secret，不在此填写值
migration: node --env-file=/etc/fetch-news.env dist/server/cli.js migrate
health: <APP_BASE_PATH>health
rollback: current 原子回切到记录的上一 known-good
backup: 待用户选择；当前未设置
verification: 公共 HTTPS、深链接、登录、API、测试通知、资源余量
status: 部署材料已准备，未执行上线
```
