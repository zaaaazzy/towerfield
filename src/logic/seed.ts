/**
 * Fester Seed aus der URL (`?seed=123`), damit Browser-Tests reproduzierbar sind. Ohne Ziffern oder bei ungültigem Wert
 * kommt `null` zurück, dann wählt die Szene selbst einen Seed.
 */
export function parseSeed(search: string): number | null {
  const value = new URLSearchParams(search).get('seed');
  if (value === null || !/^\d{1,15}$/.test(value)) return null;
  return Number(value) >>> 0;
}
