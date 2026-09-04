"""THE FELLOWSHIP SCOREBOARD. One command, one verdict.

overnight/done_gate.py measures the PRODUCT — she hears you, it was one
conversation, she judges right, she acts, she shows a card, a stranger. Grep it
for "fellow" and you get nothing. The Growth Fellowship has never had a
scoreboard at all, which is exactly why it keeps producing proven parts: a
rebuilt player here, a fixed funnel there, and no single thing that says
whether a person can walk the whole way through.

This is the same cure applied to the fellowship — Cockburn's Walking Skeleton,
one thin acceptance test over the ENTIRE journey a fellow actually walks:

    get in -> find the community -> learn what it is -> learn to make one
    -> make one -> log it -> see what you're owed -> get paid

It prints exactly one thing:

    DONE
or  NOT DONE - first failing leg: N (<why>)

Rules that make it worth trusting, same as the product gate:

  * It measures the LIVE SITE, because that is the only thing a fellow can
    touch. There is no local PocketBase here on purpose. Point it elsewhere
    with ANTICIPY_SITE_URL.
  * A leg that cannot be tested FAILS. Never passes by default, never passes
    because a key was missing, never passes because a file was absent.
  * Legs run in order and it reports the FIRST failure. Later legs still run,
    so you can see whether you thickened the wrong part.
  * Leg 1 writes a real row and then REMOVES IT. If it cannot clean up it says
    so loudly, because junk rows in a table of minors is not a small thing.
  * Leg 8 cannot be faked. It needs a real person, not on the team, who made a
    real video and was really paid, signed in overnight/fellowship_proof.json.
    No proof, NOT DONE, forever, however green legs 1-7 are.

Run:
    python3 overnight/fellowship_gate.py
    python3 overnight/fellowship_gate.py --verbose
"""
from __future__ import annotations

import datetime
import json
import os
import re
import sys
import traceback
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

VERBOSE = "--verbose" in sys.argv or "-v" in sys.argv

SITE = (os.environ.get("ANTICIPY_SITE_URL") or "https://anticipyfellowship.com").rstrip("/")

# /internal/* is intentionally refused on the public hostname. The scoreboard
# therefore needs a separate, explicit origin for its internal cleanup call.
# Never run it against production unless the team has authorized its real-row
# write and supplied the internal key.
BACKEND = (os.environ.get("ANTICIPY_BACKEND_URL")
           or "https://anticipy-fellowships.omar-114.workers.dev").rstrip("/")
INTERNAL_KEY = os.environ.get("ANTICIPY_INTERNAL_KEY") or ""

PUBLIC = os.path.join(ROOT, "backend", "pb_public")
LEARN_FILE = os.path.join(PUBLIC, "fellowship-growth-learning.html")
FUNNEL_FILE = os.path.join(PUBLIC, "fellowships.html")


class LegFailed(Exception):
    """A leg did not hold. The message is what the owner reads."""


def note(msg: str) -> None:
    if VERBOSE:
        print(f"      {msg}")


def http(method: str, url: str, body=None, headers=None, timeout=25):
    """Returns (status, text). Never raises for an HTTP status."""
    data = None
    hdrs = {"User-Agent": "anticipy-fellowship-gate/1"}
    if body is not None:
        data = json.dumps(body).encode()
        hdrs["Content-Type"] = "application/json"
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        raise LegFailed(f"{method} {url} did not answer at all: {e}")


def js(method: str, url: str, body=None, headers=None):
    status, text = http(method, url, body, headers)
    try:
        return status, json.loads(text)
    except Exception:  # noqa: BLE001
        return status, {"_raw": text[:400]}


def read(path: str) -> str:
    if not os.path.exists(path):
        raise LegFailed(f"{os.path.relpath(path, ROOT)} does not exist")
    with open(path, encoding="utf-8") as f:
        return f.read()


