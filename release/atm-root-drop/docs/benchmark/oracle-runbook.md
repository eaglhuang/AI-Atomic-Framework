# Sealed corpus and blinded adjudication runbook

Create a corpus commitment before any run. It seals public prompts and hidden
oracle labels separately and records all six scenario classes. Pilot corpus IDs
cannot enter the formal holdout. Keep private labels in external,
digest-addressed storage; Git contains only the public manifest and method.

An operator receives a blind assignment containing a prompt digest and no
labels. After execution, bind the output digest to an adjudication input. Only
a separate adjudicator applies the frozen rubric. Record rubric version,
confidence and disagreement. Leaked sentinels, missing output digests and
self-adjudication fail closed; new keys or accounts do not upgrade independence.
