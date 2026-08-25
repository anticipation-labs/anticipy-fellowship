/// <reference path="../pb_data/types.d.ts" />
//
// THE PAYOUT LANE — the three fields that turn 1700000046's rail from a design
// into one that actually pays people. Additive only, and safe to re-run.
//
// Each one exists because of a specific way the rail as shipped could not pay
// anybody at all:
//
//   payout_seq         THE CLAIM SEQUENCE, and the reason the claim is a lock.
//                      The key was "<payout_key>#<count of ledger rows + 1>",
//                      computed from an unsynchronised read of fellow_payouts —
//                      a count of rows the winner is concurrently writing. Two
//                      workers reading at different moments compute DIFFERENT
//                      sequences, so BOTH INSERTs satisfy the UNIQUE index and
//                      both go on to POST an order for the same conversion. A
//                      counter on the CONVERSION, written in the same save as
//                      status='paying', is a lock: anyone still seeing `pending`
//                      also sees the pre-claim sequence, computes the identical
//                      key, and loses the INSERT. It is monotonic and never
//                      rolled back, which also retires the LIMIT-40 saturation
//                      that froze the sequence at 41 after forty ledger rows.
//   payout_blocked_on  WHICH step a parked row is waiting on: email | guardian |
//                      vendor_age. Machine-readable, so HQ can count them
//                      without parsing an English sentence.
//   payout_checked_at  When the parked row was last re-tested. The waker walks
//                      them oldest-checked first, so a large parked backlog
//                      cannot starve the row at the back of it.
//
// AND THE NEW STATUS, which needs no schema change because `status` has always
// been free text: `waiting`. A row blocked on a fellow used to stay `pending`
// with pay_after untouched — due forever, and therefore first in an
// oldest-first batch of ten, for the rest of time. Ten fellows who had not
// confirmed an email address permanently occupied the whole batch and NOBODY
// ELSE WAS EVER PAID. `waiting` is not matched by the due query, so a block now
// costs its own row and nobody else's, and the sweep's waker returns it to
// `pending` the moment the block clears.
//
// NOTHING IS DROPPED AND NOTHING IS RE-DECIDED. No live status string is
// rewritten here: 1700000046 already settled those, and a migration must never
// decide someone's money twice.
migrate((app) => {
  const addText = (c, name, max) => {
    if (!c.fields.getByName(name)) c.fields.add(new TextField({ name: name, max: max }));
  };
  const addNum = (c, name) => {
    if (!c.fields.getByName(name)) c.fields.add(new NumberField({ name: name, min: 0 }));
  };

  const conv = app.findCollectionByNameOrId("fellow_conversions");
  addNum(conv, "payout_seq");
  addText(conv, "payout_blocked_on", 20);
  addText(conv, "payout_checked_at", 40);
  // The waker's read: status = 'waiting' ordered by payout_checked_at.
  conv.indexes = (conv.indexes || []).filter((i) => !i.includes("idx_fconv_parked"));
  conv.indexes.push("CREATE INDEX `idx_fconv_parked` ON `fellow_conversions` (`status`, `payout_checked_at`)");
  app.save(conv);

  // ---- seed payout_seq from the ledger -----------------------------------
  // THIS IS THE LOAD-BEARING HALF OF THE MIGRATION. A conversion that already
  // has ledger rows under "<key>#1" and "<key>#2" but a payout_seq of 0 would
  // compute "#1" on its next claim, collide with a row that already exists, and
  // report a lost race — FOREVER. It would never be paid by anybody, and
  // nothing would say why. So the counter starts above whatever the ledger
  // already holds.
  //
  // fellow_payouts has never had a writer in this tree, so the expected count
  // is zero. It is done anyway, because a migration that assumes a table is
  // empty is a migration that destroys production the one time it is wrong.
  let seeded = 0;
  let rows = [];
  try { rows = app.findRecordsByFilter("fellow_conversions", "", "+created", 500, 0); } catch (_) { rows = []; }
  for (const r of rows) {
    try {
      if (Number(r.get("payout_seq")) > 0) continue;
      let n = 0;
      try {
        const led = app.findRecordsByFilter("fellow_payouts", "conversion = {:c}", "-created", 200, 0,
          { c: r.get("id") });
        for (const p of led) { if (p.getString("idempotency_key")) n++; }
      } catch (_) { n = 0; }
      const attempts = Number(r.get("payout_attempts")) || 0;
      const start = n > attempts ? n : attempts;
      if (start > 0) { r.set("payout_seq", start); app.save(r); seeded++; }
    } catch (_) {}
  }

  // ---- default the payout method -----------------------------------------
  // CARD IS THE ANSWER, NOT A QUESTION. Nothing but POST /fellows/payout-method
  // ever wrote this field and the rail refused to send while it was empty, so
  // every existing fellow who never found that route is unpayable until this
  // runs. Card is the default rail and the only legal value under 18, so there
  // is nothing to decide — and no existing choice is touched.
  let defaulted = 0;
  let fellows = [];
  try { fellows = app.findRecordsByFilter("fellows", "", "+created", 1000, 0); } catch (_) { fellows = []; }
  for (const f of fellows) {
    try {
      if (f.getString("payout_method")) continue;
      f.set("payout_method", "card");
      app.save(f);
      defaulted++;
    } catch (_) {}
  }

  try {
    const act = new Record(app.findCollectionByNameOrId("internal_activity"));
    act.set("actor", ""); act.set("actor_name", "Fellowships");
    act.set("action", "fellowship.payout_lane_migration");
    act.set("subject", "Payout lane installed: parked rows leave the due query, the claim sequence "
      + "moved onto the conversion. " + seeded + " conversion(s) seeded, " + defaulted
      + " fellow(s) defaulted to card.");
    app.save(act);
  } catch (_) {}
  console.log("fellow payout lane: " + seeded + " seq seeded, " + defaulted + " payout_method defaulted");
}, (app) => {
  // Removes ONLY what it added. It deliberately does not un-default
  // payout_method and does not rewrite `waiting` back to `pending`: putting
  // blocked rows back at the front of the pay lane would re-break payouts for
  // everyone behind them, which is the same posture 1700000046's down() takes.
  try {
    const conv = app.findCollectionByNameOrId("fellow_conversions");
    conv.indexes = (conv.indexes || []).filter((i) => !i.includes("idx_fconv_parked"));
    for (const n of ["payout_seq", "payout_blocked_on", "payout_checked_at"]) {
      const f = conv.fields.getByName(n);
      if (f) conv.fields.removeById(f.id);
    }
    app.save(conv);
  } catch (_) {}
});
