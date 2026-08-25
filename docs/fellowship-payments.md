# How fellows get paid

**Status: decided.** Written 2026-08-22. Supersedes "we'll pay through Whop", which was an
assumption nobody had checked and which does not work.

This is the decision record `overnight/fellowship_gate.py` leg 7 looks for. If you change the
rail, change this file in the same commit, or the gate is measuring a thing that stopped being
true.

> Not legal or tax advice. The guardian consent form and the tax posture below are worth
> twenty minutes of a lawyer's time before real money moves. They are not worth blocking the
> build on.

---

## The one fact everything else follows from

**You cannot open a payment account for a 15-year-old.**

PayPal, Wise, Venmo personal, Stripe Connect Express and Whop Earnings all require the account
holder to be 18+. That is not a gap in the market or a rail we haven't found yet — opening a
money account requires the legal capacity to enter a contract, and a minor doesn't have one.
A contract signed by a 15-year-old is voidable at *their* option: the adult side is bound and
cannot enforce anything back.

| Rail | Age floor | Source |
|---|---|---|
| Whop Earnings | 18+ | "Must be 18+ years old" — [Earnings Terms](https://whop.com/earnings-terms/) |
| PayPal (US) | 18+ | [User Agreement](https://www.paypal.com/us/legalhub/paypal/useragreement-full), 29 Jun 2026 |
| Stripe Connect Express | 18+ in practice | Guardian must own the account — [Stripe](https://support.stripe.com/embedded-connect/questions/age-requirement-to-create-an-account) |
| Wise | 18+ | US Customer Agreement |
| Venmo personal | 18+ | US User Agreement |

Whop does publish a [youth-safety path](https://whop.com/youth-safety-policy/) where a minor can
earn once their processor verifies a guardian's identity. It reads as unshipped, it depends on a
third party we don't control, and its payout fee is the worst of the credible options anyway.

**So stop looking for an account that will take a minor.** Pay them in something that isn't a
financial account: stored value. A prepaid Visa needs no signup, no KYC, and no capacity to
contract. This is the boring, established practice — it is what IRB-approved studies use to pay
adolescent participants, precisely because teenagers may have no bank access.

---

## The rail: Tremendous

One integration, both countries, both age bands.

Its [terms](https://www.tremendous.com/terms/) (15 May 2026) contain exactly one age clause and
it binds **the Representative who opens the business account** — Omar — to 18+. There is no age
condition on recipients at all.

| | Under 18 | 18+ |
|---|---|---|
| Default | Prepaid Visa | Prepaid Visa |
| Also offered | Gift-card catalogue | + PayPal, Venmo, bank transfer |
| Fee on $30 | **$0.00** | $0.00, or $1.20 if they pick cash-like (4%, $0.25 min) |
| Recipient needs | An email address | An email address |
| KYC | None | None |

Canada is covered — CAD bank transfer plus a Canadian catalogue. Note the region lock: Amazon.ca
cards for Canadians, Amazon.com for Americans.

**Fund by ACH, never by card.** Card funding carries a 3% surcharge, which on this programme is
pure loss.

**What it beats:** Whop at $2.50 per ACH payout is 8.3% of a $30 payment, and is closed to half
the cohort. PayPal Payouts API is cheap at $0.25 — for the 18+ half only.

### The product id, and the one that looks right and is not

Use **`Q24BD9EZ332JT`** — "Virtual Visa", USD, unrestricted, $1–$2000, 215
countries including the US and Canada.

**Do not use `V4QZ00F554D3`.** Its name is "Prepaid Virtual Visa", which is a
better match for every sentence in this document, and every catalogue row for it
says *"Limited to specific use cases only. Contact your Account Manager."* It
will look correct in a diff and fail at the vendor.

Paying a Canadian in CAD rather than USD needs `YHH2IVKEZMVA` ("Visa® CAD",
CAD $5–$750, Canada only), which **requires product access approval** — email
the account manager first. If USD is acceptable, no approval is needed:
`Q24BD9EZ332JT` already covers Canada.

Verify the catalogue against the **production** key before the first real
payout, not sandbox — sandbox does not enforce production product gating:

```bash
curl 'https://api.tremendous.com/api/v2/products?country=CA&currency=USD' \
  -H "Authorization: Bearer $TREMENDOUS_API_KEY"
```

### The precondition that is not optional

Tremendous's ToS is **silent** on recipient age, and silence is not permission. Before real money
moves, get written confirmation from their support that recipients aged 13–17 may receive prepaid
Visa and gift cards in the US and Canada.

If they decline: **Tango Card (BHN)** states 13+ explicitly and is the drop-in fallback. The
integration keeps the vendor call behind one function for exactly this reason.

---

## When and how much

**$30, once, thirty days after the purchase. Never clawed back.**

This replaces the old $15-at-14-days / $15-at-ship split.

That split was built against refunds, but the real exposure is chargebacks — and Stripe's own
[docs](https://docs.stripe.com/disputes/how-disputes-work) say that on a future-delivery purchase
the dispute window "starts on the event date, not the payment date." So the ship-date tranche paid
out at **t=0 of a 120-day window**, not at the end of it. It bought fourteen days of refund cover
on half the money and nothing at all on the other half. It did not do the job it was built for.

Thirty days is the standard affiliate lock — [Whop uses exactly 30](https://docs.whop.com/manage-your-business/growth-marketing/affiliate-program) — and it covers the
voluntary-cancel window where nearly all real losses happen.

**The decisive reason is not financial.** A tranche pinned to "late 2026" is a promise pinned to
the one date we do not control. When hardware slips, a 15-year-old concludes they were lied to,
and says so publicly. That risk is bigger than the money.

Price the breakage instead: at 100 fellow-driven sales and a 10% cancel rate, paying up front
costs about **$300 total**. Effective CAC goes from $30 to $33.

**One safety valve, not two:** a manual `flagged` state a human clears, so a suspicious first sale
can be held past 30 days without inventing a second tranche.

---

## Never paying twice

The failure mode that matters is sending a teenager real money twice because a cron double-fired.

Tremendous's [create-order](https://developers.tremendous.com/reference/create-order.md) endpoint
is idempotent on **`external_id`**: a repeat with the same value returns **201** with the original
order, a genuine conflict returns **409**.

**So `external_id` is always the conversion id.** Never a timestamp, never a random value, never a
retry counter. That, plus claim-first-then-send in the sweep, is the whole protection.

**And it is also the only way to ask afterwards.** Looking an order up is
`GET /orders?external_id=<our key>`, reading the first element of the list.
`GET /orders/<id>` takes **Tremendous's own order id**, which is precisely the thing we do not
have when the question is "did the POST that timed out actually land?". Getting that wrong does
not crash anything — it just means every unclear outcome falls to a human instead, and a fellow
whose $30 really did go out waits behind a queue nobody is working.

**The claim key is not a count.** The sweep claims an attempt by INSERTing
`<external_id>#<sequence>` under a UNIQUE index, and the sequence comes from a monotonic counter
on the conversion row that moves in the same write as `status='paying'`. It must never be derived
from a count of ledger rows: two workers reading such a count at different moments compute
*different* keys, both INSERTs succeed, and the mutual exclusion that this whole design rests on
is gone.

Default to the **sandbox** base URL unless `TREMENDOUS_ENV` is explicitly `production`, so a
mistake costs zero dollars.

---

## Tax

- **US 1099-NEC threshold for 2026 payments is $2,000**, not $600 — raised by the One Big
  Beautiful Bill Act, first filings due Jan 2027. A $30 payment is nowhere near it.
- **A $30 payment to a Canadian for work done in Canada is foreign-source** (IRC §861(a)(3)):
  no US withholding, no 1042-S, no Canadian slip. W-8BEN is the standard instrument to document
  non-US status.
- **Collect early anyway.** Block at a `lifetime_paid_usd` of **$600** and require a form before
  going further. That is deliberately below the filing threshold — it buys room to collect
  before there is an obligation.

Tremendous is explicit that the client, not them, is responsible for "assessing, collecting,
reporting and remitting applicable taxes."

---

## What gets signed

1. **Tremendous's ToS** — by Omar, as Representative. Being 18+ is the whole requirement.
2. **Nothing extra from 18+ fellows** beyond the terms already accepted at `/fellows/apply`.
3. **A Guardian Payout Consent for every 13–17 fellow**, before their link earns.

The guardian consent must: name the fellow; have the guardian affirm they are the parent or legal
guardian and of age of majority; accept the terms **both on the minor's behalf and in their own
name as payee of record** (a minor's signature alone is voidable and gets us nothing); nominate
the email or phone the reward is delivered to; state that rewards are taxable income and that we
give no tax advice; and confirm that **posting is optional and always to the fellow's own
account**.

That last line is load-bearing. The Illinois, Minnesota and California kidfluencer statutes bind
the person who features a minor in monetised content, not the brand — our standing "posting is
never required" rule is what keeps us outside them. Minnesota also bars content-creation work by
minors under 14, so if that rule ever softened into "post this for us," 13-year-olds would become
learn-only.

**`GET /fellows/confirm` currently stores less than a mailing-list double opt-in, and it is the
only legal artifact in the system.** Replacing it with a real consent capture — guardian name,
guardian email, explicit affirmation, terms version, timestamp, IP — is the highest-priority
change in this document.

### Do not build a custodial account

A UTMA is a brokerage product needing an SSN and a broker, and it is absurd at $30. Nobody in the
precedent set does it: AdSense, Stripe, Whop and Roblox all simply make the adult the payee of
record.

---

## Environment

| Variable | Purpose |
|---|---|
| `TREMENDOUS_API_KEY` | Unset means nothing sends. Not an error — a state the gate can tell apart from broken. |
| `TREMENDOUS_ENV` | `production` opts in to real money. Anything else, including unset, is sandbox. |
| `TREMENDOUS_FUNDING_SOURCE_ID` | The balance orders draw from. |
| `TREMENDOUS_CAMPAIGN_ID` | Restricts the catalogue to the approved products. |

---

## Appendix: the email to send Tremendous

Copy-paste. Short and answerable with a yes or a no — a long email gets a long delay.

> **Subject:** Recipient age policy — can 13–17 year olds receive rewards?
>
> Hi,
>
> I'm setting up a Tremendous account for a small creator programme in the US and Canada.
> Some of our recipients are 13–17 years old.
>
> Your Terms of Service set an 18+ requirement for the account Representative, but I can't
> find any age condition on **recipients**. Before we go live I'd like that confirmed in
> writing:
>
> 1. May recipients aged 13–17 receive **prepaid Visa** rewards in the US and Canada?
> 2. May they receive **gift-card** rewards?
> 3. Is there anything additional you require from us when a recipient is a minor — a
>    guardian's consent on file, a different delivery method, or a product restriction?
>
> Individual rewards are $30, delivered by email.
>
> Thanks,
> Omar Ebrahim — Anticipy

**If they say no**, the fallback is Tango Card (BHN), whose terms state 13+ explicitly. Same
email, swapping the product names:

> **Subject:** Confirming recipient age policy for a US/Canada rewards programme
>
> Hi,
>
> Your Terms of Service say a user may not use Tango products if they are under 13 in the US,
> which I read as recipients aged 13+ being permitted. I'd like to confirm that before we
> build against it.
>
> We're running a small creator programme in the US and Canada. Some recipients are 13–17.
> Rewards are $30, delivered by email, prepaid Visa by default.
>
> 1. Can 13–17 year olds receive prepaid Visa and gift-card rewards in the US and Canada?
> 2. Do you require anything additional from us when a recipient is a minor?
>
> Thanks,
> Omar Ebrahim — Anticipy

**File the reply.** It is the document that says this arrangement was checked rather than
assumed, and it is the first thing anyone reviewing the programme will ask for.
