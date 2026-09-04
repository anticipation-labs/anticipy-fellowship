// The fellowship platform: the course, the funnel, and the rules that are not
// style preferences but legal posture.
//
// Three things here are load-bearing and are asserted, not trusted:
//
//   1. NOTHING IS WRITTEN FOR AN UNDER-13. The COPPA-regulated act is the
//      storage itself, so the age check has to come before the first save —
//      not after, and not "we delete it later".
//   2. LESSON COMPLETION NEVER REQUIRES POSTING. A programme that requires
//      minors to publish work for the company is a different arrangement in
//      law. Every lesson ends in an OPTIONAL "try this" aimed at their own
//      account, and finishing is pressing the button.
//   3. THE MONEY SENTENCE IS NEVER AN UNQUALIFIED "$30". It is always the
//      split and the reason for the split, wherever it appears.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LEARN = readFileSync(join(ROOT, "backend/pb_public/fellowship-growth-learning.html"), "utf8");
const FUNNEL = readFileSync(join(ROOT, "backend/pb_public/fellowships.html"), "utf8");
const HOOK = readFileSync(join(ROOT, "backend/pb_hooks/fellowship.pb.js"), "utf8");
const GUARD = readFileSync(join(ROOT, "backend/pb_hooks/fellowship_guardian.pb.js"), "utf8");

