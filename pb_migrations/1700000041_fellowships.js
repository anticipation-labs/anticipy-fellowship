/// <reference path="../pb_data/types.d.ts" />
//
// ANTICIPY FELLOWSHIPS — the public side.
//
// Same stance as internal_hq: every API rule null, so these rows are reachable
// ONLY through the /fellows/* and /internal/fellows/* hook routes. That matters
// more here than it did there, because this is the first thing in the codebase
// that is genuinely PUBLIC — anyone on the internet can reach the routes.
//
// Two rules run through the whole schema:
//
// 1. WE DO NOT COLLECT WHAT WE DO NOT NEED. Birth month and year, never a full
//    date of birth. Country as a two-letter code, no address. No school, no
//    photo, no government ID. Many of these people are minors and every extra
//    field is a liability with no upside.
// 2. AGE IS DERIVED, NEVER ASKED AS A BAND. Asking "13-15 / 16-17 / 18+"
//    telegraphs the cutoff and invites a lie. We ask when they were born, in a
//    neutral way, and compute the band ourselves — which also means it updates
//    on its own when someone turns 16 or 18.
migrate((app) => {
  const mk = (name, fields, indexes) => {
    try {
      app.findCollectionByNameOrId(name);
      return null;                       // migrations re-run on every boot
    } catch (_) {
      const c = new Collection({
        type: "base",
        name: name,
        fields: fields,
        indexes: indexes || [],
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      });
      app.save(c);
      return app.findCollectionByNameOrId(name);
    }
  };

  // ---- the fellow ---------------------------------------------------------
  mk("fellows", [
    { name: "email", type: "text", required: true, max: 254, presentable: true },
    { name: "name", type: "text", max: 120 },
    // Month + year only. A full date of birth is more than we need to know.
    { name: "birth_month", type: "number", min: 1, max: 12 },
    { name: "birth_year", type: "number", min: 1900, max: 2100 },
    { name: "age_band", type: "text", max: 10 },        // 13_15 | 16_17 | 18_plus
    { name: "country", type: "text", max: 2 },          // us | ca
    { name: "parent_email", type: "text", max: 254 },
    { name: "parental_consent", type: "text", max: 12 },// not_required | pending | confirmed
    { name: "consent_token_hash", type: "text", max: 64 },
    { name: "payout_identity_verified", type: "bool" },
    { name: "ad_usable", type: "bool" },
    { name: "instagram", type: "text", max: 200 },
    { name: "tiktok", type: "text", max: 200 },
    { name: "x_handle", type: "text", max: 200 },
    { name: "linkedin", type: "text", max: 200 },
    { name: "phone", type: "text", max: 32 },
    // Only ever true for 18+. Enforced in the route AND again in the send
    // helper, because a policy that lives in one place is a policy that will
    // eventually be bypassed by the second caller.
    { name: "sms_opt_in", type: "bool" },
    { name: "fellowship", type: "text", max: 12 },      // growth | software | hardware | technical
    { name: "waitlist_tracks", type: "text", max: 60 },
    { name: "status", type: "text", max: 12 },          // new | accepted | paused | removed
    { name: "referral_code", type: "text", max: 16 },
    { name: "code_active", type: "bool" },
    { name: "code_revoked", type: "bool" },
    { name: "clicks_total", type: "number", min: 0 },
    { name: "session_hash", type: "text", max: 64 },
    { name: "session_expires", type: "text", max: 40 },
    { name: "payout_method", type: "text", max: 10 },   // whop | paypal | ""
    { name: "payout_handle", type: "text", max: 200 },
    { name: "created", type: "autodate", onCreate: true },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ], [
    "CREATE UNIQUE INDEX idx_fellows_email ON fellows (email)",
    "CREATE INDEX idx_fellows_code ON fellows (referral_code)",
    "CREATE INDEX idx_fellows_status ON fellows (status)",
    "CREATE INDEX idx_fellows_session ON fellows (session_hash)",
  ]);

  // ---- the emailed sign-in code ------------------------------------------
  // Only the sha256 is stored. A database dump must not be a list of live
  // codes, and the comparison is constant-time at the route.
  mk("fellow_codes", [
    { name: "email", type: "text", required: true, max: 254 },
    { name: "code_hash", type: "text", required: true, max: 64 },
    { name: "expires", type: "text", max: 40 },
    { name: "attempts", type: "number", min: 0 },
    { name: "used", type: "bool" },
    { name: "ip", type: "text", max: 64 },
    { name: "created", type: "autodate", onCreate: true },
  ], [
    "CREATE INDEX idx_fcodes_email ON fellow_codes (email, created)",
    "CREATE INDEX idx_fcodes_ip ON fellow_codes (ip, created)",
  ]);

  // ---- the application ----------------------------------------------------
  mk("fellow_applications", [
    { name: "fellow", type: "text", max: 40 },
    { name: "email", type: "text", max: 254 },
    { name: "fellowship", type: "text", max: 12 },
    { name: "answers", type: "text", max: 8000 },
    { name: "ai_verdict", type: "text", max: 16 },      // accept | ask_more | fallback_accept
    { name: "ai_message", type: "text", max: 2000 },
    { name: "ai_ok", type: "bool" },
    { name: "model", type: "text", max: 80 },
    { name: "terms_accepted_at", type: "text", max: 40 },
    { name: "created", type: "autodate", onCreate: true },
  ], ["CREATE INDEX idx_fapps_email ON fellow_applications (email, fellowship)"]);

  // ---- learning progress --------------------------------------------------
  mk("fellow_progress", [
    { name: "fellow", type: "text", required: true, max: 40 },
    { name: "lesson_id", type: "text", required: true, max: 80 },
    { name: "completed_at", type: "text", max: 40 },
    { name: "created", type: "autodate", onCreate: true },
  ], ["CREATE UNIQUE INDEX idx_fprog ON fellow_progress (fellow, lesson_id)"]);

  // ---- referral clicks ----------------------------------------------------
  // The IP is stored only as a salted hash, and the rows are pruned at 90
  // days. The running total lives on the fellow row, so pruning never costs
  // anyone their numbers.
  mk("fellow_clicks", [
    { name: "code", type: "text", max: 16 },
    { name: "ip_hash", type: "text", max: 64 },
    { name: "ua", type: "text", max: 200 },
    { name: "created", type: "autodate", onCreate: true },
  ], ["CREATE INDEX idx_fclicks ON fellow_clicks (code, created)"]);

  // ---- money --------------------------------------------------------------
  mk("fellow_conversions", [
    { name: "fellow", type: "text", max: 40 },
    { name: "code", type: "text", max: 16 },
    // UNIQUE so the same order can never be paid twice, whatever enters it.
    { name: "order_ref", type: "text", required: true, max: 120 },
    { name: "amount_usd", type: "number", min: 0 },
    { name: "commission_usd", type: "number", min: 0 },
    { name: "status", type: "text", max: 12 },          // pending|approved|half_paid|paid|clawed_back|flagged
    { name: "flags", type: "text", max: 2000 },
    { name: "source", type: "text", max: 10 },          // manual | webhook
    { name: "hold_until", type: "text", max: 40 },
    { name: "ship_confirmed_at", type: "text", max: 40 },
    { name: "paid_via", type: "text", max: 10 },
    { name: "entered_by", type: "text", max: 40 },
    { name: "created", type: "autodate", onCreate: true },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ], [
    "CREATE UNIQUE INDEX idx_fconv_order ON fellow_conversions (order_ref)",
    "CREATE INDEX idx_fconv_fellow ON fellow_conversions (fellow, status)",
  ]);

  mk("fellow_payouts", [
    { name: "fellow", type: "text", max: 40 },
    { name: "batch", type: "text", max: 20 },
    { name: "total_usd", type: "number", min: 0 },
    { name: "method", type: "text", max: 10 },
    { name: "destination", type: "text", max: 200 },
    { name: "transfer_id", type: "text", max: 120 },
    { name: "status", type: "text", max: 10 },
    { name: "sent_at", type: "text", max: 40 },
    { name: "created", type: "autodate", onCreate: true },
  ], ["CREATE INDEX idx_fpayouts ON fellow_payouts (batch)"]);

  // ---- meters (same two-field pattern as internal_meter) ------------------
  mk("fellow_meter", [
    { name: "name", type: "text", required: true, max: 60 },
    { name: "hour", type: "text", max: 20 },
    { name: "calls", type: "number", min: 0 },
    { name: "created", type: "autodate", onCreate: true },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ], ["CREATE UNIQUE INDEX idx_fmeter ON fellow_meter (name)"]);

  const seed = (col, rows, probeField, probeValue) => {
    try {
      app.findFirstRecordByFilter(col, probeField + " = {:v}", { v: probeValue });
      return;
    } catch (_) {}
    const c = app.findCollectionByNameOrId(col);
    for (const row of rows) {
      const r = new Record(c);
      for (const k in row) r.set(k, row[k]);
      app.save(r);
    }
  };
  seed("fellow_meter", [
    { name: "llm", hour: "", calls: 0 },
    { name: "email", hour: "", calls: 0 },
    { name: "sms", hour: "", calls: 0 },
  ], "name", "llm");
}, (app) => {
  for (const name of ["fellow_meter", "fellow_payouts", "fellow_conversions", "fellow_clicks",
                      "fellow_progress", "fellow_applications", "fellow_codes", "fellows"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) {}
  }
});
