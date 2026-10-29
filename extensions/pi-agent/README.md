# Agent Workspace for Agent coding

This built-in extension provides the multi-model Agent workspace in the secondary side bar.

## Commands

- `Agent: Open Agent`
- `Agent: Set Provider API Key`
- `Agent: New Session`
- `Agent: Stop Current Run`

## Settings

- `piAgent.provider`
- `piAgent.model`
- `piAgent.baseUrl`
- `piAgent.requireApproval`

API keys are stored in the editor's secure secret store. They are not written to settings.

## Tests

```bash
npm test
```

