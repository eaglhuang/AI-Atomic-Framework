const testRunnerPlugin = {
  pluginId: 'fixture-plugin',
  supports() {
    return { supported: true };
  },
  plan() {
    return {
      suites: ['host-integration'],
      evidenceSummary: 'Fixture plugin contributes one host-managed integration command.',
      commands: [
        {
          commandId: 'fixture-plugin-pass',
          commandKind: 'test',
          command: 'node --strip-types tests/test-runner-fixtures/pass-command.ts',
          required: true,
          suite: 'host-integration',
          summary: 'Plugin-provided host integration smoke.'
        }
      ]
    };
  }
};

export default testRunnerPlugin;
