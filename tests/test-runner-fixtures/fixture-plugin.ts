const testRunnerPlugin = {
  pluginId: 'fixture-plugin',
  supports() {
    return { supported: true };
  },
  plan(context: any) {
    return {
      suites: ['host-integration'],
      profile: context.profile,
      family: 'host-integration',
      dedupeKeys: ['integration:host:fixture'],
      costBudgetMs: 5000,
      evidenceSummary: 'Fixture plugin contributes one host-managed integration command.',
      commands: [
        {
          commandId: 'fixture-plugin-pass',
          commandKind: 'test',
          command: 'node --strip-types tests/test-runner-fixtures/pass-command.ts',
          required: true,
          suite: 'host-integration',
          key: 'integration.host.fixture.pass',
          family: 'host-integration',
          tiers: ['quick', 'standard'],
          dedupeKeys: ['integration:host:fixture'],
          costBudgetMs: 5000,
          summary: 'Plugin-provided host integration smoke.'
        }
      ]
    };
  }
};

export default testRunnerPlugin;
