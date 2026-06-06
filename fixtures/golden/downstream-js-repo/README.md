# Downstream JS Repo Fixture

This fixture represents a neutral downstream JavaScript repository that does not depend on ATM seed internals.

The validator overlays the ATM root-drop release bundle onto this repository and verifies that bootstrap, doctor, and next work without requiring ATM self-description files to be the host project's primary entrypoint.
