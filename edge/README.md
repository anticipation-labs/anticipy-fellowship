# anticipyfellowship.com

This directory contains the retired Vercel front door for
`anticipyfellowship.com`. It is retained only as a rollback reference and is
not part of the live request path.

Cloudflare now owns the authoritative DNS and terminates TLS for the domain.
The apex and `www` hostnames route directly to the `anticipy-fellowships`
Worker through `wrangler.toml`. The Worker serves the fellowship pages,
implements the `/fellows/*` API, and stores application state in the
`anticipy-fellowship` D1 database.

The Vercel project originally existed separately from the main `anticipy`
project for two reasons:

1. The fellowship is not the marketing site. Keeping it here means a deploy of
   anticipy.ai cannot take the fellowship down, and vice versa.
2. The forwarding is a CATCH-ALL (`/:path*`), not an enumerated list. Adding a
   route to the Worker needs no change here. The main site's enumerated
   `/internal/*` list has caused two outages by being forgotten; this cannot.

The only enumerated entries are deliberate:
  * three pretty URLs, because PocketBase serves `fellowships.html` and people
    should not have to type `.html`;
  * four DENY entries, because HQ lives on the same PocketBase and must not be
    reachable from the fellowship domain. The Worker also refuses those paths
    itself — belt and braces.

Do not redeploy this project during normal releases. Cloudflare Builds deploys
the Worker from `main`, and the Worker routes are the live domain attachment.