# --------------------------------------------------------------------------
# LEG 1 — THEY CAN GET IN
#
# Not "the page returns 200". A real application, all the way through, ending
# in a row that says accepted and a referral code that exists. This is the leg
# that broke silently for weeks: the funnel was up, the pages were fine, and
# /fellows/start was reporting status "new" for somebody already in.
# --------------------------------------------------------------------------
def leg_1_get_in() -> str:
    status, _ = http("GET", f"{SITE}/fellowships")
    if status != 200:
        raise LegFailed(f"{SITE}/fellowships answered {status}")

    status, health = js("GET", f"{SITE}/fellows/health")
    if status != 200:
        raise LegFailed(f"/fellows/health answered {status} - the hooks are not loaded")

    # A fresh address every run, because the leg's claim is that a NEW person
    # can get in. Reusing one would quietly test the returning path instead —
    # and now that removal actually sticks, a reused address is refused, which
    # is correct behaviour and a useless test. The row is removed below.
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    email = f"gate+{stamp}@resend.dev"
    born = datetime.date.today().year - 15          # a minor, on purpose

    status, start = js("POST", f"{SITE}/fellows/start", {
        "name": "Gate", "email": email,
        "birth_month": 5, "birth_year": born, "country": "us",
    })
    if status != 200 or not start.get("ok"):
        raise LegFailed(f"/fellows/start refused a valid application: {start}")
    token = start.get("token")
    fellow = start.get("fellow") or {}
    if not token:
        raise LegFailed("/fellows/start returned no session token")
    if fellow.get("age_band") != "16_17" and fellow.get("age_band") != "13_15":
        raise LegFailed(f"a 15-year-old was banded as {fellow.get('age_band')!r}")
    note(f"started: status={fellow.get('status')!r} code={fellow.get('referral_code')!r}")

    status, applied = js("POST", f"{SITE}/fellows/apply",
                         {"fellowship": "growth", "terms": True, "answers": {
                             "watch": "the one about the guy who films his commute and never says anything",
                             "want": "i want to make a video that gets past a thousand views",
                             "make": "i made a poster for the school bake sale",
                             "time": "1-3 hours"}},
                         {"X-Fellow-Token": token})
    if status != 200 or not applied.get("ok"):
        raise LegFailed(f"/fellows/apply refused a genuine application: {applied}")
    if applied.get("verdict") != "accept":
        raise LegFailed(f"a genuine application came back {applied.get('verdict')!r}: "
                        f"{applied.get('message')!r}")

    status, me = js("GET", f"{SITE}/fellows/me", None, {"X-Fellow-Token": token})
    if status != 200 or not me.get("ok"):
        raise LegFailed(f"/fellows/me would not answer for a fresh token: {me}")
    who = me.get("fellow") or {}
    if who.get("status") != "accepted":
        raise LegFailed(f"applied and accepted, but the record says {who.get('status')!r}")
    code = who.get("referral_code") or ""
    if not re.fullmatch(r"[a-z0-9]{4,12}", code):
        raise LegFailed(f"referral code {code!r} is not the lowercase shape /r/ matches")

    status, _ = http("GET", f"{SITE}/r/{code}")
    if status not in (200, 302, 301):
        raise LegFailed(f"their own referral link answered {status}")

    # Clean up after ourselves. A gate that quietly fills a table of minors
    # with its own test rows is not a gate anybody should trust.
    fid = who.get("id") or fellow.get("id")
    if not INTERNAL_KEY:
        raise LegFailed("passed the journey but ANTICIPY_INTERNAL_KEY is unset, so the "
                        f"test row {email} cannot be removed - set it and re-run")
    status, gone = js("POST", f"{BACKEND}/internal/fellows/remove",
                      {"fellow_id": fid, "reason": "fellowship_gate"},
                      {"X-Internal-Key": INTERNAL_KEY})
    if status != 200:
        raise LegFailed(f"could not remove the gate's own test row {email} ({fid}): {gone}")

    return f"applied as a 15-year-old, accepted, code {code} live, row removed"


