# Διανομή του Mila

Ένα web build, τέσσερα κανάλια. Το `apps/web/dist` είναι η μοναδική πηγή:
το Vercel το σερβίρει, το Capacitor το πακετάρει σε APK/IPA, το Tauri το
βάζει μέσα σε παράθυρο desktop. Δεν υπάρχει δεύτερος κώδικας να συντηρείς.

## Πριν από οτιδήποτε

```bash
npm install          # τραβάει τα νέα Capacitor + Tauri πακέτα
npm run typecheck
npm run build
```

---

## 1. Browser + PWA — έτοιμο τώρα, 0€

Δεν χρειάζεται τίποτα παραπάνω. Με το επόμενο deploy στο Vercel, ο χρήστης
θα δει «Install app» στο Chrome/Edge, ή «Προσθήκη στην αρχική οθόνη» στο
Safari. Εγκαθίσταται με δικό του εικονίδιο, χωρίς μπάρα διεύθυνσης, και
ανοίγει offline (δείχνει το κέλυφος, όχι τα μηνύματα).

Έλεγχος ότι δουλεύει: Chrome → DevTools → Application → Manifest, και δίπλα
Service Workers. Το Lighthouse έχει audit «Installable».

**Αυτό είναι το κανάλι που πρέπει να δοκιμάσεις πρώτο.** Είναι δωρεάν, δεν
περνάει από κανέναν έλεγχο, και αν κάτι χαλάσει στο mobile UI θα φανεί εδώ
πριν πληρώσεις για developer accounts.

## 2. Android / Google Play

**Χρειάζεσαι:** Android Studio, JDK 21, και λογαριασμό Google Play Console
(25 δολάρια, εφάπαξ).

```bash
npx cap add android     # μία φορά, φτιάχνει τον φάκελο android/
npm run android         # build + sync + άνοιγμα στο Android Studio
```

Από το Android Studio: `Build → Generate Signed App Bundle` για το `.aab`
που ανεβαίνει στο Play Console. Κράτα το keystore κάπου ασφαλή — αν το
χάσεις δεν μπορείς να ξαναεκδώσεις update στην ίδια εφαρμογή. Ποτέ στο git.

## 3. iOS / App Store

**Χρειάζεσαι:** Mac με Xcode και Apple Developer Program (99 δολάρια τον
χρόνο). Δεν υπάρχει τρόπος να βγάλεις iOS build από Windows — ούτε με
Capacitor, ούτε με τίποτα άλλο νόμιμο. Αν δεν έχεις Mac, οι επιλογές είναι
δανεικός Mac, Mac mini από 700 ευρώ, ή cloud CI (Codemagic, Bitrise) που
νοικιάζει macOS runners.

```bash
npx cap add ios
npm run ios
```

## 4. Desktop (Windows / macOS / Linux)

**Χρειάζεσαι:** Rust (`rustup`) και, στα Windows, τα Visual Studio Build
Tools με το C++ workload.

```bash
npm run desktop         # dev, με hot reload
npm run desktop:build   # βγάζει .msi/.exe στο src-tauri/target/release/bundle
```

Το Tauri χρησιμοποιεί το WebView2 των Windows αντί να πακετάρει ολόκληρο
Chromium, οπότε ο installer βγαίνει γύρω στα 5 MB αντί για 150 MB που θα
έδινε το Electron.

---

## Τι λείπει ακόμα για τα stores

Αυτά δεν είναι γούστα δικά μου — είναι λόγοι απόρριψης.

**Διαγραφή λογαριασμού μέσα από το app.** Στις ρυθμίσεις υπάρχει η γραμμή
«Privacy · Terms · Export data · Delete account», αλλά είναι απλό κείμενο.
Δεν κάνει τίποτα. Η Apple (App Store Review Guideline 5.1.1(v)) και η Google
απαιτούν και οι δύο πραγματική διαγραφή για κάθε app που φτιάχνει
λογαριασμούς. Θα κοπείς στον πρώτο έλεγχο.

**Privacy policy σε δημόσιο URL.** Υποχρεωτικό πεδίο και στα δύο stores.
Χρειάζεται να λέει τι μαζεύεις (email, μηνύματα, συνημμένα), πού
αποθηκεύεται (Supabase) και πώς διαγράφεται.

**Push notifications.** Δεν υπάρχουν καθόλου. Ένας messenger που δεν σε
ειδοποιεί όταν έρθει μήνυμα δεν είναι messenger — είναι σελίδα που πρέπει
να θυμάσαι να ανοίξεις. Θέλει Firebase Cloud Messaging, `@capacitor/push-notifications`,
και μια Supabase Edge Function που στέλνει το push όταν γράφεται μήνυμα.

**Google Sign-In στα native.** Τώρα φορτώνεται το `accounts.google.com/gsi/client`,
δηλαδή το web SDK. Μέσα σε native WebView η Google το μπλοκάρει από
πολιτική — θα βγάζει σκέτο `disallowed_useragent`. Στο κινητό θέλει είτε
`@capacitor/browser` με deep link πίσω στο app, είτε native Google auth plugin.
Το email + password δουλεύει κανονικά παντού, οπότε δεν είναι blocker για
πρώτη κυκλοφορία — απλά μη διαφημίσεις το κουμπί Google στα stores.

**Content moderation & blocking.** Υπάρχουν ήδη `blocks` και `reports` στη
βάση, που είναι καλό: η Apple ζητάει μηχανισμό αναφοράς για κάθε app με
user-generated content. Βεβαιώσου ότι είναι προσβάσιμα από το UI.

## Σειρά που προτείνω

1. Deploy το τωρινό build και δοκίμασε το PWA από πραγματικό κινητό.
2. Φτιάξε τη διαγραφή λογαριασμού και το privacy policy.
3. Push notifications.
4. Μετά αγόρασε Play Console και ανέβασε Android.
5. iOS τελευταίο — είναι το ακριβότερο και το πιο αυστηρό.
