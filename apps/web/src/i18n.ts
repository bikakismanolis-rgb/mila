// Όλα τα κείμενα της οθόνης, σε Ελληνικά και Αγγλικά.
//
// Γλώσσα: ό,τι διάλεξε ο χρήστης· αλλιώς Ελληνικά αν το κινητό/ο browser είναι
// στα Ελληνικά, Αγγλικά σε κάθε άλλη περίπτωση. Η αλλαγή γλώσσας ξαναφορτώνει
// τη σελίδα — πολύ πιο απλό και σίγουρο από το να ξαναζωγραφιστεί κάθε οθόνη.
//
// Νέο κείμενο: μπαίνει ΠΡΩΤΑ στο `en`. Το `el` είναι δηλωμένο ώστε να πρέπει
// να έχει ακριβώς τα ίδια κλειδιά — αν ξεχαστεί μετάφραση, δεν περνάει το
// typecheck.

export type Lang = "el" | "en";

const STORAGE_KEY = "mila:lang";

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "el" || saved === "en") return saved;
  } catch {
    // Ιδιωτική περιήγηση χωρίς localStorage: πάμε με τη γλώσσα του browser.
  }
  const preferred = (
    navigator.languages?.[0] ||
    navigator.language ||
    "en"
  ).toLowerCase();
  return preferred.startsWith("el") ? "el" : "en";
}

export const lang: Lang = detect();

/** Για ώρες και ημερομηνίες (Intl). */
export const locale: string =
  lang === "el"
    ? "el-GR"
    : navigator.language?.toLowerCase().startsWith("en")
      ? navigator.language
      : "en-GB";

document.documentElement.lang = lang;

export function setLang(next: Lang): void {
  if (next === lang) return;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    return;
  }
  location.reload();
}

