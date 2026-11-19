import { useState } from 'react';
import {
  Bot,
  Check,
  Copy,
  Download,
  Plug,
  PlugZap,
  ShieldCheck,
  Trash2,
  XCircle,
  Loader2,
} from 'lucide-react';
import { apply, useEditor } from '../state/store.ts';
import {
  clearActivity,
  connectAssistant,
  disconnectAssistant,
  setBridgePort,
  useAssistant,
  type AssistantStatus,
} from '../state/assistant.ts';
import { Button, NumberInput, Row, Section, Toggle, cx } from '../ui/ui.tsx';

const PATH_KEY = 'vd.assistant.path';
const isWindows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
const EXAMPLE_PATH = isWindows
  ? 'C:\\Users\\you\\Documents\\Viditor\\viditor-mcp.mjs'
  : '/Users/you/Documents/Viditor/viditor-mcp.mjs';

function readPath(): string {
  try {
    return localStorage.getItem(PATH_KEY) ?? '';
  } catch {
    return '';
  }
}

export const STATUS_TEXT: Record<AssistantStatus, string> = {
  off: 'Not connected',
  connecting: 'Connecting…',
  searching: 'Waiting for the bridge…',
  connected: 'Connected',
};

export function StatusDot({ status }: { status: AssistantStatus }) {
  return (
    <span
      className={cx(
        'inline-block h-2 w-2 shrink-0 rounded-full',
        status === 'connected' && 'bg-success',
        (status === 'connecting' || status === 'searching') && 'animate-pulse bg-warning',
        status === 'off' && 'bg-faint',
      )}
    />
  );
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted">{label}</span>
        <button
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-3 hover:text-text"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-sm border border-border bg-surface-1 p-2 font-mono text-[10.5px] leading-relaxed whitespace-pre text-text select-text">
        {text}
      </pre>
    </div>
  );
}

function Setup() {
  const port = useAssistant((s) => s.port);
  const [path, setPath] = useState(readPath);
  const p = path.trim() || EXAMPLE_PATH;
  const desktopConfig = JSON.stringify(
    { mcpServers: { viditor: { command: 'node', args: [p] } } },
    null,
    2,
  );
  return (
    <div className="space-y-3 text-xs text-muted">
      <ol className="list-decimal space-y-3 pl-4 marker:text-faint">
        <li>
          Install <strong className="text-text">Node.js 20 or newer</strong> from nodejs.org (one
          time).
        </li>
        <li>
          <a
            href="/downloads/viditor-mcp.mjs"
            download
            className="inline-flex items-center gap-1 font-medium text-accent-hover hover:underline"
          >
            <Download size={12} /> Download viditor-mcp.mjs
          </a>{' '}
          and save it somewhere permanent. Where did you save it?
          <input
            aria-label="Path to viditor-mcp.mjs"
            className="mt-1.5 h-7 w-full rounded-sm border border-border bg-surface-1 px-2 font-mono text-[11px] text-text outline-none focus:border-accent"
            placeholder={EXAMPLE_PATH}
            value={path}
            onChange={(e) => {
              setPath(e.target.value);
              try {
                localStorage.setItem(PATH_KEY, e.target.value);
              } catch {
                /* ignore */
              }
            }}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </li>
        <li className="space-y-2">
          <span>Add it to your assistant:</span>
          <CopyBlock
            label="Claude Code (terminal)"
            text={`claude mcp add --scope user viditor -- node "${p}"`}
          />
          <CopyBlock
            label="Claude Desktop → Settings → Developer → Edit Config"
            text={desktopConfig}
          />
          <p className="text-[11px] text-faint">
            If the Claude Desktop config already has other servers, add the <code>viditor</code>{' '}
            entry inside the existing <code>mcpServers</code> object. Then restart the assistant.
          </p>
        </li>
        <li>
          Click <strong className="text-text">Connect</strong> above. If the browser asks to let
          this site access apps on your device, choose <strong className="text-text">Allow</strong>{' '}
          — that is how it reaches the bridge on 127.0.0.1.
        </li>
      </ol>
      <Row label="Bridge port">
        <NumberInput
          value={port}
          min={1024}
          max={65535}
          step={1}
          precision={0}
          className="w-20"
          onChange={setBridgePort}
        />
      </Row>
    </div>
  );
}

