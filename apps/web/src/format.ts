// Ώρες, ημερομηνίες και μεγέθη, στη γλώσσα του χρήστη.

import { lang, locale, t } from "./i18n";

// Στα Ελληνικά 24ωρο («21:41»), όπως το δείχνουν τα κινητά εδώ. Το Intl από
// μόνο του θα έβγαζε «9:41 μ.μ.». Στα Αγγλικά ακολουθεί τη συνήθεια της χώρας.
const timeFormat = new Intl.DateTimeFormat(locale, {
  hour: "2-digit",
  minute: "2-digit",
  ...(lang === "el" ? { hour12: false } : {}),
});
const dayThisYear = new Intl.DateTimeFormat(locale, {
  weekday: "long",
  day: "numeric",
  month: "long",
});
const dayOtherYear = new Intl.DateTimeFormat(locale, {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const shortDate = new Intl.DateTimeFormat(locale, {
  day: "numeric",
  month: "numeric",
  year: "2-digit",
});
const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" });

const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Πόσες ημερολογιακές μέρες πριν από σήμερα (0 = σήμερα). */
function daysAgo(d: Date): number {
  return Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
}

export const time = (iso: string) => timeFormat.format(new Date(iso));

/** Κλειδί ημέρας, για να ξέρουμε πότε αλλάζει μέρα ανάμεσα σε δύο μηνύματα. */
export const dayKey = (iso: string) => String(startOfDay(new Date(iso)));

/** Ο διαχωριστής μέσα στη συνομιλία: «Σήμερα», «Χθες», «Δευτέρα 3 Μαρτίου». */
export function dayLabel(iso: string): string {
  const date = new Date(iso);
  const ago = daysAgo(date);
  if (ago === 0) return t("day.today");
  if (ago === 1) return t("day.yesterday");
  return date.getFullYear() === new Date().getFullYear()
    ? dayThisYear.format(date)
    : dayOtherYear.format(date);
}

/** Στη λίστα συνομιλιών: ώρα για σήμερα, «Χθες», ημέρα για την εβδομάδα,
 *  αλλιώς σύντομη ημερομηνία. */
export function listTime(iso: string): string {
  const date = new Date(iso);
  const ago = daysAgo(date);
  if (ago <= 0) return timeFormat.format(date);
  if (ago === 1) return t("day.yesterday");
  if (ago < 7) return weekday.format(date);
  return shortDate.format(date);
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
