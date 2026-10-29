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

/**
 * Rohe Zugdaten des Replays (`&moves=...`) oder `null`, wenn der Parameter fehlt. Ein leerer oder fehlerhafter Wert
 * kommt unverändert zurück; geprüft wird er erst von `decodeMatch`, damit er als ungültig gemeldet werden kann.
 */
export function parseReplayMoves(search: string): string | null {
  return new URLSearchParams(search).get('moves');
}

/** Schnellvorlauf (`?fast=1`): Banner und Abschluss-Einblendung entfallen, damit E2E-Tests nicht warten. */
export function parseFast(search: string): boolean {
  const value = new URLSearchParams(search).get('fast');
  return value !== null && value !== '' && value !== '0';
}

function parseSeedParam(search: string, name: string): number | null {
  const value = new URLSearchParams(search).get(name);
  if (value === null || !/^\d{1,15}$/.test(value)) return null;
  return Number(value) >>> 0;
}
