/// <reference path="../pb_data/types.d.ts" />
//
// Signing up no longer sends a code, so there has to be somewhere to record
// that an address was eventually proven real.
//
// The point of this field is WHERE the verification boundary sits. Learning is
// open to anyone the second they type an email — that is the whole product,
// and a sixteen-year-old bouncing off a "check your inbox" screen never comes
// back. Money is different: nothing pays out to an address nobody has proven
// they own. So this is set by one tap in the welcome email, and it gates
// exactly one thing.
migrate((app) => {
  const c = app.findCollectionByNameOrId("fellows");
  if (!c.fields.getByName("email_confirmed_at")) {
    c.fields.add(new TextField({ name: "email_confirmed_at", max: 40 }));
  }
  // Where the signup came from, so the per-address throttle on /fellows/start
  // has something to count and abuse is traceable without storing more about
  // a person than we need.
  if (!c.fields.getByName("ip_address")) {
    c.fields.add(new TextField({ name: "ip_address", max: 64 }));
  }
  app.save(c);
}, (app) => {
  try {
    const c = app.findCollectionByNameOrId("fellows");
    for (const n of ["email_confirmed_at", "ip_address"]) {
      const f = c.fields.getByName(n);
      if (f) c.fields.removeById(f.id);
    }
    app.save(c);
  } catch (_) {}
});
