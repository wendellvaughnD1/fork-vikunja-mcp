/**
 * Projects Tool Module - Main Orchestrator
 * Coordinates all project-related operations through specialized submodules
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthManager } from '../../auth/AuthManager';
import type { VikunjaClientFactory } from '../../client/VikunjaClientFactory';
import { MCPError, ErrorCode } from '../../types';
import type { McpResponse } from './crud';
import { createAuthRequiredError, wrapToolError } from '../../utils/error-handler';
import { validateId } from './validation';

// Import all submodule operations
import {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  archiveProject,
  unarchiveProject,
  type ListProjectsArgs,
  type GetProjectArgs,
  type CreateProjectArgs,
  type UpdateProjectArgs,
  type DeleteProjectArgs,
  type ArchiveProjectArgs
} from './crud';

import {
  getProjectChildren,
  getProjectTree,
  getProjectBreadcrumb,
  moveProject,
  type GetChildrenArgs,
  type GetTreeArgs,
  type GetBreadcrumbArgs,
  type MoveProjectArgs
} from './hierarchy';

import { shareProjectWithUser, listProjectUsers, parseShareRight } from './user-sharing';

function textResponse(message: string, data: unknown): McpResponse {
  return {
    content: [
      {
        type: 'text' as const,
        text: `${message}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``,
      },
    ],
  };
}

/**
 * Legacy single-tool interface for backward compatibility
 * Registers a single tool with all subcommands like the original implementation
 */
export function registerProjectsTool(
  server: McpServer,
  authManager: AuthManager,
  clientFactory?: VikunjaClientFactory
): void {
  server.tool(
    'vikunja_projects',
    'Manage projects: CRUD, archive, hierarchy (children/tree/breadcrumb/move) and sharing with users (share-with-user, list-users)',
    {
      subcommand: z.enum(['list', 'get', 'create', 'update', 'delete', 'archive', 'unarchive',
        'get-children', 'get-tree', 'get-breadcrumb', 'move',
        'share-with-user', 'list-users'
      ]),
      // CRUD arguments
      id: z.number().positive().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      parentProjectId: z.number().positive().optional(),
      isArchived: z.boolean().optional(),
      hexColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      page: z.number().min(1).optional(),
      perPage: z.number().min(1).max(100).optional(),
      search: z.string().optional(),
      // Hierarchy arguments
      maxDepth: z.number().min(1).max(20).optional(),
      includeArchived: z.boolean().optional(),
      // User sharing arguments (share-with-user / list-users use `id` as project ID)
      username: z.string().optional(),
      right: z.enum(['read', 'write', 'admin']).optional(),
      // Session ID for AORP response tracking
      sessionId: z.string().optional(),
    },
    async (args, context) => {
      // Check authentication with enhanced error message
      if (!authManager.isAuthenticated()) {
        throw createAuthRequiredError('access project management features');
      }

      // Set the client factory for this request if provided
      if (clientFactory) {
        const { setGlobalClientFactory } = await import('../../client.js');
        await setGlobalClientFactory(clientFactory);
      }

      try {
        const result = await (async (): Promise<McpResponse> => {
          switch (args.subcommand) {
            // CRUD operations
            case 'list':
              return await listProjects(args as ListProjectsArgs);

            case 'get':
              if (args.id === undefined || args.id === null) {
                throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required');
              }
              validateId(args.id, 'id');
              return await getProject(args as GetProjectArgs);

            case 'create':
              if (!args.title) {
                throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project title is required for create operation');
              }
              return await createProject(args as CreateProjectArgs);

          case 'update':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for update operation');
            }
            return await updateProject(args as UpdateProjectArgs);

          case 'delete':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for delete operation');
            }
            return await deleteProject(args as DeleteProjectArgs);

          case 'archive':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for archive operation');
            }
            return await archiveProject(args as ArchiveProjectArgs);

          case 'unarchive':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for unarchive operation');
            }
            return await unarchiveProject(args as ArchiveProjectArgs);

          // Hierarchy operations
          case 'get-children':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for get-children operation');
            }
            return await getProjectChildren(args as GetChildrenArgs, context);

          case 'get-tree':
            return await getProjectTree(args as GetTreeArgs, context);

          case 'get-breadcrumb':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for get-breadcrumb operation');
            }
            return await getProjectBreadcrumb(args as GetBreadcrumbArgs, context);

          case 'move':
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for move operation');
            }
            validateId(args.id, 'id');
            return await moveProject(args as MoveProjectArgs, context);

          // User sharing operations
          case 'share-with-user': {
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID (id) is required');
            }
            if (!args.username) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'username is required');
            }
            validateId(args.id, 'id');
            const right = parseShareRight(args.right, 'write');
            const shared = await shareProjectWithUser(args.id, args.username, right);
            return textResponse(
              `Project ${args.id} shared with "${args.username}" (${args.right ?? 'write'})`,
              shared,
            );
          }

          case 'list-users': {
            if (!args.id) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID (id) is required');
            }
            validateId(args.id, 'id');
            const users = await listProjectUsers(args.id);
            return textResponse(`Users with access to project ${args.id}`, users);
          }

          default:
            throw new MCPError(ErrorCode.VALIDATION_ERROR, `Unknown subcommand: ${String(args.subcommand)}`);
        }
        })();

        return result;
      } catch (error) {
        throw wrapToolError(error, 'vikunja_projects', args.subcommand, args.id);
      }
    }
  );
}

