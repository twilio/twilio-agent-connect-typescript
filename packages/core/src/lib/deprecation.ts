const warned = new Set<string>();

/**
 * Warn once per deprecated name that a renamed API is still being used.
 *
 * Mirrors the Python SDK's module-level `__getattr__` shim, which warns on
 * *every* access and never caches the resolved attribute — repeats are
 * suppressed by Python's default warning filter, which dedupes per attributed
 * `(module, line)` call site. TypeScript has no warning-filter equivalent, so
 * this helper dedupes globally per deprecated name: a coarser policy that
 * reports only the first offending call site in the process.
 *
 * TypeScript also has no `__getattr__` hook, so runtime values call this
 * explicitly; renamed *types* are erased at compile time and rely on
 * `@deprecated` tags instead.
 */
export function warnDeprecated(oldName: string, replacement: string): void {
  if (warned.has(oldName)) return;
  warned.add(oldName);
  console.warn(`${oldName} is deprecated and will be removed in 3.0 — use ${replacement} instead.`);
}
