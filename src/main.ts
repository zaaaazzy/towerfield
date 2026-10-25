import Phaser from 'phaser';
import { MainScene, VIEW } from './scenes/main-scene';

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

if (import.meta.env.DEV) {
  // Dev-Szene: nur im Entwicklungsserver registriert (im Produktions-Build entfällt der Zweig samt Import).
  void import('./scenes/balance-scene').then(({ BalanceScene }) => {
    const balance = new URLSearchParams(window.location.search).get('scene') === 'balance';
    // Die erste Szene der Liste startet automatisch.
    window.game = startGame(balance ? [BalanceScene, MainScene] : [MainScene, BalanceScene]);
  });
} else {
  window.game = startGame([MainScene]);
}
