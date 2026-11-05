import { ProjectSchema, SCHEMA_VERSION, type Project } from './schema.ts';

export class ProjectLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectLoadError';
  }
}

/**
 * Parse a project document from disk, migrating older schema versions forward.
 * Add a case per schema bump: `if (doc.schemaVersion === 1) doc = v1ToV2(doc)`.
 */
export function parseProjectDocument(json: string): Project {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    throw new ProjectLoadError('project.json is not valid JSON');
  }
  if (typeof doc !== 'object' || doc === null || !('schemaVersion' in doc)) {
    throw new ProjectLoadError('Not a Viditor project file');
  }
  const version = (doc as { schemaVersion: unknown }).schemaVersion;
  if (typeof version !== 'number' || version > SCHEMA_VERSION) {
    throw new ProjectLoadError(
      `This project was saved by a newer version of Viditor (schema ${String(version)}). Please update.`,
    );
  }
  const result = ProjectSchema.safeParse(doc);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new ProjectLoadError(
      `Project file is invalid: ${first?.path.join('.')} ${first?.message}`,
    );
  }
  return result.data;
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}
