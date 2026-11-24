export function cacheValue<T>(cache: Map<string, T>, key: string, value: T, capacity: number): void {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > capacity) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}
