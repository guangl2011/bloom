# Bloom skill assets (v1.0)

Versioned skill definitions for the six agents (PRD §9 `skills/`, spec D3).
One skill per agent in v1.0; an agent can gain more skills in later versions
without interface changes.

```
skills/
  <agent-id>/            # one of the six spec agents
    <skill-name>/        # versioned skill (vN suffix)
      skill.json         # manifest: name, agentId, version, typed schemas, promptFile
      prompt.md          # the skill prompt — behavior + hard boundary
```

## Conventions

- `agentId` must be one of the six spec agents (validated by
  `@bloom/interfaces` `isAgentId` — a typo fails the loader, not production).
- `inputSchema` / `outputSchema` use the shared typed-schema format: every
  field carries `type`, `description`, and `required`. Agents validate
  untrusted input against the input schema and their own output against the
  output schema before returning.
- Prompts state the agent's hard boundary verbatim from the spec table — the
  boundary is enforced in code (ApprovalInterface + tool contracts); the
  prompt restates it for the human reviewing the skill.
- Skills are versioned assets: changes ship as a new version entry in the
  manifest history, never as silent edits (spec D7 discipline).
