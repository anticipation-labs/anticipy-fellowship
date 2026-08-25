/// <reference path="../pb_data/types.d.ts" />
//
// One field, and it exists because the welcome email is the single side
// effect in this system that cannot be rolled back.
//
// /fellows/apply used to set status, send the email, and THEN save the
// record. A crash between the send and the save mails "you're in" to someone
// whose row does not say they are — which is the same incoherence as the
// original bug, just moved one step later. The order is now application row,
// then save the fellow, then send; and the send is guarded by this field so
// that a retry, a double-click, or a cron re-send cannot mail anyone twice.
migrate((app) => {
  const c = app.findCollectionByNameOrId("fellows");
  if (!c.fields.getByName("welcome_sent_at")) {
    c.fields.add(new TextField({ name: "welcome_sent_at", max: 40 }));
  }
  app.save(c);
}, (app) => {
  try {
    const c = app.findCollectionByNameOrId("fellows");
    const f = c.fields.getByName("welcome_sent_at");
    if (f) c.fields.removeById(f.id);
    app.save(c);
  } catch (_) {}
});
