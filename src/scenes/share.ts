import { shareQuery, type RecordedMatch, wrapText } from '../logic/match-record';

/** Zeichen je Zeile, mit denen die Teilen-URL im Spielfeld (Schriftgröße 9) umgebrochen wird. */
const URL_CHARS_PER_LINE = 54;
/** Mehr Zeilen zeigt das Ende-Bild nicht; der Rest ist über „Link kopieren“ erreichbar. */
const URL_MAX_LINES = 14;

/** Vollständige Teilen-URL der Aufzeichnung auf der aktuellen Seite. */
export function shareUrl(record: RecordedMatch): string {
  return `${window.location.origin}${window.location.pathname}${shareQuery(record)}`;
}

/** Die URL für die Anzeige: in Zeilen umgebrochen, bei Überlänge mit „…“ gekürzt. */
export function shareUrlLines(url: string): string[] {
  const lines = wrapText(url, URL_CHARS_PER_LINE);
  return lines.length <= URL_MAX_LINES ? lines : [...lines.slice(0, URL_MAX_LINES - 1), '…'];
}

/** Kopiert Text in die Zwischenablage; ohne Berechtigung oder API passiert nichts (kein Fehler). */
export function copyToClipboard(text: string): void {
  try {
    navigator.clipboard?.writeText(text).catch(() => undefined);
  } catch {
    // Zwischenablage nicht verfügbar: der Link bleibt in der Anzeige sichtbar.
  }
}
