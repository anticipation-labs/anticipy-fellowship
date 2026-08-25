/// <reference path="../pb_data/types.d.ts" />
//
// THE PAYOUT RAIL — real money, to real people, once.
//
// This is the file where a fifteen-year-old in Ontario gets thirty dollars for
// something they made. Everything in it is arranged around one sentence:
//
//     IT MUST BE IMPOSSIBLE TO SEND THE SAME CONVERSION TWICE, even if the cron
//     double-fires, even if two workers race, even if the process dies with the
//     request in flight.
//
// THE MECHANISM, in three parts. All of it completes BEFORE the network call,
// so no transaction has to span an HTTP request.
//
//   1. payout_key = "fc-<conversion id>". Minted once, persisted before any
//      call, NEVER regenerated. It is the vendor's external_id on every attempt
//      for the life of the row, so even a retry that should not have happened
//      comes back as a 201 replay of the original order and no second charge.
//   2. THE CLAIM IS AN INSERT, not an UPDATE to a status field. app.save() on an
//      existing record is a plain UPDATE and last write wins, so two crons that
//      both read `pending` would both write `paying` and both send. The insert
//      goes into fellow_payouts under a UNIQUE index on idempotency_key
//      ("<payout_key>#<sequence>"); SQLite enforces UNIQUE inside a single
//      INSERT, atomically, and PocketBase surfaces the violation as a thrown
//      error. The loser of the race sends nothing, and losing is not a fault.
//   3. AN UNKNOWN OUTCOME IS NEVER A FAILURE. If the process dies between the
//      claim and the response the row sits in `paying`; the backstop moves it to
//      needs_review after 15 minutes and nothing automatic ever sends it again.
//      Only a definite, parsed no-send releases the claim. (internal_hq's
//      reminder sweep gets this wrong in the other direction — it rolls its
//      claim back on a timeout, which for a text is an annoyance and for $30
//      would be a second gift card.) A PERSON can still release such a row —
//      approve:true works on needs_review as well as held — and that is safe
//      because the retry carries the same external_id the vendor already has.
//
// WHERE THE SEQUENCE COMES FROM, and why it is not a count. The claim key is
// "<payout_key>#<payout_seq+1>", and payout_seq is a monotonic counter ON THE
// CONVERSION that is written in the SAME save as status='paying'. That is what
// makes the claim a lock: any worker that still sees `pending` necessarily sees
// the pre-claim sequence too, computes the identical key, and loses the INSERT.
// A count of ledger rows — what this used to do — is the opposite of a lock,
// because two workers reading at different moments compute DIFFERENT keys and
// BOTH insert. Monotonic also means it cannot saturate: nothing rolls it back,
// so the failure paths that write a row without consuming an attempt cannot
// exhaust it.
//
// AND A BLOCKED ROW LEAVES THE PAY LANE. `waiting` is the status for "blocked on
// somebody" — no confirmed email, no guardian yet. It exists because a blocked
// row left at `pending` is due forever and sorts to the FRONT of an oldest-first
// batch of ten, so ten stuck fellows starve everybody behind them, permanently
// and silently. wakeWaiting() re-runs the same payability checks over parked
// rows every sweep, in probe mode (no claim, no network), and returns any row
// whose block has cleared to `pending` with its original pay_after.
//
// The sequence in the DB key and the vendor's external_id are deliberately
// different values: the sequence MUST increase so a second attempt can be
// recorded at all, and external_id must NOT, so the vendor can recognise it.
//
// WHAT THE VENDOR CAN ANSWER, and what each answer means for the money:
//   sent          a NEW order was created. $30 has left the balance.
//   duplicate     an order for this external_id already existed. Nothing was
//                 charged. A SUCCESS: it means the guard worked.
//   no_send       provably nothing was created. Safe to try again.
//   unfunded      the balance is empty. Ours, not the fellow's — costs no attempt.
//   rate_limited  ours too. Same.
//   conflict      the same key with DIFFERENT details. A real bug. Never retry.
//   unknown       we do not know whether $30 moved. Never retried, ever.
//
// TREMENDOUS INVERTS THE REST CONVENTION AND THIS IS THE BUG THAT DOUBLE-PAYS:
// 200 means a new order was created (money spent) and 201 means an order with
// this external_id already existed (no money spent). A handler that reads 201 as
// "Created" mis-accounts; one that reads it as an anomaly and retries loops.
// Both are settled here, and logged apart so the true retry rate is visible.
//
// FOUR STANCES THAT ARE NOT NEGOTIABLE HERE.
//
//   1. UNSET IS A STATE, NOT A FAULT. With TREMENDOUS_API_KEY unset nothing
//      crashes, nothing is claimed, no attempt is consumed, no alarm fires, and
//      every surface says "not switched on yet" in those words. A key that
//      CONTRADICTS the environment is a different answer — "misconfigured" —
//      and it does shout. Anything reading this system, the gate included, can
//      tell those two apart without guessing.
//   2. SANDBOX UNLESS SOMEBODY SAYS PRODUCTION OUT LOUD. The base URL is
//      testflight.tremendous.com unless TREMENDOUS_ENV is exactly "production".
//      Getting the deploy wrong costs zero dollars.
//   3. THE VENDOR IS ONE FUNCTION. Tremendous's ToS is SILENT on recipient age
//      and silence is not permission, so the fallback to Tango Card (13+, in
//      writing) has to be a branch in vendor() and nothing else. No vendor name,
//      no vendor status code and no vendor order id ever reaches a fellow-facing
//      response or a screen.
//   4. UNDER 18 IS STORED VALUE ONLY, ENFORCED TWICE. Once when they choose
//      (POST /fellows/payout-method refuses cash_like) and once when we send
//      (vendor() hands a minor the stored-value product id whatever the row
//      says). And the empty field is CARD — the default, and under 18 the only
//      legal value — never a question that blocks the payment. You cannot open a PayPal, Venmo, Wise, Stripe or Whop account for
//      a minor, because opening a money account needs the capacity to contract.
//      A gift card is not an account, so there is no age wall on it. This is
//      what IRB-approved studies do to pay adolescents.
//
// AND THE LAW THAT OVERRIDES CONVENIENCE, restated because this is the money
// file and the money file is where it gets bent: learning is NEVER gated. Money
// is gated. Those two gates never touch. Nothing here reads as a quota, a
// requirement or a deadline, and nothing here pays for posting.
//
// JSVM RULE, the one that has bitten this codebase repeatedly: every handler
// gets its own copy of every constant and helper it uses. A const at file
// top-level is NOT visible inside a routerAdd or cronAdd callback. The engine
// block therefore appears twice, verbatim, and a test asserts the two copies
// stay byte-identical.
//
// Crons have no `e` at all — they use $app.

// --------------------------------------------------------------------------
// GET /fellows/payouts/health
//
// The same shape and the same posture as /fellows/health: booleans a deploy
// checklist can read from outside without a superuser login, and not one thing
// a stranger can use. No balance, no funding state, no key, no order ids — the
// funding state in particular would tell anybody who asked how much money is
// sitting in our account, which is nobody's business.
//
// `status` is the field that distinguishes NOT CONFIGURED from BROKEN, which is
// the difference between "we haven't switched it on" and "we switched it on
// wrong". A gate that cannot tell those apart reports the first as a failure
// and the second as fine.
// --------------------------------------------------------------------------
routerAdd("GET", "/fellows/payouts/health", (e) => {
  const key = $os.getenv("TREMENDOUS_API_KEY") || "";
  const prod = String($os.getenv("TREMENDOUS_ENV") || "").trim().toLowerCase() === "production";
  const vendorSet = ($os.getenv("ANTICIPY_PAYOUT_VENDOR") || "").trim().toLowerCase();

  let status = "ready";
  if (!key) status = "not_configured";
  else if (prod && key.indexOf("TEST_") === 0) status = "misconfigured";
  else if (!prod && key.indexOf("PROD_") === 0) status = "misconfigured";

  return e.json(200, {
    ok: true,
    // Never the vendor's name to the public. This says WHAT the rail is, not WHO.
    rail: "stored_value",
    // Sandbox is the default and this reports it, so nobody discovers on payday
    // that the deploy has been spending fake money for a fortnight.
    env: prod ? "production" : "sandbox",
    configured: !!key,
    status: status,
    can_send: status === "ready",
    // Under-18 sends stay off until the vendor answers about recipient age in
    // writing. Reported so the answer arriving is a config change somebody can
    // verify, not a thing somebody remembers.
    can_send_under_18: status === "ready" && !!vendorSet,
  });
});

// --------------------------------------------------------------------------
// POST /fellows/payout-method   {method: "card" | "cash_like"}
//
// How they want it. Card is the default and, under 18, the only answer — and
// the refusal is written so it never reads as a restriction ON THEM. A company
// cannot make a binding agreement with someone under 18, so the limit sits on
// us, which is also where it actually is.
// --------------------------------------------------------------------------
routerAdd("POST", "/fellows/payout-method", (e) => {
  const sha256 = (s) => $security.sha256(s);
  const token = e.request.header.get("X-Fellow-Token") || "";
  if (!token) return e.json(401, { reauth: true });
  let fellow = null;
  try { fellow = e.app.findFirstRecordByFilter("fellows", "session_hash = {:h}", { h: sha256(token) }); } catch (_) {}
  if (fellow && fellow.getString("status") === "removed") fellow = null;
  if (!fellow) return e.json(401, { reauth: true });
  const sexp = Date.parse(fellow.getString("session_expires"));
  if (isNaN(sexp) || Date.now() > sexp) return e.json(401, { reauth: true });

  let body = {};
  try { body = e.requestInfo().body || {}; } catch (_) {}
  const method = String(body.method || "").trim().toLowerCase();
  if (method !== "card" && method !== "cash_like") {
    return e.json(200, { ok: false, field: "method",
      message: "Pick one: a prepaid card by email, or a transfer." });
  }

  // The band is recomputed here rather than trusted, for the same reason
  // /fellows/me recomputes it: somebody turns 18 and the answer changes without
  // anyone running anything.
  let band = fellow.getString("age_band") || "";
  const bm = Number(fellow.get("birth_month")), by = Number(fellow.get("birth_year"));
  if (bm && by) {
    const d = new Date();
    let age = d.getUTCFullYear() - by;
    if (d.getUTCMonth() + 1 < bm) age -= 1;
    band = age >= 18 ? "18_plus" : (age >= 16 ? "16_17" : "13_15");
  }

  // ENFORCEMENT ONE OF TWO. The second is inside vendor(), at the moment the
  // money leaves, because a policy that lives in one place is a policy the
  // second caller bypasses.
  if (method === "cash_like" && band !== "18_plus") {
    return e.json(200, { ok: false, field: "method",
      message: "A transfer needs a PayPal or bank account, and a company can't open one of those "
        + "with someone under 18, so that option isn't ours to offer yet. The card is the same "
        + "$30, by email, and there's nothing to set up." });
  }

  // NEVER PROMISE A TRANSFER WE CANNOT SEND. vendor() falls back to the
  // stored-value product when TREMENDOUS_PRODUCT_CASH_LIKE is unset, so without
  // this an adult picks a transfer, is told "Done. A transfer instead", and
  // thirty days later a prepaid card turns up with no explanation on any screen
  // in the system. Refused at the point of choosing, which is the only moment
  // the answer is still theirs to change.
  if (method === "cash_like" && !($os.getenv("TREMENDOUS_PRODUCT_CASH_LIKE") || "").trim()) {
    return e.json(200, { ok: false, field: "method",
      message: "Transfers aren't switched on yet, so the only thing we could actually send you is the "
        + "card, and we're not going to say transfer and do something else. It's the same $30, by "
        + "email, with nothing to set up." });
  }

  fellow.set("payout_method", method);
  fellow.set("payout_method_set_at", new Date().toISOString());
  try { e.app.save(fellow); }
  catch (_) { return e.json(200, { ok: false, message: "That didn't save. Try once more?" }); }

  return e.json(200, {
    ok: true,
    method: method,
    message: method === "card"
      ? "Done. A prepaid Visa, by email, thirty days after a sale."
      : "Done. A transfer instead: same $30, it just takes a couple of days longer to land.",
  });
});

