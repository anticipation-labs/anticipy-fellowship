/// <reference path="../pb_data/types.d.ts" />
//
// Referral codes must be lowercase, and this is a money fix, not a tidy-up.
//
// anticipy.ai's checkout route normalises the ap_ref cookie with
//   ap_ref.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24)
// before it goes into Stripe metadata. An uppercase code therefore arrives at
// the webhook in a case our exact-match lookup can never find: the CLICK is
// counted and the SALE silently is not. A fellow does the work, drives a
// purchase, and is never credited — and nobody finds out until a payout
// dispute, by which point the evidence is gone.
//
// Every code minted before this migration is uppercase. Lowering them keeps
// links already posted working, because /r/ now normalises the same way.
migrate((app) => {
  let rows = [];
  try { rows = app.findRecordsByFilter("fellows", "referral_code != ''", "+created", 500, 0); }
  catch (_) { return; }
  for (const r of rows) {
    const c = r.getString("referral_code");
    const lower = c.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (lower && lower !== c) {
      r.set("referral_code", lower);
      try { app.save(r); } catch (_) {}
    }
  }
}, (app) => { /* lowering is not reversible, and reversing it would re-break payouts */ });
