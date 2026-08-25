# anticipyfellowship.com

This project is a front door and nothing else. It owns the domain, terminates
TLS, and forwards every request to the PocketBase backend on Railway, which is
where the fellowship pages and the /fellows/* API actually live.

Two reasons it exists as its own Vercel project rather than more rewrites on the
main `anticipy` project:

1. The fellowship is not the marketing site. Keeping it here means a deploy of
   anticipy.ai cannot take the fellowship down, and vice versa.
2. The forwarding is a CATCH-ALL (`/:path*`), not an enumerated list. Adding a
   route to the backend needs no change here. The main site's enumerated
   `/internal/*` list has caused two outages by being forgotten; this cannot.

The only enumerated entries are deliberate:
  * three pretty URLs, because PocketBase serves `fellowships.html` and people
    should not have to type `.html`;
  * four DENY entries, because HQ lives on the same PocketBase and must not be
    reachable from the fellowship domain. The backend also refuses those paths
    on this hostname (pb_hooks/fellowship_host.pb.js) — belt and braces.
