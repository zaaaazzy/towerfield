/**
 * Node-Resolve-Hook: löst relative Importe ohne Endung (`./bot`) zu `.ts`-Dateien auf.
 * Node strippt die Typen selbst (Type-Stripping), kennt aber die Vite-/Bundler-Auflösung nicht.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
  }
  return nextResolve(specifier, context);
}
