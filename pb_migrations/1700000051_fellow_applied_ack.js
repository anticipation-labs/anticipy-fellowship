/// <reference path="../pb_data/types.d.ts" />
//
// One field, for the same reason 1700000044 exists — and specifically so that
// it is NOT that field.
//
// The technical tracks acknowledge an application by email; growth sends a
// welcome. Both are guarded so a retry cannot mail twice, and the first build
// of the technical lane guarded BOTH on `welcome_sent_at`. That is a silent
// trap: somebody who applies to Software and is later accepted into Growth has
// welcome_sent_at already stamped, so the growth welcome never sends — and
// that email carries the confirm link, which is the switch that activates a
// referral code. They would have joined Growth with a code that could never
// be turned on, and nothing anywhere would have said so.
//
// Two different emails, two different guards.
migrate((app) => {
  const c = app.findCollectionByNameOrId("fellows");
  if (!c.fields.getByName("applied_ack_sent_at")) {
    c.fields.add(new TextField({ name: "applied_ack_sent_at", max: 40 }));
  }
  app.save(c);
}, (app) => {
  try {
    const c = app.findCollectionByNameOrId("fellows");
    const f = c.fields.getByName("applied_ack_sent_at");
    if (f) c.fields.removeById(f.id);
    app.save(c);
  } catch (_) {}
});
