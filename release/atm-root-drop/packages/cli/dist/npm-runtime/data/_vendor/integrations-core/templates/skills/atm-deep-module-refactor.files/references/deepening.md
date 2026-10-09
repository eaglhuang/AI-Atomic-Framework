# Deepening Reference

Use this reference only after the default deep-module review identifies a real
seam question.

Dependency classes:

- `in-process`: pure computation or in-memory state. Deepen directly and test
  through the new interface.
- `local-substitutable`: dependencies with local test stand-ins. Keep the seam
  internal and test with the stand-in.
- `remote-owned`: internal network dependencies. Define a port at the seam,
  then use production and in-memory adapters.
- `true-external`: third-party systems. Inject the external dependency through
  an adapter and use a mock adapter in tests.

Seam discipline:

- One adapter is a hypothetical seam.
- Two adapters make the seam real.
- Internal seams may support implementation tests, but callers should see only
  the external interface.

Testing:

- Replace old private-internal tests once interface tests exist.
- Assert observable behavior through the interface.
- Do not layer new tests over old shallow modules.
