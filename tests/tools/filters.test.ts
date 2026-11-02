/**
 * vikunja_filters tool tests (real Vikunja saved filters via API)
 */

import { jest } from '@jest/globals';
import { registerFiltersTool, filterIdFromProjectId, projectIdFromFilterId } from '../../src/tools/filters';
import { getClientFromContext } from '../../src/client';

jest.mock('../../src/client', () => ({
  getClientFromContext: jest.fn(),
}));

type Handler = (args: { action: string; parameters: Record<string, unknown> }) => Promise<{
  content: Array<{ type: string; text: string }>;
}>;

describe('vikunja_filters (Vikunja saved filters)', () => {
  let handler: Handler;
  let client: any;
  let authManager: any;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.VIKUNJA_ENABLE_FILTER_DELETE;

    client = {
      projects: { getProjects: jest.fn() },
      filters: {
        getFilter: jest.fn(),
        createFilter: jest.fn(),
        updateFilter: jest.fn(),
        deleteFilter: jest.fn(),
      },
    };
    (getClientFromContext as jest.Mock).mockResolvedValue(client as never);

    authManager = { isAuthenticated: jest.fn().mockReturnValue(true) };
    const server: any = {
      tool: jest.fn((_name: string, _desc: string, _schema: unknown, h: Handler) => {
        handler = h;
      }),
    };
    registerFiltersTool(server, authManager);
    expect(server.tool).toHaveBeenCalledWith(
      'vikunja_filters',
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('maps filter IDs to pseudo-project IDs and back', () => {
    expect(projectIdFromFilterId(1)).toBe(-2);
    expect(filterIdFromProjectId(-2)).toBe(1);
    expect(filterIdFromProjectId(projectIdFromFilterId(42))).toBe(42);
  });

  it('list returns only saved-filter pseudo projects (id < -1)', async () => {
    client.projects.getProjects.mockResolvedValue([
      { id: -1, title: 'Favorites' },
      { id: -2, title: 'Urgent' },
      { id: -6, title: 'This week', description: 'd' },
      { id: 7, title: 'Real project' },
    ]);
    const res = await handler({ action: 'list', parameters: {} });
    const text = res.content[0].text;
    expect(text).toContain('Found 2 saved filter(s)');
    expect(text).toContain('Urgent');
    expect(text).toContain('This week');
    expect(text).not.toContain('Real project');
    expect(text).not.toContain('Favorites');
  });

  it('get calls the API with the filter id', async () => {
    client.filters.getFilter.mockResolvedValue({ id: 3, title: 'F', filters: { filter: 'done = false' } });
    const res = await handler({ action: 'get', parameters: { id: 3 } });
    expect(client.filters.getFilter).toHaveBeenCalledWith(3);
    expect(res.content[0].text).toContain('Saved filter 3 retrieved');
  });

  it('create sends Vikunja body shape', async () => {
    client.filters.createFilter.mockResolvedValue({ id: 5, title: 'Urgent', filters: { filter: 'priority >= 4' } });
    await handler({
      action: 'create',
      parameters: { title: 'Urgent', filter: 'priority >= 4', description: 'x', isFavorite: true },
    });
    expect(client.filters.createFilter).toHaveBeenCalledWith({
      title: 'Urgent',
      description: 'x',
      is_favorite: true,
      filters: { filter: 'priority >= 4', filter_include_nulls: false },
    });
  });

  it('create rejects an invalid filter string before calling the API', async () => {
    await expect(
      handler({ action: 'create', parameters: { title: 'Bad', filter: '((( &&' } }),
    ).rejects.toThrow(/Invalid filter/);
    expect(client.filters.createFilter).not.toHaveBeenCalled();
  });

  it('update does read-modify-write and keeps untouched fields', async () => {
    client.filters.getFilter.mockResolvedValue({
      id: 3,
      title: 'Old',
      description: 'keep me',
      is_favorite: true,
      created: '2026-01-01',
      updated: '2026-01-02',
      filters: { filter: 'done = false', filter_include_nulls: true, s: '' },
    });
    client.filters.updateFilter.mockResolvedValue({ id: 3, title: 'New' });

    await handler({ action: 'update', parameters: { id: 3, title: 'New' } });

    expect(client.filters.updateFilter).toHaveBeenCalledWith(3, {
      id: 3,
      title: 'New',
      description: 'keep me',
      is_favorite: true,
      filters: { filter: 'done = false', filter_include_nulls: true, s: '' },
    });
  });

  it('delete is blocked by default', async () => {
    await expect(handler({ action: 'delete', parameters: { id: 3 } })).rejects.toThrow(
      /VIKUNJA_ENABLE_FILTER_DELETE/,
    );
    expect(client.filters.deleteFilter).not.toHaveBeenCalled();
  });

  it('delete works when enabled', async () => {
    process.env.VIKUNJA_ENABLE_FILTER_DELETE = 'true';
    client.filters.deleteFilter.mockResolvedValue({ message: 'ok' });
    const res = await handler({ action: 'delete', parameters: { id: 3 } });
    expect(client.filters.deleteFilter).toHaveBeenCalledWith(3);
    expect(res.content[0].text).toContain('Saved filter 3 deleted');
  });

  it('requires authentication for API actions', async () => {
    authManager.isAuthenticated.mockReturnValue(false);
    await expect(handler({ action: 'list', parameters: {} })).rejects.toThrow(/Authentication required/);
  });

  it('build and validate work without authentication', async () => {
    authManager.isAuthenticated.mockReturnValue(false);
    const built = await handler({
      action: 'build',
      parameters: {
        conditions: [
          { field: 'done', operator: '=', value: false },
          { field: 'priority', operator: '>=', value: 3 },
        ],
      },
    });
    expect(built.content[0].text).toContain('done = false && priority >= 3');

    const valid = await handler({ action: 'validate', parameters: { filter: 'done = false' } });
    expect(valid.content[0].text).toContain('Filter is valid');
  });

  it('turns zod errors into validation errors', async () => {
    await expect(handler({ action: 'get', parameters: { id: 'abc' } })).rejects.toThrow(/id/);
  });
});
