// PURE object helpers shared by islands and stores.

/** A deep copy (`structuredClone`) of a plain JSON-like value. */
export const clone = <T>(value: T): T => structuredClone(value);

/** `o` without `key` (a shallow copy). */
export const omit = <T extends object, K extends keyof T>(o: T, key: K): Omit<T, K> => {
  const { [key]: _removed, ...rest } = o;
  return rest;
};
