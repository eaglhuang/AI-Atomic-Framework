import assert from 'node:assert/strict';
import type {
  ExternalTaskSourcePlugin,
  ExternalTaskSourceInput,
  ParsedExternalTask,
  ExternalTaskValidationResult,
  ExternalTaskGenerationIntent,
  GeneratedExternalTaskCard,
  CapabilityKind
} from '../../packages/plugin-sdk/src/index.ts';

// 1. Verify interface can be implemented (mock implementation)
class MockExternalTaskSourcePlugin implements ExternalTaskSourcePlugin {
  readonly kind = 'external-task-source';
  readonly id = 'mock-task-source-plugin';
  readonly version = '1.0.0';

  // Make sure hooks are optional and can be defined
  async parse(input: ExternalTaskSourceInput): Promise<ParsedExternalTask | null> {
    return {
      taskId: 'TASK-MOCK-0001',
      frontmatter: { title: 'Mock Task', status: 'planned' },
      body: 'Mock body content',
      sourcePath: input.sourcePath
    };
  }

  async validate(parsed: ParsedExternalTask): Promise<ExternalTaskValidationResult> {
    assert.equal(parsed.taskId, 'TASK-MOCK-0001');
    return {
      ok: true,
      diagnostics: []
    };
  }

  async generate(intent: ExternalTaskGenerationIntent): Promise<GeneratedExternalTaskCard> {
    return {
      taskId: 'TASK-MOCK-0001',
      sourcePath: 'tasks/mock-task.md',
      content: `Title: ${intent.fields.title}\nCwd: ${intent.cwd}`
    };
  }
}

// 2. Minimal mock implementation to verify all hooks are indeed optional
class MinimalMockPlugin implements ExternalTaskSourcePlugin {
  readonly kind = 'external-task-source';
  readonly id = 'minimal-mock-plugin';
  readonly version = '1.0.0';
  // Note: no hooks defined, which is perfectly valid
}

// 3. Verify CapabilityKind can contain 'external-task-source'
const cap: CapabilityKind = 'external-task-source';

// Run basic assertions to verify instantiation and exports
const mock = new MockExternalTaskSourcePlugin();
assert.equal(mock.kind, 'external-task-source');
assert.equal(mock.id, 'mock-task-source-plugin');
assert.equal(mock.version, '1.0.0');

const minimal = new MinimalMockPlugin();
assert.equal(minimal.kind, 'external-task-source');
assert.equal((minimal as ExternalTaskSourcePlugin).parse, undefined);
assert.equal((minimal as ExternalTaskSourcePlugin).validate, undefined);
assert.equal((minimal as ExternalTaskSourcePlugin).generate, undefined);

assert.equal(cap, 'external-task-source');

console.log('[external-task-source:test] ok (all interface constraints verified)');