/**
 * Registers separate project tools with the MCP server (new modular interface)
 * Use registerProjectsTool for backward compatibility
 */
export function registerProjectTools(
  server: McpServer,
  _authManager: AuthManager,
  _clientFactory: VikunjaClientFactory
): void {
  // CRUD Operations
  server.tool(
    'vikunja_projects_crud',
    'Project CRUD operations (list, get, create, update, delete, archive, unarchive)',
    {
      subcommand: z.enum(['list', 'get', 'create', 'update', 'delete', 'archive', 'unarchive']),
      id: z.number().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      parentProjectId: z.number().optional(),
      isArchived: z.boolean().optional(),
      hexColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      page: z.number().min(1).optional(),
      perPage: z.number().min(1).max(100).optional(),
      search: z.string().optional(),
      verbosity: z.enum(['minimal', 'standard', 'detailed']).optional(),
      useOptimizedFormat: z.boolean().optional(),
      useAorp: z.boolean().optional(),
    },
    async (args, _context) => {
      try {
        const result = await (async (): Promise<McpResponse> => {
          switch (args.subcommand) {
            case 'list':
              return await listProjects(args as ListProjectsArgs);

            case 'get':
              if (args.id === undefined || args.id === null) {
                throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required');
              }
              validateId(args.id, 'id');
              return await getProject(args as GetProjectArgs);

            case 'create':
              if (!args.title) {
                throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project title is required for create operation');
              }
              return await createProject(args as CreateProjectArgs);

            case 'update':
              if (!args.id) {
                throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for update operation');
              }
              return await updateProject(args as UpdateProjectArgs);

            case 'delete':
              if (!args.id) {
                throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for delete operation');
              }
              return await deleteProject(args as DeleteProjectArgs);

            case 'archive':
              if (!args.id) {
                throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for archive operation');
              }
              return await archiveProject(args as ArchiveProjectArgs);

            case 'unarchive':
              if (!args.id) {
                throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for unarchive operation');
              }
              return await unarchiveProject(args as ArchiveProjectArgs);

            default:
              throw new MCPError(ErrorCode.VALIDATION_ERROR, `Unknown CRUD subcommand: ${String(args.subcommand)}`);
          }
        })();

        return result;
      } catch (error) {
        throw wrapToolError(error, 'vikunja_projects_crud', args.subcommand, args.id);
      }
    }
  );

  // Hierarchy Operations
  server.tool(
    'vikunja_projects_hierarchy',
    'Project hierarchy operations (children, tree, breadcrumb, move)',
    {
      subcommand: z.enum(['children', 'tree', 'breadcrumb', 'move']),
      id: z.number().optional(),
      maxDepth: z.number().min(1).max(20).optional(),
      includeArchived: z.boolean().optional(),
      parentProjectId: z.number().optional(),
      verbosity: z.enum(['minimal', 'standard', 'detailed']).optional(),
      useOptimizedFormat: z.boolean().optional(),
      useAorp: z.boolean().optional(),
    },
    async (args, context) => {
      try {
        const result = await (async (): Promise<McpResponse> => {
          switch (args.subcommand) {
            case 'children':
              if (!args.id) {
                throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for children operation');
              }
              return await getProjectChildren(args as GetChildrenArgs, context);

            case 'tree':
              return await getProjectTree(args as GetTreeArgs, context);

            case 'breadcrumb':
              if (!args.id) {
                throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for breadcrumb operation');
              }
              return await getProjectBreadcrumb(args as GetBreadcrumbArgs, context);

            case 'move':
              if (!args.id) {
                throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Project ID is required for move operation');
              }
              return await moveProject(args as MoveProjectArgs, context);

            default:
              throw new MCPError(ErrorCode.VALIDATION_ERROR, `Unknown hierarchy subcommand: ${String(args.subcommand)}`);
          }
        })();

        return result;
      } catch (error) {
        throw wrapToolError(error, 'vikunja_projects_hierarchy', args.subcommand, args.id);
      }
    }
  );
}

// Export all types for external use
export type {
  ListProjectsArgs,
  GetProjectArgs,
  CreateProjectArgs,
  UpdateProjectArgs,
  DeleteProjectArgs,
  ArchiveProjectArgs,
  GetChildrenArgs,
  GetTreeArgs,
  GetBreadcrumbArgs,
  MoveProjectArgs
};

// Export all functions for direct use if needed
export {
  // CRUD
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  archiveProject,
  unarchiveProject,

  // Hierarchy
  getProjectChildren,
  getProjectTree,
  getProjectBreadcrumb,
  moveProject,

  // User sharing
  shareProjectWithUser,
  listProjectUsers
};