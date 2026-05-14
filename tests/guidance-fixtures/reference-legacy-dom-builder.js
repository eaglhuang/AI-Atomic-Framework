export function processElement(node, context) {
  const color = parseColorToken(node.style?.color, context.theme);
  const type = applyTypographyScale(node.text, context.typeScale);
  const fragment = parseFragmentDescriptor(node.fragment, context.registry);
  const tabs = deriveTabSemantics(node.tabs, context.locale);
  const attrs = normalizeAttributeBag(node.attributes);
  return buildNeutralElementView({ color, type, fragment, tabs, attrs });
}

export function parseColorToken(rawColor, theme) {
  if (!rawColor) return theme.defaultColor;
  return theme.palette[String(rawColor).trim()] ?? rawColor;
}

export function applyTypographyScale(text, typeScale) {
  return {
    text: String(text ?? ''),
    fontSize: typeScale.body,
    lineHeight: typeScale.bodyLineHeight
  };
}

export function parseFragmentDescriptor(fragment, registry) {
  if (!fragment) return null;
  const key = String(fragment.kind ?? 'unknown');
  return registry[key] ?? { kind: key, slots: [] };
}

export function deriveTabSemantics(tabs, locale) {
  return (tabs ?? []).map((tab, index) => ({
    id: tab.id ?? `tab-${index + 1}`,
    label: String(tab.label ?? '').toLocaleLowerCase(locale),
    selected: tab.selected === true
  }));
}

export function normalizeAttributeBag(attributes) {
  return Object.fromEntries(Object.entries(attributes ?? {}).filter(([, value]) => value !== null && value !== undefined));
}

export function buildNeutralElementView(parts) {
  return {
    kind: 'neutral-element-view',
    parts
  };
}