# Ton: Tavernenmusik und Kampfsounds

Musikschleife und Soundeffekte für Kampf und Spielaktionen, mit getrennten Reglern und einem Stumm-Schalter.

## Aufbau

| Datei | Aufgabe |
|---|---|
| `src/logic/fx-events.ts` | FX-Ereignisse, jetzt auch `minion-heal`, `shield-block`, `round-start`, `round-end`, `match-over`; `minion-damage` trägt die Quelle (`melee`, `arrow`, `lightning`) |
| `src/logic/audio-events.ts` | Zuordnung Ereignis → Sound-Schlüssel (`soundKeyFor`), Drosselung und Seed-Variation (`planSounds`) |
| `src/logic/audio-settings.ts` | Validierung und Begrenzung der Lautstärken, Stumm-Zustand, Text für den `localStorage` |
| `src/scenes/audio.ts` | Phaser-Schicht: fehlertolerantes Laden, Musikschleife, Abspielen, Regler und Stumm-Schalter zeichnen |

Die Szenen `main-scene.ts` und `replay-scene.ts` geben die Ergebnisse von `diffFx` an `AudioLayer.play` weiter. Das
Ausspielen einer Karte hat keinen Zustandsunterschied und kommt als `{ kind: 'card-play' }` aus `main-scene.ts` dazu.

## Sound-Schlüssel

Jedes Ereignis ergibt genau einen Schlüssel; der Effekt liegt als `public/assets/audio/<schlüssel>.wav`.

| Ereignis | Schlüssel |
|---|---|
| Treffer im Nahkampf | `melee-hit` |
| Treffer durch Bogenschützen oder Tower | `arrow` |
| Treffer durch Blitz-Turm | `lightning` |
| Schild-Turm getroffen, Runden-Schild fängt Schaden | `shield-block` |
| Heilung | `heal` |
| Beschwörung | `summon` |
| Minion-Tod / Explosion | `minion-death` / `explosion` |
| Turm-Treffer / Turm zerstört | `tower-hit` / `tower-down` |
| Karte gespielt | `card-play` |
| Rundenstart / Rundenende | `round-start` / `round-end` |
| Sieg / Niederlage (Unentschieden klingt wie `round-end`) | `victory` / `defeat` |

## Regeln der Logik

- **Drosselung:** je Zeitfenster von 250 ms (`THROTTLE.windowMs`, aus `delta` summiert) höchstens 6 Töne insgesamt und
  2 je Schlüssel. Rundenstart, Rundenende, Sieg, Niederlage und Turmfall zählen nicht gegen die Gesamtgrenze, damit
  sie im Kampflärm nicht verloren gehen; die Grenze je Schlüssel gilt auch für sie.
- **Variation:** Pro zugelassenem Ton zieht `nextRandom` die Abspielgeschwindigkeit (±8 %) und die Lautstärke (80 bis
  100 %). Die Seed ist die des Matches (Replay: die Replay-Seed). Verworfene Ereignisse verbrauchen keinen Zufall.
- **Einstellungen:** Musik und Effekte haben je einen Regler (0 bis 1), dazu ein Stumm-Schalter. Fehlende oder ungültige
  Werte werden begrenzt bzw. durch die Standardwerte (Musik 0,5, Effekte 0,8) ersetzt. Stumm setzt beide Lautstärken
  sofort auf 0 und behält die Reglerwerte. Gespeichert wird als JSON unter `towerfield.audio` im `localStorage`.
- **Replay:** spielt dieselben Effekte (gleiche `diffFx`-Ereignisse wie im Spiel) und die Musik mit 40 %
  (`REPLAY_MUSIC_SCALE`); es hat keine Bedienelemente, sondern nutzt die gespeicherten Einstellungen.

## Bedienung

Oben links schaltet „Ton an / Stumm“ Musik und Effekte um. Oben rechts stellen zwei Regler („Musik“, „FX“) die
Lautstärken ein: antippen oder ziehen. Die Musik startet erst nach der ersten Eingabe im Spiel (Browser sperren
Autoplay); bis dahin bleibt der Audiokontext unangetastet, es gibt keine Autoplay-Warnung.

## Fehlertoleranz

`audio.ts` lädt die Dateien selbst (`SafeAudioFile`), weil Phaser bei fehlenden oder kaputten Audiodateien
`console.error` ausgibt. Eine fehlende, als HTML ausgelieferte oder nicht dekodierbare Datei bleibt leer im Cache; die
Schicht überspringt sie, das Spiel läuft still weiter. Der Smoke-Test prüft das mit einer absichtlich kaputten Datei.

## Dateien, Quellen und Lizenzen

| Datei | Art | Quelle | Lizenz |
|---|---|---|---|
| `public/assets/audio/melee-hit.wav`, `arrow.wav`, `lightning.wav`, `shield-block.wav`, `heal.wav`, `summon.wav`, `minion-death.wav`, `explosion.wav`, `tower-hit.wav`, `tower-down.wav`, `card-play.wav`, `round-start.wav`, `round-end.wav`, `victory.wav`, `defeat.wav` | Effekte | selbst erzeugt mit `tools/generate-sfx.mjs` (Sinus, Rauschen, Hüllkurven; keine fremden Samples) | CC0 1.0 (gemeinfrei) |
| `public/assets/audio/tavern-loop.m4a` | Musik 1: „Medieval: The Old Tower Inn“ (Loop-Version, 50 s) | RandomMind, https://opengameart.org/content/medieval-the-old-tower-inn | CC0 1.0 (gemeinfrei) |
| `public/assets/audio/tavern-loop-2.m4a` | Musik 2: „Medieval: The Bard's Tale“ (Loop-Version, 58 s) | RandomMind, https://opengameart.org/content/medieval-the-bards-tale | CC0 1.0 (gemeinfrei) |

**Effekte erzeugen:** `npm run audio:sfx` schreibt die 15 WAV-Dateien (mono, 22,05 kHz, 16 Bit, zusammen rund
410 KB) deterministisch nach `public/assets/audio/`. Danach mit ins Repository nehmen.

**Musik:** Zwei Stücke wechseln sich ab (`MUSIC_KEYS` in `audio.ts`): nach dem Ende des einen startet das andere.
Fehlt eines, läuft das vorhandene allein in Schleife; fehlen beide, spielen nur die Effekte. Je Stück gewinnt die erste
brauchbare Datei aus `.m4a`, `.ogg`, `.mp3`. Die Originale sind Loop-WAVs (44,1 kHz, Stereo); sie wurden mit
`afconvert -f m4af -d aac -b 128000` nach AAC umgewandelt (zusammen rund 1,7 MB statt 19 MB). Neue Stücke nur mit
Lizenz, die Weitergabe und Nutzung in einem Spiel erlaubt (z. B. CC0, CC-BY mit Namensnennung hier).
