import { create } from 'zustand';
import {
  BRIDGE_PROTOCOL_VERSION,
  DEFAULT_BRIDGE_PORT,
  TOKEN_HEADER,
  getTool,
  runTool,
  type BridgeCall,
  type ConnectResponse,
  type ToolOutcome,
} from '@viditor/contracts';
import { select, setPlayhead, toast, useEditor } from './store.ts';
import { analyzeBeats } from './project-io.ts';

/**
 * Connection from this tab to the local viditor-mcp bridge (127.0.0.1). Off until the user clicks
 * Connect. Tool calls arrive over Server-Sent Events, run against the open project's engine, and
 * the outcome is POSTed back. Nothing here talks to any server other than the user's own machine.
 */

export type AssistantStatus = 'off' | 'connecting' | 'connected' | 'searching';

export interface ActivityEntry {
  id: number;
  at: number;
  tool: string;
  title: string;
  ok: boolean;
  message: string;
  readOnly: boolean;
}

interface AssistantState {
  status: AssistantStatus;
  bridgeVersion: string | null;
  lastError: string | null;
  activity: ActivityEntry[];
  port: number;
}

const ENABLED_KEY = 'vd.assistant.enabled';
const PORT_KEY = 'vd.assistant.port';

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export const useAssistant = create<AssistantState>(() => ({
  status: 'off',
  bridgeVersion: null,
  lastError: null,
  activity: [],
  port: Number(readLocal(PORT_KEY)) || DEFAULT_BRIDGE_PORT,
}));

const set = useAssistant.setState;
const get = useAssistant.getState;

let enabled = false;
let token: string | null = null;
let source: EventSource | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 2000;
let activityId = 1;

const base = () => `http://127.0.0.1:${get().port}`;

function scheduleRetry(reason: string) {
  set({ status: 'searching', lastError: reason });
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => void open(), retryDelay);
  retryDelay = Math.min(30_000, retryDelay * 1.6);
}

async function open() {
  if (!enabled) return;
  set({ status: get().status === 'connected' ? 'connected' : 'connecting' });
  let res: ConnectResponse;
  try {
    const r = await fetch(`${base()}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app: 'viditor',
        version: __APP_VERSION__,
        protocol: BRIDGE_PROTOCOL_VERSION,
      }),
    });
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Bridge answered ${r.status}`);
    }
    res = (await r.json()) as ConnectResponse;
  } catch (e) {
    scheduleRetry(
      e instanceof TypeError
        ? 'Bridge not found on this computer (is your assistant running with viditor-mcp?)'
        : e instanceof Error
          ? e.message
          : String(e),
    );
    return;
  }
  if (!enabled) return;
  token = res.token;
  source?.close();
  const es = new EventSource(`${base()}/events?token=${encodeURIComponent(res.token)}`);
  source = es;
  es.addEventListener('hello', () => {
    retryDelay = 2000;
    set({ status: 'connected', bridgeVersion: res.bridgeVersion, lastError: null });
  });
  es.addEventListener(
    'call',
    (e) => void handleCall(JSON.parse((e as MessageEvent<string>).data) as BridgeCall),
  );
  es.addEventListener('closed', (e) => {
    const { reason } = JSON.parse((e as MessageEvent<string>).data) as { reason: string };
    es.close();
    if (source !== es) return;
    source = null;
    if (/another viditor tab/i.test(reason)) {
      // Another tab took over: step aside instead of fighting over the session.
      enabled = false;
      writeLocal(ENABLED_KEY, null);
      set({ status: 'off', lastError: 'Another Viditor tab connected to the assistant.' });
    } else {
      scheduleRetry(reason);
    }
  });
  es.onerror = () => {
    if (source !== es) return;
    es.close();
    source = null;
    if (enabled) scheduleRetry('Lost connection to the bridge');
  };
}

async function handleCall(call: BridgeCall) {
  const editor = useEditor.getState();
  const def = getTool(call.tool);
  let outcome: ToolOutcome;
  if (!editor.engine) {
    outcome = {
      ok: false,
      errorCode: 'NO_PROJECT',
      message: 'No project is open in Viditor. Ask the user to open or create one.',
    };
  } else {
    outcome = await runTool(call.tool, call.args, {
      engine: editor.engine,
      getPlayhead: () => useEditor.getState().playhead,
      setPlayhead,
      select: (ids) => select(ids),
      detectBeats: (mediaId, mode) => analyzeBeats(mediaId, mode),
    });
  }
  set((s) => ({
    activity: [
      {
        id: activityId++,
        at: Date.now(),
        tool: call.tool,
        title: def?.title ?? call.tool,
        ok: outcome.ok,
        message: outcome.message,
        readOnly: def?.readOnly ?? true,
      },
      ...s.activity,
    ].slice(0, 100),
  }));
  try {
    await fetch(`${base()}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [TOKEN_HEADER]: token ?? '' },
      body: JSON.stringify({ callId: call.callId, outcome }),
    });
  } catch {
    /* the bridge will time the call out */
  }
}

export function connectAssistant() {
  enabled = true;
  writeLocal(ENABLED_KEY, '1');
  retryDelay = 2000;
  clearTimeout(retryTimer);
  void open();
}

export function disconnectAssistant() {
  enabled = false;
  writeLocal(ENABLED_KEY, null);
  clearTimeout(retryTimer);
  source?.close();
  source = null;
  if (token) {
    void fetch(`${base()}/disconnect`, {
      method: 'POST',
      headers: { [TOKEN_HEADER]: token },
    }).catch(() => {});
  }
  token = null;
  set({ status: 'off', lastError: null });
}

/** Reconnect automatically if the user left the assistant switched on last time. */
export function resumeAssistantIfEnabled() {
  if (readLocal(ENABLED_KEY) === '1' && !enabled) connectAssistant();
}

export function setBridgePort(port: number) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    toast('Port must be between 1024 and 65535', 'error');
    return;
  }
  writeLocal(PORT_KEY, String(port));
  set({ port });
  if (enabled) connectAssistant();
}

export function clearActivity() {
  set({ activity: [] });
}