# --------------------------------------------------------------------------
# LEG 2 — THEY FIND THE COMMUNITY
#
# The founder's first step for a new fellow is "join the Discord". An invite
# that is not on the page, or is on the page but expired, is the same thing as
# no community at all.
# --------------------------------------------------------------------------
def leg_2_community() -> str:
    pages = {"fellowships.html": read(FUNNEL_FILE),
             "fellowship-growth-learning.html": read(LEARN_FILE)}
    found = {}
    for name, html in pages.items():
        for m in re.finditer(r"https://discord\.gg/([A-Za-z0-9]+)", html):
            found[m.group(1)] = name
    if not found:
        raise LegFailed("no discord.gg invite appears on either fellowship page - "
                        "a fellow is never told where the community is")

    live = []
    for code, where in found.items():
        status, inv = js("GET", f"https://discord.com/api/v10/invites/{code}")
        if status != 200:
            raise LegFailed(f"the invite on {where} (discord.gg/{code}) answered "
                            f"{status} - expired or revoked, so it sends people nowhere")
        guild = (inv.get("guild") or {}).get("name") or "?"

        # An invite that expires is a leg that breaks on its own, later,
        # silently, for everyone who arrives after the date. A page outlives a
        # 30-day invite, so this has to be caught the day it is wired, not the
        # day it dies. Only the server owner can fix it: Discord > invite >
        # Edit > Expire after Never, Max uses No limit.
        exp = inv.get("expires_at")
        if exp:
            when = datetime.datetime.fromisoformat(exp.replace("Z", "+00:00"))
            days = (when - datetime.datetime.now(datetime.timezone.utc)).days
            raise LegFailed(
                f"discord.gg/{code} works today but EXPIRES in {days} days ({exp[:10]}). "
                "Everyone who applies after that lands on a dead link. This one is the "
                "founder's to fix: in Discord, edit the invite and set Expire after = "
                "Never, Max number of uses = No limit, then put the new code in the "
                "DISCORD constant in fellowships.html")

        live.append(f"{code} -> {guild} (never expires)")
        note(f"{where}: discord.gg/{code} resolves to {guild!r}")

    # Being sent there is not the same as being told what it is for.
    if not re.search(r"join the (community|server|discord)", pages["fellowships.html"], re.I):
        raise LegFailed("the invite is on the page but nothing says what it is or why to join")

    return "; ".join(live)


# --------------------------------------------------------------------------
# LEG 3 — THEY LEARN WHAT ANTICIPY IS
#
# The founder: "You explain step by step what Anticipy is, and there are a
# couple of quizzes on it." And it has to STICK to their account, or a phone
# that clears its storage has erased the whole thing.
# --------------------------------------------------------------------------
def leg_3_learn_what_it_is() -> str:
    status, _ = http("GET", f"{SITE}/fellowship-growth-learning")
    if status != 200:
        raise LegFailed(f"the course answered {status}")
    html = read(LEARN_FILE)

    if 'id:"u0"' not in html:
        raise LegFailed("there is no unit 0 - the course never says what Anticipy is")
    u0 = html[html.index('id:"u0"'):html.index('id:"u1"')]
    lessons = re.findall(r'\{ id:"u0-l\d+"', u0)
    if len(lessons) < 3:
        raise LegFailed(f"unit 0 has {len(lessons)} lessons, which is not step by step")
    checks = u0.count('t:"check"')
    if checks < 2:
        raise LegFailed(f"unit 0 has {checks} quizzes - the founder asked for a couple")
    for phrase in ("a pendant you wear", "preorder"):
        if phrase not in u0:
            raise LegFailed(f"unit 0 never says {phrase!r}")

    # progress must survive the device
    if "/fellows/progress" not in html:
        raise LegFailed("finishing a lesson is never sent anywhere - progress dies with "
                        "the browser's localStorage")
    hook = read(os.path.join(ROOT, "backend", "pb_hooks", "fellowship.pb.js"))
    if 'routerAdd("POST", "/fellows/progress"' not in hook:
        raise LegFailed("the page posts progress to a route that does not exist")

    return f"unit 0: {len(lessons)} lessons, {checks} checks, progress persists server-side"


# --------------------------------------------------------------------------
# LEG 4 — THEY LEARN TO MAKE ONE
#
# The founder: "For the first video, you do how you edit and the basic tools
# that you sent." The course teaches hooks, scripts, lanes and money. It has
# never once taught somebody which app to open.
# --------------------------------------------------------------------------
def leg_4_learn_to_make() -> str:
    html = read(LEARN_FILE)
    lowered = html.lower()

    tools = [t for t in ("capcut", "inshot", "canva", "premiere rush", "davinci")
             if t in lowered]
    if not tools:
        raise LegFailed("no lesson names a single editing app. The course teaches hooks, "
                        "scripts and money, and never tells a beginner which app to open "
                        "or which button to press")

    craft = [w for w in ("trim", "cut the", "caption", "subtitle", "export", "aspect ratio",
                         "b-roll", "voiceover") if w in lowered]
    if len(craft) < 4:
        raise LegFailed(f"an editing app is named but only {len(craft)} concrete editing "
                        f"skills appear ({craft}) - that is a mention, not a lesson")

    if not re.search(r'id:"u\d+-l\d+", name:"[^"]*(edit|film|shoot|tool)', html):
        raise LegFailed("no lesson is NAMED for editing or filming, so nobody can find it")

    return f"editing taught: tools {tools}, skills {craft}"


