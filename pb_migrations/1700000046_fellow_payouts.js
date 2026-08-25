/// <reference path="../pb_data/types.d.ts" />
//
// THE PAYOUT RAIL — the schema half. Additive only; nothing is dropped and no
// live row loses a fact.
//
// Every field below exists because of a specific way a real $30 gets lost or
// gets sent twice. In the order they bite:
//
//   payout_key         The vendor's external_id, minted ONCE per conversion and
//                      never regenerated. Tremendous has no idempotency header —
//                      external_id in the body is the only dedupe mechanism it
//                      has — so a retry that mints a fresh key is a retry that
//                      buys a second gift card. Storing it on the row is what
//                      makes the key survive a crash, a redeploy and a cron
//                      re-fire.
//   idempotency_key    (on fellow_payouts, UNIQUE) The DB-side claim. It is
//                      payout_key + "#" + attempt, and the INSERT of the payout
//                      row IS the lock: e.app.save() on an existing record is a
//                      plain UPDATE where last-write-wins, so a status field can
//                      never be a claim — two crons both read `pending`, both
//                      write `paying`, and both send. SQLite enforces a UNIQUE
//                      index inside a single INSERT, atomically, and PocketBase
//                      surfaces the violation as a thrown error. The loser of
//                      the race sends nothing. The whole mutual exclusion
//                      completes BEFORE the HTTP call, so no transaction has to
//                      span the network.
//   payout_attempts    Bounds the retries, the shape 1700000040 introduced for
//                      reminders. Three tries, then a human, not a loop.
//   payout_claimed_at  When the claim was stamped. A worker that dies mid-call
//                      leaves a row in `paying` forever and the fellow waits
//                      invisibly; this is what the sweep's backstop finds.
//   review_reason      Why a human is being asked, in a sentence, WITH the key
//                      in it — because the human's entire job is: search the
//                      vendor for that external_id, and either mark it paid or
//                      release it.
//   paid_at / payout_ref  So "paid" in our database is a claim we can support to
//                      a parent, not a note that our HTTP call returned 200.
//   lifetime_paid_usd  Checked BEFORE the payment that would cross a reporting
//                      threshold, never after — the paperwork has to be
//                      collected from somebody who is under no obligation to
//                      answer once they already have the money.
//
// THE STATUS REWRITE. fellow_conversions carried a state set built for the old
// 15/15 split — pending|approved|half_paid|paid|clawed_back|flagged — and the
// recon state machine is six values: pending | held | paying | paid |
// needs_review | void. The strings on live rows are rewritten here, but
// `half_paid` is DELIBERATELY NOT DECIDED by this migration: it means $15 was
// paid and $15 is owed, so calling it pending re-pays the $15 and calling it
// paid strands the person. It goes to needs_review with the human's instruction
// already written into review_reason. A migration must never decide someone's
// money.
//
// NOTHING IS DROPPED. hold_until and ship_confirmed_at stay and are left
// unread. They are not wrong fields, they were a wrong GATE — they recorded
// real events, and what was wrong was that money waited on them. Deleting a
// column on a live table in PocketBase is a full table rebuild that destroys a
// fact to tidy a schema, and reusing the NAME hold_until for the new 30-day
// clock would give one column two meanings across a migration boundary, which
// is the exact ambiguity that costs money. pay_after is a new name on purpose.
//
// AND THE PROHIBITION, here because this is where the next person adds a
// feature: nothing on fellow_payouts or fellow_conversions may ever become a
// leaderboard, a bonus, or a "most X wins" prize. The moment a number here
// pays, every anti-abuse defence in the system becomes load-bearing and none
// of them is strong enough to bear it.
migrate((app) => {
  const nowISO = new Date().toISOString();
  // No other migration in this tree touches $os, so it is read defensively
  // rather than assumed: a migration that throws on boot does not migrate
  // anything, and this one rewrites live money rows.
  let DAYS = 30;
  try { DAYS = parseInt($os.getenv("ANTICIPY_FELLOW_PAYOUT_DAYS") || "30", 10) || 30; } catch (_) { DAYS = 30; }

  // Accepts a PocketBase datetime with or without its trailing Z. The naive
  // version — replace(" ","T") + "Z" — produces "...880ZZ" on 0.30.4's own
  // autodates, which is Invalid Date, which is NaN, which silently disables
  // whatever it guards.
  const pbTime = (v) => {
    if (!v) return NaN;
    let t = String(v).trim().replace(" ", "T");
    if (!/([Zz]|[+-]\d{2}:?\d{2})$/.test(t)) t += "Z";
    return new Date(t).getTime();
  };

  const addText = (c, name, max) => {
    if (!c.fields.getByName(name)) c.fields.add(new TextField({ name: name, max: max }));
  };
  const addNum = (c, name) => {
    if (!c.fields.getByName(name)) c.fields.add(new NumberField({ name: name, min: 0 }));
  };

  // ---- fellow_conversions: the clock, the claim, and the receipt ----------
  const conv = app.findCollectionByNameOrId("fellow_conversions");
  addText(conv, "pay_after", 40);          // ISO. The 30-day clock. Replaces hold_until's meaning, not its name.
  addText(conv, "payout_key", 64);         // the vendor external_id. Minted once, never regenerated.
  addNum(conv, "payout_attempts");
  addText(conv, "payout_claimed_at", 40);
  addText(conv, "paid_at", 40);
  addText(conv, "payout_ref", 120);        // winning vendor order id, copied up so HQ needs no join
  addText(conv, "review_reason", 500);
  conv.indexes = (conv.indexes || []).filter((i) => !i.includes("idx_fconv_due"));
  conv.indexes.push("CREATE INDEX `idx_fconv_due` ON `fellow_conversions` (`status`, `pay_after`)");
  app.save(conv);

  // ---- fellow_payouts: the ledger, one row per ATTEMPT --------------------
  // The collection already exists from 1700000041 with a batch-oriented shape
  // (batch, total_usd, method, destination, transfer_id, status, sent_at). One
  // conversion is one payment is one row now, so the batch fields are left
  // unwritten rather than removed. It has never had a writer, so it is empty —
  // but this is still additive, because a migration that assumes a table is
  // empty is a migration that deletes production the one time it is wrong.
  //
  // `state` rather than reusing `status` for the same reason pay_after is not
  // hold_until: one column, one meaning, forever.
  //
  // AND `destination` IS DELIBERATELY NEVER WRITTEN. The recipient's email is
  // already on the fellow (or guardian) row. Copying a minor's email into a
  // second table for no reason breaks rule 1 of this schema: we do not collect
  // what we do not need.
  const pay = app.findCollectionByNameOrId("fellow_payouts");
  addText(pay, "conversion", 40);          // enforced non-empty in code, not with `required` —
                                           // adding required to a live collection breaks existing rows
  addText(pay, "idempotency_key", 64);     // THE GUARD
  addNum(pay, "attempt");
  addNum(pay, "amount_usd");
  addText(pay, "vendor", 20);              // tremendous | tango | manual
  addText(pay, "vendor_order_id", 120);
  addText(pay, "vendor_reward_id", 120);
  addText(pay, "state", 12);               // claimed | sent | duplicate | failed | unknown
  addNum(pay, "http_status");              // the literal code. 0 means the call never returned at all.
  addText(pay, "error", 2000);             // SANITISED — see the scrub() in the hook
  addText(pay, "product_id", 40);          // what they actually received, because a parent asks
                                           // what it was, not what it cost
  addText(pay, "age_band_at_payment", 10); // the band AT PAYMENT, so the audit trail does not
                                           // rewrite itself on somebody's birthday
  addText(pay, "delivery", 12);            // email | link
  addText(pay, "finished_at", 40);
  pay.indexes = (pay.indexes || []).filter((i) =>
    !i.includes("idx_fpayout_idem") && !i.includes("idx_fpayout_conv") && !i.includes("idx_fpayout_state"));
  // THE PARTIAL WHERE IS LOAD-BEARING, NOT DECORATION. Rows written by hand,
  // or by a future manual-payment path, carry no key and must not all collide
  // with each other on the empty string.
  pay.indexes.push("CREATE UNIQUE INDEX `idx_fpayout_idem` ON `fellow_payouts` (`idempotency_key`) WHERE `idempotency_key` != ''");
  pay.indexes.push("CREATE INDEX `idx_fpayout_conv` ON `fellow_payouts` (`conversion`, `created`)");
  pay.indexes.push("CREATE INDEX `idx_fpayout_state` ON `fellow_payouts` (`state`)");
  app.save(pay);

  // ---- fellows: how they chose to be paid, and the running total ----------
  // payout_method's old comment said "whop | paypal". Whop Earnings is 18+ and
  // PayPal is 18+, so as written that field could only ever describe half this
  // programme — and nothing ever wrote it, so leg 7 of the gate was passing on
  // a string in a getter. The values are now:
  //
  //     ""           they have not chosen yet
  //     "card"       stored value, delivered by email. The default, and the
  //                  ONLY thing anyone under 18 may ever be set to.
  //     "cash_like"  PayPal / Venmo / bank. 18+ only, ~4% (min $0.25), and
  //                  refused in the route AND again at send time.
  const fel = app.findCollectionByNameOrId("fellows");
  addText(fel, "payout_method_set_at", 40);
  addNum(fel, "lifetime_paid_usd");
  app.save(fel);

  // ---- meters -------------------------------------------------------------
  // 1700000041's seed helper probes on name = 'llm' and returns early, so it
  // will never add these. Same two-field hour/calls shape as "email" and "llm";
  // here `hour` holds a DAY, because these say a thing once a day, not once an
  // hour, and a person reading the activity feed should not have to scroll past
  // twenty-four identical rows to find out the balance is empty.
  const meter = app.findCollectionByNameOrId("fellow_meter");
  for (const n of ["payout_fund", "payout_cfg"]) {
    try { app.findFirstRecordByFilter("fellow_meter", "name = {:n}", { n: n }); }
    catch (_) {
      try {
        const r = new Record(meter);
        r.set("name", n); r.set("hour", ""); r.set("calls", 0);
        app.save(r);
      } catch (_) {}
    }
  }

  // ---- the live-row rewrite ----------------------------------------------
  // Five old statuses map to four new ones. Anything unrecognised — including
  // an empty string — becomes `held`, never `pending`: a row we cannot classify
  // must NEVER walk into the pay lane on its own.
  const MAP = {
    pending: "pending",
    approved: "pending",       // approval is no longer a state. The 30 days IS the approval.
    flagged: "held",
    paid: "paid",
    clawed_back: "void",
    half_paid: "needs_review",
    // already-new values pass through untouched, so this is safe to re-run
    held: "held", paying: "paying", needs_review: "needs_review", void: "void",
  };
  const tally = {};
  let rows = [];
  try { rows = app.findRecordsByFilter("fellow_conversions", "", "+created", 500, 0); } catch (_) { rows = []; }
  for (const r of rows) {
    try {
      const was = r.getString("status") || "";
      const to = MAP[was] || "held";
      let touched = false;

      if (to !== was) {
        r.set("status", to);
        touched = true;
        tally[was + "->" + to] = (tally[was + "->" + to] || 0) + 1;
        if (was === "clawed_back") {
          r.set("flags", (r.getString("flags") ? r.getString("flags") + "\n" : "")
            + "clawed_back under the old 15/15 rule");
        }
        if (was === "half_paid") {
          r.set("review_reason", "Paid $15 under the old split. Under the one-payment rule this "
            + "person is owed the remaining $15. Pay it by hand in the vendor dashboard, then mark paid.");
        }
        if (!MAP[was]) {
          r.set("flags", (r.getString("flags") ? r.getString("flags") + "\n" : "")
            + "status was " + JSON.stringify(was) + " and could not be classified; held for a human");
          r.set("review_reason", "This row's status was not one the payout rail understands, so it "
            + "was held rather than guessed at. Decide it by hand.");
        }
      }

      // The clock. hold_until when it parses, otherwise created + 30 days, so a
      // row that predates this migration still has a real date to pay on and
      // does not sit due-forever or never-due.
      if (!r.getString("pay_after")) {
        const h = pbTime(r.getString("hold_until"));
        const c = pbTime(r.getString("created"));
        const base = !isNaN(h) ? h : (!isNaN(c) ? c + DAYS * 86400000 : Date.now() + DAYS * 86400000);
        r.set("pay_after", new Date(base).toISOString());
        touched = true;
      }
      if (to === "paid" && !r.getString("paid_at")) {
        const u = pbTime(r.getString("updated"));
        r.set("paid_at", new Date(isNaN(u) ? Date.now() : u).toISOString());
        touched = true;
      }
      if (touched) app.save(r);
    } catch (_) {}
  }

  // ONE activity row with the count, so the rewrite is discovered in HQ rather
  // than by a fellow. The expected half_paid and clawed_back count is ZERO —
  // nothing in this tree writes fellow_conversions yet — and this row is how
  // you find out if that is wrong.
  const moved = Object.keys(tally).map((k) => k + " x" + tally[k]).join(", ");
  try {
    const act = new Record(app.findCollectionByNameOrId("internal_activity"));
    act.set("actor", ""); act.set("actor_name", "Fellowships");
    act.set("action", "fellowship.payout_migration");
    act.set("subject", "Payout rail installed. " + rows.length + " conversion row(s) read"
      + (moved ? "; rewritten: " + moved : "; no status needed rewriting")
      + (tally["half_paid->needs_review"] ? ". SOMEONE IS OWED $15 BY HAND — see needs_review." : ""));
    app.save(act);
  } catch (_) {}
  console.log("fellow payout migration: " + rows.length + " conversions read at " + nowISO
    + (moved ? "; " + moved : ""));
}, (app) => {
  // Removes ONLY what it added. It deliberately does not restore the old status
  // strings: un-mapping them would re-break payouts, which is the same posture
  // 1700000043's down() takes about lowercasing referral codes.
  try {
    const conv = app.findCollectionByNameOrId("fellow_conversions");
    conv.indexes = (conv.indexes || []).filter((i) => !i.includes("idx_fconv_due"));
    for (const n of ["pay_after", "payout_key", "payout_attempts", "payout_claimed_at",
                     "paid_at", "payout_ref", "review_reason"]) {
      const f = conv.fields.getByName(n);
      if (f) conv.fields.removeById(f.id);
    }
    app.save(conv);
  } catch (_) {}
  try {
    const pay = app.findCollectionByNameOrId("fellow_payouts");
    pay.indexes = (pay.indexes || []).filter((i) =>
      !i.includes("idx_fpayout_idem") && !i.includes("idx_fpayout_conv") && !i.includes("idx_fpayout_state"));
    for (const n of ["conversion", "idempotency_key", "attempt", "amount_usd", "vendor",
                     "vendor_order_id", "vendor_reward_id", "state", "http_status", "error",
                     "product_id", "age_band_at_payment", "delivery", "finished_at"]) {
      const f = pay.fields.getByName(n);
      if (f) pay.fields.removeById(f.id);
    }
    app.save(pay);
  } catch (_) {}
  try {
    const fel = app.findCollectionByNameOrId("fellows");
    for (const n of ["payout_method_set_at", "lifetime_paid_usd"]) {
      const f = fel.fields.getByName(n);
      if (f) fel.fields.removeById(f.id);
    }
    app.save(fel);
  } catch (_) {}
});
