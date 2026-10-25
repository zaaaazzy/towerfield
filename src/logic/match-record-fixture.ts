/**
 * Testhilfe für `match-record.test.ts` und `replay.test.ts`: spielt ein vollständiges Match, in dem Spieler 0 wie ein
 * Mensch zieht (spielen, verschieben, zurücknehmen, bereit) und der Bot per `botPlanRecorded` mitschreibt.
 */
import { getCardDef } from './cards';
import { advance, createMatch, LINE_COUNT, type MatchState } from './match';
import {
  type ActionBody,
  botPlanRecorded,
  createRecord,
  performAction,
  type RecordedMatch,
} from './match-record';

export interface PlayedMatch {
  state: MatchState;
  record: RecordedMatch;
}

/** Spielt `seed` bis zum Ende und zeichnet dabei alle Aktionen beider Spieler auf. */
export function playScriptedMatch(seed: number): PlayedMatch {
  let state = createMatch(seed);
  let record = createRecord(seed);
  const act = (body: ActionBody): boolean => {
    const outcome = performAction(state, record, 0, body);
    state = outcome.result.state;
    record = outcome.record;
    return outcome.result.ok;
  };
  for (let guard = 0; guard < 1000 && state.phase !== 'over'; guard += 1) {
    if (state.phase === 'planning') {
      for (const cardId of [...state.players[0].hand]) {
        const def = getCardDef(cardId);
        act({ type: 'play', cardId, line: def.target === 'line' ? state.round % LINE_COUNT : null });
      }
      const placements = state.players[0].placements;
      if (placements.length > 0) {
        act({ type: 'move', minionId: placements[0]!.minionId, line: (state.round + 1) % LINE_COUNT, slot: 0 });
      }
      if (state.round % 2 === 0 && placements.length > 1) {
        act({ type: 'undo', minionId: placements[placements.length - 1]!.minionId });
      }
      act({ type: 'ready' });
      const planned = botPlanRecorded(state, record, 1);
      state = planned.state;
      record = planned.record;
    } else {
      state = advance(state, 1000);
    }
  }
  return { state, record };
}