const en = {
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.back": "Back",
  "common.working": "One moment…",
  "common.loading": "Loading…",

  "nav.chats": "Messages",
  "nav.find": "Find people",
  "nav.settings": "Settings",
  "nav.signOut": "Sign out",

  "day.today": "Today",
  "day.yesterday": "Yesterday",

  "login.titleLine1": "Talk freely.",
  "login.titleLine2": "Keep your number private.",
  "login.lede":
    "A familiar messenger, built around your email — not your phone number.",
  "login.email": "Email address",
  "login.password": "Password",
  "login.yourPassword": "Your password",
  "login.passwordHint": "At least 6 characters",
  "login.displayName": "Display name",
  "login.displayNameNote": "(new accounts)",
  "login.displayNameHint": "How people know you",
  "login.signIn": "Sign in",
  "login.createAccount": "Create account",
  "login.consentBefore": "By creating an account you agree to our",
  "login.privacyPolicy": "privacy policy",
  "login.consentAfter":
    "Messages are stored on our servers and are not end-to-end encrypted.",
  "login.newHere": "New here?",
  "login.forgot": "Forgot password?",
  "login.haveAccount": "Already have an account?",
  "login.or": "or",
  "login.trust": "Email verified · No phone required",
  "login.pitchTitle":
    "Your conversations belong in a messenger, not an inbox.",
  "login.pitchText":
    "Realtime chat, requests and privacy controls in one calm place.",
  "login.newPasswordTitle": "Set a new password.",
  "login.newPasswordText": "Choose a fresh password for your Mila account.",
  "login.newPassword": "New password",
  "login.updatePassword": "Update password",
  "login.enterEmailFirst": "Enter your email first.",
  "login.enterValidEmail": "Enter a valid email.",
  "login.resetSent":
    "Password reset email sent. Open the link and set a new password.",
  "login.accountCreated":
    "Account created. Check your email to confirm your account, then sign in here with your password.",
  "login.noSession": "Sign-in did not complete. Please try again.",
  "login.googleLoadFailed": "Could not load Google Sign-In.",
  "login.googleNoToken": "Google did not complete the sign-in.",
  "login.serverProblem":
    "We can't reach the server right now. Please try again in a little while.",

  "home.title": "Your messages, in one place",
  "home.text": "Choose a conversation or find someone using their email.",

  "list.searchPlaceholder": "Search chats and messages",
  "list.request": "Message request",
  "list.requestSent": "Request sent",
  "list.start": "Start the conversation",
  "list.inMessages": "In messages",
  "list.emptyTitle": "No conversations yet",
  "list.emptyText": "Find someone by email and say hello.",
  "list.noneTitle": "Nothing found",
  "list.noneText": "No chat or message matches your search.",

  "people.searchPlaceholder": "Name, username or full email",
  "people.import": "Import email contacts",
  "people.importHint":
    "Your address book never leaves your device — only scrambled fingerprints of the emails are compared.",
  "people.imported": "From your contacts ({n})",
  "people.privateEmail": "private email",
  "people.emptyTitle": "Find someone",
  "people.emptyText":
    "Search by name or username, or type their full email address.",
  "people.noneTitle": "No one found",
  "people.noneText":
    "Check the spelling. To search by email, type the whole address.",

  "chat.you": "You",
  "chat.group": "Group",
  "chat.deletedUser": "Deleted user",
  "chat.unknownUser": "Unknown",
  "chat.formerMember": "Former member",
  "chat.typing": "typing…",
  "chat.typingNamed": "{name} is typing…",
  "chat.options": "Conversation options",
  "chat.details": "Contact details",
  "chat.block": "Block",
  "chat.unblock": "Unblock",
  "chat.blockTitle": "Block {name}?",
  "chat.blockText":
    "They won't be able to message you or find you. They are not told. You can unblock them from Settings.",
  "chat.youBlocked": "You blocked {name}.",
  "chat.accountDeleted": "This account was deleted. You can't reply.",
  "chat.report": "Report",
  "chat.reportTitle": "Report {name}",
  "chat.reportText":
    "Tell us briefly what happened. The other person is not told.",
  "chat.reportPlaceholder": "What is the problem?",
  "chat.reportSend": "Send report",
  "chat.reportThanks": "Thank you. Your report was sent.",
  "chat.loadOlder": "Show older messages",
  "chat.emptyTitle": "No messages yet",
  "chat.emptyText": "Write something to start the conversation.",
  "chat.attach": "Send photo or file",
  "chat.uploading": "Uploading…",
  "chat.placeholder": "Write a message",
  "chat.send": "Send",

  "request.title": "{name} wants to chat",
  "request.text": "Accept to move this conversation into your regular inbox.",
  "request.accept": "Accept",
  "request.decline": "Decline",
  "request.waiting":
    "Your message will wait here until {name} accepts your request.",

  "msg.deleted": "This message was deleted",
  "msg.encrypted": "Encrypted message",
  "msg.reply": "Reply",
  "msg.copy": "Copy",
  "msg.copyFailed": "Could not copy.",
  "msg.delete": "Delete",
  "msg.deleteTitle": "Delete message?",
  "msg.deleteTextOwn":
    "\"For everyone\" removes it from the conversation for all. \"For me\" only hides it on your side.",
  "msg.deleteTextOther":
    "It will be hidden only for you. The other person will still see it.",
  "msg.deleteForEveryone": "Delete for everyone",
  "msg.deleteForMe": "Delete for me",
  "msg.notFound": "That message is no longer available.",

  "group.new": "New group",
  "group.name": "Group name",
  "group.namePlaceholder": "e.g. Family",
  "group.pickPeople": "Who is in it?",
  "group.noContacts":
    "You can add people you already chat with. Start a conversation with someone first.",
  "group.create": "Create group",
  "group.info": "Group info",
  "group.membersOne": "1 member",
  "group.membersMany": "{n} members",
  "group.admin": "Admin",
  "group.addPeople": "Add people",
  "group.add": "Add",
  "group.rename": "Rename group",
  "group.remove": "Remove",
  "group.removeTitle": "Remove {name}?",
  "group.removeText":
    "They will no longer see this group or its messages.",
  "group.leave": "Leave group",
  "group.leaveTitle": "Leave this group?",
  "group.leaveText":
    "You will no longer see the group or its messages. An admin can add you back.",

  "settings.displayName": "Display name",
  "settings.bio": "Bio",
  "settings.nameTooShort": "Your name needs at least 2 characters.",
  "settings.save": "Save changes",
  "settings.saved": "Saved.",
  "settings.privacy": "Privacy",
  "settings.discover": "Who can find me in search",
  "settings.discoverEveryone": "Everyone",
  "settings.discoverContacts": "Only people I already chat with",
  "settings.discoverNobody": "Nobody",
  "settings.discoverHint":
    "\"Everyone\": by name, username, or by typing your whole email. Never by part of your email.",
  "settings.showEmail": "Who can see my email",
  "settings.showEmailContacts": "People I chat with",
  "settings.showEmailNobody": "Nobody",
  "settings.showEmailHint":
    "Only after you have accepted the conversation. Strangers never see it.",
  "settings.receipts": "Read receipts",
  "settings.receiptsHint": "Let people know when you read their messages",
  "settings.language": "Language",
  "settings.notifications": "Notifications",
  "settings.blocked": "Blocked people",
  "settings.blockedNone": "You haven't blocked anyone.",
  "settings.storageNote":
    "Messages are stored on our servers and are not end-to-end encrypted. Your email is never shared without your say-so, and we never ask for a phone number.",

  "push.toggle": "Notify me about new messages",
  "push.toggleHint": "On this device, even when Mila is closed",
  "push.unsupported":
    "This browser can't show notifications. On iPhone, first add Mila to your Home Screen (Share → Add to Home Screen) and open it from there.",
  "push.blocked":
    "Notifications are blocked for Mila in your browser settings. Allow them there, then come back.",

  "account.title": "Your account",
  "account.readPolicy": "Read our privacy policy",
  "account.readPolicyAfter": "— what we keep, and what stays behind if you leave.",
  "account.changePassword": "Change password",
  "account.savePassword": "Save new password",
  "account.passwordUpdated": "Password updated.",
  "account.download": "Download my data",
  "account.preparing": "Preparing…",
  "account.downloadHint":
    "A file with your profile, your conversations and every message you sent. Nothing is deleted.",
  "account.delete": "Delete my account",
  "account.deleteTitle": "Delete your account",
  "account.deleteIntroBefore": "This cannot be undone.",
  "account.deleteIntroAfter":
    "will be released and you will not be able to sign back in.",
  "account.deleteItem1":
    "Your login, password and Google connection are erased.",
  "account.deleteItem2": "Your name, photo and profile details are erased.",
  "account.deleteItem3":
    "Messages you already sent stay in the other person's chat, shown as sent by a deleted user.",
  "account.typeDeleteBefore": "Type",
  "account.typeDeleteAfter": "to confirm",
  "account.keep": "Keep my account",
  "account.deleting": "Deleting…",
  "account.deletePermanently": "Delete permanently",

  "crash.title": "Something broke.",
  "crash.text":
    "Copy the text below and send it over — it says exactly what failed and where.",
  "crash.reload": "Reload",

  "err.generic": "Something went wrong. Please try again.",
  "err.network": "No connection. Check your internet and try again.",
  "err.notConfigured": "The app is not set up correctly (server settings missing).",
  "err.signedOut": "You are signed out. Please sign in again.",
  "err.invalidLogin": "Wrong email or password.",
  "err.emailNotConfirmed":
    "Confirm your email first — open the link we sent you, then sign in.",
  "err.alreadyRegistered":
    "There is already an account with this email. Sign in instead.",
  "err.passwordShort": "Password must be at least 6 characters.",
  "err.samePassword": "Choose a password different from your current one.",
  "err.rateLimitSeconds": "Too many attempts. Try again in {n} seconds.",
  "err.rateLimit": "Too many attempts. Please wait a little and try again.",
  "err.loadProfile": "Could not load your profile.",
  "err.saveProfile": "Could not save your profile.",
  "err.export": "Could not export your data.",
  "err.deleteAccount": "Could not delete your account.",
  "err.alreadyDeleted": "This account has already been deleted.",
  "err.search": "Search is unavailable right now.",
  "err.matchContacts": "Could not match your contacts.",
  "err.fileTooLarge": "That file is larger than the 15 MB limit.",
  "err.upload": "Upload failed.",
  "err.loadChats": "Could not load your conversations.",
  "err.loadMessages": "Could not load these messages.",
  "err.startChat": "Could not start that conversation.",
  "err.notAllowed": "You can't start a conversation with this person.",
  "err.send": "Message could not be sent.",
  "err.cannotSend": "You can't send messages to this conversation.",
  "err.tooLong": "That message is too long.",
  "err.deleteMessage": "Could not delete that message.",
  "err.onlySender": "Only the person who sent a message can delete it for everyone.",
  "err.react": "Could not add your reaction.",
  "err.respond": "Could not update that request.",
  "err.block": "Could not block them.",
  "err.unblock": "Could not unblock them.",
  "err.loadBlocked": "Could not load the people you blocked.",
  "err.report": "Could not send that report.",
  "err.createGroup": "Could not create the group.",
  "err.addMembers": "Could not add them to the group.",
  "err.removeMember": "Could not remove them from the group.",
  "err.renameGroup": "Could not rename the group.",
  "err.onlyContacts": "You can only add people you already chat with.",
  "err.groupFull": "A group can have up to 50 people.",
  "err.groupName": "The group name must be 1 to 60 characters.",
  "err.adminOnly": "Only a group admin can do that.",
  "err.pushSave": "Could not turn on notifications on this device.",
  "err.pushUnavailable": "Notifications are not available yet. Please try again later.",
} as const;

