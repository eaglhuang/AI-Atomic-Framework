import type { AtomLifecycleModeValue } from './lifecycle';

export type EffectNodeMode = 'dry-run' | 'apply';

export interface EffectNodeContext<Input = unknown> {
  readonly repositoryRoot: string;
  readonly atomId: string;
  readonly lifecycleMode: AtomLifecycleModeValue;
  readonly executionMode: EffectNodeMode;
  readonly input: Input;
}

export interface EffectNodeResult {
  readonly ok: boolean;
  readonly executionMode: EffectNodeMode;
  readonly appliedChanges: boolean;
  readonly artifactPaths: readonly string[];
  readonly messages: readonly string[];
}

export interface EffectNode<Input = unknown, Result extends EffectNodeResult = EffectNodeResult> {
  readonly nodeKind: 'effect';
  readonly nodeName: string;
  readonly defaultMode: 'dry-run';
  readonly applyFlag: '--apply';
  run(context: EffectNodeContext<Input>): Promise<Result> | Result;
}

export interface ExecuteAgentTaskInput {
  readonly promptPath: string;
  readonly allowedFiles: readonly string[];
  readonly validationCommands: readonly string[];
}

export type ExecuteAgentTaskEffectNode = EffectNode<ExecuteAgentTaskInput>;