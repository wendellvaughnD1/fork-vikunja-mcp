import { jest } from '@jest/globals';
import {
  parseShareRight,
  shareProjectWithUser,
  autoShareIfConfigured,
} from '../../src/tools/projects/user-sharing';
import { getClientFromContext } from '../../src/client';
import { createProject } from '../../src/tools/projects/crud';

jest.mock('../../src/client', () => ({
  getClientFromContext: jest.fn(),
}));

describe('project user sharing', () => {
  let client: any;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.VIKUNJA_AUTO_SHARE_USERNAME;
    delete process.env.VIKUNJA_AUTO_SHARE_RIGHT;
    client = { projects: { addUserToProject: jest.fn(), getProjectUsers: jest.fn() } };
    (getClientFromContext as jest.Mock).mockResolvedValue(client as never);
  });

  it('parses rights', () => {
    expect(parseShareRight('read')).toBe(0);
    expect(parseShareRight('Write')).toBe(1);
    expect(parseShareRight('admin')).toBe(2);
    expect(parseShareRight(undefined)).toBe(2);
    expect(parseShareRight('', 'write')).toBe(1);
    expect(() => parseShareRight('owner')).toThrow(/Invalid share right/);
  });

  it('sends username in user_id and both right/permission', async () => {
    client.projects.addUserToProject.mockResolvedValue({});
    await shareProjectWithUser(10, ' wendell ', 2);
    expect(client.projects.addUserToProject).toHaveBeenCalledWith(10, {
      user_id: 'wendell',
      username: 'wendell',
      right: 2,
      permission: 2,
    });
  });

  it('rejects empty username', async () => {
    await expect(shareProjectWithUser(10, '  ', 1)).rejects.toThrow(/username/);
  });

  it('auto-share does nothing when not configured', async () => {
    expect(await autoShareIfConfigured(10)).toBeUndefined();
    expect(client.projects.addUserToProject).not.toHaveBeenCalled();
  });

  it('auto-share shares with configured user (default admin)', async () => {
    process.env.VIKUNJA_AUTO_SHARE_USERNAME = 'wendell';
    client.projects.addUserToProject.mockResolvedValue({});
    const status = await autoShareIfConfigured(10);
    expect(status).toContain('shared with user "wendell"');
    expect(client.projects.addUserToProject).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ user_id: 'wendell', right: 2 }),
    );
  });

  it('auto-share never throws and reports a warning on failure', async () => {
    process.env.VIKUNJA_AUTO_SHARE_USERNAME = 'wendell';
    process.env.VIKUNJA_AUTO_SHARE_RIGHT = 'write';
    client.projects.addUserToProject.mockRejectedValue(new Error('forbidden') as never);
    const status = await autoShareIfConfigured(10);
    expect(status).toContain('WARNING');
    expect(status).toContain('forbidden');
  });

  it('createProject auto-shares the new project when configured', async () => {
    process.env.VIKUNJA_AUTO_SHARE_USERNAME = 'wendell';
    client.projects.createProject = jest.fn().mockResolvedValue({ id: 99, title: 'New' } as never);
    client.projects.addUserToProject.mockResolvedValue({});
    const res = await createProject({ title: 'New' } as never);
    expect(client.projects.addUserToProject).toHaveBeenCalledWith(
      99,
      expect.objectContaining({ user_id: 'wendell' }),
    );
    expect(res.content[0].text).toContain('shared with user');
  });
});
