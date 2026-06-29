# @ai-atomic-framework/language-csharp

Reference C# language adapter for ATM.

This package provides:

- repository profile detection for `.csproj` / `.sln` hosts;
- C# import and entrypoint scanning;
- compute atom validation with policy-driven forbidden import checks;
- mandatory adapter-native `fast` / `default` / `all` static-check plans.

## Static Check Tiers

- `fast` runs `dotnet build --no-restore` as the broadest cheap syntax/type/build gate.
- `default` combines `dotnet build --no-restore` with `dotnet format --verify-no-changes`.
- `all` stays static-only and currently matches the full declared C# static set.

## Tooling

The reference C# static gate expects a recent .NET SDK with:

- `dotnet build`
- `dotnet format`

On modern SDK releases `dotnet format` ships with the SDK, so a separate global
tool install is usually unnecessary. If a host image lacks it, install or
upgrade the .NET SDK before relying on the C# static gate.
