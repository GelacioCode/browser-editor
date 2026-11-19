/**
 * viditor-mcp — a local stdio MCP server for Viditor.
 *
 * An MCP host (Claude Desktop, Claude Code, …) launches this process. It exposes Viditor's editing
 * tools over stdio and relays each call to the Viditor tab, which connects to it on 127.0.0.1
 * when the user clicks "Connect" in the editor's AI panel. All edits run inside the tab, through
 * the same validated engine as manual edits. stdout is the MCP channel, so logs go to stderr.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  DEFAULT_ALLOWED_ORIGINS,
  DEFAULT_BRIDGE_PORT,
  SERVER_INSTRUCTIONS,
  TOOLS,
  type ToolDef,
  type ToolOutcome,
} from '@viditor/contracts';
import type { ZodRawShape } from 'zod';
import { TabLink } from './link.ts';

declare const __BRIDGE_VERSION__: string;
const VERSION = typeof __BRIDGE_VERSION__ === 'string' ? __BRIDGE_VERSION__ : '0.0.0-dev';
const EDITOR_URL = 'https://viditor.samuelgelacio.io';

const log = (...args: unknown[]) => console.error('[viditor-mcp]', ...args);

const port = Number(process.env.VIDITOR_BRIDGE_PORT) || DEFAULT_BRIDGE_PORT;
const allowedOrigins = process.env.VIDITOR_ALLOWED_ORIGINS
  ? process.env.VIDITOR_ALLOWED_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : DEFAULT_ALLOWED_ORIGINS;

const link = new TabLink({ port, allowedOrigins, version: VERSION, log });
let linkError: string | null = null;
try {
  await link.start();
  log(`v${VERSION} listening on 127.0.0.1:${port} for ${allowedOrigins.join(', ')}`);
} catch (e) {
  linkError = e instanceof Error ? e.message : String(e);
  log(linkError);
}

function text(outcome: ToolOutcome): CallToolResult {
  const { ok, message, revision, errorCode, data } = outcome;
  const payload = {
    ok,
    message,
    ...(errorCode ? { errorCode } : {}),
    ...(revision !== undefined ? { revision } : {}),
    ...(data !== undefined ? { data } : {}),
  };
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: !ok };
}

const server = new McpServer(
  { name: 'viditor', title: 'Viditor video editor', version: VERSION },
  { instructions: SERVER_INSTRUCTIONS },
);

for (const tool of TOOLS as unknown as ToolDef<ZodRawShape>[]) {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.shape,
      annotations: {
        title: tool.title,
        readOnlyHint: tool.readOnly,
        destructiveHint: tool.destructive ?? false,
        idempotentHint: tool.readOnly,
        openWorldHint: false,
      },
    },
    async (args: unknown) => {
      if (linkError)
        return text({ ok: false, errorCode: 'BRIDGE_UNAVAILABLE', message: linkError });
      if (!link.connected) {
        return text({
          ok: false,
          errorCode: 'NOT_CONNECTED',
          message: `Viditor isn't connected. Ask the user to open ${EDITOR_URL} in Chrome or Edge, open a project, then click "Connect" in the AI panel (left sidebar). If Chrome asks to allow access to apps on this device, they should allow it.`,
        });
      }
      return text(await link.call(tool.name, args));
    },
  );
}

const transport = new StdioServerTransport();
let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  link.stop();
  process.exit(0);
};
transport.onclose = shutdown;
process.stdin.on('close', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await server.connect(transport);
