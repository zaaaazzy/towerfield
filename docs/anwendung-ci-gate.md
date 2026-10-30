# CI-Gate vor dem Deploy

## Ablauf

| Datei | Zweck |
|---|---|
| `.github/workflows/ci.yml` | Job `pruefen`: `npm ci`, `npm run build`, `npm test`, `npm run test:smoke` im Container `mcr.microsoft.com/playwright:v1.64.1-noble`. Trigger: `pull_request`, `workflow_dispatch`, `workflow_call`. |
| `.github/workflows/pages.yml` | Trigger: Push auf `main`, `workflow_dispatch`. Ruft `ci.yml` als Job `ci` auf; `build` und `deploy` hängen per `needs` davon ab. |

- **Push auf `main`:** `ci.yml` wird über `pages.yml` aufgerufen und nicht zusätzlich direkt per `push` ausgelöst. So läuft
  die Prüfung pro Push genau einmal, und `deploy` startet erst, wenn sie grün ist.
- **Pull Requests:** nur `ci.yml`; es gibt dort keinen Deploy-Job. Der Deploy-Job hat zusätzlich `if: github.ref == 'refs/heads/main'`.
- **Rechte:** `contents: read` für die Prüfungen; `pages: write` und `id-token: write` nur im Job `deploy`.
- **Concurrency:** `ci-<ref>`, bricht nur bei Pull Requests veraltete Läufe ab. Nicht die Gruppe `pages` verwenden, sonst
  blockiert der aufrufende Workflow den aufgerufenen.
- **Fehlerfall:** Bei Fehlschlag lädt `actions/upload-artifact` (`if: failure()`) `playwright-report/` und `test-results/`
  als Artefakt `playwright-bericht` hoch. In der CI schreibt `playwright.config.ts` dafür den HTML-Bericht
  (`[['line'], ['html', { open: 'never' }]]`). Läuft alles grün, entsteht kein Artefakt.

## Container-Version

Der Tag (`v1.64.1`) muss zur gepinnten Version von `@playwright/test` in `package.json` passen. Bei einer
Playwright-Anhebung beide Stellen gemeinsam ändern, sonst fehlen die passenden Browser-Binaries.

## Screenshots (`e2e/grafik.spec.ts`)

Die Hilfsfunktion `vergleiche` ruft `toHaveScreenshot` auf, wenn für die aktuelle Plattform ein Basisbild existiert
(`testInfo.snapshotPath`) oder wenn mit `--update-snapshots` Bilder erzeugt werden. Ohne Basisbild entfällt nur der
Vergleich, die übrigen Prüfungen der Tests laufen weiter. Basisbilder liegen unter `e2e/grafik.spec.ts-snapshots/`:
`*-chromium-darwin.png` (macOS, lokal) und `*-chromium-linux.png` (CI) für `planung`, `kampf`, `spielende-statistik`,
`spielende-teilen`, `detailansicht` und `hand-neue-karten`. Eine Grafikabweichung macht `pruefen` im PR rot; der
Bericht liegt im Artefakt `playwright-bericht`.

### Linux-Bilder neu erzeugen

Nach einer bewussten Grafikänderung (und einmalig, solange die Linux-Bilder fehlen):

1. **Workflow `Basisbilder`** (`.github/workflows/basisbilder.yml`, nur `workflow_dispatch`) auf dem Branch der Änderung
   starten. Er läuft im Container `mcr.microsoft.com/playwright:v1.64.1-noble` mit `npm ci`, `npm run build` und
   `npx playwright test e2e/grafik.spec.ts --update-snapshots` und stellt die Bilder als Artefakt `basisbilder-linux`
   bereit. Mit der Eingabe `committen` schreibt der Job `committen` sie zusätzlich auf den Branch (nur dieser Job hat
   `contents: write`, der Rest `contents: read`). Auf geschützten Branches stattdessen das Artefakt entpacken und per PR einchecken.
2. **Alternativ lokal mit Docker** (in der Agent-Umgebung gesperrt):

   ```sh
   docker run --rm -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.64.1-noble \
     sh -c "npm ci && npm run build && npx playwright test e2e/grafik.spec.ts --update-snapshots"
   ```

Die Bilder immer prüfen, bevor sie eingecheckt werden: Falsch erzeugte Bilder machen die CI dauerhaft rot. `ci.yml`
aktualisiert nie selbst Bilder, sonst würde die CI Fehler überschreiben. Die macOS-Bilder bleiben unverändert und werden
lokal auf macOS erneuert.

## Branch-Schutz (Repo-Einstellung, nicht im Code)

Das Gate verhindert den Deploy, schützt aber `main` erst, wenn der Branch-Schutz den Check `pruefen` (bzw. `CI / pruefen`)
als Pflicht-Check verlangt. Das ist in den GitHub-Repo-Einstellungen zu setzen; dieser Auftrag ändert sie nicht.

## Bekannte Instabilität

Beim lokalen Lauf von `npm run test:smoke` auf macOS schlugen unter Last in mehreren Läufen jeweils 1–3 verschiedene Specs
fehl (u. a. `turm-slots`, `gameplay`, `grafik` Langdruck, `smoke` Teilen-URL); einzeln bestanden alle. Als Abfederung nutzt die
CI `retries: 1` (nur bei `CI`); ein Test, der auch im zweiten Versuch fehlschlägt, macht den Lauf rot. Die Ursache (Last bei
zwei Workern und zwei Servern) ist nicht behoben, die Specs wurden nicht verändert. Im Container ist ein Probelauf vor dem Merge nötig.

## Tests ausführen

- Unit-Tests: `npm test` bzw. `npx vitest run <datei>.test.ts`.
- E2E: nur `npm run test:smoke` oder `npx playwright test <datei>`. `vitest run` auf `e2e/*.spec.ts` ergibt „No test files found“.
