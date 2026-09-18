/**
 * A human-readable name for a locale code, using the platform's own `Intl.DisplayNames` — no
 * language-metadata dependency is added for this. Asks for the endonym (the language's own name
 * for itself: "Español", "Українська"), which is what a translator working in that language
 * recognizes, and falls back to the bare code wherever the runtime has no data for it.
 */
const labels = new Map<string, string>();

export function localeDisplayName(locale: string): string {
  const cached = labels.get(locale);

  if (cached !== undefined) {
    return cached;
  }

  const label = resolveDisplayName(locale);
  labels.set(locale, label);
  return label;
}

function resolveDisplayName(locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale], {
      type: 'language',
      fallback: 'none',
    }).of(locale);

    if (!name || name.toLowerCase() === locale.toLowerCase()) {
      return locale;
    }

    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return locale;
  }
}

/** "Español / es" — the display name and the code together, or just the code when the runtime has no name for it. */
export function localeOptionLabel(locale: string): string {
  const name = localeDisplayName(locale);
  return name === locale ? locale : `${name} / ${locale}`;
}