// --------------------------------------------------------------------------
// GET /fellows/payouts — their own money, in their own words.
//
// WHAT IS DELIBERATELY NOT IN HERE: the vendor's name, the order id, the reward
// id, the HTTP status, the attempt count, and the words "needs review". A
// conversion whose outcome we are unsure about is shown as ordinary coming
// money, because it is OUR problem and there is no version of "your payment is
// in an unknown state" that helps a fifteen-year-old.
//
// `void` rows are omitted entirely. A list of sales that will never pay invites
// a question nobody can answer kindly.
// --------------------------------------------------------------------------
routerAdd("GET", "/fellows/payouts", (e) => {
  const sha256 = (s) => $security.sha256(s);
  const token = e.request.header.get("X-Fellow-Token") || "";
  if (!token) return e.json(401, { reauth: true });
  let fellow = null;
  try { fellow = e.app.findFirstRecordByFilter("fellows", "session_hash = {:h}", { h: sha256(token) }); } catch (_) {}
  if (fellow && fellow.getString("status") === "removed") fellow = null;
  if (!fellow) return e.json(401, { reauth: true });
  const sexp = Date.parse(fellow.getString("session_expires"));
  if (isNaN(sexp) || Date.now() > sexp) return e.json(401, { reauth: true });

  let band = fellow.getString("age_band") || "";
  const bm = Number(fellow.get("birth_month")), by = Number(fellow.get("birth_year"));
  if (bm && by) {
    const d = new Date();
    let age = d.getUTCFullYear() - by;
    if (d.getUTCMonth() + 1 < bm) age -= 1;
    band = age >= 18 ? "18_plus" : (age >= 16 ? "16_17" : "13_15");
  }
  const adult = band === "18_plus";
  // Empty means CARD here as everywhere else: card is the default, the only
  // legal value under 18, and the only thing an unset field could ever have
  // meant. Reporting "" told a fellow they still owed us a decision they did not.
  const method = (fellow.getString("payout_method") || "").trim() || "card";
  const cashConfigured = !!($os.getenv("TREMENDOUS_PRODUCT_CASH_LIKE") || "").trim();

  // Names the missing step rather than saying "waiting on the setup step",
  // which does not tell anyone which step. NOT "method" any more: unset is card,
  // not a missing step, and blocking on it made every fellow who never found the
  // choose route permanently unpayable.
  let blocked = "";
  if (!fellow.getString("email_confirmed_at")) blocked = "email";
  else if (!adult && fellow.getString("parental_consent") !== "confirmed") blocked = "guardian";

  const rows = [];
  let paid = 0, coming = 0;
  try {
    const cs = e.app.findRecordsByFilter("fellow_conversions", "fellow = {:f}", "-created", 100, 0,
      { f: fellow.get("id") });
    for (const c of cs) {
      const st = c.getString("status");
      if (st === "void") continue;
      const amount = Number(c.get("commission_usd")) || 0;
      // Three states, and only three. paying and needs_review are both just
      // "coming" to them.
      const shown = st === "paid" ? "sent" : (st === "held" ? "checking" : "coming");
      if (shown === "sent") paid += amount; else coming += amount;
      rows.push({
        amount_usd: amount,
        state: shown,
        created: c.getString("created"),
        // The date they were promised, and the date it actually went.
        arrives: (c.getString("pay_after") || "").slice(0, 10),
        sent_on: (c.getString("paid_at") || "").slice(0, 10),
        sent_to: adult ? "you" : "your guardian",
      });
    }
  } catch (_) {}

  return e.json(200, {
    ok: true,
    method: method,
    // Cash-like is not merely hidden for a minor, it is reported as unavailable,
    // so a client cannot render a control the server will refuse.
    // Availability, not preference: a client must not render a control the
    // server will refuse, and the server refuses a transfer it cannot send.
    can_choose_cash_like: adult && cashConfigured,
    blocked_on: blocked,
    // Said plainly so they do not bin the email. This is the ONLY place the
    // sender's name belongs on a fellow-facing surface, and it is honest rather
    // than leaky: they are about to receive an email from it.
    note: "The card comes by email from Tremendous, who send the cards. It isn't spam.",
    totals: { sent_usd: paid, coming_usd: coming },
    payouts: rows,
  });
});

