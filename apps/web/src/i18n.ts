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

/** Ετικέτα γλώσσας που δέχεται το Intl. Μερικά Linux δίνουν π.χ. «en-US@posix»,
 *  που κάνει το Intl να πετάει σφάλμα και ρίχνει όλη τη σελίδα. */
function intlSafe(tag: string | undefined, fallback: string): string {
  try {
    return tag && Intl.DateTimeFormat.supportedLocalesOf([tag]).length
      ? tag
      : fallback;
  } catch {
    return fallback;
  }
}

/** Για ώρες και ημερομηνίες (Intl). */
export const locale: string =
  lang === "el"
    ? "el-GR"
    : navigator.language?.toLowerCase().startsWith("en")
      ? intlSafe(navigator.language, "en-GB")
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
  "login.passwordHint": "At least 8 characters",
  "login.displayName": "Display name",
  "login.displayNameNote": "(new accounts)",
  "login.displayNameHint": "How people know you",
  "login.signIn": "Sign in",
  "login.createAccount": "Create account",
  "login.consentAfter":
    "Messages are end-to-end encrypted: they are locked on your device before they leave it.",
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
  "login.googleContinue": "Continue with Google",
  "landing.lede":
    "A familiar messenger that uses your email instead of your phone number. Messages, calls and video calls are locked on your device before they leave it, and even we can't read or hear them.",
  "landing.create": "Create an account",
  "landing.install": "Put it on your phone",
  "landing.small": "Free · No ads · No phone number",
  "landing.demoName": "Helen K.",
  "landing.demoNote": "End-to-end encrypted",
  "landing.demo1": "Coffee tomorrow?",
  "landing.demo2": "Yes! 11 at the usual place 😊",
  "landing.demo3": "Perfect, see you 🙌",
  "landing.f1Title": "Email, not a phone number",
  "landing.f1Text": "You sign up with your email. We never ask for your number, and nobody sees it.",
  "landing.f2Title": "End-to-end encrypted",
  "landing.f2Text": "Messages and photos are locked on your device. Our server only ever holds scrambled data.",
  "landing.f3Title": "Not findable by just anyone",
  "landing.f3Text": "There is no list of users. Only people who know your full email can find you, and you accept their request first.",
  "landing.f5Title": "Calls and video calls",
  "landing.f5Text": "One to one or with up to 8 people. Sound and picture go straight between your devices, encrypted end to end.",
  "landing.f6Title": "Voice messages, photos, videos",
  "landing.f6Text": "Hold the microphone and talk. Send photos, videos and files, reply, react, edit or forward, like you're used to.",
  "landing.f4Title": "No ads, no tracking",
  "landing.f4Text": "We don't sell data, run analytics, or load anything from third parties unless you ask for it.",
  "landing.stepsTitle": "Up and running in a minute",
  "landing.step1": "Create an account with your email.",
  "landing.step2": "Add Mila to your phone's home screen.",
  "landing.step3": "Type a friend's full email and say hi.",
  "landing.qrTitle": "On a computer?",
  "landing.qrText": "Scan this with your phone's camera.",
  "landing.honest":
    "Mila is new and grows with its first users. If something is missing or doesn't work, we want to know.",
  "landing.footerInstall": "Install",
  "invite.title": "Invite a friend",
  "invite.lede": "Mila gets better with your people in it. Send them a ready-made invitation.",
  "invite.field": "Their mobile number or email",
  "invite.placeholder": "69… or name@example.com",
  "invite.privacyTitle": "It never leaves your phone.",
  "invite.privacyText":
    "The number or email you type here is not stored anywhere and is never sent to Mila. It only opens your own SMS, WhatsApp or email app with the message ready.",
  "invite.includeEmail": "Add my email ({email}) so they can find me",
  "invite.message":
    "Hi! Join me on Mila, a messenger that uses email instead of your phone number, with end-to-end encrypted messages. It takes a minute to set up: {url}",
  "invite.findMe": "Find me by typing my email: {email}",
  "invite.subject": "Join me on Mila",
  "invite.sms": "Send SMS",
  "invite.whatsapp": "WhatsApp",
  "invite.email": "Send email",
  "invite.share": "Share…",
  "invite.copy": "Copy message",
  "invite.copied": "Copied. Paste it wherever you like.",
  "invite.opened": "Done. The number or email was not kept.",
  "invite.notRecognised": "Type a mobile number or a full email, or use Share.",
  "invite.notHere": "Not on Mila yet? Invite them",
  "landing.footerPrivacy": "Privacy",
  "login.backHome": "Back",
  "login.install": "How do I put Mila on my phone?",
  "account.install": "Put Mila on your phone or computer",
  "login.googleHint": "Tap Google's button to continue.",
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

  "people.searchPlaceholder": "Their full email address",
  "people.import": "Import email contacts",
  "people.importHint":
    "Your address book never leaves your device — only scrambled fingerprints of the emails are compared.",
  "people.imported": "From your contacts ({n})",
  "people.privateEmail": "private email",
  "people.emptyTitle": "Find someone",
  "people.emptyText":
    "Type their whole email address. Mila never lists strangers by name or by part of an email, so nobody can browse who is here.",
  "people.keepTyping": "Type the whole email address",
  "people.keepTypingText":
    "People you don't chat with yet only show up for their exact, full email.",
  "people.noneTitle": "No one found",
  "people.noneText":
    "Check the spelling. They may also have chosen not to be found.",

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
  "chat.encryptedNote": "Messages here are end-to-end encrypted. Only the people in this chat can read them.",
  "chat.safetyCode": "Safety code",
  "chat.safetyText":
    "Compare these numbers with {name} in person or on a call. If they match on both screens, no one is listening in between.",
  "chat.safetyNone":
    "{name} hasn't opened Mila since encryption was switched on, so there is nothing to compare yet.",
  "chat.safetyChanges": "The code changes when either of you adds or removes a device.",
  "chat.download": "Download",

  "request.title": "{name} wants to chat",
  "request.text": "Accept to move this conversation into your regular inbox.",
  "request.accept": "Accept",
  "request.decline": "Decline",
  "request.waiting":
    "Your message will wait here until {name} accepts your request.",

  "msg.deleted": "This message was deleted",
  "msg.encrypted": "Encrypted message",
  "msg.undecryptable": "Can't be read on this device",
  "msg.pendingKey": "Arrives when the sender opens Mila",
  "msg.waiting": "Waiting to be delivered",
  "msg.waitingNote":
    "{name} hasn't opened the new Mila yet. Messages with a clock are delivered once they open it and you open Mila again.",
  "msg.waitingNoteGroup":
    "Some members haven't opened the new Mila yet. Messages with a clock reach them once they open it and you open Mila again.",
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
    "\"Everyone\": only by typing your whole email. Never by name or part of your email.",
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
    "Messages and files are end-to-end encrypted: our servers store only scrambled data they can't read. Your email is never shared without your say-so, and we never ask for a phone number.",
  "settings.photo": "Profile photo",
  "settings.photoChange": "Change photo",
  "settings.photoAdd": "Add a photo",
  "settings.photoRemove": "Remove",
  "settings.photoHint": "Only people you chat with can see it. Location and camera details are stripped before upload.",
  "settings.security": "Encryption and devices",
  "settings.securityText":
    "Your messages are locked on this device with a key that never leaves it. Each device you use has its own key.",
  "settings.keyWarning":
    "If you clear this browser's data, its key is gone and older messages can't be opened here again.",
  "settings.ephemeral":
    "This browser can't store the key, so messages can only be read until you close Mila.",
  "settings.thisDevice": "This device",
  "settings.fingerprint": "Fingerprint",
  "settings.lastSeen": "Last used {date}",
  "settings.revoke": "Remove",
  "settings.revokeTitle": "Remove this device?",
  "settings.revokeText":
    "It stops receiving new messages straight away. Messages it already has stay on it.",
  "settings.legacyTitle": "Older messages",
  "settings.legacyText":
    "{n} messages you sent before encryption are still stored as plain text on our server.",
  "settings.legacyDelete": "Delete them for everyone",
  "settings.legacyConfirm":
    "They disappear from every chat, for you and for the people you sent them to. This can't be undone.",
  "settings.legacyDone": "Done. {n} messages deleted.",

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
  "err.passwordShort": "Password must be at least 8 characters.",
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
  "err.fileTooLarge": "That file is larger than the 50 MB limit.",
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
  "err.avatar": "Could not update your photo.",
  "err.avatarType": "Choose an image file (JPEG, PNG or similar).",
  "err.noCrypto":
    "This browser can't encrypt messages. Open Mila over https in an up-to-date browser.",
  "err.device":
    "Could not set up encryption on this device. Check your connection and try again.",
  "err.download": "Could not open that file.",
  "err.limitUploads": "You've sent a lot of files recently. Please try again later.",
  "err.limitGeneric": "You're doing that too often. Please try again later.",
  "err.limitMessages": "You're sending messages very fast. Wait a moment and try again.",
  "err.limitRequests": "You've started many new conversations recently. Try again later.",
  "err.limitLookup": "Too many email searches for now. Try again in an hour.",
  "err.tooManyContacts": "That file has more than 500 email addresses.",
  "err.waitForAccept": "You can send up to 3 messages until they accept your request.",
  "err.recipientNoKeys":
    "They need to open Mila once before you can send them encrypted messages.",
  "err.mustEncrypt": "Please reload Mila to get the latest version.",
  "err.signupBusy": "We can't create new accounts right now. Please try again in a little while.",

  "export.otherDevice": "Encrypted for another of your devices; it can't be opened here.",

  "call.errPermission":
    "Mila needs your microphone for calls. Allow it in your browser's site settings and try again.",
  "call.errNoMic": "No microphone was found on this device.",
  "call.errDeviceBusy": "Another app is using the microphone or camera. Close it and try again.",
  "call.errMedia": "The microphone or camera could not be opened.",
  "call.errUnsupported": "This browser can't make calls. Open Mila over https in an up-to-date browser.",
  "call.cameraFailed": "The camera could not be opened, so this is a voice call.",
  "call.micLost": "The microphone stopped. Another app may have taken it.",
  "call.errConnect": "The call could not connect. One of the networks may be blocking calls.",
  "call.incomingVoice": "Incoming call",
  "call.incomingVideo": "Incoming video call",
  "call.errAlreadyIn": "You are already on a call.",
  "call.answeredElsewhere": "You answered on another device.",
  "call.alreadyEnded": "That call has already ended.",
  "err.edit": "Could not edit that message.",
  "err.call": "The call could not be started.",
  "err.loadCalls": "Could not load your calls.",

  "nav.calls": "Calls",
  "common.next": "Next",
  "presence.online": "online",
  "presence.lastSeenToday": "last seen today at {time}",
  "presence.lastSeenYesterday": "last seen yesterday at {time}",
  "presence.lastSeenDate": "last seen {date} at {time}",

  "list.archived": "Archived",
  "list.archivedTitle": "Archived",
  "list.archivedEmpty": "No archived chats",
  "list.archivedHint": "Archive a chat from its menu to tuck it away here. It keeps all its messages.",

  "chat.voiceCall": "Voice call",
  "chat.videoCall": "Video call",
  "chat.recording": "recording audio…",
  "chat.recordingNamed": "{name} is recording audio…",
  "chat.mute": "Mute notifications",
  "chat.unmute": "Unmute notifications",
  "chat.muted": "Muted",
  "chat.mutedDone": "Notifications muted.",
  "chat.unmuted": "Notifications are back on.",
  "chat.muteTitle": "Mute notifications",
  "chat.muteText": "You still get the messages, just without a notification or sound. Calls from this person still ring.",
  "chat.mute_8h": "8 hours",
  "chat.mute_week": "1 week",
  "chat.mute_always": "Always",
  "chat.pin": "Pin to top",
  "chat.unpin": "Unpin",
  "chat.pinned": "Pinned",
  "chat.archive": "Archive chat",
  "chat.unarchive": "Unarchive",
  "chat.archived": "Chat archived.",
  "chat.unarchived": "Chat moved back to your list.",
  "chat.unreadOne": "1 unread message",
  "chat.unreadMany": "{n} unread messages",
  "chat.scrollDown": "Go to the latest message",
  "chat.dropHere": "Drop files to send them",
  "chat.sendingN": "Sending {i} of {n}…",

  "attach.gallery": "Photos and videos",
  "attach.camera": "Camera",
  "attach.document": "Document",

  "send.title": "Send {n}",
  "send.preparing": "Getting it ready…",
  "send.caption": "Add a caption",
  "send.tooMany": "You can send up to {n} at a time. The rest were left out.",

  "msg.photo": "Photo",
  "msg.video": "Video",
  "msg.voice": "Voice message",
  "msg.forward": "Forward",
  "msg.forwarded": "Forwarded",
  "msg.forwardTo": "Forward to…",
  "msg.forwardSend": "Send {n}",
  "msg.forwardLimit": "You can forward to up to {n} chats at once.",
  "msg.forwardedOne": "Forwarded.",
  "msg.forwardedMany": "Forwarded to {n} chats.",
  "msg.edit": "Edit",
  "msg.edited": "edited",
  "msg.editing": "Edit message",
  "msg.saveEdit": "Save",
  "msg.copied": "Copied.",
  "msg.sent": "Sent",
  "msg.delivered": "Delivered",
  "msg.read": "Read",

  "emoji.title": "Emoji",
  "emoji.recent": "Recent",
  "emoji.smileys": "Smileys",
  "emoji.people": "People and gestures",
  "emoji.hearts": "Hearts and symbols",
  "emoji.nature": "Animals and nature",
  "emoji.food": "Food and drink",
  "emoji.activity": "Activities and things",
  "emoji.noRecent": "The emoji you use most will show up here.",

  "voice.record": "Record a voice message",
  "voice.holdToRecord": "Hold to record, release to send",
  "voice.slideToCancel": "Slide to cancel",
  "voice.cancel": "Delete recording",
  "voice.pause": "Pause",
  "voice.resume": "Continue recording",
  "voice.play": "Play",
  "voice.position": "Playback position",
  "voice.speed": "Playback speed",
  "voice.tooShort": "Hold the microphone button down while you talk.",
  "voice.errPermission": "Mila needs your microphone to record. Allow it in your browser's site settings.",
  "voice.errStart": "The microphone could not be opened.",

  "call.title": "Call",
  "call.someone": "Someone",
  "call.isCalling": "{name} is calling…",
  "call.encrypted": "End-to-end encrypted",
  "call.starting": "Starting…",
  "call.ringing": "Ringing…",
  "call.ringingGroup": "Ringing everyone…",
  "call.ringingShort": "ringing",
  "call.connecting": "Connecting…",
  "call.reconnecting": "Reconnecting…",
  "call.ended": "Call ended",
  "call.declined": "Declined",
  "call.busy": "On another call",
  "call.noAnswer": "No answer",
  "call.failed": "Couldn't connect",
  "call.answer": "Answer",
  "call.answerVoice": "Voice only",
  "call.decline": "Decline",
  "call.endAndAnswer": "End and answer",
  "call.hangUp": "End call",
  "call.minimize": "Back to the chats",
  "call.tapToReturn": "Tap to return",
  "call.tapForSound": "Tap to hear the call",
  "call.theyMuted": "{name} muted their microphone",
  "call.mute": "Mute",
  "call.unmute": "Unmute",
  "call.cameraOn": "Turn camera on",
  "call.cameraOff": "Turn camera off",
  "call.flip": "Switch camera",
  "call.share": "Share your screen",
  "call.stopShare": "Stop sharing",
  "call.errNotAccepted": "You can call once they accept your request.",
  "call.errNotAllowed": "You can't call this conversation.",
  "call.errFull": "This call is full (8 people).",
  "call.errLimit": "You've made a lot of calls recently. Try again later.",

  "calls.incomingVoice": "Incoming call",
  "calls.incomingVideo": "Incoming video call",
  "calls.outgoingVoice": "Outgoing call",
  "calls.outgoingVideo": "Outgoing video call",
  "calls.missedVoice": "Missed call",
  "calls.missedVideo": "Missed video call",
  "calls.ongoingVoice": "Call in progress",
  "calls.ongoingVideo": "Video call in progress",
  "calls.youDeclined": "Declined",
  "calls.join": "Join",
  "calls.callBack": "Call back",
  "calls.emptyTitle": "No calls yet",
  "calls.emptyText": "Open a chat and tap the phone or camera at the top. Calls are encrypted end to end, like your messages.",

  "settings.online": "Online status and last seen",
  "settings.onlineHint": "If you hide yours, you won't see other people's either.",

  "err.editWindow": "Messages can only be edited for 15 minutes after sending.",
  "err.pinLimit": "You can pin up to 3 chats.",

  // --- safety ---
  "report.titleMessage": "Report this message",
  "report.titleGroup": "Report the group {name}",
  "report.textGroup": "Tell us briefly what happened. Nobody in the group is told.",
  "report.group": "Report group",
  "report.shareMessage": "Also send the text of this message to the moderators",
  "report.shareRecent": "Also send the last {n} messages of this chat to the moderators",
  "report.shareHint":
    "Messages are end-to-end encrypted, so the moderators can't read them. They only see the text you choose to send here.",
  "report.nothingToShare":
    "Messages are end-to-end encrypted, so the moderators can't read them. They will see who you reported and when.",
  "report.preview": "This is exactly what will be sent:",
  "report.attachment": "[file: {name}]",
  "report.voice": "[voice message]",
  "report.errTarget": "This can no longer be reported.",
  "report.errSelf": "You can't report yourself.",
  "report.errReason": "Write a few words about what happened (up to 500 characters).",
  "report.errLimit": "You've sent a lot of reports today. Try again tomorrow.",
  "err.suspended": "Your account is suspended.",
  "err.nameReserved": "This name is reserved. Please choose another one.",
  "err.nameLength": "Your name must be between 2 and 60 characters.",
  "err.enterPassword": "Enter your password.",
  "suspended.title": "Your account has been suspended",
  "suspended.text":
    "Since {date} you can't send messages, call or find people on Mila. Your data has not been deleted.",
  "suspended.reason": "The moderators' reason:",
  "suspended.noReason": "The moderators did not add a note.",
  "suspended.contestBefore": "If you think this is a mistake, write to us at the address in our",
  "suspended.contestLink": "privacy policy",
  "suspended.contestAfter": ". We will look at it again.",
  "suspended.stillCan": "You can still download your data or delete your account.",
  "account.signOutEverywhere": "Sign out on all devices",
  "account.signOutEverywhereText":
    "Every phone and computer signed in to your account is signed out, this one too, and none of them gets notifications any more. Useful if you lost a device or signed in somewhere you don't trust.",

  // --- calls ---
  "call.answerNoPermission":
    "You couldn't answer: Mila isn't allowed to use your microphone. Allow it in your browser's settings for this site, then call them back.",
  "call.answerNoMic": "You couldn't answer: no microphone was found on this device.",
  "call.answerMicBusy":
    "You couldn't answer: another app is using the microphone. Close it, then call them back.",
  "call.answerMediaFailed":
    "You couldn't answer: the microphone didn't open. Call them back to try again.",

  // --- messaging ---
  "outbox.sending": "Sending…",
  "outbox.failed": "Not sent. Tap to try again.",
  "outbox.retry": "Try again",
  "outbox.delete": "Delete",
  "pushCard.title": "Turn on notifications",
  "pushCard.text": "Know straight away when a message or a call comes in, even when Mila is closed.",
  "pushCard.enable": "Turn on",
  "pushCard.dismiss": "Not now",
  "pushCard.iosTitle": "Notifications on iPhone and iPad",
  "pushCard.iosText":
    "Add Mila to your Home Screen and open it from there: tap Share, then “Add to Home Screen”.",
  "pushCard.done": "Notifications are on.",
  "pushAsk.title": "Don't miss a call",
  "pushAsk.text":
    "Turn on notifications so you hear it when someone calls you, even when Mila is closed.",
  "squeeze.note": "Large video: it will be made smaller (720p) before it's sent.",
  "squeeze.working": "Making the video smaller… {p}%",
  "squeeze.workingN": "Making video {i} of {n} smaller… {p}%",
  "squeeze.keepOpen": "Keep Mila open until it's done.",

  // --- legal ---
  "legal.consentBefore": "By creating an account you accept the",
  "legal.googleConsentBefore":
    "If you are new, continuing with Google creates an account and you accept the",
  "legal.terms": "terms of use",
  "legal.and": "and the",
  "legal.privacy": "privacy policy",
  "legal.readTerms": "Read the terms of use",
  "legal.readTermsAfter": "— the rules everyone here agrees to.",
  "legal.footerTerms": "Terms",
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
  "login.passwordHint": "Τουλάχιστον 8 χαρακτήρες",
  "login.displayName": "Όνομα",
  "login.displayNameNote": "(για νέους λογαριασμούς)",
  "login.displayNameHint": "Πώς θα σε βλέπουν οι άλλοι",
  "login.signIn": "Σύνδεση",
  "login.createAccount": "Δημιουργία λογαριασμού",
  "login.consentAfter":
    "Τα μηνύματα κρυπτογραφούνται από άκρη σε άκρη: κλειδώνουν στη συσκευή σου πριν φύγουν από αυτήν.",
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
  "login.googleContinue": "Συνέχεια με Google",
  "landing.lede":
    "Ένας messenger όπως τους ξέρεις, με το email σου αντί για τηλέφωνο. Μηνύματα, κλήσεις και βιντεοκλήσεις κλειδώνουν στη συσκευή σου πριν φύγουν, και ούτε εμείς δεν μπορούμε να τα διαβάσουμε ή να τα ακούσουμε.",
  "landing.create": "Φτιάξε λογαριασμό",
  "landing.install": "Βάλ' το στο κινητό",
  "landing.small": "Δωρεάν · Χωρίς διαφημίσεις · Χωρίς αριθμό τηλεφώνου",
  "landing.demoName": "Ελένη Κ.",
  "landing.demoNote": "Κρυπτογραφημένο από άκρη σε άκρη",
  "landing.demo1": "Πάμε για καφέ αύριο;",
  "landing.demo2": "Ναι! 11 στο γνωστό 😊",
  "landing.demo3": "Τέλεια, τα λέμε 🙌",
  "landing.f1Title": "Email, όχι τηλέφωνο",
  "landing.f1Text": "Γράφεσαι με το email σου. Τον αριθμό σου δεν τον ζητάμε ποτέ, και δεν τον βλέπει κανείς.",
  "landing.f2Title": "Κρυπτογράφηση από άκρη σε άκρη",
  "landing.f2Text": "Μηνύματα και φωτογραφίες κλειδώνουν στη συσκευή σου. Ο server μας κρατάει μόνο ανακατεμένα δεδομένα.",
  "landing.f3Title": "Δεν σε βρίσκει όποιος να 'ναι",
  "landing.f3Text": "Δεν υπάρχει λίστα χρηστών. Σε βρίσκουν μόνο όσοι ξέρουν ολόκληρο το email σου, και πρώτα δέχεσαι εσύ το αίτημα.",
  "landing.f5Title": "Κλήσεις και βιντεοκλήσεις",
  "landing.f5Text": "Ένας με έναν ή έως 8 άτομα μαζί. Ήχος και εικόνα πάνε κατευθείαν από συσκευή σε συσκευή, κρυπτογραφημένα από άκρη σε άκρη.",
  "landing.f6Title": "Φωνητικά, φωτογραφίες, βίντεο",
  "landing.f6Text": "Κρατάς το μικρόφωνο και μιλάς. Στέλνεις φωτογραφίες, βίντεο και αρχεία, απαντάς, αντιδράς, διορθώνεις ή προωθείς, όπως έχεις συνηθίσει.",
  "landing.f4Title": "Χωρίς διαφημίσεις, χωρίς παρακολούθηση",
  "landing.f4Text": "Δεν πουλάμε δεδομένα, δεν έχουμε analytics, δεν φορτώνουμε τίποτα από τρίτους αν δεν το ζητήσεις.",
  "landing.stepsTitle": "Ξεκινάς σε ένα λεπτό",
  "landing.step1": "Φτιάξε λογαριασμό με το email σου.",
  "landing.step2": "Βάλε το Mila στην αρχική οθόνη του κινητού σου.",
  "landing.step3": "Γράψε ολόκληρο το email ενός φίλου και πες του «γεια».",
  "landing.qrTitle": "Από υπολογιστή;",
  "landing.qrText": "Σκάναρε τον κωδικό με την κάμερα του κινητού σου.",
  "landing.honest":
    "Το Mila είναι καινούργιο και μεγαλώνει μαζί με τους πρώτους του χρήστες. Αν κάτι σου λείπει ή δεν δουλεύει, θέλουμε να το ξέρουμε.",
  "landing.footerInstall": "Εγκατάσταση",
  "invite.title": "Κάλεσε φίλο",
  "invite.lede": "Το Mila έχει νόημα με τους δικούς σου ανθρώπους μέσα. Στείλε τους μια έτοιμη πρόσκληση.",
  "invite.field": "Το κινητό ή το email του",
  "invite.placeholder": "69… ή name@example.com",
  "invite.privacyTitle": "Δεν φεύγει από το κινητό σου.",
  "invite.privacyText":
    "Ο αριθμός ή το email που γράφεις εδώ δεν αποθηκεύεται πουθενά και δεν στέλνεται ποτέ στο Mila. Απλώς ανοίγει τα δικά σου SMS, WhatsApp ή email με το μήνυμα έτοιμο.",
  "invite.includeEmail": "Βάλε το email μου ({email}) για να με βρει",
  "invite.message":
    "Γεια! Έλα στο Mila, ένα messenger με email αντί για αριθμό τηλεφώνου, και τα μηνύματα κρυπτογραφούνται από άκρη σε άκρη. Μπαίνει στο κινητό σε ένα λεπτό: {url}",
  "invite.findMe": "Βρες με γράφοντας το email μου: {email}",
  "invite.subject": "Έλα στο Mila",
  "invite.sms": "Αποστολή SMS",
  "invite.whatsapp": "WhatsApp",
  "invite.email": "Αποστολή email",
  "invite.share": "Κοινοποίηση…",
  "invite.copy": "Αντιγραφή μηνύματος",
  "invite.copied": "Αντιγράφηκε. Επικόλλησέ το όπου θέλεις.",
  "invite.opened": "Έγινε. Ο αριθμός ή το email δεν κρατήθηκε πουθενά.",
  "invite.notRecognised": "Γράψε κινητό ή ολόκληρο email, ή πάτα Κοινοποίηση.",
  "invite.notHere": "Δεν είναι ακόμα στο Mila; Κάλεσέ τον",
  "landing.footerPrivacy": "Απόρρητο",
  "login.backHome": "Πίσω",
  "login.install": "Πώς βάζω το Mila στο κινητό μου;",
  "account.install": "Βάλε το Mila στο κινητό ή τον υπολογιστή σου",
  "login.googleHint": "Πάτα το κουμπί της Google για να συνεχίσεις.",
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

  "people.searchPlaceholder": "Ολόκληρο το email του",
  "people.import": "Εισαγωγή επαφών email",
  "people.importHint":
    "Οι επαφές σου δεν φεύγουν από τη συσκευή σου — συγκρίνονται μόνο «ανακατεμένα» αποτυπώματα των email.",
  "people.imported": "Από τις επαφές σου ({n})",
  "people.privateEmail": "κρυφό email",
  "people.emptyTitle": "Βρες κάποιον",
  "people.emptyText":
    "Γράψε ολόκληρη τη διεύθυνση email του. Το Mila δεν δείχνει ποτέ αγνώστους με όνομα ή κομμάτι email, οπότε κανείς δεν μπορεί να ξεφυλλίσει ποιος είναι εδώ.",
  "people.keepTyping": "Γράψε ολόκληρο το email",
  "people.keepTypingText":
    "Όσοι δεν είναι ακόμα επαφές σου εμφανίζονται μόνο με το ακριβές, ολόκληρο email τους.",
  "people.noneTitle": "Δεν βρέθηκε κανείς",
  "people.noneText":
    "Έλεγξε την ορθογραφία. Μπορεί επίσης να έχει διαλέξει να μη βρίσκεται.",

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
  "chat.encryptedNote": "Τα μηνύματα εδώ κρυπτογραφούνται από άκρη σε άκρη. Τα διαβάζουν μόνο όσοι είναι σε αυτή τη συνομιλία.",
  "chat.safetyCode": "Κωδικός ασφαλείας",
  "chat.safetyText":
    "Σύγκρινε αυτούς τους αριθμούς με τον/την {name} από κοντά ή σε τηλέφωνο. Αν είναι ίδιοι και στις δύο οθόνες, κανείς δεν παρεμβάλλεται ανάμεσά σας.",
  "chat.safetyNone":
    "Ο/Η {name} δεν έχει ανοίξει το Mila από τότε που μπήκε η κρυπτογράφηση, οπότε δεν υπάρχει ακόμα κάτι να συγκρίνετε.",
  "chat.safetyChanges": "Ο κωδικός αλλάζει όταν κάποιος από τους δύο προσθέσει ή αφαιρέσει συσκευή.",
  "chat.download": "Λήψη",

  "request.title": "{name} θέλει να σου μιλήσει",
  "request.text": "Αν δεχτείς, η συνομιλία μπαίνει κανονικά στα μηνύματά σου.",
  "request.accept": "Αποδοχή",
  "request.decline": "Απόρριψη",
  "request.waiting":
    "Το μήνυμά σου θα περιμένει εδώ μέχρι να δεχτεί το αίτημά σου: {name}.",

  "msg.deleted": "Το μήνυμα διαγράφηκε",
  "msg.encrypted": "Κρυπτογραφημένο μήνυμα",
  "msg.undecryptable": "Δεν διαβάζεται σε αυτή τη συσκευή",
  "msg.pendingKey": "Θα εμφανιστεί μόλις ανοίξει το Mila ο αποστολέας",
  "msg.waiting": "Σε αναμονή για παράδοση",
  "msg.waitingNote":
    "Ο/Η {name} δεν έχει ανοίξει ακόμα το νέο Mila. Τα μηνύματα με το ρολογάκι θα του παραδοθούν μόλις το ανοίξει και μπεις κι εσύ ξανά στο Mila.",
  "msg.waitingNoteGroup":
    "Κάποια μέλη δεν έχουν ανοίξει ακόμα το νέο Mila. Τα μηνύματα με το ρολογάκι θα τους παραδοθούν μόλις το ανοίξουν και μπεις κι εσύ ξανά στο Mila.",
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
    "«Όλοι»: μόνο όποιος γράψει ολόκληρο το email σου. Ποτέ με το όνομα ή με κομμάτι του email.",
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
    "Μηνύματα και αρχεία κρυπτογραφούνται από άκρη σε άκρη: ο server μας κρατάει μόνο ανακατεμένα δεδομένα που δεν μπορεί να διαβάσει. Το email σου δεν δίνεται πουθενά χωρίς να το πεις εσύ, και δεν ζητάμε ποτέ τηλέφωνο.",
  "settings.photo": "Φωτογραφία προφίλ",
  "settings.photoChange": "Αλλαγή φωτογραφίας",
  "settings.photoAdd": "Βάλε φωτογραφία",
  "settings.photoRemove": "Αφαίρεση",
  "settings.photoHint": "Τη βλέπουν μόνο όσοι μιλάτε. Τοποθεσία και στοιχεία κάμερας σβήνονται πριν ανέβει.",
  "settings.security": "Κρυπτογράφηση και συσκευές",
  "settings.securityText":
    "Τα μηνύματά σου κλειδώνουν σε αυτή τη συσκευή με κλειδί που δεν φεύγει ποτέ από αυτήν. Κάθε συσκευή που χρησιμοποιείς έχει το δικό της.",
  "settings.keyWarning":
    "Αν σβήσεις τα δεδομένα αυτού του browser, χάνεται και το κλειδί του, και τα παλιότερα μηνύματα δεν ανοίγουν πια εδώ.",
  "settings.ephemeral":
    "Αυτός ο browser δεν μπορεί να κρατήσει το κλειδί, οπότε τα μηνύματα διαβάζονται μόνο μέχρι να κλείσεις το Mila.",
  "settings.thisDevice": "Αυτή η συσκευή",
  "settings.fingerprint": "Αποτύπωμα",
  "settings.lastSeen": "Τελευταία χρήση {date}",
  "settings.revoke": "Αφαίρεση",
  "settings.revokeTitle": "Αφαίρεση αυτής της συσκευής;",
  "settings.revokeText":
    "Σταματάει αμέσως να λαμβάνει νέα μηνύματα. Όσα έχει ήδη μένουν σε αυτήν.",
  "settings.legacyTitle": "Παλιότερα μηνύματα",
  "settings.legacyText":
    "{n} μηνύματα που έστειλες πριν από την κρυπτογράφηση είναι ακόμα αποθηκευμένα σε απλό κείμενο στον server μας.",
  "settings.legacyDelete": "Διαγραφή τους για όλους",
  "settings.legacyConfirm":
    "Φεύγουν από κάθε συνομιλία, για σένα και για όσους τα έστειλες. Δεν γυρίζει πίσω.",
  "settings.legacyDone": "Έγινε. Διαγράφηκαν {n} μηνύματα.",

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
  "err.passwordShort": "Ο κωδικός θέλει τουλάχιστον 8 χαρακτήρες.",
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
  "err.fileTooLarge": "Το αρχείο ξεπερνά το όριο των 50 MB.",
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
  "err.avatar": "Η φωτογραφία δεν άλλαξε.",
  "err.avatarType": "Διάλεξε αρχείο εικόνας (JPEG, PNG ή παρόμοιο).",
  "err.noCrypto":
    "Αυτός ο browser δεν μπορεί να κρυπτογραφήσει μηνύματα. Άνοιξε το Mila από https σε ενημερωμένο browser.",
  "err.device":
    "Η κρυπτογράφηση δεν στήθηκε σε αυτή τη συσκευή. Έλεγξε τη σύνδεση και δοκίμασε ξανά.",
  "err.download": "Το αρχείο δεν άνοιξε.",
  "err.limitUploads": "Έστειλες πολλά αρχεία τελευταία. Δοκίμασε ξανά αργότερα.",
  "err.limitGeneric": "Το κάνεις πολύ συχνά. Δοκίμασε ξανά αργότερα.",
  "err.limitMessages": "Στέλνεις πολύ γρήγορα. Περίμενε λίγο και ξαναδοκίμασε.",
  "err.limitRequests": "Ξεκίνησες πολλές νέες συνομιλίες τελευταία. Δοκίμασε ξανά αργότερα.",
  "err.limitLookup": "Πολλές αναζητήσεις email για τώρα. Δοκίμασε ξανά σε μία ώρα.",
  "err.tooManyContacts": "Το αρχείο έχει πάνω από 500 διευθύνσεις email.",
  "err.waitForAccept": "Μέχρι να δεχτεί το αίτημά σου, μπορείς να στείλεις έως 3 μηνύματα.",
  "err.recipientNoKeys":
    "Πρέπει να ανοίξει το Mila μία φορά πριν μπορέσεις να του στείλεις κρυπτογραφημένο μήνυμα.",
  "err.mustEncrypt": "Ανανέωσε το Mila για να πάρεις την τελευταία έκδοση.",
  "err.signupBusy": "Δεν φτιάχνονται νέοι λογαριασμοί αυτή τη στιγμή. Δοκίμασε ξανά σε λίγο.",

  "export.otherDevice": "Κρυπτογραφημένο για άλλη συσκευή σου· δεν ανοίγει εδώ.",

  "call.errPermission":
    "Το Mila χρειάζεται το μικρόφωνο για τις κλήσεις. Επίτρεψέ το από τις ρυθμίσεις του browser για αυτό το site και ξαναδοκίμασε.",
  "call.errNoMic": "Δεν βρέθηκε μικρόφωνο σε αυτή τη συσκευή.",
  "call.errDeviceBusy": "Κάποια άλλη εφαρμογή χρησιμοποιεί το μικρόφωνο ή την κάμερα. Κλείσ' την και ξαναδοκίμασε.",
  "call.errMedia": "Δεν άνοιξε το μικρόφωνο ή η κάμερα.",
  "call.errUnsupported": "Αυτός ο browser δεν κάνει κλήσεις. Άνοιξε το Mila από https σε ενημερωμένο browser.",
  "call.cameraFailed": "Η κάμερα δεν άνοιξε, οπότε η κλήση είναι μόνο με φωνή.",
  "call.micLost": "Το μικρόφωνο σταμάτησε. Ίσως το πήρε άλλη εφαρμογή.",
  "call.errConnect": "Η κλήση δεν συνδέθηκε. Μάλλον κάποιο από τα δύο δίκτυα μπλοκάρει τις κλήσεις.",
  "call.incomingVoice": "Εισερχόμενη κλήση",
  "call.incomingVideo": "Εισερχόμενη βιντεοκλήση",
  "call.errAlreadyIn": "Είσαι ήδη σε κλήση.",
  "call.answeredElsewhere": "Απάντησες από άλλη συσκευή.",
  "call.alreadyEnded": "Η κλήση έχει ήδη τελειώσει.",
  "err.edit": "Το μήνυμα δεν άλλαξε.",
  "err.call": "Η κλήση δεν ξεκίνησε.",
  "err.loadCalls": "Δεν φόρτωσαν οι κλήσεις σου.",

  "nav.calls": "Κλήσεις",
  "common.next": "Επόμενο",
  "presence.online": "σε σύνδεση",
  "presence.lastSeenToday": "τελευταία φορά σήμερα στις {time}",
  "presence.lastSeenYesterday": "τελευταία φορά χθες στις {time}",
  "presence.lastSeenDate": "τελευταία φορά {date} στις {time}",

  "list.archived": "Αρχειοθετημένες",
  "list.archivedTitle": "Αρχείο",
  "list.archivedEmpty": "Καμία αρχειοθετημένη συνομιλία",
  "list.archivedHint": "Από το μενού μιας συνομιλίας μπορείς να τη βάλεις εδώ, να μη σου πιάνει χώρο. Τα μηνύματά της μένουν όλα.",

  "chat.voiceCall": "Κλήση",
  "chat.videoCall": "Βιντεοκλήση",
  "chat.recording": "ηχογραφεί…",
  "chat.recordingNamed": "{name} ηχογραφεί…",
  "chat.mute": "Σίγαση ειδοποιήσεων",
  "chat.unmute": "Άρση σίγασης",
  "chat.muted": "Σε σίγαση",
  "chat.mutedDone": "Οι ειδοποιήσεις μπήκαν σε σίγαση.",
  "chat.unmuted": "Οι ειδοποιήσεις ξανάνοιξαν.",
  "chat.muteTitle": "Σίγαση ειδοποιήσεων",
  "chat.muteText": "Τα μηνύματα έρχονται κανονικά, απλώς χωρίς ειδοποίηση και ήχο. Οι κλήσεις από αυτόν χτυπάνε κανονικά.",
  "chat.mute_8h": "8 ώρες",
  "chat.mute_week": "1 εβδομάδα",
  "chat.mute_always": "Πάντα",
  "chat.pin": "Καρφίτσωμα στην κορυφή",
  "chat.unpin": "Ξεκαρφίτσωμα",
  "chat.pinned": "Καρφιτσωμένη",
  "chat.archive": "Αρχειοθέτηση",
  "chat.unarchive": "Βγάλ' την από το αρχείο",
  "chat.archived": "Η συνομιλία πήγε στο αρχείο.",
  "chat.unarchived": "Η συνομιλία γύρισε στη λίστα σου.",
  "chat.unreadOne": "1 αδιάβαστο μήνυμα",
  "chat.unreadMany": "{n} αδιάβαστα μηνύματα",
  "chat.scrollDown": "Στο τελευταίο μήνυμα",
  "chat.dropHere": "Άφησε τα αρχεία εδώ για να σταλούν",
  "chat.sendingN": "Στέλνεται {i} από {n}…",

  "attach.gallery": "Φωτογραφίες και βίντεο",
  "attach.camera": "Κάμερα",
  "attach.document": "Έγγραφο",

  "send.title": "Αποστολή ({n})",
  "send.preparing": "Ετοιμάζεται…",
  "send.caption": "Γράψε λεζάντα",
  "send.tooMany": "Στέλνονται έως {n} τη φορά. Τα υπόλοιπα έμειναν έξω.",

  "msg.photo": "Φωτογραφία",
  "msg.video": "Βίντεο",
  "msg.voice": "Φωνητικό μήνυμα",
  "msg.forward": "Προώθηση",
  "msg.forwarded": "Προωθημένο",
  "msg.forwardTo": "Προώθηση σε…",
  "msg.forwardSend": "Αποστολή {n}",
  "msg.forwardLimit": "Μπορείς να προωθήσεις σε έως {n} συνομιλίες τη φορά.",
  "msg.forwardedOne": "Προωθήθηκε.",
  "msg.forwardedMany": "Προωθήθηκε σε {n} συνομιλίες.",
  "msg.edit": "Επεξεργασία",
  "msg.edited": "επεξεργασμένο",
  "msg.editing": "Επεξεργασία μηνύματος",
  "msg.saveEdit": "Αποθήκευση",
  "msg.copied": "Αντιγράφηκε.",
  "msg.sent": "Στάλθηκε",
  "msg.delivered": "Παραδόθηκε",
  "msg.read": "Διαβάστηκε",

  "emoji.title": "Emoji",
  "emoji.recent": "Πρόσφατα",
  "emoji.smileys": "Φατσούλες",
  "emoji.people": "Άνθρωποι και χειρονομίες",
  "emoji.hearts": "Καρδιές και σύμβολα",
  "emoji.nature": "Ζώα και φύση",
  "emoji.food": "Φαγητό και ποτό",
  "emoji.activity": "Δραστηριότητες και πράγματα",
  "emoji.noRecent": "Εδώ θα εμφανίζονται όσα χρησιμοποιείς συχνότερα.",

  "voice.record": "Ηχογράφηση φωνητικού",
  "voice.holdToRecord": "Κράτα πατημένο για ηχογράφηση, άφησε για αποστολή",
  "voice.slideToCancel": "Σύρε για ακύρωση",
  "voice.cancel": "Διαγραφή ηχογράφησης",
  "voice.pause": "Παύση",
  "voice.resume": "Συνέχεια ηχογράφησης",
  "voice.play": "Αναπαραγωγή",
  "voice.position": "Θέση αναπαραγωγής",
  "voice.speed": "Ταχύτητα αναπαραγωγής",
  "voice.tooShort": "Κράτα πατημένο το μικρόφωνο όσο μιλάς.",
  "voice.errPermission": "Το Mila χρειάζεται το μικρόφωνο για να ηχογραφήσει. Επίτρεψέ το από τις ρυθμίσεις του browser για αυτό το site.",
  "voice.errStart": "Δεν άνοιξε το μικρόφωνο.",

  "call.title": "Κλήση",
  "call.someone": "Κάποιος",
  "call.isCalling": "Σε καλεί: {name}",
  "call.encrypted": "Κρυπτογράφηση από άκρη σε άκρη",
  "call.starting": "Ξεκινάει…",
  "call.ringing": "Χτυπάει…",
  "call.ringingGroup": "Χτυπάει σε όλους…",
  "call.ringingShort": "χτυπάει",
  "call.connecting": "Συνδέεται…",
  "call.reconnecting": "Επανασύνδεση…",
  "call.ended": "Η κλήση τελείωσε",
  "call.declined": "Απορρίφθηκε",
  "call.busy": "Μιλάει σε άλλη κλήση",
  "call.noAnswer": "Δεν απάντησε",
  "call.failed": "Δεν συνδέθηκε",
  "call.answer": "Απάντηση",
  "call.answerVoice": "Μόνο φωνή",
  "call.decline": "Απόρριψη",
  "call.endAndAnswer": "Κλείσε και απάντα",
  "call.hangUp": "Τέλος κλήσης",
  "call.minimize": "Πίσω στις συνομιλίες",
  "call.tapToReturn": "Πάτα για επιστροφή",
  "call.tapForSound": "Πάτα για να ακούσεις",
  "call.theyMuted": "{name}: κλειστό μικρόφωνο",
  "call.mute": "Σίγαση",
  "call.unmute": "Άνοιγμα μικροφώνου",
  "call.cameraOn": "Άνοιγμα κάμερας",
  "call.cameraOff": "Κλείσιμο κάμερας",
  "call.flip": "Αλλαγή κάμερας",
  "call.share": "Κοινή χρήση οθόνης",
  "call.stopShare": "Τέλος κοινής χρήσης",
  "call.errNotAccepted": "Μπορείς να καλέσεις αφού δεχτεί το αίτημά σου.",
  "call.errNotAllowed": "Δεν μπορείς να καλέσεις σε αυτή τη συνομιλία.",
  "call.errFull": "Η κλήση είναι γεμάτη (8 άτομα).",
  "call.errLimit": "Έκανες πολλές κλήσεις τελευταία. Δοκίμασε ξανά αργότερα.",

  "calls.incomingVoice": "Εισερχόμενη κλήση",
  "calls.incomingVideo": "Εισερχόμενη βιντεοκλήση",
  "calls.outgoingVoice": "Εξερχόμενη κλήση",
  "calls.outgoingVideo": "Εξερχόμενη βιντεοκλήση",
  "calls.missedVoice": "Αναπάντητη κλήση",
  "calls.missedVideo": "Αναπάντητη βιντεοκλήση",
  "calls.ongoingVoice": "Κλήση σε εξέλιξη",
  "calls.ongoingVideo": "Βιντεοκλήση σε εξέλιξη",
  "calls.youDeclined": "Απορρίφθηκε",
  "calls.join": "Μπες",
  "calls.callBack": "Κάλεσε πίσω",
  "calls.emptyTitle": "Καμία κλήση ακόμα",
  "calls.emptyText": "Άνοιξε μια συνομιλία και πάτα το τηλέφωνο ή την κάμερα πάνω δεξιά. Οι κλήσεις κρυπτογραφούνται από άκρη σε άκρη, όπως τα μηνύματα.",

  "settings.online": "«Σε σύνδεση» και «τελευταία φορά»",
  "settings.onlineHint": "Αν κρύψεις το δικό σου, δεν θα βλέπεις ούτε των άλλων.",

  "err.editWindow": "Ένα μήνυμα αλλάζει μόνο μέσα σε 15 λεπτά από την αποστολή.",
  "err.pinLimit": "Μπορείς να καρφιτσώσεις έως 3 συνομιλίες.",

  // --- safety ---
  "report.titleMessage": "Αναφορά μηνύματος",
  "report.titleGroup": "Αναφορά ομάδας: {name}",
  "report.textGroup": "Πες μας με δυο λόγια τι έγινε. Κανείς στην ομάδα δεν ειδοποιείται.",
  "report.group": "Αναφορά ομάδας",
  "report.shareMessage": "Να σταλεί και το κείμενο αυτού του μηνύματος στους συντονιστές",
  "report.shareRecent": "Να σταλούν και τα τελευταία {n} μηνύματα της συνομιλίας στους συντονιστές",
  "report.shareHint":
    "Τα μηνύματα κρυπτογραφούνται από άκρη σε άκρη, οπότε οι συντονιστές δεν μπορούν να τα διαβάσουν. Βλέπουν μόνο το κείμενο που θα επιλέξεις να στείλεις εδώ.",
  "report.nothingToShare":
    "Τα μηνύματα κρυπτογραφούνται από άκρη σε άκρη, οπότε οι συντονιστές δεν μπορούν να τα διαβάσουν. Θα δουν ποιον ανέφερες και πότε.",
  "report.preview": "Αυτό ακριβώς θα σταλεί:",
  "report.attachment": "[αρχείο: {name}]",
  "report.voice": "[φωνητικό μήνυμα]",
  "report.errTarget": "Αυτό δεν μπορεί πια να αναφερθεί.",
  "report.errSelf": "Δεν μπορείς να κάνεις αναφορά για τον εαυτό σου.",
  "report.errReason": "Γράψε με λίγα λόγια τι έγινε (έως 500 χαρακτήρες).",
  "report.errLimit": "Έστειλες πολλές αναφορές σήμερα. Δοκίμασε ξανά αύριο.",
  "err.suspended": "Ο λογαριασμός σου είναι σε αναστολή.",
  "err.nameReserved": "Αυτό το όνομα είναι δεσμευμένο. Διάλεξε κάποιο άλλο.",
  "err.nameLength": "Το όνομα θέλει από 2 έως 60 χαρακτήρες.",
  "err.enterPassword": "Γράψε τον κωδικό σου.",
  "suspended.title": "Ο λογαριασμός σου έχει ανασταλεί",
  "suspended.text":
    "Από τις {date} δεν μπορείς να στέλνεις μηνύματα, να καλείς ή να βρίσκεις ανθρώπους στο Mila. Τα δεδομένα σου δεν έχουν σβηστεί.",
  "suspended.reason": "Η αιτία, όπως τη γράφουν οι συντονιστές:",
  "suspended.noReason": "Οι συντονιστές δεν πρόσθεσαν σημείωση.",
  "suspended.contestBefore": "Αν πιστεύεις ότι έγινε λάθος, γράψε μας στη διεύθυνση που θα βρεις στην",
  "suspended.contestLink": "πολιτική απορρήτου",
  "suspended.contestAfter": ". Θα το ξανακοιτάξουμε.",
  "suspended.stillCan": "Μπορείς ακόμα να κατεβάσεις τα δεδομένα σου ή να διαγράψεις τον λογαριασμό σου.",
  "account.signOutEverywhere": "Αποσύνδεση από όλες τις συσκευές",
  "account.signOutEverywhereText":
    "Αποσυνδέεται κάθε κινητό και υπολογιστής που έχει μπει στον λογαριασμό σου, και αυτή η συσκευή, και καμία δεν παίρνει πια ειδοποιήσεις. Χρήσιμο αν έχασες μια συσκευή ή μπήκες κάπου που δεν εμπιστεύεσαι.",

  // --- calls ---
  "call.answerNoPermission":
    "Δεν μπόρεσες να απαντήσεις: το Mila δεν έχει άδεια για το μικρόφωνο. Δώσ' την από τις ρυθμίσεις του browser για αυτό το site και κάλεσε πίσω.",
  "call.answerNoMic": "Δεν μπόρεσες να απαντήσεις: δεν βρέθηκε μικρόφωνο σε αυτή τη συσκευή.",
  "call.answerMicBusy":
    "Δεν μπόρεσες να απαντήσεις: άλλη εφαρμογή χρησιμοποιεί το μικρόφωνο. Κλείσ' την και κάλεσε πίσω.",
  "call.answerMediaFailed":
    "Δεν μπόρεσες να απαντήσεις: το μικρόφωνο δεν άνοιξε. Κάλεσε πίσω για να ξαναδοκιμάσεις.",

  // --- messaging ---
  "outbox.sending": "Στέλνεται…",
  "outbox.failed": "Δεν στάλθηκε. Πάτα για να ξαναδοκιμάσεις.",
  "outbox.retry": "Δοκίμασε ξανά",
  "outbox.delete": "Διαγραφή",
  "pushCard.title": "Άνοιξε τις ειδοποιήσεις",
  "pushCard.text": "Μαθαίνεις αμέσως για νέο μήνυμα ή κλήση, ακόμα κι όταν το Mila είναι κλειστό.",
  "pushCard.enable": "Άνοιγμα",
  "pushCard.dismiss": "Όχι τώρα",
  "pushCard.iosTitle": "Ειδοποιήσεις σε iPhone και iPad",
  "pushCard.iosText":
    "Βάλε το Mila στην αρχική οθόνη και άνοιξέ το από εκεί: Κοινή χρήση → «Προσθήκη στην οθόνη Αφετηρίας».",
  "pushCard.done": "Οι ειδοποιήσεις άνοιξαν.",
  "pushAsk.title": "Μη χάνεις κλήσεις",
  "pushAsk.text":
    "Άνοιξε τις ειδοποιήσεις, για να ακούς όταν σε καλούν, ακόμα κι όταν το Mila είναι κλειστό.",
  "squeeze.note": "Μεγάλο βίντεο: θα μικρύνει (720p) πριν σταλεί.",
  "squeeze.working": "Το βίντεο μικραίνει… {p}%",
  "squeeze.workingN": "Μικραίνει το βίντεο {i} από {n}… {p}%",
  "squeeze.keepOpen": "Κράτα το Mila ανοιχτό μέχρι να τελειώσει.",

  // --- legal ---
  "legal.consentBefore": "Με τη δημιουργία λογαριασμού αποδέχεσαι τους",
  "legal.googleConsentBefore":
    "Την πρώτη φορά, η σύνδεση με Google φτιάχνει λογαριασμό, και αποδέχεσαι τους",
  "legal.terms": "όρους χρήσης",
  "legal.and": "και την",
  "legal.privacy": "πολιτική απορρήτου",
  "legal.readTerms": "Διάβασε τους όρους χρήσης",
  "legal.readTermsAfter": "— οι κανόνες που δεχόμαστε όλοι εδώ.",
  "legal.footerTerms": "Όροι",
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
  // --- safety --- (πριν από τα γενικά «rate limit» και «not authenticated»)
  [/account suspended/i, "err.suspended"],
  [/this name is reserved/i, "err.nameReserved"],
  [/display name must be/i, "err.nameLength"],
  [/nothing to report/i, "report.errTarget"],
  [/cannot report yourself/i, "report.errSelf"],
  [/report reason must be|report excerpt is too long/i, "report.errReason"],
  [/rate limit exceeded: report/i, "report.errLimit"],
  [/invalid login credentials/i, "err.invalidLogin"],
  [/email not confirmed/i, "err.emailNotConfirmed"],
  [/already registered|already been registered/i, "err.alreadyRegistered"],
  [/password should be at least/i, "err.passwordShort"],
  [/should be different from the old password/i, "err.samePassword"],
  [/rate limit exceeded: message/i, "err.limitMessages"],
  [/rate limit exceeded: call/i, "call.errLimit"],
  [/calls are possible once the request is accepted/i, "call.errNotAccepted"],
  [/you cannot call this conversation/i, "call.errNotAllowed"],
  [/call is full/i, "call.errFull"],
  [/call answered on another device/i, "call.answeredElsewhere"],
  [/call has ended|call not found/i, "call.alreadyEnded"],
  [/edited for 15 minutes/i, "err.editWindow"],
  [/pin up to 3 chats/i, "err.pinLimit"],
  [/rate limit exceeded: contact_request|too many pending requests/i, "err.limitRequests"],
  [/rate limit exceeded: (user_lookup|contact_match|contact_import)/i, "err.limitLookup"],
  [/rate limit exceeded: signup|database error saving new user/i, "err.signupBusy"],
  [/rate limit exceeded:/i, "err.limitGeneric"],
  [/too many contacts in one file/i, "err.tooManyContacts"],
  [/wait until your request is accepted/i, "err.waitForAccept"],
  [/recipient has not set up encryption/i, "err.recipientNoKeys"],
  [/unencrypted messages are not accepted|messages must be encrypted|could not find the function public\.send_message/i, "err.mustEncrypt"],
  [/rate limit|too many requests/i, "err.rateLimit"],
  [/failed to fetch|networkerror|load failed|network request failed/i, "err.network"],
  [/cannot send messages to this conversation/i, "err.cannotSend"],
  [/row-level security policy for table "messages"|permission denied for table messages/i, "err.mustEncrypt"],
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
