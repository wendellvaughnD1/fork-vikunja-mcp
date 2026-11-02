/**
 * Legacy upstream tests exercise delete operations directly.
 * Destructive operations are disabled by default in this fork (see src/utils/safety.ts),
 * so enable them for the test environment. Gating itself is covered by
 * tests/utils/safety.test.ts and tests/tools/filters.test.ts.
 */
process.env.VIKUNJA_ENABLE_TASK_DELETE = 'true';
process.env.VIKUNJA_ENABLE_PROJECT_DELETE = 'true';
process.env.VIKUNJA_ENABLE_LABEL_DELETE = 'true';
process.env.VIKUNJA_ENABLE_FILTER_DELETE = 'true';
