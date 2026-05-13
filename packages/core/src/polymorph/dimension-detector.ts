const DIMENSION_KEYS = ['parameter', 'type', 'language', 'quality', 'output-shape', 'behavior-variant'];

export function detectPolymorphicDimensions(leftSpec: any, rightSpec: any) {
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

function sanitizeSpec(spec: any) {
  const candidate = spec && typeof spec === 'object' ? spec : {};
  return {
    dimensionValues: candidate.dimensionValues && typeof candidate.dimensionValues === 'object'
      ? candidate.dimensionValues
      : {},
    staticContract: candidate.staticContract && typeof candidate.staticContract === 'object'
      ? candidate.staticContract
      : {}
  };
}

export default {
  detectPolymorphicDimensions
};