export type TKey = keyof typeof en;

const el: Record<TKey, string> = {
  "common.cancel": "Άκυρο",
  "common.close": "Κλείσιμο",
  "common.back": "Πίσω",
  "common.working": "Μια στιγμή…",
  "common.loading": "Φόρτωση…",

  "nav.chats": "Μηνύματα",
  "nav.find": "Βρες άτομα",
  "nav.settings": "Ρυθμίσεις",
  "nav.signOut": "Αποσύνδεση",

  "day.today": "Σήμερα",
  "day.yesterday": "Χθες",

  "login.titleLine1": "Μίλα ελεύθερα.",
  "login.titleLine2": "Κράτα τον αριθμό σου για σένα.",
  "login.lede":
    "Ένας messenger όπως τους ξέρεις, χτισμένος γύρω από το email σου — όχι το τηλέφωνό σου.",
  "login.email": "Διεύθυνση email",
  "login.password": "Κωδικός",
  "login.yourPassword": "Ο κωδικός σου",
  "login.passwordHint": "Τουλάχιστον 6 χαρακτήρες",
  "login.displayName": "Όνομα",
  "login.displayNameNote": "(για νέους λογαριασμούς)",
  "login.displayNameHint": "Πώς θα σε βλέπουν οι άλλοι",
  "login.signIn": "Σύνδεση",
  "login.createAccount": "Δημιουργία λογαριασμού",
  "login.consentBefore": "Δημιουργώντας λογαριασμό συμφωνείς με την",
  "login.privacyPolicy": "πολιτική απορρήτου",
  "login.consentAfter":
    "Τα μηνύματα αποθηκεύονται στους servers μας και δεν είναι κρυπτογραφημένα από άκρη σε άκρη.",
  "login.newHere": "Πρώτη φορά εδώ;",
  "login.forgot": "Ξέχασες τον κωδικό;",
  "login.haveAccount": "Έχεις ήδη λογαριασμό;",
  "login.or": "ή",
  "login.trust": "Επιβεβαίωση με email · Χωρίς τηλέφωνο",
  "login.pitchTitle":
    "Οι κουβέντες σου ανήκουν σε έναν messenger, όχι στα εισερχόμενα.",
  "login.pitchText":
    "Ζωντανή συνομιλία, αιτήματα και έλεγχος ιδιωτικότητας σε ένα ήρεμο μέρος.",
  "login.newPasswordTitle": "Όρισε νέο κωδικό.",
  "login.newPasswordText": "Διάλεξε καινούργιο κωδικό για τον λογαριασμό σου στο Mila.",
  "login.newPassword": "Νέος κωδικός",
  "login.updatePassword": "Αλλαγή κωδικού",
  "login.enterEmailFirst": "Γράψε πρώτα το email σου.",
  "login.enterValidEmail": "Γράψε ένα έγκυρο email.",
  "login.resetSent":
    "Σου στείλαμε email για αλλαγή κωδικού. Άνοιξε τον σύνδεσμο και όρισε νέο κωδικό.",
  "login.accountCreated":
    "Ο λογαριασμός δημιουργήθηκε. Άνοιξε το email που σου στείλαμε για να τον επιβεβαιώσεις, και μετά συνδέσου εδώ με τον κωδικό σου.",
  "login.noSession": "Η σύνδεση δεν ολοκληρώθηκε. Δοκίμασε ξανά.",
  "login.googleLoadFailed": "Δεν φόρτωσε η σύνδεση με Google.",
  "login.googleNoToken": "Η Google δεν ολοκλήρωσε τη σύνδεση.",
  "login.serverProblem":
    "Δεν μπορούμε να φτάσουμε στον server αυτή τη στιγμή. Δοκίμασε ξανά σε λίγο.",

  "home.title": "Τα μηνύματά σου, σε ένα μέρος",
  "home.text": "Διάλεξε μια συνομιλία ή βρες κάποιον με το email του.",

  "list.searchPlaceholder": "Αναζήτηση σε συνομιλίες και μηνύματα",
  "list.request": "Αίτημα συνομιλίας",
  "list.requestSent": "Το αίτημα στάλθηκε",
  "list.start": "Ξεκίνα την κουβέντα",
  "list.inMessages": "Μέσα στα μηνύματα",
  "list.emptyTitle": "Καμία συνομιλία ακόμα",
  "list.emptyText": "Βρες κάποιον με το email του και πες ένα γεια.",
  "list.noneTitle": "Δεν βρέθηκε τίποτα",
  "list.noneText": "Καμία συνομιλία ή μήνυμα δεν ταιριάζει με αυτό που έψαξες.",

  "people.searchPlaceholder": "Όνομα, username ή ολόκληρο email",
  "people.import": "Εισαγωγή επαφών email",
  "people.importHint":
    "Οι επαφές σου δεν φεύγουν από τη συσκευή σου — συγκρίνονται μόνο «ανακατεμένα» αποτυπώματα των email.",
  "people.imported": "Από τις επαφές σου ({n})",
  "people.privateEmail": "κρυφό email",
  "people.emptyTitle": "Βρες κάποιον",
  "people.emptyText":
    "Ψάξε με όνομα ή username, ή γράψε ολόκληρο το email του.",
  "people.noneTitle": "Δεν βρέθηκε κανείς",
  "people.noneText":
    "Έλεγξε την ορθογραφία. Για αναζήτηση με email, γράψε ολόκληρη τη διεύθυνση.",

  "chat.you": "Εσύ",
  "chat.group": "Ομάδα",
  "chat.deletedUser": "Διαγραμμένος χρήστης",
  "chat.unknownUser": "Άγνωστος",
  "chat.formerMember": "Πρώην μέλος",
  "chat.typing": "γράφει…",
  "chat.typingNamed": "{name} γράφει…",
  "chat.options": "Επιλογές συνομιλίας",
  "chat.details": "Στοιχεία επαφής",
  "chat.block": "Αποκλεισμός",
  "chat.unblock": "Άρση αποκλεισμού",
  "chat.blockTitle": "Αποκλεισμός: {name};",
  "chat.blockText":
    "Δεν θα μπορεί να σου στέλνει μηνύματα ούτε να σε βρίσκει. Δεν ειδοποιείται. Μπορείς να το αναιρέσεις από τις Ρυθμίσεις.",
  "chat.youBlocked": "Έχεις αποκλείσει: {name}.",
  "chat.accountDeleted": "Αυτός ο λογαριασμός διαγράφηκε. Δεν μπορείς να απαντήσεις.",
  "chat.report": "Αναφορά",
  "chat.reportTitle": "Αναφορά: {name}",
  "chat.reportText":
    "Πες μας με δυο λόγια τι έγινε. Ο άλλος δεν ειδοποιείται.",
  "chat.reportPlaceholder": "Ποιο είναι το πρόβλημα;",
  "chat.reportSend": "Αποστολή αναφοράς",
  "chat.reportThanks": "Ευχαριστούμε. Η αναφορά σου στάλθηκε.",
  "chat.loadOlder": "Δες παλαιότερα μηνύματα",
  "chat.emptyTitle": "Κανένα μήνυμα ακόμα",
  "chat.emptyText": "Γράψε κάτι για να ξεκινήσει η κουβέντα.",
  "chat.attach": "Στείλε φωτογραφία ή αρχείο",
  "chat.uploading": "Ανεβαίνει…",
  "chat.placeholder": "Γράψε ένα μήνυμα",
  "chat.send": "Αποστολή",

  "request.title": "{name} θέλει να σου μιλήσει",
  "request.text": "Αν δεχτείς, η συνομιλία μπαίνει κανονικά στα μηνύματά σου.",
  "request.accept": "Αποδοχή",
  "request.decline": "Απόρριψη",
  "request.waiting":
    "Το μήνυμά σου θα περιμένει εδώ μέχρι να δεχτεί το αίτημά σου: {name}.",

  "msg.deleted": "Το μήνυμα διαγράφηκε",
  "msg.encrypted": "Κρυπτογραφημένο μήνυμα",
  "msg.reply": "Απάντηση",
  "msg.copy": "Αντιγραφή",
  "msg.copyFailed": "Η αντιγραφή δεν έγινε.",
  "msg.delete": "Διαγραφή",
  "msg.deleteTitle": "Διαγραφή μηνύματος;",
  "msg.deleteTextOwn":
    "«Για όλους»: φεύγει από τη συνομιλία για όλους. «Για μένα»: κρύβεται μόνο από τη δική σου πλευρά.",
  "msg.deleteTextOther":
    "Θα κρυφτεί μόνο για σένα. Ο άλλος θα συνεχίσει να το βλέπει.",
  "msg.deleteForEveryone": "Διαγραφή για όλους",
  "msg.deleteForMe": "Διαγραφή για μένα",
  "msg.notFound": "Αυτό το μήνυμα δεν είναι πια διαθέσιμο.",

  "group.new": "Νέα ομάδα",
  "group.name": "Όνομα ομάδας",
  "group.namePlaceholder": "π.χ. Οικογένεια",
  "group.pickPeople": "Ποιοι θα είναι μέσα;",
  "group.noContacts":
    "Μπορείς να προσθέσεις ανθρώπους με τους οποίους μιλάς ήδη. Ξεκίνα πρώτα μια συνομιλία με κάποιον.",
  "group.create": "Δημιουργία ομάδας",
  "group.info": "Πληροφορίες ομάδας",
  "group.membersOne": "1 μέλος",
  "group.membersMany": "{n} μέλη",
  "group.admin": "Διαχειριστής",
  "group.addPeople": "Προσθήκη ατόμων",
  "group.add": "Προσθήκη",
  "group.rename": "Αλλαγή ονόματος",
  "group.remove": "Αφαίρεση",
  "group.removeTitle": "Αφαίρεση: {name};",
  "group.removeText":
    "Δεν θα βλέπει πια την ομάδα ούτε τα μηνύματά της.",
  "group.leave": "Αποχώρηση από την ομάδα",
  "group.leaveTitle": "Να φύγεις από την ομάδα;",
  "group.leaveText":
    "Δεν θα βλέπεις πια την ομάδα ούτε τα μηνύματά της. Ένας διαχειριστής μπορεί να σε ξαναβάλει.",

  "settings.displayName": "Όνομα",
  "settings.bio": "Λίγα λόγια για σένα",
  "settings.nameTooShort": "Το όνομα θέλει τουλάχιστον 2 χαρακτήρες.",
  "settings.save": "Αποθήκευση",
  "settings.saved": "Αποθηκεύτηκε.",
  "settings.privacy": "Ιδιωτικότητα",
  "settings.discover": "Ποιος μπορεί να με βρει στην αναζήτηση",
  "settings.discoverEveryone": "Όλοι",
  "settings.discoverContacts": "Μόνο όσοι μιλάμε ήδη",
  "settings.discoverNobody": "Κανείς",
  "settings.discoverHint":
    "«Όλοι»: με το όνομα, το username, ή γράφοντας ολόκληρο το email σου. Ποτέ με κομμάτι του email.",
  "settings.showEmail": "Ποιος βλέπει το email μου",
  "settings.showEmailContacts": "Όσοι μιλάμε",
  "settings.showEmailNobody": "Κανείς",
  "settings.showEmailHint":
    "Μόνο αφού έχεις δεχτεί τη συνομιλία. Οι άγνωστοι δεν το βλέπουν ποτέ.",
  "settings.receipts": "Ένδειξη «διαβάστηκε»",
  "settings.receiptsHint": "Οι άλλοι βλέπουν πότε διάβασες τα μηνύματά τους",
  "settings.language": "Γλώσσα",
  "settings.notifications": "Ειδοποιήσεις",
  "settings.blocked": "Αποκλεισμένοι",
  "settings.blockedNone": "Δεν έχεις αποκλείσει κανέναν.",
  "settings.storageNote":
    "Τα μηνύματα αποθηκεύονται στους servers μας και δεν είναι κρυπτογραφημένα από άκρη σε άκρη. Το email σου δεν δίνεται πουθενά χωρίς να το πεις εσύ, και δεν ζητάμε ποτέ τηλέφωνο.",

  "push.toggle": "Ειδοποίησέ με για νέα μηνύματα",
  "push.toggleHint": "Σε αυτή τη συσκευή, ακόμα κι όταν το Mila είναι κλειστό",
  "push.unsupported":
    "Αυτός ο browser δεν μπορεί να δείξει ειδοποιήσεις. Στο iPhone, βάλε πρώτα το Mila στην αρχική οθόνη (Κοινή χρήση → Προσθήκη στην οθόνη Αφετηρίας) και άνοιξέ το από εκεί.",
  "push.blocked":
    "Οι ειδοποιήσεις για το Mila είναι κλειστές στις ρυθμίσεις του browser σου. Επίτρεψέ τες εκεί και ξαναέλα.",

  "account.title": "Ο λογαριασμός σου",
  "account.readPolicy": "Διάβασε την πολιτική απορρήτου",
  "account.readPolicyAfter": "— τι κρατάμε, και τι μένει πίσω αν φύγεις.",
  "account.changePassword": "Αλλαγή κωδικού",
  "account.savePassword": "Αποθήκευση νέου κωδικού",
  "account.passwordUpdated": "Ο κωδικός άλλαξε.",
  "account.download": "Λήψη των δεδομένων μου",
  "account.preparing": "Ετοιμάζεται…",
  "account.downloadHint":
    "Ένα αρχείο με το προφίλ σου, τις συνομιλίες σου και κάθε μήνυμα που έστειλες. Δεν σβήνεται τίποτα.",
  "account.delete": "Διαγραφή του λογαριασμού μου",
  "account.deleteTitle": "Διαγραφή λογαριασμού",
  "account.deleteIntroBefore": "Αυτό δεν αναιρείται. Το",
  "account.deleteIntroAfter":
    "θα ελευθερωθεί και δεν θα μπορείς να ξανασυνδεθείς.",
  "account.deleteItem1":
    "Σβήνονται η σύνδεση, ο κωδικός και η σύνδεσή σου με Google.",
  "account.deleteItem2": "Σβήνονται το όνομα, η φωτογραφία και τα στοιχεία του προφίλ σου.",
  "account.deleteItem3":
    "Τα μηνύματα που έχεις ήδη στείλει μένουν στη συνομιλία του άλλου, ως μηνύματα διαγραμμένου χρήστη.",
  "account.typeDeleteBefore": "Γράψε",
  "account.typeDeleteAfter": "για επιβεβαίωση",
  "account.keep": "Κρατάω τον λογαριασμό",
  "account.deleting": "Διαγράφεται…",
  "account.deletePermanently": "Οριστική διαγραφή",

  "crash.title": "Κάτι χάλασε.",
  "crash.text":
    "Αντίγραψε το παρακάτω κείμενο και στείλ' το — λέει ακριβώς τι απέτυχε και πού.",
  "crash.reload": "Επαναφόρτωση",

  "err.generic": "Κάτι πήγε στραβά. Δοκίμασε ξανά.",
  "err.network": "Δεν υπάρχει σύνδεση. Έλεγξε το ίντερνετ και δοκίμασε ξανά.",
  "err.notConfigured": "Η εφαρμογή δεν είναι σωστά ρυθμισμένη (λείπουν τα στοιχεία του server).",
  "err.signedOut": "Έχεις αποσυνδεθεί. Συνδέσου ξανά.",
  "err.invalidLogin": "Λάθος email ή κωδικός.",
  "err.emailNotConfirmed":
    "Επιβεβαίωσε πρώτα το email σου — άνοιξε τον σύνδεσμο που σου στείλαμε, και μετά συνδέσου.",
  "err.alreadyRegistered":
    "Υπάρχει ήδη λογαριασμός με αυτό το email. Κάνε σύνδεση.",
  "err.passwordShort": "Ο κωδικός θέλει τουλάχιστον 6 χαρακτήρες.",
  "err.samePassword": "Διάλεξε κωδικό διαφορετικό από τον τωρινό.",
  "err.rateLimitSeconds": "Πολλές προσπάθειες. Δοκίμασε ξανά σε {n} δευτερόλεπτα.",
  "err.rateLimit": "Πολλές προσπάθειες. Περίμενε λίγο και δοκίμασε ξανά.",
  "err.loadProfile": "Δεν φόρτωσε το προφίλ σου.",
  "err.saveProfile": "Το προφίλ σου δεν αποθηκεύτηκε.",
  "err.export": "Η εξαγωγή των δεδομένων σου απέτυχε.",
  "err.deleteAccount": "Ο λογαριασμός δεν διαγράφηκε.",
  "err.alreadyDeleted": "Αυτός ο λογαριασμός έχει ήδη διαγραφεί.",
  "err.search": "Η αναζήτηση δεν είναι διαθέσιμη αυτή τη στιγμή.",
  "err.matchContacts": "Δεν έγινε η αντιστοίχιση των επαφών σου.",
  "err.fileTooLarge": "Το αρχείο ξεπερνά το όριο των 15 MB.",
  "err.upload": "Το ανέβασμα απέτυχε.",
  "err.loadChats": "Δεν φόρτωσαν οι συνομιλίες σου.",
  "err.loadMessages": "Δεν φόρτωσαν τα μηνύματα.",
  "err.startChat": "Η συνομιλία δεν ξεκίνησε.",
  "err.notAllowed": "Δεν μπορείς να ξεκινήσεις συνομιλία με αυτό το άτομο.",
  "err.send": "Το μήνυμα δεν στάλθηκε.",
  "err.cannotSend": "Δεν μπορείς να στείλεις μηνύματα σε αυτή τη συνομιλία.",
  "err.tooLong": "Το μήνυμα είναι πολύ μεγάλο.",
  "err.deleteMessage": "Το μήνυμα δεν διαγράφηκε.",
  "err.onlySender": "Μόνο όποιος έστειλε ένα μήνυμα μπορεί να το διαγράψει για όλους.",
  "err.react": "Η αντίδρασή σου δεν μπήκε.",
  "err.respond": "Το αίτημα δεν ενημερώθηκε.",
  "err.block": "Ο αποκλεισμός δεν έγινε.",
  "err.unblock": "Η άρση αποκλεισμού δεν έγινε.",
  "err.loadBlocked": "Δεν φόρτωσε η λίστα αποκλεισμένων.",
  "err.report": "Η αναφορά δεν στάλθηκε.",
  "err.createGroup": "Η ομάδα δεν δημιουργήθηκε.",
  "err.addMembers": "Δεν προστέθηκαν στην ομάδα.",
  "err.removeMember": "Δεν αφαιρέθηκε από την ομάδα.",
  "err.renameGroup": "Το όνομα της ομάδας δεν άλλαξε.",
  "err.onlyContacts": "Μπορείς να προσθέσεις μόνο ανθρώπους με τους οποίους μιλάς ήδη.",
  "err.groupFull": "Μια ομάδα χωράει μέχρι 50 άτομα.",
  "err.groupName": "Το όνομα της ομάδας πρέπει να έχει 1 έως 60 χαρακτήρες.",
  "err.adminOnly": "Αυτό μπορεί να το κάνει μόνο διαχειριστής της ομάδας.",
  "err.pushSave": "Οι ειδοποιήσεις δεν ενεργοποιήθηκαν σε αυτή τη συσκευή.",
  "err.pushUnavailable": "Οι ειδοποιήσεις δεν είναι ακόμα διαθέσιμες. Δοκίμασε αργότερα.",
};

