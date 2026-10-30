import { botStep } from '../src/logic/bot.ts';
import { strategiesForSeed } from '../src/logic/balance-sim.ts';
import { advance, COMBAT_TICKS, createMatch, setReady } from '../src/logic/match.ts';
import { TICK_MS } from '../src/logic/combat.ts';

const groups = new Map();
const add = (key, win) => {
  const g = groups.get(key) ?? { n: 0, w: 0 };
  g.n += 1;
  g.w += win ? 1 : 0;
  groups.set(key, g);
};
for (let seed = 1; seed <= 1000; seed += 1) {
  const strategies = strategiesForSeed(seed);
  let state = createMatch(seed);
  const spec = [false, false];
  for (let step = 0; step < 32 && state.phase !== 'over'; step += 1) {
    if (state.phase === 'planning') {
      for (const i of [0, 1]) {
        for (let m = botStep(state, i, strategies[i]); m; m = botStep(state, i, strategies[i])) {
          if (m.cardId === 'tower-lightning' || m.cardId === 'tower-shield') spec[i] = true;
          state = m.state;
        }
        state = setReady(state, i);
      }
    } else state = advance(state, COMBAT_TICKS * TICK_MS);
  }
  for (const i of [0, 1]) {
    const win = state.outcome === (i === 0 ? 'player0' : 'player1');
    const p = state.players[i];
    const bought2 = p.lines.slice(1).some((l) => l.bought);
    add(`bought L2+ lane=${bought2}`, win);
    add(`bought=${bought2} spec=${spec[i]}`, win);
    add(`level=${p.level}`, win);
    add(`lanes=${p.lines.filter((l) => l.bought).length}`, win);
  }
}
for (const [k, g] of [...groups].sort()) console.log(k.padEnd(32), String(g.n).padStart(5), ((g.w / g.n) * 100).toFixed(1) + ' %');