// --------------------------------------------------------------------------
// POST /internal/fellows/pay   {conversion_id, approve?, now?}
//
// The human end of the rail. Internal key, fail-closed, exactly the stance the
// rest of HQ takes — this half of the file is NOT public.
//
//   approve: true   releases a `held` row into the pay lane. This is the ONE
//                   human gate the design keeps: a fellow's first ever
//                   conversion, and anything an intake rule stopped. One click
//                   per fellow, once, for the life of the programme.
//   now: true       skips the 30-day clock. Only a person may do this; the
//                   sweep never does.
//
// It is idempotent by construction: it runs the same claim-then-send engine the
// cron runs, so pressing it twice, or pressing it while the sweep is mid-flight,
// cannot produce a second order.
// --------------------------------------------------------------------------
routerAdd("POST", "/internal/fellows/pay", (e) => {
  const key = $os.getenv("ANTICIPY_INTERNAL_KEY") || "";
  if (!key) return e.json(503, { error: "internal HQ is not configured" });
  if (!$security.equal(e.request.header.get("X-Internal-Key") || "", key)) {
    return e.json(401, { error: "wrong key" });
  }
  let body = {};
  try { body = e.requestInfo().body || {}; } catch (_) {}
  const convId = String(body.conversion_id || "").trim();
  if (!convId) return e.json(400, { error: "which conversion?" });
  // ===== ENGINE:BEGIN ========================================================
  // DUPLICATED VERBATIM IN THE OTHER HANDLER, down to ENGINE:END. Not laziness:
  // a const at file top-level is NOT visible inside a routerAdd or cronAdd
  // callback in this runtime, and the failure mode is a 500 on the one route
  // that moves money. test_fellowship_payouts.mjs extracts both copies and
  // asserts they are byte-identical, so they cannot drift. The reasoning behind
  // what this does lives in the file header, once.
  const engine = (app) => {
    // Until ANTICIPY_PAYOUT_VENDOR is explicitly set, the rail pays 18+ and
    // refuses anyone younger. Tremendous's ToS is SILENT on recipient age, and
    // silence is not permission — this makes that a runtime fact, not a promise.
    const VENDOR_SET   = ($os.getenv("ANTICIPY_PAYOUT_VENDOR") || "").trim().toLowerCase();
    const VENDOR       = VENDOR_SET || "tremendous";
    const AMOUNT_MAX   = parseFloat($os.getenv("ANTICIPY_FELLOW_PAYOUT_MAX_USD") || "30") || 30;
    const TAX_FORM_USD = parseFloat($os.getenv("ANTICIPY_FELLOW_TAX_FORM_USD") || "600") || 600;
    const MAX_ATTEMPTS = 3;
    const STALE_MS     = 15 * 60 * 1000;

    const nowISO = () => new Date().toISOString();

    // The naive version — replace(" ","T") + "Z" — yields "...880ZZ" on 0.30.4's
    // own autodates: Invalid Date, then NaN, then a guard that never fires. That
    // bug once pinned a research slot forever. Here it would mean every crashed
    // attempt sits in `paying` invisibly and nobody is ever paid again.
    const pbTime = (v) => {
      if (!v) return NaN;
      let t = String(v).trim().replace(" ", "T");
      if (!/([Zz]|[+-]\d{2}:?\d{2})$/.test(t)) t += "Z";
      return new Date(t).getTime();
    };

    const logAct = (action, subject, ref) => {
      try {
        const a = new Record(app.findCollectionByNameOrId("internal_activity"));
        a.set("actor", ""); a.set("actor_name", "Fellowships");
        a.set("action", action);
        a.set("subject", String(subject).slice(0, 400));
        if (ref) a.set("ref", ref);
        app.save(a);
      } catch (_) {}
    };

    // At most once a day. Same two-field meter as "email" and "llm", but `hour`
    // holds a DAY: an empty balance does not need twenty-four identical rows in
    // the activity feed before somebody sees it.
    const sayOnce = (meterName, action, subject) => {
      const day = nowISO().slice(0, 10);
      let m = null;
      try { m = app.findFirstRecordByFilter("fellow_meter", "name = {:n}", { n: meterName }); } catch (_) {}
      if (!m) {
        try {
          m = new Record(app.findCollectionByNameOrId("fellow_meter"));
          m.set("name", meterName); m.set("hour", ""); m.set("calls", 0);
          app.save(m);
        } catch (_) { return false; }
      }
      if (m.getString("hour") === day) return false;
      m.set("hour", day); m.set("calls", (Number(m.get("calls")) || 0) + 1);
      try { app.save(m); } catch (_) {}
      logAct(action, subject, "");
      return true;
    };

    // THE VENDOR. ONE FUNCTION. Everything vendor-specific is between here and
    // the end of it: base URLs, auth, body shape, product ids, and the map from
    // their HTTP codes to an outcome word. Nothing outside reads vendor JSON or
    // branches on a vendor status code, so Tango Card is a second branch HERE and
    // no change anywhere else. Outcome words and the 200-is-new / 201-is-replay
    // inversion are set out in the file header.
    const vendor = (op, args) => {
      const a = args || {};
      const key  = $os.getenv("TREMENDOUS_API_KEY") || "";
      // SANDBOX UNLESS SOMEBODY SAYS PRODUCTION OUT LOUD, so a wrong deploy costs
      // zero dollars: the sandbox host shares no data with production and its
      // balance is fake.
      const prod = String($os.getenv("TREMENDOUS_ENV") || "").trim().toLowerCase() === "production";
      const base = prod ? "https://api.tremendous.com/api/v2"
                        : "https://testflight.tremendous.com/api/v2";
      const H = {
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
        "Accept": "application/json",
        // Ignored today — external_id in the body is Tremendous's whole
        // idempotency mechanism — but free, and already right on the day a vendor
        // honours a header instead.
        "Idempotency-Key": String(a.key || ""),
      };

      // The one place a third party could hand our own credential back and we
      // would write it into a row a human reads.
      const scrub = (v) => {
        let t = "";
        try { t = String(v == null ? "" : v); } catch (_) { t = ""; }
        t = t.slice(0, 2000);
        if (key) t = t.split(key).join("[key]");
        return t.replace(/(?:Bearer\s+)?[A-Za-z0-9_\-]{24,}/g, "[redacted]");
      };

      // Live returns {"errors":{...}} — plural. Their own rate-limiting page
      // prints {"error":{...}} — singular. A parser that assumes one shape throws
      // INSIDE the error handler, turning a clean 429 into a resend. Read both,
      // and never let parsing throw. res.raw is never read wholesale.
      const msgOf = (res) => {
        let m = "";
        try { m = String(res.json.errors.message || ""); } catch (_) {}
        if (!m) { try { m = String(res.json.error.message || ""); } catch (_) {} }
        if (!m) { try { m = String(res.json.message || ""); } catch (_) {} }
        return scrub(m);
      };

      if (op === "config") {
        // NOT CONFIGURED AND BROKEN ARE DIFFERENT ANSWERS. No key is a state:
        // nothing sends, nothing is claimed, no attempt is consumed, no alarm.
        // A key that contradicts the environment is a fault, and says so.
        if (!key) return { configured: false, ok: false, reason: "not_configured", env: prod ? "production" : "sandbox", error: "" };
        if (prod && key.indexOf("TEST_") === 0) {
          return { configured: true, ok: false, reason: "misconfigured", env: "production",
                   error: "TREMENDOUS_ENV is production but the key is a sandbox key" };
        }
        if (!prod && key.indexOf("PROD_") === 0) {
          return { configured: true, ok: false, reason: "misconfigured", env: "sandbox",
                   error: "the key is a production key but TREMENDOUS_ENV is not production" };
        }
        return { configured: true, ok: true, reason: "", env: prod ? "production" : "sandbox", error: "" };
      }

      if (op === "balance") {
        // Preflight, so an empty balance is caught by us and not by a 402 that has
        // already burned an attempt on ten conversions. cents === -1 means
        // UNREADABLE, deliberately not the same as EMPTY: an endpoint we cannot
        // parse must not stop everybody being paid forever.
        if (!key) return { configured: false, ok: false, cents: -1, http: 0, error: "" };
        try {
          const res = $http.send({ url: base + "/funding_sources", method: "GET", headers: H, timeout: 15 });
          if (res.statusCode !== 200) {
            return { configured: true, ok: false, cents: -1, http: res.statusCode, error: msgOf(res) };
          }
          let cents = -1;
          try {
            const list = res.json.funding_sources || [];
            for (const f of list) {
              if (String(f.method) !== "balance") continue;
              if (String(f.status) !== "active") continue;
              let apiOK = false;
              try { for (const p of (f.usage_permissions || [])) if (String(p) === "api_orders") apiOK = true; } catch (_) {}
              if (!apiOK) continue;
              const c = Number(f.meta.available_cents);
              if (!isNaN(c)) cents = c;
            }
          } catch (_) { cents = -1; }
          return { configured: true, ok: cents >= 0, cents: cents, http: 200, error: "" };
        } catch (err) {
          return { configured: true, ok: false, cents: -1, http: 0, error: scrub(err) };
        }
      }

      // ---- op === "send" ----
      if (!key) return { outcome: "not_configured", http: 0, error: "", orderId: "", rewardId: "", product: "" };

      // UNDER 18 IS STORED VALUE ONLY, AND THIS IS THE SECOND OF THE TWO SERVER-
      // SIDE ENFORCEMENTS. /fellows/payout-method already refused cash_like for a
      // minor; this is the gate where the money actually leaves, so a hand-edited
      // row, a restored backup or a future second caller cannot route a fifteen-
      // year-old at a money account. A single-element products array is what makes
      // it real: it overrides whatever catalogue a campaign offers.
      //
      // Q24BD9EZ332JT is "Virtual Visa" — USD, unrestricted, 215 countries
      // including the US and Canada. NOT V4QZ00F554D3 "Prepaid Virtual Visa",
      // whose better-matching name is a trap: every catalogue row for it reads
      // "Limited to specific use cases only", so it passes in sandbox and fails in
      // production.
      const STORED = $os.getenv("TREMENDOUS_PRODUCT_STORED_VALUE") || "Q24BD9EZ332JT";
      const CASH   = $os.getenv("TREMENDOUS_PRODUCT_CASH_LIKE") || "";
      const product = (a.adult === true && a.method === "cash_like" && CASH) ? CASH : STORED;

      const reward = {
        value: { denomination: a.amountUsd, currency_code: "USD" },
        products: [product],
        recipient: { name: String(a.name || "").slice(0, 120), email: String(a.email || "") },
        // EMAIL, never LINK: an unsent link holds real value we would forfeit, and
        // a link is a bearer token to cash that must never touch a log line.
        delivery: {
          method: "EMAIL",
          meta: {
            sender_name: "Anticipy Fellowships",
            subject_line: "Your $" + a.amountUsd + " from the Anticipy fellowship",
            message: String(a.note || "").slice(0, 400),
          },
        },
      };
      // The campaign supplies look and copy only; the products array still decides
      // what the recipient may choose, which is what keeps a minor on stored value
      // even if somebody widens the campaign later.
      const campaign = $os.getenv("TREMENDOUS_CAMPAIGN_ID") || "";
      if (campaign) reward.campaign_id = campaign;

      const payload = {
        external_id: a.key,     // the idempotency key. Persisted before this call.
        payment: { funding_source_id: $os.getenv("TREMENDOUS_FUNDING_SOURCE_ID") || "BALANCE" },
        reward: reward,
      };

      const idOf = (res) => {
        const out = { orderId: "", rewardId: "", total: NaN, status: "" };
        try { out.orderId = String(res.json.order.id || ""); } catch (_) {}
        try { out.rewardId = String(res.json.order.rewards[0].id || ""); } catch (_) {}
        try { out.total = Number(res.json.order.payment.total); } catch (_) {}
        try { out.status = String(res.json.order.status || ""); } catch (_) {}
        return out;
      };

      // The only correct move after a timeout or a 5xx: ask whether the order
      // landed, keyed by OUR external_id. A GET cannot spend money, so it is
      // free to try, and it is what stops an unclear response from stranding a
      // real person's $30 behind a human.
      //
      // GUARD — THIS IS A QUERY, NOT A PATH SEGMENT, AND THE DIFFERENCE IS THE
      // WHOLE FUNCTION. /orders/<id> takes TREMENDOUS'S OWN order id — the
      // "ORD..." value idOf() reads back — and never ours. Asking it for
      // fc-<conversion> is asking for an id that has never existed there, so
      // every reconcile answered "not 200, not 404" and returned null, and EVERY
      // unclear outcome fell through to needs_review: a fellow whose $30 had in
      // fact gone out sat behind a human forever, which is the exact failure
      // this function was written to prevent. GET /orders?external_id=<ours> is
      // the only lookup on this API that speaks our key.
      const reconcile = () => {
        try {
          const r2 = $http.send({ url: base + "/orders?external_id=" + encodeURIComponent(String(a.key)),
                                  method: "GET", headers: H, timeout: 15 });
          if (r2.statusCode === 200) {
            // The list form answers {"orders":[...]}; the first element is the
            // order for this external_id, because the key is unique to it.
            let list = null;
            try { list = r2.json.orders; } catch (_) { list = null; }
            if (list) {
              let n = 0, first = null;
              try { for (const o of list) { n++; if (n === 1) first = o; } } catch (_) { n = -1; first = null; }
              if (n > 0 && first) {
                let oid = "", rid = "";
                try { oid = String(first.id || ""); } catch (_) {}
                try { rid = String(first.rewards[0].id || ""); } catch (_) {}
                if (oid) {
                  return { outcome: "duplicate", http: 200, orderId: oid, rewardId: rid,
                           product: product, error: "reconciled after an unclear response: the order exists" };
                }
                // An order we cannot name is an order we cannot prove anything
                // about. Fall through to unknown rather than guess.
                return null;
              }
              if (n === 0) {
                // An EMPTY list under our own key is the only proof of a no-send
                // this vendor offers. It releases the claim for a retry that goes
                // out under the SAME external_id, so it stays safe even if the
                // proof were wrong.
                return { outcome: "no_send", http: 200, orderId: "", rewardId: "", product: product,
                         error: "reconciled after an unclear response: no order exists under this key" };
              }
            }
          }
          // Anything else is NOT an answer. A 404 on the list route means the
          // route is wrong, not that the order is absent, and reading it as a
          // no-send is how a paid conversion gets sent a second time.
        } catch (_) {}
        return null;
      };

      let res = null;
      try {
        res = $http.send({ url: base + "/orders", method: "POST", headers: H,
                           body: JSON.stringify(payload), timeout: 25 });
      } catch (err) {
        // The connection dropped. We do not get to decide from the exception
        // whether the order committed — that is exactly the case where the
        // teenager has the money and our row says unpaid.
        const rec = reconcile();
        if (rec) return rec;
        return { outcome: "unknown", http: 0, orderId: "", rewardId: "", product: product, error: scrub(err) };
      }

      const code = Number(res.statusCode) || 0;
      const got = idOf(res);

      if (code === 200 || code === 201) {
        if (!got.orderId) {
          // An order we cannot reference is an order we can never reconcile.
          const rec = reconcile();
          if (rec) return rec;
          return { outcome: "unknown", http: code, orderId: "", rewardId: "", product: product,
                   error: "the vendor returned " + code + " with no order id" };
        }
        // Assert the money at runtime rather than trusting the price list: a
        // denomination that crossed a SKU band, an org currency change, or a fee
        // we did not expect all show up here.
        if (!isNaN(got.total) && Math.abs(got.total - Number(a.amountUsd)) > 0.005) {
          return { outcome: "conflict", http: code, orderId: got.orderId, rewardId: got.rewardId, product: product,
                   error: "the vendor charged " + got.total + " for a $" + a.amountUsd + " reward" };
        }
        return { outcome: code === 200 ? "sent" : "duplicate", http: code,
                 orderId: got.orderId, rewardId: got.rewardId, product: product, error: "" };
      }
      if (code === 402) return { outcome: "unfunded", http: 402, orderId: "", rewardId: "", product: product, error: msgOf(res) };
      if (code === 409) return { outcome: "conflict", http: 409, orderId: "", rewardId: "", product: product, error: msgOf(res) };
      if (code === 429) return { outcome: "rate_limited", http: 429, orderId: "", rewardId: "", product: product, error: msgOf(res) };
      if (code === 400 || code === 401 || code === 403 || code === 404 || code === 422) {
        return { outcome: "no_send", http: code, orderId: "", rewardId: "", product: product, error: msgOf(res) };
      }
      // 5xx and anything unlisted. The default is NEVER "retry".
      const rec = reconcile();
      if (rec) return rec;
      return { outcome: "unknown", http: code, orderId: "", rewardId: "", product: product, error: msgOf(res) };
    };

    // PAY ONE CONVERSION. The three-part guard that makes double-paying
    // impossible — the never-regenerated external_id, the INSERT-under-UNIQUE
    // claim taken before the network call, and the rule that an unknown outcome
    // is never retried — is set out in full in the file header.
    const payOne = (convId, opts) => {
      const o = opts || {};

      let conv = null;
      try { conv = app.findRecordById("fellow_conversions", String(convId)); } catch (_) {}
      if (!conv) return { ok: false, state: "missing", message: "no such conversion" };

      const hold = (reason) => {
        conv.set("status", "held");
        conv.set("review_reason", String(reason).slice(0, 500));
        try { app.save(conv); } catch (_) {}
        logAct("fellow.payout_held", String(reason).slice(0, 300), conv.get("id"));
        return { ok: false, state: "held", message: String(reason) };
      };
      // Waiting on the fellow, or on us. Costs no attempt, raises no flag, and
      // resolves itself the moment the missing thing arrives. Conflating this with
      // `held` is how somebody waits four months for $30 that was never coming.
      //
      // GUARD — A BLOCKED ROW MUST LEAVE THE PAY LANE. This used to leave the row
      // at `pending` with pay_after untouched, so it stayed DUE FOREVER and, because
      // dueRows sorts oldest-first, it sorted to the FRONT of every sweep for the
      // rest of time. Ten fellows who had not finished a setup step permanently
      // occupied all ten slots and NOBODY BEHIND THEM WAS EVER PAID — silently,
      // with every surface reporting normal. `waiting` is a status the due query
      // does not match, so a block now costs its own row and nobody else's.
      //
      // HOW A ROW GETS BACK IN: wakeWaiting() below re-runs these very checks over
      // parked rows every sweep and returns any whose block has cleared to
      // `pending`. pay_after is never moved, so a row that waited keeps its place
      // in the queue rather than going to the back of it.
      const wait = (why, blocked) => {
        conv.set("status", "waiting");
        conv.set("review_reason", why);
        conv.set("payout_blocked_on", String(blocked || ""));
        // Stamped on EVERY check, so wakeWaiting can round-robin by it: without a
        // moving timestamp the oldest parked rows would be re-checked forever and
        // the rows behind them never would.
        conv.set("payout_checked_at", nowISO());
        try { app.save(conv); } catch (_) {}
        return { ok: false, state: "waiting", blocked: blocked, message: why };
      };

      // A human pressing Approve is the ONE human gate this design keeps: one
      // click per fellow, once, for the life of the programme.
      //
      // GUARD — needs_review IS RELEASABLE TOO. Approve used to be accepted on
      // `held` alone, so a row parked by an unknown vendor outcome had NO way out
      // anywhere in the system: the sweep never touches needs_review by design,
      // and the one human override silently ignored it. That is a real fellow's
      // $30 stuck forever. Releasing it is safe for exactly the reason this rail
      // exists — the retry goes out under the SAME never-regenerated external_id,
      // so if the vendor already has that order it answers 201 and nothing is
      // charged twice.
      const releasable = { held: true, needs_review: true };
      if (o.approve === true && releasable[conv.getString("status")] === true) {
        const wasStatus = conv.getString("status");
        conv.set("status", "pending");
        conv.set("review_reason", "");
        conv.set("payout_blocked_on", "");
        // A person deciding outranks the three-strike ceiling. Without this the
        // release is theatre: a row that already spent its attempts is re-held by
        // the ceiling check a few lines below, and the human presses Approve
        // forever. It cannot become a spend loop — every attempt carries the same
        // external_id, and MAX_ATTEMPTS still bounds what follows the release.
        conv.set("payout_attempts", 0);
        try { app.save(conv); }
        catch (_) { return { ok: false, state: wasStatus, message: "couldn't release that" }; }
        logAct(wasStatus === "needs_review" ? "fellow.payout_review_released" : "fellow.payout_released",
          "A person released a " + wasStatus + " conversion for payment", conv.get("id"));
      }

      const status = conv.getString("status");
      if (status === "paid") {
        return { ok: true, state: "paid", already: true, message: "already paid, nothing was sent" };
      }
      if (status === "paying")  return { ok: false, state: "paying", message: "an attempt is already in flight" };
      if (status === "void")    return { ok: false, state: "void", message: "this conversion will never pay" };
      if (status === "needs_review") {
        return { ok: false, state: "needs_review",
                 message: conv.getString("review_reason") || "a person has to settle this one by hand" };
      }
      if (status === "held") {
        return { ok: false, state: "held", message: conv.getString("review_reason") || "held for a person to look at" };
      }
      // `waiting` is IN the lane, merely parked: it is this rail's own word for
      // "blocked on somebody", and re-entering it is the entire point of it. Any
      // OTHER unrecognised status is still held rather than guessed at.
      if (status !== "pending" && status !== "waiting") {
        return hold("This row's status was " + JSON.stringify(status) + ", which the payout rail does "
          + "not understand. It was held rather than guessed at.");
      }

      // The clock. Only a person may bypass it; the sweep never does.
      const pa = pbTime(conv.getString("pay_after"));
      if (o.now !== true) {
        if (isNaN(pa)) {
          return hold("This conversion has no usable pay-after date, so the 30-day clock cannot be "
            + "checked. Set one, then release it.");
        }
        if (Date.now() < pa) {
          return { ok: false, state: "pending", message: "not due until " + conv.getString("pay_after") };
        }
      }

      // Checked BEFORE the claim, so an unset key never consumes an attempt and
      // never leaves a claim row behind. Nothing sent, nothing written, and the
      // answer is a status rather than a crash.
      const cfg = vendor("config", {});
      if (!cfg.configured) {
        return { ok: false, state: "pending", blocked: "not_configured",
                 message: "payouts are not switched on yet, so nothing was sent" };
      }
      if (!cfg.ok) {
        sayOnce("payout_cfg", "fellow.payout_misconfigured",
          "The payout rail is configured wrongly and nothing can send: " + cfg.error);
        return { ok: false, state: "pending", blocked: "misconfigured", message: cfg.error };
      }

      // ---- payability, checked NOW and not at conversion time ----
      let fellow = null;
      try { fellow = app.findRecordById("fellows", conv.getString("fellow")); } catch (_) {}
      if (!fellow) {
        return hold("The fellow row this conversion points at is gone. Nothing can be paid until "
          + "somebody works out who is owed it.");
      }
      if (fellow.getString("status") === "removed") {
        return hold("This fellow was removed. Under the never-clawed-back rule they may still be "
          + "owed this; that is a decision for a person, not a cron.");
      }
      if (conv.getString("code") && conv.getString("code") !== fellow.getString("referral_code")) {
        return hold("The referral code on this sale is not the fellow's current code, so the credit "
          + "is ambiguous. Check it before paying.");
      }

      // The band is recomputed HERE, at payment time: a fellow who turns 18
      // between the sale and the payment must not have their card sent to a
      // guardian. The band we actually used is copied onto the payout row and
      // never recomputed there, or the audit trail rewrites itself on a birthday.
      let band = fellow.getString("age_band") || "";
      const bm = Number(fellow.get("birth_month")), by = Number(fellow.get("birth_year"));
      if (bm && by) {
        const d = new Date();
        let age = d.getUTCFullYear() - by;
        if (d.getUTCMonth() + 1 < bm) age -= 1;
        band = age >= 18 ? "18_plus" : (age >= 16 ? "16_17" : "13_15");
      }
      const adult = band === "18_plus";

      if (!fellow.getString("email_confirmed_at")) {
        return wait("We're waiting on them to confirm their email address.", "email");
      }
      if (!adult && fellow.getString("parental_consent") !== "confirmed") {
        return wait("We're waiting on a parent or guardian to finish the payout step.", "guardian");
      }
      // GUARD — EMPTY IS CARD, NOT A BLOCKER. Nothing in the entire codebase ever
      // wrote payout_method except POST /fellows/payout-method, a route a fellow
      // has to go and find, and this used to refuse to send while it was empty —
      // so every fellow who never found it was unpayable FOREVER, and (before
      // `waiting` existed) blocked everyone behind them too. Card is the default,
      // the only legal value under 18, and what the decision doc promises, so an
      // unset field is that answer rather than a question. It is also defaulted at
      // signup and at guardian consent; this is the fail-closed half that covers
      // every row written before either of those existed.
      const method = (fellow.getString("payout_method") || "").trim() || "card";

      // GUARD — NEVER SUBSTITUTE A CARD FOR A TRANSFER IN SILENCE. vendor() falls
      // back to the stored-value product when TREMENDOUS_PRODUCT_CASH_LIKE is
      // unset, so an adult who chose a transfer and was told "Done" would receive
      // a prepaid card thirty days later and nothing anywhere would say why. The
      // choose route now refuses cash_like while it is unconfigured; this catches
      // the row that chose it back when it WAS configured. It holds rather than
      // sends, because a card sent instead of a transfer cannot be taken back and
      // a hold can be cleared in a minute.
      if (adult && method === "cash_like" && !($os.getenv("TREMENDOUS_PRODUCT_CASH_LIKE") || "").trim()) {
        return hold("This fellow chose a transfer, but no cash-like product is configured "
          + "(TREMENDOUS_PRODUCT_CASH_LIKE is unset), so the only thing this rail could send them is a "
          + "card they did not ask for. Configure it, or set them back to card and tell them. Do not "
          + "just send the card.");
      }
      // ENFORCEMENT ONE OF THE TWO ON THE SEND SIDE. The second is inside
      // vendor(), which hands a minor the stored-value product whatever this field
      // says — the same belt-and-braces sms_opt_in gets, for the same reason.
      if (!adult && method === "cash_like") {
        return hold("This fellow is under 18 and their payout method is set to a cash-like rail. "
          + "That cannot be paid: a minor cannot hold a money account. Set them back to card.");
      }
      if (!adult && !VENDOR_SET) {
        return wait("We're waiting on the vendor's written answer about paying recipients under 18 "
          + "before any under-18 payment goes out.", "vendor_age");
      }
      if (!fellow.get("code_active")) {
        return hold("Everything else about this payment is ready but the fellow's code is switched "
          + "off, which means a person turned it off. Decide before paying.");
      }

      const amount = Number(conv.get("commission_usd")) || 0;
      if (!(amount >= 1 && amount <= AMOUNT_MAX)) {
        return hold("This conversion is set to $" + amount + ", which is outside the $1-$" + AMOUNT_MAX
          + " band. A typo must never be able to wire somebody thousands of dollars.");
      }

      // Checked BEFORE the payment that would cross the line, never after: the
      // paperwork has to be collected from somebody who is under no obligation to
      // answer once they already have the money.
      const lifetime = Number(fellow.get("lifetime_paid_usd")) || 0;
      if (lifetime + amount > TAX_FORM_USD) {
        return hold("Paying this would take them past $" + TAX_FORM_USD + " lifetime. Collect the tax "
          + "form first, then release. Do not hold anything they are already owed longer than that takes.");
      }

      // The recipient is resolved at PAYMENT time too. For 13-17 the guardian is
      // the payee of record — they accepted in their own name, which is the only
      // part of the arrangement that is enforceable, a minor's own agreement being
      // voidable at the minor's option.
      const toGuardian = !adult;
      const rName = String((toGuardian ? fellow.getString("guardian_name") : fellow.getString("name")) || "").trim();
      const rEmail = String((toGuardian ? fellow.getString("guardian_email") : fellow.getString("email")) || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(rEmail)) {
        return hold("There is no usable address to send " + (toGuardian ? "the guardian's" : "their")
          + " card to. Confirm it out of band. A bounce is the one failure the vendor will not tell "
          + "us about at the time.");
      }
      const fellowFirst = String(fellow.getString("name") || "").trim().split(/\s+/)[0]
        || String(fellow.getString("email") || "").split("@")[0];

      // ---- THE PROBE STOPS HERE ----
      // Everything above this line is the payability predicate; everything below
      // it spends money. wakeWaiting() runs the predicate and nothing else, so a
      // parked row is re-tested every sweep for free and returns to the lane the
      // instant its block clears — ONE predicate, not a second copy in the waker
      // that drifts out of step with this one and pays somebody it should not.
      if (o.probe === true) {
        if (conv.getString("status") !== "pending") {
          conv.set("status", "pending");
          conv.set("review_reason", "");
          conv.set("payout_blocked_on", "");
          conv.set("payout_checked_at", nowISO());
          try { app.save(conv); }
          catch (_) { return { ok: false, state: "waiting", message: "couldn't return it to the pay lane" }; }
          logAct("fellow.payout_unblocked", "A parked payout came unblocked and is back in the pay lane",
            conv.get("id"));
        }
        return { ok: true, state: "ready", message: "nothing is blocking this one" };
      }

      // ---- the key, persisted BEFORE anything leaves ----
      let key = conv.getString("payout_key");
      if (!key) {
        key = "fc-" + conv.get("id");
        conv.set("payout_key", key);
        try { app.save(conv); }
        catch (_) {
          return { ok: false, state: "pending",
                   message: "couldn't persist the idempotency key, so nothing was sent" };
        }
      }

      // ---- the claim ----
      // The sequence never repeats, so a second attempt can be recorded at all.
      // The attempt COUNT excludes outcomes that were not the fellow's fault, so
      // an empty balance cannot silently exhaust somebody's three tries.
      //
      // GUARD — THE SEQUENCE COMES FROM THE SHARED ROW AND NEVER FROM A COUNT OF
      // LEDGER ROWS. It used to be (prior.length + 1) over an unsynchronised read
      // of fellow_payouts, and a count of rows the winner is concurrently writing
      // is not a lock: two workers that read at different moments compute
      // DIFFERENT sequences, both INSERTs satisfy the UNIQUE index, and both go
      // on to POST an order for the same conversion. The whole claim-before-send
      // design collapses into "we hope the vendor de-duplicates two simultaneous
      // POSTs of the same external_id", which is the one thing this file refuses
      // to rely on.
      //
      // payout_seq lives on the CONVERSION and is written in the SAME save that
      // sets status='paying'. So a worker that still sees `pending` necessarily
      // sees the pre-claim sequence too, computes the SAME key, and loses the
      // INSERT. Losing is the correct outcome and is not a fault.
      //
      // It is also monotonic and never rolled back, which is what stops it
      // saturating. The old count was fetched with LIMIT 40, so after 40 ledger
      // rows for one conversion the sequence stuck at 41 and every further claim
      // collided with itself forever — and the failure paths that write a row
      // WITHOUT consuming an attempt (402, 429) are unbounded, so 40 rows is
      // reachable by a conversion that has never been paid once.
      //
      // payout_attempts is now the only attempt counter. It moves in that same
      // atomic save, and it is the one a human can reset by pressing Approve; a
      // second count derived from ledger rows would quietly override them.
      let counted = Number(conv.get("payout_attempts")) || 0;
      if (counted >= MAX_ATTEMPTS) {
        return hold("Three payout attempts have failed. " + (conv.getString("review_reason") || "")
          .slice(0, 300));
      }
      // max() so a row migrated from before payout_seq existed, whose attempts
      // are already recorded, cannot re-issue a key the ledger is still holding.
      const seq = Math.max(Number(conv.get("payout_seq")) || 0, counted) + 1;
      const idem = key + "#" + seq;

      let prow = null;
      try {
        prow = new Record(app.findCollectionByNameOrId("fellow_payouts"));
        prow.set("conversion", conv.get("id"));
        prow.set("fellow", fellow.get("id"));
        prow.set("idempotency_key", idem);
        prow.set("attempt", counted + 1);
        prow.set("amount_usd", amount);
        prow.set("vendor", VENDOR);
        prow.set("state", "claimed");
        prow.set("age_band_at_payment", band);
        prow.set("delivery", "email");
        app.save(prow);
      } catch (_) {
        // The unique index rejected it: another worker owns this exact attempt.
        // A lost race is normal, not a fault, and is not logged as one. SEND
        // NOTHING.
        return { ok: false, state: "raced", message: "another worker already claimed this attempt" };
      }

      conv.set("status", "paying");
      conv.set("payout_claimed_at", nowISO());
      conv.set("payout_attempts", counted + 1);
      // THE SEQUENCE AND THE STATUS MOVE IN ONE WRITE. That is what makes the
      // pair atomic to every other worker: see `pending`, see the old sequence,
      // compute the same key, lose the INSERT.
      conv.set("payout_seq", seq);
      conv.set("payout_blocked_on", "");
      try { app.save(conv); }
      catch (_) {
        // Nothing has been sent, so the claim row is evidence of nothing. Drop it
        // if we can; otherwise strip its key and mark it skipped so it consumes
        // no attempt and the next sweep can claim.
        try { app.delete(prow); }
        catch (_) {
          // AND THE KEY MUST GO WITH IT. payout_seq was never persisted — the
          // save above is the one that just failed — so the next attempt computes
          // this very same sequence, and a surviving row still holding that key
          // would collide with itself forever and this conversion would never be
          // paid by anybody. The UNIQUE index is partial (WHERE idempotency_key
          // != '') precisely so an unkeyed row can sit here harmlessly.
          prow.set("idempotency_key", "");
          prow.set("state", "skipped");
          prow.set("error", ("claimed as " + idem + " but the conversion could not be moved; nothing "
            + "was sent and the key was released").slice(0, 2000));
          prow.set("finished_at", nowISO());
          try { app.save(prow); } catch (_) {}
        }
        return { ok: false, state: "pending", message: "couldn't take the claim; nothing was sent" };
      }

      // ---- ONLY NOW DOES ANYTHING LEAVE THE BUILDING ----
      const out = vendor("send", {
        key: key, amountUsd: amount, name: rName || fellowFirst, email: rEmail,
        adult: adult, method: method,
        note: toGuardian
          ? ("This is " + fellowFirst + "'s $" + amount + " from the Anticipy fellowship. Somebody bought "
             + "through their link. There is nothing to do except spend it.")
          : ("Somebody bought through your link. That's your $" + amount + ". Nothing to do except spend it."),
      });

      // EVIDENCE BEFORE DECISION, ALWAYS — the payout row first, because it is
      // what happened; the conversion second, because it is what we concluded.
      const fin = (state) => {
        prow.set("state", state);
        prow.set("http_status", Number(out.http) || 0);
        if (out.error) prow.set("error", String(out.error).slice(0, 2000));
        if (out.orderId) prow.set("vendor_order_id", out.orderId);
        if (out.rewardId) prow.set("vendor_reward_id", out.rewardId);
        if (out.product) prow.set("product_id", out.product);
        prow.set("finished_at", nowISO());
        try { app.save(prow); } catch (_) {}
      };
      const settlePaid = (replay) => {
        fin(replay ? "duplicate" : "sent");
        conv.set("status", "paid");
        conv.set("paid_at", nowISO());
        conv.set("payout_ref", out.orderId);
        conv.set("review_reason", "");
        try { app.save(conv); } catch (_) {}
        // GUARD — NOT A READ-MODIFY-WRITE ACROSS A 25-SECOND NETWORK CALL.
        // `lifetime` was read before the vendor call; writing lifetime + amount
        // here silently discards any payment that settled in between, and the
        // number it loses is the one the $600 tax-form gate is checked against —
        // so the gate opens for somebody it should have closed for. Recomputed
        // from the conversions already marked paid instead: it is derived from
        // committed facts, two settlements racing converge on the same total
        // rather than one overwriting the other, and a wrong stored value heals
        // itself on the next payment. This conversion is already saved as `paid`
        // above, so it is inside the sum.
        try {
          let total = 0, seen = 0;
          const paidRows = app.findRecordsByFilter("fellow_conversions",
            "fellow = {:f} && status = 'paid'", "-created", 500, 0, { f: fellow.get("id") });
          for (const pr of paidRows) { seen++; total += Number(pr.get("commission_usd")) || 0; }
          const f2 = app.findRecordById("fellows", fellow.get("id"));
          const had = Number(f2.get("lifetime_paid_usd")) || 0;
          // Never LOWER than what we already believed, and never a bare
          // recompute when the query returned nothing: a truncated or empty read
          // must not open a tax gate that a correct read had closed.
          f2.set("lifetime_paid_usd", seen > 0 ? Math.max(total, had) : had + amount);
          app.save(f2);
        } catch (_) {
          try { fellow.set("lifetime_paid_usd", lifetime + amount); app.save(fellow); } catch (_) {}
        }
        // Logged apart, so the true retry rate is visible rather than hidden
        // inside a single "paid" counter.
        logAct(replay ? "fellow.payout_replayed" : "fellow.payout_sent",
          "$" + amount + " to " + (toGuardian ? "a guardian for " : "") + fellowFirst
          + (replay ? ", the vendor already had this order, so nothing was charged twice" : ""),
          conv.get("id"));
        return { ok: true, state: "paid", replay: !!replay, message: replay
          ? "already existed at the vendor, marked paid, nothing was charged again"
          : "sent" };
      };
      const review = (why) => {
        conv.set("status", "needs_review");
        conv.set("review_reason", (why + " Search the vendor for external_id " + key
          + " BEFORE doing anything else: if an order exists, mark this paid; if not, release it.").slice(0, 500));
        try { app.save(conv); } catch (_) {}
        logAct("fellow.payout_needs_review", why + " (external_id " + key + ")", conv.get("id"));
        return { ok: false, state: "needs_review", message: why };
      };
      const release = (why, countsAsAttempt) => {
        fin(countsAsAttempt ? "failed" : "skipped");
        if (!countsAsAttempt) conv.set("payout_attempts", counted);
        if (countsAsAttempt && counted + 1 >= MAX_ATTEMPTS) {
          conv.set("status", "held");
          conv.set("review_reason", ("Three payout attempts failed. Last: " + why).slice(0, 500));
          try { app.save(conv); } catch (_) {}
          logAct("fellow.payout_gave_up", "Gave up after " + MAX_ATTEMPTS + " tries: " + why, conv.get("id"));
          return { ok: false, state: "held", message: why };
        }
        conv.set("status", "pending");
        conv.set("payout_claimed_at", "");
        conv.set("review_reason", String(why).slice(0, 500));
        try { app.save(conv); } catch (_) {}
        return { ok: false, state: "pending", message: why };
      };

      if (out.outcome === "sent")      return settlePaid(false);
      if (out.outcome === "duplicate") return settlePaid(true);

      if (out.outcome === "unfunded") {
        // A clean, terminal 402: nothing was created and no partial state exists.
        // It is ours to fix, so it costs no attempt and the fellow's screen keeps
        // showing the date they were promised.
        sayOnce("payout_fund", "fellow.payout_unfunded",
          "The payout balance is empty and at least one fellow is due. Top it up by ACH, never by card.");
        return release("The payout balance is empty. This is ours to fix and it will go out as soon "
          + "as it is topped up.", false);
      }
      if (out.outcome === "rate_limited") {
        return release("The vendor rate-limited us. Trying again on the next sweep.", false);
      }
      if (out.outcome === "no_send") {
        // Provably nothing was created, so a retry is safe — and it goes out with
        // the SAME external_id, so it is safe even if that proof were wrong.
        return release("The vendor refused the order (" + (Number(out.http) || 0) + "): "
          + (out.error || "no reason given") + ". Nothing was sent.", true);
      }
      if (out.outcome === "conflict") {
        fin("failed");
        return review("The vendor already has an order under this key with DIFFERENT details ("
          + (out.error || "no detail given") + "), which means two code paths disagree about what "
          + "this person is owed.");
      }
      if (out.outcome === "not_configured") {
        // Config was checked before the claim, so this only happens if the key
        // vanished mid-flight. Nothing was sent.
        return release("The payout rail was switched off mid-attempt. Nothing was sent.", false);
      }
      // unknown, and anything a future vendor branch adds. NEVER RETRIED.
      fin("unknown");
      return review("A payout attempt returned " + (Number(out.http) || 0) + " and we do not know "
        + "whether the money moved" + (out.error ? " (" + out.error + ")" : "") + ".");
    };

    // A stale claim means a worker died with the outcome unknown, which is
    // precisely the case that must not retry. This NEVER auto-releases.
    const backstop = () => {
      let stuck = [];
      try {
        stuck = app.findRecordsByFilter("fellow_conversions",
          "status = 'paying' && payout_claimed_at != ''", "+payout_claimed_at", 20, 0);
      } catch (_) { stuck = []; }
      let n = 0;
      for (const c of stuck) {
        const t = pbTime(c.getString("payout_claimed_at"));
        if (isNaN(t) || (Date.now() - t) < STALE_MS) continue;
        c.set("status", "needs_review");
        c.set("review_reason", ("A payout attempt started and never finished. Check the vendor for "
          + "external_id " + (c.getString("payout_key") || "(none minted)") + " BEFORE doing anything "
          + "else: if an order exists, mark this paid; if not, release it.").slice(0, 500));
        try { app.save(c); n++; } catch (_) { continue; }
        logAct("fellow.payout_stuck", "A payout attempt died mid-flight and needs a person: external_id "
          + (c.getString("payout_key") || "(none)"), c.get("id"));
      }
      return n;
    };

    // WAITING ROWS COME BACK — this is the way in. `waiting` is where a row goes
    // when it is blocked on somebody (an unconfirmed address, a guardian who has
    // not finished), and it is out of the due query on purpose so that a block
    // cannot starve the people behind it. Every sweep re-runs payOne's OWN
    // payability checks over parked rows in probe mode — no claim, no network, no
    // money — and any row whose block has cleared goes back to `pending` with its
    // original pay_after, so it keeps its place in the queue instead of going to
    // the back of it. Bounded per sweep, and ordered by payout_checked_at, so a
    // large parked backlog cannot starve the row at the back of THAT either.
    const wakeWaiting = (limit) => {
      let parked = [];
      try {
        parked = app.findRecordsByFilter("fellow_conversions", "status = 'waiting'",
          "+payout_checked_at", limit || 25, 0);
      } catch (_) { parked = []; }
      let woken = 0;
      for (const c of parked) {
        try {
          const r = payOne(c.get("id"), { probe: true });
          if (r && r.state === "ready") woken++;
        } catch (_) {}
      }
      return woken;
    };

    const dueRows = (limit) => {
      try {
        return app.findRecordsByFilter("fellow_conversions",
          "status = 'pending' && pay_after != '' && pay_after <= {:now}",
          "+pay_after", limit, 0, { now: nowISO() });
      } catch (_) { return []; }
    };

    return { VENDOR: VENDOR, VENDOR_SET: VENDOR_SET, vendor: vendor, payOne: payOne,
             backstop: backstop, wakeWaiting: wakeWaiting, dueRows: dueRows,
             logAct: logAct, sayOnce: sayOnce, nowISO: nowISO, pbTime: pbTime };
  };
  // ===== ENGINE:END ==========================================================

  const E = engine(e.app);
  const r = E.payOne(convId, { approve: body.approve === true, now: body.now === true });
  return e.json(200, {
    ok: !!r.ok,
    state: r.state,
    // Never the order id. HQ reads it off the conversion row, which is where the
    // audit trail lives; a route reply is not an audit trail.
    replay: !!r.replay,
    blocked_on: r.blocked || "",
    message: r.message || "",
  });
});

