/**
 * Contracts shared between the editor and the future MCP bridge (milestone 2).
 *
 * The bridge will be a local `viditor-mcp` stdio server that the editor tab connects to over an
 * authenticated 127.0.0.1 WebSocket. Every tool call becomes a `Transaction` against the same
 * `ProjectEngine` the UI uses, so assistant edits are validated, undoable and visible live.
 *
 * Nothing here opens a network connection yet.
 */
import type {
  ApplyResult,
  ChangeEvent,
  MediaItem,
  Operation,
  PrivacySettings,
  Project,
} from '@viditor/project-core';

export const BRIDGE_PROTOCOL_VERSION = 1;

/** Tool names planned for the first MCP release (see docs/Local_Video_Editor_MCP_Project_Guide.md §9). */
export const PLANNED_TOOLS = [
  'get_project',
  'list_media',
  'get_timeline',
  'split_clip',
  'trim_clip',
  'move_clip',
  'add_title',
  'set_transform',
  'set_audio',
  'set_speed',
  'add_caption',
  'apply_operations',
  'undo_last_action',
  'get_job_status',
] as const;
export type ToolName = (typeof PLANNED_TOOLS)[number];

export type BridgeRequest =
  | { id: string; kind: 'getProject' }
  | { id: string; kind: 'apply'; opId: string; expectedRevision: number; ops: Operation[] }
  | { id: string; kind: 'undo' };

export type BridgeResponse =
  | { id: string; kind: 'project'; project: AssistantProjectView }
  | { id: string; kind: 'applied'; result: ApplyResult }
  | { id: string; kind: 'error'; message: string };

export type BridgeEvent = { kind: 'changed'; event: ChangeEvent };

/** Media as exposed to an assistant: generic label, no file name or path unless shared. */
export type AssistantMediaView = Omit<MediaItem, 'name' | 'relativePath'> & { name?: string };

export type AssistantProjectView = Omit<Project, 'media'> & { media: AssistantMediaView[] };

/** Strip data the user hasn't agreed to share before it leaves the editor. */
export function toAssistantView(
  project: Project,
  privacy: PrivacySettings = project.privacySettings,
): AssistantProjectView {
  return {
    ...project,
    media: project.media.map(({ name, relativePath: _rp, ...rest }) =>
      privacy.shareFileNames ? { ...rest, name } : rest,
    ),
    clips: project.clips.map((c) =>
      (c.kind === 'text' || c.kind === 'caption') && !privacy.shareTextContent
        ? { ...c, text: '[hidden]' }
        : c,
    ),
  };
}
