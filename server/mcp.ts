import { ZodError, z } from 'zod';

export const MCP_MODERN_VERSION = '2026-07-28';
export const MCP_LEGACY_VERSION = '2025-11-25';

const SERVER_INFO = { name: 'pulse-fetch-news', version: '1.0.0' };
const INSTRUCTIONS =
  'Before collecting or submitting news, call get_topics and obey every topic note. Only submit source-backed items no older than 3 days. Prefer the last 24 hours, lower heatScore for 1-3 day old items, rank all candidates consistently, and submit at most the top 10. Never include credentials, cookies, tokens, HTML, or unsupported claims.';

const pageArgs = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(100),
});

const articleInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['topicId', 'date', 'title', 'content', 'heatScore', 'url'],
  properties: {
    topicId: { type: 'integer', minimum: 1 },
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    title: { type: 'string', minLength: 1, maxLength: 500 },
    aiSummary: { type: 'string', maxLength: 12000, default: '' },
    content: { type: 'string', minLength: 1, maxLength: 200000 },
    heatScore: { type: 'number', minimum: 0, maximum: 100, multipleOf: 0.01 },
    url: { type: 'string', minLength: 1, maxLength: 2048 },
  },
} as const;

const topicResultSchema = {
  type: 'object',
  required: ['items', 'total', 'page', 'pageSize'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name', 'note', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          note: { type: 'string' },
          createdAt: { type: ['string', 'null'] },
          updatedAt: { type: ['string', 'null'] },
        },
      },
    },
    total: { type: 'integer' },
    page: { type: 'integer' },
    pageSize: { type: 'integer' },
  },
} as const;

const batchResultSchema = {
  type: 'object',
  required: ['items', 'created', 'notified'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'duplicate', 'notified'],
        properties: {
          id: { type: 'integer' },
          duplicate: { type: 'boolean' },
          notified: { type: 'boolean' },
        },
      },
    },
    created: { type: 'integer' },
    notified: { type: 'integer' },
  },
} as const;

export const MCP_TOOLS = [
  {
    name: 'get_topics',
    title: 'Get enabled tracking topics',
    description:
      'Read enabled tracking topics and their administrator notes. Call this before every collection cycle, paginate until complete, use topic id as the stable key, and obey note constraints.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        page: { type: 'integer', minimum: 1, maximum: 100000, default: 1 },
        pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 100 },
      },
    },
    outputSchema: topicResultSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'submit_articles',
    title: 'Submit ranked news articles',
    description:
      'Submit 1-10 source-backed news items after time filtering and global heat ranking. The backend deduplicates by topic and normalized URL and creates notification jobs only for the top three newly inserted items in this batch.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['articles'],
      properties: {
        articles: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          items: articleInputSchema,
        },
      },
    },
    outputSchema: batchResultSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
] as const;

type JsonRpcId = string | number | null;

type McpHandlers = {
  getTopics: (input: { page: number; pageSize: number }) => Promise<unknown>;
  submitArticles: (input: unknown) => Promise<unknown>;
};

export type McpRequestContext = McpHandlers & {
  protocolVersionHeader?: string;
  methodHeader?: string;
  nameHeader?: string;
};

export type McpHttpResult = {
  statusCode: number;
  body?: unknown;
  headers?: Record<string, string>;
};

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: '2.0' as const,
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: '2.0' as const, id, result };
}

function modernMeta() {
  return { 'io.modelcontextprotocol/serverInfo': SERVER_INFO };
}

function modernResult<T extends Record<string, unknown>>(value: T) {
  return {
    ...value,
    resultType: 'complete',
    _meta: modernMeta(),
  };
}

function safeErrorMessage(error: unknown) {
  if (error instanceof ZodError)
    return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  if (error instanceof Error) {
    const status = Number((error as Error & { statusCode?: number }).statusCode || 0);
    if (status > 0 && status < 500) return error.message;
  }
  return '服务暂时不可用，请稍后重试';
}

function toolResult(data: unknown, modern: boolean) {
  const value = {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
    isError: false,
  };
  return modern ? modernResult(value) : value;
}

function toolError(error: unknown, modern: boolean) {
  const value = {
    content: [{ type: 'text', text: safeErrorMessage(error) }],
    isError: true,
  };
  return modern ? modernResult(value) : value;
}

function requestId(body: Record<string, unknown>): JsonRpcId {
  const id = body.id;
  return typeof id === 'string' || typeof id === 'number' || id === null ? id : null;
}

