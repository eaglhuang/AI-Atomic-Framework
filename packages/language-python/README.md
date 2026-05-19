# @ai-atomic-framework/language-python

Reference Python language adapter for ATM.

Python-only adopters do not need `package.json`. This adapter:

- detects Python project profiles from `pyproject.toml`, `requirements.txt`, `setup.py`, `setup.cfg`, `Pipfile`, and `poetry.lock`;
- discovers Python entrypoints from scripts, `if __name__ == "__main__"`, `__main__.py`, pipeline folders, and `[project.scripts]` declarations;
- describes test, typecheck, and lint commands as delegated project commands;
- emits a dry-run atomize/infect plan that lists candidate units without mutating host files.

The adapter is deliberately static. It does not execute Python code, install packages, or shell out to host tooling.

## Surface

- `pythonLanguageAdapterPackage` - package identity constant.
- `createPythonLanguageAdapter()` - adapter factory returning the `LanguageAdapter` shape.
- `detectPythonProjectProfile(repositoryRoot)` - read project metadata, detect package manager, and build delegated test command contracts.
- `scanPythonEntrypoints(sourceFile)` - list module-level entry signatures from a single source file.
- `planPythonAtomize(request)` - return a `PythonAtomizePlan` dry-run record describing the candidate unit, source location, suggested atom shape, and risk hints.
- `defaultPythonImportPolicy` - opinionated baseline list of forbidden top-level imports (none by default; hosts can extend).

The adapter never mutates host files. Apply-phase contracts live in higher layers and require evidence, reversible patch plans, and police reports before they take effect.
