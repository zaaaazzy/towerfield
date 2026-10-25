/**
 * Karten-Synergien: Spielt ein Spieler in derselben Runde bestimmte Kartenpaare, bekommen seine Minions bis zum
 * Rundenende einen Bonus. Ohne Phaser, DOM und Canvas, ohne Zufall und Zeit; die Auswertung hängt nicht von der
 * Reihenfolge der gespielten Karten ab. Der Bonus ist temporär und steht nie in `LineState.bonus` oder in den Werten
 * der Minions; die Kampflogik liest ihn über `Minion.rangeBonus` (siehe `match.ts`).
 */

/** Eine in dieser Runde gespielte Karte. `line` fehlt bei Karten ohne Lane-Ziel (z. B. `line-upgrade`). */
export interface PlayedCard {
  cardId: string;
  line?: number;
  /** Bei einer Beschwörung die ID des Minions; damit lässt sich die Karte beim Zurücknehmen oder Verschieben finden. */
  minionId?: number;
}

/** `sameLine`: beide Karten treffen dieselbe Lane. `anyLine`: die Lanes sind egal, der Bonus gilt für alle Lanes. */
export type SynergyCondition = 'sameLine' | 'anyLine';

export interface SynergyModifier {
  stat: 'range';
  amount: number;
}

export interface SynergyDef {
  id: string;
  name: string;
  /** Die beiden Karten-IDs; sie dürfen gleich sein (dann braucht es zwei gespielte Karten). */
  cards: readonly [string, string];
  condition: SynergyCondition;
  modifier: SynergyModifier;
}

/** Eine aktive Synergie. `line` ist `null` bei `anyLine`: der Bonus gilt dann für alle Lanes des Spielers. */
export interface ActiveSynergy {
  id: string;
  name: string;
  line: number | null;
  modifier: SynergyModifier;
}

export const SYNERGY_DEFS: readonly SynergyDef[] = [
  {
    id: 'archer-line-upgrade',
    name: 'Fernkampf-Ausbau',
    cards: ['summon-archer', 'line-upgrade'],
    condition: 'sameLine',
    modifier: { stat: 'range', amount: 2 },
  },
];

/**
 * Lane einer Paarung oder `undefined`, wenn sie nicht zustande kommt. `sameLine`: gleiche Lane; eine Karte ohne Lane
 * (z. B. `line-upgrade`, das kein Lane-Ziel hat) passt zur Lane der anderen, zwei Karten ohne Lane haben keine.
 */
function pairLine(condition: SynergyCondition, a: PlayedCard, b: PlayedCard): number | null | undefined {
  if (condition === 'anyLine') return null;
  if (a.line === undefined) return b.line;
  if (b.line === undefined || a.line === b.line) return a.line;
  return undefined;
}

/**
 * Aktive Synergien aus den in der Runde gespielten Karten eines Spielers. Jede Synergie kommt je Lane höchstens
 * einmal vor (Wiederholungen stapeln nicht); die Reihenfolge der Karten ändert das Ergebnis nicht. Sortiert nach
 * Reihenfolge in `defs`, dann nach Lane.
 */
export function activeSynergies(played: readonly PlayedCard[], defs: readonly SynergyDef[] = SYNERGY_DEFS): ActiveSynergy[] {
  const result: ActiveSynergy[] = [];
  for (const def of defs) {
    const lines = new Set<number | null>();
    played.forEach((a, indexA) => {
      if (a.cardId !== def.cards[0]) return;
      played.forEach((b, indexB) => {
        if (indexA === indexB || b.cardId !== def.cards[1]) return;
        const line = pairLine(def.condition, a, b);
        if (line !== undefined) lines.add(line);
      });
    });
    // `null` (anyLine) ist die einzige Lane der Definition und wird nie verglichen.
    const sorted = [...lines].sort((x, y) => (x as number) - (y as number));
    for (const line of sorted) result.push({ id: def.id, name: def.name, line, modifier: { ...def.modifier } });
  }
  return result;
}

/** Kurzer Anzeigetext, z. B. „Fernkampf-Ausbau · Reichweite +2“. */
export function describeSynergy(synergy: ActiveSynergy): string {
  return `${synergy.name} · Reichweite +${synergy.modifier.amount}`;
}

/** Summe der Boni auf `stat` für Minions der Lane `line`. */
export function synergyBonus(synergies: readonly ActiveSynergy[], line: number, stat: SynergyModifier['stat']): number {
  return synergies
    .filter((s) => s.modifier.stat === stat && (s.line === null || s.line === line))
    .reduce((sum, s) => sum + s.modifier.amount, 0);
}
