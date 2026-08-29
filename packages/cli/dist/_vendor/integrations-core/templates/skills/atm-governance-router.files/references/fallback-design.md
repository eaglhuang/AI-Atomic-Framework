# Fallback Design Lessons

Use this shard when the preferred route failed and the agent needed a governed
fallback without inventing a weaker parallel workflow.

Seed capture targets:

- tool-first path failed and the CLI fallback contract was unclear
- a manual shell workaround looked easier than the governed ATM fallback
- the agent almost widened scope because a narrower recovery command was not
  surfaced early enough

Durable rule: a blocked structured tool result is route truth. Surface the
status, reason, notices, allowed commands, and blocked commands before using the
official CLI fallback named by ATM. Do not invent an unlisted shell workaround
to make the route appear unblocked.

When the first real lesson lands here, keep the entry short:

- Trigger
- Symptom
- Correct ATM route
- Durable rule