function protocolVersionFromBody(body: Record<string, unknown>) {
  const params = body.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) return undefined;
  const meta = (params as Record<string, unknown>)._meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return undefined;
  const version = (meta as Record<string, unknown>)['io.modelcontextprotocol/protocolVersion'];
  return typeof version === 'string' ? version : undefined;
}

function validateModernHeaders(
  body: Record<string, unknown>,
  context: McpRequestContext,
): McpHttpResult | undefined {
  const bodyVersion = protocolVersionFromBody(body);
  const headerVersion = context.protocolVersionHeader;
  const modern = bodyVersion === MCP_MODERN_VERSION || headerVersion === MCP_MODERN_VERSION;
  if (!modern) return undefined;
  const id = requestId(body);
  const method = body.method;
  if (
    headerVersion !== MCP_MODERN_VERSION ||
    bodyVersion !== MCP_MODERN_VERSION ||
    headerVersion !== bodyVersion
  )
    return {
      statusCode: 400,
      body: rpcError(id, -32020, 'MCP protocol version header mismatch'),
    };
  if (!context.methodHeader || context.methodHeader !== method)
    return {
      statusCode: 400,
      body: rpcError(id, -32020, 'Mcp-Method header mismatch'),
    };
  if (method === 'tools/call') {
    const params = body.params;
    const name =
      params && typeof params === 'object' && !Array.isArray(params)
        ? (params as Record<string, unknown>).name
        : undefined;
    if (typeof name !== 'string' || !context.nameHeader || context.nameHeader !== name)
      return {
        statusCode: 400,
        body: rpcError(id, -32020, 'Mcp-Name header mismatch'),
      };
  }
  return undefined;
}

export async function handleMcpRequest(
  input: unknown,
  context: McpRequestContext,
): Promise<McpHttpResult> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { statusCode: 400, body: rpcError(null, -32600, 'Invalid Request') };
  }
  const body = input as Record<string, unknown>;
  const id = requestId(body);
  if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return { statusCode: 400, body: rpcError(id, -32600, 'Invalid Request') };
  }

  const headerError = validateModernHeaders(body, context);
  if (headerError) return headerError;

  const modern =
    protocolVersionFromBody(body) === MCP_MODERN_VERSION &&
    context.protocolVersionHeader === MCP_MODERN_VERSION;
  const method = body.method;

  if (method === 'notifications/initialized') return { statusCode: 202 };
  if (method === 'ping') return { statusCode: 200, body: rpcResult(id, {}) };

  if (method === 'server/discover') {
    const result = modernResult({
      supportedVersions: [MCP_MODERN_VERSION],
      capabilities: { tools: { listChanged: false } },
      instructions: INSTRUCTIONS,
      ttlMs: 0,
      cacheScope: 'private',
    });
    return {
      statusCode: 200,
      headers: { 'MCP-Protocol-Version': MCP_MODERN_VERSION },
      body: rpcResult(id, result),
    };
  }

  if (method === 'initialize') {
    const result = {
      protocolVersion: MCP_LEGACY_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: INSTRUCTIONS,
    };
    return {
      statusCode: 200,
      headers: { 'MCP-Protocol-Version': MCP_LEGACY_VERSION },
      body: rpcResult(id, result),
    };
  }

  if (method === 'tools/list') {
    const result = { tools: MCP_TOOLS };
    return {
      statusCode: 200,
      body: rpcResult(
        id,
        modern ? modernResult({ ...result, ttlMs: 0, cacheScope: 'private' }) : result,
      ),
    };
  }

  if (method === 'tools/call') {
    const params = body.params;
    if (!params || typeof params !== 'object' || Array.isArray(params))
      return { statusCode: 200, body: rpcError(id, -32602, 'Invalid params') };
    const name = (params as Record<string, unknown>).name;
    const args = (params as Record<string, unknown>).arguments ?? {};
    if (typeof name !== 'string')
      return { statusCode: 200, body: rpcError(id, -32602, 'Invalid params') };

    if (name === 'get_topics') {
      try {
        const parsed = pageArgs.parse(args);
        return { statusCode: 200, body: rpcResult(id, toolResult(await context.getTopics(parsed), modern)) };
      } catch (error) {
        return { statusCode: 200, body: rpcResult(id, toolError(error, modern)) };
      }
    }

    if (name === 'submit_articles') {
      try {
        return {
          statusCode: 200,
          body: rpcResult(id, toolResult(await context.submitArticles(args), modern)),
        };
      } catch (error) {
        return { statusCode: 200, body: rpcResult(id, toolError(error, modern)) };
      }
    }

    return { statusCode: 200, body: rpcError(id, -32601, 'Tool not found') };
  }

  return { statusCode: 200, body: rpcError(id, -32601, 'Method not found') };
}
