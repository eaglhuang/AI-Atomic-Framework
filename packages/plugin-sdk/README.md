# @ai-atomic-framework/plugin-sdk

Plugin SDK defines replaceable governance capability interfaces for task cards, rules, evidence, artifacts, logs, summaries, context budget policy, and adapters.

ATM-2 finalized the interface layer for project adapters, language adapters, lifecycle hooks, injector plugins, capability descriptors, and governance stores. Runtime packages should depend on these contracts instead of copying local adapter shapes.

Language adapters now also expose mandatory fast/default/all static-check
selectors through the SDK so CLI and governance layers can ask the adapter for
its native static path instead of hardcoding tool assumptions per language.
