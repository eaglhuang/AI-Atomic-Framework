# Ecosystem Positioning

AI-Atomic-Framework occupies the governance layer for AI-assisted engineering. It is designed to work with other tools rather than replace them.

## Positioning Summary

| System or practice | Primary focus | ATM relationship |
| --- | --- | --- |
| Atomic Agents | Building agents from small reusable components. | ATM can govern the work that creates, changes, validates, and releases those components. |
| Specification-Driven Development | Driving implementation from explicit specs. | ATM can store atomic specs, lock their scope, preserve evidence, and validate changes against contract boundaries. |
| Harness Engineering | Turning engineering quality into repeatable sensors and gates. | ATM provides the work envelope, evidence model, artifact trail, and plugin boundary for those gates. |
| LangGraph | Orchestrating stateful agent workflows. | ATM can be called by a LangGraph node or can preserve evidence from a LangGraph workflow; it is not a workflow engine itself. |
| CI systems | Running repository checks after commits or pull requests. | ATM can produce structured evidence before CI and consume CI results as evidence after CI runs. |
| Issue trackers | Tracking human-visible work state. | ATM can use an issue tracker through an adapter while preserving core work item contracts. |

## What ATM Adds

ATM adds a common governance vocabulary:

- Work is represented as focused atomic units.
- Scope is locked before changes are made.
- Rules and validation results are recorded as evidence.
- Generated files and logs are preserved as artifacts.
- Context is summarized for handoff instead of being repeatedly expanded.
- Host-specific behavior is isolated behind adapters.
- Optional capabilities are installed as plugins.

## What ATM Does Not Replace

ATM does not replace agent frameworks, workflow engines, CI, package managers, issue trackers, language servers, or human review. It gives those systems a shared governance contract so AI-assisted changes remain inspectable and recoverable.

## Core vs Adapter vs Plugin

Core defines the durable contracts. Plugins implement replaceable governance capabilities. Adapters connect those capabilities to a specific host. A downstream project can use the official Default Governance Bundle, replace one plugin at a time, or map ATM contracts onto existing systems through adapters.

This separation keeps ATM suitable for open source use while still letting mature engineering teams adopt only the parts they need.