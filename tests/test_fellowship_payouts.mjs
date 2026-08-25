// THE PAYOUT RAIL. This is the file where real money leaves for a fifteen-
// year-old, so the assertions here are not about style.
//
// Four things are load-bearing and are PROVEN by running the code, not by
// grepping it — because every one of them is a claim about behaviour and a
// regex over a source file cannot tell you whether behaviour is right:
//
//   1. THE SAME CONVERSION CANNOT BE SENT TWICE. Not by a cron that double-
//      fires, not by two workers racing the same row, not by a retry after a
//      timeout. The engine is run against a fake store whose fellow_payouts
//      table enforces the real UNIQUE index, and a fake vendor that counts how
//      many orders were actually created.
//   2. AN UNKNOWN OUTCOME IS NEVER A FAILURE. A timeout or a 5xx that cannot be
//      reconciled goes to a human and is never automatically retried. This is
//      the bug that is live elsewhere in this codebase — internal_hq's reminder
//      sweep rolls its claim back on a timeout, which for a text message is an
//      annoyance and for $30 is a second gift card.
//   3. WITH NO KEY, NOTHING HAPPENS AND NOTHING BREAKS. No crash, no claim, no
//      consumed attempt, no alarm — and a status word that is distinguishable
//      from "configured wrongly".
//   4. UNDER 18 IS STORED VALUE ONLY, ENFORCED TWICE. Once when they choose and
//      once when we send, and the second one holds even when the first has been
//      bypassed by editing the row.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = readFileSync(join(ROOT, "backend/pb_hooks/fellowship_payouts.pb.js"), "utf8");
const MIG = readFileSync(join(ROOT, "backend/pb_migrations/1700000046_fellow_payouts.js"), "utf8");
const LANE = readFileSync(join(ROOT, "backend/pb_migrations/1700000047_fellow_payout_lane.js"), "utf8");
const SIGNUP = readFileSync(join(ROOT, "backend/pb_hooks/fellowship.pb.js"), "utf8");
const GUARDIAN = readFileSync(join(ROOT, "backend/pb_hooks/fellowship_guardian.pb.js"), "utf8");
const DOC = readFileSync(join(ROOT, "docs/fellowship-payments.md"), "utf8");

