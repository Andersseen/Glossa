/**
 * Strips a trailing `.json` extension to get a candidate locale, e.g. `en.json` → `en`,
 * `pt-BR.json` → `pt-BR`. Convenience only — the result still has to be matched against the
 * project's configured locales (or corrected manually) before it means anything; this never
 * validates BCP-47 shape itself.
 */
export function inferLocaleFromFileName(fileName: string): string | null {
  const match = /^(.+)\.json$/i.exec(fileName.trim());
  const candidate = match?.[1]?.trim();
  return candidate ? candidate : null;
}