// A copy assertion has to read what a PERSON sees, not how the source happens
// to be formatted. These pages build sentences by concatenating string
// literals and write apostrophes as entities, so "claws money back" can be
// true on screen and invisible to a regex over the file — which is how two
// assertions came to be pinned to the exact old wording instead of to the
// claim they were protecting.
const asText = (s) => s
  .replace(/['"]\s*\n?\s*\+\s*['"]/g, "")
  .replace(/\\'/g, "'")
  .replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&mdash;/g, "\u2014")
  .replace(/\s+/g, " ");
const FUNNEL_TEXT = asText(FUNNEL);
const LEARN_TEXT = asText(LEARN);

// An assertion that a bad pattern is ABSENT has to ignore the comment that
// explains why it was removed — otherwise fixing a bug and documenting the
// fix makes the test for it fail, which teaches you to stop documenting.
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
  .replace(/<!--[\s\S]*?-->/g, "");
const FUNNEL_CODE = stripComments(FUNNEL);
const HOOK_CODE = stripComments(HOOK);
const MIG = readFileSync(join(ROOT, "backend/pb_migrations/1700000041_fellowships.js"), "utf8");
const PUBLIC_MARKETING = /const APPLICATION_URL\s*=/.test(FUNNEL) &&
  /data-apply-link/.test(FUNNEL);

// The public /fellowships route is now a focused marketing page that sends
// applicants to the team's approved external form. Keep the historical funnel
// assertions here for the legacy surface, but do not mistake its intentional
// absence for a regression. Backend, course, payout, guardian and parser checks
// still run below, and the new public contract has its own assertions.
const isLegacyPublicFunnelCheck = (name) => name.startsWith("funnel:") || [
  "money: and that it is never taken back",
  "money: and why the wait exists at all",
  "guardian: it is honest that only money waits, never the learning",
  "linkedin: and the placeholder does not offer it to a 13-15 fellow",
  "race: and the page does not render a submission the server did not send",
].includes(name);

let failures = 0;
const check = (name, ok, detail) => {
  if (PUBLIC_MARKETING && isLegacyPublicFunnelCheck(name)) {
    console.log(`SKIP: ${name} (legacy public funnel is not mounted)`);
    return;
  }
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok || !detail ? "" : "  -> " + detail}`);
  if (!ok) failures++;
};

// ---- load the real course ------------------------------------------------
const scripts = [...LEARN.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const courseSrc = scripts.find((s) => s.includes("var COURSE"));
assert.ok(courseSrc, "COURSE not found in the learning page");
const sbox = { COURSE: null };
vm.createContext(sbox);
vm.runInContext(courseSrc + "; this.COURSE = COURSE; this.MAKEONE = typeof MAKEONE !== 'undefined' && MAKEONE; this.CARRY = typeof CARRY !== 'undefined' && CARRY;", sbox);
const COURSE = sbox.COURSE;
const MAKEONE = sbox.MAKEONE || {};
const CARRY = sbox.CARRY || {};

// The card union. A bare string is a statement; {t:"do"} is the try-this that
// used to be {try:"..."}; {t:"check"} is the quiz that used to be {quiz:{}}.
// One reader, so a test never has to know which generation a card is from.
const kind = (c) => (typeof c === "string" ? "statement"
  : c.t ? c.t : c.try ? "do" : c.quiz ? "check" : "statement");
const tryText = (c) => (kind(c) === "do" ? (c.text || c.try || "") : "");
const cardText = (c) => (typeof c === "string" ? c : JSON.stringify(c));

// ==========================================================================
// 0. THE PUBLIC FELLOWSHIP PAGE
// ==========================================================================
{
  const approvedForm = "https://forms.gle/Bo5p7QPxw9WrE5FM8";
  const applyCtas = FUNNEL.match(/<a\b[^>]*\bdata-apply-link\b/g) || [];
  const h1s = FUNNEL.match(/<h1\b/g) || [];
  const applicationDeclarations = FUNNEL.match(/const APPLICATION_URL\s*=/g) || [];

  check("public page: the marketing experience is mounted", PUBLIC_MARKETING);
  check("public page: one H1 carries the central promise",
    h1s.length === 1 && /Build what\s*<em>leaves the screen\.<\/em>/.test(FUNNEL));
  check("public page: all three fellowship tracks are present",
    ["Software", "Hardware", "Growth &amp; Marketing"].every((track) => FUNNEL.includes(track)));
  check("public page: the application URL has one configuration point",
    applicationDeclarations.length === 1 && FUNNEL.includes(`const APPLICATION_URL = "${approvedForm}"`));
  check("public page: every application CTA is wired through that configuration",
    applyCtas.length === 8 && /querySelectorAll\("\[data-apply-link\]"\)/.test(FUNNEL));
  check("public page: the external form opens safely in a new tab",
    /link\.target = "_blank"/.test(FUNNEL) && /link\.rel = "noopener noreferrer"/.test(FUNNEL));
  check("public page: it does not call the retired funnel or browser storage",
    !/\/fellows\//.test(FUNNEL_CODE) && !/\bfetch\s*\(/.test(FUNNEL_CODE) &&
    !/\b(?:localStorage|sessionStorage|PocketBase)\b/.test(FUNNEL_CODE));
  check("public page: FAQ and mobile navigation expose accessible state",
    /class="faq-question"[^>]*aria-expanded=/.test(FUNNEL) &&
    /aria-controls="faq-answer-1"/.test(FUNNEL) &&
    /data-menu-toggle/.test(FUNNEL) && /aria-controls="mobile-menu"/.test(FUNNEL));
  check("public page: motion respects the visitor's preference",
    /@media \(prefers-reduced-motion: reduce\)/.test(FUNNEL) &&
    /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/.test(FUNNEL));
  check("public page: the editorial image has stable dimensions and useful alt text",
    /<img src="assets\/prototype-bench\.jpg"[^>]*alt="[^"]+"[^>]*width="1672"[^>]*height="941"[^>]*loading="lazy"[^>]*decoding="async"/.test(FUNNEL));
}

// ==========================================================================
// 1. THE COURSE
// ==========================================================================
{
  const lessons = COURSE.flatMap((u) => u.lessons);
  const ids = lessons.map((l) => l.id);
  check("course: units and lessons exist", COURSE.length >= 6 && lessons.length >= 20,
    `${COURSE.length} units, ${lessons.length} lessons`);
  check("course: every lesson id is unique", new Set(ids).size === ids.length);
  check("course: every lesson id matches the server's regex",
    ids.every((id) => /^[a-z0-9-]{3,60}$/.test(id)),
    ids.filter((id) => !/^[a-z0-9-]{3,60}$/.test(id)).join(", "));

  // THE LEGAL ONE: completion is never posting.
  const noTry = lessons.filter((l) => !l.cards.some((c) => c && kind(c) === "do"));
  check("course: every lesson ends in a try-this", noTry.length === 0,
    noTry.map((l) => l.id).join(", "));
  const mandatory = lessons.filter((l) =>
    l.cards.some((c) => /\byou must\b|\brequired\b|\bhave to post\b/i.test(tryText(c))));
  check("course: no try-this is phrased as a requirement", mandatory.length === 0,
    mandatory.map((l) => l.id).join(", "));

  // Posting is always framed as optional, wherever it is mentioned.
  const postCards = lessons.flatMap((l) =>
    l.cards.map(cardText).filter((t) => /\bpost\b/i.test(t)));
  const pushy = postCards.filter((t) =>
    /\bpost (it|this|one|three)\b/i.test(t) &&
    !/(if you|when you|optional|unlisted counts|your call|feel like|want it live)/i.test(t));
  check("course: posting is always optional where it is mentioned", pushy.length === 0,
    pushy.slice(0, 2).join(" | "));

  // Voice rules. The one card that TEACHES the banned words is exempt, and
  // it is identified by teaching them, not by being on a list.
  const BANNED = /\b(leverage|optimi[sz]e|content strategy|engagement|brand awareness|unlock|game-changer)\b/i;
  const offenders = [];
  lessons.forEach((l) => l.cards.forEach((c) => {
    const t = typeof c === "string" ? c : (c.try || (c.quiz ? c.quiz.q + " " + c.quiz.why : ""));
    const isTeachingThem = /words like|brand-speak|burn them|kill videos/i.test(t);
    if (BANNED.test(t) && !isTeachingThem) offenders.push(l.id + ": " + t.slice(0, 60));
  }));
  check("course: no marketing jargon except where it is being taught against",
    offenders.length === 0, offenders.join(" | "));

  const tooLong = [];
  lessons.forEach((l) => l.cards.forEach((c) => {
    const t = typeof c === "string" ? c : (c.try || "");
    if (t && t.split(/\s+/).length > 55) tooLong.push(l.id + " (" + t.split(/\s+/).length + "w)");
  }));
  check("course: cards stay short enough to read on a phone", tooLong.length === 0, tooLong.join(", "));

  const emoji = lessons.flatMap((l) => l.cards.map(cardText))
    .filter((t) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t));
  check("course: no emoji", emoji.length === 0, emoji.slice(0, 1).join(""));

  // The honest-limits lesson is not optional content.
  const all = JSON.stringify(COURSE);
  check("course: teaches the preorder truth", /preorder/i.test(all) && /late 2026/i.test(all));
  check("course: teaches the never-claim list", /never say/i.test(all));
  check("course: teaches FTC disclosure as the fellow's own duty",
    /paid partnership|paying me/i.test(all) && /falls on the person who posted/i.test(all));
  check("course: warns that trending sounds do not cover ads",
    /trending sounds don't cover ads|license on a viral song/i.test(all));
  check("course: names the under-18 payout path in the money unit",
    /under 18\?/i.test(all) && /five-minute setup|5-minute setup/i.test(all));
}

// ==========================================================================
// 2. THE MONEY SENTENCE
// ==========================================================================
{
  // THE MODEL CHANGED. It used to be $15 at 14 days and $15 when the pendant
  // ships, and these assertions protected that. The split turned out to buy
  // nothing — a card dispute on a preorder starts counting from the SHIP date,
  // so the second tranche paid out exactly when the risk began — and it pinned
  // a promise to the one date we do not control. It is now ONE $30 payment,
  // thirty days after the purchase, never clawed back.
  //
  // What still has to be true is the same as before: wherever $30 appears, so
  // does when it lands. A bare "$30" with no timing is the thing that gets
  // discovered in November.
  // PROXIMITY, not presence. The first version of this asked whether "30 days"
  // appeared anywhere in the document, which a mutation test walked straight
  // through: deleting the timing from the sentence that promises the money
  // left the phrase intact in an unrelated line further down and the check
  // stayed green. What has to be true is that a reader who sees the amount
  // sees the timing WITHOUT scrolling — so the window is the sentence, not
  // the page.
  // Card CONTENT, not the whole serialised course — a lesson titled "how a
  // sale becomes $30" is a heading, not a promise, and requiring the timing
  // inside a title would be a check nobody could satisfy honestly.
  const cardText = COURSE.flatMap((u) => u.lessons.flatMap((l) => l.cards))
    .map((c) => (typeof c === "string" ? c : JSON.stringify(c))).join("\n\n");
  const surfaces = { "the funnel": FUNNEL_TEXT, "the course": asText(cardText) };
  for (const [name, text] of Object.entries(surfaces)) {
    const bare = [];
    const re = /\$30/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const near = text.slice(Math.max(0, m.index - 120), m.index + 200);
      if (!/30 days/i.test(near)) bare.push(near.replace(/\s+/g, " ").slice(0, 110));
    }
    check(`money: every $30 in ${name} says when it lands`,
      bare.length === 0, bare.join(" ||| "));
  }
  check("money: and that it is never taken back",
    /never take it back|never taken back|we never take/i.test(FUNNEL_TEXT));
  check("money: and why the wait exists at all",
    /cancel|cancelled/i.test(FUNNEL_TEXT));

  // The old model must not survive anywhere, on any surface. A page still
  // promising halves is a page promising something the payout code will not do.
  const stale = [];
  for (const [name, text] of Object.entries({ funnel: FUNNEL_TEXT, course: asText(LEARN) })) {
    if (/14 days/i.test(text)) stale.push(name + ": 14 days");
    if (/\bhalf\b/i.test(text) && /\$1?5\b/.test(text)) stale.push(name + ": a half");
    if (/\bwhop\b/i.test(text)) stale.push(name + ": whop");
  }
  check("money: no surface still promises the old split or Whop",
    stale.length === 0, stale.join(" | "));
  check("money: the course gives the same reason",
    /people cancel/i.test(JSON.stringify(COURSE)));
}

// ==========================================================================
// 3. THE UNDER-13 STOP — nothing is written
// ==========================================================================
{
  const codeRoute = HOOK.slice(HOOK.indexOf('"/fellows/code"'), HOOK.indexOf('"/fellows/verify"'));
  const ageIdx = codeRoute.indexOf("age < 13");
  const firstSave = Math.min(
    ...["e.app.save", "new Record"].map((s) => {
      const i = codeRoute.indexOf(s);
      return i < 0 ? Infinity : i;
    })
  );
  check("under-13: the age check runs BEFORE anything is saved",
    ageIdx > 0 && ageIdx < firstSave,
    `age check at ${ageIdx}, first write at ${firstSave}`);
  check("under-13: the stop is warm, not an error",
    /come back on your birthday/i.test(codeRoute));
  check("under-13: verify re-checks age server-side",
    /age < 13/.test(HOOK.slice(HOOK.indexOf('"/fellows/verify"'))));
  check("age gate: the band is derived, never asked as a band",
    !/13_15|16_17|18_plus/.test(FUNNEL.slice(0, FUNNEL.indexOf("<script>"))),
    "an age band appears in the visible markup");
  // Only what a person can SEE. The source comment explaining why we hide the
  // cutoff obviously mentions the cutoff.
  const visible = FUNNEL.slice(0, FUNNEL.indexOf("<script>"));
  check("age gate: every year is selectable and the cutoff is not hinted on screen",
    !/must be 13|13\+|at least 13|13 or older/i.test(visible),
    (visible.match(/.{0,60}(must be 13|13\+|at least 13|13 or older).{0,40}/i) || [])[0]);
}

// ==========================================================================
// 4. THE ROUTES' SAFETY POSTURE
// ==========================================================================
{
  check("codes: only the hash is stored", /code_hash/.test(HOOK) && !/c\.set\("code",\s*code\)/.test(HOOK));
  check("codes: compared in constant time", /\$security\.equal\(sha256\(code\)/.test(HOOK));
  check("codes: the email is SENT before the row is saved",
    HOOK.indexOf("api.resend.com") < HOOK.indexOf('c.set("code_hash"'),
    "a code must never exist unless it was delivered");
  check("throttle: every outcome returns the same message",
    (HOOK.match(/return e\.json\(200, uniform\)/g) || []).length >= 3);
  check("throttle: the per-IP layer disables itself without a trusted proxy",
    /ipUsable/.test(HOOK) && /127\.0\.0\.1/.test(HOOK));
  check("throttle: tripping the circuit breaker tells a human",
    /fellowship\.email_meter/.test(HOOK));
  check("sms: 18+ is enforced in the route", /sms_opt_in.*18_plus|18_plus.*sms/s.test(HOOK));
  check("linkedin: hidden under 16", /LinkedIn's own rules start at 16/.test(HOOK));
  check("referral: an unknown code still redirects, never dead-ends",
    /clean \|\| ""/.test(HOOK) && /e\.redirect\(302/.test(HOOK));
  check("referral: the visitor's IP is only ever stored hashed",
    /ip_hash/.test(HOOK) && /sha256\(ip \+ salt\)/.test(HOOK));
  check("review: the model can never reject a real answer",
    /parsed\.verdict === "ask_more" && realish/.test(HOOK),
    "our own sanity check must overrule an ask_more");
  check("review: works with no model configured", /fallback_accept/.test(HOOK));
  check("internal view: fails closed like the rest of HQ",
    /internal HQ is not configured/.test(HOOK) && /\$security\.equal/.test(HOOK));
}

// ==========================================================================
// 5. THE SCHEMA
// ==========================================================================
{
  check("schema: every collection is hook-only", /listRule: null/.test(MIG) && /deleteRule: null/.test(MIG));
  check("schema: email is unique", /CREATE UNIQUE INDEX idx_fellows_email/.test(MIG));
  check("schema: an order can never be paid twice", /CREATE UNIQUE INDEX idx_fconv_order/.test(MIG));
  check("schema: birth month and year only, never a full date of birth",
    /birth_month/.test(MIG) && /birth_year/.test(MIG) && !/date_of_birth|birthdate/.test(MIG));
  // Field NAMES only. The first version of this read the file's own comments,
  // which say "no address. No school, no photo" — and failed on the sentence
  // promising the very thing it was checking for.
  const fieldNames = [...MIG.matchAll(/name:\s*"([a-z_]+)"/g)].map((m) => m[1]);
  const nosy = fieldNames.filter((f) => /address|school|photo|avatar|gender|race|ssn/.test(f));
  check("schema: no field for a home address, school, photo or anything like it",
    nosy.length === 0, nosy.join(", "));
}

// ==========================================================================
// 6. THE FUNNEL'S COPY
// ==========================================================================
{
  check("funnel: says plainly what we get out of it",
    /What we get/.test(FUNNEL) && /rather say it than dress it up/i.test(FUNNEL));
  // The property, not the phrasing. What matters is that the wait screen
  // promises a real reading and never dresses the model up as something it
  // isn't — a pinned string just breaks every time the copy is improved.
  // This assertion used to require the string "Someone actually reads these",
  // which was on the wait screen and was NOT TRUE at that moment: a model
  // reads it, and a person sees it later. Under the FTC deception standard
  // that is a representation likely to mislead a reasonable person about
  // something material, and the test was pinning it in place. What has to be
  // true is that the screen names what is actually reading, right now.
  const namesTheModel = /it's a model|it is a model/i.test(FUNNEL_TEXT);
  const humanLater = /a person reads these later/i.test(FUNNEL_TEXT);
  const claimsHumanNow = /someone actually reads these|a person is reading/i.test(FUNNEL_TEXT);
  const overclaim = /(analy[sz]ing \d|data points|neural|deep learning|proprietary algorithm|scanning your)/i.test(FUNNEL);
  check("funnel: the wait screen says what is actually reading it",
    namesTheModel && humanLater && !claimsHumanNow,
    `model:${namesTheModel} later:${humanLater} claimsHumanNow:${claimsHumanNow}`);
  check("funnel: and never dresses the model up as something it isn't", !overclaim,
    (FUNNEL.match(/.{0,60}(data points|neural|proprietary algorithm).{0,40}/i) || [])[0]);
  check("funnel: under-18s are told the learning is NOT gated",
    /(everything (else|here) is open)/i.test(FUNNEL_TEXT) &&
    /only the payment/i.test(FUNNEL_TEXT));
  check("funnel: explains the parent step as law, not our rule",
    /(not our rule|rather than a rule of ours)/i.test(FUNNEL_TEXT));
  // It was the one button between a minor and getting paid, and it had no
  // handler and no listener anywhere in the file.
  check("funnel: the under-18 setup control actually does something",
    /data-copy=/.test(FUNNEL) && /mailto:/.test(FUNNEL) && !/id="b-parent"/.test(FUNNEL));
  check("funnel: no password anywhere", !/type="password"/.test(FUNNEL));
}

// ==========================================================================
// 7. THE PLAYER'S COLUMNS ALL START AT THE SAME X
// ==========================================================================
{
  // The founder spotted this before any test did: the Next button sat 28px
  // right of the card text. .pbody applies its horizontal padding OUTSIDE the
  // centred 620px column; .pfoot applied the same padding INSIDE its own
  // max-width box, so the two columns began at different x. Every rail in the
  // player must now use the identical shape — full-width padded rail, centred
  // inner — or they drift apart again the next time one is touched.
  const rails = ["pbar", "pbody", "pfoot"];
  const offenders = [];
  rails.forEach((r) => {
    const rule = (LEARN.match(new RegExp("\\." + r + "\\{[^}]*\\}")) || [""])[0];
    const innerRule = (LEARN.match(new RegExp("\\." + r + " \\.pinner\\{[^}]*\\}")) || [""])[0];
    // the rail itself must not carry the max-width
    if (/max-width/.test(rule)) offenders.push(r + " carries max-width on the rail: " + rule);
    // and there must be a centred inner that does
    if (r !== "pbody" && !/max-width:620px/.test(innerRule)) offenders.push(r + " has no centred inner");
  });
  check("player: every rail uses the same padded-rail + centred-inner shape",
    offenders.length === 0, offenders.join(" | "));

  const bodyInner = (LEARN.match(/\.pinner\{[^}]*\}/) || [""])[0];
  check("player: the shared inner is 620px and centred",
    /max-width:620px/.test(bodyInner) && /margin:0 auto/.test(bodyInner), bodyInner);

  // and the markup actually uses it
  ["pbar", "pfoot"].forEach((r) => {
    const idx = LEARN.indexOf('class="' + r + '"');
    check(`player: .${r} wraps its contents in .pinner`,
      idx > 0 && LEARN.slice(idx, idx + 200).includes('class="pinner"'),
      LEARN.slice(idx, idx + 80));
  });
}

// ==========================================================================
// 8. THE BUTTON AND THE RAIL NEVER MOVE
// ==========================================================================
// Law 1 of the player. Every card, every state and every screen renders into
// the same 620px column with the same footer rail underneath, and the tap
// target is the same size in the same place on card 1, on the check, on the
// try-this and on the end-of-lesson screen.
//
// This has broken three separate ways already: a full-width pill that gave
// the eye no fixed target, a done panel in its own centred box, and — the
// subtle one — an empty left slot that changed the footer's HEIGHT when the
// footer wrapped at mobile widths, so the button moved 22px up and down
// between cards. Each of those is asserted here.
{
  check("player: the primary button is not a full-width banner",
    !/id="pnext"[^>]*class="[^"]*\bwide\b/.test(LEARN) &&
    !/class="[^"]*\bwide\b[^"]*"\s+id="pnext"/.test(LEARN),
    "#pnext must not carry .btn.wide — a 620px pill has no fixed target");

  const pnext = (LEARN.match(/#pnext\{[^}]*\}/) || [""])[0];
  check("player: the button has a fixed minimum width", /min-width:\s*186px/.test(pnext), pnext);
  check("player: and a fixed height", /height:\s*54px/.test(pnext), pnext);

  // The left slot is empty on most cards and holds a bare-text action on
  // three of them. Without a reserved height that emptiness moves the button.
  const pslot = (LEARN.match(/\.pslot\{[^}]*\}/) || [""])[0];
  check("player: the left slot reserves its height whether or not it is filled",
    /min-height:\s*\d+px/.test(pslot), pslot);

  check("player: the footer is never hidden",
    !/\$\("pfoot"\)\.style\.display\s*=\s*"none"/.test(LEARN),
    "finishLesson must not hide the rail the button lives in");

  // The end-of-lesson screen is a CARD now, not a second panel. There is no
  // display-swap left to get wrong.
  check("player: the end of a lesson renders into the same card body",
    /\$\("pbody"\)\.innerHTML\s*=\s*body/.test(LEARN) && !/id="done"/.test(LEARN),
    "the land card must render into #pbody like every other card");

  // one click handler on the footer button, or the end of a lesson fires twice
  const listeners = (LEARN.match(/\$\("pnext"\)\.addEventListener/g) || []).length;
  const onclicks = (LEARN.match(/\$\("pnext"\)\.onclick\s*=/g) || []).length;
  check("player: the footer button has exactly one click path",
    listeners === 1 && onclicks === 0, `${listeners} listeners, ${onclicks} onclick`);

  // .pbody centred its content AND scrolled it. When content exceeds the box
  // the overflow goes above scrollTop:0 and is unreachable by any input —
  // measured at 390x380, 30px of the card including the eyebrow could not be
  // reached. flex-start plus auto block margins centres when there is room
  // and starts at the top when there is not.
  const pbody = (LEARN.match(/\.pbody\{[^}]*\}/) || [""])[0];
  check("player: long cards are reachable from the top",
    /align-items:\s*flex-start/.test(pbody) && /margin-block:\s*auto/.test(LEARN), pbody);
}

// ==========================================================================
// 9. THE CARD IS SET AT A READABLE MEASURE, AND BIG TYPE IS SCARCE
// ==========================================================================
{
  // 38px DM Serif in a 620px column is about 35 characters per line. The
  // readable band is 45-75 and short careful reading wants the low end, so a
  // 30-word card was being returned to a new line every six words — poster
  // typography, not reading typography.
  const m = LEARN.match(/\.c-statement \.lead\{[\s\S]*?clamp\([^)]*,\s*([\d.]+)px\)/);
  check("player: the statement card's type size is set", !!m, ".c-statement .lead not found");
  if (m) {
    const px = parseFloat(m[1]);
    const cpl = Math.round(620 / (px * 0.47));   // DM Serif averages ~0.47em/char
    check(`player: the card sits in the readable band (${px}px -> ~${cpl} chars/line)`,
      cpl >= 45 && cpl <= 75, `${cpl} characters per line`);
  }

  // Scarcity is what makes big type mean anything. The founder's instinct
  // about big type was right; it was applied to all 159 cards instead of the
  // nine lines that are meant to be remembered.
  const keeps = COURSE.map((u) => u.lessons.flatMap((l) => l.cards).filter((c) => kind(c) === "keep").length);
  check("player: exactly one keep card per unit",
    keeps.every((n) => n === 1), keeps.join(","));
  // Inside the player specifically. h1 and the unit names on the map are page
  // chrome and are allowed to be large; a CARD is not, or the scarcity that
  // makes the keep mean something is gone.
  const allowed = [".c-keep .line", ".c-def .term", ".c-land .donetitle", ".c-num .fig"];
  const bigCards = [];
  const re = /(\.c-[a-z]+ \.[a-z0-9]+)\{font:400 clamp\([^)]*,\s*([\d.]+)px\)/g;
  let mm;
  while ((mm = re.exec(LEARN)) !== null) {
    if (parseFloat(mm[2]) >= 28 && !allowed.includes(mm[1])) bigCards.push(`${mm[1]} @ ${mm[2]}px`);
  }
  check("player: inside a card, only the keep, the term, the figure and the land title go big",
    bigCards.length === 0, bigCards.join(" | "));
}

// ==========================================================================
// 10. THE RHYTHM — a lesson is 4-6 different screens, not one screen 9 times
// ==========================================================================
// This is the whole complaint, restated as assertions. "Big text at the
// forefront, it doesn't feel good to use, I would not know what to do on this
// page" is what a course made of 159 identical cards produces. Interleaving
// is also the learning finding, not only the aesthetic one: a run of six
// identical cards is the blocked-practice condition.
{
  const lessons = COURSE.flatMap((u) => u.lessons);
  const bad = [];
  lessons.forEach((l) => {
    const cs = l.cards.map(kind);
    const checks = cs.filter((k) => k === "check").length;
    if (checks !== 1) bad.push(`${l.id}: ${checks} checks, want 1`);
    if (cs[cs.length - 1] !== "do") bad.push(`${l.id}: does not end on a try-this`);
    const ci = cs.indexOf("check");
    const depth = (ci + 1) / cs.length;
    if (depth < 0.5 || depth > 0.9) bad.push(`${l.id}: check at ${Math.round(depth * 100)}% depth`);
    for (let i = 2; i < cs.length; i++) {
      if (cs[i] === cs[i - 1] && cs[i] === cs[i - 2]) bad.push(`${l.id}: three ${cs[i]} in a row`);
    }
    if (new Set(cs).size < 4) bad.push(`${l.id}: only ${new Set(cs).size} kinds of screen`);
  });
  check("course: every lesson has one check, ends on a try, and varies its screens",
    bad.length === 0, bad.slice(0, 6).join(" | "));

  // "It should be showing, after every lesson, that you should make a video."
  const missing = lessons.filter((l) => !MAKEONE[l.id] || MAKEONE[l.id].length < 20);
  check("course: every lesson has its own MAKE ONE line",
    missing.length === 0, missing.map((l) => l.id).join(", "));
  check("course: the MAKE ONE lines are all different",
    new Set(Object.values(MAKEONE)).size === Object.keys(MAKEONE).length);
  // Generic nagging gets ignored. Exactly one lesson is allowed to say don't
  // film, and naming itself as the exception is what makes the rest credible.
  check("course: exactly one MAKE ONE line says don't film, and it names itself",
    /film nothing/.test(MAKEONE["u7-l2"] || "") &&
    /only lesson/.test(MAKEONE["u7-l2"] || ""), MAKEONE["u7-l2"]);
  const notAnAsk = Object.entries(MAKEONE)
    .filter(([k]) => k !== "u7-l2")
    .filter(([, v]) => !/\b(film|filmed|camera|clip|post|postable)\b/.test(v));
  check("course: every other MAKE ONE line asks for something on camera",
    notAnAsk.length === 0, notAnAsk.map(([k]) => k).join(", "));

  check("course: every unit has a line for what you can do now",
    COURSE.every((u) => CARRY[u.id] && CARRY[u.id].length > 20),
    COURSE.filter((u) => !CARRY[u.id]).map((u) => u.id).join(", "));

  // The rule card is the only place --danger appears outside answer feedback.
  // It stays loud by staying rare.
  const ruleLessons = lessons.filter((l) => l.cards.some((c) => kind(c) === "rule"));
  check("course: rule cards stay scarce", ruleLessons.length <= 5,
    ruleLessons.map((l) => l.id).join(", "));

  // Unit 0 is the answer to "you don't get context on what Anticipy is".
  const u0 = COURSE[0];
  check("course: it opens with what the thing actually is",
    u0.id === "u0" && u0.lessons.length >= 3 &&
    JSON.stringify(u0).includes("a pendant you wear"), u0 && u0.id);
  check("course: and it defines it before it sells anything",
    u0.lessons[0].cards.some((c) => kind(c) === "def"));
}

// ==========================================================================
// 11. THE ACCESSIBILITY DEFECTS THAT SHIPPED ONCE
// ==========================================================================
{
  const lum = (hex) => {
    const c = [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16) / 255)
      .map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const tok = (n) => (LEARN.match(new RegExp("--" + n + ":\\s*(#[0-9A-Fa-f]{6})")) || [])[1];

  // The one element that could show progress could not be seen: gold on the
  // hairline measures 1.68:1 against 1.4.11's 3:1 floor for non-text.
  const rail = (LEARN.match(/\.prail i\{[^}]*\}/) || [""])[0];
  check("player: the progress fill is bronze, not gold", /var\(--accent-ink\)/.test(rail), rail);
  const r1 = ratio(tok("accent-ink"), tok("rule-2"));
  check(`player: the progress fill clears 3:1 against its track (${r1.toFixed(2)}:1)`, r1 >= 3, String(r1));

  // Bronze is 4.64:1 on the page and 4.21:1 inside a card, so an eyebrow in
  // a card needed its own weight.
  const r2 = ratio(tok("accent-ink-2"), tok("paper-2"));
  check(`player: an eyebrow inside a card clears AA (${r2.toFixed(2)}:1)`, r2 >= 4.5, String(r2));

  // Answering used to make the explanation harder to read: the global
  // button:disabled{opacity:.6} took it to 4.74:1.
  check("player: an answered option is not dimmed",
    /\.qopt:disabled\{opacity:1/.test(LEARN));
  // and feedback is keyed to YOUR answer, not a generic reveal
  check("player: a wrong answer gets its own explanation",
    /whyWrong/.test(LEARN) && /L\.ans\.ok \? c\.why : \(c\.whyWrong/.test(LEARN));
  check("player: the check is never gated", /skip this one/.test(LEARN));

  check("player: the overlay is a dialog and the page behind it is inert",
    /role="dialog"/.test(LEARN) && /aria-modal="true"/.test(LEARN) && /\.inert = true/.test(LEARN));
  check("player: cards are announced", /aria-live="polite"/.test(LEARN) &&
    /role="progressbar"/.test(LEARN));
  check("player: the back gesture closes the lesson instead of leaving the site",
    /history\.pushState/.test(LEARN) && /popstate/.test(LEARN));
  // holding Enter used to run an entire lesson in under a second
  check("player: a held key does not run the lesson", /if \(ev\.repeat\) return;/.test(LEARN));
  // 28x28 on a bare glyph, against Apple's 44 and WCAG 2.5.8
  const x = (LEARN.match(/\.pbar \.x\{[^}]*\}/) || [""])[0];
  check("player: the exit is a 44px target with a label",
    /width:44px/.test(x) && /height:44px/.test(x) && /aria-label="Close this lesson"/.test(LEARN), x);
  // #player sized to iOS Safari's LARGE viewport, so the footer sat under the
  // toolbar whenever the URL bar was expanded
  check("player: it is sized to the small viewport and respects the safe area",
    /height:100dvh/.test(LEARN) && /env\(safe-area-inset-bottom\)/.test(LEARN));

  // flex-basis:0% means the hypothetical size is 0, so flex-wrap never fires;
  // min-width:0 then removes the min-content floor. At 390px a unit blurb
  // rendered in a seven-pixel column, nine lines tall, and pushed the page's
  // scrollWidth to 400 against a 390 client width.
  const blurb = (LEARN.match(/\.ublurb\{[^}]*\}/) || [""])[0];
  check("player: the unit blurb has a real flex basis",
    !/flex:1;min-width:0/.test(blurb) && /@media \(max-width:640px\)/.test(LEARN), blurb);

  // .streak had no rule at all, and rendered only from day 2 — the day
  // someone starts is the day they most need a reason to come back.
  check("player: the streak is styled and starts at day 1",
    /\.streak\{/.test(LEARN) && /n === 1 \? "day 1"/.test(LEARN));

  // <a class="btn"> rendered underlined inside the black pill: no stylesheet
  // on either page ever set text-decoration.
  check("player: button-styled links are not underlined",
    /\.btn\{[\s\S]{0,400}?text-decoration:none/.test(LEARN));
}

// ==========================================================================
// 12. THE STATE MACHINE — what "you're in" is allowed to mean
// ==========================================================================
// The founder: "It just says, 'You're in. Here's your link.' That doesn't
// even make sense." Four separate defects produced that, and each is asserted
// here rather than trusted.
//
//   THE INVARIANT: status is a consequence of a written application; email is
//   a consequence of a written status. Never the reverse.
{
  // (a) /fellows/start hard-coded status:"new" in its RESPONSE, so a member
  // who was already in came back looking brand new — and got walked through
  // the picker, four questions and the wait to be told "You're in." about an
  // account that was already in.
  // Scoped to the handler. The first version of these assertions searched the
  // whole hook and passed because an unrelated, correct line elsewhere matched
  // — a test that is green for the wrong reason is worse than no test, and
  // mutation testing is the only thing that catches it.
  const startBlock = HOOK.slice(HOOK.indexOf('routerAdd("POST", "/fellows/start"'),
                                HOOK.indexOf('GET /fellows/confirm'));
  const startReturn = HOOK.slice(HOOK.indexOf('routerAdd("POST", "/fellows/start"'));
  const startJson = startReturn.slice(startReturn.indexOf("return e.json(200, {\n    ok: true, token: token"));
  check("start: the response reports the record's real status",
    /status: fellow\.getString\("status"\)/.test(startJson) && !/status: "new",/.test(startJson),
    startJson.slice(0, 260));
  check("start: and its real fellowship and payout state",
    /fellowship: fellow\.getString\("fellowship"\)/.test(startJson) &&
    /code_active: !!fellow\.get\("code_active"\)/.test(startJson));

  // (b) code_active was set false unconditionally: typing your own email
  // again switched OFF the payouts of a confirmed, earning fellow.
  check("start: only a NEW row has its payout switch initialised",
    /if \(isNew\) fellow\.set\("code_active", false\)/.test(startBlock) &&
    !/^\s*fellow\.set\("code_active", false\);/m.test(stripComments(startBlock)),
    "an unconditional reset here switches off a confirmed fellow's payouts");

  // (c) parental_consent was reset to "pending" unconditionally, silently
  // revoking a guardian's completed setup.
  check("start: a confirmed guardian consent is never reset",
    /getString\("parental_consent"\) !== "confirmed"/.test(startBlock),
    "scoped to /fellows/start — a correct line in another handler must not satisfy this");

  // (d) the confirm link is the payout switch, and start minted a fresh token
  // hash on every call — killing the link already sitting in an inbox.
  check("start: does not invalidate a confirm link that is already in an inbox",
    !/consent_token_hash/.test(stripComments(startBlock)), "start still writes consent_token_hash");

  // BUG B — the ordering. The email is the one side effect that cannot be
  // rolled back, and it was happening before the save.
  const apply = HOOK.slice(HOOK.indexOf('routerAdd("POST", "/fellows/apply"'));
  const iAccept = apply.indexOf('fellow.set("status", "accepted")');
  const iSave = apply.indexOf("try { e.app.save(fellow); }", iAccept);
  const iSend = apply.indexOf("api.resend.com", iAccept);
  check("apply: the fellow is saved BEFORE anything is emailed",
    iAccept > 0 && iSave > iAccept && iSend > iSave,
    `accept@${iAccept} save@${iSave} send@${iSend}`);
  check("apply: and a failed save sends nothing at all",
    /return e\.json\(200, \{ ok: false,\n\s*message: "We couldn't save that\./.test(apply));
  check("apply: the welcome cannot be sent twice",
    /!fellow\.getString\("welcome_sent_at"\)/.test(apply) &&
    /fellow\.set\("welcome_sent_at"/.test(apply));
  check("apply: welcome_sent_at has a migration",
    readFileSync(join(ROOT, "backend/pb_migrations/1700000044_fellow_welcome_sent.js"), "utf8")
      .includes("welcome_sent_at"));

  // ask_more is reversible and recorded, never terminal
  check("apply: a near-miss is recorded as needs_more, not left as new",
    /fellow\.set\("status", "needs_more"\)/.test(apply));
  check("apply: and a near-miss is never emailed",
    apply.slice(apply.indexOf('verdict === "ask_more"'),
                apply.indexOf('verdict === "ask_more"') + 400).indexOf("resend") === -1);

  // BUG D — the "already in" path returned no fellow, so the acceptance
  // screen rendered for a returning member with no link on it.
  check("apply: an existing member gets their record back",
    /already: true,[\s\S]{0,400}?referral_code: fellow\.getString\("referral_code"\)/.test(apply));
  check("funnel: and is routed to their dashboard, not a second acceptance",
    /if \(j\.already\)\{[\s\S]{0,600}?show\("s7"\)/.test(FUNNEL));

  // the same branch has to exist in BOTH places or it comes back
  check("funnel: signup routes an accepted fellow to the dashboard",
    /F\.me\.status === "accepted"\)\{ loadMe\(\)[\s\S]{0,60}show\("s7"\)/.test(FUNNEL));

  // the model had a 45s ceiling in front of a client that no longer pads
  check("apply: the model timeout fits inside a human wait", !/timeout: 45/.test(HOOK_CODE));
}

// ==========================================================================
// 13. THE FUNNEL'S OWN SHIPPED DEFECTS
// ==========================================================================
{
  check("funnel: the four-question bar has four segments",
    (FUNNEL.match(/<div class="steps" id="steps"[^>]*>((<i><\/i>){4})/) || []).length > 0 &&
    /\.steps i\.done\{/.test(FUNNEL),
    "one <i style=width:25%> measured identical at Q1, Q2, Q3 and Q4");
  check("funnel: the wait has no ring and no spinner",
    !/class="ring"/.test(FUNNEL) && !/ringfg/.test(FUNNEL) && !/MIN = 18000/.test(FUNNEL),
    "an SVG with fill:black and stroke:none ran for 18 seconds");
  check("funnel: and every stage line corresponds to a real event",
    /settled = true/.test(FUNNEL) && /RSTAGES/.test(FUNNEL));
  check("funnel: an unfavourable verdict never waits",
    /verdict === "ask_more"[\s\S]{0,220}?show\("s6b"\); return;/.test(FUNNEL));
  check("funnel: a Soon row cannot throw",
    !/\.pname/.test(FUNNEL_CODE) && !/we'll email you when/.test(FUNNEL_CODE));
  check("funnel: the primary button keeps its arrow through a label change",
    /function setLabel\(btn, text\)/.test(FUNNEL) && !/btn\.textContent = LETSGO/.test(FUNNEL_CODE));
  check("funnel: the name is not set in a synthesised italic",
    !/<em>" \+ esc\(name\)/.test(FUNNEL));
  check("funnel: no stylesheet-less <hr class=\"rule\">",
    !/hr class=\"rule\"/.test(FUNNEL_CODE));
  check("funnel: no --warn, which is not a token on this page",
    !/var\(--warn\)/.test(FUNNEL_CODE));
  check("funnel: no build tag in the public footer", !/buildtag/.test(FUNNEL));
  // .msg.bad never had a rule. It was invisible while .msg defaulted to red,
  // and it made every error grey the moment that default was corrected.
  check("funnel: every message class the JS emits actually has a rule",
    ((FUNNEL.match(/el\.className = "msg"[^;]*/) || [""])[0]
      .match(/"\s(err|ok)"/g) || []).every((c) =>
        new RegExp("\\.msg\\." + c.replace(/[^a-z]/g, "") + "\\{").test(FUNNEL)),
    (FUNNEL.match(/el\.className = "msg"[^;]*/) || [""])[0]);
  check("funnel: and a neutral message is not styled as an error or a success",
    /tone === true \? " err"/.test(FUNNEL) && /: ""\)/.test(FUNNEL));

  check("funnel: validation reports every missing field at once",
    /aria-invalid/.test(FUNNEL) && /miss\.push/.test(FUNNEL));
  check("funnel: an empty answer nudges instead of blocking",
    !/v\.length < 2\) return say/.test(FUNNEL) && /a few more words/.test(FUNNEL));
  check("funnel: someone stuck on a question is never trapped",
    /can't think of one/i.test(FUNNEL_TEXT));
  check("funnel: the age gate expires and offers a way back",
    /b-notme/.test(FUNNEL) && !/lsSet\("fx_gate", "blocked"\)/.test(FUNNEL));
  check("funnel: the under-13 line is not a rejection of the person",
    /Come back on your birthday/.test(FUNNEL) && !/Not this time/.test(FUNNEL_CODE));
  check("funnel: Next cannot sit under the phone keyboard",
    /\.s4foot\{position:sticky/.test(FUNNEL));
  // The acceptance headline is only permitted because the line under it is
  // verbatim theirs. Without a quote it has to degrade.
  check("funnel: the strong headline degrades when there is nothing to quote",
    /if \(!quote && name\) \$\("acc-h"\)\.textContent = "You're in, "/.test(FUNNEL));
  check("funnel: and it quotes them mechanically rather than saying nothing specific",
    /split\(\/\\s\+\/\)\.slice\(0, 12\)/.test(FUNNEL));
  // "Post it on your own account, and say it's a paid thing" was step 3 of the
  // acceptance screen, aimed at applicants as young as thirteen.
  check("funnel: the acceptance screen does not instruct a minor to publish",
    !/Post it on your own account/i.test(FUNNEL_CODE));
  check("funnel: it explains what Anticipy is, where the decision is made",
    /pendant you wear/i.test(FUNNEL_TEXT) && /hands in your Chrome/i.test(FUNNEL_TEXT));
}

// ==========================================================================
// 14. REMOVAL HAS TO BE REMOVAL
// ==========================================================================
// Found by the fellowship gate on its second run, not by reading the code.
// /internal/fellows/remove sets status "removed", clears the session hash and
// revokes the code — and nothing outside the internal listing ever read that
// status. So a person taken out for spam or abuse could type the same address
// into /fellows/start, be handed a fresh session token, re-apply, and at 18+
// have /fellows/apply set code_active back to true. Removal was undoable by
// the person who had been removed.
{
  const startBlock = HOOK.slice(HOOK.indexOf('routerAdd("POST", "/fellows/start"'),
                                HOOK.indexOf('GET /fellows/confirm'));
  check("removal: signing up again with a removed address is refused",
    /getString\("status"\) === "removed"/.test(startBlock) &&
    /return e\.json\(200, \{ ok: false,/.test(startBlock),
    "start must not mint a session for a removed fellow");

  // ...and it must not confirm that the address is on file while doing it.
  const refusal = (startBlock.match(/=== "removed"\)[\s\S]{0,400}?message: "([^"]*)"/) || ["", ""])[1];
  check("removal: and the refusal does not leak that the address is known",
    refusal.length > 20 && !/removed|banned|blocked|no longer|we took you/i.test(refusal),
    JSON.stringify(refusal));

  // Every route that accepts a session token must drop a removed fellow, or a
  // token already in flight outlives the removal.
  const tokenLookups = (HOOK.match(/session_hash = \{:h\}/g) || []).length;
  const guarded = (HOOK.match(/if \(fellow && fellow\.getString\("status"\) === "removed"\) fellow = null;/g) || []).length;
  check(`removal: all ${tokenLookups} token routes drop a removed fellow`,
    tokenLookups > 0 && guarded === tokenLookups, `${guarded} guarded of ${tokenLookups}`);

  // The gate itself is the scoreboard. If it stops existing, the fellowship
  // goes back to having no measure of whether anyone can walk through it.
  const gate = readFileSync(join(ROOT, "overnight/fellowship_gate.py"), "utf8");
  check("gate: the fellowship has a walking-skeleton scoreboard",
    /LEGS = \[/.test(gate) && (gate.match(/\(\d+, "/g) || []).length >= 8);
  check("gate: its last leg cannot be faked",
    /fellowship_proof\.json/.test(gate) && /not_on_the_team/.test(gate) &&
    /amount_paid_usd/.test(gate));
  check("gate: it cleans up the row it creates",
    /internal\/fellows\/remove/.test(gate) &&
    /cannot be removed/.test(gate), "a gate that leaves rows in a table of minors is not trustworthy");
  // /internal/* is refused on the public host, never exposed through the edge.
  check("gate: internal calls go straight at the backend",
    /ANTICIPY_BACKEND_URL/.test(gate) && /BACKEND\}\/internal/.test(gate));
}

// ==========================================================================
// 15. THE GUARDIAN STEP — the only legal artifact in the system
// ==========================================================================
// Two things were true at once and both were live.
//
// (a) Nothing in the codebase could set parental_consent to "confirmed".
//     /fellows/verify, /fellows/start and /fellows/me write "pending" or
//     "not_required" and that was the entire set of writers. So a minor could
//     do everything right and never become payable — the money switch was
//     unreachable.
// (b) The "send your parent this link" control pointed at /setup?f=<code>,
//     and pb_public/setup.html is the CHROME EXTENSION DEVELOPER-MODE
//     INSTALLER. On the live site /setup isn't even one of the four paths the
//     rewrites forward, so a parent following it got a 404.
{
  check("guardian: nothing links a parent at the extension installer",
    !/\/setup\?f=/.test(stripComments(FUNNEL)),
    "setup.html is 'Anticipy Claude Version — Set up your browser'");

  check("guardian: something can finally confirm consent",
    /parental_consent", "confirmed"/.test(GUARD),
    "no writer for parental_consent = confirmed exists anywhere");
  check("guardian: and confirming it is what switches the money on",
    /parental_consent", "confirmed"\);[\s\S]{0,400}?set\("code_active", true\)/.test(GUARD));

  // The referral code is PUBLIC — it is in the link the fellow posts — so
  // consenting on the strength of it would let any stranger who saw one
  // declare themselves a child's guardian.
  check("guardian: consent is keyed to a private token, never the referral code",
    /guardian_token_hash/.test(GUARD) && !/referral_code/.test(GUARD),
    "the guardian route must not accept a referral code as identity");
  check("guardian: only the hash of that token is stored",
    /set\("guardian_token_hash", sha256\(raw\)\)/.test(GUARD));
  check("guardian: and the token dies with the consent it carried",
    /set\("guardian_token_hash", ""\)/.test(GUARD));

  // A minor's own signature is voidable at their option, so the guardian has
  // to accept in their OWN name as payee of record too.
  const page = asText(GUARD);
  check("guardian: the affirmation names them as payee in their own name",
    /on their behalf and in my own name as the person the money is paid to/i.test(page));
  check("guardian: and it cannot be submitted without ticking it",
    /body\.affirm !== true/.test(GUARD));
  check("guardian: what is captured is name, email, when, where and which terms",
    ["guardian_name", "guardian_email", "guardian_consent_at",
     "guardian_consent_ip", "guardian_terms_version"].every((f) => GUARD.includes(f)));
  check("guardian: it is honest that only money waits, never the learning",
    /Only the payment waits/i.test(asText(FUNNEL)) &&
    /everything in the course is|the lessons, your link/i.test(asText(FUNNEL)));
  check("guardian: and it asks a parent for nothing it does not need",
    /No social security number, no bank/i.test(page) || /no bank account and no ID/i.test(page));

  // It has to live under /fellows/* or the edge 404s it, which is exactly how
  // the old link died.
  check("guardian: the page is served from a path the site actually forwards",
    /routerAdd\("GET", "\/fellows\/guardian"/.test(GUARD));
  // A const at file top-level is NOT visible inside a routerAdd callback in
  // this runtime. Every handler here hashes, so every handler declares it.
  const routes = (GUARD.match(/routerAdd\(/g) || []).length;
  const hashers = (GUARD.match(/const sha256 = \(s\) => \$security\.sha256\(s\);/g) || []).length;
  check(`guardian: all ${routes} handlers redeclare their own sha256`,
    routes > 0 && hashers === routes, `${hashers} declarations for ${routes} routes`);
}

// ==========================================================================
// 16. NO HARD-CODED LESSON COUNT ANYWHERE
// ==========================================================================
// Two adversarial reviewers found the same thing independently: adding u3-l5
// made a hard-coded "29" on the dashboard wrong the moment it shipped, and the
// author's claim to have grepped for every other one was false. A number that
// has to be kept in sync with an array is a number that will go stale, so
// there is no longer one to keep in sync.
{
  const files = {
    "fellowships.html": FUNNEL,
    "fellowship-growth-learning.html": LEARN,
    "fellowship_gate.py": readFileSync(join(ROOT, "overnight/fellowship_gate.py"), "utf8"),
  };
  const stale = [];
  for (const [name, src] of Object.entries(files)) {
    const hits = src.match(/\b(?:of|\/)\s*\d{2}\s*(?:done|lessons?)\b|\b\d{2}\s+lessons\b/g) || [];
    hits.forEach((hh) => stale.push(`${name}: ${hh.trim()}`));
  }
  check("course: no screen pins a lesson total that will go stale",
    stale.length === 0, stale.join(" | "));

  // and the real total is whatever the array says
  const total = COURSE.reduce((a, u) => a + u.lessons.length, 0);
  check(`course: ${total} lessons across ${COURSE.length} units`, total >= 30);
}

// ==========================================================================
// 17. THE SUBMISSION PARSER'S BOUNDARIES
// ==========================================================================
// Two adversarial reviewers traced these; none of them is theoretical.
//
//   * LI_PULSE captured a slug of up to 120 characters and that slug becomes
//     BOTH native_id (column max 80) and the tail of url_key ("linkedin:
//     pulse:" + slug, column max 120). A real Pulse address overflowed both,
//     and an overflowing url_key does not fail loudly — it truncates, and a
//     truncated key is a key for a DIFFERENT article.
//   * A numeric id went into the key as the raw captured digits, so
//     urn:li:activity:0712... and urn:li:activity:712... were two keys for one
//     post — which is a duplicate hole and a way around the unique index.
//   * LinkedIn's own minimum age is 16, and a 13-15 fellow was offered it in
//     the placeholder, in the "we track" sentence and by the parser itself.
//
// The parser is EXECUTED here, not grepped, for the same reason the course is:
// a test that checks a regex exists passes forever while the regex is wrong.
{
  const OPEN = "==== fellowship url parser 8<";
  const CLOSE = ">8 end parser ===";
  const a = HOOK.indexOf(OPEN), b = HOOK.indexOf(CLOSE);
  assert.ok(a > 0 && b > a, "the parser markers are gone from fellowship.pb.js");
  const parserSrc = HOOK.slice(HOOK.indexOf("\n", a) + 1, HOOK.lastIndexOf("\n", b));
  const box = {};
  vm.createContext(box);
  vm.runInContext(parserSrc + "\n; this.parse = parseSubmittedUrl;", box);
  const parse = box.parse;
  assert.ok(typeof parse === "function", "parseSubmittedUrl did not come out of the hook");

  // The two column widths this parser has to live inside, read from the
  // migration rather than repeated here — if somebody widens a column the
  // boundary moves with it instead of this test going quietly stale.
  const SUB_MIG = readFileSync(join(ROOT, "backend/pb_migrations/1700000046_fellow_submissions.js"), "utf8");
  const colMax = (name) => {
    const m = SUB_MIG.match(new RegExp('name: "' + name + '", type: "text"[^}]*max: (\\d+)'));
    return m ? Number(m[1]) : 0;
  };
  const KEY_MAX = colMax("url_key"), ID_MAX = colMax("native_id");
  check(`parser: the columns it must fit are url_key ${KEY_MAX} / native_id ${ID_MAX}`,
    KEY_MAX === 120 && ID_MAX === 80, `${KEY_MAX} / ${ID_MAX}`);

  // ---- the longest Pulse slug that must still be ACCEPTED -----------------
  const longest = "a".repeat(ID_MAX);
  const ok80 = parse("https://www.linkedin.com/pulse/" + longest);
  check(`parser: a ${ID_MAX}-character Pulse slug is accepted`,
    ok80.ok === true && ok80.platform === "linkedin" && ok80.kind === "article" &&
    ok80.native_id === longest, JSON.stringify(ok80).slice(0, 160));
  check("parser: and everything it emits fits the columns it lands in",
    ok80.ok && ok80.url_key.length <= KEY_MAX && ok80.native_id.length <= ID_MAX &&
    ok80.url.length <= 500,
    ok80.ok ? `key ${ok80.url_key.length}, id ${ok80.native_id.length}` : "refused");
  // ...and it is still a fixed point of the parser, which is what stops the
  // canonical URL drifting away from the thing it points at.
  check("parser: the longest accepted slug survives its own canonical form",
    ok80.ok && parse(ok80.url).url_key === ok80.url_key);

  // ---- and the first one that must be REFUSED -----------------------------
  const tooLong = "a".repeat(ID_MAX + 1);
  const no81 = parse("https://www.linkedin.com/pulse/" + tooLong);
  check(`parser: a ${ID_MAX + 1}-character Pulse slug is refused, not truncated`,
    no81.ok === false, JSON.stringify(no81).slice(0, 160));
  // Refused in a sentence that says what happened and where to go. Falling
  // through to "that points at a profile or a page" would be a false statement
  // about a URL that points at exactly one article.
  check("parser: and the refusal is true and has somewhere to go",
    !no81.ok && !/profile or a page/.test(no81.message || "") &&
    /hello@anticipy\.ai/.test(no81.message || ""), no81.message);
  // The row-level wall behind the parser: the route refuses rather than
  // letting a save silently shorten a key.
  const subRoute = HOOK.slice(HOOK.indexOf('routerAdd("POST", "/fellows/submissions"'),
                              HOOK.indexOf('POST /fellows/submissions/remove'));
  check("parser: and the route checks the widths again before it writes",
    /p\.url_key\.length > 120/.test(subRoute) && /p\.native_id\.length > 80/.test(subRoute));

  // ---- zero padding is one post, therefore one key ------------------------
  const padded = [
    ["https://www.linkedin.com/feed/update/urn:li:activity:0007123456789012345/",
     "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345/"],
    ["https://x.com/jack/status/0000020", "https://x.com/jack/status/20"],
    ["https://www.tiktok.com/@tiktok/video/0007106594312292453",
     "https://www.tiktok.com/@tiktok/video/7106594312292453"],
  ];
  for (const [pad, bare] of padded) {
    const rp = parse(pad), rb = parse(bare);
    check(`parser: zero-padding mints no second key — ${bare.replace(/^https:\/\/(www\.)?/, "")}`,
      rp.ok && rb.ok && rp.url_key === rb.url_key && rp.url === rb.url,
      `${rp.ok ? rp.url_key : "REFUSED"} vs ${rb.ok ? rb.url_key : "REFUSED"}`);
  }
  // An id that is nothing but zeros still has to be something, not "".
  const zed = parse("https://x.com/jack/status/000");
  check("parser: an all-zero id normalises to 0, never to an empty key",
    zed.ok && zed.url_key === "x:0", JSON.stringify(zed).slice(0, 120));

  // ---- LinkedIn is not on the table a 13-15 fellow is shown ---------------
  // LinkedIn's own floor is 16. /fellows/me has always refused to store a
  // LinkedIn profile for a 13-15 fellow; the logbook was still offering to
  // take their LinkedIn posts, which is the same invitation by another door.
  const kid = "13_15", grown = "18_plus";
  check("parser: the platforms sentence a 13-15 fellow sees does not name LinkedIn",
    !/LinkedIn/.test(parse("", kid).message) && /TikTok/.test(parse("", kid).message) &&
    /X/.test(parse("", kid).message), parse("", kid).message);
  check("parser: an 18+ fellow is still told about all five",
    /LinkedIn/.test(parse("", grown).message));
  for (const u of ["https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345/",
                   "https://www.linkedin.com/posts/omar_a-thing-activity-7123456789012345-AbCd/",
                   "https://www.linkedin.com/pulse/how-i-made-a-thing-omar",
                   "https://lnkd.in/eXaMPle"]) {
    const r = parse(u, kid);
    check(`parser: 13-15 is refused LinkedIn — ${u.slice(8, 52)}`,
      r.ok === false && /start at 16/.test(r.message || ""), JSON.stringify(r).slice(0, 140));
  }
  // ...and the refusal is about LinkedIn's rule, not about them.
  const liNo = parse("https://www.linkedin.com/pulse/how-i-made-a-thing-omar", kid);
  check("parser: and that refusal accuses the fellow of nothing",
    !/you can't|not allowed|too young|denied/i.test(liNo.message || ""), liNo.message);
  // The other four are untouched by the band.
  check("parser: the same 13-15 fellow can still log TikTok, Instagram, YouTube and X",
    ["https://www.tiktok.com/@a/video/7106594312292453",
     "https://www.instagram.com/reel/BsOGulcndj-/",
     "https://www.youtube.com/shorts/dQw4w9WgXcQ",
     "https://x.com/jack/status/20"].every((u) => parse(u, kid).ok === true));
  // Enforced twice on the server, and not offered on the screen at all.
  check("linkedin: the route checks the band again after the parse returns",
    /p\.platform === "linkedin" && band === "13_15"/.test(subRoute));
  check("linkedin: and the placeholder does not offer it to a 13-15 fellow",
    /age_band === "13_15"[\s\S]{0,120}TikTok, Instagram, YouTube or X link/.test(FUNNEL) &&
    !/placeholder="A TikTok, Instagram, YouTube, X or LinkedIn link"/.test(FUNNEL));
}

// ==========================================================================
// 18. WHAT HAPPENS AROUND THE NETWORK CALL AND AROUND A COLLISION
// ==========================================================================
// There are no transactions across an HTTP call in this runtime, which is the
// root of both of these.
//
//   * The route saved the row, spent up to eight seconds inside TikTok's
//     oEmbed, then saved the SAME pre-network object again. Eight seconds is
//     exactly how long it takes a person to give up and press Remove — and
//     that removal clears url_key. Re-saving the stale object put the row back
//     in their list AND put the key back under the unique index, locking the
//     video away from whoever actually made it.
//   * Both submission limits count rows the fellow OWNS, and a URL held by
//     somebody else saves no row at all. So probing "is this video in the
//     system?" was free and unlimited.
{
  const subRoute = HOOK.slice(HOOK.indexOf('routerAdd("POST", "/fellows/submissions"'),
                              HOOK.indexOf('POST /fellows/submissions/remove'));
  const code = stripComments(subRoute);
  const sendAt = code.indexOf("$http.send");
  check("race: the route does call oEmbed at all", sendAt > 0);

  // The record is re-read AFTER the network call, and the pre-network object
  // is never saved again.
  const refetchAt = code.indexOf('findRecordById("fellow_submissions"');
  check("race: the row is re-read by id after the network call",
    refetchAt > sendAt, `send at ${sendAt}, re-read at ${refetchAt}`);
  const savesAfter = (code.slice(sendAt).match(/e\.app\.save\((\w+)\)/g) || []);
  check("race: and nothing saves the pre-network object after the call",
    savesAfter.length > 0 && !savesAfter.includes("e.app.save(rec)"),
    savesAfter.join(", "));
  // The two fields a removal moves are the two the write is conditional on.
  check("race: the write is abandoned if status or url_key moved underneath it",
    /getString\("status"\) === "logged"/.test(code) &&
    /getString\("url_key"\) === p\.url_key/.test(code));
  // ...and the page is not told to add a row that no longer exists.
  check("race: and the page does not render a submission the server did not send",
    /if \(j\.already \|\| !j\.submission\)/.test(FUNNEL));

  // A collision saves nothing, so a ceiling that counts saved rows is no
  // ceiling at all. The attempt meter counts the bounce as well as the row.
  check("limits: attempts are metered, not only the rows that landed",
    /ANTICIPY_FELLOW_SUBMIT_ATTEMPT_MAX/.test(code) &&
    /fellow_meter/.test(code.slice(0, code.indexOf("new Record(e.app.findCollectionByNameOrId(\"fellow_submissions\"))"))),
    "the collision path had no ceiling");
  const meterAt = code.indexOf("ATTEMPT_MAX");
  const insertAt = code.indexOf('new Record(e.app.findCollectionByNameOrId("fellow_submissions"))');
  check("limits: and the attempt is counted BEFORE the write, so a bounce costs the same",
    meterAt > 0 && insertAt > meterAt, `meter at ${meterAt}, insert at ${insertAt}`);
  // Two different sentences would tell a prober which ceiling they hit.
  const ceilings = (subRoute.match(/That's a lot in one day\. Try again tomorrow\./g) || []).length;
  check("limits: both ceilings answer in the same words, so neither is an oracle",
    ceilings >= 2, `${ceilings} occurrences`);
  // The collision refusal itself still confirms nothing about who holds it.
  // Read the CODE, not the comments: the comment above that branch says
  // "SOMEBODY ELSE HAS IT" precisely because the sentence sent to the fellow
  // must not.
  check("limits: and the collision refusal names nobody",
    /We can't add that one\./.test(code) &&
    !/another fellow|somebody else has|already claimed by/i.test(code));
}

// ==========================================================================
// 17. THE ON-DEVICE CLAIM MUST MATCH THE CODE
// ==========================================================================
// The course taught "your audio never leaves your phone" as the TRUE version
// of the never-claim list, and made it the CORRECT answer to a quiz whose
// explanation read "that one is true, and it's the one that survives a smart
// person checking it."
//
// It does not survive checking. app/ios/Anticipy/Audio/TranscriberClient.swift
// streams raw Opus frames to wss://api.deepgram.com for the PENDANT path — the
// component the product is named for. design/LOCAL-FIRST.md line 28 names
// Deepgram explicitly as the thing that must not happen. The phone's own
// microphone IS on-device (PhoneListener.swift, requiresOnDeviceRecognition),
// and LocalTranscriber.swift exists with the same flag and zero call sites.
//
// Teaching a false privacy claim to two hundred teenagers who will say it on
// camera is the exact failure the course itself warns about. Until the pendant
// path is on-device, no surface may claim it is.
{
  const surfaces = { course: asText(LEARN), funnel: FUNNEL_TEXT };
  const bad = [];
  for (const [name, text] of Object.entries(surfaces)) {
    if (/audio never leaves/i.test(text)) bad.push(name + ': "audio never leaves"');
    if (/nothing ever leaves/i.test(text) && !/claim:"nothing ever leaves/.test(LEARN)) {
      bad.push(name + ': "nothing ever leaves" outside a never-say claim');
    }
    if (/everything happens on.device/i.test(text) && !/claim:/.test(text)) {
      bad.push(name + ': "everything happens on-device"');
    }
  }
  check("privacy: no surface claims audio stays on the phone",
    bad.length === 0, bad.join(" | "));

  // and the honest version has to actually be there, or we deleted a claim and
  // left a fellow with nothing to say when asked
  check("privacy: and the true version is taught in its place",
    /goes to a transcriber/i.test(asText(LEARN)),
    "removing the false claim without supplying the true one leaves them silent");
}

console.log(failures ? `\ntest_fellowship: ${failures} FAILED` : "\ntest_fellowship: all passed");
process.exit(failures ? 1 : 0);
