/// <reference path="../pb_data/types.d.ts" />
//
// THE LOGBOOK. One collection, because a fellow who makes something had
// nowhere to put it and nothing to show for it.
//
// THE FAILURE THIS PREVENTS, stated plainly: someone films a video, posts it
// on their own account, and the programme has no idea it happened. The course
// asks them to make things; nothing in the system could ever hold one. So the
// dashboard could only ever show clicks and sales — the two numbers that stay
// zero longest — and the work itself was invisible.
//
// THE RULE THAT MAKES THE WHOLE THING SAFE, and it belongs here rather than in
// a design document because the next person to add a feature will read this
// file and not that one:
//
//   *** NO NUMBER ON THIS TABLE MAY EVER PAY. ***
//
//   No bonus for logging. No leaderboard. No "most videos" prize. No threshold
//   that unlocks anything. Money is paid for fellow_conversions, which come
//   from a real purchase through /r/<code>, which requires a click on THEIR
//   link. Pasting a stranger's viral video therefore earns exactly $0, and
//   that is the single design decision that makes every other defence here
//   cheap. The moment a number on fellow_submissions is worth money, the
//   author check below becomes load-bearing — and it is nowhere near strong
//   enough to bear it, because two of the five platforms cannot be checked at
//   all.
//
// AND THE SECOND RULE, which is the fellowship's law and not a preference:
// posting is optional and always to the fellow's own account. Nothing that
// reads off this table may be phrased as a quota, a requirement, or a
// deadline. There is deliberately no `required_count`, no `target`, no `due`.
//
// WHAT IS DELIBERATELY ABSENT, and why absence is the honest answer:
//
//   NO view_count / like_count / play_count. Reading a view count on any of
//   the five platforms needs OAuth, per platform, per fellow — TikTok Display
//   API, Instagram Graph with a Business account, YouTube Data API with the
//   channel owner's consent, X's paid tier, LinkedIn's partner programme.
//   Every one of those asks a thirteen-year-old to grant an app permission on
//   their own account and hands us a token we would then have to hold and
//   could then breach, in exchange for a vanity number. We do not store what
//   we have not verified, so there is no column pretending we can.
//
//   NO posted_at. We cannot read when something was posted on any of the five,
//   and a field for it would be filled by a guess. `created` is when it was
//   logged, which is a fact we own.
//
// THE TWO STATUS AXES ARE SEPARATE ON PURPOSE. `status` is what a PERSON
// decided (logged / flagged / removed). `verify_state` is what the INTERNET
// said (unverified / verified / mismatch / gone). Merging them would lose the
// only distinction that matters when something looks wrong: whether a human
// made a judgement or a machine failed to reach a server.
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

  mk("fellow_submissions", [
    { name: "fellow", type: "text", required: true, max: 40 },
    { name: "platform", type: "text", max: 12 },        // tiktok | instagram | youtube | x | linkedin
    { name: "kind", type: "text", max: 12 },            // video | reel | short | post | photo | article
    // OUR canonical form, rebuilt from the parsed id — never the pasted bytes.
    // That is what strips tracking parameters: nothing from the query string
    // survives into this column because the column is not built from it.
    { name: "url", type: "text", max: 500 },
    // platform + ":" + native id. THE dedupe key, and the reason the surface
    // is not in it: /p/<code> and /reel/<code> are the same Instagram post,
    // and /shorts/<id> and /watch?v=<id> are the same YouTube video. Putting
    // the surface in the key would let anyone log one thing twice by editing
    // a single word in the URL.
    { name: "url_key", type: "text", max: 120 },
    // Exactly what they pasted, junk and all. Kept because when a parse is
    // wrong this is the only evidence of what it was wrong about. It is
    // user-supplied text: it is never rendered unescaped and never used as an
    // href.
    { name: "submitted_url", type: "text", max: 500 },
    { name: "native_id", type: "text", max: 80 },
    // What oEmbed said the author is. Empty on Instagram and LinkedIn forever,
    // because neither will tell a server anything (measured: Instagram serves
    // a logged-out fetcher a shell with zero og: tags; LinkedIn answers a
    // machine with HTTP 999).
    { name: "author_handle", type: "text", max: 120 },
    // What the pasted URL claimed. UNTRUSTED, and provably so: TikTok and X
    // both return the true author for a URL carrying a deliberately wrong
    // handle, which means the handle in the address bar is decorative.
    { name: "author_claimed", type: "text", max: 120 },
    { name: "title", type: "text", max: 500 },
    // Stored, never downloaded, never rendered on a public page. TikTok's CDN
    // URL is signed and expires, so HQ falls back to a plain card when the
    // image 404s rather than us running an image proxy for a logbook.
    { name: "thumbnail_url", type: "text", max: 500 },
    { name: "verify_state", type: "text", max: 16 },    // unverified | verified | mismatch | gone
    { name: "verified_at", type: "text", max: 40 },
    { name: "oembed_status", type: "number", min: 0 },  // literal HTTP code. 0 = never returned
    { name: "status", type: "text", max: 12 },          // logged | flagged | removed
    { name: "removed_by", type: "text", max: 10 },      // fellow | hq
    { name: "note", type: "text", max: 500 },           // their own one line, optional
    { name: "flags", type: "text", max: 1000 },
    { name: "created", type: "autodate", onCreate: true },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ], [
    // GLOBAL uniqueness, and the WHERE clause is load-bearing rather than
    // decoration. A fellow removing their own row clears url_key, which
    // releases the video so the person who actually made it can still log it —
    // one mis-paste must not lock a video out of the system forever. An HQ
    // removal RETAINS url_key, so a video taken down as not-theirs stays
    // locked and cannot simply be re-pasted. That asymmetry is the whole
    // reason this index is partial.
    "CREATE UNIQUE INDEX idx_fsub_key ON fellow_submissions (url_key) WHERE url_key != ''",
    "CREATE INDEX idx_fsub_fellow ON fellow_submissions (fellow, created)",
    "CREATE INDEX idx_fsub_platform ON fellow_submissions (platform, created)",
    // Answers "is this handle turning up under more than one fellow" in one
    // query, which is the cheapest detector for the stranger-video attack.
    "CREATE INDEX idx_fsub_author ON fellow_submissions (author_handle)",
  ]);

  // YouTube is the one checkable platform with no field to check against.
  // fellows carries instagram, tiktok, x_handle and linkedin and has never
  // carried youtube — so a YouTube Short could be logged and the author check
  // would have nothing to compare the oEmbed answer to, which is the same as
  // having no check. One field, added guarded, in the 1700000044 pattern.
  try {
    const f = app.findCollectionByNameOrId("fellows");
    if (!f.fields.getByName("youtube")) {
      f.fields.add(new TextField({ name: "youtube", max: 200 }));
      app.save(f);
    }
  } catch (_) {}

  // The oEmbed meter, same two-field hour/calls shape as 'email' and 'llm'.
  // It caps our GLOBAL outbound rate so a burst cannot get our shared egress
  // IP rate-limited by TikTok. Over the ceiling the submission still saves as
  // unverified: a meter must never stop someone logging their own work.
  try {
    app.findFirstRecordByFilter("fellow_meter", "name = 'oembed'");
  } catch (_) {
    try {
      const m = new Record(app.findCollectionByNameOrId("fellow_meter"));
      m.set("name", "oembed"); m.set("hour", ""); m.set("calls", 0);
      app.save(m);
    } catch (_) {}
  }
}, (app) => {
  // down() removes only what up() added. The meter row and the collection go;
  // nothing else on fellows or fellow_meter is touched.
  try { app.delete(app.findCollectionByNameOrId("fellow_submissions")); } catch (_) {}
  try {
    const f = app.findCollectionByNameOrId("fellows");
    const y = f.fields.getByName("youtube");
    if (y) { f.fields.removeById(y.id); app.save(f); }
  } catch (_) {}
  try {
    const m = app.findFirstRecordByFilter("fellow_meter", "name = 'oembed'");
    if (m) app.delete(m);
  } catch (_) {}
});
