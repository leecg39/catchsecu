export const isReservedQueryKey = (key: string) => ["__proto__", "prototype", "constructor"].includes(key);
