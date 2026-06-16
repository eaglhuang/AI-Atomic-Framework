function localOnly(value: string): string {
  function nested(inner: string): string {
    return inner.toUpperCase();
  }
  return nested(value);
}

async function localAsync(): Promise<void> {
  const text = 'braces in strings { should not } confuse the counter';
  await Promise.resolve(text);
}

const unusedValue = localOnly('demo');
void localAsync();
void unusedValue;
