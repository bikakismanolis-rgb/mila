// Test για τα όρια μεγέθους των συνημμένων (apps/web/src/limits.ts).
// Τρέξε από τη ρίζα του project:
//   node scripts/test-media-limits.mjs     (Node 22.18+, διαβάζει απευθείας το .ts)
//
// Ελέγχει ότι: το κρυπτογραφημένο αρχείο είναι ακριβώς όσο λέει το limits.ts
// (με την πραγματική e2ee.encryptFile), ότι το μεγαλύτερο επιτρεπτό αρχείο
// χωράει ακριβώς στον bucket του 0016 και στον έλεγχο του πίνακα attachments,
// και ότι η συμπίεση βίντεο βγάζει ~720p με bitrate που χωράει στο όριο.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as L from "../apps/web/src/limits.ts";
import * as e from "../apps/web/src/e2ee.ts";

const MB = 1024 * 1024;

// --- Κρυπτογράφηση: +16 bytes, ούτε ένα παραπάνω --------------------------
for (const n of [0, 1, 1000, 65_537, 3 * MB + 5]) {
  const sealed = await e.encryptFile(new Uint8Array(n).buffer);
  assert.equal(sealed.blob.size, L.sealedSize(n), `sealed size of ${n} bytes`);
  assert.equal(sealed.blob.size - n, L.SEAL_OVERHEAD, "AES-GCM adds only its 16-byte tag");
}

// --- Το όριο ----------------------------------------------------------------
assert.equal(L.MAX_SEALED, 50 * MB, "50 MB, the Supabase free-plan file limit");
assert.equal(L.sealedSize(L.MAX_FILE), L.MAX_SEALED, "largest file fills the bucket exactly");
assert.ok(L.fitsUpload(L.MAX_FILE), "largest file fits");
assert.ok(!L.fitsUpload(L.MAX_FILE + 1), "one byte more does not");
assert.ok(L.fitsUpload(0) && !L.fitsUpload(-1));
assert.equal(L.MAX_FILE_MB, 50, "the number shown to people");

// Ο bucket (0016) και ο πίνακας attachments (0001) λένε το ίδιο νούμερο.
const migration = readFileSync(new URL("../supabase/migrations/0016_media_limits.sql", import.meta.url), "utf8");
const bucket = Number(migration.match(/set file_size_limit = (\d+)/)?.[1]);
assert.equal(bucket, L.MAX_SEALED, "bucket file_size_limit in 0016 matches limits.ts");
const core = readFileSync(new URL("../supabase/migrations/0001_core.sql", import.meta.url), "utf8");
const column = Number(core.match(/byte_size between 1 and (\d+)/)?.[1]);
assert.ok(column >= L.MAX_SEALED, "attachments.byte_size accepts the sealed size");
// Το κείμενο του σφάλματος λέει το ίδιο όριο.
const i18n = readFileSync(new URL("../apps/web/src/i18n.ts", import.meta.url), "utf8");
for (const line of i18n.split("\n").filter((l) => l.includes('"err.fileTooLarge"')))
  assert.ok(line.includes(`${L.MAX_FILE_MB} MB`), `error text says ${L.MAX_FILE_MB} MB: ${line.trim()}`);

// --- Πότε συμπιέζεται ένα βίντεο -------------------------------------------
assert.ok(!L.shouldSqueeze(10 * MB, 30), "small video goes as it is");
assert.ok(L.shouldSqueeze(60 * MB, 40), "too large: always");
assert.ok(L.shouldSqueeze(60 * MB), "too large, even without a known duration");
assert.ok(L.shouldSqueeze(30 * MB, 10), "30 MB in 10 s (24 Mbps): worth it");
assert.ok(!L.shouldSqueeze(30 * MB, 120), "30 MB in 2 minutes (2 Mbps): already light");
assert.ok(!L.shouldSqueeze(30 * MB), "large but fits, unknown duration: as it is");

// --- Πώς συμπιέζεται ---------------------------------------------------------
let plan = L.videoPlan(60, 1920, 1080);
assert.deepEqual([plan.width, plan.height], [1280, 720], "1080p landscape → 720p");
assert.equal(plan.videoBitsPerSecond, L.TARGET_VIDEO_BPS, "short video gets the full 2 Mbps");
assert.ok(plan.videoBitsPerSecond >= 1_500_000 && plan.videoBitsPerSecond <= 2_500_000);
assert.ok(L.plannedSize(plan, 60) < 20 * MB, "a minute is well under 20 MB");

plan = L.videoPlan(30, 1080, 1920);
assert.deepEqual([plan.width, plan.height], [720, 1280], "portrait stays portrait");
plan = L.videoPlan(30, 3840, 2160);
assert.deepEqual([plan.width, plan.height], [1280, 720], "4K → 720p");
plan = L.videoPlan(30, 1440, 1080);
assert.deepEqual([plan.width, plan.height], [960, 720], "4:3 keeps its shape");
plan = L.videoPlan(30, 640, 360);
assert.deepEqual([plan.width, plan.height], [640, 360], "small video is not enlarged");
plan = L.videoPlan(30, 1281, 721);
assert.ok(plan.width % 2 === 0 && plan.height % 2 === 0, "even sizes (H.264 needs them)");

// Μεγάλη διάρκεια: χαμηλότερο bitrate, αλλά πάντα μέσα στο όριο με περιθώριο.
for (const seconds of [5, 60, 180, 300, 600, 900]) {
  const p = L.videoPlan(seconds, 1920, 1080);
  if (!p) {
    assert.ok(seconds > 600, `${seconds} s should still fit`);
    continue;
  }
  assert.ok(p.videoBitsPerSecond >= L.MIN_VIDEO_BPS, `${seconds} s: not below the minimum`);
  assert.ok(
    L.plannedSize(p, seconds) <= L.MAX_FILE * L.HEADROOM + 1,
    `${seconds} s: planned ${L.plannedSize(p, seconds)} bytes fits with headroom`,
  );
}
assert.equal(L.videoPlan(20 * 60, 1920, 1080), null, "20 minutes cannot fit: too large");
assert.equal(L.videoPlan(0, 1920, 1080), null, "unknown duration");
assert.equal(L.videoPlan(Infinity, 1920, 1080), null, "MediaRecorder files without a duration");
assert.equal(L.videoPlan(30, 0, 0), null, "unknown size");

console.log("media limits: all checks passed");
