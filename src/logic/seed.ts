/**
 * Fester Seed aus der URL (`?seed=123`), damit Browser-Tests reproduzierbar sind. Ohne Ziffern oder bei ungültigem Wert
 * kommt `null` zurück, dann wählt die Szene selbst einen Seed.
 */
export function parseSeed(search: string): number | null {
  return parseSeedParam(search, 'seed');
}

/** Seed des Replays aus der URL (`?replay=123`), gleiche Prüfung wie bei `parseSeed`; sonst `null`. */
export function parseReplaySeed(search: string): number | null {
  return parseSeedParam(search, 'replay');
}

function parseSeedParam(search: string, name: string): number | null {
  const value = new URLSearchParams(search).get(name);
  if (value === null || !/^\d{1,15}$/.test(value)) return null;
  return Number(value) >>> 0;
}
