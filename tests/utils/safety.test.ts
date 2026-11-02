import { assertDeleteEnabled, isDeleteEnabled } from '../../src/utils/safety';
import { MCPError, ErrorCode } from '../../src/types/errors';

describe('safety: destructive operations gating', () => {
  const vars = ['TASK', 'PROJECT', 'LABEL', 'FILTER'].map((e) => `VIKUNJA_ENABLE_${e}_DELETE`);
  beforeEach(() => vars.forEach((v) => delete process.env[v]));
  afterEach(() => vars.forEach((v) => delete process.env[v]));

  it('everything is disabled by default', () => {
    for (const e of ['task', 'project', 'label', 'filter'] as const) {
      expect(isDeleteEnabled(e)).toBe(false);
      expect(() => assertDeleteEnabled(e)).toThrow(MCPError);
    }
  });

  it('throws PERMISSION_DENIED with env var name and alternative', () => {
    try {
      assertDeleteEnabled('project');
      fail('should throw');
    } catch (e) {
      expect((e as MCPError).code).toBe(ErrorCode.PERMISSION_DENIED);
      expect((e as Error).message).toContain('VIKUNJA_ENABLE_PROJECT_DELETE');
      expect((e as Error).message).toContain('Archive');
    }
  });

  it.each(['true', 'TRUE', '1', 'yes', ' true '])('accepts %p', (v) => {
    process.env.VIKUNJA_ENABLE_LABEL_DELETE = v;
    expect(isDeleteEnabled('label')).toBe(true);
    expect(() => assertDeleteEnabled('label')).not.toThrow();
    expect(isDeleteEnabled('task')).toBe(false);
  });

  it.each(['false', '0', '', 'no'])('rejects %p', (v) => {
    process.env.VIKUNJA_ENABLE_TASK_DELETE = v;
    expect(isDeleteEnabled('task')).toBe(false);
  });
});
