// THE VIDEO SUBMISSION SYSTEM. A fellow pastes a link and it is kept.
//
// Four things here are load-bearing and are asserted, not trusted:
//
//   1. THE PARSER IS EXECUTED, NOT GREPPED. Every regex in the hook is pulled
//      out of the source and run against a table of real URL shapes — the ones
//      TikTok's share sheet, Instagram's copy-link and YouTube's mobile app
//      actually produce, junk parameters included — and against a table of
//      things that must be refused. A test that only checks a regex EXISTS
//      passes forever while the regex is wrong.
//   2. DEDUPE IS ON THE NORMALISED URL, and the surface is not part of the
//      key. /p/<code> and /reel/<code> are one Instagram post; /shorts/<id>
//      and /watch?v=<id> are one YouTube video; twitter.com and x.com are one
//      site. Any of those being two keys is a hole you can log one thing twice
//      through.
//   3. WE STORE NOTHING WE HAVE NOT VERIFIED. There is no view count, no like
//      count and no posted_at, because none of the five platforms will tell a
//      server any of those without the fellow connecting an account to us.
//   4. NOTHING HERE READS AS A QUOTA. Posting is optional and to their own
//      account. No target, no streak, no leaderboard, and no number a person
//      could feel behind on.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = readFileSync(join(ROOT, "backend/pb_hooks/fellowship.pb.js"), "utf8");
const MIG = readFileSync(join(ROOT, "backend/pb_migrations/1700000046_fellow_submissions.js"), "utf8");
const FUNNEL = readFileSync(join(ROOT, "backend/pb_public/fellowships.html"), "utf8");

