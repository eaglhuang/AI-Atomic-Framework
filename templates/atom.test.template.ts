/**
 * {{atomId}} scaffold test stub.
 * Generated in {{workbenchPathJson}}.
 */

export const atomSpecPath = {{specRelativePathJson}};

export function describeScaffoldedAtom() {
  return {
    atomId: {{atomIdJson}},
    title: {{titleJson}},
    specPath: atomSpecPath,
    generatedTestPath: {{testRelativePathJson}}
  } as const;
}