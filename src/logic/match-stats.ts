/**
 * Statistik der eigenen Partie (Spieler 0): gespielte Karten pro Line und verursachter Schaden je Minion-Typ.
 * Reine Daten und Funktionen ohne Phaser, DOM und Canvas; alles bleibt serialisierbar, damit `structuredClone` genügt.
 * Der Typ eines Minions ist die Karten-ID, die ihn beschworen hat.
 */

/** Schaden einer Karten-ID, getrennt nach Ziel. */
export interface DamageStat {
  minionDamage: number;
  towerDamage: number;
}

export interface MatchStats {
  /** Karten-ID → Anzahl gespielter Beschwörungen je Line (Index = Line). */
  played: Record<string, number[]>;
  /** Karten-ID → verursachter Schaden. */
  damage: Record<string, DamageStat>;
  /** Minion-ID → Karten-ID; bleibt über Runden erhalten (`PlayerState.placements` wird pro Runde geleert). */
  cardByMinion: Record<number, string>;
}

export function createStats(): MatchStats {
  return { played: {}, damage: {}, cardByMinion: {} };
}

/** Zählt eine Beschwörung von `cardId` auf `line` und merkt sich die Zuordnung der Minion-ID. */
export function recordSummon(stats: MatchStats, minionId: number, cardId: string, line: number): void {
  stats.cardByMinion[minionId] = cardId;
  addPlayed(stats, cardId, line, 1);
}

/** Nimmt eine Beschwörung zurück. */
export function recordUndo(stats: MatchStats, minionId: number, line: number): void {
  const cardId = stats.cardByMinion[minionId];
  if (cardId === undefined) return;
  addPlayed(stats, cardId, line, -1);
  delete stats.cardByMinion[minionId];
}

/** Verschiebt die Zählung eines Minions von `fromLine` auf `toLine`. */
export function recordMove(stats: MatchStats, minionId: number, fromLine: number, toLine: number): void {
  const cardId = stats.cardByMinion[minionId];
  if (cardId === undefined || fromLine === toLine) return;
  addPlayed(stats, cardId, fromLine, -1);
  addPlayed(stats, cardId, toLine, 1);
}

/** Rechnet Schaden eines Minions dem Kartentyp zu; unbekannte Minion-IDs werden ignoriert. */
export function recordDamage(stats: MatchStats, minionId: number, kind: 'minion' | 'tower', amount: number): void {
  const cardId = stats.cardByMinion[minionId];
  if (cardId === undefined || !(amount > 0)) return;
  const entry = (stats.damage[cardId] ??= { minionDamage: 0, towerDamage: 0 });
  if (kind === 'minion') entry.minionDamage += amount;
  else entry.towerDamage += amount;
}

/** Kurzbilanz für den Abschlussbildschirm; fasst nur bestehende Werte zusammen. */
export interface StatsSummary {
  /** Alle gespielten Beschwörungen. */
  summoned: number;
  /** Gesamtschaden an Minions und an Towern (gerundet). */
  minionDamage: number;
  towerDamage: number;
  /** Karten-ID mit dem meisten Gesamtschaden (bei Gleichstand die zuerst erfasste), `null` ohne Schaden. */
  topCardId: string | null;
}

export function summarizeStats(stats: MatchStats): StatsSummary {
  let summoned = 0;
  for (const counts of Object.values(stats.played)) for (const count of counts) summoned += count;
  let minionDamage = 0;
  let towerDamage = 0;
  let topCardId: string | null = null;
  let top = 0;
  for (const [cardId, entry] of Object.entries(stats.damage)) {
    minionDamage += entry.minionDamage;
    towerDamage += entry.towerDamage;
    const total = entry.minionDamage + entry.towerDamage;
    if (total > top) {
      top = total;
      topCardId = cardId;
    }
  }
  return { summoned, minionDamage: Math.round(minionDamage), towerDamage: Math.round(towerDamage), topCardId };
}

function addPlayed(stats: MatchStats, cardId: string, line: number, delta: number): void {
  const counts = (stats.played[cardId] ??= []);
  for (let index = counts.length; index <= line; index += 1) counts.push(0);
  counts[line] = Math.max(0, counts[line]! + delta);
}
