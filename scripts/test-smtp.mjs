// Standalone SMTP test - bypasses Supabase entirely, talks directly to the
// SMTP relay with the same credentials you put in Supabase Dashboard.
// Shows the exact error the mailer would hit, instead of Supabase's generic
// "unexpected_failure".
//
// Usage:
//   npm install nodemailer --no-save
//   node scripts/test-smtp.mjs <host> <port> <user> <pass> <fromEmail> <toEmail>
//
// Example (Brevo):
//   node scripts/test-smtp.mjs smtp-relay.brevo.com 587 "xxxxx@smtp-brevo.com" "your-smtp-key" "bikakis.manolis@gmail.com" "bikakis.manolis@gmail.com"

import nodemailer from "nodemailer";

const [host, port, user, pass, from, to] = process.argv.slice(2);

if (!host || !port || !user || !pass || !from || !to) {
  console.error(
    "Usage: node scripts/test-smtp.mjs <host> <port> <user> <pass> <fromEmail> <toEmail>",
  );
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host,
  port: Number(port),
  secure: Number(port) === 465,
  auth: { user, pass },
  logger: true,
  debug: true,
});

console.log("=== Στάδιο 1: verify() (connect + auth, χωρίς αποστολή) ===");
try {
  await transporter.verify();
  console.log("OK: Σύνδεση + authentication πέτυχαν.\n");
} catch (err) {
  console.error("ΑΠΕΤΥΧΕ στο connect/auth:");
  console.error(err);
  process.exit(1);
}

console.log("=== Στάδιο 2: αποστολή δοκιμαστικού email ===");
try {
  const info = await transporter.sendMail({
    from,
    to,
    subject: "SMTP test - Mila",
    text: "Αν βλέπεις αυτό το email, το SMTP δουλεύει σωστά.",
  });
  console.log("OK: Στάλθηκε.");
  console.log("messageId:", info.messageId);
  console.log("response:", info.response);
} catch (err) {
  console.error("ΑΠΕΤΥΧΕ στο send:");
  console.error(err);
  process.exit(1);
}
