// Εικόνα προφίλ από τα αρχικά του ονόματος, φτιαγμένη μέσα στη συσκευή.
//
// Πριν ερχόταν από την DiceBear: κάθε άνοιγμα της λίστας συνομιλιών έστελνε σε
// τρίτη εταιρεία τα ονόματα των επαφών σου και τη διεύθυνση IP σου. Για ένα
// σχέδιο με δύο γράμματα σε χρωματιστό φόντο, δεν άξιζε.
//
// Η βάση στέλνει ακόμα το παλιό URL της DiceBear όταν κάποιος δεν έχει φωτογραφία
// (το κρατάει για τις παλιές εκδόσεις του app). Το avatarOf το αντικαθιστά.

const DICEBEAR = "https://api.dicebear.com/";

export const PERSON_COLOR = "#6d5dfc";
export const GROUP_COLOR = "#272634";

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  // Array.from ώστε ένα emoji ή ένα γράμμα με τόνο να μετράει για ένα.
  const first = (word?: string) => (word ? Array.from(word)[0] : "");
  const letters =
    words.length > 1 ? first(words[0]) + first(words[words.length - 1]) : first(words[0]);
  return (letters || "?").toLocaleUpperCase();
}

const escapeXml = (text: string) =>
  text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** data: URL με SVG. Σε <img> ένα SVG δεν εκτελεί ποτέ κώδικα. */
export function initialsAvatar(name: string, background = PERSON_COLOR): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" fill="${background}"/>` +
    `<text x="32" y="32" dy="0.35em" text-anchor="middle" fill="#fff" ` +
    `font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" ` +
    `font-size="26" font-weight="600">${escapeXml(initialsOf(name))}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Η εικόνα που δείχνουμε για έναν άνθρωπο. */
export function avatarOf(user: { name: string; avatar?: string | null }): string {
  if (!user.avatar || user.avatar.startsWith(DICEBEAR))
    return initialsAvatar(user.name);
  return user.avatar;
}