# --------------------------------------------------------------------------
# LEG 5 — THEY LOG WHAT THEY MADE
#
# The founder: "every time you upload a video, you paste the video and the link
# to TikTok or Instagram in some kind of internal dashboard system, and you can
# track it." Nothing in this system can currently accept a link.
# --------------------------------------------------------------------------
def leg_5_log_it() -> str:
    hook = read(os.path.join(ROOT, "backend", "pb_hooks", "fellowship.pb.js"))
    route = re.search(r'routerAdd\("POST", "(/fellows/(?:videos|posts|submissions)[^"]*)"', hook)
    if not route:
        raise LegFailed("there is no route that accepts a video link. A fellow who makes "
                        "something has nowhere to put it and nothing to show for it")

    migrations = os.path.join(ROOT, "backend", "pb_migrations")
    names = os.listdir(migrations) if os.path.isdir(migrations) else []
    if not any(re.search(r"video|submission|post", n) for n in names):
        raise LegFailed("the route exists but no migration creates a collection to keep "
                        "submissions in")

    status, refused = js("POST", f"{SITE}{route.group(1)}", {"url": "not-a-url"},
                         {"X-Fellow-Token": "nope"})
    if status == 404:
        raise LegFailed(f"{route.group(1)} is in the source but 404s live - not deployed")
    if status not in (400, 401):
        raise LegFailed(f"{route.group(1)} answered {status} to a junk link from a junk "
                        "token; it should refuse both")

    html = read(FUNNEL_FILE)
    if not re.search(r"paste|your videos|log (a|your) video", html, re.I):
        raise LegFailed("the route exists but no screen ever asks for a link")

    return f"{route.group(1)} accepts and refuses correctly, and a screen asks for it"


# --------------------------------------------------------------------------
# LEG 6 — THEY CAN SEE WHAT THEY'RE OWED
#
# Money that is real but invisible is the same as money that is not there. It
# has to name what has cleared, what is waiting, and WHY it is waiting.
# --------------------------------------------------------------------------
def leg_6_see_the_money() -> str:
    html = read(FUNNEL_FILE)
    hook = read(os.path.join(ROOT, "backend", "pb_hooks", "fellowship.pb.js"))

    if "clicks_total" not in hook:
        raise LegFailed("clicks are never counted, so a link is a link to nowhere")
    if "conversions" not in hook:
        raise LegFailed("/fellows/me never returns conversions, so nothing can show a sale")

    text = re.sub(r"['\"]\s*\n?\s*\+\s*['\"]", "", html)

    # THIS LEG PINNED THE OLD MONEY MODEL AND WENT RED THE MOMENT THE MODEL
    # CHANGED. It required the words "14 days", "late 2026" and "claws money
    # back" — the $15/$15 split, which was dropped because a card dispute on a
    # preorder starts counting from the SHIP date, so the second tranche paid
    # out exactly when the risk began. A gate that asserts yesterday's decision
    # blocks today's. What has to be true is not a particular sentence; it is
    # that a fellow can see the amount, when it lands, and that it is theirs.
    for what, pattern in (("the amount", r"\$30"),
                          ("when it lands", r"30 days"),
                          ("that it is never taken back", r"never take|never taken|don'?t take it back")):
        if not re.search(pattern, text, re.I):
            raise LegFailed(f"the money surface never states {what}")

    # And the superseded model must not survive anywhere, because a page still
    # promising halves is promising something the payout rail will not do.
    for stale, why in ((r"14 days", "the old 14-day tranche"),
                       (r"\bwhop\b", "Whop, which cannot pay an under-18 at all")):
        if re.search(stale, text, re.I):
            raise LegFailed(f"the money surface still promises {why}")

    if not re.search(r"cleared|waiting|owed|so far", text, re.I):
        raise LegFailed("nothing on screen separates money that has landed from money "
                        "that is still waiting")

    return "clicks counted, conversions returned, one $30 at 30 days stated on screen"