// A copy assertion has to read what a PERSON sees, not how the source happens
// to be formatted: these pages build sentences by concatenating string
// literals and write apostrophes as entities.
const asText = (s) => s
  .replace(/['"]\s*\n?\s*\+\s*['"]/g, "")
  .replace(/\\'/g, "'")
  .replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&mdash;/g, "—")
  .replace(/\s+/g, " ");
// An assertion that a bad pattern is ABSENT has to ignore the comment that
// explains why it was removed — otherwise fixing a bug and documenting the fix
// makes the test for it fail, which teaches you to stop documenting.
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
  .replace(/<!--[\s\S]*?-->/g, "");
const HOOK_CODE = stripComments(HOOK);
const MIG_CODE = stripComments(MIG);
const FUNNEL_TEXT = asText(FUNNEL);
// The same, with the explanatory comments removed. Every "this must NOT appear"
// assertion reads this one, or documenting a fix breaks the test for the fix.
const FUNNEL_SEEN = asText(stripComments(FUNNEL));
const PUBLIC_MARKETING = /const APPLICATION_URL\s*=/.test(FUNNEL) &&
  /data-apply-link/.test(FUNNEL);

// These assertions describe the retired in-page submission dashboard. The
// backend submission contract remains fully covered; the current public page's
// marketing and application-link contract lives in test_fellowship.mjs.
const isLegacyPublicFunnelCheck = (name) => name.startsWith("copy:") || [
  "author: the need_handle refusal has somewhere to actually put the handle",
  "author: and asking for it is not styled as the person's mistake",
  "verified: and nothing on screen shows a dash where a number would be",
  "verified: the screen says WHY, and gives the numbers we do own",
  "escape: renderSubs exists and builds the list",
  "escape: no submission field is concatenated into HTML unescaped",
  "escape: the href goes through esc() too, even though the server canonicalises it",
  "escape: the title, the note, the id and the platform all go through esc()",
  "escape: an outbound link cannot reach back into the tab that opened it",
].includes(name);

let failures = 0;
const check = (name, ok, detail) => {
  if (PUBLIC_MARKETING && isLegacyPublicFunnelCheck(name)) {
    console.log(`SKIP: ${name} (legacy public funnel is not mounted)`);
    return;
  }
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok || !detail ? "" : "  -> " + detail}`);
  if (!ok) failures++;
};

// ==========================================================================
// 0. PULL THE REAL PARSER OUT OF THE HOOK AND RUN IT
//
// Same trick the course test uses on COURSE: the source is the truth, so the
// source is what gets executed. If the markers are ever removed this file
// stops with an assert rather than quietly testing nothing.
// ==========================================================================
const OPEN = "==== fellowship url parser 8<";
const CLOSE = ">8 end parser ===";
const a = HOOK.indexOf(OPEN), b = HOOK.indexOf(CLOSE);
assert.ok(a > 0 && b > a, "the parser markers are gone from fellowship.pb.js");
const parserSrc = HOOK.slice(HOOK.indexOf("\n", a) + 1, HOOK.lastIndexOf("\n", b));
const sbox = {};
vm.createContext(sbox);
vm.runInContext(parserSrc + "\n; this.parse = parseSubmittedUrl;", sbox);
const parse = sbox.parse;
assert.ok(typeof parse === "function", "parseSubmittedUrl did not come out of the hook");

// ==========================================================================
// 1. EVERY REAL URL SHAPE, PER PLATFORM, THAT MUST PARSE
//
// These are the shapes the platforms themselves hand a person: the desktop
// address bar, the app's Copy link, the mobile site, and the tracking junk
// each one staples on. [pasted, platform, url_key, canonical, kind]
// ==========================================================================
const MUST_PARSE = [
  // ---- TikTok ------------------------------------------------------------
  ["https://www.tiktok.com/@tiktok/video/7106594312292453675",
    "tiktok", "tiktok:7106594312292453675", "https://www.tiktok.com/@tiktok/video/7106594312292453675", "video"],
  ["https://www.tiktok.com/@omar.makes/video/7106594312292453675?is_from_webapp=1&sender_device=pc&web_id=723",
    "tiktok", "tiktok:7106594312292453675", "https://www.tiktok.com/@omar.makes/video/7106594312292453675", "video"],
  ["https://www.tiktok.com/@tiktok/video/7106594312292453675/",
    "tiktok", "tiktok:7106594312292453675", "https://www.tiktok.com/@tiktok/video/7106594312292453675", "video"],
  ["http://www.tiktok.com/@tiktok/video/7106594312292453675",
    "tiktok", "tiktok:7106594312292453675", "https://www.tiktok.com/@tiktok/video/7106594312292453675", "video"],
  ["www.tiktok.com/@tiktok/video/7106594312292453675",
    "tiktok", "tiktok:7106594312292453675", "https://www.tiktok.com/@tiktok/video/7106594312292453675", "video"],
  ["tiktok.com/@tiktok/video/7106594312292453675",
    "tiktok", "tiktok:7106594312292453675", "https://www.tiktok.com/@tiktok/video/7106594312292453675", "video"],
  ["  https://www.tiktok.com/@tiktok/video/7106594312292453675#foo  ",
    "tiktok", "tiktok:7106594312292453675", "https://www.tiktok.com/@tiktok/video/7106594312292453675", "video"],
  // A slideshow. Same identity space as a video — TikTok numbers them together.
  ["https://www.tiktok.com/@omar.makes/photo/7106594312292453675",
    "tiktok", "tiktok:7106594312292453675", "https://www.tiktok.com/@omar.makes/video/7106594312292453675", "photo"],
  // The old mobile form. No handle in it at all, so the canonical stays the
  // /v/ shape rather than inventing an @name we never verified.
  ["https://m.tiktok.com/v/7106594312292453675.html",
    "tiktok", "tiktok:7106594312292453675", "https://www.tiktok.com/v/7106594312292453675.html", "video"],

  // ---- Instagram ---------------------------------------------------------
  ["https://www.instagram.com/p/BsOGulcndj-/",
    "instagram", "instagram:BsOGulcndj-", "https://www.instagram.com/p/BsOGulcndj-/", "post"],
  ["https://www.instagram.com/reel/C1a2B3c4D5e/?igsh=MWx0YQ%3D%3D",
    "instagram", "instagram:C1a2B3c4D5e", "https://www.instagram.com/reel/C1a2B3c4D5e/", "reel"],
  ["https://www.instagram.com/reels/C1a2B3c4D5e/",
    "instagram", "instagram:C1a2B3c4D5e", "https://www.instagram.com/reel/C1a2B3c4D5e/", "reel"],
  ["https://www.instagram.com/tv/C1a2B3c4D5e/",
    "instagram", "instagram:C1a2B3c4D5e", "https://www.instagram.com/p/C1a2B3c4D5e/", "video"],
  ["https://www.instagram.com/omar.makes/reel/C1a2B3c4D5e/",
    "instagram", "instagram:C1a2B3c4D5e", "https://www.instagram.com/reel/C1a2B3c4D5e/", "reel"],
  ["https://www.instagram.com/omar.makes/p/BsOGulcndj-/?img_index=2",
    "instagram", "instagram:BsOGulcndj-", "https://www.instagram.com/p/BsOGulcndj-/", "post"],
  ["https://instagr.am/p/BsOGulcndj-/",
    "instagram", "instagram:BsOGulcndj-", "https://www.instagram.com/p/BsOGulcndj-/", "post"],

  // ---- YouTube -----------------------------------------------------------
  ["https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "youtube", "youtube:dQw4w9WgXcQ", "https://www.youtube.com/shorts/dQw4w9WgXcQ", "short"],
  ["https://www.youtube.com/shorts/dQw4w9WgXcQ?si=abc123XYZ",
    "youtube", "youtube:dQw4w9WgXcQ", "https://www.youtube.com/shorts/dQw4w9WgXcQ", "short"],
  ["https://m.youtube.com/shorts/dQw4w9WgXcQ",
    "youtube", "youtube:dQw4w9WgXcQ", "https://www.youtube.com/shorts/dQw4w9WgXcQ", "short"],
  ["https://youtu.be/dQw4w9WgXcQ?si=abc123XYZ",
    "youtube", "youtube:dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "video"],
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "youtube", "youtube:dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "video"],
  ["https://www.youtube.com/watch?si=xyz&v=dQw4w9WgXcQ&t=30s&ab_channel=Rick",
    "youtube", "youtube:dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "video"],
  ["https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=youtu.be",
    "youtube", "youtube:dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "video"],
  ["https://www.youtube.com/live/dQw4w9WgXcQ",
    "youtube", "youtube:dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "video"],
  ["https://www.youtube.com/embed/dQw4w9WgXcQ",
    "youtube", "youtube:dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "video"],

  // ---- X -----------------------------------------------------------------
  ["https://x.com/jack/status/20",
    "x", "x:20", "https://x.com/jack/status/20", "post"],
  ["https://twitter.com/jack/status/20?s=20&t=aBcDeF",
    "x", "x:20", "https://x.com/jack/status/20", "post"],
  ["https://mobile.twitter.com/jack/status/20",
    "x", "x:20", "https://x.com/jack/status/20", "post"],
  ["https://x.com/jack/status/20/photo/1",
    "x", "x:20", "https://x.com/jack/status/20", "post"],
  ["https://x.com/jack/statuses/20",
    "x", "x:20", "https://x.com/jack/status/20", "post"],
  ["https://twitter.com/jack/status/20?ref_src=twsrc%5Etfw",
    "x", "x:20", "https://x.com/jack/status/20", "post"],

  // ---- LinkedIn ----------------------------------------------------------
  ["https://www.linkedin.com/posts/omar-ebrahim_i-made-a-thing-activity-7123456789012345678-AbCd/",
    "linkedin", "linkedin:7123456789012345678",
    "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/", "post"],
  ["https://www.linkedin.com/posts/omar-ebrahim_x-activity-7123456789012345678-AbCd?trackingId=q%2F1&rcm=ACo",
    "linkedin", "linkedin:7123456789012345678",
    "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/", "post"],
  ["https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/",
    "linkedin", "linkedin:7123456789012345678",
    "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/", "post"],
  ["https://www.linkedin.com/feed/update/urn:li:share:7123456789012345678/",
    "linkedin", "linkedin:7123456789012345678",
    "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/", "post"],
  ["https://www.linkedin.com/feed/update/urn:li:ugcPost:7123456789012345678/",
    "linkedin", "linkedin:7123456789012345678",
    "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/", "post"],
  ["https://www.linkedin.com/pulse/how-i-made-a-thing-omar-ebrahim?originalSubdomain=ca",
    "linkedin", "linkedin:pulse:how-i-made-a-thing-omar-ebrahim",
    "https://www.linkedin.com/pulse/how-i-made-a-thing-omar-ebrahim", "article"],
];

{
  const wrong = [];
  for (const [pasted, platform, key, canon, kind] of MUST_PARSE) {
    const r = parse(pasted);
    if (!r.ok) { wrong.push(`${pasted} -> REFUSED (${r.code})`); continue; }
    if (r.platform !== platform) wrong.push(`${pasted} -> platform ${r.platform} not ${platform}`);
    if (r.url_key !== key) wrong.push(`${pasted} -> key ${r.url_key} not ${key}`);
    if (r.url !== canon) wrong.push(`${pasted} -> url ${r.url} not ${canon}`);
    if (r.kind !== kind) wrong.push(`${pasted} -> kind ${r.kind} not ${kind}`);
  }
  check(`urls: all ${MUST_PARSE.length} real shapes parse to the right platform, key, canonical and kind`,
    wrong.length === 0, wrong.slice(0, 4).join(" | "));

  // The canonical form has to be a FIXED POINT of the parser. A canonicaliser
  // that can emit something its own parser rejects will one day emit a URL
  // that points somewhere else — and that URL is the one rendered as a link.
  const drift = [];
  for (const [pasted] of MUST_PARSE) {
    const r = parse(pasted);
    if (!r.ok) continue;
    const again = parse(r.url);
    if (!again.ok || again.url !== r.url || again.url_key !== r.url_key) {
      drift.push(`${r.url} -> ${again.ok ? again.url : "REFUSED"}`);
    }
  }
  check("urls: every canonical form re-parses to itself", drift.length === 0, drift.slice(0, 3).join(" | "));
}

// ==========================================================================
// 2. THE JUNK, AND WHAT EACH REFUSAL HAS TO SAY
// ==========================================================================
const MUST_REFUSE = [
  ["", "junk"],
  ["   ", "junk"],
  ["not-a-url", "junk"],
  ["hello", "junk"],
  ["javascript:alert(document.cookie)", "junk"],
  ["data:text/html,<script>alert(1)</script>", "junk"],
  ["mailto:someone@example.com", "junk"],
  ["ftp://www.tiktok.com/@a/video/7106594312292453675", "junk"],
  // The authority is a hostname and nothing else. Here the REAL host is
  // evil.com and everything before the @ is a username.
  ["https://tiktok.com@evil.com/@a/video/7106594312292453675", "junk"],
  ["https://" + "a".repeat(2100) + ".com/x", "junk"],

  // Host spoofing. A dot where a slash must be, and a prefix in front of the
  // anchor. Both look like the real thing to a careless regex.
  ["https://tiktok.com.evil.com/@a/video/7106594312292453675", "unknown"],
  ["https://eviltiktok.com/@a/video/7106594312292453675", "unknown"],
  ["https://evil.com/?x=https://www.tiktok.com/@a/video/7106594312292453675", "unknown"],
  ["https://www.instagram.com.evil.com/reel/C1a2B3c4D5e/", "unknown"],
  // Platforms we do not track.
  ["https://vimeo.com/76979871", "unknown"],
  ["https://www.facebook.com/watch/?v=1234567890", "unknown"],
  ["https://www.snapchat.com/spotlight/abc", "unknown"],
  ["https://www.twitch.tv/videos/123456", "unknown"],

  // Short links: refused, never resolved.
  ["https://vm.tiktok.com/ZMhqABCDE/", "short"],
  ["https://vt.tiktok.com/ZSabcdefg/", "short"],
  ["https://www.tiktok.com/t/ZTabcdefg/", "short"],
  ["https://t.co/aBcD1234", "short"],
  ["https://lnkd.in/eXaMPle", "short"],

  // The right platform, but not a post.
  ["https://www.tiktok.com/@tiktok", "not_a_post"],
  ["https://www.instagram.com/omar.makes/", "not_a_post"],
  ["https://www.youtube.com/@RickAstleyYT", "not_a_post"],
  ["https://www.youtube.com/watch?v=tooshort", "not_a_post"],
  ["https://x.com/jack", "not_a_post"],
  ["https://www.linkedin.com/in/omar-ebrahim/", "not_a_post"],
];

{
  const wrong = [];
  for (const [pasted, code] of MUST_REFUSE) {
    const r = parse(pasted);
    if (r.ok) { wrong.push(`${pasted.slice(0, 60)} -> ACCEPTED as ${r.url_key}`); continue; }
    if (r.code !== code) wrong.push(`${pasted.slice(0, 60)} -> ${r.code} not ${code}`);
  }
  check(`urls: all ${MUST_REFUSE.length} junk and hostile shapes are refused for the right reason`,
    wrong.length === 0, wrong.slice(0, 4).join(" | "));

  // THE HARD REQUIREMENT: a URL that is not one of the five is told which five
  // work. "That's not supported" sends someone away with nothing to do.
  const namesAllFive = (m) => /TikTok/.test(m) && /Instagram/.test(m) && /YouTube/.test(m) &&
                              /\bX\b/.test(m) && /LinkedIn/.test(m);
  const silent = MUST_REFUSE
    .filter(([, code]) => code === "unknown")
    .map(([u]) => [u, parse(u).message])
    .filter(([, m]) => !namesAllFive(m));
  check("urls: every refusal of an unknown platform names all five that do work",
    silent.length === 0, silent.slice(0, 2).map(([u, m]) => u.slice(0, 40) + " -> " + m).join(" | "));
  // And so does the empty box and the thing that is not a link at all, because
  // those are the two moments a person is most likely to be guessing.
  check("urls: the empty box and a non-link also name the five",
    namesAllFive(parse("").message) && namesAllFive(parse("not-a-url").message),
    parse("not-a-url").message);

  // A short link tells them what to do INSTEAD, per platform, and never blames
  // them for pasting what the share sheet handed them.
  check("urls: the TikTok short link says to use Copy link from the video page",
    /Copy link/i.test(parse("https://vm.tiktok.com/ZMhqABCDE/").message));
  check("urls: t.co and lnkd.in each get their own sentence",
    /t\.co/.test(parse("https://t.co/aBcD1234").message) &&
    /lnkd\.in/.test(parse("https://lnkd.in/eXaMPle").message));
  check("urls: a known platform that isn't a post is named, not lumped in with the unknown",
    /YouTube/.test(parse("https://www.youtube.com/@RickAstleyYT").message) &&
    !/We only track/.test(parse("https://www.youtube.com/@RickAstleyYT").message));

  // Nothing we say to someone who got it wrong may scold them.
  const rude = MUST_REFUSE.map(([u]) => parse(u).message || "")
    .filter((m) => /\byou (must|failed|should have)\b|\binvalid\b|\berror\b|\bwrong\b/i.test(m));
  check("urls: no refusal message scolds the person", rude.length === 0, rude.slice(0, 2).join(" | "));
}

// ==========================================================================
// 3. NORMALISATION — the two steps that silently destroy data if got wrong
// ==========================================================================
{
  // A blanket toLowerCase() turns dQw4w9WgXcQ into dqw4w9wgxcq and every
  // YouTube id and Instagram shortcode into a 404 — and the failure then looks
  // like the platform being down rather than like our bug.
  const y = parse("HTTPS://WWW.YOUTUBE.COM/shorts/dQw4w9WgXcQ");
  check("normalise: the scheme and host are lowercased and the path is NOT",
    y.ok && y.native_id === "dQw4w9WgXcQ" && y.url === "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    JSON.stringify(y));
  const i = parse("https://www.INSTAGRAM.com/p/BsOGulcndj-/");
  check("normalise: an Instagram shortcode keeps its case",
    i.ok && i.native_id === "BsOGulcndj-", JSON.stringify(i));

  // A phone share sheet really does paste these, and they are invisible.
  const z = parse("https://www.tiktok.com/@tiktok/video/7106594312292453675​");
  check("normalise: zero-width and bidi characters are stripped before any regex runs",
    z.ok && z.url_key === "tiktok:7106594312292453675", JSON.stringify(z));

  // The canonical is REBUILT from the id, so there is no strip-list to keep
  // up to date — nothing from the query string is carried across at all.
  const junky = "https://www.tiktok.com/@tiktok/video/7106594312292453675?is_from_webapp=1"
    + "&sender_device=pc&sender_web_id=7&_r=1&_t=8k&checksum=abc&share_app_id=1233"
    + "&utm_source=x&utm_medium=y&utm_campaign=z";
  const j = parse(junky);
  check("normalise: every tracking parameter is gone from the canonical",
    j.ok && j.url === "https://www.tiktok.com/@tiktok/video/7106594312292453675" &&
    !/[?&]/.test(j.url), j.url);
  // The one parameter that survives anywhere, and it survives as a captured
  // id rather than as a parameter.
  const w = parse("https://www.youtube.com/watch?si=xyz&v=dQw4w9WgXcQ&pp=abc");
  check("normalise: YouTube's v is the only query value kept, and only as an id",
    w.ok && w.url === "https://www.youtube.com/watch?v=dQw4w9WgXcQ", w.url);

  check("normalise: http is upgraded and a missing scheme is supplied",
    parse("http://x.com/jack/status/20").url === "https://x.com/jack/status/20" &&
    parse("x.com/jack/status/20").url === "https://x.com/jack/status/20");
  check("normalise: the fragment never survives",
    parse("https://x.com/jack/status/20#anchor").url === "https://x.com/jack/status/20");
}

// ==========================================================================
// 4. DEDUPE IS ON THE NORMALISED URL, AND THE SURFACE IS NOT IN THE KEY
// ==========================================================================
{
  const same = (name, list) => {
    const keys = [...new Set(list.map((u) => { const r = parse(u); return r.ok ? r.url_key : "REFUSED:" + u; }))];
    check(name, keys.length === 1, keys.join(" | "));
  };
  // One YouTube video has three surfaces. Two keys here would be a hole wide
  // enough to log the same video twice through.
  same("dedupe: /shorts/, /watch?v= and youtu.be are ONE YouTube key", [
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://m.youtube.com/shorts/dQw4w9WgXcQ?si=zz",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
  ]);
  // /p/ and /reel/ serve the same post. If the kind were in the key, editing
  // one word would let anybody log a reel twice.
  same("dedupe: /p/, /reel/, /reels/, /tv/ and the /<user>/ prefix are ONE Instagram key", [
    "https://www.instagram.com/p/C1a2B3c4D5e/",
    "https://www.instagram.com/reel/C1a2B3c4D5e/",
    "https://www.instagram.com/reels/C1a2B3c4D5e/",
    "https://www.instagram.com/tv/C1a2B3c4D5e/",
    "https://www.instagram.com/omar.makes/reel/C1a2B3c4D5e/?igsh=q",
    "https://instagr.am/p/C1a2B3c4D5e/",
  ]);
  same("dedupe: twitter.com and x.com are ONE key", [
    "https://twitter.com/jack/status/20",
    "https://x.com/jack/status/20?s=46",
    "https://mobile.twitter.com/jack/status/20/photo/1",
  ]);
  // The @handle in a TikTok URL is DECORATIVE — TikTok's own oEmbed returns
  // the true author for a URL carrying a deliberately wrong one. So it must
  // not be part of the identity, or anyone could log one video twice by
  // editing a name.
  same("dedupe: the TikTok handle is not part of the key, because TikTok says it is decorative", [
    "https://www.tiktok.com/@tiktok/video/7106594312292453675",
    "https://www.tiktok.com/@somebodyelse/video/7106594312292453675",
    "https://m.tiktok.com/v/7106594312292453675.html",
  ]);
  same("dedupe: the LinkedIn /posts/ slug and the urn form are ONE key", [
    "https://www.linkedin.com/posts/omar-ebrahim_x-activity-7123456789012345678-AbCd/",
    "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/",
    "https://www.linkedin.com/feed/update/urn:li:share:7123456789012345678/",
  ]);
  // Different posts must NOT collide. The trailing boundary on every id is
  // what stops a longer id matching on its first 25 digits.
  const distinct = [
    "https://www.tiktok.com/@a/video/7106594312292453675",
    "https://www.tiktok.com/@a/video/7106594312292453676",
    "https://www.instagram.com/p/C1a2B3c4D5e/",
    "https://www.instagram.com/p/C1a2B3c4D5f/",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcR",
  ].map((u) => parse(u).url_key);
  check("dedupe: different posts get different keys", new Set(distinct).size === distinct.length,
    distinct.join(" | "));
}

// ==========================================================================
// 5. THE ROUTES
// ==========================================================================
{
  // Leg 5 of overnight/fellowship_gate.py greps THIS file for the route, so
  // the route lives in this file and not in a companion.
  check("routes: POST /fellows/submissions is in fellowship.pb.js where the gate looks",
    /routerAdd\("POST", "\/fellows\/submissions"/.test(HOOK));
  check("routes: a fellow can remove their own", /routerAdd\("POST", "\/fellows\/submissions\/remove"/.test(HOOK));
  check("routes: HQ has its own removal behind the internal key",
    /routerAdd\("POST", "\/internal\/fellows\/submissions\/remove"/.test(HOOK) &&
    /internal HQ is not configured/.test(HOOK.slice(HOOK.indexOf('"/internal/fellows/submissions/remove"'))));

  const route = HOOK.slice(HOOK.indexOf('"/fellows/submissions"'), HOOK.indexOf('"/fellows/submissions/remove"'));
  check("routes: a junk link is a 400 and a junk token is a 401 — the gate checks both",
    /e\.json\(401, \{ reauth: true \}\)/.test(route) &&
    /e\.json\(400, \{ ok: false, field: "url"/.test(route));
  check("routes: a removed fellow's live token dies with them, same as every other route",
    /status"\) === "removed"\) fellow = null/.test(route));

  // WRITE FIRST, INTERPRET THE ERROR SECOND. Look-then-write races two rapid
  // taps: both pass the lookup, both write. The UNIQUE index is the only
  // mutual-exclusion primitive this database offers and it holds inside one
  // INSERT, so the insert IS the check.
  const saveAt = route.indexOf("e.app.save(rec); saved = true");
  const lookupAt = route.indexOf('findFirstRecordByFilter("fellow_submissions", "url_key');
  check("dedupe: the row is written first and the collision is interpreted after",
    saveAt > 0 && lookupAt > saveAt, `save at ${saveAt}, lookup at ${lookupAt}`);

  // THREE OUTCOMES, THREE SENTENCES.
  const routeText = asText(route);
  check("dedupe: their own duplicate is not an error and says when they added it",
    /already: true/.test(route) && /You've already logged this one/.test(routeText) &&
    /you added it on/i.test(routeText));
  // Telling someone "another fellow already logged this" confirms that another
  // fellow exists and confirms what they made. Same sentence-shape and same
  // destination as the `removed` branch of /fellows/start.
  check("dedupe: a collision with ANOTHER fellow never confirms another fellow exists",
    /We can't add that one\. If it's yours, write to hello@anticipy\.ai/.test(routeText) &&
    !/another fellow|someone else (has|already)/i.test(asText(stripComments(route))));
  check("dedupe: but it does write an activity row carrying BOTH ids",
    /fellow\.submission_collision/.test(route) &&
    /other\.getString\("fellow"\)[\s\S]{0,120}fellow\.get\("id"\)/.test(route));

  // A table that anyone can flood is a table nobody can read.
  check("limits: a per-fellow daily ceiling exists and is configurable",
    /ANTICIPY_FELLOW_SUBMIT_MAX/.test(route) && /inDay >= DAY_MAX/.test(route));
  check("limits: and a lifetime cap, the same shape /fellows/progress already uses",
    /mine\.length >= 500/.test(route));
  check("limits: the daily message is a ceiling on the table, not a scolding",
    /That's a lot in one day\. Try again tomorrow\./.test(routeText));

  // A meter must never stop someone logging their own work.
  const meterAt = route.indexOf('name = \'oembed\'');
  check("limits: the oEmbed ceiling is checked AFTER the row is saved, never before",
    meterAt > saveAt, `save at ${saveAt}, meter at ${meterAt}`);
  check("limits: over the ceiling the row still exists, unverified",
    /ANTICIPY_FELLOW_OEMBED_CEILING/.test(route));

  // Error bodies are not reliably JSON: YouTube's 400 is the plain text "Bad
  // Request" and X's 404 is an HTML page. res.json is undefined for both.
  const statusAt = route.indexOf("vstatus = Number(res.statusCode)");
  const jsonAt = route.indexOf("j = res.json");
  check("oembed: the status code is read before res.json is ever touched",
    statusAt > 0 && jsonAt > statusAt, `status at ${statusAt}, json at ${jsonAt}`);
  check("oembed: a slow platform costs a title, never the submission",
    /timeout: 8/.test(route));
  check("oembed: publish.x.com, not publish.twitter.com, which 301s",
    /publish\.x\.com\/oembed/.test(route) && !/publish\.twitter\.com/.test(HOOK_CODE));
  check("oembed: Instagram and LinkedIn are not called, because no endpoint exists",
    !/instagram[^\n]*oembed/i.test(stripComments(route)) &&
    !/linkedin[^\n]*oembed/i.test(stripComments(route)));

  // A mismatch flags. It does not refuse — a fellow may genuinely have a
  // second account — and it never reaches the fellow, because telling someone
  // which check caught them is how you teach them to pass it next time.
  check("author: a mismatch flags the row rather than refusing it",
    /vstate === "mismatch"/.test(route) && /set\("status", "flagged"\)/.test(route));
  check("author: only 'gone' ever reaches a fellow",
    /verify_state: \w+\.getString\("verify_state"\) === "gone" \? "gone" : ""/.test(route));
  check("author: a claimed handle is required first on the platforms we can check",
    /need_handle/.test(route) && /HANDLE_FIELD = \{ tiktok: "tiktok", youtube: "youtube", x: "x_handle" \}/.test(route));
  check("author: and /fellows/profile can actually set a youtube handle",
    /"instagram", "tiktok", "x_handle", "youtube"/.test(HOOK));
  // A refusal that tells someone to do a thing, with nowhere to do it, is the
  // /setup?f= mistake again — the guardian button that pointed at the Chrome
  // extension installer. need_handle has a field, on the same card, that
  // writes through the route that has always owned handles.
  check("author: the need_handle refusal has somewhere to actually put the handle",
    /function askHandle\(platform, why\)/.test(FUNNEL) &&
    /if \(j && j\.need_handle\) askHandle\(j\.need_handle/.test(FUNNEL) &&
    /api\("\/fellows\/profile", \{ body: patch \}\)/.test(FUNNEL));
  check("author: and asking for it is not styled as the person's mistake",
    /j && j\.need_handle \? "" : true/.test(FUNNEL));

  // The asymmetry the partial unique index exists for.
  const fellowRm = HOOK.slice(HOOK.indexOf('"/fellows/submissions/remove"'),
                              HOOK.indexOf('"/internal/fellows/submissions/remove"'));
  const hqRm = HOOK.slice(HOOK.indexOf('"/internal/fellows/submissions/remove"'),
                          HOOK.indexOf('"/internal/fellows/submissions/release"'));
  const hqRel = HOOK.slice(HOOK.indexOf('"/internal/fellows/submissions/release"'),
                           HOOK.indexOf('"/internal/fellows/remove"'));
  check("removal: a FELLOW removing their own releases the key, so a mis-paste is not permanent",
    /set\("removed_by", "fellow"\)/.test(fellowRm) && /set\("url_key", ""\)/.test(fellowRm));
  check("removal: an HQ removal RETAINS the key, so a caught paste cannot be re-pasted",
    /set\("removed_by", "hq"\)/.test(hqRm) && !/set\("url_key", ""\)/.test(stripComments(hqRm)));
  // AND THE RETAINED KEY HAS TO BE RELEASABLE. Retention is right for the five
  // minutes after a removal and wrong forever: the commonest HQ removal is "B
  // logged A's video", and the retained key then locks out A — the person who
  // actually made it — with the collision sentence, which by design tells them
  // nothing. Without a release, that is permanent and silent.
  check("removal: HQ can release a retained key, so the real author is not locked out forever",
    hqRel.length > 200 && /set\("url_key", ""\)/.test(stripComments(hqRel)));
  check("removal: releasing keeps the removal and the evidence",
    !/set\("status", "logged"\)/.test(stripComments(hqRel)) &&
    !/set\("removed_by", ""\)/.test(stripComments(hqRel)) &&
    /getString\("flags"\)/.test(hqRel));
  check("removal: a live row cannot have its key released out from under it",
    /getString\("status"\) !== "removed"/.test(hqRel));
  check("removal: and the release does not hand the video back to the fellow it was taken from",
    /key released by HQ: /.test(hqRel) && /key released by HQ: /.test(route));

  check("removal: neither deletes the row — a deleted row is a lost investigation",
    !/app\.delete\(/.test(stripComments(fellowRm)) && !/app\.delete\(/.test(stripComments(hqRm)));
  check("removal: a fellow cannot remove somebody else's, and is not told which it was",
    /getString\("fellow"\) !== String\(fellow\.get\("id"\)\)/.test(fellowRm) &&
    (fellowRm.match(/We couldn't find that one\./g) || []).length >= 2);

  // JSVM ISOLATION: a const at file top-level is not visible inside a
  // routerAdd callback in this runtime. Every handler that hashes declares it.
  const newRoutes = [route, fellowRm, hqRm];
  const hashing = newRoutes.filter((r) => /sha256\(/.test(r));
  const declaring = newRoutes.filter((r) => /const sha256 = \(s\) => \$security\.sha256\(s\);/.test(r));
  check(`routes: all ${hashing.length} handlers that hash redeclare their own sha256`,
    hashing.length === declaring.length && hashing.length === 2,
    `${declaring.length} declarations for ${hashing.length} hashers`);
  check("routes: pbTime is redeclared too, and is the fixed one that survives a PB datetime",
    /const pbTime = \(v\) => \{/.test(route) && /\+-\]\\d\{2\}:\?\\d\{2\}\)\$\/\.test\(t\)\) t \+= "Z"/.test(route));

  // /fellows/me carries the list, so the dashboard loads in one call.
  const me = HOOK.slice(HOOK.indexOf('"/fellows/me"'), HOOK.indexOf('"/fellows/apply"'));
  check("me: the logbook comes back on the call that already loads the dashboard",
    /submissions: submissions/.test(me) && /status != 'removed'/.test(me));
  check("me: a removed row is not in it", /status != 'removed'/.test(me));
  check("hq: the internal listing carries every submission, removed ones included",
    /submissions: submissions/.test(HOOK.slice(HOOK.indexOf('"/internal/fellows"'))));
}

// ==========================================================================
// 6. WE STORE NOTHING WE HAVE NOT VERIFIED
// ==========================================================================
{
  // Reading a view count needs OAuth per platform per fellow. There is no
  // column pretending otherwise, and no dash on screen where one would go.
  const nosy = /view_count|views|play_count|like_count|likes|follower|impressions|posted_at/i;
  const migFields = [...MIG.matchAll(/name:\s*"([a-z_]+)"/g)].map((m) => m[1]);
  check("verified: no field for a view count, a like count or a posted-at time",
    migFields.filter((f) => nosy.test(f)).length === 0,
    migFields.filter((f) => nosy.test(f)).join(", "));
  check("verified: and nothing on screen shows a dash where a number would be",
    !/Views/.test(FUNNEL) && /can't see your view counts/i.test(FUNNEL_TEXT));
  check("verified: the screen says WHY, and gives the numbers we do own",
    /connect your accounts/i.test(FUNNEL_TEXT) &&
    /clicks on your link/i.test(FUNNEL_TEXT));
  // Two separate axes: what a person decided, and what the internet said.
  check("verified: status and verify_state are separate columns",
    /name: "status"/.test(MIG) && /name: "verify_state"/.test(MIG));
  check("verified: the literal HTTP code is kept, and 0 means it never returned",
    /name: "oembed_status"/.test(MIG) && /0 = never returned/.test(MIG));
  check("verified: what the URL claimed and what the platform said are different columns",
    /name: "author_claimed"/.test(MIG) && /name: "author_handle"/.test(MIG));
}

// ==========================================================================
// 7. THE SCHEMA
// ==========================================================================
{
  check("schema: the collection is hook-only like the rest of the fellowship",
    /listRule: null/.test(MIG) && /deleteRule: null/.test(MIG));
  // The partial WHERE is load-bearing: a fellow-removal clears url_key and the
  // index releases it, so one mis-paste cannot lock a video out forever.
  check("schema: the dedupe index is GLOBAL, unique, and partial on url_key",
    /CREATE UNIQUE INDEX idx_fsub_key ON fellow_submissions \(url_key\) WHERE url_key != ''/.test(MIG));
  check("schema: a fellow's own list and the author sweep both have an index",
    /idx_fsub_fellow/.test(MIG) && /idx_fsub_author/.test(MIG));
  check("schema: it is guarded and re-runnable, like every migration here",
    /findCollectionByNameOrId\(name\)/.test(MIG) && /return null/.test(MIG));
  check("schema: down() removes only what up() added",
    /app\.delete\(app\.findCollectionByNameOrId\("fellow_submissions"\)\)/.test(MIG) &&
    !/fellow_conversions|fellow_payouts|fellow_clicks/.test(MIG_CODE));
  check("schema: the youtube handle is added guarded, in the 1700000044 pattern",
    /if \(!f\.fields\.getByName\("youtube"\)\)/.test(MIG));
  check("schema: the filename contains 'submission', which is what gate leg 5 greps for",
    /submission/.test("1700000046_fellow_submissions.js"));

  // The prohibition lives in the migration because that is the file the next
  // person to add a feature will read.
  check("schema: the no-bonus rule is written where a future feature will trip over it",
    /NO NUMBER ON THIS TABLE MAY EVER PAY/.test(MIG) &&
    /leaderboard/i.test(MIG));
}

// ==========================================================================
// 8. THE COPY IS NEVER A QUOTA
//
// A programme that requires minors to publish work for the company is a
// different arrangement in law. The difference is these sentences.
// ==========================================================================
{
  const card = FUNNEL_TEXT.slice(FUNNEL_TEXT.indexOf("Things you"),
                                 FUNNEL_TEXT.indexOf("Things you") + 1400);
  check("copy: the card exists and asks for a link", /paste/i.test(card) && card.length > 200);
  check("copy: it says posting is optional and to their own account",
    /optional/i.test(card) && /your own account/i.test(card));
  check("copy: it says plainly that nothing here is required and nothing here pays",
    /nothing here is required/i.test(card) && /nothing here pays/i.test(card));
  const QUOTA = /\b(you must|required to post|at least \d+ (videos|posts)|quota|target|deadline|by (monday|friday)|per week|each week|weekly minimum|keep your streak)\b/i;
  check("copy: no quota, target, streak or deadline anywhere on the card",
    !QUOTA.test(card), (card.match(QUOTA) || [])[0]);
  check("copy: zero is a real state, not a verdict",
    /Nothing logged yet, which is exactly what the start looks like/.test(FUNNEL_TEXT));
  check("copy: the one verification state a fellow sees asks a question, it does not accuse",
    /has it been taken down\?/i.test(FUNNEL_SEEN) &&
    !/unverified|mismatch/i.test(FUNNEL_SEEN));
  // The list is a list. The moment a counter or a rank appears, a thing that
  // is optional starts reading as a thing that is owed.
  check("copy: the list has no counter, no rank and no progress bar",
    /A LIST, NEVER A SCOREBOARD/.test(FUNNEL) &&
    !/\bstreak\b|\bleaderboard\b|\d+ of \d+ (logged|posted)/i.test(FUNNEL_SEEN));
}

// ==========================================================================
// 9. EVERYTHING IS ESCAPED ON THE WAY OUT
//
// `title` is whatever a platform's oEmbed handed us, `note` is whatever the
// person typed, `url` is built from what they pasted. All three are rendered
// as HTML by the dashboard.
// ==========================================================================
{
  const rs = FUNNEL.slice(FUNNEL.indexOf("function renderSubs()"),
                          FUNNEL.indexOf("document.addEventListener(\"click\", function(ev){\n  var add"));
  check("escape: renderSubs exists and builds the list", rs.length > 200);
  const li = rs.slice(rs.indexOf("return '<li>'"), rs.indexOf("</li>';") + 8);
  check("escape: no submission field is concatenated into HTML unescaped",
    !/\+\s*s\.[A-Za-z_]+/.test(li), (li.match(/\+\s*s\.[A-Za-z_]+/) || [])[0]);
  check("escape: the href goes through esc() too, even though the server canonicalises it",
    /href="' \+ esc\(s\.url\)/.test(li));
  check("escape: the title, the note, the id and the platform all go through esc()",
    /esc\(label\)/.test(li) && /esc\(s\.note\)/.test(li) &&
    /esc\(s\.id\)/.test(li) && /esc\(NAME\[s\.platform\]/.test(li));
  check("escape: an outbound link cannot reach back into the tab that opened it",
    /rel="noopener noreferrer"/.test(li));
  // And on the way IN: control characters never reach a column, so a title
  // cannot smuggle a newline into a log line or a CSV export.
  check("escape: control characters are stripped before anything is stored",
    /const scrub = \(s, n\) => String/.test(HOOK) &&
    /\\u0000-\\u001F\\u007F/.test(HOOK));
  // The vendor of the truth is a third party. Never assume its shape.
  check("escape: the oEmbed html is tag-stripped before its text is stored",
    /replace\(\/<\[\^>\]\*>\/g, " "\)/.test(HOOK));
}

// ==========================================================================
// AN HQ REMOVAL CANNOT BE DISSOLVED BY THE PERSON IT WAS AIMED AT
// ==========================================================================
// Found by a re-attack, in code written to fix the previous re-attack.
//
// The two removals are asymmetric on purpose: a FELLOW removing their own row
// clears url_key so one mis-paste cannot lock a video out forever; an HQ
// removal retains it so a video taken down as not-theirs stays locked. But the
// fellow's route wrote removed_by and cleared url_key on any row they owned —
// so the claimer the bar exists for could log somebody else's video, wait for
// HQ to take it down, then call their own remove on the same id and watch
// removed_by flip from 'hq' to 'fellow' and url_key empty. The bar dissolved
// at the touch of the person it was aimed at.
{
  const rm = HOOK.slice(HOOK.indexOf('routerAdd("POST", "/fellows/submissions/remove"'));
  const body = rm.slice(0, rm.indexOf("routerAdd(", 40));
  const guardAt = body.indexOf('removed_by") === "hq"');
  const writeAt = body.indexOf('set("removed_by", "fellow")');
  check("submissions: a fellow cannot re-remove a row HQ removed",
    guardAt > 0, "no removed_by === 'hq' guard in the fellow's remove route");
  check("submissions: and that guard runs BEFORE the write",
    guardAt > 0 && writeAt > 0 && guardAt < writeAt,
    `guard@${guardAt} write@${writeAt}`);
  // Telling a claimer that HQ has ruled on their row is information they can
  // only use, so it is the same 404 as a row that was never theirs.
  const between = body.slice(guardAt, writeAt);
  check("submissions: and it does not disclose that HQ ruled on the row",
    /404/.test(between) && !/hq|removed by|taken down/i.test(
      (between.match(/message: "([^"]*)"/) || ["", ""])[1]),
    (between.match(/message: "([^"]*)"/) || ["", ""])[1]);
}

console.log(failures ? `\ntest_fellowship_submissions: ${failures} FAILED`
                     : "\ntest_fellowship_submissions: all passed");
process.exit(failures ? 1 : 0);
