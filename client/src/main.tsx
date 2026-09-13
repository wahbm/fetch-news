import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Alert,
  App as AntApp,
  Avatar,
  Button,
  Card,
  Checkbox,
  ConfigProvider,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Layout,
  Menu,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import zhCN from 'antd/locale/zh_CN';
import {
  AppstoreOutlined,
  RadarChartOutlined,
  ReadOutlined,
  ApiOutlined,
  BellOutlined,
  TeamOutlined,
  SendOutlined,
  PlusOutlined,
  ReloadOutlined,
  ArrowRightOutlined,
  LogoutOutlined,
  SearchOutlined,
  LinkOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { api, post, put, patch, base, time } from './api';
import './style.css';
const { Title, Text, Paragraph } = Typography;
const pages = [
  { key: 'overview', label: '工作概览', icon: <AppstoreOutlined aria-hidden="true" /> },
  { key: 'topics', label: '追踪热点', icon: <RadarChartOutlined aria-hidden="true" /> },
  { key: 'articles', label: '热点信息', icon: <ReadOutlined aria-hidden="true" /> },
  { key: 'callers', label: '调用方', icon: <ApiOutlined aria-hidden="true" /> },
  { key: 'subscribers', label: '订阅通知', icon: <BellOutlined aria-hidden="true" /> },
  { key: 'notifications', label: '投递记录', icon: <SendOutlined aria-hidden="true" /> },
  { key: 'admins', label: '管理员', icon: <TeamOutlined aria-hidden="true" /> },
];
const statuses: Record<string, { label: string; color: string }> = {
  pending: { label: '等待发送', color: 'default' },
  sending: { label: '发送中', color: 'processing' },
  retry: { label: '等待重试', color: 'warning' },
  sent: { label: '已发送', color: 'success' },
  failed: { label: '发送失败', color: 'error' },
  cancelled: { label: '已取消', color: 'default' },
};
function useList(path: string, filters: Record<string, any> = {}, poll = false) {
  const [data, setData] = useState<{ items: any[]; total: number }>({ items: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [revision, revise] = useState(0);
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    setPage(1);
  }, [filterKey]);
  useEffect(() => {
    let alive = true;
    const load = async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const query = new URLSearchParams({
          page: String(page),
          pageSize: '20',
          ...Object.fromEntries(
            Object.entries(JSON.parse(filterKey))
              .filter(([, v]) => v !== '' && v !== undefined && v !== null)
              .map(([k, v]) => [k, String(v)]),
          ),
        });
        const result = await api(path + '?' + query);
        if (alive) {
          setData(result);
          setError('');
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    const timer = poll ? setInterval(() => void load(true), 5000) : undefined;
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [path, filterKey, page, revision, poll]);
  return { ...data, loading, error, page, setPage, reload: () => revise((n) => n + 1) };
}
function useTopics() {
  const [topics, setTopics] = useState<any[]>([]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      let page = 1;
      const all: any[] = [];
      while (true) {
        const result = await api(`/topics?page=${page}&pageSize=100`);
        all.push(...result.items);
        if (all.length >= result.total) break;
        page++;
      }
      if (alive) setTopics(all);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return topics;
}
function useActions() {
  const { message } = AntApp.useApp();
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<any>, success?: string) => {
    setBusy(true);
    try {
      await fn();
      if (success) message.success(success);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { act, busy };
}
function PageHead({
  title,
  description,
  extra,
}: {
  title: string;
  description: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">PULSE / 热点追踪</div>
        <Title level={2}>{title}</Title>
        <Text type="secondary">{description}</Text>
      </div>
      {extra}
    </div>
  );
}
function Status({ enabled }: { enabled: boolean }) {
  return (
    <Tag color={enabled ? 'success' : 'default'} bordered={false}>
      {enabled ? '已启用' : '已停用'}
    </Tag>
  );
}
function Grid({
  list,
  columns,
  onRow,
}: {
  list: ReturnType<typeof useList>;
  columns: any[];
  onRow?: any;
}) {
  return (
    <>
      {list.error && (
        <Alert
          className="error"
          type="error"
          message={list.error}
          action={<Button onClick={list.reload}>重试</Button>}
        />
      )}
      <Table
        rowKey="id"
        size="middle"
        loading={list.loading}
        dataSource={list.items}
        columns={columns}
        onRow={onRow}
        scroll={{ x: 760 }}
        locale={{
          emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无记录" />,
        }}
        pagination={{
          current: list.page,
          total: list.total,
          pageSize: 20,
          showSizeChanger: false,
          onChange: list.setPage,
          showTotal: (n) => `共 ${n} 条`,
        }}
      />
    </>
  );
}
function Login({ onLogin }: { onLogin: (u: any) => void }) {
  const { act, busy } = useActions();
  return (
    <div className="login-page">
      <div className="login-story">
        <div className="brand">
          <span className="brand-icon">P</span> Pulse <span className="brand-cn">热点追踪</span>
        </div>
        <div>
          <div className="eyebrow">KEEP YOUR SIGNAL IN SIGHT</div>
          <h1>
            关注变化，
            <br />
            让信息有迹可循。
          </h1>
          <p>
            从热点追踪到信息归档，再到每一次通知。
            <br />
            让值得关注的动态，抵达需要它的人。
          </p>
          <div className="signal-line">
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
        <small>采集由调用方完成 · 信息由你掌握</small>
      </div>
      <div className="login-panel">
        <Card bordered={false}>
          <div className="eyebrow">WELCOME BACK</div>
          <Title level={2}>登录管理后台</Title>
          <Paragraph type="secondary">使用管理员账号，开始管理你的热点追踪。</Paragraph>
          <Form
            layout="vertical"
            onFinish={(values) => void act(async () => onLogin(await post('/login', values)))}
          >
            <Form.Item
              name="username"
              label="管理员账号"
              rules={[{ required: true, message: '请输入账号' }]}
            >
              <Input size="large" autoComplete="username" placeholder="请输入管理员账号" />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password
                size="large"
                autoComplete="current-password"
                placeholder="请输入密码"
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" size="large" block loading={busy}>
              登录 <ArrowRightOutlined aria-hidden="true" />
            </Button>
          </Form>
          <div className="login-help">
            <SafetyCertificateOutlined aria-hidden="true" /> 账号由管理员创建，不开放公开注册
          </div>
        </Card>
      </div>
    </div>
  );
}
function Overview({ go }: { go: (page: string) => void }) {
  const [stats, setStats] = useState<any>();
  const [error, setError] = useState('');
  const recent = useList('/articles');
  useEffect(() => {
    api('/stats')
      .then(setStats)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <PageHead
        title="每个变化，都值得被看见"
        description="将关注的话题、采集的信息与订阅通知，集中在一处。"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined aria-hidden="true" />}
            onClick={() => go('topics')}
          >
            管理追踪热点
          </Button>
        }
      />
      {error && <Alert type="error" message={error} />}
      <div className="stats-grid">
        {[
          {
            title: '正在追踪',
            value: stats?.topics,
            unit: '个热点',
            icon: <RadarChartOutlined aria-hidden="true" />,
          },
          {
            title: '已归档信息',
            value: stats?.articles,
            unit: '条信息',
            icon: <ReadOutlined aria-hidden="true" />,
          },
          {
            title: '有效订阅',
            value: stats?.subscribers,
            unit: '个订阅方',
            icon: <BellOutlined aria-hidden="true" />,
          },
          {
            title: '待投递',
            value: stats?.pending,
            unit: '条通知',
            icon: <ClockCircleOutlined aria-hidden="true" />,
          },
        ].map((s) => (
          <Card key={s.title}>
            <div className="stat-title">
              {s.title}
              <span>{s.icon}</span>
            </div>
            <Statistic loading={!stats && !error} value={s.value ?? '—'} />
            <Text type="secondary">{s.unit}</Text>
          </Card>
        ))}
      </div>
      {Number(stats?.failed) > 0 && (
        <Alert
          showIcon
          type="warning"
          className="error"
          message={`${stats.failed} 条通知发送失败`}
          action={
            <Button size="small" onClick={() => go('notifications')}>
              查看投递记录
            </Button>
          }
        />
      )}
      <Card className="workflow-card">
        <div>
          <Tag bordered={false} color="blue">
            追踪工作流
          </Tag>
          <Title level={4}>从关注到送达，保持信息流动</Title>
          <Text type="secondary">后台管理配置，调用方负责采集，新信息自动通知订阅方。</Text>
        </div>
        <div className="steps">
          {['配置热点', '调用方采集', '信息归档', '企微通知'].map((x, i) => (
            <React.Fragment key={x}>
              <div>
                <b>0{i + 1}</b>
                <span>{x}</span>
              </div>
              {i < 3 && <ArrowRightOutlined aria-hidden="true" />}
            </React.Fragment>
          ))}
        </div>
      </Card>
      <Card
        title="最新归档"
        extra={
          <Button type="link" onClick={() => go('articles')}>
            全部信息 <ArrowRightOutlined aria-hidden="true" />
          </Button>
        }
      >
        <Grid
          list={recent}
          columns={[
            {
              title: '标题',
              dataIndex: 'title',
              render: (x: string) => <span className="article-title">{x}</span>,
            },
            { title: '热点', dataIndex: 'topic_name', render: (x: string) => <Tag>{x}</Tag> },
            { title: '信息日期', dataIndex: 'article_date', width: 140 },
            { title: '来源', dataIndex: 'caller_name', width: 140 },
          ]}
        />
      </Card>
    </>
  );
}
function Topics({ go }: { go: (page: string, query?: string) => void }) {
  const [q, setQ] = useState('');
  const list = useList('/topics', { q });
  const [editing, setEditing] = useState<any>();
  const [form] = Form.useForm();
  const { act, busy } = useActions();
  const open = (row?: any) => {
    setEditing(row || {});
    form.setFieldsValue(row || { name: '', note: '', enabled: true });
  };
  return (
    <>
      <PageHead
        title="追踪热点"
        description="定义你关注的话题，并用备注明确采集范围。"
        extra={
          <Button type="primary" icon={<PlusOutlined aria-hidden="true" />} onClick={() => open()}>
            新增热点
          </Button>
        }
      />
      <Card>
        <div className="toolbar">
          <Input.Search
            allowClear
            placeholder="搜索热点名称或备注"
            onSearch={setQ}
            style={{ maxWidth: 360 }}
          />
          <Button icon={<ReloadOutlined aria-hidden="true" />} onClick={list.reload}>
            刷新
          </Button>
        </div>
        <Grid
          list={list}
          columns={[
            {
              title: '热点名称',
              dataIndex: 'name',
              render: (x: string, row: any) => (
                <Button
                  type="link"
                  className="name-link"
                  onClick={() => go('articles', `topicId=${row.id}`)}
                >
                  <span className="topic-dot" />
                  {x}
                </Button>
              ),
            },
            {
              title: '采集备注',
              dataIndex: 'note',
              render: (x: string) => <span className="muted">{x || '未设置额外范围'}</span>,
            },
            { title: '状态', dataIndex: 'enabled', render: (x: boolean) => <Status enabled={x} /> },
            { title: '更新时间', dataIndex: 'updated_at', render: time },
            {
              title: '操作',
              render: (_: any, row: any) => (
                <Space>
                  <Button type="link" onClick={() => open(row)}>
                    编辑
                  </Button>
                  <Popconfirm
                    title={
                      row.enabled ? '停用后调用方无法提交新信息，历史记录保留。' : '启用此热点？'
                    }
                    onConfirm={() =>
                      act(async () => {
                        await put(`/topics/${row.id}`, { ...row, enabled: !row.enabled });
                        list.reload();
                      })
                    }
                  >
                    <Button type="text">{row.enabled ? '停用' : '启用'}</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <Modal
        title={editing?.id ? '编辑热点' : '新增追踪热点'}
        open={!!editing}
        onCancel={() => setEditing(undefined)}
        onOk={() => form.submit()}
        confirmLoading={busy}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) =>
            act(async () => {
              if (editing.id) await put(`/topics/${editing.id}`, values);
              else await post('/topics', values);
              setEditing(undefined);
              list.reload();
            }, '热点已保存')
          }
        >
          <Form.Item
            name="name"
            label="热点名称"
            rules={[{ required: true, whitespace: true, message: '请输入热点名称' }]}
          >
            <Input maxLength={120} placeholder="例如：web3、AI、医药、小米" />
          </Form.Item>
          <Form.Item name="note" label="采集备注">
            <Input.TextArea
              rows={4}
              maxLength={10000}
              showCount
              placeholder="例如：只需要查看 Ethereum 网络的热点"
            />
          </Form.Item>
          <Form.Item name="enabled" label="启用追踪" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
function Articles() {
  const [q, setQ] = useState('');
  const [topicId, setTopicId] = useState<number | undefined>(() => {
    const n = Number(new URLSearchParams(location.search).get('topicId'));
    return n || undefined;
  });
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const topics = useTopics();
  const list = useList('/articles', { q, topicId, from, to });
  const [detail, setDetail] = useState<any>();
  const { act } = useActions();
  return (
    <>
      <PageHead title="热点信息" description="浏览每个热点的历史记录，搜索标题、AI 总结与正文。" />
      <Card>
        <div className="toolbar wrap">
          <Input.Search
            allowClear
            placeholder="搜索标题、总结或内容"
            onSearch={setQ}
            style={{ width: 300 }}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="全部热点"
            value={topicId}
            onChange={setTopicId}
            style={{ width: 190 }}
            options={topics.map((t) => ({
              value: t.id,
              label: t.name + (t.enabled ? '' : '（已停用）'),
            }))}
          />
          <Space>
            <Input
              aria-label="开始日期"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <span>至</span>
            <Input
              aria-label="结束日期"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Space>
          <Button icon={<ReloadOutlined aria-hidden="true" />} onClick={list.reload} />
        </div>
        <Grid
          list={list}
          columns={[
            {
              title: '标题 / AI 总结',
              dataIndex: 'title',
              render: (x: string, row: any) => (
                <div className="article-cell">
                  <Button
                    type="link"
                    className="article-title"
                    onClick={() => act(async () => setDetail(await api(`/articles/${row.id}`)))}
                  >
                    {x}
                  </Button>
                  <p>{row.ai_summary || '暂无 AI 总结'}</p>
                </div>
              ),
            },
            {
              title: '所属热点',
              dataIndex: 'topic_name',
              render: (x: string) => (
                <Tag color="blue" bordered={false}>
                  {x}
                </Tag>
              ),
            },
            { title: '日期', dataIndex: 'article_date', width: 120 },
            { title: '调用方', dataIndex: 'caller_name', width: 130 },
            {
              title: '原文',
              dataIndex: 'url',
              render: (x: string) => (
                <a href={x} target="_blank" rel="noopener noreferrer">
                  <LinkOutlined aria-hidden="true" /> 打开
                </a>
              ),
            },
          ]}
        />
      </Card>
      <Drawer
        title="信息详情"
        open={!!detail}
        onClose={() => setDetail(undefined)}
        width="min(780px, 100vw)"
      >
        {detail && (
          <>
            <Tag color="blue">{detail.topic_name}</Tag>
            <Title level={3}>{detail.title}</Title>
            <Descriptions
              column={2}
              items={[
                { key: 'date', label: '信息日期', children: detail.article_date },
                { key: 'caller', label: '调用方', children: detail.caller_name },
                { key: 'time', label: '入库时间', children: time(detail.created_at) },
              ]}
            />
            <a href={detail.url} target="_blank" rel="noopener noreferrer">
              <LinkOutlined aria-hidden="true" /> 查看原文
            </a>
            <div className="summary-box">
              <h4>AI 总结</h4>
              <div className="plain-content">{detail.ai_summary || '暂无 AI 总结'}</div>
            </div>
            <Title level={4}>正文</Title>
            <div className="plain-content">{detail.content}</div>
          </>
        )}
      </Drawer>
    </>
  );
}
function Callers() {
  const list = useList('/callers');
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [form] = Form.useForm();
  const { act, busy } = useActions();
  return (
    <>
      <PageHead
        title="调用方管理"
        description="为采集服务分配独立凭据，读取热点配置并提交信息。"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined aria-hidden="true" />}
            onClick={() => {
              form.resetFields();
              setOpen(true);
            }}
          >
            创建调用方
          </Button>
        }
      />
      <Alert
        className="info-banner"
        type="info"
        showIcon
        message="调用方通过 Bearer key 访问接口。完整 key 仅展示一次，请在创建后妥善保存。"
      />
      <Card>
        <Grid
          list={list}
          columns={[
            { title: '调用方名称', dataIndex: 'name' },
            {
              title: 'API key',
              dataIndex: 'key_prefix',
              render: (x: string) => <Text code>{x}••••••</Text>,
            },
            { title: '状态', dataIndex: 'enabled', render: (x: boolean) => <Status enabled={x} /> },
            { title: '最后调用', dataIndex: 'last_used_at', render: time },
            {
              title: '操作',
              render: (_: any, row: any) => (
                <Space>
                  <Popconfirm
                    title="重置后旧 key 立即失效，确定继续？"
                    onConfirm={() =>
                      act(async () => {
                        const r = await post(`/callers/${row.id}/reset-key`);
                        setKey(r.key);
                        list.reload();
                      })
                    }
                  >
                    <Button type="link">重置 key</Button>
                  </Popconfirm>
                  <Popconfirm
                    title={row.enabled ? '禁用此调用方？' : '启用此调用方？'}
                    onConfirm={() =>
                      act(async () => {
                        await patch(`/callers/${row.id}`, { enabled: !row.enabled });
                        list.reload();
                      })
                    }
                  >
                    <Button type="text">{row.enabled ? '禁用' : '启用'}</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <Card className="api-card" title="调用接口">
        <Text code>GET {base}/api/v1/topics</Text>
        <Paragraph type="secondary">分页获取启用热点与采集备注。</Paragraph>
        <Text code>POST {base}/api/v1/articles</Text>
        <Paragraph type="secondary">提交热点信息，相同热点下相同链接自动去重。</Paragraph>
        <Button
          href={base + '/api/docs/'}
          target="_blank"
          icon={<ApiOutlined aria-hidden="true" />}
        >
          查看 API 文档
        </Button>
      </Card>
      <Modal
        title="创建调用方"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={busy}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) =>
            act(async () => {
              const r = await post('/callers', values);
              setOpen(false);
              setKey(r.key);
              list.reload();
            })
          }
        >
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, whitespace: true, message: '请输入名称' }]}
          >
            <Input maxLength={120} placeholder="例如：每日资讯采集服务" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="保存调用方 key"
        open={!!key}
        onCancel={() => setKey('')}
        footer={
          <Button type="primary" onClick={() => setKey('')}>
            我已保存
          </Button>
        }
      >
        <Alert type="warning" showIcon message="关闭后无法再次查看完整 key。" />
        <Paragraph className="secret-display" copyable>
          {key}
        </Paragraph>
      </Modal>
    </>
  );
}
function Subscribers({ go }: { go: (p: string, q?: string) => void }) {
  const list = useList('/subscribers');
  const topics = useTopics();
  const [editing, setEditing] = useState<any>();
  const [form] = Form.useForm();
  const allTopics = Form.useWatch('allTopics', form);
  const { act, busy } = useActions();
  const open = (r?: any) => {
    setEditing(r || {});
    form.resetFields();
    form.setFieldsValue(
      r ? { ...r, key: undefined } : { enabled: true, allTopics: true, topicIds: [] },
    );
  };
  return (
    <>
      <PageHead
        title="订阅通知"
        description="连接企业微信群机器人，将新信息推送给关注它的人。"
        extra={
          <Button type="primary" icon={<PlusOutlined aria-hidden="true" />} onClick={() => open()}>
            创建订阅方
          </Button>
        }
      />
      <Card>
        <Grid
          list={list}
          columns={[
            { title: '订阅方', dataIndex: 'name' },
            {
              title: '机器人 key',
              dataIndex: 'key_suffix',
              render: (x: string) => <Text code>••••••••{x}</Text>,
            },
            {
              title: '订阅范围',
              render: (_: any, r: any) =>
                r.allTopics ? (
                  <Tag color="blue">全部热点</Tag>
                ) : (
                  <span>{r.topicIds.length} 个指定热点</span>
                ),
            },
            { title: '状态', dataIndex: 'enabled', render: (x: boolean) => <Status enabled={x} /> },
            {
              title: '操作',
              width: 290,
              render: (_: any, r: any) => (
                <Space size={0}>
                  <Button type="link" onClick={() => open(r)}>
                    编辑
                  </Button>
                  <Popconfirm
                    title="向此订阅方的企业微信群发送一条测试通知？"
                    onConfirm={() =>
                      act(async () => {
                        await post(`/subscribers/${r.id}/test`);
                        go('notifications', `subscriberId=${r.id}`);
                      }, '测试通知已加入队列')
                    }
                  >
                    <Button type="link" disabled={!r.enabled}>
                      测试通知
                    </Button>
                  </Popconfirm>
                  <Button type="text" onClick={() => go('notifications', `subscriberId=${r.id}`)}>
                    投递记录
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <div className="tip">
        <CheckCircleOutlined aria-hidden="true" />{' '}
        新信息保存后自动投递；修改订阅范围不会补发历史信息。
      </div>
      <Modal
        title={editing?.id ? '编辑订阅方' : '创建订阅方'}
        open={!!editing}
        onCancel={() => setEditing(undefined)}
        onOk={() => form.submit()}
        confirmLoading={busy}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) =>
            act(async () => {
              const input = { ...values, key: values.key?.trim() || undefined };
              if (editing.id) await put(`/subscribers/${editing.id}`, input);
              else await post('/subscribers', input);
              setEditing(undefined);
              list.reload();
            }, '订阅方已保存')
          }
        >
          <Form.Item
            name="name"
            label="订阅方名称"
            rules={[{ required: true, whitespace: true, message: '请输入名称' }]}
          >
            <Input maxLength={120} placeholder="例如：产品团队资讯群" />
          </Form.Item>
          <Form.Item
            name="key"
            label="企业微信机器人 key"
            extra={
              editing?.id
                ? '留空保留原 key。只填写 webhook 地址中 key= 后面的值。'
                : '从企业微信群机器人 webhook 地址中复制 key= 后面的值。'
            }
            rules={[{ required: !editing?.id, message: '请输入机器人 key' }]}
          >
            <Input.Password
              autoComplete="new-password"
              placeholder={editing?.id ? '留空不修改' : '请输入 key'}
              maxLength={200}
            />
          </Form.Item>
          <Form.Item name="allTopics" valuePropName="checked">
            <Checkbox>订阅全部热点（包含未来新增热点）</Checkbox>
          </Form.Item>
          {!allTopics && (
            <Form.Item
              name="topicIds"
              label="选择热点"
              rules={[{ required: true, type: 'array', min: 1, message: '至少选择一个热点' }]}
            >
              <Select
                mode="multiple"
                showSearch
                optionFilterProp="label"
                options={topics.map((t) => ({
                  value: t.id,
                  label: t.name + (t.enabled ? '' : '（已停用）'),
                }))}
                placeholder="请选择热点"
              />
            </Form.Item>
          )}
          <Form.Item name="enabled" label="启用通知" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
function Notifications() {
  const [status, setStatus] = useState<string>();
  const subscriberId = new URLSearchParams(location.search).get('subscriberId') || undefined;
  const list = useList('/notifications', { status, subscriberId }, true);
  const [attempts, setAttempts] = useState<any[] | undefined>();
  const { act } = useActions();
  return (
    <>
      <PageHead
        title="投递记录"
        description="查看发送状态和每次尝试，失败通知可手动重试。每 5 秒自动刷新。"
      />
      <Card>
        <div className="toolbar">
          <Select
            allowClear
            placeholder="全部状态"
            value={status}
            onChange={setStatus}
            style={{ width: 180 }}
            options={Object.entries(statuses).map(([value, s]) => ({ value, label: s.label }))}
          />
          {subscriberId && <Tag>订阅方 #{subscriberId}</Tag>}
          <Button icon={<ReloadOutlined aria-hidden="true" />} onClick={list.reload}>
            刷新
          </Button>
        </div>
        <Grid
          list={list}
          columns={[
            {
              title: '通知内容',
              render: (_: any, r: any) => (
                <div className="article-cell">
                  <span>{r.kind === 'test' ? '机器人连接测试' : r.title}</span>
                  <p>{r.subscriber_name}</p>
                </div>
              ),
            },
            {
              title: '状态',
              dataIndex: 'status',
              render: (x: string) => <Tag color={statuses[x]?.color}>{statuses[x]?.label}</Tag>,
            },
            { title: '本轮尝试', dataIndex: 'attempts', render: (n: number) => `${n} / 5` },
            { title: '创建时间', dataIndex: 'created_at', render: time },
            {
              title: '最近错误 / 下次尝试',
              render: (_: any, r: any) => (
                <div className="muted">
                  {r.last_error || '—'}
                  {r.status === 'retry' && <div>{time(r.next_attempt_at)}</div>}
                </div>
              ),
            },
            {
              title: '操作',
              render: (_: any, r: any) => (
                <Space size={0}>
                  <Button
                    type="link"
                    onClick={() =>
                      act(async () => setAttempts(await api(`/notifications/${r.id}/attempts`)))
                    }
                  >
                    详情
                  </Button>
                  {r.status === 'failed' && (
                    <Popconfirm
                      title="重新发送此通知？超时情况下可能重复送达。"
                      onConfirm={() =>
                        act(async () => {
                          await post(`/notifications/${r.id}/retry`);
                          list.reload();
                        }, '已加入重试队列')
                      }
                    >
                      <Button type="link">重试</Button>
                    </Popconfirm>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <Drawer title="发送尝试" open={!!attempts} onClose={() => setAttempts(undefined)} width={640}>
        <Table
          rowKey="id"
          dataSource={attempts}
          pagination={false}
          columns={[
            { title: '轮次 / 尝试', render: (_: any, r: any) => `${r.generation} / ${r.attempt}` },
            {
              title: '结果',
              dataIndex: 'outcome',
              render: (x: string) =>
                ({ sent: '成功', failed: '失败', sending: '发送中', unknown: '接收状态未知' })[x] ||
                x,
            },
            { title: '说明', dataIndex: 'error' },
            { title: '时间', dataIndex: 'created_at', render: time },
          ]}
        />
      </Drawer>
    </>
  );
}
function Admins() {
  const list = useList('/admins');
  const [editing, setEditing] = useState<any>();
  const [form] = Form.useForm();
  const { act, busy } = useActions();
  return (
    <>
      <PageHead
        title="管理员"
        description="管理员共享全部数据。禁用或重置密码后，该账号的现有会话立即失效。"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined aria-hidden="true" />}
            onClick={() => {
              form.resetFields();
              setEditing({});
            }}
          >
            创建管理员
          </Button>
        }
      />
      <Card>
        <Grid
          list={list}
          columns={[
            {
              title: '账号',
              dataIndex: 'username',
              render: (x: string) => (
                <Space>
                  <Avatar size="small">{x[0].toUpperCase()}</Avatar>
                  {x}
                </Space>
              ),
            },
            { title: '状态', dataIndex: 'enabled', render: (x: boolean) => <Status enabled={x} /> },
            { title: '创建时间', dataIndex: 'created_at', render: time },
            {
              title: '操作',
              render: (_: any, r: any) => (
                <Space>
                  <Button
                    type="link"
                    onClick={() => {
                      form.resetFields();
                      setEditing(r);
                    }}
                  >
                    重置密码
                  </Button>
                  <Popconfirm
                    title={r.enabled ? '禁用此管理员并撤销其登录会话？' : '启用此管理员？'}
                    onConfirm={() =>
                      act(async () => {
                        await patch(`/admins/${r.id}`, { enabled: !r.enabled });
                        list.reload();
                      })
                    }
                  >
                    <Button type="text">{r.enabled ? '禁用' : '启用'}</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <Modal
        title={editing?.id ? `重置 ${editing.username} 的密码` : '创建管理员'}
        open={!!editing}
        onCancel={() => setEditing(undefined)}
        onOk={() => form.submit()}
        confirmLoading={busy}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) =>
            act(async () => {
              if (editing.id)
                await post(`/admins/${editing.id}/password`, { password: values.password });
              else await post('/admins', values);
              setEditing(undefined);
              list.reload();
            }, '管理员已更新')
          }
        >
          {!editing?.id && (
            <Form.Item
              name="username"
              label="账号"
              rules={[
                {
                  required: true,
                  min: 3,
                  max: 80,
                  pattern: /^[a-zA-Z0-9_.@-]+$/,
                  message: '至少 3 位，使用字母、数字或 _.@-',
                },
              ]}
            >
              <Input autoComplete="off" />
            </Form.Item>
          )}
          <Form.Item
            name="password"
            label="密码"
            extra="至少 12 个字符，UTF-8 编码不超过 72 字节。"
            rules={[{ required: true, min: 12, max: 72, message: '密码至少 12 个字符' }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
function Main() {
  const [user, setUser] = useState<any>();
  const [loading, setLoading] = useState(true);
  const [initialError, setInitialError] = useState('');
  const [page, setPage] = useState(
    () => location.pathname.slice(base.length).split('/').filter(Boolean)[0] || 'overview',
  );
  const { act } = useActions();
  const loadUser = useCallback(() => {
    setLoading(true);
    api('/me')
      .then(setUser)
      .catch((e) => {
        if (e.status !== 401) setInitialError(e.message);
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    loadUser();
    const logout = () => setUser(undefined);
    const back = () =>
      setPage(location.pathname.slice(base.length).split('/').filter(Boolean)[0] || 'overview');
    window.addEventListener('pulse:unauthorized', logout);
    window.addEventListener('popstate', back);
    return () => {
      window.removeEventListener('pulse:unauthorized', logout);
      window.removeEventListener('popstate', back);
    };
  }, [loadUser]);
  const go = (key: string, query?: string) => {
    history.pushState({}, '', `${base}/${key}${query ? '?' + query : ''}`);
    setPage(key);
  };
  if (loading)
    return (
      <div className="loading-screen">
        <Spin size="large" tip="正在连接管理后台" />
      </div>
    );
  if (initialError && !user)
    return (
      <div className="loading-screen">
        <Alert
          type="error"
          message={initialError}
          action={
            <Button
              onClick={() => {
                setInitialError('');
                loadUser();
              }}
            >
              重新连接
            </Button>
          }
        />
      </div>
    );
  if (!user) return <Login onLogin={setUser} />;
  const content: Record<string, React.ReactNode> = {
    overview: <Overview go={go} />,
    topics: <Topics go={go} />,
    articles: <Articles key={location.search} />,
    callers: <Callers />,
    subscribers: <Subscribers go={go} />,
    notifications: <Notifications key={location.search} />,
    admins: <Admins />,
  };
  return (
    <Layout className="shell">
      <Layout.Sider breakpoint="lg" collapsedWidth={68} width={232} theme="dark">
        <div className="brand side-brand">
          <span className="brand-icon">P</span>
          <span className="brand-text">
            Pulse<small>热点追踪管理</small>
          </span>
        </div>
        <div className="nav-label">工作空间</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[page]}
          items={pages}
          onClick={({ key }) => go(key)}
        />
        <div className="sidebar-foot">
          <span className="online-dot" /> 专注有价值的信息
        </div>
      </Layout.Sider>
      <Layout>
        <Layout.Header className="topbar">
          <span>
            工作空间 <span className="separator">/</span>{' '}
            <b>{pages.find((p) => p.key === page)?.label || '页面不存在'}</b>
          </span>
          <Space size={16}>
            <Tag bordered={false} color="blue">
              管理后台
            </Tag>
            <Space>
              <Avatar size={30} style={{ background: '#e5ebff', color: '#475be8' }}>
                {user.username[0].toUpperCase()}
              </Avatar>
              <span>{user.username}</span>
            </Space>
            <Button
              type="text"
              aria-label="退出登录"
              icon={<LogoutOutlined aria-hidden="true" />}
              onClick={() =>
                act(async () => {
                  await post('/logout');
                  setUser(undefined);
                })
              }
            />
          </Space>
        </Layout.Header>
        <Layout.Content className="content" key={page}>
          {content[page] || (
            <Empty description="页面不存在">
              <Button onClick={() => go('overview')}>返回概览</Button>
            </Empty>
          )}
          <footer className="page-footer">
            PULSE · 热点追踪管理 <span>时间显示：Asia / Shanghai</span>
          </footer>
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#4f5fe8',
          borderRadius: 8,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
          colorBgLayout: '#f5f6fa',
          colorText: '#20283f',
        },
        components: {
          Table: { headerBg: '#f8f9fc', headerColor: '#7b8397' },
          Menu: {
            darkItemBg: '#121b32',
            darkItemSelectedBg: '#29355b',
            darkItemHoverBg: '#202c49',
          },
          Card: { paddingLG: 24 },
        },
      }}
    >
      <AntApp>
        <Main />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