# --------------------------------------------------------------------------
# LEG 7 — THEY CAN ACTUALLY BE PAID
#
# The founder's blocking question, and the one that has never been answered:
# Whop? PayPal? What actually pays a fifteen-year-old in Canada thirty dollars?
# A decision that is not written down is not a decision.
# --------------------------------------------------------------------------
def leg_7_payable() -> str:
    decision = os.path.join(ROOT, "docs", "fellowship-payments.md")
    if not os.path.exists(decision):
        raise LegFailed("docs/fellowship-payments.md does not exist. No rail has been "
                        "chosen, so nobody can be paid whatever the dashboard says")
    text = read(decision).lower()

    for what, needles in (
        ("the rail", ("whop", "paypal", "stripe", "trolley", "tremendous", "wise", "tipalti")),
        ("the fee on $30", ("fee", "cost per payout")),
        ("the under-18 path", ("guardian", "parent", "custodial", "minor")),
        ("the tax form", ("w-9", "w9", "1099", "w-8ben", "t4a")),
        ("the hold or up-front decision", ("up front", "upfront", "hold", "14 days")),
    ):
        if not any(n in text for n in needles):
            raise LegFailed(f"the payments decision never settles {what}")

    if "undecided" in text or "tbd" in text:
        raise LegFailed("the payments doc still says TBD somewhere - that is a note, "
                        "not a decision")

    # A written decision is necessary and nowhere near sufficient. This leg
    # went green once on the doc plus a payout_method field that had been in
    # the schema since day one, at a moment when nothing in the system could
    # move a cent. A leg that passes while the claim is false is worse than no
    # leg at all, so it now requires that money can actually move.
    hooks_dir = os.path.join(ROOT, "backend", "pb_hooks")
    hooks = "\n".join(read(os.path.join(hooks_dir, n))
                      for n in sorted(os.listdir(hooks_dir)) if n.endswith(".pb.js"))

    if "tremendous" not in hooks.lower() and "tangocard" not in hooks.lower():
        raise LegFailed("the rail is written down but no hook has ever called it - "
                        "nothing in this system can send a cent")
    if "$http.send" not in hooks:
        raise LegFailed("a vendor is named but nothing makes an outbound call to it")

    # external_id IS the double-pay guard. Tremendous returns 201 with the
    # original order on a repeat and 409 on a genuine conflict, so the key has
    # to be the conversion id and nothing else - not a timestamp, not a random
    # value, not a retry counter.
    if not re.search(r"external_id", hooks):
        raise LegFailed("the vendor call has no external_id, which is the only thing "
                        "standing between a retry and paying a teenager twice")

    # Real money must be opt-in, not the default.
    if "TREMENDOUS_ENV" not in hooks and "PAYOUT_ENV" not in hooks:
        raise LegFailed("nothing separates sandbox from production, so a mistake spends "
                        "real money")

    migrations = os.listdir(os.path.join(ROOT, "backend", "pb_migrations"))
    if not any("payout" in n for n in migrations):
        raise LegFailed("no migration creates somewhere to record that money was sent")

    # A rail that only pays adults pays half this programme. For a minor the
    # money switch is guardian consent, and for a long time NOTHING in the
    # codebase could set parental_consent to "confirmed" — so a 15-year-old
    # could do everything right and never become payable. Prove the switch is
    # reachable, live, rather than trusting that it is.
    if 'parental_consent", "confirmed"' not in hooks:
        raise LegFailed("nothing can set parental_consent to confirmed, so a minor's "
                        "money switch is unreachable and half the cohort can never be paid")
    status, _ = http("GET", f"{SITE}/fellows/guardian?t=gate")
    if status != 200:
        raise LegFailed(f"the guardian page answered {status} through the site. It must live "
                        "under a path the edge forwards - /setup was not one, which is how a "
                        "parent following that link got a 404")
    status, refused = js("POST", f"{SITE}/fellows/guardian",
                         {"t": "gate", "guardian_name": "Gate", "guardian_email": "g@resend.dev"})
    if status != 200 or refused.get("ok") is not False:
        raise LegFailed("guardian consent was accepted without the affirmation ticked; that "
                        "tick is the only thing that makes it consent rather than a form post")

    # AND IT HAS TO BE DEPLOYED. Everything above reads the local tree, so this
    # leg went green once while fellowship_payouts.pb.js was deliberately held
    # back from the deploy — source that is not shipped cannot pay anybody.
    # Legs 1, 2 and 5 all check the live site; this one does too now.
    status, health = js("GET", f"{SITE}/fellows/payouts/health")
    if status == 404:
        raise LegFailed("the payout hook is in the tree but not deployed - "
                        "/fellows/payouts/health 404s, so nothing live can pay anyone")
    if status != 200:
        raise LegFailed(f"/fellows/payouts/health answered {status}")

    # AND IT HAS TO BE ABLE TO SEND. This read `configured or ... or ok`, and
    # ok is true whenever the endpoint merely answers — so an unset vendor key
    # came back "configured" and the leg went green while can_send was false.
    # Third false pass on this board today and the same mistake each time:
    # accepting a proxy for the claim instead of the claim. The claim is THEY
    # CAN ACTUALLY BE PAID, so the only honest source is the rail's own
    # can_send.
    env = str(health.get("env") or "?")
    if health.get("status") == "misconfigured":
        raise LegFailed("the payout rail is deployed and MISCONFIGURED — a sandbox key under "
                        "TREMENDOUS_ENV=production or the reverse. It will send nothing")
    if not health.get("configured"):
        raise LegFailed("the payout rail is deployed and healthy but has no vendor key, so "
                        "nobody can be paid. Open the Tremendous account, put the key in "
                        "TREMENDOUS_API_KEY, and this goes green in sandbox")
    if not health.get("can_send"):
        raise LegFailed(f"the rail reports it cannot send (env {env}, status "
                        f"{health.get('status')!r})")
    if not health.get("can_send_under_18"):
        raise LegFailed("the rail can pay an adult but not a 13-17 fellow, which is most of "
                        "this programme")
    return f"the rail is deployed, keyed and able to send, including to a minor (env: {env})"


