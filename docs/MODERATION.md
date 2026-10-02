# Αναφορές και αναστολές λογαριασμών

Όταν κάποιος πατάει «Αναφορά» σε μια συνομιλία, η αναφορά γράφεται στη βάση.
Δεν έρχεται email. Τις βλέπεις και τις χειρίζεσαι από τον **SQL editor** της
Supabase: `https://supabase.com/dashboard/project/jxjrggyjdqgbodvlqdte/sql/new`

Όλα τα εργαλεία είναι στο schema `moderation`, που το φτιάχνει το migration
0010. Δεν φαίνεται από την εφαρμογή και κανένας χρήστης δεν έχει πρόσβαση.

Στόχος: να έχεις κοιτάξει κάθε αναφορά μέσα σε **24 ώρες**. Οι όροι χρήσης το
υπόσχονται, και η Apple το ελέγχει όταν φτάσεις στο App Store.

---

## 1. Τι εκκρεμεί

```sql
select * from moderation.reports_overview where resolved_at is null;
```

Οι στήλες που μετράνε:

- `reported_name`, `reported_email`, `reported_id`: ποιος αναφέρθηκε.
- `reason`: τι έγραψε αυτός που έκανε την αναφορά.
- `reports_against_them`: πόσες αναφορές έχει συνολικά. Μία αναφορά μπορεί να
  είναι παρεξήγηση. Πέντε από διαφορετικούς ανθρώπους σπάνια είναι.
- `reporter_id`: ποιος έκανε την αναφορά (ο άλλος δεν το μαθαίνει ποτέ).

## 2. Τι ειπώθηκε

Μόνο για συγκεκριμένη αναφορά: η πολιτική απορρήτου λέει ότι διαβάζουμε
μηνύματα **μόνο** τότε. Βάλε τα δύο id από το βήμα 1:

```sql
select m.created_at, p.display_name as sender, m.ciphertext as text, m.id as message_id
from messages m
join profiles p on p.id = m.sender_id
where m.conversation_id = (
  select c.id
  from conversations c
  join conversation_members a on a.conversation_id = c.id and a.user_id = 'REPORTER_ID'
  join conversation_members b on b.conversation_id = c.id and b.user_id = 'REPORTED_ID'
  where c.kind = 'direct'
  limit 1
)
order by m.created_at desc
limit 50;
```

## 3. Τι κάνεις

**Σβήσιμο ενός μηνύματος** (για όλους, όπως το «Διαγραφή για όλους»):

```sql
select moderation.remove_message('MESSAGE_ID');
```

Αν είχε αρχείο, η απάντηση δείχνει το `storage_paths_to_delete`. Σβήσ' το από
Storage → `message-media` (η βάση δεν επιτρέπεται να σβήνει αρχεία μόνη της).

**Αναστολή λογαριασμού:**

```sql
select moderation.suspend_user('REPORTED_ID', 'σύντομη σημείωση: γιατί');
```

Από εκείνη τη στιγμή δεν στέλνει μηνύματα, δεν ανεβάζει αρχεία, δεν ξεκινάει
συνομιλίες και δεν εμφανίζεται σε αναζήτηση. Όταν λήξει η σύνδεσή του (το πολύ
σε μία ώρα) δεν μπορεί να ξαναμπεί. Τα μηνύματά του μένουν, ως αποδεικτικό.

**Άρση αναστολής** (αν έγινε λάθος, ή μετά από επικοινωνία):

```sql
select moderation.unsuspend_user('USER_ID');
```

**Κλείσιμο της αναφοράς**, ό,τι κι αν αποφάσισες (και «δεν χρειάζεται τίποτα»
είναι απόφαση):

```sql
select moderation.resolve_report('REPORT_ID', 'τι έγινε');
```

Ποιοι είναι σε αναστολή τώρα:

```sql
select id, display_name, email, suspended_at, suspension_note
from profiles where suspended_at is not null;
```

---

## Παράνομο περιεχόμενο

Αν δεις υλικό σεξουαλικής κακοποίησης παιδιών:

1. **Μην** το κατεβάσεις, μην το προωθήσεις, μην το δείξεις σε κανέναν.
2. Ανάστειλε αμέσως τον λογαριασμό (βήμα 3), αλλά **μη σβήσεις** ακόμα το
   μήνυμα: είναι αποδεικτικό στοιχείο.
3. Κατάγγειλέ το στη Διεύθυνση Δίωξης Ηλεκτρονικού Εγκλήματος: **11188**, ή
   <https://www.cyberalert.gr>. Δώσε το `reported_id` και το `message_id`.
4. Σβήσε το μήνυμα μόνο όταν σου πουν ότι μπορείς.

Για απειλές κατά της ζωής κάποιου: **100**.

---

## Αίτημα πλήρους διαγραφής (GDPR άρθρο 17)

Η διαγραφή λογαριασμού μέσα από την εφαρμογή αφήνει τα μηνύματα που έστειλε ο
χρήστης στις συνομιλίες των άλλων (η πολιτική απορρήτου το εξηγεί). Αν κάποιος
σου γράψει ότι θέλει να σβηστούν κι αυτά, βρες το id του:

```sql
select id, display_name, deleted_at from profiles where email = 'EMAIL_TOU';
```

(Αν έχει ήδη διαγράψει τον λογαριασμό του, το email έχει αντικατασταθεί. Τότε
ρώτα τον με ποιους μιλούσε, ή ζήτα το παλιό του id από το αρχείο που κατέβασε.)

Μετά, για όλα του τα μηνύματα:

```sql
-- Πρώτα τα αρχεία: η λίστα που θα σβήσεις από το Storage.
select storage_path from attachments a
join messages m on m.id = a.message_id
where m.sender_id = 'USER_ID';

-- Μετά το κείμενο. Μένει μόνο η ένδειξη «Το μήνυμα διαγράφηκε».
delete from attachments
where message_id in (select id from messages where sender_id = 'USER_ID');
update messages set ciphertext = '', deleted_at = now(), edited_at = null
where sender_id = 'USER_ID' and deleted_at is null;
```

Απάντησε στον χρήστη ότι έγινε, μέσα σε 30 μέρες από το αίτημα.
