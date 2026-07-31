# Στήσιμο email (Resend + Supabase)

Οδηγός βήμα προς βήμα για να στέλνει η Supabase τα emails επιβεβαίωσης
μέσω δικού μας παρόχου αντί για τον ενσωματωμένο mailer.

Παντού που βλέπεις `todomainsou.com` βάλε το δικό σου domain.

---

## Γιατί το κάνουμε

Ο ενσωματωμένος mailer της Supabase στέλνει **μόνο σε μέλη του organization**
και έχει όριο **2 emails την ώρα**. Είναι για δοκιμές, όχι για χρήστες.

---

## ΜΕΡΟΣ 1 — Λογαριασμός Resend

1. Πήγαινε στο <https://resend.com> και πάτα **Sign Up**.
2. Γράψου με email + password ή με GitHub.
3. Επιβεβαίωσε το email σου (θα σου έρθει μήνυμα).
4. Θα σε ρωτήσει για όνομα ομάδας/team. Βάλε `Mila` ή ό,τι θέλεις.

Δωρεάν πλάνο: **3.000 emails/μήνα** αλλά **100 την ημέρα** (σκληρό όριο),
**1 domain**, logs 30 ημερών.

---

## ΜΕΡΟΣ 2 — Πρόσθεσε το domain στο Resend

1. Αριστερό μενού → **Domains**.
2. **Add Domain**.
3. Γράψε σκέτο `todomainsou.com` (χωρίς `www`, χωρίς `https://`).
4. **Region**: διάλεξε την πιο κοντινή. Για Ελλάδα → `eu-west-1 (Ireland)`.
5. **Add**.

Θα σου εμφανίσει έναν πίνακα με **DNS records**. Άφησε τη σελίδα ανοιχτή —
τα χρειάζεσαι στο επόμενο μέρος. Θα μοιάζουν κάπως έτσι:

| Type | Name / Host        | Value                                | Priority |
|------|--------------------|--------------------------------------|----------|
| MX   | `send`             | `feedback-smtp.eu-west-1.amazonses.com` | 10    |
| TXT  | `send`             | `v=spf1 include:amazonses.com ~all`  | —        |
| TXT  | `resend._domainkey`| `p=MIGfMA0GCSqG...` (πολύ μεγάλο)    | —        |

Τα ακριβή values είναι μοναδικά για σένα. **Μην αντιγράψεις τα παραπάνω.**

---

## ΜΕΡΟΣ 3 — Βάλε τα DNS records στο Namecheap

### 3.1 Άνοιξε το σωστό σημείο

1. <https://www.namecheap.com> → **Sign In**.
2. Πάνω δεξιά **Account** → **Domain List**.
3. Δίπλα στο domain σου, κουμπί **MANAGE**.
4. Πάνω-πάνω, καρτέλα **Advanced DNS**.

> Αν δεις μήνυμα ότι το domain δεν χρησιμοποιεί Namecheap BasicDNS, πρέπει
> πρώτα στην καρτέλα **Domain** → **Nameservers** να διαλέξεις
> **Namecheap BasicDNS**.

### 3.2 Καθάρισμα

Στο **HOST RECORDS** θα δεις πιθανότατα μια εγγραφή τύπου `CNAME Record`
με host `www` και value `parkingpage.namecheap.com`, και ίσως ένα
`URL Redirect Record` με host `@`. Αυτά είναι η σελίδα-πάρκινγκ.

Δεν πειράζουν το email. **Άφησέ τα** προς το παρόν.

### 3.3 Πρόσθεσε τα TXT records

Για **κάθε** TXT record που σου έδωσε το Resend:

1. **ADD NEW RECORD** → **TXT Record**.
2. **Host**: γράψε **μόνο το κομμάτι πριν το domain**.
   - Αν το Resend λέει `send.todomainsou.com` → γράφεις `send`
   - Αν λέει `resend._domainkey.todomainsou.com` → γράφεις `resend._domainkey`
   - Αν λέει σκέτο `todomainsou.com` → γράφεις `@`

   Το Namecheap κολλάει μόνο του το domain στο τέλος. **Αν το γράψεις
   ολόκληρο, θα βγει `send.todomainsou.com.todomainsou.com` και δεν θα δουλέψει.**
3. **Value**: κάνε copy από το Resend (υπάρχει εικονίδιο αντιγραφής) και paste.
   Το DKIM είναι τεράστιο — μην το πληκτρολογήσεις, ούτε να κόψεις κενά.
4. **TTL**: άφησέ το `Automatic`.
5. Πάτα το **πράσινο ✓** δεξιά για να σωθεί η γραμμή.

Επανάλαβε για όλα τα TXT.

### 3.4 Πρόσθεσε το MX record

Το MX **δεν** μπαίνει στο ίδιο σημείο.

1. Κύλησε πιο κάτω στην ίδια σελίδα, στην ενότητα **MAIL SETTINGS**.
2. Στο dropdown διάλεξε **Custom MX**.
3. **ADD NEW RECORD**:
   - **Host**: `send`
   - **Value**: `feedback-smtp.eu-west-1.amazonses.com` (ό,τι λέει το Resend)
   - **Priority**: `10`
   - **TTL**: `Automatic`
4. Πράσινο **✓**.

> **Προσοχή**: αν χρησιμοποιείς ήδη email σε αυτό το domain (π.χ. Google
> Workspace, Namecheap Private Email), **μην σβήσεις** τα υπάρχοντα MX records
> με host `@`. Θα χάσεις τα εισερχόμενά σου. Απλά πρόσθεσε το καινούριο με
> host `send`.

### 3.5 DMARC (προαιρετικό αλλά συνιστάται)

Βοηθάει να μην πέφτουν τα emails σου στα spam.

