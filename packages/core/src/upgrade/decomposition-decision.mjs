const DECISION_BY_BEHAVIOR = new Map([
  ['behavior.atomize', 'atomize'],
  ['behavior.infect', 'infect'],
  ['behavior.polymorphize', 'polymorphize'],
  ['behavior.compose', 'extract-shared']
]);

const STRICT_DECISION_BEHAVIOR = new Map([
  ['polymorphize', 'behavior.polymorphize'],
  ['extract-shared', 'behavior.compose'],
  ['infect', 'behavior.infect'],
  ['atomize', 'behavior.atomize']
]);

const REVIEW_TEMPLATE_BY_DECISION = {
  'atom-bump': 'review.template.atom-bump',
  'atom-extract': 'review.template.atom-extract',
  'map-bump': 'review.template.map-bump',
  polymorphize: 'review.template.polymorphize',
  'extract-shared': 'review.template.extract-shared',
  infect: 'review.template.infect',
  atomize: 'review.template.atomize'
};

export const VALID_DECOMPOSITION_DECISIONS = [
  'atom-bump',
  'atom-extract',
  'map-bump',
  'polymorphize',
  'extract-shared',
  'infect',
  'atomize'
];

export function deriveDecompositionDecision({ behaviorId, targetKind }) {
  if (targetKind === 'map') {
    return 'map-bump';
  }
  return DECISION_BY_BEHAVIOR.get(behaviorId) ?? 'atom-bump';
}

export function resolveReviewTemplate(decompositionDecision) {
  return REVIEW_TEMPLATE_BY_DECISION[decompositionDecision] ?? 'review.template.general';
}

export function validateDecisionBehaviorPair({ behaviorId, decompositionDecision }) {
  const strictBehaviorId = STRICT_DECISION_BEHAVIOR.get(decompositionDecision);
  if (strictBehaviorId && behaviorId !== strictBehaviorId) {
    throw new Error(`decompositionDecision ${decompositionDecision} must pair with ${strictBehaviorId}.`);
  }

  if (behaviorId === 'behavior.infect' && decompositionDecision !== 'infect') {
    throw new Error('behavior.infect proposals must use infect decompositionDecision.');
  }

  if (behaviorId === 'behavior.atomize' && decompositionDecision !== 'atomize' && decompositionDecision !== 'atom-extract') {
    throw new Error('behavior.atomize proposals must use atomize or atom-extract decompositionDecision.');
  }

  if (behaviorId === 'behavior.polymorphize' && decompositionDecision !== 'polymorphize') {
    throw new Error('behavior.polymorphize proposals must use polymorphize decompositionDecision.');
  }
}
