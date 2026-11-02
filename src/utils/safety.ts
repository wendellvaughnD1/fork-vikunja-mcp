/**
 * Safety controls for destructive operations.
 *
 * Vikunja has no trash/recovery: every delete is permanent.
 * All destructive operations are therefore DISABLED by default and must be
 * explicitly enabled per entity type via environment variables:
 *
 *   VIKUNJA_ENABLE_TASK_DELETE=true     -> delete / bulk-delete tasks
 *   VIKUNJA_ENABLE_PROJECT_DELETE=true  -> delete projects (and all their tasks)
 *   VIKUNJA_ENABLE_LABEL_DELETE=true    -> delete labels (removed from all tasks)
 *   VIKUNJA_ENABLE_FILTER_DELETE=true   -> delete saved filters
 */

import { MCPError, ErrorCode } from '../types/errors';

export type DeletableEntity = 'task' | 'project' | 'label' | 'filter';

const ALTERNATIVES: Record<DeletableEntity, string> = {
  task: 'Mark the task as done instead (update with done=true).',
  project: 'Archive the project instead (subcommand "archive").',
  label: 'Rename or stop using the label instead.',
  filter: 'Update the filter instead.',
};

function envVarName(entity: DeletableEntity): string {
  return `VIKUNJA_ENABLE_${entity.toUpperCase()}_DELETE`;
}

export function isDeleteEnabled(entity: DeletableEntity): boolean {
  const raw = process.env[envVarName(entity)];
  return raw !== undefined && ['true', '1', 'yes'].includes(raw.trim().toLowerCase());
}

/**
 * Throws PERMISSION_DENIED unless deletes are enabled for the given entity.
 */
export function assertDeleteEnabled(entity: DeletableEntity): void {
  if (!isDeleteEnabled(entity)) {
    throw new MCPError(
      ErrorCode.PERMISSION_DENIED,
      `Deleting ${entity}s is disabled on this server (set ${envVarName(entity)}=true to enable). ` +
        ALTERNATIVES[entity],
    );
  }
}