export function AssistantPanel() {
  const status = useAssistant((s) => s.status);
  const lastError = useAssistant((s) => s.lastError);
  const activity = useAssistant((s) => s.activity);
  const bridgeVersion = useAssistant((s) => s.bridgeVersion);
  const privacy = useEditor((s) => s.project!.privacySettings);
  const [showSetup, setShowSetup] = useState(status !== 'connected');

  const setPrivacy = (settings: Partial<typeof privacy>) =>
    apply({ type: 'setPrivacy', settings }, { label: 'Change AI sharing' });

  return (
    <div className="pb-4">
      <Section title="AI assistant">
        <div className="flex items-center gap-2">
          <StatusDot status={status} />
          <span className="flex-1 text-sm">
            {STATUS_TEXT[status]}
            {status === 'connected' && bridgeVersion && (
              <span className="ml-1 text-[11px] text-faint">bridge v{bridgeVersion}</span>
            )}
          </span>
          {status === 'off' ? (
            <Button size="sm" variant="primary" onClick={connectAssistant}>
              <Plug size={12} /> Connect
            </Button>
          ) : (
            <Button size="sm" onClick={disconnectAssistant}>
              <PlugZap size={12} /> Disconnect
            </Button>
          )}
        </div>
        {lastError && status !== 'connected' && (
          <p className="text-[11px] text-warning">
            {status === 'searching' && <Loader2 size={10} className="mr-1 inline animate-spin" />}
            {lastError}
          </p>
        )}
        <p className="text-[11px] text-faint">
          Lets an assistant such as Claude edit this project through the Viditor bridge on your
          computer. Its edits appear here live, and each one is a single undo step (Ctrl+Z).
        </p>
        <button
          className="text-[11px] font-medium text-accent-hover hover:underline"
          onClick={() => setShowSetup(!showSetup)}
        >
          {showSetup ? 'Hide setup steps' : 'Show setup steps'}
        </button>
        {showSetup && <Setup />}
      </Section>

      <Section title="What the assistant can see">
        <div className="flex items-start gap-2 text-[11px] text-muted">
          <ShieldCheck size={14} className="mt-px shrink-0 text-success" />
          <span>
            Timeline structure and timing, generic media labels like “Video 1”, and resolution.
            Never your footage, audio, frames, or file locations.
          </span>
        </div>
        <Row label="File names">
          <Toggle
            label="Share file names"
            checked={privacy.shareFileNames}
            onChange={(v) => setPrivacy({ shareFileNames: v })}
          />
        </Row>
        <Row label="Title text">
          <Toggle
            label="Share title and caption text"
            checked={privacy.shareTextContent}
            onChange={(v) => setPrivacy({ shareTextContent: v })}
          />
        </Row>
        <p className="text-[11px] text-faint">
          Whatever is shared goes to your assistant&apos;s provider as part of the conversation.
        </p>
      </Section>

      <Section
        title="Activity"
        right={
          activity.length > 0 && (
            <button
              aria-label="Clear activity"
              className="text-faint hover:text-text"
              onClick={clearActivity}
            >
              <Trash2 size={12} />
            </button>
          )
        }
      >
        {activity.length === 0 ? (
          <p className="text-[11px] text-faint">
            <Bot size={12} className="mr-1 inline" />
            Assistant actions will be listed here.
          </p>
        ) : (
          <ul className="space-y-1">
            {activity.map((a) => (
              <li key={a.id} className="flex items-start gap-1.5 text-[11px]">
                {a.ok ? (
                  <Check
                    size={12}
                    className={cx('mt-px shrink-0', a.readOnly ? 'text-faint' : 'text-success')}
                  />
                ) : (
                  <XCircle size={12} className="mt-px shrink-0 text-danger" />
                )}
                <div className="min-w-0 flex-1">
                  <div className={cx('truncate', a.readOnly ? 'text-muted' : 'text-text')}>
                    {a.message}
                  </div>
                  <div className="text-[10px] text-faint">
                    {a.title} · {new Date(a.at).toLocaleTimeString()}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
