import Phaser from 'phaser';
import { parseReplaySeed } from './logic/seed';
import { MainScene, VIEW } from './scenes/main-scene';
import { ReplayScene } from './scenes/replay-scene';

function startGame(scenes: Phaser.Types.Scenes.SceneType[]): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: VIEW.width,
    height: VIEW.height,
    backgroundColor: '#10141f',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: scenes,
  });
}

// Für den Smoke-Test und die Fehlersuche in der Browser-Konsole.
declare global {
  interface Window {
    game?: Phaser.Game;
  }
}

// Mit gültigem `?replay=<seed>` startet die Replay-Szene zuerst (Dev und Produktion); sonst bleibt alles wie bisher.
const replay = parseReplaySeed(window.location.search) !== null;

if (import.meta.env.DEV) {
  // Dev-Szene: nur im Entwicklungsserver registriert (im Produktions-Build entfällt der Zweig samt Import).
  void import('./scenes/balance-scene').then(({ BalanceScene }) => {
    const balance = new URLSearchParams(window.location.search).get('scene') === 'balance';
    // Die erste Szene der Liste startet automatisch.
    const scenes = replay
      ? [ReplayScene, MainScene, BalanceScene]
      : balance
        ? [BalanceScene, MainScene]
        : [MainScene, BalanceScene];
    window.game = startGame(scenes);
  });
} else {
  window.game = startGame(replay ? [ReplayScene, MainScene] : [MainScene]);
}
