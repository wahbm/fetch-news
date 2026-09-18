# ChatGPT / MCP 调用方接入

Pulse 在现有调用方 REST API 之外提供一个最小、无状态的 MCP 网关。目标是让 ChatGPT 或其他 MCP 客户端直接读取追踪热点并提交筛选后的新闻，同时继续复用现有调用方权限、去重、事务和企业微信通知链路。

## 地址与认证

生产部署后的 MCP 地址：

```text
https://8.130.116.192/davyluiy/fetch-news/mcp
```

认证继续使用后台“调用方”页面生成的同一枚 API key：

```http
Authorization: Bearer <CALLER_KEY>
```

不要把 key 写入聊天提示词、定时任务文本、代码仓库或普通日志。应把它配置到 MCP 客户端的受保护认证设置中。服务端日志已对 `Authorization` 头做脱敏。

MCP 网关不会读取管理员会话，也不会返回企业微信机器人 key。

## 工具

### `get_topics`

读取当前启用的追踪热点及管理员备注。

输入：

```json
{
  "page": 1,
  "pageSize": 100
}
```

调用方必须分页读完，以 `id` 为稳定任务主键，并严格遵守 `note`。正常采集周期应先调用本工具，不应依赖旧的热点缓存长期运行。

### `submit_articles`

提交同一轮筛选出的 1–10 条热点信息。输入与 `POST /api/v1/articles/batch` 的 `articles` 完全一致。

服务端继续执行现有规则：每批最多 10 条；规范化 URL 后按“热点 + URL”幂等去重；只为本批新写入且 `heatScore` 排名前三的文章创建通知任务；重复记录不覆盖旧内容，也不会再次通知；企业微信发送仍由后台 worker 异步完成，MCP 调用方不接触 webhook key。

## 推荐给 AI 的执行顺序

```text
每个采集周期
  ├─ get_topics，分页读取全部启用热点
  ├─ 根据 name + note 搜索外部来源
  ├─ 核对真实事件/发布日期与原文链接
  ├─ 丢弃超过 3 天的信息
  ├─ 对 1–3 天仍有价值的信息固定降低 heatScore
  ├─ 基于来源生成 aiSummary 和纯文本 content
  ├─ 所有热点候选统一评分，降序取 Top 10
  └─ submit_articles 一次提交
```

新闻搜索、来源验证和 AI 总结仍由 MCP 客户端完成，Pulse 服务端不会主动抓取 `url`。

## 协议兼容

同一个 `POST /mcp` 端点兼容 MCP `2025-11-25` 的 `initialize` / `tools/list` / `tools/call` 请求，以及 MCP `2026-07-28` 的无状态 `server/discover`；同时支持 `ping` 和 `notifications/initialized`。GET / DELETE 不提供 SSE 或会话管理，返回 405。

## 与原 REST API 的关系

MCP 是薄适配层，不是第二套业务实现：`get_topics` 复用 REST 热点查询的数据和约束；`submit_articles` 复用原批量入库函数；Bearer key 仍从 `callers` 表校验并更新最后调用时间；仍使用调用方接口的每 key 限流；不新增数据库表或迁移。

因此原有自动化程序可继续使用 `/api/v1/*`，MCP 客户端使用 `/mcp`，两者行为保持一致。
