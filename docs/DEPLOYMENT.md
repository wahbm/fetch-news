# 阿里云 ECS 部署与交接

2026-09-14 已完成上线，公网地址：https://8.130.116.192/davyluiy/fetch-news/ 。用户已批准公开仓库、组织部署密钥授权和服务器部署，并明确选择不备份。使用共享原生 MariaDB、宿主机 Nginx 和 systemd。以下保留初始化和后续发布操作说明，已初始化的服务器不要重复执行 provision。

> 2026-09-14 已将功能提交 `3ac88903` 发布到线上，发布运行 `34839358602` 成功；迁移已完成，当前 `heat_score` 和批量接口可用。上一正常版本为 `eae80c2`，仍保留用于回滚。

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

`.github/workflows/ci.yml` 执行测试与构建，`.github/workflows/deploy-ecs.yml` 已启用。`main` 推送或手动触发可部署，仓库变量 `ECS_READY=true`；PR 不部署，发布使用 concurrency 串行化。纯文档提交可用 `[skip ci]` 避免重新发布。

CI 使用 Node 22，执行类型检查、构建、单元与 MariaDB 集成测试；打包生产依赖、静态资源、服务端产物和迁移。不得上传 Git 元数据、环境文件或数据库。

`release.sh` 的流程：校验路径与产物 → 迁移 → 用独立临时端口启动候选进程（禁用 worker）→ 数据库健康检查 → 原子切换 current → 重启 → 健康验证。失败回滚到记录为 known-good 的上一版本；首次发布失败停服务并保留诊断。成功后只保留当前及上一正常版本，失败目录供运维检查，不自动删诊断。

当前迁移包含初始建表和追加的评分字段；由 `schema_migrations` checksum 保证每个文件只执行一次。未来迁移必须可向后兼容；破坏性修改、生产数据迁移需单独制定恢复方案并获批准。代码回滚不撤销数据库变更。

CI 之后人工/运维验证：对应提交、服务和数据库健康、HTTPS 公共 URL、子路径深链接、登录与 API、新信息检索、受控测试群通知、浏览器控制台、RSS/swap/磁盘余量。首次管理员通过服务环境下的 CLI 创建，密码只经受保护的文件传入，创建后删除文件。

## 已完成交接清单

| 项目 | 实际配置 |
|---|---|
| 仓库 / 分支 | https://github.com/wahbm/fetch-news / main，public |
| ECS | 8.130.116.192，cn-wulanchabu，Ubuntu 24.04.4 |
| 运行方式 | Nginx + Node.js 22.23.2 systemd + 共享 MariaDB 10.11.14 |
| 公共路径 | /davyluiy/fetch-news/ |
| 根目录 / 服务 | /srv/fetch-news / fetch-news.service |
| 运行用户 | fetch-news（非登录专用账号） |
| 正式 / 候选端口 | 127.0.0.1:3107 / 127.0.0.1:3108 |
| 数据库 | fetch_news，独立用户，仅 schema 权限 |
| 环境文件 | /etc/fetch-news.env，root:fetch-news 0640 |
| Nginx include | /etc/nginx/snippets/fetch-news.locations.conf |
| 健康检查 | https://8.130.116.192/davyluiy/fetch-news/health |
| 首次运行版本 | eae80c2e72576c56029c51c7e44fa58199545485 |
| 当前运行版本 | 3ac88903d7a71efb75a4fbf41f8ddc7b1a13317c |
| 备份 | 按用户选择，不配置数据库备份或定时备份 |

[首次 CI 验证成功](https://github.com/wahbm/fetch-news/actions/runs/34776920766)，[首次发布成功](https://github.com/wahbm/fetch-news/actions/runs/34776974799)，本轮 [CI 验证成功](https://github.com/wahbm/fetch-news/actions/runs/34839358589)，本轮 [ECS 发布成功](https://github.com/wahbm/fetch-news/actions/runs/34839358602)。当前版本已记录 `.known-good`，并保留上一正常版本用于回滚；未在生产主动演练失败回滚。

首次管理员账号为 `admin`，随机初始密码仅保存在服务器受保护文件中。由服务器管理员在 Workbench 执行以下命令自行读取，勿把输出粘贴到聊天、日志或仓库：

```bash
sudo cat /etc/fetch-news.initial-admin-password
```

完成登录和密码交接后，可删除该初始密码文件；通过后台管理员管理重置密码。环境文件中的数据库密码和加密密钥必须保留。

常用只读检查：

```bash
sudo systemctl status fetch-news --no-pager
sudo journalctl -u fetch-news -n 100 --no-pager
curl --fail https://8.130.116.192/davyluiy/fetch-news/health
sudo nginx -t
```

上线后进程内存约 44 MiB，服务器可用内存 874 MiB，swap 使用 153 MiB，根分区可用 28 GiB，单次发布包约 202 MiB。3107 仅监听回环，候选 3108 已释放；Nginx、MariaDB 和检查的既有应用服务均保持 active。未配置真实企业微信机器人，生产未发送群通知。
