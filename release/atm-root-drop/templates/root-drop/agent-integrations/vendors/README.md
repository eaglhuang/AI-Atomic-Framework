# Vendor Config Layout

Put adopter-local Team vendor configuration under `agent-integrations/vendors/`.

Suggested layout:

- `agent-integrations/vendors/default.json`
- `agent-integrations/vendors/openai.json`
- `agent-integrations/vendors/azure-openai.json`
- `agent-integrations/vendors/claude-code.json`
- `agent-integrations/vendors/gemini.json`
- `agent-integrations/vendors/microsoft-foundry.json`

The framework validates layout and explains missing config, but does not store real secrets in the framework repository.
