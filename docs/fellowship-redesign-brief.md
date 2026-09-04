# Anticipy Fellowship — redesign brief

## 1. Why Z Fellows converts

Z Fellows makes one legible promise in the first viewport, places the application action beside it, and then turns a long page into a sequence of reasons to believe. The rhythm alternates between large emotional statements, documentary imagery, concise program facts, named social proof, and another application moment. Whitespace gives each claim room. The external Google Form keeps the site focused on desire rather than account creation.

Its strongest transferable principles are: explain the opportunity immediately; make the audience recognize themselves; use proof after desire, not before it; repeat the primary action at natural decision points; and close with permission to apply before the visitor feels fully qualified.

## 2. What must not be copied

Do not borrow Z Fellows' blue identity, layout details, copy, photography, mentors, fellows, claims, testimonials, company logos, valuations, or playful founder voice. Anticipy does not yet have equivalent public social proof, so the design must earn credibility through specificity about the work and the company rather than fabricated people or outcomes.

## 3. Anticipy brand characteristics

Anticipy's core palette is near-black (`#0c0c0c`), warm mineral white (`#f5f0eb`), titanium/brass (`#c8a97e`), and white. Its typography pairs DM Serif Display with Plus Jakarta Sans. The brand speaks in short, concrete sentences, often using a sharp contrast or completed action. Product presentation is cinematic but restrained: dark/light chapters, generous negative space, close attention to physical material, compact labels, rounded light CTAs, and scroll scenes that slow the story down.

The fellowship should inherit that material confidence while feeling more like an annotated build notebook than a commerce page.

## 4. Visual direction

**Visual thesis: The Field Manual for Building What Leaves the Screen.**

The page moves between warm editorial paper and black technical plates. Thin rules, registration marks, measurements, build-state labels, and monospace annotations suggest a real prototype bench without pretending to show a team or product photography we do not have. Oversized serif statements provide humanity; compact sans-serif copy provides speed and precision. The three tracks share one system but each has a signal: software is cool blue, hardware is titanium gold, and growth is hot coral.

Hero candidates considered:

- Build where the hard parts meet.
- Get close enough to change the outcome.
- Build the company, not the case study.
- **Build what leaves the screen.**

The last line is strongest: specific to AI hardware, memorable, and broad enough to include software, hardware, and distribution.

## 5. Page architecture

1. Minimal sticky navigation with one persistent Apply Now action.
2. Hero: sharp proposition, two actions, and an original three-track build console.
3. Culture signal: a compact moving index of disciplines, not fake team imagery.
4. Thesis: why proximity to difficult, real problems changes how people learn.
5. Three tracks: large editorial panels with clear disciplines and distinct interaction states.
6. Why Anticipy: build for real, own problems, cross disciplines, ship and learn.
7. Process: Apply → Review → Conversation → Build, without invented timing.
8. Who should apply: evidence and initiative over résumé pedigree.
9. FAQ containing only answers supported by the supplied brief or public Anticipy product facts.
10. Final application moment and Anticipation Labs legal/footer links.

## 6. Interaction and motion direction

Use one coherent system: a quiet hero entrance, IntersectionObserver-based section reveals, a sticky build-culture sequence, a slow CSS discipline marquee, responsive track focus states, and small CTA arrow motion. Scroll progress may update a single CSS custom property for the sticky chapter. No WebGL, smooth-scroll hijacking, cursor effects, particles, or animation library.

This adapts the useful ideas behind 21st.dev's container scroll, text reveal, scroll morph, marquee, and spotlight patterns without importing React components or their styling. Every effect has a static equivalent when reduced motion is requested.

## 7. Technical approach

Keep the existing PocketBase-served HTML architecture. Replace only `pb_public/fellowships.html`; leave hooks, migrations, the old course page, and deployment topology untouched. Use semantic HTML, custom CSS, and small dependency-free JavaScript. Configure every application action from one `APPLICATION_URL` constant.

The team-approved external application is `https://forms.gle/Bo5p7QPxw9WrE5FM8`. Every Apply action is wired from the single `APPLICATION_URL` constant, opens the form in a new tab, and never enters the legacy signup flow. The fail-closed behavior remains in place if the value is removed or becomes invalid.

## 8. Mobile strategy

Mobile is a separate composition, not a collapsed desktop. The hero becomes a concise vertical statement with the track console immediately below. Navigation uses an accessible disclosure. Track panels remain tap-friendly and show all critical content without hover. The sticky culture scene becomes a straightforward stacked sequence on shorter or narrower screens. Type uses fluid clamps with guarded minimums, marquee overflow is clipped, and every control has at least a 44px target.

## 9. Performance strategy

Ship one HTML document with no package dependencies and one purpose-built editorial image. Keep JavaScript progressive and event work bounded with `requestAnimationFrame` and IntersectionObserver. Animate only transforms and opacity. Use the existing brand font loading pattern with strong fallbacks, reserve image dimensions, lazy-load the below-fold image, and compress it for the web.

## 10. Accessibility strategy

Use a skip link, semantic landmarks, one H1, ordered heading levels, visible `:focus-visible` states, high-contrast tokens, accessible disclosure buttons, `aria-expanded`/`aria-controls`, polite status for the unconfigured application URL, no hover-only information, and complete keyboard support. Respect `prefers-reduced-motion`, `prefers-contrast`, and 200% text zoom. Decorative technical marks remain hidden from assistive technology.

## Reference set

- [Z Fellows](https://www.zfellows.com/) — conversion architecture, documentary pacing, external-form model
- [Anticipy](https://www.anticipy.ai/) — palette, type pairing, product voice, material and scroll language
- [Foundry Fellowship](https://www.foundryfellowship.com/) — manifesto-led editorial pacing and identity-based qualification
- [Bison Fellowship](https://www.bisonfellowship.com/) — numbered chapter system and evidence-over-pedigree framing
- [South Park Commons Founder Fellowship](https://www.southparkcommons.com/programs/founders-fellowship) — conviction, depth, and anti-hype positioning
- [21st.dev](https://21st.dev/community/components/s/animated-hero) — container scroll, media expansion, text reveal, marquee, spotlight, and reduced-dependency implementation patterns
