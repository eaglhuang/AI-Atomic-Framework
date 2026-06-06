import type { CapabilityDescriptor, CapabilityResult } from './capability';
import type { AtomLifecycleHooks, AtomLifecycleModeValue } from './lifecycle';

export interface InjectorPluginContext<HostContext = unknown> {
  readonly repositoryRoot: string;
  readonly lifecycleMode: AtomLifecycleModeValue;
  readonly hostContext: HostContext;
}

export interface InjectorPlugin<HostContext = unknown> {
  readonly pluginName: string;
  readonly capabilities: readonly CapabilityDescriptor[];
  readonly lifecycle: AtomLifecycleHooks;
  inject(context: InjectorPluginContext<HostContext>): Promise<CapabilityResult> | CapabilityResult;
}