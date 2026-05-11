# Adopter-Local Workbench Localization

This note records the neutral upstream boundary for project-derived atom artifacts.

The framework repository keeps schemas, validators, runners, synthetic fixtures, and neutral framework dogfood atoms. Project-derived atom and map capsules belong in the adopter-local workbench that owns the source lineage and runtime evidence.

Migration rule:

- Keep historical ids stable when an adopter localizes an artifact set.
- Store adopter lineage, runtime evidence, reports, and map capsules in the adopter repository.
- Keep upstream registry and workbench surfaces free of adopter names, local absolute paths, and adopter source paths.
- Use shared upstream catalog entries only after an artifact becomes project-neutral and reusable across adopters.
