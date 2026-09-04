# Anticipy Fellowship

Live at **https://anticipyfellowship.com**.

Four tracks. One of them teaches you and pays you; three of them are an
application and then a conversation. Everything a fellow touches is in this
repository.

---

## How a request gets here

```
browser
  -> anticipyfellowship.com          DNS at Porkbun (A -> Vercel)
  -> Vercel project "anticipy-fellowship"   edge/vercel.json in this repo
  -> catch-all rewrite /:path*
  -> Railway service "backend"        PocketBase, project anticipy-production
  -> pb_hooks/*.pb.js  +  pb_public/*.html  +  pb_public/assets/*   this repo
```

The Vercel project is a front door and nothing else: it terminates TLS, maps
three pretty URLs onto the `.html` files PocketBase actually serves, denies
four HQ paths, and forwards everything else untouched.

The forwarding is a **catch-all**, deliberately. Adding a `/fellows/*` route
needs no change at the edge. The marketing site's enumerated rewrite list has
taken production down twice by being forgotten; this cannot.

`anticipy.ai` keeps exactly two fellowship-adjacent things, both on purpose:
`/r/:code` (the sales link — it redirects to the shop with `?ref=`, so it
belongs on the domain that sells the product) and four 302s carrying the old
fellowship URLs here.

---

## How this ships, and why HQ is not here

The fellowship and **HQ** — the team's private workspace — run inside **one
PocketBase instance, on one database, on purpose**. Every application writes a
row into HQ's activity feed, and the fellows admin route reads both sides.
Splitting the database would break that.

So this repo holds the fellowship half only. HQ (`internal_hq.pb.js`, team
phone numbers, the expense log, the password vault) is deliberately absent —
that is the whole reason this repo exists separately, so somebody can work on
the fellowship without being handed all of that.

### Merging to `main` ships. You do not deploy by hand.

`.github/workflows/ship.yml` runs on every push to `main`:

1. **Syntax gate** — every hook, migration and page script must parse. A broken
   hook does not just break the fellowship; HQ runs in the same PocketBase and
   would go down with it.
2. **Sync** — the fellowship files are copied into the private
   `omize10/anticipy-backend` repo, which holds the other half (HQ). You do not
   need access to that repo, and you will not be given it.
3. **Railway rebuilds** from that push.
4. **Byte-verify** — the workflow then fetches
   `https://anticipyfellowship.com/fellowships.html` and its local image assets,
   and compares them byte for byte against this commit. If they do not match
   within ten minutes the run **fails loudly**.

That last step exists because `railway up` has reported success while failing.
A green check here means the bytes on the live site are the bytes in this
commit. Nothing less counts.

`deploy.sh` is still here for deploying from a laptop that has the backend
tree, but you should not need it.

---

## Layout

| path | what |
|---|---|
| `pb_hooks/fellowship.pb.js` | signup, the four tracks, applications, submissions, the referral redirect, the admin roster |
| `pb_hooks/fellowship_payouts.pb.js` | the money rail. Read its header before touching it. |
| `pb_hooks/fellowship_guardian.pb.js` | parental consent for under-18s |
| `pb_hooks/fellowship_host.pb.js` | refuses HQ paths when the host is the fellowship domain |
| `pb_public/fellowships.html` | public fellowship story, three tracks, FAQ, and external application link |
| `pb_public/assets/` | the fellowship page's versioned image and favicon assets |
| `pb_public/fellowship-growth-learning.html` | the course. 9 units, 30 lessons. |
| `pb_migrations/` | schema. 8 collections. Migrations run at boot and are additive. |
| `gate/fellowship_gate.py` | the scoreboard. Start here. |
| `edge/` | the Vercel front door |
| `tests/` | node test suites, run against a live origin |

### One rule that will bite you

**PocketBase's JS VM gives every route handler its own scope.** A `const` at
the top of a hook file is *not* visible inside a `routerAdd` callback. Every
handler redeclares its own helpers and constants. This is not untidy code —
"tidying" it into shared functions is how you get a 500 in production. Crons
have no `e` at all; they use `$app`.

---

## The scoreboard

```bash
ANTICIPY_INTERNAL_KEY=<team key> python3 gate/fellowship_gate.py --verbose
```

Eight legs over the whole journey a fellow actually walks — get in, find the
community, learn what this is, learn to make one, make one, log it, see what
you are owed, get paid. It measures the **live site**, writes one real row and
removes it, and prints one line: `DONE`, or `NOT DONE - first failing leg: N`.

A leg that cannot be tested **fails**. It never passes by default.

Work the first failing leg. Not the next feature.

---

## Known gaps, stated plainly

Do not discover these the hard way:

1. **Sign-in is unverified.** `POST /fellows/start` returns a 90-day session
   for whatever email is typed. If that email is an existing fellow, it mints
   the session on *their* row. `/fellows/code` and `/fellows/verify` implement
   the emailed code properly and are called by no page. Most fellows are
   minors. This is the top of the list.
2. **Nothing creates a conversion.** The referral link redirects and the click
   is counted, then the chain stops: the shop never reads `?ref=`, and no
   route, cron or hook writes a `fellow_conversions` row. Both hooks that
   mention that table only read it. So nobody can ever be owed anything.
3. **The payout rail has no vendor key.** Every `TREMENDOUS_*` variable is
   unset, so it cannot send even in sandbox. The rail itself is sound.
4. **No admin screen.** `GET /internal/fellows` returns the whole roster in
   one call and nothing on any page calls it.
5. **The Discord invite expires.** It is a constant in `fellowships.html`.

---

## Configuration

No secrets live in this repo, and none should. Everything is read from the
environment by name, on the Railway `backend` service:

`ANTICIPY_FELLOWSHIP_URL` (this domain) · `ANTICIPY_SITE_URL` (the shop, where
`?ref=` goes) · `ANTICIPY_INTERNAL_KEY` · `RESEND_API_KEY` ·
`OPENROUTER_API_KEY` · `ANTICIPY_FELLOW_SALT` · the `TREMENDOUS_*` set ·
and the `ANTICIPY_FELLOW_*` ceilings, which all have sane defaults.

The two URL variables are **different on purpose** and one email legitimately
contains both: the confirm link and the lessons are the fellowship; the
referral link is the shop.
