/**
 * Wire protocol between the local `viditor-mcp` bridge (Node, 127.0.0.1) and the editor tab.
 *
 *   tab  ── POST /connect {app, version}             ──▶ bridge   → { token, bridgeVersion, protocol }
 *   tab  ◀─ GET  /events?token=…  (Server-Sent Events) ── bridge   event "call": BridgeCall
 *   tab  ── POST /result  (X-Viditor-Token) BridgeResult ─▶ bridge
 *   tab  ── POST /disconnect (X-Viditor-Token)          ─▶ bridge
 *
 * The bridge only accepts browser requests whose Origin is on its allowlist and whose Host is
 * 127.0.0.1/localhost on its own port (DNS-rebinding guard). Exactly one tab is connected at a
 * time; connecting a new tab replaces the old session.
 */

export const BRIDGE_PROTOCOL_VERSION = 1;
/**
 * Bridge release this editor build expects (kept equal to apps/mcp-bridge/package.json; a unit
 * test checks). Tool definitions are compiled into the bridge, so an older bridge lacks new tools.
 */
export const LATEST_BRIDGE_VERSION = '0.2.0';
export const DEFAULT_BRIDGE_PORT = 47821;
export const TOKEN_HEADER = 'X-Viditor-Token';

/** Origins allowed to connect unless overridden with VIDITOR_ALLOWED_ORIGINS. */
export const DEFAULT_ALLOWED_ORIGINS = [
  'https://viditor.samuelgelacio.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

export interface ConnectRequest {
  app: 'viditor';
  version: string;
  protocol: number;
}

export interface ConnectResponse {
  token: string;
  bridgeVersion: string;
  protocol: number;
}

export interface BridgeCall {
  callId: string;
  tool: string;
  args: unknown;
}

export interface ToolOutcome {
  ok: boolean;
  /** One-line human summary, also shown in the editor's activity log. */
  message: string;
  /** Structured payload returned to the assistant. */
  data?: unknown;
  /** Project revision after the call (mutations) or at read time (queries). */
  revision?: number;
  errorCode?: string;
}

export interface BridgeResult {
  callId: string;
  outcome: ToolOutcome;
}
