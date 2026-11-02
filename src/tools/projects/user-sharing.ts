/**
 * Project → user sharing (NOT public link shares).
 *
 * Vikunja endpoint: PUT /projects/{id}/users
 * The JSON field "user_id" carries the USERNAME (Vikunja quirk).
 * The access level field was renamed from "right" to "permission" in newer
 * Vikunja versions: both are sent, unknown fields are ignored by the server.
 *
 * Levels: 0 = read, 1 = read & write, 2 = admin
 *
 * Auto-share: when VIKUNJA_AUTO_SHARE_USERNAME is set, every project created
 * through this server is shared with that user right after creation
 * (level from VIKUNJA_AUTO_SHARE_RIGHT, default "admin").
 */

import { getClientFromContext } from '../../client';
import { MCPError, ErrorCode } from '../../types';
import { logger } from '../../utils/logger';

export type ShareRight = 'read' | 'write' | 'admin';

const RIGHT_MAP: Record<ShareRight, number> = { read: 0, write: 1, admin: 2 };

export function parseShareRight(value: string | undefined, fallback: ShareRight = 'admin'): number {
  if (value === undefined || value.trim() === '') return RIGHT_MAP[fallback];
  const key = value.trim().toLowerCase();
  if (key in RIGHT_MAP) return RIGHT_MAP[key as ShareRight];
  throw new MCPError(
    ErrorCode.VALIDATION_ERROR,
    `Invalid share right "${value}". Use one of: read, write, admin`,
  );
}

export async function shareProjectWithUser(
  projectId: number,
  username: string,
  right: number,
): Promise<unknown> {
  if (!username.trim()) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, 'username is required');
  }
  const client = await getClientFromContext();
  const body = { user_id: username.trim(), username: username.trim(), right, permission: right };
  return client.projects.addUserToProject(
    projectId,
    body as unknown as Parameters<typeof client.projects.addUserToProject>[1],
  );
}

export async function listProjectUsers(projectId: number): Promise<unknown> {
  const client = await getClientFromContext();
  return client.projects.getProjectUsers(projectId);
}

/**
 * Auto-share a newly created project if configured. Never throws:
 * returns a short status string to append to the create response.
 */
export async function autoShareIfConfigured(projectId: number): Promise<string | undefined> {
  const username = process.env.VIKUNJA_AUTO_SHARE_USERNAME?.trim();
  if (!username) return undefined;
  try {
    const right = parseShareRight(process.env.VIKUNJA_AUTO_SHARE_RIGHT, 'admin');
    await shareProjectWithUser(projectId, username, right);
    return `Project shared with user "${username}".`;
  } catch (error) {
    logger.error(`Auto-share of project ${projectId} with ${username} failed`, error);
    const msg = error instanceof Error ? error.message : String(error);
    return `WARNING: project created but NOT shared with "${username}": ${msg}`;
  }
}
