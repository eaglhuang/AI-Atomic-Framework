# create-atm

`create-atm` creates an ATM governance framework starter project. ATM is a governance framework for AI-assisted engineering: it scopes work, locks edits, renders rule context, validates deterministic gates, and records evidence.

## Usage

```bash
npx create-atm test-app --agent claude-code
```

The command creates `test-app`, runs `atm bootstrap`, renders `.atm/memory/atm-chart.md`, and installs the requested agent pack. Agent packs are opt-in; running without `--agent` initializes the ATM project and rule chart only.

```bash
npx create-atm test-app
```

This package is intentionally a thin onboarding wrapper around the official ATM CLI. It does not replace root-drop, onefile, or source-tree ATM routing.