// --------------------------------------------------------------------------
// THE SWEEP.
//
// Hourly at :23 — off the top of the hour, where every other cron on earth
// fires. Not */5: money does not need five-minute latency, a stuck claim is
// still found inside the hour, and it is 24 vendor-facing windows a day instead
// of 288.
//
// Order matters and each step exists because of a specific way this goes wrong:
//
//   1. THE BACKSTOP FIRST. A dead worker leaves a row in `paying`. Left alone
//      it is invisible forever and the fellow simply never gets paid.
//   2. THE CONFIG PROBE. With no key this does NOTHING and says so once a day.
//      It does not claim, does not consume an attempt and does not raise an
//      alarm, because unset is a state, not a fault.
//   3. THE BALANCE, BEFORE THE LOOP. Without this, one empty account burns
//      three attempts on ten conversions and lands them all in `held` — a
//      self-inflicted outage manufactured entirely by our own retry logic. An
//      UNREADABLE balance is not treated as an empty one: it proceeds and lets
//      the 402 handler do its job, because a funding endpoint we cannot parse
//      must not stop everybody being paid forever.
//   4. THE WAKER, BEFORE THE DUE READ. Rows blocked on a fellow sit in
//      `waiting`, out of the due query, so they cannot starve the people behind
//      them; this is what puts one back the moment its block clears. It runs
//      payOne in probe mode, so it re-uses the real payability checks and cannot
//      itself send anything.
//   5. TEN ROWS, OLDEST FIRST, so nobody is starved and one bad day cannot fire
//      two hundred orders. `waiting` is what makes "oldest first" survivable: a
//      blocked row used to stay due forever and sort to the front of every
//      batch, so ten of them meant nobody was ever paid again.
//
// NOTE: cron handlers have no `e` — everything goes through $app.
// --------------------------------------------------------------------------
cronAdd("fellow_payout_sweep", "23 * * * *", () => {
  // ===== ENGINE:BEGIN ========================================================
  // DUPLICATED VERBATIM IN THE OTHER HANDLER, down to ENGINE:END. Not laziness:
  // a const at file top-level is NOT visible inside a routerAdd or cronAdd
  // callback in this runtime, and the failure mode is a 500 on the one route
  // that moves money. test_fellowship_payouts.mjs extracts both copies and
  // asserts they are byte-identical, so they cannot drift. The reasoning behind
  // what this does lives in the file header, once.
  const engine = (app) => {
    // Until ANTICIPY_PAYOUT_VENDOR is explicitly set, the rail pays 18+ and
    // refuses anyone younger. Tremendous's ToS is SILENT on recipient age, and
    // silence is not permission — this makes that a runtime fact, not a promise.
    const VENDOR_SET   = ($os.getenv("ANTICIPY_PAYOUT_VENDOR") || "").trim().toLowerCase();
    const VENDOR       = VENDOR_SET || "tremendous";
    const AMOUNT_MAX   = parseFloat($os.getenv("ANTICIPY_FELLOW_PAYOUT_MAX_USD") || "30") || 30;
    const TAX_FORM_USD = parseFloat($os.getenv("ANTICIPY_FELLOW_TAX_FORM_USD") || "600") || 600;
    const MAX_ATTEMPTS = 3;
    const STALE_MS     = 15 * 60 * 1000;

    const nowISO = () => new Date().toISOString();

    // The naive version — replace(" ","T") + "Z" — yields "...880ZZ" on 0.30.4's
    // own autodates: Invalid Date, then NaN, then a guard that never fires. That
    // bug once pinned a research slot forever. Here it would mean every crashed
    // attempt sits in `paying` invisibly and nobody is ever paid again.
    const pbTime = (v) => {
      if (!v) return NaN;
      let t = String(v).trim().replace(" ", "T");
      if (!/([Zz]|[+-]\d{2}:?\d{2})$/.test(t)) t += "Z";
      return new Date(t).getTime();
    };

    const logAct = (action, subject, ref) => {
      try {
        const a = new Record(app.findCollectionByNameOrId("internal_activity"));
        a.set("actor", ""); a.set("actor_name", "Fellowships");
        a.set("action", action);
        a.set("subject", String(subject).slice(0, 400));
        if (ref) a.set("ref", ref);
        app.save(a);
      } catch (_) {}
    };

    // At most once a day. Same two-field meter as "email" and "llm", but `hour`
    // holds a DAY: an empty balance does not need twenty-four identical rows in
    // the activity feed before somebody sees it.
    const sayOnce = (meterName, action, subject) => {
      const day = nowISO().slice(0, 10);
      let m = null;
      try { m = app.findFirstRecordByFilter("fellow_meter", "name = {:n}", { n: meterName }); } catch (_) {}
      if (!m) {
        try {
          m = new Record(app.findCollectionByNameOrId("fellow_meter"));
          m.set("name", meterName); m.set("hour", ""); m.set("calls", 0);
          app.save(m);
        } catch (_) { return false; }
      }
      if (m.getString("hour") === day) return false;
      m.set("hour", day); m.set("calls", (Number(m.get("calls")) || 0) + 1);
      try { app.save(m); } catch (_) {}
      logAct(action, subject, "");
      return true;
    };

    // THE VENDOR. ONE FUNCTION. Everything vendor-specific is between here and
    // the end of it: base URLs, auth, body shape, product ids, and the map from
    // their HTTP codes to an outcome word. Nothing outside reads vendor JSON or
    // branches on a vendor status code, so Tango Card is a second branch HERE and
    // no change anywhere else. Outcome words and the 200-is-new / 201-is-replay
    // inversion are set out in the file header.
    const vendor = (op, args) => {
      const a = args || {};
      const key  = $os.getenv("TREMENDOUS_API_KEY") || "";
      // SANDBOX UNLESS SOMEBODY SAYS PRODUCTION OUT LOUD, so a wrong deploy costs
      // zero dollars: the sandbox host shares no data with production and its
      // balance is fake.
      const prod = String($os.getenv("TREMENDOUS_ENV") || "").trim().toLowerCase() === "production";
      const base = prod ? "https://api.tremendous.com/api/v2"
                        : "https://testflight.tremendous.com/api/v2";
      const H = {
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
        "Accept": "application/json",
        // Ignored today — external_id in the body is Tremendous's whole
        // idempotency mechanism — but free, and already right on the day a vendor
        // honours a header instead.
        "Idempotency-Key": String(a.key || ""),
      };

      // The one place a third party could hand our own credential back and we
      // would write it into a row a human reads.
      const scrub = (v) => {
        let t = "";
        try { t = String(v == null ? "" : v); } catch (_) { t = ""; }
        t = t.slice(0, 2000);
        if (key) t = t.split(key).join("[key]");
        return t.replace(/(?:Bearer\s+)?[A-Za-z0-9_\-]{24,}/g, "[redacted]");
      };

      // Live returns {"errors":{...}} — plural. Their own rate-limiting page
      // prints {"error":{...}} — singular. A parser that assumes one shape throws
      // INSIDE the error handler, turning a clean 429 into a resend. Read both,
      // and never let parsing throw. res.raw is never read wholesale.
      const msgOf = (res) => {
        let m = "";
        try { m = String(res.json.errors.message || ""); } catch (_) {}
        if (!m) { try { m = String(res.json.error.message || ""); } catch (_) {} }
        if (!m) { try { m = String(res.json.message || ""); } catch (_) {} }
        return scrub(m);
      };

      if (op === "config") {
        // NOT CONFIGURED AND BROKEN ARE DIFFERENT ANSWERS. No key is a state:
        // nothing sends, nothing is claimed, no attempt is consumed, no alarm.
        // A key that contradicts the environment is a fault, and says so.
        if (!key) return { configured: false, ok: false, reason: "not_configured", env: prod ? "production" : "sandbox", error: "" };
        if (prod && key.indexOf("TEST_") === 0) {
          return { configured: true, ok: false, reason: "misconfigured", env: "production",
                   error: "TREMENDOUS_ENV is production but the key is a sandbox key" };
        }
        if (!prod && key.indexOf("PROD_") === 0) {
          return { configured: true, ok: false, reason: "misconfigured", env: "sandbox",
                   error: "the key is a production key but TREMENDOUS_ENV is not production" };
        }
        return { configured: true, ok: true, reason: "", env: prod ? "production" : "sandbox", error: "" };
      }

      if (op === "balance") {
        // Preflight, so an empty balance is caught by us and not by a 402 that has
        // already burned an attempt on ten conversions. cents === -1 means
        // UNREADABLE, deliberately not the same as EMPTY: an endpoint we cannot
        // parse must not stop everybody being paid forever.
        if (!key) return { configured: false, ok: false, cents: -1, http: 0, error: "" };
        try {
          const res = $http.send({ url: base + "/funding_sources", method: "GET", headers: H, timeout: 15 });
          if (res.statusCode !== 200) {
            return { configured: true, ok: false, cents: -1, http: res.statusCode, error: msgOf(res) };
          }
          let cents = -1;
          try {
            const list = res.json.funding_sources || [];
            for (const f of list) {
              if (String(f.method) !== "balance") continue;
              if (String(f.status) !== "active") continue;
              let apiOK = false;
              try { for (const p of (f.usage_permissions || [])) if (String(p) === "api_orders") apiOK = true; } catch (_) {}
              if (!apiOK) continue;
              const c = Number(f.meta.available_cents);
              if (!isNaN(c)) cents = c;
            }
          } catch (_) { cents = -1; }
          return { configured: true, ok: cents >= 0, cents: cents, http: 200, error: "" };
        } catch (err) {
          return { configured: true, ok: false, cents: -1, http: 0, error: scrub(err) };
        }
      }

      // ---- op === "send" ----
      if (!key) return { outcome: "not_configured", http: 0, error: "", orderId: "", rewardId: "", product: "" };

      // UNDER 18 IS STORED VALUE ONLY, AND THIS IS THE SECOND OF THE TWO SERVER-
      // SIDE ENFORCEMENTS. /fellows/payout-method already refused cash_like for a
      // minor; this is the gate where the money actually leaves, so a hand-edited
      // row, a restored backup or a future second caller cannot route a fifteen-
      // year-old at a money account. A single-element products array is what makes
      // it real: it overrides whatever catalogue a campaign offers.
      //
      // Q24BD9EZ332JT is "Virtual Visa" — USD, unrestricted, 215 countries
      // including the US and Canada. NOT V4QZ00F554D3 "Prepaid Virtual Visa",
      // whose better-matching name is a trap: every catalogue row for it reads
      // "Limited to specific use cases only", so it passes in sandbox and fails in
      // production.
      const STORED = $os.getenv("TREMENDOUS_PRODUCT_STORED_VALUE") || "Q24BD9EZ332JT";
      const CASH   = $os.getenv("TREMENDOUS_PRODUCT_CASH_LIKE") || "";
      const product = (a.adult === true && a.method === "cash_like" && CASH) ? CASH : STORED;

      const reward = {
        value: { denomination: a.amountUsd, currency_code: "USD" },
        products: [product],
        recipient: { name: String(a.name || "").slice(0, 120), email: String(a.email || "") },
        // EMAIL, never LINK: an unsent link holds real value we would forfeit, and
        // a link is a bearer token to cash that must never touch a log line.
        delivery: {
          method: "EMAIL",
          meta: {
            sender_name: "Anticipy Fellowships",
            subject_line: "Your $" + a.amountUsd + " from the Anticipy fellowship",
            message: String(a.note || "").slice(0, 400),
          },
        },
      };
      // The campaign supplies look and copy only; the products array still decides
      // what the recipient may choose, which is what keeps a minor on stored value
      // even if somebody widens the campaign later.
      const campaign = $os.getenv("TREMENDOUS_CAMPAIGN_ID") || "";
      if (campaign) reward.campaign_id = campaign;

      const payload = {
        external_id: a.key,     // the idempotency key. Persisted before this call.
        payment: { funding_source_id: $os.getenv("TREMENDOUS_FUNDING_SOURCE_ID") || "BALANCE" },
        reward: reward,
      };

      const idOf = (res) => {
        const out = { orderId: "", rewardId: "", total: NaN, status: "" };
        try { out.orderId = String(res.json.order.id || ""); } catch (_) {}
        try { out.rewardId = String(res.json.order.rewards[0].id || ""); } catch (_) {}
        try { out.total = Number(res.json.order.payment.total); } catch (_) {}
        try { out.status = String(res.json.order.status || ""); } catch (_) {}
        return out;
      };

      // The only correct move after a timeout or a 5xx: ask whether the order
      // landed, keyed by OUR external_id. A GET cannot spend money, so it is
      // free to try, and it is what stops an unclear response from stranding a
      // real person's $30 behind a human.
      //
      // GUARD — THIS IS A QUERY, NOT A PATH SEGMENT, AND THE DIFFERENCE IS THE
      // WHOLE FUNCTION. /orders/<id> takes TREMENDOUS'S OWN order id — the
      // "ORD..." value idOf() reads back — and never ours. Asking it for
      // fc-<conversion> is asking for an id that has never existed there, so
      // every reconcile answered "not 200, not 404" and returned null, and EVERY
      // unclear outcome fell through to needs_review: a fellow whose $30 had in
      // fact gone out sat behind a human forever, which is the exact failure
      // this function was written to prevent. GET /orders?external_id=<ours> is
      // the only lookup on this API that speaks our key.
      const reconcile = () => {
        try {
          const r2 = $http.send({ url: base + "/orders?external_id=" + encodeURIComponent(String(a.key)),
                                  method: "GET", headers: H, timeout: 15 });
          if (r2.statusCode === 200) {
            // The list form answers {"orders":[...]}; the first element is the
            // order for this external_id, because the key is unique to it.
            let list = null;
            try { list = r2.json.orders; } catch (_) { list = null; }
            if (list) {
              let n = 0, first = null;
              try { for (const o of list) { n++; if (n === 1) first = o; } } catch (_) { n = -1; first = null; }
              if (n > 0 && first) {
                let oid = "", rid = "";
                try { oid = String(first.id || ""); } catch (_) {}
                try { rid = String(first.rewards[0].id || ""); } catch (_) {}
                if (oid) {
                  return { outcome: "duplicate", http: 200, orderId: oid, rewardId: rid,
                           product: product, error: "reconciled after an unclear response: the order exists" };
                }
                // An order we cannot name is an order we cannot prove anything
                // about. Fall through to unknown rather than guess.
                return null;
              }
              if (n === 0) {
                // An EMPTY list under our own key is the only proof of a no-send
                // this vendor offers. It releases the claim for a retry that goes
                // out under the SAME external_id, so it stays safe even if the
                // proof were wrong.
                return { outcome: "no_send", http: 200, orderId: "", rewardId: "", product: product,
                         error: "reconciled after an unclear response: no order exists under this key" };
              }
            }
          }
          // Anything else is NOT an answer. A 404 on the list route means the
          // route is wrong, not that the order is absent, and reading it as a
          // no-send is how a paid conversion gets sent a second time.
        } catch (_) {}
        return null;
      };

      let res = null;
      try {
        res = $http.send({ url: base + "/orders", method: "POST", headers: H,
                           body: JSON.stringify(payload), timeout: 25 });
      } catch (err) {
        // The connection dropped. We do not get to decide from the exception
        // whether the order committed — that is exactly the case where the
        // teenager has the money and our row says unpaid.
        const rec = reconcile();
        if (rec) return rec;
        return { outcome: "unknown", http: 0, orderId: "", rewardId: "", product: product, error: scrub(err) };
      }

      const code = Number(res.statusCode) || 0;
      const got = idOf(res);

      if (code === 200 || code === 201) {
        if (!got.orderId) {
          // An order we cannot reference is an order we can never reconcile.
          const rec = reconcile();
          if (rec) return rec;
          return { outcome: "unknown", http: code, orderId: "", rewardId: "", product: product,
                   error: "the vendor returned " + code + " with no order id" };
        }
        // Assert the money at runtime rather than trusting the price list: a
        // denomination that crossed a SKU band, an org currency change, or a fee
        // we did not expect all show up here.
        if (!isNaN(got.total) && Math.abs(got.total - Number(a.amountUsd)) > 0.005) {
          return { outcome: "conflict", http: code, orderId: got.orderId, rewardId: got.rewardId, product: product,
                   error: "the vendor charged " + got.total + " for a $" + a.amountUsd + " reward" };
        }
        return { outcome: code === 200 ? "sent" : "duplicate", http: code,
                 orderId: got.orderId, rewardId: got.rewardId, product: product, error: "" };
      }
      if (code === 402) return { outcome: "unfunded", http: 402, orderId: "", rewardId: "", product: product, error: msgOf(res) };
      if (code === 409) return { outcome: "conflict", http: 409, orderId: "", rewardId: "", product: product, error: msgOf(res) };
      if (code === 429) return { outcome: "rate_limited", http: 429, orderId: "", rewardId: "", product: product, error: msgOf(res) };
      if (code === 400 || code === 401 || code === 403 || code === 404 || code === 422) {
        return { outcome: "no_send", http: code, orderId: "", rewardId: "", product: product, error: msgOf(res) };
      }
      // 5xx and anything unlisted. The default is NEVER "retry".
      const rec = reconcile();
      if (rec) return rec;
      return { outcome: "unknown", http: code, orderId: "", rewardId: "", product: product, error: msgOf(res) };
    };

    // PAY ONE CONVERSION. The three-part guard that makes double-paying
    // impossible — the never-regenerated external_id, the INSERT-under-UNIQUE
    // claim taken before the network call, and the rule that an unknown outcome
    // is never retried — is set out in full in the file header.
    const payOne = (convId, opts) => {
      const o = opts || {};

      let conv = null;
      try { conv = app.findRecordById("fellow_conversions", String(convId)); } catch (_) {}
      if (!conv) return { ok: false, state: "missing", message: "no such conversion" };

      const hold = (reason) => {
        conv.set("status", "held");
        conv.set("review_reason", String(reason).slice(0, 500));
        try { app.save(conv); } catch (_) {}
        logAct("fellow.payout_held", String(reason).slice(0, 300), conv.get("id"));
        return { ok: false, state: "held", message: String(reason) };
      };
      // Waiting on the fellow, or on us. Costs no attempt, raises no flag, and
      // resolves itself the moment the missing thing arrives. Conflating this with
      // `held` is how somebody waits four months for $30 that was never coming.
      //
      // GUARD — A BLOCKED ROW MUST LEAVE THE PAY LANE. This used to leave the row
      // at `pending` with pay_after untouched, so it stayed DUE FOREVER and, because
      // dueRows sorts oldest-first, it sorted to the FRONT of every sweep for the
      // rest of time. Ten fellows who had not finished a setup step permanently
      // occupied all ten slots and NOBODY BEHIND THEM WAS EVER PAID — silently,
      // with every surface reporting normal. `waiting` is a status the due query
      // does not match, so a block now costs its own row and nobody else's.
      //
      // HOW A ROW GETS BACK IN: wakeWaiting() below re-runs these very checks over
      // parked rows every sweep and returns any whose block has cleared to
      // `pending`. pay_after is never moved, so a row that waited keeps its place
      // in the queue rather than going to the back of it.
      const wait = (why, blocked) => {
        conv.set("status", "waiting");
        conv.set("review_reason", why);
        conv.set("payout_blocked_on", String(blocked || ""));
        // Stamped on EVERY check, so wakeWaiting can round-robin by it: without a
        // moving timestamp the oldest parked rows would be re-checked forever and
        // the rows behind them never would.
        conv.set("payout_checked_at", nowISO());
        try { app.save(conv); } catch (_) {}
        return { ok: false, state: "waiting", blocked: blocked, message: why };
      };

      // A human pressing Approve is the ONE human gate this design keeps: one
      // click per fellow, once, for the life of the programme.
      //
      // GUARD — needs_review IS RELEASABLE TOO. Approve used to be accepted on
      // `held` alone, so a row parked by an unknown vendor outcome had NO way out
      // anywhere in the system: the sweep never touches needs_review by design,
      // and the one human override silently ignored it. That is a real fellow's
      // $30 stuck forever. Releasing it is safe for exactly the reason this rail
      // exists — the retry goes out under the SAME never-regenerated external_id,
      // so if the vendor already has that order it answers 201 and nothing is
      // charged twice.
      const releasable = { held: true, needs_review: true };
      if (o.approve === true && releasable[conv.getString("status")] === true) {
        const wasStatus = conv.getString("status");
        conv.set("status", "pending");
        conv.set("review_reason", "");
        conv.set("payout_blocked_on", "");
        // A person deciding outranks the three-strike ceiling. Without this the
        // release is theatre: a row that already spent its attempts is re-held by
        // the ceiling check a few lines below, and the human presses Approve
        // forever. It cannot become a spend loop — every attempt carries the same
        // external_id, and MAX_ATTEMPTS still bounds what follows the release.
        conv.set("payout_attempts", 0);
        try { app.save(conv); }
        catch (_) { return { ok: false, state: wasStatus, message: "couldn't release that" }; }
        logAct(wasStatus === "needs_review" ? "fellow.payout_review_released" : "fellow.payout_released",
          "A person released a " + wasStatus + " conversion for payment", conv.get("id"));
      }

      const status = conv.getString("status");
      if (status === "paid") {
        return { ok: true, state: "paid", already: true, message: "already paid, nothing was sent" };
      }
      if (status === "paying")  return { ok: false, state: "paying", message: "an attempt is already in flight" };
      if (status === "void")    return { ok: false, state: "void", message: "this conversion will never pay" };
      if (status === "needs_review") {
        return { ok: false, state: "needs_review",
                 message: conv.getString("review_reason") || "a person has to settle this one by hand" };
      }
      if (status === "held") {
        return { ok: false, state: "held", message: conv.getString("review_reason") || "held for a person to look at" };
      }
      // `waiting` is IN the lane, merely parked: it is this rail's own word for
      // "blocked on somebody", and re-entering it is the entire point of it. Any
      // OTHER unrecognised status is still held rather than guessed at.
      if (status !== "pending" && status !== "waiting") {
        return hold("This row's status was " + JSON.stringify(status) + ", which the payout rail does "
          + "not understand. It was held rather than guessed at.");
      }

      // The clock. Only a person may bypass it; the sweep never does.
      const pa = pbTime(conv.getString("pay_after"));
      if (o.now !== true) {
        if (isNaN(pa)) {
          return hold("This conversion has no usable pay-after date, so the 30-day clock cannot be "
            + "checked. Set one, then release it.");
        }
        if (Date.now() < pa) {
          return { ok: false, state: "pending", message: "not due until " + conv.getString("pay_after") };
        }
      }

      // Checked BEFORE the claim, so an unset key never consumes an attempt and
      // never leaves a claim row behind. Nothing sent, nothing written, and the
      // answer is a status rather than a crash.
      const cfg = vendor("config", {});
      if (!cfg.configured) {
        return { ok: false, state: "pending", blocked: "not_configured",
                 message: "payouts are not switched on yet, so nothing was sent" };
      }
      if (!cfg.ok) {
        sayOnce("payout_cfg", "fellow.payout_misconfigured",
          "The payout rail is configured wrongly and nothing can send: " + cfg.error);
        return { ok: false, state: "pending", blocked: "misconfigured", message: cfg.error };
      }

      // ---- payability, checked NOW and not at conversion time ----
      let fellow = null;
      try { fellow = app.findRecordById("fellows", conv.getString("fellow")); } catch (_) {}
      if (!fellow) {
        return hold("The fellow row this conversion points at is gone. Nothing can be paid until "
          + "somebody works out who is owed it.");
      }
      if (fellow.getString("status") === "removed") {
        return hold("This fellow was removed. Under the never-clawed-back rule they may still be "
          + "owed this; that is a decision for a person, not a cron.");
      }
      if (conv.getString("code") && conv.getString("code") !== fellow.getString("referral_code")) {
        return hold("The referral code on this sale is not the fellow's current code, so the credit "
          + "is ambiguous. Check it before paying.");
      }

      // The band is recomputed HERE, at payment time: a fellow who turns 18
      // between the sale and the payment must not have their card sent to a
      // guardian. The band we actually used is copied onto the payout row and
      // never recomputed there, or the audit trail rewrites itself on a birthday.
      let band = fellow.getString("age_band") || "";
      const bm = Number(fellow.get("birth_month")), by = Number(fellow.get("birth_year"));
      if (bm && by) {
        const d = new Date();
        let age = d.getUTCFullYear() - by;
        if (d.getUTCMonth() + 1 < bm) age -= 1;
        band = age >= 18 ? "18_plus" : (age >= 16 ? "16_17" : "13_15");
      }
      const adult = band === "18_plus";

      if (!fellow.getString("email_confirmed_at")) {
        return wait("We're waiting on them to confirm their email address.", "email");
      }
      if (!adult && fellow.getString("parental_consent") !== "confirmed") {
        return wait("We're waiting on a parent or guardian to finish the payout step.", "guardian");
      }
      // GUARD — EMPTY IS CARD, NOT A BLOCKER. Nothing in the entire codebase ever
      // wrote payout_method except POST /fellows/payout-method, a route a fellow
      // has to go and find, and this used to refuse to send while it was empty —
      // so every fellow who never found it was unpayable FOREVER, and (before
      // `waiting` existed) blocked everyone behind them too. Card is the default,
      // the only legal value under 18, and what the decision doc promises, so an
      // unset field is that answer rather than a question. It is also defaulted at
      // signup and at guardian consent; this is the fail-closed half that covers
      // every row written before either of those existed.
      const method = (fellow.getString("payout_method") || "").trim() || "card";

      // GUARD — NEVER SUBSTITUTE A CARD FOR A TRANSFER IN SILENCE. vendor() falls
      // back to the stored-value product when TREMENDOUS_PRODUCT_CASH_LIKE is
      // unset, so an adult who chose a transfer and was told "Done" would receive
      // a prepaid card thirty days later and nothing anywhere would say why. The
      // choose route now refuses cash_like while it is unconfigured; this catches
      // the row that chose it back when it WAS configured. It holds rather than
      // sends, because a card sent instead of a transfer cannot be taken back and
      // a hold can be cleared in a minute.
      if (adult && method === "cash_like" && !($os.getenv("TREMENDOUS_PRODUCT_CASH_LIKE") || "").trim()) {
        return hold("This fellow chose a transfer, but no cash-like product is configured "
          + "(TREMENDOUS_PRODUCT_CASH_LIKE is unset), so the only thing this rail could send them is a "
          + "card they did not ask for. Configure it, or set them back to card and tell them. Do not "
          + "just send the card.");
      }
      // ENFORCEMENT ONE OF THE TWO ON THE SEND SIDE. The second is inside
      // vendor(), which hands a minor the stored-value product whatever this field
      // says — the same belt-and-braces sms_opt_in gets, for the same reason.
      if (!adult && method === "cash_like") {
        return hold("This fellow is under 18 and their payout method is set to a cash-like rail. "
          + "That cannot be paid: a minor cannot hold a money account. Set them back to card.");
      }
      if (!adult && !VENDOR_SET) {
        return wait("We're waiting on the vendor's written answer about paying recipients under 18 "
          + "before any under-18 payment goes out.", "vendor_age");
      }
      if (!fellow.get("code_active")) {
        return hold("Everything else about this payment is ready but the fellow's code is switched "
          + "off, which means a person turned it off. Decide before paying.");
      }

      const amount = Number(conv.get("commission_usd")) || 0;
      if (!(amount >= 1 && amount <= AMOUNT_MAX)) {
        return hold("This conversion is set to $" + amount + ", which is outside the $1-$" + AMOUNT_MAX
          + " band. A typo must never be able to wire somebody thousands of dollars.");
      }

      // Checked BEFORE the payment that would cross the line, never after: the
      // paperwork has to be collected from somebody who is under no obligation to
      // answer once they already have the money.
      const lifetime = Number(fellow.get("lifetime_paid_usd")) || 0;
      if (lifetime + amount > TAX_FORM_USD) {
        return hold("Paying this would take them past $" + TAX_FORM_USD + " lifetime. Collect the tax "
          + "form first, then release. Do not hold anything they are already owed longer than that takes.");
      }

      // The recipient is resolved at PAYMENT time too. For 13-17 the guardian is
      // the payee of record — they accepted in their own name, which is the only
      // part of the arrangement that is enforceable, a minor's own agreement being
      // voidable at the minor's option.
      const toGuardian = !adult;
      const rName = String((toGuardian ? fellow.getString("guardian_name") : fellow.getString("name")) || "").trim();
      const rEmail = String((toGuardian ? fellow.getString("guardian_email") : fellow.getString("email")) || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(rEmail)) {
        return hold("There is no usable address to send " + (toGuardian ? "the guardian's" : "their")
          + " card to. Confirm it out of band. A bounce is the one failure the vendor will not tell "
          + "us about at the time.");
      }
      const fellowFirst = String(fellow.getString("name") || "").trim().split(/\s+/)[0]
        || String(fellow.getString("email") || "").split("@")[0];

      // ---- THE PROBE STOPS HERE ----
      // Everything above this line is the payability predicate; everything below
      // it spends money. wakeWaiting() runs the predicate and nothing else, so a
      // parked row is re-tested every sweep for free and returns to the lane the
      // instant its block clears — ONE predicate, not a second copy in the waker
      // that drifts out of step with this one and pays somebody it should not.
      if (o.probe === true) {
        if (conv.getString("status") !== "pending") {
          conv.set("status", "pending");
          conv.set("review_reason", "");
          conv.set("payout_blocked_on", "");
          conv.set("payout_checked_at", nowISO());
          try { app.save(conv); }
          catch (_) { return { ok: false, state: "waiting", message: "couldn't return it to the pay lane" }; }
          logAct("fellow.payout_unblocked", "A parked payout came unblocked and is back in the pay lane",
            conv.get("id"));
        }
        return { ok: true, state: "ready", message: "nothing is blocking this one" };
      }

      // ---- the key, persisted BEFORE anything leaves ----
      let key = conv.getString("payout_key");
      if (!key) {
        key = "fc-" + conv.get("id");
        conv.set("payout_key", key);
        try { app.save(conv); }
        catch (_) {
          return { ok: false, state: "pending",
                   message: "couldn't persist the idempotency key, so nothing was sent" };
        }
      }

      // ---- the claim ----
      // The sequence never repeats, so a second attempt can be recorded at all.
      // The attempt COUNT excludes outcomes that were not the fellow's fault, so
      // an empty balance cannot silently exhaust somebody's three tries.
      //
      // GUARD — THE SEQUENCE COMES FROM THE SHARED ROW AND NEVER FROM A COUNT OF
      // LEDGER ROWS. It used to be (prior.length + 1) over an unsynchronised read
      // of fellow_payouts, and a count of rows the winner is concurrently writing
      // is not a lock: two workers that read at different moments compute
      // DIFFERENT sequences, both INSERTs satisfy the UNIQUE index, and both go
      // on to POST an order for the same conversion. The whole claim-before-send
      // design collapses into "we hope the vendor de-duplicates two simultaneous
      // POSTs of the same external_id", which is the one thing this file refuses
      // to rely on.
      //
      // payout_seq lives on the CONVERSION and is written in the SAME save that
      // sets status='paying'. So a worker that still sees `pending` necessarily
      // sees the pre-claim sequence too, computes the SAME key, and loses the
      // INSERT. Losing is the correct outcome and is not a fault.
      //
      // It is also monotonic and never rolled back, which is what stops it
      // saturating. The old count was fetched with LIMIT 40, so after 40 ledger
      // rows for one conversion the sequence stuck at 41 and every further claim
      // collided with itself forever — and the failure paths that write a row
      // WITHOUT consuming an attempt (402, 429) are unbounded, so 40 rows is
      // reachable by a conversion that has never been paid once.
      //
      // payout_attempts is now the only attempt counter. It moves in that same
      // atomic save, and it is the one a human can reset by pressing Approve; a
      // second count derived from ledger rows would quietly override them.
      let counted = Number(conv.get("payout_attempts")) || 0;
      if (counted >= MAX_ATTEMPTS) {
        return hold("Three payout attempts have failed. " + (conv.getString("review_reason") || "")
          .slice(0, 300));
      }
      // max() so a row migrated from before payout_seq existed, whose attempts
      // are already recorded, cannot re-issue a key the ledger is still holding.
      const seq = Math.max(Number(conv.get("payout_seq")) || 0, counted) + 1;
      const idem = key + "#" + seq;

      let prow = null;
      try {
        prow = new Record(app.findCollectionByNameOrId("fellow_payouts"));
        prow.set("conversion", conv.get("id"));
        prow.set("fellow", fellow.get("id"));
        prow.set("idempotency_key", idem);
        prow.set("attempt", counted + 1);
        prow.set("amount_usd", amount);
        prow.set("vendor", VENDOR);
        prow.set("state", "claimed");
        prow.set("age_band_at_payment", band);
        prow.set("delivery", "email");
        app.save(prow);
      } catch (_) {
        // The unique index rejected it: another worker owns this exact attempt.
        // A lost race is normal, not a fault, and is not logged as one. SEND
        // NOTHING.
        return { ok: false, state: "raced", message: "another worker already claimed this attempt" };
      }

      conv.set("status", "paying");
      conv.set("payout_claimed_at", nowISO());
      conv.set("payout_attempts", counted + 1);
      // THE SEQUENCE AND THE STATUS MOVE IN ONE WRITE. That is what makes the
      // pair atomic to every other worker: see `pending`, see the old sequence,
      // compute the same key, lose the INSERT.
      conv.set("payout_seq", seq);
      conv.set("payout_blocked_on", "");
      try { app.save(conv); }
      catch (_) {
        // Nothing has been sent, so the claim row is evidence of nothing. Drop it
        // if we can; otherwise strip its key and mark it skipped so it consumes
        // no attempt and the next sweep can claim.
        try { app.delete(prow); }
        catch (_) {
          // AND THE KEY MUST GO WITH IT. payout_seq was never persisted — the
          // save above is the one that just failed — so the next attempt computes
          // this very same sequence, and a surviving row still holding that key
          // would collide with itself forever and this conversion would never be
          // paid by anybody. The UNIQUE index is partial (WHERE idempotency_key
          // != '') precisely so an unkeyed row can sit here harmlessly.
          prow.set("idempotency_key", "");
          prow.set("state", "skipped");
          prow.set("error", ("claimed as " + idem + " but the conversion could not be moved; nothing "
            + "was sent and the key was released").slice(0, 2000));
          prow.set("finished_at", nowISO());
          try { app.save(prow); } catch (_) {}
        }
        return { ok: false, state: "pending", message: "couldn't take the claim; nothing was sent" };
      }

      // ---- ONLY NOW DOES ANYTHING LEAVE THE BUILDING ----
      const out = vendor("send", {
        key: key, amountUsd: amount, name: rName || fellowFirst, email: rEmail,
        adult: adult, method: method,
        note: toGuardian
          ? ("This is " + fellowFirst + "'s $" + amount + " from the Anticipy fellowship. Somebody bought "
             + "through their link. There is nothing to do except spend it.")
          : ("Somebody bought through your link. That's your $" + amount + ". Nothing to do except spend it."),
      });

      // EVIDENCE BEFORE DECISION, ALWAYS — the payout row first, because it is
      // what happened; the conversion second, because it is what we concluded.
      const fin = (state) => {
        prow.set("state", state);
        prow.set("http_status", Number(out.http) || 0);
        if (out.error) prow.set("error", String(out.error).slice(0, 2000));
        if (out.orderId) prow.set("vendor_order_id", out.orderId);
        if (out.rewardId) prow.set("vendor_reward_id", out.rewardId);
        if (out.product) prow.set("product_id", out.product);
        prow.set("finished_at", nowISO());
        try { app.save(prow); } catch (_) {}
      };
      const settlePaid = (replay) => {
        fin(replay ? "duplicate" : "sent");
        conv.set("status", "paid");
        conv.set("paid_at", nowISO());
        conv.set("payout_ref", out.orderId);
        conv.set("review_reason", "");
        try { app.save(conv); } catch (_) {}
        // GUARD — NOT A READ-MODIFY-WRITE ACROSS A 25-SECOND NETWORK CALL.
        // `lifetime` was read before the vendor call; writing lifetime + amount
        // here silently discards any payment that settled in between, and the
        // number it loses is the one the $600 tax-form gate is checked against —
        // so the gate opens for somebody it should have closed for. Recomputed
        // from the conversions already marked paid instead: it is derived from
        // committed facts, two settlements racing converge on the same total
        // rather than one overwriting the other, and a wrong stored value heals
        // itself on the next payment. This conversion is already saved as `paid`
        // above, so it is inside the sum.
        try {
          let total = 0, seen = 0;
          const paidRows = app.findRecordsByFilter("fellow_conversions",
            "fellow = {:f} && status = 'paid'", "-created", 500, 0, { f: fellow.get("id") });
          for (const pr of paidRows) { seen++; total += Number(pr.get("commission_usd")) || 0; }
          const f2 = app.findRecordById("fellows", fellow.get("id"));
          const had = Number(f2.get("lifetime_paid_usd")) || 0;
          // Never LOWER than what we already believed, and never a bare
          // recompute when the query returned nothing: a truncated or empty read
          // must not open a tax gate that a correct read had closed.
          f2.set("lifetime_paid_usd", seen > 0 ? Math.max(total, had) : had + amount);
          app.save(f2);
        } catch (_) {
          try { fellow.set("lifetime_paid_usd", lifetime + amount); app.save(fellow); } catch (_) {}
        }
        // Logged apart, so the true retry rate is visible rather than hidden
        // inside a single "paid" counter.
        logAct(replay ? "fellow.payout_replayed" : "fellow.payout_sent",
          "$" + amount + " to " + (toGuardian ? "a guardian for " : "") + fellowFirst
          + (replay ? ", the vendor already had this order, so nothing was charged twice" : ""),
          conv.get("id"));
        return { ok: true, state: "paid", replay: !!replay, message: replay
          ? "already existed at the vendor, marked paid, nothing was charged again"
          : "sent" };
      };
      const review = (why) => {
        conv.set("status", "needs_review");
        conv.set("review_reason", (why + " Search the vendor for external_id " + key
          + " BEFORE doing anything else: if an order exists, mark this paid; if not, release it.").slice(0, 500));
        try { app.save(conv); } catch (_) {}
        logAct("fellow.payout_needs_review", why + " (external_id " + key + ")", conv.get("id"));
        return { ok: false, state: "needs_review", message: why };
      };
      const release = (why, countsAsAttempt) => {
        fin(countsAsAttempt ? "failed" : "skipped");
        if (!countsAsAttempt) conv.set("payout_attempts", counted);
        if (countsAsAttempt && counted + 1 >= MAX_ATTEMPTS) {
          conv.set("status", "held");
          conv.set("review_reason", ("Three payout attempts failed. Last: " + why).slice(0, 500));
          try { app.save(conv); } catch (_) {}
          logAct("fellow.payout_gave_up", "Gave up after " + MAX_ATTEMPTS + " tries: " + why, conv.get("id"));
          return { ok: false, state: "held", message: why };
        }
        conv.set("status", "pending");
        conv.set("payout_claimed_at", "");
        conv.set("review_reason", String(why).slice(0, 500));
        try { app.save(conv); } catch (_) {}
        return { ok: false, state: "pending", message: why };
      };

      if (out.outcome === "sent")      return settlePaid(false);
      if (out.outcome === "duplicate") return settlePaid(true);

      if (out.outcome === "unfunded") {
        // A clean, terminal 402: nothing was created and no partial state exists.
        // It is ours to fix, so it costs no attempt and the fellow's screen keeps
        // showing the date they were promised.
        sayOnce("payout_fund", "fellow.payout_unfunded",
          "The payout balance is empty and at least one fellow is due. Top it up by ACH, never by card.");
        return release("The payout balance is empty. This is ours to fix and it will go out as soon "
          + "as it is topped up.", false);
      }
      if (out.outcome === "rate_limited") {
        return release("The vendor rate-limited us. Trying again on the next sweep.", false);
      }
      if (out.outcome === "no_send") {
        // Provably nothing was created, so a retry is safe — and it goes out with
        // the SAME external_id, so it is safe even if that proof were wrong.
        return release("The vendor refused the order (" + (Number(out.http) || 0) + "): "
          + (out.error || "no reason given") + ". Nothing was sent.", true);
      }
      if (out.outcome === "conflict") {
        fin("failed");
        return review("The vendor already has an order under this key with DIFFERENT details ("
          + (out.error || "no detail given") + "), which means two code paths disagree about what "
          + "this person is owed.");
      }
      if (out.outcome === "not_configured") {
        // Config was checked before the claim, so this only happens if the key
        // vanished mid-flight. Nothing was sent.
        return release("The payout rail was switched off mid-attempt. Nothing was sent.", false);
      }
      // unknown, and anything a future vendor branch adds. NEVER RETRIED.
      fin("unknown");
      return review("A payout attempt returned " + (Number(out.http) || 0) + " and we do not know "
        + "whether the money moved" + (out.error ? " (" + out.error + ")" : "") + ".");
    };

    // A stale claim means a worker died with the outcome unknown, which is
    // precisely the case that must not retry. This NEVER auto-releases.
    const backstop = () => {
      let stuck = [];
      try {
        stuck = app.findRecordsByFilter("fellow_conversions",
          "status = 'paying' && payout_claimed_at != ''", "+payout_claimed_at", 20, 0);
      } catch (_) { stuck = []; }
      let n = 0;
      for (const c of stuck) {
        const t = pbTime(c.getString("payout_claimed_at"));
        if (isNaN(t) || (Date.now() - t) < STALE_MS) continue;
        c.set("status", "needs_review");
        c.set("review_reason", ("A payout attempt started and never finished. Check the vendor for "
          + "external_id " + (c.getString("payout_key") || "(none minted)") + " BEFORE doing anything "
          + "else: if an order exists, mark this paid; if not, release it.").slice(0, 500));
        try { app.save(c); n++; } catch (_) { continue; }
        logAct("fellow.payout_stuck", "A payout attempt died mid-flight and needs a person: external_id "
          + (c.getString("payout_key") || "(none)"), c.get("id"));
      }
      return n;
    };

    // WAITING ROWS COME BACK — this is the way in. `waiting` is where a row goes
    // when it is blocked on somebody (an unconfirmed address, a guardian who has
    // not finished), and it is out of the due query on purpose so that a block
    // cannot starve the people behind it. Every sweep re-runs payOne's OWN
    // payability checks over parked rows in probe mode — no claim, no network, no
    // money — and any row whose block has cleared goes back to `pending` with its
    // original pay_after, so it keeps its place in the queue instead of going to
    // the back of it. Bounded per sweep, and ordered by payout_checked_at, so a
    // large parked backlog cannot starve the row at the back of THAT either.
    const wakeWaiting = (limit) => {
      let parked = [];
      try {
        parked = app.findRecordsByFilter("fellow_conversions", "status = 'waiting'",
          "+payout_checked_at", limit || 25, 0);
      } catch (_) { parked = []; }
      let woken = 0;
      for (const c of parked) {
        try {
          const r = payOne(c.get("id"), { probe: true });
          if (r && r.state === "ready") woken++;
        } catch (_) {}
      }
      return woken;
    };

    const dueRows = (limit) => {
      try {
        return app.findRecordsByFilter("fellow_conversions",
          "status = 'pending' && pay_after != '' && pay_after <= {:now}",
          "+pay_after", limit, 0, { now: nowISO() });
      } catch (_) { return []; }
    };

    return { VENDOR: VENDOR, VENDOR_SET: VENDOR_SET, vendor: vendor, payOne: payOne,
             backstop: backstop, wakeWaiting: wakeWaiting, dueRows: dueRows,
             logAct: logAct, sayOnce: sayOnce, nowISO: nowISO, pbTime: pbTime };
  };
  // ===== ENGINE:END ==========================================================
  const E = engine($app);

  const stuck = E.backstop();
  if (stuck) console.log("fellow_payout_sweep: " + stuck + " stale claim(s) sent for review");

  const cfg = E.vendor("config", {});
  if (!cfg.configured) {
    E.sayOnce("payout_cfg", "fellow.payout_not_configured",
      "The payout rail has no key set, so nothing can send. This is not a fault. It is switched off.");
    return;
  }
  if (!cfg.ok) {
    E.sayOnce("payout_cfg", "fellow.payout_misconfigured",
      "The payout rail is configured wrongly and nothing can send: " + cfg.error);
    return;
  }

  // PARKED ROWS FIRST, and before the due read, so anything that came unblocked
  // since the last sweep is paid in THIS one rather than an hour later. Probe
  // mode: it re-runs payOne's payability checks and moves rows back to `pending`,
  // and it cannot send — so every send in this file stays behind the balance
  // preflight below, in one place.
  const woken = E.wakeWaiting(25);
  if (woken) console.log("fellow_payout_sweep: " + woken + " parked payout(s) back in the pay lane");

  const due = E.dueRows(10);
  if (!due.length) return;

  let needCents = 0;
  for (const c of due) needCents += Math.round((Number(c.get("commission_usd")) || 0) * 100);
  const bal = E.vendor("balance", {});
  if (bal.configured && bal.cents >= 0 && bal.cents < needCents) {
    E.sayOnce("payout_fund", "fellow.payout_unfunded",
      "The payout balance is $" + (bal.cents / 100).toFixed(2) + " and $" + (needCents / 100).toFixed(2)
      + " is due. Nothing was attempted. Top up by ACH, never by card. A card costs 3% for nothing.");
    return;
  }

  for (const c of due) {
    try {
      const r = E.payOne(c.get("id"), {});
      // A lost race is normal and is not logged. Everything else already wrote
      // its own row inside payOne.
      if (r.state === "raced") continue;
    } catch (err) {
      // A throw here must never take the rest of the batch down with it, and
      // must never be read as "the money did not go".
      console.log("fellow_payout_sweep: unhandled while paying a conversion: " + err);
    }
  }
});
