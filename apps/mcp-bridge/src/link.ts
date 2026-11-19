import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  BRIDGE_PROTOCOL_VERSION,
  TOKEN_HEADER,
  type BridgeCall,
  type BridgeResult,
  type ConnectRequest,
  type ConnectResponse,
  type ToolOutcome,
} from '@viditor/contracts';

export interface TabLinkOptions {
  port: number;
  allowedOrigins: string[];
  version: string;
  log: (...args: unknown[]) => void;
  callTimeoutMs?: number;
}

interface Session {
  token: string;
  origin: string;
  events: ServerResponse | null;
  heartbeat: ReturnType<typeof setInterval> | null;
}

interface Pending {
  resolve: (o: ToolOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
}

const MAX_BODY = 4 * 1024 * 1024;

/**
 * Loopback link to the Viditor tab. Binds 127.0.0.1 only; accepts browser requests from allowed
 * origins only; checks the Host header against its own port (DNS-rebinding guard); one session.
 */
export class TabLink {
  private server: http.Server | null = null;
  private session: Session | null = null;
  private pending = new Map<string, Pending>();
  private readonly hosts: Set<string>;

  constructor(private opts: TabLinkOptions) {
    this.hosts = new Set([`127.0.0.1:${opts.port}`, `localhost:${opts.port}`]);
  }

  get connected(): boolean {
    return !!this.session?.events;
  }

  get connectedOrigin(): string | null {
    return this.session?.origin ?? null;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handle(req, res).catch((e) => {
          this.opts.log('request error', e);
          if (!res.headersSent) res.writeHead(500).end();
        });
      });
      server.once('error', (e: NodeJS.ErrnoException) => {
        reject(
          e.code === 'EADDRINUSE'
            ? new Error(
                `Port ${this.opts.port} is already in use — probably another viditor-mcp is running for a different assistant. Close it, or set VIDITOR_BRIDGE_PORT.`,
              )
            : e,
        );
      });
      server.listen(this.opts.port, '127.0.0.1', () => {
        this.server = server;
        resolve();
      });
    });
  }

  stop() {
    this.endSession('Bridge shutting down');
    this.server?.close();
  }

  /** Send a tool call to the connected tab and wait for its outcome. */
  call(tool: string, args: unknown): Promise<ToolOutcome> {
    const s = this.session;
    if (!s?.events) {
      return Promise.resolve({
        ok: false,
        errorCode: 'NOT_CONNECTED',
        message: 'Viditor is not connected',
      });
    }
    const callId = randomUUID();
    const msg: BridgeCall = { callId, tool, args };
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        resolve({ ok: false, errorCode: 'TIMEOUT', message: 'The editor did not respond in time' });
      }, this.opts.callTimeoutMs ?? 120_000);
      this.pending.set(callId, { resolve, timer });
      s.events!.write(`event: call\ndata: ${JSON.stringify(msg)}\n\n`);
    });
  }

  /* ------------------------------------------------------------------------------------------ */

  private endSession(reason: string) {
    const s = this.session;
    if (!s) return;
    if (s.heartbeat) clearInterval(s.heartbeat);
    if (s.events) {
      s.events.write(`event: closed\ndata: ${JSON.stringify({ reason })}\n\n`);
      s.events.end();
    }
    this.session = null;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({
        ok: false,
        errorCode: 'NOT_CONNECTED',
        message: `Editor disconnected (${reason})`,
      });
      this.pending.delete(id);
    }
  }

  private cors(res: ServerResponse, origin: string) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    // DNS-rebinding guard: only accept requests addressed to the loopback name we bind to.
    if (!this.hosts.has(String(req.headers.host ?? '').toLowerCase())) {
      res.writeHead(421).end();
      return;
    }
    // Only browser pages from allowed origins. (Browsers set Origin; pages cannot forge it.)
    const origin = String(req.headers.origin ?? '');
    if (!this.opts.allowedOrigins.includes(origin)) {
      this.opts.log(`rejected request from origin "${origin || '(none)'}"`);
      res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Origin not allowed');
      return;
    }
    this.cors(res, origin);

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
      res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${TOKEN_HEADER}`);
      res.setHeader('Access-Control-Max-Age', '600');
      if (req.headers['access-control-request-private-network'] === 'true') {
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
      }
      res.writeHead(204).end();
      return;
    }

    if (req.method === 'POST' && url.pathname === '/connect') {
      const body = (await readJson(req)) as Partial<ConnectRequest> | null;
      if (!body || body.app !== 'viditor' || body.protocol !== BRIDGE_PROTOCOL_VERSION) {
        json(res, 400, {
          error: `Protocol mismatch: bridge speaks v${BRIDGE_PROTOCOL_VERSION}. Update viditor-mcp.`,
        });
        return;
      }
      this.endSession('Another Viditor tab connected');
      const token = randomBytes(32).toString('base64url');
      this.session = { token, origin, events: null, heartbeat: null };
      this.opts.log(`editor connected from ${origin} (Viditor ${body.version})`);
      const out: ConnectResponse = {
        token,
        bridgeVersion: this.opts.version,
        protocol: BRIDGE_PROTOCOL_VERSION,
      };
      json(res, 200, out);
      return;
    }

    const token =
      url.searchParams.get('token') ?? String(req.headers[TOKEN_HEADER.toLowerCase()] ?? '');
    const s = this.session;
    if (!s || token !== s.token || origin !== s.origin) {
      json(res, 401, { error: 'Not connected. Reconnect from the editor.' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      if (s.events) s.events.end();
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write(`event: hello\ndata: ${JSON.stringify({ bridgeVersion: this.opts.version })}\n\n`);
      s.events = res;
      if (s.heartbeat) clearInterval(s.heartbeat);
      s.heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
      req.on('close', () => {
        if (this.session === s && s.events === res) {
          s.events = null;
          if (s.heartbeat) clearInterval(s.heartbeat);
          s.heartbeat = null;
          this.opts.log('editor event stream closed');
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/result') {
      const body = (await readJson(req)) as Partial<BridgeResult> | null;
      const p = body?.callId ? this.pending.get(body.callId) : undefined;
      if (!p || !body?.outcome) {
        json(res, 404, { error: 'Unknown call' });
        return;
      }
      clearTimeout(p.timer);
      this.pending.delete(body.callId!);
      p.resolve(body.outcome);
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/disconnect') {
      this.endSession('Disconnected from the editor');
      json(res, 200, { ok: true });
      return;
    }

    json(res, 404, { error: 'Not found' });
  }
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
      } catch {
        resolve(null);
      }
    });
    req.on('error', reject);
  });
}