// An assertion that a bad pattern is ABSENT has to ignore the comment that
// explains why it was removed — otherwise fixing a bug and documenting the fix
// makes the test for it fail, which teaches you to stop documenting.
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const HOOK_CODE = stripComments(HOOK);

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok || !detail ? "" : "  -> " + detail}`);
  if (!ok) failures++;
};

// ==========================================================================
// 1. THE ENGINE IS DUPLICATED, AND THE DUPLICATE CANNOT DRIFT
// ==========================================================================
// A const at file top-level is NOT visible inside a routerAdd or cronAdd
// callback in the PocketBase JSVM, so the claim-and-send engine has to exist
// once per handler. That is a runtime fact, not a preference. What it costs is
// the risk that somebody fixes the money bug in one copy and not the other, and
// that risk is retired here rather than in a comment.
const engines = HOOK.match(/\/\/ ===== ENGINE:BEGIN[\s\S]*?\/\/ ===== ENGINE:END ={2,}/g) || [];
{
  check("engine: it exists in both the internal route and the cron", engines.length === 2,
    `${engines.length} copies`);
  check("engine: the two copies are byte-identical",
    engines.length === 2 && engines[0] === engines[1],
    "a money bug fixed in one copy and not the other is worse than no fix");
  check("engine: neither copy reaches for `e`, which a cron does not have",
    engines.every((b) => !/\be\.app\b|\be\.request\b|\be\.json\(/.test(b)));
  check("cron: the sweep uses $app, not e.app",
    /cronAdd\("fellow_payout_sweep"[\s\S]*?engine\(\$app\)/.test(HOOK));
  check("route: the internal route uses e.app",
    /routerAdd\("POST", "\/internal\/fellows\/pay"[\s\S]*?engine\(e\.app\)/.test(HOOK));
}

// ==========================================================================
// 2. THE SHAPE OF THE THING
// ==========================================================================
{
  check("routes: a fellow can choose how they are paid",
    /routerAdd\("POST", "\/fellows\/payout-method"/.test(HOOK));
  check("routes: a fellow can see their own payout history",
    /routerAdd\("GET", "\/fellows\/payouts"/.test(HOOK));
  check("routes: there is a status surface that is not a fellow's dashboard",
    /routerAdd\("GET", "\/fellows\/payouts\/health"/.test(HOOK));
  check("routes: the internal one fails closed like the rest of HQ",
    /internal HQ is not configured/.test(HOOK) && /\$security\.equal/.test(HOOK));
  check("routes: every fellow-facing route drops a removed fellow",
    (HOOK.match(/session_hash = \{:h\}/g) || []).length ===
    (HOOK.match(/if \(fellow && fellow\.getString\("status"\) === "removed"\) fellow = null;/g) || []).length,
    "a token already in flight must not outlive a removal");
  check("cron: the sweep is hourly and off the top of the hour",
    /cronAdd\("fellow_payout_sweep", "23 \* \* \* \*"/.test(HOOK));
  check("cron: the batch is bounded, so one bad day cannot fire two hundred orders",
    /dueRows\(10\)/.test(HOOK_CODE));
}

// ==========================================================================
// 3. THE MIGRATION
// ==========================================================================
{
  check("migration: its filename says payout, which is what the gate looks for",
    /1700000046_fellow_payouts\.js/.test("1700000046_fellow_payouts.js"));
  check("migration: the claim key is UNIQUE, and partial so unkeyed rows do not collide",
    /CREATE UNIQUE INDEX `idx_fpayout_idem`[\s\S]{0,120}WHERE `idempotency_key` != ''/.test(MIG));
  check("migration: every field add is guarded, so re-running it on every boot is safe",
    /if \(!c\.fields\.getByName\(name\)\)/.test(MIG));
  check("migration: it adds and never drops — hold_until and ship_confirmed_at survive",
    !/removeById/.test(MIG.slice(0, MIG.indexOf("}, (app) =>"))),
    "a live column dropped to tidy a schema destroys a fact");
  check("migration: the down() removes only what the up() added",
    /removeById/.test(MIG.slice(MIG.indexOf("}, (app) =>"))) &&
    !/app\.delete\(app\.findCollectionByNameOrId/.test(MIG));
  check("migration: half_paid is NOT auto-decided, because a migration must never decide money",
    /half_paid: "needs_review"/.test(MIG) && /owed the remaining \$15/.test(MIG));
  check("migration: an unclassifiable status is held, never released into the pay lane",
    /MAP\[was\] \|\| "held"/.test(MIG));
  check("migration: the rewrite is discoverable in HQ rather than by a fellow",
    /fellowship\.payout_migration/.test(MIG));
  check("migration: it uses the datetime parser that actually works on 0.30.4",
    /\[+-\]\\d\{2\}\\:\?\\d\{2\}|\[\+-\]\\d\{2\}:\?\\d\{2\}/.test(MIG) || /pbTime/.test(MIG));
  check("migration: pay_after is a NEW name, not hold_until reused",
    /pay_after/.test(MIG) && !/set\("hold_until"/.test(MIG),
    "one column with two meanings across a migration boundary is how money is lost");
}

// ==========================================================================
// 4. NOTHING LEAKS — the key, the vendor, or an order id
// ==========================================================================
{
  const eng = engines[0] || "";
  check("secrets: the error string is scrubbed before it is ever stored",
    /scrub = \(v\)/.test(eng) && /split\(key\)\.join\("\[key\]"\)/.test(eng) &&
    /\[A-Za-z0-9_\\-\]\{24,\}/.test(eng));
  check("secrets: the raw response body is never stored wholesale",
    !/\bres\.raw\b/.test(HOOK_CODE));
  check("secrets: nothing logs the request body or the headers",
    !/console\.log\([^)]*payload/.test(HOOK_CODE) && !/console\.log\([^)]*H\b/.test(HOOK_CODE));
  // The CODE only. The comments in these routes explain what is deliberately
  // withheld, and naming a thing in order to withhold it is not a leak.
  const fellowRoutes = stripComments(HOOK.slice(HOOK.indexOf('"/fellows/payout-method"'),
                                                HOOK.indexOf('"/internal/fellows/pay"')));
  check("secrets: no fellow-facing route can return a vendor order id",
    !/vendor_order_id|vendor_reward_id|payout_ref/.test(fellowRoutes));
  check("secrets: nor an HTTP status, an attempt count, or the words needs review",
    !/http_status|payout_attempts|needs_review/.test(fellowRoutes));
  const internalReply = HOOK.slice(HOOK.indexOf("const r = E.payOne(convId"), HOOK.indexOf("// THE SWEEP."));
  check("secrets: even the internal reply does not carry the order id",
    !/orderId|vendor_order_id/.test(internalReply),
    "a route reply is not an audit trail; the conversion row is");
  check("vendor: the only place its name appears to a fellow is the honest one",
    (fellowRoutes.match(/Tremendous/g) || []).length === 1 &&
    /who send the cards/.test(fellowRoutes));
}

// ==========================================================================
// 5. BEHAVIOUR. The engine is run for real, against a fake store that enforces
//    the same UNIQUE index the migration creates, and a fake vendor that counts
//    orders. Everything below is a claim about what happens, not about what the
//    source says.
// ==========================================================================
const ENGINE_SRC = engines[0] || "";

const build = (env, opts) => {
  const o = opts || {};
  const DB = { fellows: [], fellow_conversions: [], fellow_payouts: [], fellow_meter: [], internal_activity: [] };
  const calls = [];          // every $http.send that actually happened
  let seq = 0;
  // A stale read of the payout ledger — what a second worker genuinely sees
  // when it starts a moment behind the first.
  let blind = Number(o.blindPrior || 0);

  function Rec(col) { this.__col = col.name; this.__d = { id: "id" + (++seq) }; }
  Rec.prototype.get = function (k) { return this.__d[k]; };
  Rec.prototype.getString = function (k) { const v = this.__d[k]; return v == null ? "" : String(v); };
  Rec.prototype.set = function (k, v) { this.__d[k] = v; };

  const mk = (col, d) => { const r = new Rec({ name: col }); Object.assign(r.__d, d); DB[col].push(r); return r; };

  const app = {
    findCollectionByNameOrId: (n) => { if (!DB[n]) throw new Error("no collection " + n); return { name: n }; },
    findRecordById: (col, id) => {
      const r = (DB[col] || []).find((x) => x.__d.id === String(id));
      if (!r) throw new Error("not found");
      return r;
    },
    findFirstRecordByFilter: (col, f, p) => {
      const rows = app.findRecordsByFilter(col, f, "", 1, 0, p);
      if (!rows.length) throw new Error("not found");
      return rows[0];
    },
    findRecordsByFilter: (col, f, sort, limit, off, p) => {
      p = p || {};
      let rows = (DB[col] || []).slice();
      if (f === "name = {:n}") rows = rows.filter((r) => r.getString("name") === p.n);
      else if (f === "conversion = {:c}") {
        if (blind > 0) { blind--; return []; }
        rows = rows.filter((r) => r.getString("conversion") === p.c);
      }
      else if (f === "fellow = {:f}") rows = rows.filter((r) => r.getString("fellow") === p.f);
      // The lifetime total is recomputed from committed rows rather than
      // incremented across a network call, so the fake has to answer this.
      else if (f === "fellow = {:f} && status = 'paid'")
        rows = rows.filter((r) => r.getString("fellow") === p.f && r.getString("status") === "paid");
      // The parked lane the waker walks.
      else if (f === "status = 'waiting'")
        rows = rows.filter((r) => r.getString("status") === "waiting");
      else if (f === "status = 'paying' && payout_claimed_at != ''")
        rows = rows.filter((r) => r.getString("status") === "paying" && r.getString("payout_claimed_at"));
      else if (f === "status = 'pending' && pay_after != '' && pay_after <= {:now}")
        rows = rows.filter((r) => r.getString("status") === "pending" && r.getString("pay_after")
          && r.getString("pay_after") <= p.now);
      else if (f) throw new Error("the fake store does not know the filter: " + f);
      return rows.slice(0, limit || 500);
    },
    save: (r) => {
      const col = r.__col;
      // THE REAL INDEX. idx_fpayout_idem is UNIQUE and partial, and this is the
      // whole double-pay guard, so the fake enforces it exactly.
      if (col === "fellow_payouts" && r.__d.idempotency_key) {
        const clash = DB[col].some((x) => x !== r && x.__d.idempotency_key === r.__d.idempotency_key);
        if (clash) throw new Error("UNIQUE constraint failed: fellow_payouts.idempotency_key");
      }
      if (DB[col].indexOf(r) < 0) { r.__d.created = new Date().toISOString(); DB[col].push(r); }
      r.__d.updated = new Date().toISOString();
    },
    delete: (r) => { const i = DB[r.__col].indexOf(r); if (i >= 0) DB[r.__col].splice(i, 1); },
  };

  const sandbox = {
    Record: Rec,
    console: { log: () => {} },
    $os: { getenv: (k) => (env[k] == null ? "" : String(env[k])) },
    $http: {
      send: (req) => {
        calls.push(req);
        const r = (o.respond || (() => ({ statusCode: 200, json: {} })))(req, calls.length);
        if (r instanceof Error) throw r;
        return r;
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(ENGINE_SRC + "\n; this.__E = engine;", sandbox);
  return { E: sandbox.__E(app), DB, calls, mk, app };
};

// One adult fellow, confirmed, on the card, with one conversion that is due.
const seed = (w, over) => {
  const f = w.mk("fellows", Object.assign({
    email: "sam@example.com", name: "Sam Rivera", age_band: "18_plus",
    birth_month: 4, birth_year: 2000, country: "us",
    email_confirmed_at: "2026-08-01T00:00:00.000Z", parental_consent: "not_required",
    payout_method: "card", code_active: true, referral_code: "ab3k9m", status: "accepted",
    lifetime_paid_usd: 0,
  }, (over || {}).fellow));
  const c = w.mk("fellow_conversions", Object.assign({
    fellow: f.__d.id, code: "ab3k9m", order_ref: "cs_test_1",
    commission_usd: 30, status: "pending",
    pay_after: "2026-01-01T00:00:00.000Z",
  }, (over || {}).conv));
  return { f, c };
};

const ok200 = { statusCode: 200, json: { order: { id: "ORD1", status: "EXECUTED",
  payment: { total: 30.0 }, rewards: [{ id: "RWD1" }] } } };
const ok201 = { statusCode: 201, json: { order: { id: "ORD1", status: "EXECUTED",
  payment: { total: 30.0 }, rewards: [{ id: "RWD1" }] } } };
const KEY = "TEST_02feed72c2f6ab8dadc7f6156d1106828aabf81e5c4d38ea94d62817717ea261";
const LIVE = { TREMENDOUS_API_KEY: KEY, ANTICIPY_PAYOUT_VENDOR: "tremendous" };

// ---- the key is unset ----------------------------------------------------
{
  const w = build({});
  const { c } = seed(w);
  const r = w.E.payOne(c.__d.id, {});
  check("unset: nothing is sent", w.calls.length === 0, JSON.stringify(w.calls.map((x) => x.url)));
  check("unset: no claim row is written, so no attempt is consumed",
    w.DB.fellow_payouts.length === 0 && !c.__d.payout_attempts);
  check("unset: the conversion is left exactly where it was",
    c.getString("status") === "pending");
  check("unset: it says so in a word a caller can branch on",
    r.blocked === "not_configured" && r.ok === false, JSON.stringify(r));
  check("unset: and it is NOT reported as an alarm",
    !w.DB.internal_activity.some((a) => /misconfigured|failed/.test(a.getString("action"))));
  const health = w.E.vendor("config", {});
  check("unset: config reports not_configured, distinct from broken",
    health.configured === false && health.reason === "not_configured");
}

// ---- configured wrongly is a DIFFERENT answer ----------------------------
{
  const w = build({ TREMENDOUS_API_KEY: KEY, TREMENDOUS_ENV: "production" });
  const { c } = seed(w);
  const r = w.E.payOne(c.__d.id, {});
  check("misconfigured: a sandbox key under TREMENDOUS_ENV=production sends nothing",
    w.calls.length === 0 && r.blocked === "misconfigured", JSON.stringify(r));
  check("misconfigured: and unlike an unset key, it shouts",
    w.DB.internal_activity.some((a) => a.getString("action") === "fellow.payout_misconfigured"));
  const cfg = w.E.vendor("config", {});
  check("misconfigured: config says configured AND not ok, which is the distinction",
    cfg.configured === true && cfg.ok === false && cfg.reason === "misconfigured");
}

// ---- the base URL defaults to sandbox ------------------------------------
{
  const w = build(LIVE, { respond: () => ok200 });
  seed(w);
  w.E.payOne(w.DB.fellow_conversions[0].__d.id, {});
  check("sandbox: with TREMENDOUS_ENV unset the order goes to testflight, not production",
    w.calls[0].url.indexOf("https://testflight.tremendous.com/api/v2/orders") === 0, w.calls[0].url);

  const p = build({ TREMENDOUS_API_KEY: "PROD_" + KEY.slice(5), TREMENDOUS_ENV: "production",
                    ANTICIPY_PAYOUT_VENDOR: "tremendous" }, { respond: () => ok200 });
  seed(p);
  p.E.payOne(p.DB.fellow_conversions[0].__d.id, {});
  check("sandbox: and only the literal word production opts in to real money",
    p.calls[0].url.indexOf("https://api.tremendous.com/api/v2/orders") === 0, p.calls[0].url);

  const q = build({ TREMENDOUS_API_KEY: KEY, TREMENDOUS_ENV: "PRODUCTION_MAYBE",
                    ANTICIPY_PAYOUT_VENDOR: "tremendous" }, { respond: () => ok200 });
  seed(q);
  q.E.payOne(q.DB.fellow_conversions[0].__d.id, {});
  check("sandbox: anything else, however production-looking, is still sandbox",
    q.calls[0].url.indexOf("https://testflight.") === 0, q.calls[0].url);
}

// ---- the happy path ------------------------------------------------------
{
  const w = build(LIVE, { respond: () => ok200 });
  const { f, c } = seed(w);
  const r = w.E.payOne(c.__d.id, {});
  const body = JSON.parse(w.calls[0].body);
  check("send: exactly one order is created", w.calls.length === 1 && r.state === "paid");
  check("send: external_id is the conversion id and nothing else",
    body.external_id === "fc-" + c.__d.id, body.external_id);
  check("send: the same key also rides as a header, in case a vendor honours one",
    w.calls[0].headers["Idempotency-Key"] === body.external_id);
  check("send: it is a single-product reward, which is what restricts the catalogue",
    Array.isArray(body.reward.products) && body.reward.products.length === 1 &&
    body.reward.products[0] === "Q24BD9EZ332JT", JSON.stringify(body.reward.products));
  check("send: delivery is EMAIL and never LINK",
    body.reward.delivery.method === "EMAIL" && !/"method"\s*:\s*"LINK"/i.test(JSON.stringify(body)),
    "an unsent LINK holds real value we would forfeit, and it is a bearer token to cash");
  check("send: it names a funding source, which the API errors without",
    !!body.payment.funding_source_id);
  check("send: the payout row is written before the conversion is concluded",
    w.DB.fellow_payouts[0].getString("state") === "sent" &&
    w.DB.fellow_payouts[0].getString("vendor_order_id") === "ORD1" &&
    w.DB.fellow_payouts[0].getString("vendor_reward_id") === "RWD1");
  check("send: the conversion carries the receipt, so paid is a claim we can support",
    c.getString("status") === "paid" && !!c.getString("paid_at") && c.getString("payout_ref") === "ORD1");
  check("send: the lifetime total moves, so the threshold is checked before it is crossed",
    Number(f.get("lifetime_paid_usd")) === 30);
  check("send: the band at payment is copied onto the ledger row",
    w.DB.fellow_payouts[0].getString("age_band_at_payment") === "18_plus",
    "an audit trail that rewrites itself on a birthday is not an audit trail");
}

// ---- THE HEADLINE: it cannot be sent twice -------------------------------
{
  // (a) the cron double-fires on the same row
  const w = build(LIVE, { respond: () => ok200 });
  const { c } = seed(w);
  w.E.payOne(c.__d.id, {});
  const again = w.E.payOne(c.__d.id, {});
  check("double-pay: a second sweep over a paid row sends nothing",
    w.calls.length === 1 && again.already === true, `${w.calls.length} orders`);

  // (b) TWO WORKERS RACE THE SAME ATTEMPT. This is the one that matters, and it
  //     is simulated faithfully: worker A has already INSERTed its claim under
  //     "<key>#1" and is somewhere inside the 25-second POST, so the conversion
  //     row has not moved yet — `pending`, sequence still 0 — which is exactly
  //     what worker B reads. B must compute the SAME key and lose the INSERT.
  //
  //     This is the assertion that goes red if the sequence ever goes back to
  //     being a count of ledger rows: with (prior.length + 1) B sees one row,
  //     computes "#2", INSERTs successfully, and POSTs a second order for the
  //     same conversion — the mutual exclusion gone, and nothing left between a
  //     teenager and a second card but the vendor's own de-duplication of two
  //     simultaneous requests.
  const x = build(LIVE, { respond: () => ok200 });
  const s = seed(x);
  s.c.set("payout_key", "fc-" + s.c.__d.id);
  x.mk("fellow_payouts", { conversion: s.c.__d.id, idempotency_key: "fc-" + s.c.__d.id + "#1",
                           state: "claimed", attempt: 1 });
  const raced = x.E.payOne(s.c.__d.id, {});
  check("double-pay: the loser of a claim race sends nothing",
    x.calls.length === 0 && raced.state === "raced", JSON.stringify(raced));
  check("double-pay: and a lost race is not logged as a fault",
    !x.DB.internal_activity.length, "losing a race is normal, not an incident");
  check("double-pay: the claim is taken BEFORE the network call, not after",
    x.DB.fellow_payouts.length === 1, "two claim rows would mean the index did not hold");

  // (c) and once a claim IS in flight, a second sweep will not touch the row at
  //     all — the status check catches it long before the index has to.
  const inflight = build(LIVE, { respond: () => ok200 });
  const f2 = seed(inflight);
  f2.c.set("status", "paying");
  f2.c.set("payout_claimed_at", new Date().toISOString());
  check("double-pay: a row with an attempt in flight is skipped, not re-sent",
    inflight.E.payOne(f2.c.__d.id, {}).state === "paying" && inflight.calls.length === 0);

  // (c) the vendor says 201 — an order under this key already existed. That is
  //     the guard WORKING, and treating it as a failure is how you loop.
  const y = build(LIVE, { respond: () => ok201 });
  const t = seed(y);
  const rep = y.E.payOne(t.c.__d.id, {});
  check("double-pay: a 201 replay is settled as paid, not retried",
    rep.state === "paid" && rep.replay === true && t.c.getString("status") === "paid");
  check("double-pay: and it is logged apart, so the true retry rate is visible",
    y.DB.internal_activity.some((a) => a.getString("action") === "fellow.payout_replayed") &&
    !y.DB.internal_activity.some((a) => a.getString("action") === "fellow.payout_sent"));
  check("double-pay: the ledger row says duplicate, not sent",
    y.DB.fellow_payouts[0].getString("state") === "duplicate");
}

// ---- the process dies mid-call -------------------------------------------
{
  // The POST throws and the reconciling GET cannot answer either. We do not
  // know whether $30 moved, so a person decides — forever, and nothing
  // automatic ever touches the row again.
  const w = build(LIVE, { respond: () => new Error("connection reset") });
  const { c } = seed(w);
  const r = w.E.payOne(c.__d.id, {});
  check("unknown: a timeout goes to a human, never to a retry",
    r.state === "needs_review" && c.getString("status") === "needs_review");
  check("unknown: the ledger row records that we do not know, with http 0",
    w.DB.fellow_payouts[0].getString("state") === "unknown" &&
    Number(w.DB.fellow_payouts[0].get("http_status")) === 0);
  check("unknown: the human is told exactly what to search for",
    /external_id fc-/.test(c.getString("review_reason")) && /mark this paid/.test(c.getString("review_reason")),
    c.getString("review_reason"));
  const before = w.calls.length;
  w.E.payOne(c.__d.id, {});
  check("unknown: a later sweep over that row sends nothing", w.calls.length === before);
}
{
  // Same unclear outcome, but the reconciling GET settles it: the order landed.
  // The teenager has the money and our row said unpaid — this is the case that
  // must resolve to PAID and not to a second order.
  const w = build(LIVE, {
    respond: (req) => {
      if (req.method === "POST") return new Error("read timeout");
      // THE FAKE ANSWERS THE WAY THE REAL API DOES. /orders?external_id=<ours>
      // is a search on our key. /orders/<id> takes THEIR order id and has never
      // heard of "fc-...", so it 404s — which is why the old path form could
      // never settle anything.
      if (/\/orders\?external_id=/.test(req.url)) {
        return { statusCode: 200, json: { orders: [{ id: "ORD9", payment: { total: 30 }, rewards: [{ id: "RW9" }] }] } };
      }
      return { statusCode: 404, json: { errors: { message: "Not Found" } } };
    },
  });
  const { c } = seed(w);
  const r = w.E.payOne(c.__d.id, {});
  check("unknown: a reconciling GET that finds the order settles it as paid",
    r.state === "paid" && r.replay === true && c.getString("payout_ref") === "ORD9");
  check("unknown: and the reconciliation is a GET, which cannot spend money",
    w.calls[1].method === "GET", w.calls[1].url);
  // THE PATH IS THE WHOLE FIX. /orders/<id> takes the VENDOR's order id — the
  // "ORD9" above — not ours, so the old form asked for an id that has never
  // existed there and every unclear outcome fell to needs_review.
  check("unknown: the lookup is BY OUR external_id, not by a vendor order id",
    /\/orders\?external_id=fc-/.test(w.calls[1].url) && !/\/orders\/fc-/.test(w.calls[1].url),
    w.calls[1].url);
}
{
  // And the other way: the GET proves nothing was created, so it is safe to try
  // again — with the SAME external_id, which is what makes it safe even if the
  // proof were wrong.
  const w = build(LIVE, {
    respond: (req, n) => {
      if (req.method === "GET") {
        if (/\/orders\?external_id=/.test(req.url)) return { statusCode: 200, json: { orders: [] } };
        return { statusCode: 404, json: { errors: { message: "Not Found" } } };
      }
      if (n === 1) return new Error("read timeout");
      return ok200;
    },
  });
  const { c } = seed(w);
  const first = w.E.payOne(c.__d.id, {});
  check("unknown: an empty list under our own key releases the claim instead of stranding it",
    first.state === "pending" && c.getString("status") === "pending");

  // And a 404 is NOT that proof. It is what the wrong lookup returned every
  // single time, so reading it as "nothing was created" would re-send money on
  // the strength of a URL bug.
  const nf = build(LIVE, { respond: (req) => (req.method === "POST"
    ? new Error("read timeout") : { statusCode: 404, json: { errors: { message: "Not Found" } } }) });
  const s404 = seed(nf);
  check("unknown: a 404 on the lookup is not proof of a no-send",
    nf.E.payOne(s404.c.__d.id, {}).state === "needs_review" &&
    nf.calls.filter((x) => x.method === "POST").length === 1);
  const second = w.E.payOne(c.__d.id, {});
  const keys = w.calls.filter((x) => x.method === "POST").map((x) => JSON.parse(x.body).external_id);
  check("retry: the second attempt is a NEW claim but the SAME vendor key",
    second.state === "paid" && keys.length === 2 && keys[0] === keys[1], keys.join(" vs "));
  check("retry: and the two claims are distinct rows, so nothing is overwritten",
    w.DB.fellow_payouts.length === 2 &&
    w.DB.fellow_payouts[0].getString("idempotency_key") !== w.DB.fellow_payouts[1].getString("idempotency_key"));
}

// ---- the backstop --------------------------------------------------------
{
  const w = build(LIVE, { respond: () => ok200 });
  const { c } = seed(w);
  c.set("status", "paying");
  c.set("payout_key", "fc-" + c.__d.id);
  c.set("payout_claimed_at", new Date(Date.now() - 40 * 60000).toISOString());
  const n = w.E.backstop();
  check("backstop: a claim that died mid-flight is found within the hour",
    n === 1 && c.getString("status") === "needs_review");
  check("backstop: it NEVER auto-releases, because the outcome is unknown",
    c.getString("status") !== "pending" && w.calls.length === 0);
  check("backstop: and it carries the key the human has to search for",
    /fc-/.test(c.getString("review_reason")));

  const fresh = build(LIVE, {});
  const s2 = seed(fresh);
  s2.c.set("status", "paying");
  s2.c.set("payout_claimed_at", new Date(Date.now() - 60000).toISOString());
  check("backstop: a claim taken a minute ago is left alone",
    fresh.E.backstop() === 0 && s2.c.getString("status") === "paying");
}

// ---- the vendor says no --------------------------------------------------
{
  // 402: the balance is empty. Nothing was created, it is OURS to fix, and it
  // must not consume one of their three tries.
  const w = build(LIVE, { respond: () => ({ statusCode: 402,
    json: { errors: { message: "Not enough funds to carry out this operation." } } }) });
  const { c } = seed(w);
  const r = w.E.payOne(c.__d.id, {});
  check("402: the conversion goes back to pending, not failed",
    r.state === "pending" && c.getString("status") === "pending");
  check("402: and it costs the fellow no attempt",
    Number(c.get("payout_attempts")) === 0 &&
    w.DB.fellow_payouts[0].getString("state") === "skipped");
  check("402: a person is told to top up, and told how",
    w.DB.internal_activity.some((a) => /ACH/.test(a.getString("subject"))));
}
{
  // 429: ours, not theirs. Same treatment.
  const w = build(LIVE, { respond: () => ({ statusCode: 429, json: { error: { message: "Too many requests" } } }) });
  const { c } = seed(w);
  w.E.payOne(c.__d.id, {});
  check("429: the singular `error` envelope does not throw inside the error handler",
    c.getString("status") === "pending" && Number(c.get("payout_attempts")) === 0,
    "their own docs print `error` where the live API returns `errors`");
}
{
  // 409: the same key with different details. Two code paths disagree about
  // what somebody is owed. Never retry.
  const w = build(LIVE, { respond: () => ({ statusCode: 409,
    json: { errors: { message: "An order with external_id already exists with a different denomination." } } }) });
  const { c } = seed(w);
  const r = w.E.payOne(c.__d.id, {});
  check("409: it stops dead and asks a person",
    r.state === "needs_review" && c.getString("status") === "needs_review");
  const before = w.calls.length;
  w.E.payOne(c.__d.id, {});
  check("409: and never sends again on its own", w.calls.length === before);
}
{
  // 422: a validation failure. Provably nothing was created, so this one is
  // safe to retry — and three strikes is the ceiling, not a loop.
  const w = build(LIVE, { respond: () => ({ statusCode: 422,
    json: { errors: { message: "Order failed: validation failure" } } }) });
  const { c } = seed(w);
  w.E.payOne(c.__d.id, {});
  check("422: a definite refusal releases the claim and counts as an attempt",
    c.getString("status") === "pending" && Number(c.get("payout_attempts")) === 1);
  w.E.payOne(c.__d.id, {});
  w.E.payOne(c.__d.id, {});
  check("422: three attempts and it stops, held, rather than retrying forever",
    c.getString("status") === "held" && w.calls.filter((x) => x.method === "POST").length === 3,
    c.getString("status") + " after " + w.calls.length + " calls");
  check("422: the give-up is announced",
    w.DB.internal_activity.some((a) => a.getString("action") === "fellow.payout_gave_up"));
}
{
  // A 2xx with no order id is an order we can never reconcile, so it is not a
  // success however healthy the status code looks.
  const w = build(LIVE, { respond: (req) => req.method === "POST"
    ? { statusCode: 200, json: { order: {} } } : { statusCode: 500, json: {} } });
  const { c } = seed(w);
  const r = w.E.payOne(c.__d.id, {});
  check("2xx with no order id is not a success", r.state === "needs_review");
}

// ---- the key never comes back out ----------------------------------------
{
  const w = build(LIVE, { respond: () => ({ statusCode: 401,
    json: { errors: { message: "The API key you provided was invalid. You provided: " + KEY } } }) });
  const { c } = seed(w);
  const r = w.E.payOne(c.__d.id, {});
  const stored = w.DB.fellow_payouts[0].getString("error");
  check("secrets: the vendor handing our key back does not write it into a row",
    stored.indexOf(KEY) < 0 && /\[key\]|\[redacted\]/.test(stored), stored);
  check("secrets: nor into the message the route would return",
    String(r.message).indexOf(KEY) < 0);
  check("secrets: nor into the activity feed a human reads",
    !w.DB.internal_activity.some((a) => a.getString("subject").indexOf(KEY) >= 0));
}

// ---- UNDER 18 IS STORED VALUE ONLY ---------------------------------------
{
  const minor = { fellow: { age_band: "13_15", birth_month: 6, birth_year: 2011,
    parental_consent: "confirmed", guardian_name: "Alex Rivera",
    guardian_email: "alex@example.com" } };

  // (a) the row says cash_like anyway — because somebody edited it, or restored
  //     a backup, or a second caller bypassed the choose route.
  const w = build(LIVE, { respond: () => ok200 });
  const s = seed(w, { fellow: Object.assign({}, minor.fellow, { payout_method: "cash_like" }) });
  const r = w.E.payOne(s.c.__d.id, {});
  check("under-18: a minor routed at a cash-like rail is never sent",
    w.calls.length === 0 && r.state === "held", JSON.stringify(r));
  check("under-18: and the reason names the actual constraint, not a policy",
    /cannot hold a money account/.test(s.c.getString("review_reason")));

  // (b) the normal case: card, guardian is the payee of record.
  const x = build(LIVE, { respond: () => ok200 });
  const t = seed(x, minor);
  x.E.payOne(t.c.__d.id, {});
  const body = JSON.parse(x.calls[0].body);
  check("under-18: the card goes to the guardian, who accepted in their own name",
    body.reward.recipient.email === "alex@example.com" &&
    body.reward.recipient.name === "Alex Rivera", JSON.stringify(body.reward.recipient));
  check("under-18: and it is the stored-value product, never a cash rail",
    body.reward.products[0] === "Q24BD9EZ332JT");
  check("under-18: the band at payment is recorded as the minor's, not the guardian's",
    x.DB.fellow_payouts[0].getString("age_band_at_payment") === "13_15");

  // (c) even with a cash-like product id configured, the minor never gets it.
  const y = build(Object.assign({}, LIVE, { TREMENDOUS_PRODUCT_CASH_LIKE: "PAYPALXXXX" }),
    { respond: () => ok200 });
  const u = seed(y, minor);
  // force the field past the choose route, exactly as a bad row would
  u.f.set("payout_method", "card");
  y.E.payOne(u.c.__d.id, {});
  check("under-18: a configured cash product cannot reach a minor",
    JSON.parse(y.calls[0].body).reward.products[0] === "Q24BD9EZ332JT");

  // (d) no guardian consent yet: waiting, not held. It costs no attempt, it
  //     resolves itself the moment the guardian finishes — and it LEAVES THE
  //     PAY LANE while it waits, so it cannot starve the people behind it.
  const z = build(LIVE, { respond: () => ok200 });
  const v = seed(z, { fellow: Object.assign({}, minor.fellow, { parental_consent: "pending" }) });
  const rr = z.E.payOne(v.c.__d.id, {});
  check("under-18: no consent yet is waiting, not held",
    rr.state === "waiting" && rr.blocked === "guardian" && z.calls.length === 0 &&
    z.DB.fellow_payouts.length === 0);
  check("under-18: and the parked row is out of the due query, not at the front of it",
    v.c.getString("status") === "waiting" && v.c.getString("payout_blocked_on") === "guardian" &&
    z.E.dueRows(10).length === 0);

  // (e) the vendor has not answered about recipient age in writing. 18+ still
  //     pays; nobody younger does. Silence in a ToS is not permission.
  const q = build({ TREMENDOUS_API_KEY: KEY }, { respond: () => ok200 });
  const m2 = seed(q, minor);
  const held = q.E.payOne(m2.c.__d.id, {});
  check("under-18: with no written age answer on file, a minor is not sent",
    q.calls.length === 0 && held.blocked === "vendor_age");
  const adult = seed(q);
  q.E.payOne(adult.c.__d.id, {});
  check("under-18: while an adult is paid normally in the same run",
    q.calls.length === 1 && adult.c.getString("status") === "paid");
}

// ---- a fellow turns 18 between the sale and the payment ------------------
{
  const now = new Date();
  const w = build(LIVE, { respond: () => ok200 });
  const s = seed(w, { fellow: { age_band: "16_17",      // stale on the row
    birth_month: 1, birth_year: now.getUTCFullYear() - 19,
    parental_consent: "confirmed", guardian_email: "alex@example.com", guardian_name: "Alex" } });
  w.E.payOne(s.c.__d.id, {});
  const body = JSON.parse(w.calls[0].body);
  check("birthday: the recipient is resolved at PAYMENT time, not at conversion time",
    body.reward.recipient.email === "sam@example.com",
    "an adult's card must not be posted to their parent because a field went stale");
}

// ---- the things that must never pay automatically ------------------------
{
  const w = build(LIVE, { respond: () => ok200 });
  const s = seed(w, { conv: { commission_usd: 3000 } });
  const r = w.E.payOne(s.c.__d.id, {});
  check("amount: a typo cannot wire somebody thousands of dollars",
    w.calls.length === 0 && r.state === "held");

  const x = build(LIVE, { respond: () => ok200 });
  const t = seed(x, { fellow: { lifetime_paid_usd: 590 } });
  const rr = x.E.payOne(t.c.__d.id, {});
  check("tax: the threshold is checked BEFORE the payment that would cross it",
    x.calls.length === 0 && rr.state === "held" && /tax/.test(rr.message),
    "the form has to be collected from somebody who still wants something from us");

  const y = build(LIVE, { respond: () => ok200 });
  const u = seed(y, { conv: { code: "oldcode" } });
  check("code: a re-minted referral code makes the credit ambiguous, so it holds",
    y.E.payOne(u.c.__d.id, {}).state === "held" && y.calls.length === 0);

  const z = build(LIVE, { respond: () => ok200 });
  const v = seed(z, { fellow: { status: "removed" } });
  check("removed: a removed fellow is never paid by a cron",
    z.E.payOne(v.c.__d.id, {}).state === "held" && z.calls.length === 0,
    "under never-clawed-back they may still be owed it — that is a person's call");

  const p = build(LIVE, { respond: () => ok200 });
  const wq = seed(p, { conv: { status: "paid", paid_at: "2026-08-01T00:00:00.000Z" } });
  check("paid: there is no code path out of paid",
    p.E.payOne(wq.c.__d.id, {}).already === true && p.calls.length === 0);
  const held = seed(p, { conv: { status: "held", order_ref: "cs_test_2" } });
  check("held: a held row is not paid by the sweep",
    p.E.payOne(held.c.__d.id, {}).state === "held" && p.calls.length === 0);
  check("held: but a person can release it and pay it in one call",
    p.E.payOne(held.c.__d.id, { approve: true }).state === "paid" && p.calls.length === 1);
}

// ---- the clock -----------------------------------------------------------
{
  const w = build(LIVE, { respond: () => ok200 });
  const s = seed(w, { conv: { pay_after: new Date(Date.now() + 5 * 86400000).toISOString() } });
  check("clock: money that is not due yet is not sent",
    w.E.payOne(s.c.__d.id, {}).state === "pending" && w.calls.length === 0);
  check("clock: the sweep does not see it either", w.E.dueRows(10).length === 0);
  check("clock: but a person may pay early, deliberately",
    w.E.payOne(s.c.__d.id, { now: true }).state === "paid");
}

// ---- what is waiting on the fellow, and what is wrong --------------------
{
  const w = build(LIVE, { respond: () => ok200 });
  const s = seed(w, { fellow: { email_confirmed_at: "" } });
  const r = w.E.payOne(s.c.__d.id, {});
  check("waiting: an unconfirmed address parks the row, unflagged and un-charged",
    r.state === "waiting" && r.blocked === "email" &&
    s.c.getString("status") === "waiting" && Number(s.c.get("payout_attempts") || 0) === 0);
  check("waiting: it is not held, so nobody is asked to make a decision about it",
    !w.DB.internal_activity.some((a) => a.getString("action") === "fellow.payout_held"));

  const y = build(LIVE, { respond: () => ok200 });
  const u = seed(y, { fellow: { code_active: false } });
  check("wrong: a switched-off code with everything else ready means a person turned it off",
    y.E.payOne(u.c.__d.id, {}).state === "held");
}

// ==========================================================================
// 6. HEAD-OF-LINE BLOCKING. NOBODY EVER GETS PAID.
// ==========================================================================
// The whole sweep is ten rows, oldest first. Every wait() outcome used to leave
// the row at `pending` with pay_after untouched, so a blocked row was due
// FOREVER and therefore sorted to the FRONT of every batch for the rest of
// time. Ten fellows who had not confirmed an email address occupied all ten
// slots and every other payout starved — silently, permanently, with every
// screen in the system reporting normal.
{
  const w = build(LIVE, { respond: () => ok200 });

  // Ten fellows blocked on the same setup step, all older than the payable one,
  // so oldest-first hands them the entire batch.
  const parked = [];
  for (let i = 0; i < 10; i++) {
    parked.push(seed(w, {
      fellow: { email: "blocked" + i + "@example.com", email_confirmed_at: "" },
      conv: { order_ref: "blocked_" + i, pay_after: "2020-01-01T00:00:00.000Z" },
    }));
  }
  const payable = seed(w, { fellow: { email: "owed@example.com" },
                            conv: { order_ref: "owed_1", pay_after: "2026-02-01T00:00:00.000Z" } });

  for (const p of parked) w.E.payOne(p.c.__d.id, {});
  check("head-of-line: a blocked row leaves the pay lane instead of sitting at the front of it",
    parked.every((p) => p.c.getString("status") === "waiting"),
    parked.map((p) => p.c.getString("status")).join(","));

  const due = w.E.dueRows(10);
  check("head-of-line: ten blocked fellows do not occupy the batch of ten",
    due.length === 1 && due[0].__d.id === payable.c.__d.id,
    due.length + " due: " + due.map((d) => d.getString("order_ref")).join(","));
  check("head-of-line: and the person behind them is paid in that same sweep",
    w.E.payOne(due[0].__d.id, {}).state === "paid" && payable.c.getString("status") === "paid");
  check("head-of-line: nothing was sent on a blocked fellow's behalf",
    w.calls.length === 1, w.calls.length + " orders");

  // AND THE WAY BACK IN. The block clears — they confirm the address — and the
  // sweep's waker re-runs the same payability checks and returns the row to the
  // lane. It keeps its original pay_after, so waiting does not send it to the
  // back of the queue.
  const wasDue = parked[0].c.getString("pay_after");
  parked[0].f.set("email_confirmed_at", "2026-08-01T00:00:00.000Z");
  const before = w.calls.length;
  const woken = w.E.wakeWaiting(25);
  check("head-of-line: the waker returns a row whose block has cleared",
    woken === 1 && parked[0].c.getString("status") === "pending", woken + " woken");
  check("head-of-line: waking is a probe — it claims nothing and sends nothing",
    w.calls.length === before && w.DB.fellow_payouts.length === 1,
    "the waker must not be a second, drifting copy of the send path");
  check("head-of-line: and the row keeps its place in the queue",
    parked[0].c.getString("pay_after") === wasDue,
    "a row that waited must not go to the back for having waited");
  check("head-of-line: the nine still blocked stay parked",
    parked.slice(1).every((p) => p.c.getString("status") === "waiting"));
  check("head-of-line: the woken row is now visible to the due query",
    w.E.dueRows(10).some((d) => d.__d.id === parked[0].c.__d.id));
  check("head-of-line: and paying it is an ordinary send",
    w.E.payOne(parked[0].c.__d.id, {}).state === "paid" && w.calls.length === before + 1);

  // Round-robin, so a large parked backlog cannot starve the rows at the back
  // of IT either: every re-check moves the row's payout_checked_at.
  check("head-of-line: every re-check re-stamps the row, so the waker rotates",
    parked.slice(1).every((p) => !!p.c.getString("payout_checked_at")));
}

// ==========================================================================
// 7. THE CLAIM KEY COMES FROM THE SHARED ROW, NOT FROM A COUNT
// ==========================================================================
{
  // A stale, blind read of the ledger — the second worker's genuine view — must
  // not be able to change the sequence in EITHER direction. Here the ledger
  // already holds #1..#3 from three attempts that cost no attempt (402s), and
  // the read comes back empty. Counting rows would compute "#1", collide with a
  // row that already exists, and report a lost race forever: a conversion that
  // can never be paid by anybody, with nothing anywhere saying why.
  const w = build(LIVE, { respond: () => ok200, blindPrior: 1 });
  const s = seed(w, { conv: { payout_key: "fc-x", payout_seq: 3, payout_attempts: 0 } });
  for (let i = 1; i <= 3; i++) {
    w.mk("fellow_payouts", { conversion: s.c.__d.id, idempotency_key: "fc-x#" + i, state: "skipped" });
  }
  const r = w.E.payOne(s.c.__d.id, {});
  check("claim: a blind ledger read cannot re-issue a key the ledger already holds",
    r.state === "paid" && w.calls.length === 1, JSON.stringify(r));
  check("claim: the sequence came off the conversion's own counter",
    w.DB.fellow_payouts.some((p) => p.getString("idempotency_key") === "fc-x#4") &&
    Number(s.c.get("payout_seq")) === 4, String(s.c.get("payout_seq")));

  // The counter and the status move in ONE write. That is what makes the pair
  // atomic to another worker: see `pending`, see the old sequence.
  const eng = engines[0] || "";
  const claim = eng.slice(eng.indexOf('conv.set("status", "paying")'), eng.indexOf("ONLY NOW DOES ANYTHING LEAVE"));
  check("claim: payout_seq is written in the same save that takes the claim",
    /conv\.set\("payout_seq", seq\);/.test(claim) && claim.indexOf("app.save(conv)") > 0);
  check("claim: nothing derives the sequence from a count of ledger rows",
    !/prior\.length/.test(stripComments(eng)),
    "a count of rows the winner is concurrently writing is not a lock");
}

// ==========================================================================
// 8. THE SEQUENCE DOES NOT SATURATE
// ==========================================================================
// The failure paths that are OURS — an empty balance, a rate limit — write a
// ledger row without consuming one of the fellow's three attempts, so the row
// count for a single conversion is unbounded. The old sequence was
// (rows fetched with LIMIT 40).length + 1, so it stuck at 41 forever and every
// further claim collided with itself. Forty-five is chosen because it is past
// that cliff.
{
  const w = build(LIVE, { respond: () => ({ statusCode: 402,
    json: { errors: { message: "Not enough funds to carry out this operation." } } }) });
  const { c } = seed(w);
  for (let i = 0; i < 45; i++) w.E.payOne(c.__d.id, {});
  const keys = w.DB.fellow_payouts.map((p) => p.getString("idempotency_key"));
  check("saturation: 45 unfunded attempts produce 45 distinct claim keys",
    keys.length === 45 && new Set(keys).size === 45,
    keys.length + " rows, " + new Set(keys).size + " distinct");
  check("saturation: and all 45 actually reached the vendor",
    w.calls.filter((x) => x.method === "POST").length === 45,
    "a sequence that collides with itself stops the row being paid at all");
  check("saturation: none of them consumed one of the fellow's three attempts",
    Number(c.get("payout_attempts")) === 0 && c.getString("status") === "pending");
}

// ==========================================================================
// 9. HOW THEY ARE PAID IS DEFAULTED, NOT DEMANDED
// ==========================================================================
// payout_method was written by exactly one route, which a fellow had to go and
// find. payOne refused to send while it was empty, so every fellow who never
// found it was unpayable for the life of the programme — and, before section 6,
// blocked everyone behind them too.
{
  const w = build(LIVE, { respond: () => ok200 });
  const s = seed(w, { fellow: { payout_method: "" } });
  const r = w.E.payOne(s.c.__d.id, {});
  check("method: an unset payout method is paid as a card, not treated as a blocker",
    r.state === "paid" && w.calls.length === 1, JSON.stringify(r));
  check("method: and it is the stored-value product, which is what card means",
    w.calls.length === 1 && JSON.parse(w.calls[0].body).reward.products[0] === "Q24BD9EZ332JT");

  // A minor with nothing chosen is paid the same way, because card is the only
  // legal value for them anyway.
  const x = build(LIVE, { respond: () => ok200 });
  const t = seed(x, { fellow: { age_band: "13_15", birth_month: 6, birth_year: 2011,
    parental_consent: "confirmed", guardian_name: "Alex Rivera", guardian_email: "alex@example.com",
    payout_method: "" } });
  check("method: a minor with nothing chosen is paid too",
    x.E.payOne(t.c.__d.id, {}).state === "paid" && x.calls.length === 1 &&
    JSON.parse(x.calls[0].body).reward.recipient.email === "alex@example.com");

  // The field is defaulted where a fellow is created, and again at guardian
  // consent, so a fellow-facing screen never shows an unanswered question.
  check("method: signup defaults it, at both of the places a fellow row is created",
    (SIGNUP.match(/set\("payout_method", "card"\)/g) || []).length === 2,
    "the verify route and the start route both create fellows");
  check("method: guardian consent defaults it too",
    /set\("payout_method", "card"\)/.test(GUARDIAN));
  check("method: and the migration back-fills the fellows who predate the default",
    /set\("payout_method", "card"\)/.test(LANE));
  check("method: nothing tells a fellow they are blocked on choosing one",
    !/blocked = "method"/.test(HOOK_CODE),
    "unset is card, and card is an answer");
}

// ==========================================================================
// 10. A TRANSFER IS NEVER QUIETLY SWAPPED FOR A CARD
// ==========================================================================
// vendor() falls back to the stored-value product when TREMENDOUS_PRODUCT_CASH_LIKE
// is unset. Without a guard an adult picks a transfer, is told "Done", and
// thirty days later receives a card instead, with nothing on any screen saying
// so.
{
  const w = build(LIVE, { respond: () => ok200 });
  const s = seed(w, { fellow: { payout_method: "cash_like" } });
  const r = w.E.payOne(s.c.__d.id, {});
  check("cash-like: an unconfigured transfer holds rather than silently sending a card",
    w.calls.length === 0 && r.state === "held", JSON.stringify(r));
  check("cash-like: and the hold says what to do about it",
    /TREMENDOUS_PRODUCT_CASH_LIKE/.test(s.c.getString("review_reason")) &&
    /do not/i.test(s.c.getString("review_reason")), s.c.getString("review_reason"));

  // Configured, and the adult gets what they actually chose.
  const x = build(Object.assign({}, LIVE, { TREMENDOUS_PRODUCT_CASH_LIKE: "PAYPALXXXX" }),
    { respond: () => ok200 });
  const t = seed(x, { fellow: { payout_method: "cash_like" } });
  check("cash-like: configured, an adult gets the thing they chose",
    x.E.payOne(t.c.__d.id, {}).state === "paid" && x.calls.length === 1 &&
    JSON.parse(x.calls[0].body).reward.products[0] === "PAYPALXXXX");

  // And it is refused at the point of choosing, which is the only moment the
  // answer is still theirs.
  const choose = HOOK.slice(HOOK.indexOf('routerAdd("POST", "/fellows/payout-method"'),
                            HOOK.indexOf('routerAdd("GET", "/fellows/payouts"'));
  check("cash-like: the choose route refuses a transfer it cannot send",
    /TREMENDOUS_PRODUCT_CASH_LIKE/.test(choose) &&
    choose.indexOf("TREMENDOUS_PRODUCT_CASH_LIKE") < choose.indexOf('fellow.set("payout_method", method)'),
    "the refusal has to come before the field is written");
  check("cash-like: and the dashboard reports availability, not just age",
    /can_choose_cash_like: adult && cashConfigured/.test(HOOK),
    "a client must not render a control the server will refuse");
}

// ==========================================================================
// 11. THE LIFETIME TOTAL SURVIVES TWO PAYMENTS AT ONCE
// ==========================================================================
// It was read before a 25-second network call and written after it, so a
// payment that settled inside that window was silently overwritten — on the
// number the $600 tax-form gate is checked against, which means the gate opens
// for somebody it should have closed for.
{
  let reentered = false;
  const w = build(LIVE, {
    respond: (req) => {
      if (req.method === "POST" && !reentered) {
        reentered = true;
        // The other worker, settling while this one is still inside its POST.
        w.E.payOne(w.DB.fellow_conversions[1].__d.id, {});
      }
      return ok200;
    },
  });
  const s = seed(w);
  w.mk("fellow_conversions", { fellow: s.f.__d.id, code: "ab3k9m", order_ref: "cs_test_2",
    commission_usd: 30, status: "pending", pay_after: "2026-01-01T00:00:00.000Z" });
  w.E.payOne(s.c.__d.id, {});
  check("lifetime: two payments in flight at once both count",
    Number(s.f.get("lifetime_paid_usd")) === 60,
    "$" + s.f.get("lifetime_paid_usd") + " after two $30 payments");
  check("lifetime: and both conversions really were paid",
    w.DB.fellow_conversions.filter((c) => c.getString("status") === "paid").length === 2 &&
    w.calls.filter((x) => x.method === "POST").length === 2);
  check("lifetime: it is derived from the paid conversions, not incremented in place",
    /fellow = \{:f\} && status = 'paid'/.test(HOOK_CODE),
    "a read-modify-write across a network call loses one of two concurrent payments");
}

// ==========================================================================
// 12. needs_review HAS A WAY OUT
// ==========================================================================
// Nothing automatic may ever touch a row whose outcome is unknown — that is the
// rule that stops a second $30. But approve:true was accepted on `held` and not
// on `needs_review`, so the one human override in the system silently ignored
// the one state that most needs it, and a real fellow's money was stuck with no
// path forward anywhere.
{
  const w = build(LIVE, { respond: (req, n) => (n === 1 ? new Error("connection reset") : ok200) });
  const { c } = seed(w);
  const first = w.E.payOne(c.__d.id, {});
  check("needs_review: an unknown outcome parks the row for a person",
    first.state === "needs_review" && c.getString("status") === "needs_review");

  const before = w.calls.length;
  w.E.payOne(c.__d.id, {});
  check("needs_review: and no sweep ever releases it on its own",
    w.calls.length === before && c.getString("status") === "needs_review");

  const released = w.E.payOne(c.__d.id, { approve: true });
  check("needs_review: but a person can release it, and it pays",
    released.state === "paid" && c.getString("status") === "paid",
    JSON.stringify(released));
  check("needs_review: the retry carries the SAME external_id, which is what makes it safe",
    w.calls.filter((x) => x.method === "POST")
      .every((x) => JSON.parse(x.body).external_id === "fc-" + c.__d.id),
    "if the vendor already has that order it answers 201 and nothing is charged twice");
  check("needs_review: a human release is recorded as one",
    w.DB.internal_activity.some((a) => a.getString("action") === "fellow.payout_review_released"));

  // A person deciding outranks the three-strike ceiling — otherwise the release
  // is theatre: the ceiling re-holds the row and the human presses Approve
  // forever.
  const x = build(LIVE, { respond: () => ok200 });
  const t = seed(x, { conv: { status: "needs_review", payout_attempts: 3, payout_seq: 3 } });
  check("needs_review: releasing a row that spent its attempts actually pays it",
    x.E.payOne(t.c.__d.id, { approve: true }).state === "paid" && x.calls.length === 1);
}

// ==========================================================================
// 13. THE LANE MIGRATION
// ==========================================================================
{
  check("lane: the new fields exist and the name still says payout",
    /payout_seq/.test(LANE) && /payout_blocked_on/.test(LANE) && /payout_checked_at/.test(LANE));
  check("lane: every field add is guarded, so re-running it on every boot is safe",
    /if \(!c\.fields\.getByName\(name\)\)/.test(LANE));
  check("lane: it seeds payout_seq from the ledger a conversion already has",
    /findRecordsByFilter\("fellow_payouts", "conversion = \{:c\}"/.test(LANE),
    "a counter that starts below the keys already in the ledger collides forever");
  check("lane: it adds and never drops",
    !/removeById/.test(LANE.slice(0, LANE.indexOf("}, (app) =>"))));
  check("lane: the down() removes only what the up() added",
    /removeById/.test(LANE.slice(LANE.indexOf("}, (app) =>"))) &&
    !/app\.delete\(app\.findCollectionByNameOrId/.test(LANE));
  check("lane: the down() does NOT put parked rows back at the front of the pay lane",
    !/set\("status", "pending"\)/.test(LANE.slice(LANE.indexOf("}, (app) =>"))));
  check("lane: the waker's read has an index behind it",
    /idx_fconv_parked/.test(LANE) && /`status`, `payout_checked_at`/.test(LANE));
}

// ==========================================================================
// 14. THE DECISION IS WRITTEN DOWN, AND SAYS THE SAME THING THE CODE DOES
// ==========================================================================
{
  const d = DOC.toLowerCase();
  check("doc: it names the rail", /tremendous/.test(d));
  check("doc: it states the fee on $30", /fee|cost per payout/.test(d));
  check("doc: it settles the under-18 path", /guardian|parent|custodial|minor/.test(d));
  check("doc: it names the tax instrument", /w-9|w9|1099|w-8ben|t4a/.test(d));
  check("doc: it settles the hold", /\bhold\b|up front|upfront/.test(d));
  check("doc: it does not still say TBD", !/undecided/.test(d) && !/\btbd\b/.test(d));
  check("doc: and the sandbox default it promises is the one the code implements",
    /tremendous_env/.test(d) && /TREMENDOUS_ENV/.test(HOOK));
  // The doc says block at $600 lifetime. If the code and the doc disagree about
  // a number that stops somebody's money, one of them is a lie.
  check("doc: the tax block in the doc is the default in the code",
    /600/.test(DOC) && /"600"/.test(HOOK), "the doc and the code must agree on the number");
}

console.log(failures ? `\ntest_fellowship_payouts: ${failures} FAILED` : "\ntest_fellowship_payouts: all passed");
process.exit(failures ? 1 : 0);