const dictionaries: Record<Lang, Record<TKey, string>> = { en, el };

export function t(key: TKey, params?: Record<string, string | number>): string {
  let text: string = dictionaries[lang][key] ?? en[key] ?? key;
  if (params)
    for (const [name, value] of Object.entries(params))
      text = text.split(`{${name}}`).join(String(value));
  return text;
}

// Τα μηνύματα σφάλματος της Supabase και της βάσης έρχονται στα Αγγλικά. Όσα
// συναντά ένας κανονικός χρήστης μεταφράζονται εδώ· τα υπόλοιπα (σπάνια,
// τεχνικά) περνάνε όπως είναι, για να μπορεί να μας τα πει.
const KNOWN_ERRORS: Array<[RegExp, TKey]> = [
  [/invalid login credentials/i, "err.invalidLogin"],
  [/email not confirmed/i, "err.emailNotConfirmed"],
  [/already registered|already been registered/i, "err.alreadyRegistered"],
  [/password should be at least/i, "err.passwordShort"],
  [/should be different from the old password/i, "err.samePassword"],
  [/rate limit|too many requests/i, "err.rateLimit"],
  [/failed to fetch|networkerror|load failed|network request failed/i, "err.network"],
  [/cannot send messages to this conversation/i, "err.cannotSend"],
  [/row-level security policy for table "messages"/i, "err.cannotSend"],
  [/message is too long/i, "err.tooLong"],
  [/only the sender can delete/i, "err.onlySender"],
  [/only add people you already chat with/i, "err.onlyContacts"],
  [/up to 50 people/i, "err.groupFull"],
  [/group name must be/i, "err.groupName"],
  [/only a group admin/i, "err.adminOnly"],
  [/conversation not allowed/i, "err.notAllowed"],
  [/not authenticated|jwt expired|you are signed out/i, "err.signedOut"],
  [/έχει ήδη διαγραφεί/, "err.alreadyDeleted"],
];

/** Το μήνυμα στη γλώσσα του χρήστη, ή "" αν δεν το αναγνωρίζουμε. */
export function translateError(message?: string | null): string {
  if (!message) return "";
  const seconds = message.match(/only request this after (\d+) seconds/i);
  if (seconds) return t("err.rateLimitSeconds", { n: seconds[1] });
  for (const [pattern, key] of KNOWN_ERRORS)
    if (pattern.test(message)) return t(key);
  return "";
}
