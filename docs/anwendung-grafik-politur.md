# Anwendung: Grafik-Politur mit Juice, Palette und Screenshot-Prüfung

Reine Darstellungsänderung. Keine neuen Spielregeln, keine Änderung an Balance oder Kampfergebnis; Phaser bleibt bei
Version 3.90. Palette, Assets und Lizenzen stehen auch in [grafik-stil.md](grafik-stil.md).

## Feedback-Regeln (`src/logic/juice.ts`, Test `juice.test.ts`)

Reine Funktionen ohne Phaser, DOM und Canvas. Eingabe sind die `FxEvent`s aus `diffFx`. Zeiten laufen nur über `delta`,
Zufall gibt es nicht (das Wackeln ist eine Funktion der verstrichenen Zeit).

| Ereignis | Shake (Stärke / ms) | Hit-Stop | Blitz | Aberration |
| --- | --- | --- | --- | --- |
| normaler Minion-Treffer | – (nur Squash & Partikel) | – | – | – |
| `tower-damage` | 0,2 bis 0,35 / 140 | 30 ms | – | – |
| `minion-death` | 0,15 / 110 | 35 ms | – | – |
| `explosion` | 0,6 bis 1 (nach Radius) / 300 | 90 ms | 0,45 | 0,5 |
| `tower-down` | 0,8 / 380 | 120 ms | 0,4 | 0,7 |
| `match-over` | 0,5 / 420 | 150 ms | 0,55 | – |

- **Hit-Stop betrifft nur die Darstellung.** `stepJuice` liefert `displayDeltaMs` (= `delta` minus Hit-Stop); die Szene
  nutzt es für Minion-Animation und Lichtschicht. `advance(state, delta)` der Spiellogik bekommt immer das volle `delta`.
- **Squash & Stretch:** `squashFor`, `squashScale`, `updateSquashes` (Beschwörung streckt, Treffer staucht, Heilung hebt an).
  `MinionAnim.squashes` hält die laufenden Verformungen, `minion-figure.ts` skaliert die Figur an den Füßen.
- **Easing:** `easeOutQuad`, `easeOutCubic`, `easeInOutCubic`, `easeOutBack`, `tweenValue`. Verwendet für das Banner
  (Einfahren ease-out, Ausfahren ease-in-out) und die Anhebung der Handkarten (federt über).

## Schalter und Barrierefreiheit

URL-Parameter (`parseJuiceSettings`): `?juice=0` schaltet alles ab, einzeln `?shake=0`, `?flash=0`, `?aberration=0`,
`?hitstop=0`, `?postfx=0` (`1` schaltet an). Bei `prefers-reduced-motion: reduce` sind Shake, Flash, Aberration und
Hit-Stop standardmäßig aus (mit `?shake=1` usw. wieder einschaltbar); Vignette und Farbkorrektur bleiben.
Das Post-Processing kostet auf schwachen Geräten Leistung und lässt sich mit `?postfx=0` abschalten.

**Aberration:** Phaser 3.90 bringt keinen Chromatic-Aberration-Effekt mit. Die Logik (Stärke, Dauer, Schalter,
`JuiceStep.aberration`) steht und ist getestet; ein Shader dafür ist **nicht** gebaut (der Auftrag nennt ihn optional und
schließt ein Shader-Framework aus). Die Szene zeigt den Wert bisher nicht an.

## Kamera-FX und Licht

- `main-scene.ts` (`setUpJuice`): Vignette, Farbkorrektur (Sättigung/Kontrast) und leichter Bloom über `cameras.main.postFX`,
  nur im WebGL-Renderer; Bildblitz als additives weißes Rechteck; Kamera-Wackeln über `setScroll`.
- `effects.ts`: neue Partikelarten `summon` (aufsteigende Funken) und `heal` (schwebende grüne Lichter), Heilung hat jetzt
  einen Effekt; additive Lichtflecken (`light`) bei Beschwörung, Heilung, Blitz, Explosion und Turmzerstörung; Dauerglühen
  an Blitz-Türmen (`glowTowers`, gold, pulsiert mit der Szenenzeit). Das frühere feste Kamerawackeln beim Turmfall entfällt,
  `juice.ts` übernimmt es.

## Palette

Die Palette ist der Bestand aus `src/scenes/theme.ts` (`SURFACE`, `LIGHT`, `MATERIAL`, `TEAM_COLOR`, `PALETTE`), ergänzt um
`FX_COLOR` (Partikel, Figurenfarben, Pergament) und `TEXTURE_COLOR` (Boden-, Weg- und Tischtexturen). Sie ist eine
**eigene Palette des Projekts**, keine Lospec-Palette; der Code-Kommentar in `theme.ts` nennt das. Alle bisher freien
Hex-Werte in `effects.ts`, `minion-figure.ts`, `banner-view.ts`, `textures.ts`, `audio.ts`, `balance-scene.ts`,
`card-detail-view.ts` und `replay-scene.ts` stehen jetzt in `theme.ts`. `src/logic/palette-usage.test.ts` schlägt fehl,
sobald ein Szenenmodul wieder einen freien Hex-Wert enthält.

## Assets

Es kommen **keine neuen Bilddateien** hinzu. Die neuen Partikel und Lichter nutzen die bestehenden Canvas-Texturen
`spark`, `glow` und `splinter` (`textures.ts`). Damit entsteht keine neue Herkunfts- oder CC0-Angabe; die offene Frage zu
den vorhandenen Dateien in `public/assets/` bleibt wie in [grafik-stil.md](grafik-stil.md) beschrieben.

## Tests

- **Logik:** `juice.test.ts`, `palette-usage.test.ts`, Ergänzung in `minion-look.test.ts`; Abdeckung mit `npm run test:coverage`.
- **Szenen-E2E:** `e2e/juice.spec.ts` (Turm-Treffer als Frame-Sequenz mit Messung von Kameraausschlag und Partikeln,
  Schalter `?shake=0`, `prefers-reduced-motion`, Vignette Ecke dunkler als mit `?postfx=0`, Screenshots im Kampf und beim
  Spielende unter `test-results/`). Ohne Referenzbilder, daher auch unter Linux ohne Snapshots lauffähig.
- **Snapshots:** Das Post-Processing ändert alle Bilder in `e2e/grafik.spec.ts-snapshots/*-chromium-darwin.png`. Sie müssen
  unter macOS bewusst neu erzeugt werden (`npx playwright test e2e/grafik.spec.ts --update-snapshots`) und wurden hier nicht
  neu erzeugt.
