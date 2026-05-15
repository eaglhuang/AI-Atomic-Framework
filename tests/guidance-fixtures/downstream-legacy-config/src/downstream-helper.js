export function processRequest(req, context) {
  const payload = normalizePayload(req.body, context.schema);
  const validated = validateSchema(payload, context.schema);
  const result = applyTransform(validated, context.transform);
  const formatted = buildResponse(result, context.format);
  const logged = logAccess(formatted, context.requestId);
  return logged;
}

export function normalizePayload(body, schema) {
  if (!body) return schema.defaultPayload;
  return Object.assign({}, schema.defaultPayload, body);
}

export function validateSchema(payload, schema) {
  const keys = Object.keys(schema.required || {});
  for (const key of keys) {
    if (payload[key] === undefined) {
      throw new Error(`Missing required field: ${key}`);
    }
  }
  return payload;
}

export function applyTransform(payload, transform) {
  return transform.apply(payload);
}

export function buildResponse(result, format) {
  return { ok: true, data: format.serialize(result) };
}

export function logAccess(response, requestId) {
  return Object.assign({}, response, { requestId });
}
