export const sum = (left: number, right: number): number => left + right;

export const double = (value: number) => {
  return value * 2;
};

export const fetchJson = async (url: string) => {
  const body = await Promise.resolve(url);
  return { body };
};

const internalHelper = (value: string) => value.trim();

export const useHelper = (value: string) => internalHelper(value);
