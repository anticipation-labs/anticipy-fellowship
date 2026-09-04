/// <reference path="../pb_data/types.d.ts" />
//
// THE FELLOWSHIP HOST ONLY SERVES THE FELLOWSHIP.
//
// One PocketBase serves three things: the fellowship, HQ, and the referral
// redirect. That was fine while the only public address was anticipy.ai,
// because the Next.js middleware put a passcode in front of /internal before
// anything reached here.
//
// anticipyfellowship.com points STRAIGHT at this backend. There is no edge in
// front of it, so that passcode does not exist on this hostname — and HQ is
// reachable at two paths, /internal/* and the older /fellows/hq fallback. HQ
// still has its own key, so this is not the only lock; it is the difference
// between "a stranger needs the key" and "a stranger never learns there is a
// door". A page listing three people's phone numbers should not be discovered
// by typing a fellowship URL.
//
// This is deliberately a DENY LIST of two prefixes rather than an allow list
// of fellowship paths: PocketBase serves its own /api/* and pb_public, an
// allow list would have to enumerate all of it, and an enumerated list that
// someone forgets to update is exactly the bug that has already cost this
// project two outages.
routerUse((e) => {
  // Go puts the authority in Request.Host, not in the header map, but read
  // both — a guard that silently fails open because a field was named
  // differently is worse than no guard, because it looks like one.
  // THREE PLACES, because the answer depends on the topology. At the origin,
  // the hostname is in Request.Host. Behind a front door, Request.Host can be
  // the origin hostname and the public one is in X-Forwarded-Host — so a guard
  // that read only Request.Host could silently stop guarding when a proxy is
  // introduced, which is the failure mode that looks exactly like working.
  let host = "";
  try { host = String(e.request.header.get("X-Forwarded-Host") || ""); } catch (_) {}
  if (!host) { try { host = String(e.request.host || ""); } catch (_) {} }
  if (!host) { try { host = String(e.request.header.get("Host") || ""); } catch (_) {} }
  host = host.toLowerCase().split(",")[0].trim().split(":")[0];

  const FELLOWSHIP_ONLY = ["anticipyfellowship.com", "www.anticipyfellowship.com"];
  if (FELLOWSHIP_ONLY.indexOf(host) < 0) return e.next();

  let path = "";
  try { path = String(e.request.url.path || ""); } catch (_) {}
  if (path.indexOf("/internal") === 0 || path === "/fellows/hq") {
    // 404, not 403. A 403 confirms the thing exists.
    return e.json(404, { error: "not found" });
  }
  return e.next();
});