- **TXT Record**
- **Host**: `_dmarc`
- **Value**: `v=DMARC1; p=none; rua=mailto:dikosou@email.com`

### 3.6 Επαλήθευση

1. Γύρνα στο Resend → **Domains** → το domain σου.
2. **Verify DNS Records**.
3. Περίμενε. Συνήθως 5–30 λεπτά, μπορεί και ώρες. Δεν κάνεις τίποτα —
   πατάς ξανά verify κάθε λίγο.
4. Όταν η κατάσταση γίνει **Verified** (πράσινο), προχώρα.

Αν μετά από μία ώρα είναι ακόμα `pending`: το 90% των περιπτώσεων είναι
λάθος στο πεδίο **Host** (γραμμένο ολόκληρο το domain). Ξαναδές το.

---

## ΜΕΡΟΣ 4 — API key

1. Resend → αριστερό μενού → **API Keys**.
2. **Create API Key**.
3. **Name**: `supabase-smtp`
4. **Permission**: `Sending access`
5. **Domain**: το domain σου.
6. **Add**.
7. Θα εμφανιστεί ένα κλειδί που αρχίζει με `re_`. **Αντίγραψέ το τώρα.**
   Δεν ξαναεμφανίζεται ποτέ. Αν το χάσεις, φτιάχνεις καινούριο.

Μην το βάλεις σε αρχείο μέσα στο repo. Μπαίνει μόνο στο Supabase dashboard.

---

## ΜΕΡΟΣ 5 — Supabase SMTP

1. <https://supabase.com/dashboard> → project **mila**.
2. Αριστερό μενού → **Authentication**.
3. Υπομενού → **Emails** (σε παλιότερες εκδόσεις: **Project Settings** → **Auth**).
4. Καρτέλα **SMTP Settings** → διακόπτης **Enable Custom SMTP** → ON.
5. Συμπλήρωσε:

   | Πεδίο          | Τιμή                       |
   |----------------|----------------------------|
   | Sender email   | `noreply@todomainsou.com`  |
   | Sender name    | `Mila`                     |
   | Host           | `smtp.resend.com`          |
   | Port number    | `465`                      |
   | Username       | `resend`                   |
   | Password       | το `re_...` API key        |

   Το `noreply@` δεν χρειάζεται να υπάρχει ως πραγματικό γραμματοκιβώτιο.
   Αρκεί το domain να είναι verified στο Resend.

6. **Save**.

### 5.1 Ανέβασε το rate limit

Με ενεργό custom SMTP η Supabase επιτρέπει περισσότερα emails, αλλά το όριο
δεν αλλάζει μόνο του.

1. **Authentication** → **Rate Limits**.
2. **Rate limit for sending emails**: βάλε `100` ανά ώρα.

Μην το πας πιο πάνω από όσο αντέχει το Resend free (100/μέρα συνολικά).

---

## ΜΕΡΟΣ 6 — Ενεργοποίηση επιβεβαίωσης email

**Αυτό είναι το πιο σημαντικό βήμα ασφαλείας.** Τώρα ο καθένας μπορεί να
γραφτεί με email που δεν του ανήκει.

1. **Authentication** → **Sign In / Providers** → **Email**.
2. **Confirm email**: **ON**.
3. **Save**.

### 6.1 Redirect URLs

Αλλιώς τα links στα emails θα δείχνουν σε `localhost` και δεν θα δουλεύουν
για κανέναν άλλο.

1. **Authentication** → **URL Configuration**.
2. **Site URL**: το production URL της εφαρμογής
   (π.χ. `https://mila.todomainsou.com`). Όσο δοκιμάζεις τοπικά,
   `http://localhost:5173`.
3. **Redirect URLs** → πρόσθεσε **και τα δύο**:
   - `http://localhost:5173/**`
   - `https://mila.todomainsou.com/**`

---

## ΜΕΡΟΣ 7 — Δοκιμή

1. Τρέξε την εφαρμογή: `npm run dev` → <http://localhost:5173>
2. Κάνε εγγραφή με **πραγματικό email σου, διαφορετικό** από αυτό του
   Resend λογαριασμού.
3. Έλεγξε τα εισερχόμενα. **Κοίτα και τα spam.**
4. Πάτα το link επιβεβαίωσης. Πρέπει να σε γυρίσει στην εφαρμογή συνδεδεμένο.
5. Resend → **Logs**: πρέπει να φαίνεται το email με status `Delivered`.

### Αν κάτι πάει στραβά

| Σύμπτωμα | Πού να κοιτάξεις |
|---|---|
| Δεν έφτασε τίποτα | Resend → Logs. Αν δεν υπάρχει εγγραφή, η Supabase δεν το έστειλε → Supabase → Logs → Auth |
| `Delivered` αλλά δεν το βλέπεις | Spam φάκελος. Πρόσθεσε DMARC (3.5) |
| `Bounced` | Λάθος διεύθυνση παραλήπτη |
| Το link σε πάει σε λάθος σελίδα | ΜΕΡΟΣ 6.1, Redirect URLs |
| SMTP error στα Supabase logs | Λάθος API key ή το domain δεν είναι verified |

---

## Τι μένει μετά από αυτό

Δες τη λίστα **Before launch** στο `README.md`. Το SMTP και το confirm email
είναι τα δύο πρώτα. Μένουν:

- Rate limiting σε αποστολή μηνυμάτων και εγγραφές
- Tests για τα RLS policies
- Έλεγχος uploads, όρια χώρου, πολιτική διαγραφής
- Εργαλεία για τα reports
- Privacy policy και όροι χρήσης

Και το βασικό που πρέπει να λες στους χρήστες: **τα μηνύματα δεν είναι
end-to-end κρυπτογραφημένα.**
