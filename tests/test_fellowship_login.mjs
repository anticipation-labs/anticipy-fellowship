// The sign-up and sign-in loop, executed.
//
// I cannot read the email that carries the code — the Resend key is send-only,
// which is the correct posture and also means the one human step in this loop
// is not mine to perform. So this proves everything on OUR side of that step:
// it loads the real fellowship.pb.js, captures the real handlers, plants a
// code whose hash it controls, and drives verify -> account -> session -> me
// against a fake database.
//
// What that leaves genuinely unproven is exactly one link: that the email
// lands in a human's inbox. That one is closed by a person signing up once.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "backend/pb_hooks/fellowship.pb.js"), "utf8");
const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok || !detail ? "" : "  -> " + detail}`);
  if (!ok) failures++;
};

// ---- a fake PocketBase --------------------------------------------------
class Rec {
  constructor(col, fields) { this.__col = col; this.f = Object.assign({}, fields); }
  set(k, v) { this.f[k] = v; }
  get(k) { return this.f[k]; }
  getString(k) { return this.f[k] == null ? "" : String(this.f[k]); }
}
function makeWorld(opts = {}) {
  const db = { fellows: [], fellow_codes: [], fellow_applications: [], fellow_progress: [],
               fellow_clicks: [], fellow_conversions: [], fellow_meter: [], internal_activity: [] };
  db.fellow_meter.push(new Rec("fellow_meter", { id: "m1", name: "email", hour: "", calls: 0 }));
  db.fellow_meter.push(new Rec("fellow_meter", { id: "m2", name: "llm", hour: "", calls: 0 }));
  let nextId = 1;
  const httpCalls = [];

  const app = {
    findCollectionByNameOrId: (n) => ({ name: n }),
    save(r) {
      if (!r.f.id) r.f.id = "id" + (nextId++);
      const list = db[r.__col];
      if (list && !list.includes(r)) list.push(r);
      if (!r.f.created) r.f.created = new Date().toISOString().replace("T", " ");
    },
    findFirstRecordByFilter(col, filter, params) {
      const rows = this.findRecordsByFilter(col, filter, "", 1, 0, params);
      if (!rows.length) throw new Error("not found");
      return rows[0];
    },
    findRecordsByFilter(col, filter, sort, limit, offset, params) {
      params = params || {};
      let rows = (db[col] || []).slice();
      if (/email = \{:em\}/.test(filter)) rows = rows.filter((r) => r.getString("email") === params.em);
      if (/used = false/.test(filter)) rows = rows.filter((r) => !r.get("used"));
      if (/name = 'email'/.test(filter)) rows = rows.filter((r) => r.getString("name") === "email");
      if (/name = 'llm'/.test(filter)) rows = rows.filter((r) => r.getString("name") === "llm");
      if (/session_hash = \{:h\}/.test(filter)) rows = rows.filter((r) => r.getString("session_hash") === params.h);
      if (/referral_code = \{:c\}/.test(filter)) rows = rows.filter((r) => r.getString("referral_code") === params.c);
      if (/fellow = \{:f\}/.test(filter)) rows = rows.filter((r) => r.getString("fellow") === params.f);
      if (/ip = \{:ip\}/.test(filter)) rows = rows.filter((r) => r.getString("ip") === params.ip);
      if (/fellowship = \{:f\}/.test(filter)) rows = rows.filter((r) => r.getString("fellowship") === params.f);
      // The click dedupe filters on BOTH, and a fake that quietly ignores half
      // a filter answers the wrong question: it returned every click row, so
      // the second visitor looked like a repeat of the first and a fellow
      // would have been credited once no matter how many people tapped.
      // Anchored, because "code = {:c}" is a substring of "referral_code =
      // {:c}" — without the boundary this also fired on the fellows lookup,
      // filtered those rows by a column they do not have, found nobody, and
      // made a working referral route look broken.
      if (/(^|[\s&(])code = \{:c\}/.test(filter)) rows = rows.filter((r) => r.getString("code") === params.c);
      if (/ip_hash = \{:h\}/.test(filter)) rows = rows.filter((r) => r.getString("ip_hash") === params.h);
      // Anything this fake does not understand is a test bug, not an empty
      // result. Say so instead of inventing an answer.
      const known = /email|used|name|session_hash|referral_code|fellow|ip|fellowship|code|ip_hash/;
      if (filter && !known.test(filter)) {
        throw new Error("test harness saw an unrecognised filter on " + col + ": " + filter);
      }
      if (sort && sort[0] === "-") rows.reverse();
      return rows.slice(offset || 0, (offset || 0) + (limit || 500));
    },
  };

  const routes = {};
  const sandbox = {
    routerAdd: (m, p, fn) => { routes[m + " " + p] = fn; },
    cronAdd: () => {},
    $os: { getenv: (k) => ({
      RESEND_API_KEY: opts.noEmail ? "" : "re_test",
      OPENROUTER_API_KEY: opts.noModel ? "" : "or_test",
      ANTICIPY_INTERNAL_KEY: "testkey",
      ANTICIPY_SITE_URL: "https://anticipy.ai",
      ANTICIPY_FELLOW_SALT: "salt",
    }[k] || "") },
    $security: { sha256, equal: (a, b) => a === b },
    $http: { send: (req) => {
      httpCalls.push(req);
      if (String(req.url).includes("resend")) return { statusCode: opts.emailFails ? 500 : 200 };
      return { statusCode: 200, json: { choices: [{ message: { content: JSON.stringify(
        { verdict: opts.modelSays || "accept", message: opts.modelMsg || "you said you want to get better at making things people watch, and that's the whole bar." }
      ) } }] } };
    } },
    Record: function (col) { return new Rec(col.name, {}); },
    console: { log: () => {} },
    Date, JSON, Math, String, Number, Boolean, Object, Array, isNaN, parseInt,
    encodeURIComponent, decodeURIComponent, RegExp, Error,
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);

  const call = (method, path, body, headers) => {
    const fn = routes[method + " " + path];
    assert.ok(fn, "no route " + method + " " + path);
    let out = null;
    fn({
      app,
      realIP: () => opts.ip || "203.0.113.9",
      request: {
        header: { get: (h) => (headers || {})[h] || "" },
        url: { path: opts.urlPath || path },
        pathValue: (k) => (opts.pathValues || {})[k] || "",
      },
      requestInfo: () => ({ body: body || {} }),
      json: (status, obj) => { out = { status, body: obj }; return out; },
      redirect: (status, url) => { out = { status, redirect: url }; return out; },
      html: (status, h) => { out = { status, html: h }; return out; },
      response: { header: () => ({ set: () => {} }) },
    });
    return out;
  };
  return { db, call, httpCalls, app };
}

const YEAR_16 = new Date().getUTCFullYear() - 16;
const YEAR_20 = new Date().getUTCFullYear() - 20;
const YEAR_10 = new Date().getUTCFullYear() - 10;

// ==========================================================================
// 1. THE UNDER-13 STOP WRITES NOTHING — proven by running it
// ==========================================================================
{
  const w = makeWorld();
  const r = w.call("POST", "/fellows/code",
    { email: "kid@example.com", birth_month: 6, birth_year: YEAR_10, country: "us" });
  check("under-13 is stopped", r.body.stop === true && r.body.ok === false, JSON.stringify(r.body));
  const rows = w.db.fellows.length + w.db.fellow_codes.length;
  check("under-13 wrote NOTHING at all", rows === 0,
    `${w.db.fellows.length} fellows, ${w.db.fellow_codes.length} codes`);
  check("under-13 sent no email", w.httpCalls.length === 0, String(w.httpCalls.length));
}
{
  const w = makeWorld();
  w.call("POST", "/fellows/code", { email: "x@example.com", birth_month: 6, birth_year: YEAR_20, country: "gb" });
  check("outside US/CA wrote nothing", w.db.fellows.length + w.db.fellow_codes.length === 0);
}

// ==========================================================================
// 2. A CODE IS ONLY EVER STORED AS A HASH, AND ONLY AFTER IT WAS SENT
// ==========================================================================
{
  const w = makeWorld();
  const r = w.call("POST", "/fellows/code",
    { email: "real@example.com", birth_month: 5, birth_year: YEAR_16, country: "us" });
  check("a valid signup is accepted", r.body.ok === true, JSON.stringify(r.body));
  check("one email went out", w.httpCalls.filter((c) => String(c.url).includes("resend")).length === 1);
  check("exactly one code row exists", w.db.fellow_codes.length === 1);
  const row = w.db.fellow_codes[0];
  check("the row holds a sha256, not the code",
    /^[0-9a-f]{64}$/.test(row.getString("code_hash")), row.getString("code_hash").slice(0, 20));
  const body = JSON.parse(w.httpCalls[0].body);
  const emailed = (body.text.match(/\b(\d{6})\b/) || [])[1];
  check("the emailed code is the one that was hashed",
    !!emailed && sha256(emailed) === row.getString("code_hash"), String(emailed));
  check("the code never appears in the stored row",
    !JSON.stringify(row.f).includes(emailed), JSON.stringify(row.f).slice(0, 80));
}
{
  // If the email cannot be delivered, no code may exist.
  const w = makeWorld({ emailFails: true });
  const r = w.call("POST", "/fellows/code",
    { email: "real@example.com", birth_month: 5, birth_year: YEAR_16, country: "us" });
  check("a failed send saves no code", w.db.fellow_codes.length === 0 && r.body.ok === false,
    JSON.stringify(r.body));
}

// ==========================================================================
// 3. THE FULL LOOP: code -> verify -> account -> session -> me
// ==========================================================================
{
  const w = makeWorld();
  w.call("POST", "/fellows/code", { email: "loop@example.com", birth_month: 5, birth_year: YEAR_16, country: "us" });
  const emailed = JSON.parse(w.httpCalls[0].body).text.match(/\b(\d{6})\b/)[1];

  // wrong code first
  const bad = w.call("POST", "/fellows/verify",
    { email: "loop@example.com", code: emailed === "000000" ? "111111" : "000000",
      birth_month: 5, birth_year: YEAR_16, country: "us" });
  check("a wrong code is refused", bad.body.ok === false, JSON.stringify(bad.body));
  check("a wrong code does not create an account", w.db.fellows.length === 0);

  // the real one
  const ok = w.call("POST", "/fellows/verify",
    { email: "loop@example.com", code: emailed, name: "Sam",
      birth_month: 5, birth_year: YEAR_16, country: "us" });
  check("the real code signs you in", ok.body.ok === true, JSON.stringify(ok.body).slice(0, 120));
  check("an account now exists", w.db.fellows.length === 1);
  check("a token came back exactly once", typeof ok.body.token === "string" && ok.body.token.length === 48);

  const fellow = w.db.fellows[0];
  check("only the session HASH is stored, never the token",
    fellow.getString("session_hash") === sha256(ok.body.token) &&
    !JSON.stringify(fellow.f).includes(ok.body.token));
  check("age 16 is derived, not asked", fellow.getString("age_band") === "16_17", fellow.getString("age_band"));
  check("a 16-year-old starts as consent pending",
    fellow.getString("parental_consent") === "pending", fellow.getString("parental_consent"));
  // Lowercase, because that is the only shape that survives anticipy.ai's
  // checkout sanitizer intact — see section 9.
  check("a referral code was minted", /^[a-z0-9]{6}$/.test(fellow.getString("referral_code")),
    fellow.getString("referral_code"));
  check("the code cannot be replayed", w.db.fellow_codes[0].get("used") === true);

  // the session actually works
  const me = w.call("GET", "/fellows/me", null, { "X-Fellow-Token": ok.body.token });
  check("the token opens /fellows/me", me.status === 200 && me.body.ok === true, JSON.stringify(me.body).slice(0, 100));
  check("me returns the right person", me.body.fellow.email === "loop@example.com");
  const nope = w.call("GET", "/fellows/me", null, { "X-Fellow-Token": "a".repeat(48) });
  check("a made-up token opens nothing", nope.status === 401);

  // apply, and get in
  const app1 = w.call("POST", "/fellows/apply",
    { fellowship: "growth", terms: true,
      answers: { why: "i want to get better at making things people actually watch",
                 make: "not really, only for my friends", watch: "a video about a guy fixing a bike",
                 time: "maybe three hours" } },
    { "X-Fellow-Token": ok.body.token });
  check("the application is accepted", app1.body.verdict === "accept", JSON.stringify(app1.body).slice(0, 140));
  check("the acceptance quotes what the model wrote", /you said/i.test(app1.body.message), app1.body.message);
  check("status is now accepted", fellow.getString("status") === "accepted");
  check("a 16-year-old's code is NOT yet payable", fellow.get("code_active") !== true,
    "under 18 must wait for the guardian payout step");
  check("HQ was told someone joined",
    w.db.internal_activity.some((a) => a.getString("action") === "fellow.joined"));

  // terms are not optional
  const noTerms = w.call("POST", "/fellows/apply",
    { fellowship: "growth", answers: { why: "x" } }, { "X-Fellow-Token": ok.body.token });
  check("applying without the terms is refused", noTerms.body.ok === false, JSON.stringify(noTerms.body));

  // progress
  const p = w.call("POST", "/fellows/progress", { lessons: ["u1-l1", "u1-l2", "../etc", "U1-L3"] },
    { "X-Fellow-Token": ok.body.token });
  check("progress saves only well-formed lesson ids", p.body.saved === 2, JSON.stringify(p.body));
  const me2 = w.call("GET", "/fellows/me", null, { "X-Fellow-Token": ok.body.token });
  check("progress comes back on the next load", (me2.body.progress || []).length === 2,
    JSON.stringify(me2.body.progress));
}

// ==========================================================================
// 4. AN 18-YEAR-OLD CAN EARN IMMEDIATELY
// ==========================================================================
{
  const w = makeWorld();
  w.call("POST", "/fellows/code", { email: "adult@example.com", birth_month: 1, birth_year: YEAR_20, country: "us" });
  const c = JSON.parse(w.httpCalls[0].body).text.match(/\b(\d{6})\b/)[1];
  const v = w.call("POST", "/fellows/verify",
    { email: "adult@example.com", code: c, name: "Alex", birth_month: 1, birth_year: YEAR_20, country: "us" });
  const f = w.db.fellows[0];
  check("18+ needs no parental consent", f.getString("parental_consent") === "not_required");
  w.call("POST", "/fellows/apply",
    { fellowship: "growth", terms: true, answers: { why: "i want to learn how this works properly" } },
    { "X-Fellow-Token": v.body.token });
  check("18+ has a payable code straight away", f.get("code_active") === true);
}

// ==========================================================================
// 5. THE MODEL CAN NEVER REJECT A REAL ANSWER
// ==========================================================================
{
  const w = makeWorld({ modelSays: "ask_more", modelMsg: "give us more" });
  w.call("POST", "/fellows/code", { email: "m@example.com", birth_month: 1, birth_year: YEAR_20, country: "us" });
  const c = JSON.parse(w.httpCalls[0].body).text.match(/\b(\d{6})\b/)[1];
  const v = w.call("POST", "/fellows/verify",
    { email: "m@example.com", code: c, birth_month: 1, birth_year: YEAR_20, country: "us" });
  const r = w.call("POST", "/fellows/apply",
    { fellowship: "growth", terms: true,
      answers: { why: "i really want to learn how to make videos that people actually finish watching" } },
    { "X-Fellow-Token": v.body.token });
  check("a real answer is accepted even when the model says otherwise",
    r.body.verdict === "accept", JSON.stringify(r.body).slice(0, 120));
}
{
  // and gibberish is still sent back
  const w = makeWorld({ noModel: true });
  w.call("POST", "/fellows/code", { email: "g@example.com", birth_month: 1, birth_year: YEAR_20, country: "us" });
  const c = JSON.parse(w.httpCalls[0].body).text.match(/\b(\d{6})\b/)[1];
  const v = w.call("POST", "/fellows/verify",
    { email: "g@example.com", code: c, birth_month: 1, birth_year: YEAR_20, country: "us" });
  const r = w.call("POST", "/fellows/apply",
    { fellowship: "growth", terms: true, answers: { why: "asdf", make: "", watch: "", time: "" } },
    { "X-Fellow-Token": v.body.token });
  check("gibberish is sent back for one real sentence, with no model at all",
    r.body.verdict === "ask_more", JSON.stringify(r.body).slice(0, 120));
}

// ==========================================================================
// 6. THE REFERRAL LINK
// ==========================================================================
{
  const w = makeWorld({ pathValues: { code: "abc123" } });
  w.db.fellows.push(new Rec("fellows", { id: "f1", referral_code: "abc123", clicks_total: 0 }));
  const r = w.call("GET", "/r/{code}");
  check("a known code redirects and is credited",
    r.status === 302 && /ref=abc123/.test(r.redirect) && w.db.fellow_clicks.length === 1, JSON.stringify(r));
  check("the visitor's address is only stored hashed",
    /^[0-9a-f]{64}$/.test(w.db.fellow_clicks[0].getString("ip_hash")));
  check("the click is counted on the fellow", Number(w.db.fellows[0].get("clicks_total")) === 1);
  const again = w.call("GET", "/r/{code}");
  check("a refresh within the hour is not counted twice", w.db.fellow_clicks.length === 1);
}
{
  const w = makeWorld({ pathValues: { code: "nosuch" } });
  const r = w.call("GET", "/r/{code}");
  check("an unknown code still sends the visitor to the site, uncredited",
    r.status === 302 && /anticipy\.ai/.test(r.redirect) && w.db.fellow_clicks.length === 0, JSON.stringify(r));
}
{
  // the fallback path-reader, for if pathValue is not what this runtime calls it
  const w = makeWorld({ pathValues: {}, urlPath: "/r/fallbk" });
  w.db.fellows.push(new Rec("fellows", { id: "f1", referral_code: "fallbk", clicks_total: 0 }));
  const r = w.call("GET", "/r/{code}");
  check("the code is still read when pathValue gives nothing",
    /ref=fallbk/.test(r.redirect || ""), JSON.stringify(r).slice(0, 120));
}

// ==========================================================================
// 7. BEHIND THE anticipy.ai REWRITE, THE VISITOR IS NOT VERCEL
// ==========================================================================
{
  // Two different people arriving through the rewrite must land in two
  // different throttle buckets. If they don't, the eighth signup of the hour
  // locks out everyone on earth.
  const w = makeWorld({ ip: "76.76.21.21" });   // realIP() = Vercel, for all
  const send = (email, client) => w.call("POST", "/fellows/code",
    { email, birth_month: 3, birth_year: YEAR_20, country: "us" },
    { "X-Forwarded-For": client + ", 76.76.21.21" });

  // nine different people, one after another
  let refused = 0;
  for (let i = 0; i < 9; i++) {
    const r = send(`person${i}@example.com`, `203.0.113.${i + 1}`);
    if (!r.body.ok) refused++;
  }
  check("nine different visitors are not throttled as one", refused === 0,
    `${refused} were refused`);
  check("each of the nine actually got an email",
    w.httpCalls.filter((c) => String(c.url).includes("resend")).length === 9);

  // one person hammering it IS still throttled
  const w2 = makeWorld({ ip: "76.76.21.21" });
  let blocked = 0;
  for (let i = 0; i < 10; i++) {
    const r = w2.call("POST", "/fellows/code",
      { email: `same${i}@example.com`, birth_month: 3, birth_year: YEAR_20, country: "us" },
      { "X-Forwarded-For": "198.51.100.7, 76.76.21.21" });
    if (r.body.ok === true && w2.httpCalls.length <= i) blocked++;
  }
  const sent = w2.httpCalls.filter((c) => String(c.url).includes("resend")).length;
  check("one visitor hammering it is still capped", sent <= 8, `${sent} emails sent`);

  // and a click from two different people counts twice
  const w3 = makeWorld({ ip: "76.76.21.21", pathValues: { code: "SHARED" } });
  w3.db.fellows.push(new Rec("fellows", { id: "f1", referral_code: "shared", clicks_total: 0 }));
  w3.call("GET", "/r/{code}", null, { "X-Forwarded-For": "203.0.113.50, 76.76.21.21" });
  w3.call("GET", "/r/{code}", null, { "X-Forwarded-For": "203.0.113.51, 76.76.21.21" });
  check("two different people tapping one link count twice",
    Number(w3.db.fellows[0].get("clicks_total")) === 2,
    String(w3.db.fellows[0].get("clicks_total")));
  w3.call("GET", "/r/{code}", null, { "X-Forwarded-For": "203.0.113.50, 76.76.21.21" });
  check("the same person tapping twice still counts once",
    Number(w3.db.fellows[0].get("clicks_total")) === 2,
    String(w3.db.fellows[0].get("clicks_total")));
}

// ==========================================================================
// 8. YOU ARE NOT "IN" UNTIL YOU HAVE APPLIED
// ==========================================================================
{
  // The bug this pins: signup used to stamp status "accepted" and email
  // "you're in" the instant someone typed an address, which made the
  // fellowship picker, the four questions and the review that follow it
  // pure theatre. The first person to use it noticed within a minute.
  const w = makeWorld();
  const r = w.call("POST", "/fellows/start",
    { email: "seq@example.com", name: "Sam", birth_month: 5, birth_year: YEAR_20, country: "us" });
  check("signup succeeds", r.body.ok === true, JSON.stringify(r.body).slice(0, 90));
  check("signup does NOT accept anyone", r.body.fellow.status === "new", r.body.fellow.status);
  check("signup does NOT claim a fellowship", !r.body.fellow.fellowship, r.body.fellow.fellowship);
  check("the stored row is not accepted either",
    w.db.fellows[0].getString("status") === "new", w.db.fellows[0].getString("status"));
  check("NO email goes out at signup — nothing has happened yet",
    w.httpCalls.filter((c) => String(c.url).includes("resend")).length === 0,
    String(w.httpCalls.length));

  // now actually apply
  const a = w.call("POST", "/fellows/apply",
    { fellowship: "growth", terms: true,
      answers: { why: "i want to get better at making things people finish watching" } },
    { "X-Fellow-Token": r.body.token });
  check("applying is what gets you in", a.body.verdict === "accept", JSON.stringify(a.body).slice(0, 90));
  check("status changes only now", w.db.fellows[0].getString("status") === "accepted");
  const mails = w.httpCalls.filter((c) => String(c.url).includes("resend"));
  check("the welcome email goes out HERE, once", mails.length === 1, String(mails.length));
  const mail = JSON.parse(mails[0].body);
  check("and only now does anything say you're in", /you're in/i.test(mail.subject + mail.text),
    mail.subject);
  check("the welcome states the money split, never a bare $30",
    /\$30/.test(mail.text) && /half/i.test(mail.text) && /ships/i.test(mail.text));
  check("the confirm link is described as unlocking MONEY, not learning",
    /ready to get paid/i.test(mail.text) && !/confirm.*to start|verify.*before you/i.test(mail.text));
  // the raw confirm token must appear in the email and NOWHERE in the row
  const m = mail.text.match(/confirm\?t=([A-Za-z0-9]{48})/);
  check("a confirm token was minted into the email", !!m, mail.text.slice(-120));
  if (m) {
    check("only its hash is stored",
      w.db.fellows[0].getString("consent_token_hash") === sha256(m[1]) &&
      !JSON.stringify(w.db.fellows[0].f).includes(m[1]));
  }
}

// ==========================================================================
// 9. A REFERRAL CODE MUST SURVIVE THE ROUND TRIP TO STRIPE
// ==========================================================================
{
  // THE BUG THIS PINS. anticipy.ai's own checkout route normalises the
  // ap_ref cookie before putting it in Stripe metadata:
  //
  //     ap_ref.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24)
  //
  // Codes used to be minted UPPERCASE. So the click was counted, and then the
  // sale came back from the webhook as "h3fdg4" against a stored "H3FDG4" and
  // matched nothing. The fellow does the work, drives a purchase, and is
  // never credited — and it surfaces in a payout dispute, months later, with
  // the evidence gone.
  //
  // This mirrors the site's sanitizer exactly. If anyone changes the alphabet
  // back, or changes /r/ to upper-case its input again, this goes red.
  const siteSanitize = (v) =>
    String(v || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24);

  const w = makeWorld();
  w.call("POST", "/fellows/start",
    { email: "codecheck@example.com", name: "Cee", birth_month: 2, birth_year: YEAR_20, country: "us" });
  const code = w.db.fellows[0].getString("referral_code");

  check("a minted code is already in the shape checkout produces",
    siteSanitize(code) === code, `${code} -> ${siteSanitize(code)}`);
  check("a minted code has no characters checkout would strip",
    /^[a-z0-9-]+$/.test(code), code);
  check("a minted code avoids the characters people mistype",
    !/[ilo01]/.test(code), code);

  // and the whole round trip: link -> /r/ -> ?ref= -> cookie -> stripe -> lookup
  const w2 = makeWorld({ pathValues: { code: code } });
  w2.db.fellows.push(new Rec("fellows", { id: "f1", referral_code: code, clicks_total: 0 }));
  const hit = w2.call("GET", "/r/{code}");
  const refInUrl = (String(hit.redirect || "").match(/[?&]ref=([^&]*)/) || [])[1] || "";
  check("the /r/ redirect carries the code unchanged", refInUrl === code,
    `${refInUrl} vs ${code}`);
  check("and it still matches after checkout normalises it",
    siteSanitize(refInUrl) === code, `${siteSanitize(refInUrl)} vs ${code}`);
  check("the click was credited", Number(w2.db.fellows[0].get("clicks_total")) === 1);

  // a link someone typed in caps still works
  const w3 = makeWorld({ pathValues: { code: code.toUpperCase() } });
  w3.db.fellows.push(new Rec("fellows", { id: "f1", referral_code: code, clicks_total: 0 }));
  const shout = w3.call("GET", "/r/{code}");
  check("a link typed in capitals still credits the right fellow",
    Number(w3.db.fellows[0].get("clicks_total")) === 1 &&
    /[?&]ref=/.test(String(shout.redirect || "")),
    String(shout.redirect || "").slice(0, 90));
}

console.log(failures ? `\ntest_fellowship_login: ${failures} FAILED` : "\ntest_fellowship_login: all passed");
process.exit(failures ? 1 : 0);