# --------------------------------------------------------------------------
# LEG 8 — A REAL FELLOW
#
# This one cannot be faked and must not be edited to make it pass. Legs 1-7 all
# measure OUR side. This measures whether it worked for a person who is not us.
# --------------------------------------------------------------------------
REQUIRED_PROOF = ["fellow_name", "date", "not_on_the_team", "video_url",
                  "logged_in_dashboard", "amount_paid_usd", "paid_via"]


def leg_8_a_real_fellow() -> str:
    path = os.path.join(HERE, "fellowship_proof.json")
    if not os.path.exists(path):
        raise LegFailed("overnight/fellowship_proof.json does not exist. No real person "
                        "outside the team has been through this end to end")
    try:
        with open(path, encoding="utf-8") as f:
            proof = json.load(f)
    except Exception as e:  # noqa: BLE001
        raise LegFailed(f"fellowship_proof.json will not parse: {e}")

    missing = [k for k in REQUIRED_PROOF if not proof.get(k)]
    if missing:
        raise LegFailed(f"fellowship_proof.json is incomplete: missing {missing}")
    if proof.get("not_on_the_team") is not True:
        raise LegFailed("the only person through it was on the team")
    try:
        paid = float(proof.get("amount_paid_usd") or 0)
    except (TypeError, ValueError):
        raise LegFailed("amount_paid_usd is not a number")
    if paid <= 0:
        raise LegFailed("nobody has actually been paid yet")

    return (f"{proof['fellow_name']} on {proof['date']}: video logged, "
            f"${paid:.2f} paid via {proof['paid_via']}")


# --------------------------------------------------------------------------

LEGS = [
    (1, "THEY CAN GET IN", leg_1_get_in),
    (2, "THEY FIND THE COMMUNITY", leg_2_community),
    (3, "THEY LEARN WHAT ANTICIPY IS", leg_3_learn_what_it_is),
    (4, "THEY LEARN TO MAKE ONE", leg_4_learn_to_make),
    (5, "THEY LOG WHAT THEY MADE", leg_5_log_it),
    (6, "THEY SEE WHAT THEY'RE OWED", leg_6_see_the_money),
    (7, "THEY CAN ACTUALLY BE PAID", leg_7_payable),
    (8, "A REAL FELLOW", leg_8_a_real_fellow),
]


def main() -> int:
    print()
    print(f"  FELLOWSHIP GATE   site: {SITE}")
    print(f"                 backend: {BACKEND}")
    print(f"                    tree: {ROOT}")
    print("  " + "-" * 62)

    first_fail = None
    for num, name, fn in LEGS:
        try:
            detail = fn()
            print(f"  [{num}] PASS  {name}")
            print(f"        {detail}")
        except LegFailed as e:
            mark = "FAIL" if first_fail is None else "fail"
            print(f"  [{num}] {mark}  {name}")
            print(f"        {e}")
            if first_fail is None:
                first_fail = (num, name, str(e))
        except Exception as e:  # noqa: BLE001
            if VERBOSE:
                traceback.print_exc()
            print(f"  [{num}] FAIL  {name}")
            print(f"        gate itself errored: {e}")
            if first_fail is None:
                first_fail = (num, name, f"gate errored: {e}")

    print("  " + "-" * 62)
    if first_fail is None:
        print("  DONE")
        print()
        return 0
    num, name, why = first_fail
    print(f"  NOT DONE - first failing leg: {num} ({name})")
    print(f"  {why}")
    print()
    print("  Work ONLY this leg. Not the next feature, not a nicer UI.")
    print()
    return 1


if __name__ == "__main__":
    sys.exit(main())
