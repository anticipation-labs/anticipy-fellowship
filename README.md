# Anticipy Fellowship

Live at **https://anticipyfellowship.com**.

Four tracks. One of them teaches you and pays you; three of them are an
application and then a conversation. Everything a fellow touches is in this
repository.

---

## How a request gets here

```
browser
  -> anticipyfellowship.com          Cloudflare authoritative DNS
  -> Cloudflare Worker "anticipy-fellowships"
  -> cloudflare/index.js + D1 + pb_public/*   this repo
```

Porkbun remains the registrar, but Cloudflare is the authoritative DNS and TLS
edge. The apex and `www` hostnames are attached directly to the Worker through
the routes in `wrangler.toml`. The old Vercel front-door configuration remains
in `edge/` only as a rollback reference; it is not in the live request path.

`anticipy.ai` keeps exactly two fellowship-adjacent things, both on purpose:
`/r/:code` (the sales link — it redirects to the shop with `?ref=`, so it
belongs on the domain that sells the product) and four 302s carrying the old
fellowship URLs here.

---

## How this ships

The fellowship now runs on the `anticipy-fellowships` Cloudflare Worker. Static
pages and images come from `pb_public/`; application state lives in the
`anticipy-fellowship` D1 database. The `DB` and `ASSETS` bindings are declared
in `wrangler.toml`.

HQ remains deliberately absent. Team phone numbers, expenses, credentials and
other private workspace data do not belong in this repository or Worker.

### Merging to `main` ships. You do not deploy by hand.

Cloudflare Builds is connected to this repository and deploys `main` using the
pinned Wrangler configuration. `.github/workflows/ship.yml` then independently:

1. runs every local syntax and behavioral check;
2. validates the Wrangler deployment without publishing it;
3. byte-verifies the Worker page and assets against the commit; and
4. byte-verifies the same files through `anticipyfellowship.com`.

A green `ship` check means the Cloudflare origin and public domain contain the
exact bytes in the commit. Nothing less counts.

`deploy.sh` is an explicit manual fallback. It runs the local suite before a
Wrangler deployment and should not normally be needed.

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
| `cloudflare/index.js` | the deployed Worker entrypoint recovered from the current production version |
| `wrangler.toml` | Worker assets, D1 binding, public variables, and cron schedule |
| `edge/` | retired Vercel front-door configuration retained as a rollback reference |
| `scripts/check.sh` | local-only syntax and behavioral checks |
| `tests/` | local behavioral test suites |

The Worker entrypoint is currently a generated bundle. The readable PocketBase
hook files remain useful as the behavioral source and test fixture, but changing
a hook does **not** rebuild `cloudflare/index.js`. Restore or document the
adapter build pipeline before making backend feature changes; otherwise a
green source diff could omit the runtime change.

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

Do not run the scoreboard against production without explicit approval;
`npm run check` is the safe local suite.

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

## Local development

Install Node.js 24, then:

```bash
npm ci
npm run check
npm run deploy:cloudflare:dry-run
```

For a static preview, serve `pb_public/` from any local HTTP server. Do not use
production credentials or point the scoreboard at the live Worker while
developing. Put local-only Worker values in `.dev.vars`; it is gitignored.

---

## Configuration

No secrets live in this repo, and none should. Everything is read from the
environment by name on the Cloudflare Worker:

`ANTICIPY_FELLOWSHIP_URL` (this domain) · `ANTICIPY_SITE_URL` (the shop, where
`?ref=` goes) · `ANTICIPY_INTERNAL_KEY` · `RESEND_API_KEY` ·
`OPENROUTER_API_KEY` · `ANTICIPY_FELLOW_SALT` · the `TREMENDOUS_*` set ·
and the `ANTICIPY_FELLOW_*` ceilings, which all have sane defaults.

The two URL variables are **different on purpose** and one email legitimately
contains both: the confirm link and the lessons are the fellowship; the
referral link is the shop.

Only the two public URL values belong in `wrangler.toml`. Supply secrets through
Cloudflare's encrypted secret settings, never Git: `ANTICIPY_INTERNAL_KEY`,
`RESEND_API_KEY`, `OPENROUTER_API_KEY`, `ANTICIPY_FELLOW_SALT`, and—only when
the team is ready to test payouts—the `TREMENDOUS_*` values. The
`ANTICIPY_FELLOW_*` ceilings are optional plain configuration because safe
defaults exist.
