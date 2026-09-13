# 调用方 API

将 `BASE_URL` 设置为站点前缀，例如 `https://example.com/login/fetch-news`。不要把真实 key 写入仓库或日志。交互文档为 `$BASE_URL/api/docs/`，要求管理员登录。

```bash
export BASE_URL='https://example.com/login/fetch-news'
# 在本机安全环境中配置 CALLER_KEY
curl --fail-with-body "$BASE_URL/api/v1/topics?page=1&pageSize=20" \
  -H "Authorization: Bearer $CALLER_KEY"
```

返回：

```json
{"items":[{"id":1,"name":"web3","note":"只看 Ethereum 网络","createdAt":"2026-09-13 08:00:00.000","updatedAt":"2026-09-13 08:00:00.000"}],"total":1,"page":1,"pageSize":20}
```

仅返回启用热点；按 ID 升序，`pageSize` 1–100。所有调用方读取同一份配置。调用方自行安排查询频率，保存热点 ID，结合 `note` 采集并生成 AI 总结。

```bash
curl --fail-with-body "$BASE_URL/api/v1/articles" \
  -H "Authorization: Bearer $CALLER_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "topicId": 1,
  "date": "2026-09-13",
  "title": "Ethereum 网络动态",
  "aiSummary": "本次动态的简要总结",
  "content": "完整内容，以纯文本保存。",
  "url": "https://example.com/news/ethereum"
}
JSON
```

| 字段 | 要求 |
|---|---|
| topicId | 正整数，必须是已录入热点 |
| date | 必填，真实日历日期 YYYY-MM-DD，不自动推断日期 |
| title | 必填，去首尾空格，最多 500 字符 |
| aiSummary | 可省略，默认空字符串，最多 12000 字符 |
| content | 必填纯文本，最多 200000 字符 |
| url | 必填 HTTP/HTTPS 链接，不允许内嵌账号密码；规范化后最多 2048 UTF-8 字节 |

首次写入返回 `201 {"id":1,"duplicate":false}`，重复返回 `200 {"id":1,"duplicate":true}`。同热点同链接只保存一次，不覆盖原记录，不重复创建通知；不同热点允许收录同一链接。并发重复提交结果相同。

URL 通过标准 URL 解析器统一协议、主机及默认端口，移除 fragment；括号作百分号编码，保留路径及查询参数，不移除追踪参数，不对查询参数排序，不解析重定向。服务端不会抓取该地址。

热点停用后新链接返回 `409`，已有重复记录仍返回 `200`。消息入库成功即表示持久化完成，并不代表机器人已经送达。调用方无需等待通知，后台可查看投递状态。

| 状态码 | 含义 |
|---|---|
| 400 | 字段、日期、URL 或分页无效 |
| 401 | key 缺失、无效、已重置或调用方已禁用 |
| 404 | 热点不存在 |
| 409 | 热点停用或管理端唯一约束冲突 |
| 413 | 请求超过 1 MiB |
| 429 | 限流，遵守 Retry-After |
| 500 | 临时服务故障，可有限退避重试 |

调用方接口默认每个 key 每个接口 120 次/分钟，登录每 IP 10 次/分钟。返回错误为 `{"message":"..."}`。重复提交的幂等性使调用方可在网络超时或临时故障后安全重试入库。

管理员 API 使用 HttpOnly Cookie；写入请求要求 `X-Requested-With: PulseAdmin`，不支持调用方 key。会话有效期 12 小时，注销、禁用管理员或重置密码撤销对应会话。
