/**
 * vikunja_filters tool
 *
 * Manages REAL Vikunja saved filters through the Vikunja API (/filters).
 * Saved filters appear in Vikunja as pseudo-projects with negative IDs:
 *   projectId = -(filterId + 1)   (projectId -1 is the "Favorites" pseudo-project)
 *
 * Actions:
 *   list | get | create | update | delete  -> Vikunja API
 *   build | validate                        -> local helpers for filter query strings
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthManager } from '../auth/AuthManager';
import type { VikunjaClientFactory } from '../client/VikunjaClientFactory';
import { getClientFromContext } from '../client';
import { FilterBuilder, validateFilterExpression, parseFilterString } from '../utils/filters';
import { logger } from '../utils/logger';
import { createStandardResponse, ErrorCode, MCPError } from '../types';
import { createValidationError, wrapToolError } from '../utils/error-handler';
import { formatAorpAsMarkdown } from '../utils/response-factory';
import { assertDeleteEnabled } from '../utils/safety';

/** Shape of a saved filter as returned/accepted by the Vikunja API */
export interface VikunjaSavedFilter {
  id?: number;
  title: string;
  description?: string;
  filters: {
    filter: string;
    filter_include_nulls?: boolean;
    [key: string]: unknown;
  };
  is_favorite?: boolean;
  created?: string;
  updated?: string;
  [key: string]: unknown;
}

const FAVORITES_PSEUDO_PROJECT_ID = -1;

export function filterIdFromProjectId(projectId: number): number {
  return -projectId - 1;
}

export function projectIdFromFilterId(filterId: number): number {
  return -(filterId + 1);
}

const IdSchema = z.object({ id: z.number().int().positive().describe('Saved filter ID') });

const CreateSchema = z.object({
  title: z.string().min(1).describe('Filter title'),
  description: z.string().optional(),
  filter: z
    .string()
    .min(1)
    .describe('Vikunja filter query, e.g. "done = false && priority >= 3 && dueDate < now+7d"'),
  includeNulls: z.boolean().optional().describe('Include tasks where the filtered field is empty'),
  isFavorite: z.boolean().optional(),
});

const UpdateSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  filter: z.string().min(1).optional(),
  includeNulls: z.boolean().optional(),
  isFavorite: z.boolean().optional(),
});

const BuildSchema = z.object({
  conditions: z
    .array(
      z.object({
        field: z.enum([
          'done',
          'priority',
          'percentDone',
          'dueDate',
          'assignees',
          'labels',
          'created',
          'updated',
          'title',
          'description',
        ] as const),
        operator: z.enum(['=', '!=', '>', '>=', '<', '<=', 'like', 'in', 'not in'] as const),
        value: z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.array(z.union([z.string(), z.number()])),
        ]),
      }),
    )
    .min(1),
  groupOperator: z.enum(['&&', '||']).optional(),
});

const ValidateSchema = z.object({ filter: z.string().min(1) });

function validateFilterString(filter: string): void {
  const parsed = parseFilterString(filter);
  if (!parsed.expression) {
    throw createValidationError(`Invalid filter: ${parsed.error?.message || 'invalid syntax'}`);
  }
}

function ok(operation: string, message: string, data: Record<string, unknown>): {
  content: Array<{ type: 'text'; text: string }>;
} {
  const response = createStandardResponse(operation, message, data);
  return { content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }] };
}

