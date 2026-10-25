# Tower-Spezialisierung: Blitz- und Schild-Turm

Ein Tower einer Lane lässt sich einmalig per Karte spezialisieren. Es gibt keine weiteren Pfade, keine Stufen und kein
Zurücksetzen.

## Karten

| ID | Name | Kosten | Pfad (`path`) | Kopien je Durchgang |
|---|---|---|---|---|
| `tower-lightning` | Blitz-Turm | 2 | `lightning` | 1 |
| `tower-shield` | Schild-Turm | 2 | `shield` | 1 |

Kartentyp `tower-specialize`, Ziel `line`. Die Pfadwahl steckt in der Karte; die Signatur von `playCard` ist unverändert.

## Voraussetzung

- Die Lane muss mindestens `SPECIALIZE_MIN_LEVEL` (2, `match.ts`) als Lane-Level haben. Lane-Level ist die Ausbaustufe,
  ab der die Lane frei wird (`laneUnlockLevel`): Start-Lane 1, Lanes Lvl 2 oben/unten 2, Lanes Lvl 3 3. Die Start-Lane
  mit ihren drei Towern lässt sich damit nicht spezialisieren.
- Betroffen ist der vorderste lebende Tower der Lane ohne Spezialisierung (`specializeTarget`).
- Fehler lassen den Zustand und die Energie unverändert: `level-too-low`, `already-specialized` (kein freier Tower);
  davor gelten `invalid-line` und `not-enough-energy`.

## Kampf (`combat.ts`)

- **Blitz:** trifft alle gegnerischen Minions der eigenen Lane innerhalb `TOWER_RANGE`, je mit
  `damage × delta × LIGHTNING_FACTOR` (0,6).
- **Schild:** trifft ein Minion den Tower, erleidet es zusätzlich `SHIELD_REFLECT` (0,5) × seinen Schaden, höchstens
  seine Rest-LP. Der Rückwurf wird wie der übrige Schaden aus dem Zustand vor dem Tick berechnet und gemeinsam
  angewendet; die Spielerreihenfolge ändert nichts.
- Tower ohne Spezialisierung verhalten sich unverändert. `LIGHTNING_FACTOR` und `SHIELD_REFLECT` sind Startwerte und
  per Balance-Simulation zu prüfen.

## Bot, Anzeige, Replay

- Der Bot wählt die zulässige Lane mit dem höchsten Lane-Level, bei Gleichstand die niedrigste.
- Karten: Gold, Blitz-Symbol, Banner „SPEZIAL“, Filter „Tower“; Hand-Sortierung hinter den Tower-Upgrades. Ein
  spezialisierter Tower trägt eine Raute (gelb Blitz, blau Schild). Abgelehnte Karten zeigen „Lane-Level zu niedrig“
  bzw. „Tower schon spezialisiert“.
- Die Karten haben kein eigenes Bild (Rückfall auf das Typ-Symbol).
- Die Kartenliste ändert sich, daher steigt `RECORD_VERSION` auf 5; ältere Links sind ungültig. Die Spezialisierung ist
  Teil des Tower-Zustands und übersteht `structuredClone` und das Nachspielen.

## E2E-Absicherung

`e2e/gameplay.spec.ts` spielt beide Karten per Tippen auf Karte und Lane aus (Energie sinkt um die Kartenkosten) und
misst die Kampfwirkung über `sampleCombat` (`e2e/helpers.ts`): Blitz trifft zwei Minions in `TOWER_RANGE` mit je
`damage × LIGHTNING_FACTOR`, Schild wirft `SHIELD_REFLECT` des Angreifer-Schadens zurück. Als Vergleich läuft dieselbe
Lage in Node ohne Spezialisierung. Fehlt die Zeile `specialization = def.path` in `match.ts`, werden beide Tests rot.
