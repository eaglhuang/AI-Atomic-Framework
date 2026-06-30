const DIMENSION_KEYS = ['parameter', 'type', 'language', 'quality', 'output-shape', 'behavior-variant'];

interface SanitizedSpecRecord {
  readonly dimensionValues: Record<string, unknown>;
  readonly staticContract: Record<string, unknown>;
}

export function detectPolymorphicDimensions(leftSpec: unknown, rightSpec: unknown) {
  const left = sanitizeSpec(leftSpec);
  const right = sanitizeSpec(rightSpec);

  const differences = [];

  for (const dimensionKey of DIMENSION_KEYS) {
    const leftValue = JSON.stringify(left.dimensionValues[dimensionKey] ?? null);
    const rightValue = JSON.stringify(right.dimensionValues[dimensionKey] ?? null);
    if (leftValue !== rightValue) {
      differences.push({
        dimension: dimensionKey,
        left: left.dimensionValues[dimensionKey] ?? null,
        right: right.dimensionValues[dimensionKey] ?? null
      });
    }
  }

  const explainable = differences.length > 0 && Object.keys(left.staticContract).every((key) => {
    return JSON.stringify(left.staticContract[key]) === JSON.stringify(right.staticContract[key]);
  });

  return {
    explainable,
    differences,
    staticContractStable: explainable,
    matchedDimensions: differences.map((entry) => entry.dimension)
  };
}

function sanitizeSpec(spec: unknown): SanitizedSpecRecord {
  const candidate = spec && typeof spec === 'object' ? spec : {};
  const candidateRecord = candidate as Record<string, unknown>;
  return {
    dimensionValues: candidateRecord.dimensionValues && typeof candidateRecord.dimensionValues === 'object'
      ? candidateRecord.dimensionValues as Record<string, unknown>
      : {},
    staticContract: candidateRecord.staticContract && typeof candidateRecord.staticContract === 'object'
      ? candidateRecord.staticContract as Record<string, unknown>
      : {}
  };
}

export default {
  detectPolymorphicDimensions
};