export function registerFiltersTool(
  server: McpServer,
  authManager: AuthManager,
  _clientFactory?: VikunjaClientFactory,
): void {
  server.tool(
    'vikunja_filters',
    'Manage Vikunja saved filters (list, get, create, update, delete) and build/validate filter query strings. ' +
      'Filter syntax example: "done = false && priority >= 3 && dueDate < now+7d". ' +
      'A saved filter with id N is shown in Vikunja as project id -(N+1).',
    {
      action: z.enum(['list', 'get', 'create', 'update', 'delete', 'build', 'validate']),
      parameters: z.record(z.unknown()).default({}),
    },
    async ({ action, parameters }) => {
      logger.info(`Executing vikunja_filters action: ${action}`);

      try {
        // Local-only helpers do not need authentication
        if (action === 'build') {
          const params = BuildSchema.parse(parameters);
          const builder = new FilterBuilder();
          params.conditions.forEach((c, i) => {
            if (i > 0) {
              if (params.groupOperator === '||') builder.or();
              else builder.and();
            }
            builder.where(c.field, c.operator, c.value);
          });
          return ok('build-filter', 'Filter built successfully', { filter: builder.toString() });
        }

        if (action === 'validate') {
          const params = ValidateSchema.parse(parameters);
          const parsed = parseFilterString(params.filter);
          if (!parsed.expression) {
            throw createValidationError(`Invalid filter: ${parsed.error?.message || 'invalid syntax'}`);
          }
          const result = validateFilterExpression(parsed.expression);
          return ok('validate-filter', result.valid ? 'Filter is valid' : 'Filter validation failed', {
            valid: result.valid,
            errors: result.errors || [],
            warnings: result.warnings || [],
            filter: params.filter,
          });
        }

        if (!authManager.isAuthenticated()) {
          throw new MCPError(
            ErrorCode.AUTH_REQUIRED,
            'Authentication required. Please use vikunja_auth.connect first.',
          );
        }
        const client = await getClientFromContext();

        switch (action) {
          case 'list': {
            const projects = (await client.projects.getProjects({ per_page: 1000 })) as unknown;
            const list = Array.isArray(projects)
              ? (projects as Array<{ id: number; title: string; description?: string }>)
              : [];
            const filters = list
              .filter((p) => p.id < FAVORITES_PSEUDO_PROJECT_ID)
              .map((p) => ({
                id: filterIdFromProjectId(p.id),
                projectId: p.id,
                title: p.title,
                description: p.description ?? '',
              }));
            return ok('list-filters', `Found ${filters.length} saved filter(s)`, { filters });
          }

          case 'get': {
            const { id } = IdSchema.parse(parameters);
            const filter = (await client.filters.getFilter(id)) as unknown as VikunjaSavedFilter;
            return ok('get-filter', `Saved filter ${id} retrieved`, {
              filter,
              projectId: projectIdFromFilterId(id),
            });
          }

          case 'create': {
            const params = CreateSchema.parse(parameters);
            validateFilterString(params.filter);
            const body: VikunjaSavedFilter = {
              title: params.title,
              filters: {
                filter: params.filter,
                filter_include_nulls: params.includeNulls ?? false,
              },
              ...(params.description !== undefined && { description: params.description }),
              ...(params.isFavorite !== undefined && { is_favorite: params.isFavorite }),
            };
            const created = (await client.filters.createFilter(
              body as unknown as Parameters<typeof client.filters.createFilter>[0],
            )) as unknown as VikunjaSavedFilter;
            return ok('create-filter', `Saved filter "${created.title}" created`, {
              filter: created,
              ...(created.id !== undefined && { projectId: projectIdFromFilterId(created.id) }),
            });
          }

          case 'update': {
            const params = UpdateSchema.parse(parameters);
            if (params.filter !== undefined) validateFilterString(params.filter);

            // Vikunja's POST replaces the whole object: read-modify-write
            const current = (await client.filters.getFilter(params.id)) as unknown as VikunjaSavedFilter;
            const body: VikunjaSavedFilter = {
              ...current,
              ...(params.title !== undefined && { title: params.title }),
              ...(params.description !== undefined && { description: params.description }),
              ...(params.isFavorite !== undefined && { is_favorite: params.isFavorite }),
              filters: {
                ...current.filters,
                ...(params.filter !== undefined && { filter: params.filter }),
                ...(params.includeNulls !== undefined && { filter_include_nulls: params.includeNulls }),
              },
            };
            delete body.created;
            delete body.updated;
            const updated = (await client.filters.updateFilter(
              params.id,
              body as unknown as Parameters<typeof client.filters.updateFilter>[1],
            )) as unknown as VikunjaSavedFilter;
            return ok('update-filter', `Saved filter ${params.id} updated`, { filter: updated });
          }

          case 'delete': {
            const { id } = IdSchema.parse(parameters);
            assertDeleteEnabled('filter');
            await client.filters.deleteFilter(id);
            return ok('delete-filter', `Saved filter ${id} deleted`, { id });
          }

          default:
            throw new MCPError(ErrorCode.NOT_IMPLEMENTED, `Unknown action: ${action as string}`);
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw createValidationError(
            error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
          );
        }
        const id = (parameters as { id?: unknown }).id;
        throw wrapToolError(
          error,
          'vikunja_filters',
          `${action} filter`,
          typeof id === 'number' ? id : undefined,
        );
      }
    },
  );
}
