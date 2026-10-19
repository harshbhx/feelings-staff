# Feelings Beauty Care: brand and stack reference for the staff attendance PWA

Researched 2026-10-19 by `fbc-ref-scan` (read-only). Nothing in the reference repo, Cloudflare or DNS was changed.

**Sources**
- Repo: https://github.com/harshbhx/feelings-beauty-care (private), `main` at commit `88eab55bd47d3f64bd2bc88392a3f6c79afaacac` (merge of PR #18). A shallow clone is at `/home/ubuntu/projects/feelings-attendance/ref/feelings-beauty-care`.
- Live: https://review.feelingsbeautycare.in (the new site) and https://feelingsbeautycare.in (the **old** site, still live), fetched with curl, plus `dig`.
- The Cloudflare account, read-only through the MCP tools: D1 and Workers lists.

**How citations work.** `path:line` refers to the repo at the commit above. A permalink is `https://github.com/harshbhx/feelings-beauty-care/blob/88eab55bd47d3f64bd2bc88392a3f6c79afaacac/<path>#L<line>`. For example, the brand tokens are at https://github.com/harshbhx/feelings-beauty-care/blob/88eab55bd47d3f64bd2bc88392a3f6c79afaacac/src/styles/tokens.css#L7-L149.

---

## 0. Key facts

| | |
|---|---|
| **Which site is the brand** | **review.feelingsbeautycare.in**, the new site in this repo. The apex `feelingsbeautycare.in` still serves the **old, rejected** dark-and-gold Vite SPA on Vercel. Never take colours, fonts or motion from the apex (`CLAUDE.md:3`, `docs/04-decisions-and-feedback.md:12-16`). |
| **Look in one line** | A white page, one sindoor red (`#b3121b`) for every action, a deep maroon (`#5c0a14`) to anchor, warm red-tinted neutrals and the red **bindi dot** as the signature (`docs/03-design-system.md:5`). |
| **Font** | **Plus Jakarta Sans** variable (200–800 with a true italic), self-hosted through Fontsource. Weights 400/600/700/800 only (`src/styles/tokens.css:88-94`). |
| **Stack** | Astro 5.18.2 static, plain CSS tokens (**no Tailwind, no UI kit, no animation library**), TypeScript strict, Cloudflare Pages with Git integration, Pages Functions, D1 (`fbc-analytics`) and Node 22 (`package.json:14-27`, `CLAUDE.md:13-19`). |
| **Hosting** | The DNS zone is on **Cloudflare** (NS `ines`/`renan.ns.cloudflare.com`). `review.` is served by Cloudflare Pages project `feelings-beauty-care-preview`. The apex is a Cloudflare-proxied Vercel origin. |
| **Default geofence** | **22.4606479, 70.0565093**, from the owner's Google place link of 2026-10-19 (`src/data/site.ts:11`). The address is Om Residency, Hirji Mistry Road, near J J Tower, Jamnagar 361006, Gujarat (`src/data/site.ts:26-33`). |
| **Open PRs** | **None.** All 18 PRs are merged. The unread notifications are bot activity on merged PRs (see §5.5). |

---

## 1. Brand system

### 1.1 Source of truth and rules
- **Colours live only in `src/styles/tokens.css`.** Components use semantic tokens (`--bg`, `--text`, `--accent`, `--tone-*`) and never a hex value (`CLAUDE.md:64`, `src/styles/tokens.css:1-5`).
- **One accent.** Primary actions are always `--accent` (sindoor red). The service tones are only for small marks: dots, bullets, the bindi, the active nav item and course durations. They are never fills and never buttons (`CLAUDE.md:65`).
- **One red button per view** (`CLAUDE.md:68`), and 3–5 red placements per screen (`docs/03-design-system.md:63`).
- **No gold. No gradients, glows, blur orbs or grain.** Depth comes from white space, hairlines and two soft shadows (`docs/03-design-system.md:64-65`).
- Text on red or maroon is always white, and text on white is always ink (`docs/03-design-system.md:66`).
- Proportion on a typical page: white 70, blush 14, maroon 9, red 5, service tones 2 (`docs/assets/palette.png`).
- Full spec: `docs/03-design-system.md` (palette image `docs/assets/palette.png`, type specimen `docs/assets/type-and-components.png`). **The screenshots in `docs/assets/` still show the earlier serif headline font.** The current font is Plus Jakarta Sans.

### 1.2 Colour tokens (exact, from `src/styles/tokens.css`)

**Raw palette**

| Token | Hex | Role | Contrast on white | Line |
|---|---|---|---|---|
| `--white` | `#ffffff` | page | | 9 |
| `--rose-50` | `#fff7f6` | warm white band | | 10 |
| `--rose-100` | `#fbeceb` | blush tint surface, image placeholder | | 11 |
| `--rose-200` | `#f2d8d6` | strong hairline on blush, card outlines | | 12 |
| `--rose-line` | `#efe3e1` | default hairline | | 13 |
| `--ink-900` | `#1e1214` | headings | 18.2:1 | 15 |
| `--ink-700` | `#4b3b3e` | body | 10.5:1 | 16 |
| `--ink-500` | `#76656a` | muted, captions | 5.5:1 | 17 |
| `--ink-300` | `#9a888d` | control outlines, empty stars | 3.3:1 (non-text) | 18 |
| `--red-600` | `#b3121b` | **sindoor: primary action** | 7.0:1 | 20 |
| `--red-700` | `#8f0e16` | pressed / hover | 9.4:1 | 21 |
| `--maroon-800` | `#5c0a14` | deep band, **logo colour** | white on it 13.9:1 | 22 |
| `--maroon-900` | `#3a0710` | footer | | 23 |
| `--rose-600` | `#be1e5a` | nails tone | 6.0:1 | 26 |
| `--henna-600` | `#9a3b1b` | mehndi tone | 7.0:1 | 27 |
| `--coral-600` | `#c2412d` | salon tone | 5.1:1 | 28 |
| `--plum-700` | `#6e1e4e` | academy tone | 10.6:1 | 29 |
| `--red-400` `--rose-400` `--henna-400` `--coral-400` `--plum-400` | `#f05750` `#ee5180` `#d77252` `#e7634d` `#c971a0` | the same tones lifted (OKLCH L 0.66) for dots on maroon, each at least 5:1 on `--maroon-900` | | 33-37 |

**Semantic layer** (`src/styles/tokens.css:40-81`)

| Semantic | Maps to |
|---|---|
| `--bg` / `--bg-soft` / `--bg-tint` / `--bg-deep` / `--bg-deepest` | white / rose-50 / rose-100 / maroon-800 / maroon-900 |
| `--text` / `--text-body` / `--text-muted` | ink-900 / ink-700 / ink-500 |
| `--text-on-deep` / `--text-on-deep-muted` | white / `rgb(255 255 255 / 0.76)` |
| `--accent` / `--accent-hover` / `--on-accent` | red-600 / red-700 / white |
| `--border` / `--border-strong` / `--border-control` / `--border-on-deep` | rose-line / rose-200 / ink-300 / `rgb(255 255 255 / 0.16)` |
| `--focus` | red-600 |
| `--bg-glass` | `rgb(255 255 255 / 0.94)` (sticky header, phone bar, with `backdrop-filter: blur(10px)`) |
| `--tap` | `rgb(179 18 27 / 0.1)` (phone tap highlight) |
| `--scrim` / `--scrim-control` / `--scrim-soft` | `rgb(30 18 20 / 0.94 \| 0.6 \| 0.42)` |
| `--tone-bridal` / `-nails` / `-mehndi` / `-salon` / `-academy` | red-600 / rose-600 / henna-600 / coral-600 / plum-700 |
| `--tone-*-on-deep` | the `-400` twins |

Live-component aliases (`src/styles/live.css:6-38`): `--live-skeleton: var(--bg-tint)`, `--live-skeleton-soft: var(--border)`, `--live-open: var(--accent)` and `--live-closed: var(--text-muted)`. The story ring is `color-mix(in oklab, var(--accent) 78%, var(--bg-deep))`.

Verified live: the inlined CSS on review.feelingsbeautycare.in contains `--red-600: #b3121b`, `--maroon-800: #5c0a14`, `--rose-50: #fff7f6`, `--ink-900: #1e1214`, `--radius-md: 12px` and the same `--shadow-md`.

**There are no status colours.** Form errors reuse `--accent` (`src/pages/contact-feelings-beauty.astro:570-591`). An attendance app needs present, late, absent and leave states. §6.2 proposes an extension that has been checked for contrast. Harsh or Urmi must approve it, because it adds the brand's first non-red hue.

`color-scheme: light` only, with no dark mode (`src/styles/tokens.css:148`). `<meta name="theme-color" content="#ffffff">` (`src/components/Seo.astro:42`).

### 1.3 Typography
- **Family:** `"Plus Jakarta Sans Variable", "Plus Jakarta Sans", "Segoe UI", system-ui, -apple-system, sans-serif` for both display and body (`src/styles/tokens.css:88-89`). One family only, and "never bring back a thin or serif display face" (`CLAUDE.md:66`).
- **Loading:** Fontsource npm package `@fontsource-variable/plus-jakarta-sans` ^5.3.0 (`package.json:15`). It imports `wght.css` and `wght-italic.css` (`src/layouts/Base.astro:2-3`) and **preloads the latin woff2** (`src/layouts/Base.astro:8,31`). There is no Google Fonts request, and the font uses `font-display: swap` (`docs/03-design-system.md:74`).
- **Weights, as tokens:** `--weight-body` 400, `--weight-ui` 600 (nav, meta), `--weight-strong` 700 (buttons, sub-heads, names, eyebrow), `--weight-display` 800 (h1, h2, big numerals). No other values (`src/styles/tokens.css:91-94`).
- **Sizes:** `--text-xs` 13px (labels only), `--text-sm` 15px, `--text-base` 17px, `--text-lg` 20px, `--text-xl` `clamp(1.375rem, 1.15rem + 0.9vw, 1.75rem)` (22–28), `--text-2xl` `clamp(1.875rem, 1.3rem + 2.3vw, 3rem)` (30–48), `--text-3xl` `clamp(2.5rem, 1.5rem + 4vw, 4.5rem)` (40–72) (`src/styles/tokens.css:96-102`). **Nothing under 13px.**
- **Leading:** 1.04 tight (h1), 1.1 snug (h2), 1.65 body (`src/styles/tokens.css:104-106`).
- **Tracking tightens as size grows:** h1 −0.032em, h2 and display −0.025em, 22–28px names −0.015em, h3 −0.01em, body untouched. The eyebrow is uppercase at +0.09em, 13px, weight 700, and appears at most once per three sections (`src/styles/global.css:70-94, 214-221`, `docs/03-design-system.md:78-91`).
- **Other rules:** sentence case everywhere, `text-wrap: balance` on headings, `text-wrap: pretty` on paragraphs, `tabular-nums` on phone numbers and times (`docs/03-design-system.md:93`). `h1 em, h2 em { color: var(--accent) }`: one emphasised word, italic and red (`src/styles/global.css:100-103`). Inputs are at least 16px so iOS does not zoom (`src/pages/contact-feelings-beauty.astro:546`).

### 1.4 Logo files
| File | Format | Size | Use |
|---|---|---|---|
| `src/assets/brand/logo.webp` | WebP (VP8X) | 1024×291, 22 KB | The wordmark ("feelings", a line-art face, "Beauty Care" and ®). The client's file is **navy**. `Logo.astro` draws it as a **CSS mask** in `--maroon-800` (`tone="ink"`) or white (`tone="white"`), so one file covers both colours (`src/components/Logo.astro:1-37`). There is a forced-colours fallback to `CanvasText` (`:40-45`). Whether recolouring is OK is still marked CONFIRM with the client (`:4`). |
| `public/logo.png` | PNG 800×800, maroon wordmark centred on white | 11 KB | Schema `logo` and sharing. |
| `public/favicon.svg` | SVG: one circle `r=20` in a 64 box, `fill="#b3121b"` | | **The bindi is the favicon.** |
| `public/favicon-32.png`, `public/apple-touch-icon.png` | PNG 32×32 and 180×180: a red bindi dot on white | | Icons. |
| `public/og.jpg` | JPEG 1200×630 | | Share image (bold sans). |

**Gap:** there is **no vector logo**, only rasters. The PWA icon should be the bindi, built from `favicon.svg`. Its circle has a diameter of 62.5% of the canvas, inside the 80% maskable safe zone, so it works as-is for `purpose: "maskable"`. To use the wordmark in the app header, reuse the mask technique with `logo.webp`, or ask the client for an SVG.

### 1.5 Shape, depth, spacing, layout (`src/styles/tokens.css:108-137`)
- **Radius:** `--radius-sm` 6px (inputs, chips, focus ring), `--radius-md` 12px (cards, photos, chip cards), `--radius-lg` 22px (large media), `--radius-pill` 999px (**all buttons are pills**).
- **Shadows** ("most surfaces need none"):
  - `--shadow-sm: 0 1px 2px rgb(30 18 20 / 0.06), 0 2px 8px -2px rgb(30 18 20 / 0.08)`
  - `--shadow-md: 0 1px 2px rgb(30 18 20 / 0.05), 0 14px 34px -14px rgb(30 18 20 / 0.24)`
  - `--shadow-accent: 0 10px 24px -10px rgb(179 18 27 / 0.55)` (red button hover only)
  - `--shadow-header: 0 10px 30px -18px rgb(30 18 20 / 0.28)` (header after scrolling)
  - The shadow colour is ink `rgb(30 18 20)`, never black.
- **Space (4px base):** 1=4, 2=8, 3=12, 4=16, 5=24, 6=32, 7=48, 8=64, 9=96, 10=128 px. Sections use `--section-y: clamp(3.25rem, 2.2rem + 4vw, 7rem)` and `--section-y-tight: clamp(2.75rem, 2rem + 3vw, 5rem)`.
- **Layout:** `--container` 76rem (1216px), `--container-narrow` 46rem, `--gutter: clamp(1.25rem, 0.6rem + 2.6vw, 2.5rem)` (20–40px). `--header-h` is 4rem on phones and 4.5rem from 48rem; `--mobile-bar-h` is 4.75rem.
- **Breakpoints in use:** 30rem (stacked buttons go full width, `global.css:379`), 48rem (phone/tablet split, `tokens.css:152`), 56rem (hero split, three-column reviews), 64rem (desktop nav).
- **Buttons** (`src/styles/global.css:295-370`): pill shape, `min-height: 3rem` (48px), padding `0.75rem 1.4rem`, weight 700, 17px, icon 1.2em with a 0.55em gap, `:active { transform: scale(0.98) }`. `.btn-primary` is the accent with white text and `--accent-hover` on hover. `.btn-secondary` is white with a `--border-strong` outline whose border turns ink on hover. `.btn-sm` is 2.5rem / 15px. On a deep band, primary turns white with red text.
- **Focus:** `outline: 2px solid var(--focus); outline-offset: 3px; border-radius: var(--radius-sm)`, white on deep bands (`global.css:122-126, 178-180`).
- **Inputs** (`src/pages/contact-feelings-beauty.astro:535-593`): `min-height 3.25rem`, padding `0.8rem 1rem`, 1px `--border-control`, `--radius-sm`, ink border on hover, accent border plus a 2px accent outline on focus, an accent border when invalid. Hints sit **above** fields so the phone keyboard never covers them.
- **Tap targets** are 44px or more (`docs/03-design-system.md:223`).

### 1.6 Iconography
- **Phosphor, regular weight only**, from `@phosphor-icons/core` 2.1.1 (`package.json:22`). The SVGs are copied into `src/icons/` and rendered inline by `src/components/Icon.astro` (decorative by default with `aria-hidden`, or `role="img"` with a label). "Do not add a second icon set" (`docs/03-design-system.md:197`, `CLAUDE.md:76`).
- **Existing set:** arrow-right, arrow-up-right, arrow-up, caret-down/left/right/up, check-circle, **clock**, close, facebook, google-logo, heart(-fill), instagram, **map-pin**, menu, minus, **navigation**, phone, play-fill, plus, share, star-fill, whatsapp, youtube.
- **For attendance**, add from the same package (regular weight): `sign-in`, `sign-out`, `calendar-blank`, `calendar-check`, `user`, `users`, `camera`, `fingerprint`, `warning-circle`, `x-circle`, `coffee` (break), `airplane-tilt` or `umbrella` (leave), `chart-bar`, `gear`, `lock`.
- Icons in buttons are 1.2em, and standalone icons are 1.25em (`global.css:322-326, 413-417`).

### 1.7 Motion (`src/styles/motion.css`, `docs/03-design-system.md:152-180`)
- **Principle:** "small and everywhere, never large or looping" (`CLAUDE.md:67`). Animate opacity and transform only.
- **Tokens:** `--ease-out: cubic-bezier(0.2, 0.7, 0.2, 1)`, `--ease-soft: cubic-bezier(0.25, 1, 0.35, 1)`, `--dur-fast` 140ms, `--dur-base` 220ms, `--dur-enter` 420ms, `--dur-reveal` 720ms, `--reveal-distance` 18px (`tokens.css:140-146`).
- **Patterns worth reusing:**
  - Scroll reveal: fade plus an 18px rise, once, with an 80ms stagger.
  - Bindi lands: `bindi-in` at 520ms, `cubic-bezier(0.34, 1.5, 0.5, 1)` (a small spring), from `scale(0)`, on the h1 only (`motion.css:340-353`).
  - Button hover: a 1px lift, a red shadow on the primary button and an icon "nudge" (rotate −10°, scale 1.08) (`motion.css:355-381`).
  - Touch press: `[data-press]:active { scale: 0.97 }` (`global.css:439-466`).
  - Android haptic tick: `navigator.vibrate(8)` on choices, never with reduced motion (`Base.astro`, window `__fbcTick`).
  - Cross-document View Transitions: 180ms out, 380ms in (`motion.css:20-52`).
  - The skeleton breathes 6 times at most, and the open-now dot pulses 3 times and stops.
- **Not allowed:** loaders, smooth-scroll hijacking, custom cursors, parallax, marquees, auto carousels, 3D, number counters, text cyclers, grain, shimmer, or anything that loops forever (`docs/03-design-system.md:176`).
- **Reduced motion is tiered:** tier 1 (slides, zooms, lifts) is removed, tier 2 (reveals) becomes a 160ms fade, and tier 3 (colour changes, focus) stays (`motion.css:1-16, 238-243`).

### 1.8 What makes it look like this brand and not generic
1. **Warm neutrals with a trace of red.** The ink is `#1e1214`, not grey or slate, and hairlines are `#efe3e1`. "Pure grey never sits next to the bridal reds" (`docs/03-design-system.md:33`). Never use Tailwind's `gray`, `slate` or `zinc`.
2. **The bindi:** a red dot used as the full stop on key headings (`<span class="bindi">`, 0.17em), as list bullets, as the active-nav marker, and as the favicon (`global.css:259-291`, `docs/03-design-system.md:101-108`).
3. **The sindoor line:** a hand-drawn tapered brush stroke (filled SVG paths, three shapes) that paints in left to right in 880ms. It sits under the one emphasised red italic word, at most one per screen and three per page, and is never a border, bullet or loader (`src/components/Sindoor.astro`, `docs/03-design-system.md:110-136`). **In a staff app, use it at most once** (for example under the greeting on the first screen) or not at all.
4. **A red italic emphasis word** in the h1 ("Bridal makeup that still looks like *you*.", `src/pages/index.astro:71-72`).
5. **One bold family at 800** with tight negative tracking. Hierarchy comes from weight and size, never a second face.
6. **A single red action per view.** The pill buttons are always sindoor; the service tones never appear on buttons or fills.
7. **Hairlines over shadows**, white over colour, and one deep maroon band per page.
8. **Honesty rules:** no invented numbers or superlatives (`CLAUDE.md:71`).

### 1.9 Voice and tone
- Plain, warm, first-person-plural studio voice: "Write the way Urmi would speak to a bride", not "for search engines" (`docs/03-design-system.md:235`). Sentence case. No superlatives ("best in Jamnagar"), no unverified numbers (`CLAUDE.md:71`). English UI; **Hinglish is fine, pure Hindi is not** (`HANDOFF.md:130`).
- **One label per intent:** "Book on WhatsApp" everywhere (`CLAUDE.md:70`). The staff-app equivalent is one verb pair, for example "Check in" / "Check out", used consistently.
- **Live examples:**
  - "Bridal makeup that still looks like you." (h1)
  - "Booking takes one message" (`src/pages/index.astro:326`)
  - "Questions we get asked" (`src/components/Faq.astro:12`)
  - "Visit the studio" (`src/components/Visit.astro:12`)
  - "Planning a wedding, or just a fresh look?" (`src/components/Footer.astro:28`)
  - "Tell us your date and what you have in mind." (`Footer.astro:29`)
  - "Urmi and the team arrive on time with everything planned." (`src/data/services.ts:92`)
  - Button labels on the live home page: "Book on WhatsApp", "Call", "Get directions", "See bridal makeup", "See the courses", "Ask about the next batch", "Review us on Google".
  - Founder quote: "Beauty is not about transformation. It is about revelation." (`src/data/site.ts:81-84`)
- **Implications for staff microcopy:** short, kind, factual. For example "You're in at 10:02.", "You're outside the studio. Move closer, or mark this as a venue visit.", "Late by 12 min. Add a note for Urmi?". Never shame the user, never use exclamation spam, and never use a fake streak or score.

### 1.10 Accessibility floor (`docs/03-design-system.md:217-224`)
Body contrast is at least 4.5:1, with muted text the lowest at 5.5:1. There is a visible 2px red focus ring, a skip link, one real h1 per page, and labelled fields with linked errors. Tap targets are at least 44px and inputs at least 16px. Nothing autoplays, and all motion can be turned off.

---

## 2. Stack

| Area | What the reference uses | Evidence |
|---|---|---|
| Framework | **Astro 5.18.2**, static output, `trailingSlash: "never"`, `build.format: "file"`, `inlineStylesheets: "always"`, `compressHTML` | `package.json:16`, `astro.config.mjs:1-16` |
| Why not Astro 7 | Needs Node ≥ 22.22, and the dev machine had 22.17 | `CLAUDE.md:16`, `docs/04-decisions-and-feedback.md:21-22` |
| Language | TypeScript ^5.9.2, `astro/tsconfigs/strict`; `functions/` has its own tsconfig with `@cloudflare/workers-types` | `tsconfig.json`, `functions/tsconfig.json` |
| Runtime | Node ≥ 22 (`.node-version` = 22; Pages env `NODE_VERSION=22`) | `package.json:25-27`, `README.md:167` |
| UI library | **None.** Plain `.astro` components and scoped CSS; no React or Preact, no Tailwind, no shadcn | `CLAUDE.md:15` |
| CSS | Plain CSS: `tokens.css`, `global.css`, `motion.css`, `live.css` | `src/styles/` |
| Images | `astro:assets` with sharp 0.34.5: responsive AVIF with a WebP fallback, blurred placeholders | `package.json:17`, `src/components/Photo.astro` |
| State / data | Build-time TS data files (`src/data/*.ts`); browser `localStorage` (`fbc-looks`) and `sessionStorage` (`fbc-bar`) | `src/data/site.ts`, `Base.astro:42` |
| Backend | **Cloudflare Pages Functions:** `functions/api/reviews.ts` (Zernio → Google reviews, edge-cached 6 h) and `functions/api/tap.ts` (counts WhatsApp and call taps into D1) | `CLAUDE.md:19`, `docs/05-live-features.md` |
| Database | **Cloudflare D1** `fbc-analytics`, APAC, bound as `DB`, one table `taps` | `docs/05-live-features.md:76-82` |
| Auth | **None yet.** The planned `/admin` design is a shared password checked against a Pages secret, then a signed HttpOnly, Secure, SameSite=Strict cookie (~30 days), with D1-counted lockout | `TODO.md:16-35` |
| Hosting / deploy | **Cloudflare Pages with Git integration**, project `feelings-beauty-care-preview`. Push to `main` deploys production (the preview site); every branch and PR gets `https://<branch>.feelings-beauty-care-preview.pages.dev`. Build: `npm run build`, output `dist`. **Never `wrangler pages deploy`** (that creates a Direct Upload project, which can't be Git-linked later). No `wrangler.toml`, no `vercel.json`. | `README.md:154-172`, `CLAUDE.md:52-59` |
| CI | **No GitHub Actions** (no `.github/` directory). The only check on commits is the "Cloudflare Pages" check run, plus bot reviews from CodeRabbit and devloai on PRs. No branch protection. | `gh api .../contents/.github` → 404; `check-runs` on main |
| Build gates | `astro check` (types) + `astro build` + `scripts/csp.mjs` (hashes inline scripts into a CSP in `dist/_headers`, and fails on inline handlers or a header over 2,000 chars) | `package.json:9`, `scripts/csp.mjs:1-27` |
| Testing | No framework. Node scripts with `node:assert` that transpile the real Pages Function and run it against a mocked `fetch`, `caches` or a fake D1: `scripts/test-tap-function.mjs` (10 tests) and `scripts/test-reviews-function.mjs`. Post-build checks: `scripts/check-seo.mjs` and `scripts/check-warm.mjs`. Screenshots were taken locally in headless Edge. | `scripts/` |
| Lint / format | **None** (no ESLint, Prettier or Biome config) | repo root |
| PWA | **None.** No manifest and no service worker. A "small service worker" was considered and deferred (`TODO.md:38-39`). The site uses Speculation Rules prefetch and prerender (PR #18). | live HTML; `TODO.md:38` |
| i18n | None. `lang="en-IN"`, English with Hinglish allowed | `Base.astro:28`, `HANDOFF.md:130` |
| Analytics | Cookie-free `/api/tap` → D1. Cloudflare Web Analytics is allowed by the CSP but **not enabled** (no beacon in the live HTML). No GA on the new site; the old apex has GA4. | `scripts/csp.mjs:50,57`, `HANDOFF.md:91` |
| Security headers | `public/_headers`: nosniff, a strict referrer policy, **`Permissions-Policy: camera=(), microphone=(), geolocation=()`**, `X-Frame-Options: SAMEORIGIN`, HSTS for 1 year, COOP same-origin, and a CSP generated at build time | `public/_headers:1-30` |
| Env vars (names only) | `PUBLIC_SITE_ENV` (`"production"` only for the live-domain build; anything else is a noindexed preview); Pages secrets `ZERNIO_API_KEY`, `ZERNIO_ACCOUNT_ID`, `ZERNIO_LOCATION_ID`; Pages env `NODE_VERSION`; D1 binding `DB`. Planned for `/admin`: `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `GITHUB_TOKEN` | `.env.example`, `functions/api/reviews.ts:17-20`, `TODO.md:33` |

**Cloudflare account** (the same account holds `fbc-analytics`, which confirms it is the salon's account):
- D1 databases: `fbc-analytics`, `dualmind-waitlist`, `dualmind_arena`, `tarang-news`.
- Workers: 20, including two older salon-named scripts, `feelingsbeautycare` (Apr 2026) and `feelings-beauty-inbox` (Jul 2026; the zone uses Cloudflare Email Routing, so it is probably an email worker, but that is unverified).
- Harsh also deploys plain Workers (`tarang-fm`, `dualmind-api`), so both Pages and Workers patterns exist in this account.

---

## 3. Domain, DNS, CDN

| Host | DNS answer | Served by | Evidence |
|---|---|---|---|
| Zone `feelingsbeautycare.in` | NS `ines.ns.cloudflare.com`, `renan.ns.cloudflare.com`; MX `route1-3.mx.cloudflare.net` (Cloudflare Email Routing); SPF `include:_spf.mx.cloudflare.net`; a Google site-verification TXT | **Cloudflare DNS** | `dig NS/MX/TXT` |
| `feelingsbeautycare.in` (apex) | A 104.20.45.65, 172.66.163.236 (Cloudflare anycast, proxied) | **Vercel origin behind the Cloudflare proxy**: `server: cloudflare`, `cf-ray …-BOM`, **`x-vercel-id: bom1::…`**, `x-vercel-cache`; HSTS `max-age=63072000; includeSubDomains; preload` | `curl -I` |
| `www.` | Same IPs | Vercel 307 → apex | `curl -I` |
| `review.` | Same anycast IPs (proxied CNAME, flattened) | **Cloudflare Pages** project `feelings-beauty-care-preview`: `server: cloudflare`, no Vercel headers, the CSP and Permissions-Policy from `_headers`, `cf-cache-status: DYNAMIC` | `curl -I`; `CLAUDE.md:58`; `HANDOFF.md:14` |
| `staff.` | **No record yet** | | `dig` (empty) |

- The apex still runs the **old site**: a Vite/React SPA with `theme-color #060604`, Google Fonts (Cormorant Garamond, Playfair Display, DM Sans, Montserrat) and GA4. The plan is to move the apex to the Pages project at go-live (`README.md:178-184`).
- **Would `staff.feelingsbeautycare.in` go on the same provider? Yes, very plausibly.** The zone is already on Cloudflare in the same account. The `review.` precedent was to attach the custom domain to the Pages project through the API, after which the owner activated the DNS record in the dashboard, because the wrangler OAuth token has `zone:read` but no DNS edit (`CLAUDE.md:58`). A 522 for a few minutes while the certificate is issued is normal.
- **HTTPS is mandatory.** The apex sends HSTS with `includeSubDomains; preload`, so browsers that visited it will force HTTPS on `staff.` too. Cloudflare provides that automatically.
- **Headers are per project.** A separate Pages project for staff gets its own `_headers` and does not inherit the website's `geolocation=()` ban. The staff app must send `Permissions-Policy: geolocation=(self)`, plus `camera=(self)` if selfies are used.

---

## 4. Reusable parts

### 4.1 Copy these verbatim (they are framework-agnostic CSS and TS)
| Part | File | Why |
|---|---|---|
| Tokens | `src/styles/tokens.css` (156 lines) | The brand itself. Copy it unchanged and extend it in a separate file (§6). |
| Base, buttons, bindi, focus, eyebrow, dot-list, press feedback | `src/styles/global.css:1-131, 213-417, 435-466` | Buttons and the bindi are the core of the look. |
| Motion subset | `src/styles/motion.css`: reveal (205-243), bindi-in (340-353), micro-interactions (355-385), reduced-motion tiers | Keeps the "small, never looping" feel. |
| Skeleton and open-dot tokens | `src/styles/live.css` | Loading states in brand. |
| Form fields | `src/pages/contact-feelings-beauty.astro:506-593` (`.field`, `.label`, hints above, inputs, errors) | Login, notes, leave requests. |
| Chips (real radio or checkbox drawn as pills or cards; the tone dot turns into a check) | `src/components/Chip.astro` | Shift, leave type, reason pickers. |
| Stepper (±, 44px circular buttons) | `src/components/Stepper.astro` | Quantities and durations. |
| Fixed bottom action bar (glass, safe-area padding, 1fr/2fr grid) | `src/components/MobileBar.astro` | The "Check in" bar on phones. |
| Open-now logic: weekly schedule in **Asia/Kolkata** through `Intl.DateTimeFormat`, refreshed every minute | `src/components/live/OpenNow.astro` | The basis for shift windows and "studio open" checks. |
| India day key | `functions/api/tap.ts:29` `indiaDay()` (UTC+5:30 → `YYYY-MM-DD`) | Attendance rows keyed by the studio's day. |
| Pages Function patterns: host allow-list, Origin check, quiet failure with an `X-…` status header, D1 upsert | `functions/api/tap.ts:14-68` | API style for check-in endpoints. |
| Function test harness (transpile the real handler, fake D1, `node:assert`) | `scripts/test-tap-function.mjs` | Same pattern for attendance endpoints. |
| CSP generator for Pages `_headers` | `scripts/csp.mjs` | Same security posture. |
| Icons | `src/components/Icon.astro` + `src/icons/*.svg` | Same Phosphor-regular set. |
| Logo as a mask | `src/components/Logo.astro` + `src/assets/brand/logo.webp` | Maroon or white wordmark. |
| Bindi favicon | `public/favicon.svg` (+ the 32px and 180px PNGs) | PWA icon base (maskable-safe). |
| Haptic tick | `src/layouts/Base.astro` (the `__fbcTick` block) | Confirms check-in on Android. |

### 4.2 Data models
- **No staff, employee, shift, attendance or branch models exist anywhere** in the code. The only one is the D1 table `taps(day, host, kind, place, path, count)` with `PRIMARY KEY (day, host, kind, place, path)`, `WITHOUT ROWID` (`docs/05-live-features.md:77-81`).
- **Single studio, no branches:** `site.ts` has one address and one geo point.
- **Business facts** (`src/data/site.ts:13-76`): name; founder Urmi Mengar (spelling marked CONFIRM); founded 2009; main phone and WhatsApp +91 80006 61578; second phone +91 99242 69898 (CONFIRM); email not set (CONFIRM).
- **Hours:** Mon–Sat 10:00–20:00 and Sun 10:00–13:00, matching Google Business Profile as of May 2026 and marked CONFIRM. These are a natural default for shift windows.
- **The team works off-site:** the bridal team travels to wedding venues ("Urmi and the team arrive on time with everything planned", `src/data/services.ts:92`; "we will plan the team and travel with you", `services.ts:116`, `src/data/home.ts:18`). **The attendance app needs a "venue / off-site" check-in mode**, not only the studio geofence.

### 4.3 Salon address and coordinates (default geofence)
- **Pin: lat 22.4606479, lng 70.0565093** (`src/data/site.ts:11`), from the owner's Google place link on 2026-10-19 (`docs/04-decisions-and-feedback.md:86-87`). **Do not use the old pin 22.470722, 70.057711, which is about 1.1 km off** (it is still in three blog posts).
- **Address:** Om Residency, Hirji Mistry Road, Near J J Tower, Jamnagar, Gujarat 361006, IN (`src/data/site.ts:26-33`).
- **Maps place:** https://www.google.com/maps/place/Feelings+Beauty+Care/@22.4606479,70.0565093,17z (CID `0xf8ff498bbaccb930`).
- **Suggested radius:** about 100–150 m. Indoor GPS accuracy on phones is often 20–80 m, so check the reported `accuracy` too.

---

## 5. Repo conventions

### 5.1 Branches
`feat/<topic>`, `fix/<topic>`, `perf/<topic>`, `security/<topic>`. Examples: `feat/sindoor-line`, `fix/stories-loading`, `perf/warm-site`, `security/csp`. Branches are not deleted on merge (`deleteBranchOnMerge: false`), and `feat/hero-desktop` is kept on purpose (`HANDOFF.md:70`). The default branch is `main`, with no protection.

### 5.2 Commits and PRs
- Conventional commits with a scope, for example `feat(home): …`, `feat(security): …`, `perf(stories): …`, `docs: …` (`CLAUDE.md:87`).
- Author: Harsh Bhanushali, using the identity in `CLAUDE.md:84`.
- **No AI attribution of any kind** (`CLAUDE.md:85`).
- **PR bodies:** a first line linking the TODO item or plan, a `**Preview:** https://<branch>.feelings-beauty-care-preview.pages.dev` line, a short "what changes" paragraph, then `## Results` with measured tables (Lighthouse, timings) and numbered **acceptance checks**. Example: https://github.com/harshbhx/feelings-beauty-care/pull/18
- Harsh merges PRs with **merge commits** (for example `88eab55 Merge pull request #18`). Each PR is reviewed on his phone through its Pages preview (`docs/04-decisions-and-feedback.md:89-90`).
- **Docs discipline:** update `HANDOFF.md` every session, log client feedback the same day in `docs/04-decisions-and-feedback.md`, and never start a `TODO.md` item without the owner's go (`CLAUDE.md:5-11`).

### 5.3 Scripts (`package.json:7-13`)
`dev` (astro dev, port 4321), `build` (`astro check && astro build && node scripts/csp.mjs`), `build:fast`, `preview`, `check`. The helpers are plain `node scripts/*.mjs`.

### 5.4 Lint
None. `astro check` with strict TS is the only static gate.

### 5.5 Open PRs and notifications
- **Open PRs: 0.** All 18 are merged:
  - https://github.com/harshbhx/feelings-beauty-care/pull/1 to https://github.com/harshbhx/feelings-beauty-care/pull/18
  - The latest are https://github.com/harshbhx/feelings-beauty-care/pull/18 (perf: warm the site), https://github.com/harshbhx/feelings-beauty-care/pull/17 (blurred photo previews), https://github.com/harshbhx/feelings-beauty-care/pull/16 (CSP) and https://github.com/harshbhx/feelings-beauty-care/pull/15 (phone wow pass).
- **Notifications:** there are 18 notifications on the repo, all reason `author`, all on **merged** PRs. 16 are unread; only #6 and #8 have been read. The activity comes from the `coderabbitai`, `devloai` and `cloudflare-workers-and-pages` bots. The "13 notifications" in the morning brief were these. No action is pending on any open PR.
- **Doc drift:** `TODO.md:7` still says "Still open: #13", but #13 is merged.

---

## 6. Design tokens (ready to use)

### 6.1 CSS variables: the brand, copied exactly
Put this in `src/styles/tokens.css` of the new app. It is the reference file with layout-only tokens trimmed (`--section-y*`, `--container*` are kept for desktop admin views). Every value is unchanged.

```css
/* Feelings Beauty Care brand tokens. Copied from harshbhx/feelings-beauty-care
   src/styles/tokens.css @ 88eab55. Do not edit values here; extend in app-tokens.css. */
:root {
  /* Palette (raw) */
  --white: #ffffff;
  --rose-50: #fff7f6;    /* warm white band */
  --rose-100: #fbeceb;   /* blush tint surface */
  --rose-200: #f2d8d6;   /* strong hairline on blush */
  --rose-line: #efe3e1;  /* default hairline */

  --ink-900: #1e1214;    /* headings, 18.2:1 */
  --ink-700: #4b3b3e;    /* body, 10.5:1 */
  --ink-500: #76656a;    /* muted, 5.5:1 */
  --ink-300: #9a888d;    /* control outlines, 3.3:1 */

  --red-600: #b3121b;    /* sindoor: primary action, 7.0:1 */
  --red-700: #8f0e16;    /* pressed / hover */
  --maroon-800: #5c0a14; /* deep band, logo */
  --maroon-900: #3a0710; /* deepest */

  --rose-600: #be1e5a;   /* nails */
  --henna-600: #9a3b1b;  /* mehndi */
  --coral-600: #c2412d;  /* salon */
  --plum-700: #6e1e4e;   /* academy */

  --red-400: #f05750;
  --rose-400: #ee5180;
  --henna-400: #d77252;
  --coral-400: #e7634d;
  --plum-400: #c971a0;

  /* Semantic */
  --bg: var(--white);
  --bg-soft: var(--rose-50);
  --bg-tint: var(--rose-100);
  --bg-deep: var(--maroon-800);
  --bg-deepest: var(--maroon-900);

  --text: var(--ink-900);
  --text-body: var(--ink-700);
  --text-muted: var(--ink-500);
  --text-on-deep: var(--white);
  --text-on-deep-muted: rgb(255 255 255 / 0.76);

  --accent: var(--red-600);
  --accent-hover: var(--red-700);
  --on-accent: var(--white);

  --border: var(--rose-line);
  --border-strong: var(--rose-200);
  --border-control: var(--ink-300);
  --border-on-deep: rgb(255 255 255 / 0.16);
  --focus: var(--red-600);

  --bg-glass: rgb(255 255 255 / 0.94);
  --tap: rgb(179 18 27 / 0.1);
  --scrim: rgb(30 18 20 / 0.94);
  --scrim-control: rgb(30 18 20 / 0.6);
  --scrim-soft: rgb(30 18 20 / 0.42);
  --border-on-scrim: rgb(255 255 255 / 0.24);
  --text-on-scrim-muted: rgb(255 255 255 / 0.8);

  --tone-bridal: var(--red-600);
  --tone-nails: var(--rose-600);
  --tone-mehndi: var(--henna-600);
  --tone-salon: var(--coral-600);
  --tone-academy: var(--plum-700);
  --tone-bridal-on-deep: var(--red-400);
  --tone-nails-on-deep: var(--rose-400);
  --tone-mehndi-on-deep: var(--henna-400);
  --tone-salon-on-deep: var(--coral-400);
  --tone-academy-on-deep: var(--plum-400);

  /* Type */
  --font-display: "Plus Jakarta Sans Variable", "Plus Jakarta Sans", "Segoe UI", system-ui, -apple-system, sans-serif;
  --font-body: "Plus Jakarta Sans Variable", "Plus Jakarta Sans", "Segoe UI", system-ui, -apple-system, sans-serif;
  --weight-body: 400;
  --weight-ui: 600;
  --weight-strong: 700;
  --weight-display: 800;
  --text-xs: 0.8125rem;                                  /* 13 */
  --text-sm: 0.9375rem;                                  /* 15 */
  --text-base: 1.0625rem;                                /* 17 */
  --text-lg: 1.25rem;                                    /* 20 */
  --text-xl: clamp(1.375rem, 1.15rem + 0.9vw, 1.75rem);  /* 22-28 */
  --text-2xl: clamp(1.875rem, 1.3rem + 2.3vw, 3rem);     /* 30-48 */
  --text-3xl: clamp(2.5rem, 1.5rem + 4vw, 4.5rem);       /* 40-72 */
  --leading-tight: 1.04;
  --leading-snug: 1.1;
  --leading-body: 1.65;

  /* Space (4px base) */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.5rem;
  --space-6: 2rem;
  --space-7: 3rem;
  --space-8: 4rem;
  --space-9: 6rem;
  --space-10: 8rem;
  --section-y: clamp(3.25rem, 2.2rem + 4vw, 7rem);
  --section-y-tight: clamp(2.75rem, 2rem + 3vw, 5rem);
  --container: 76rem;
  --container-narrow: 46rem;
  --gutter: clamp(1.25rem, 0.6rem + 2.6vw, 2.5rem);
  --header-h: 4rem;
  --mobile-bar-h: 4.75rem;

  /* Shape and depth */
  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-lg: 22px;
  --radius-pill: 999px;
  --shadow-sm: 0 1px 2px rgb(30 18 20 / 0.06), 0 2px 8px -2px rgb(30 18 20 / 0.08);
  --shadow-md: 0 1px 2px rgb(30 18 20 / 0.05), 0 14px 34px -14px rgb(30 18 20 / 0.24);
  --shadow-accent: 0 10px 24px -10px rgb(179 18 27 / 0.55);
  --shadow-header: 0 10px 30px -18px rgb(30 18 20 / 0.28);

  /* Motion */
  --ease-out: cubic-bezier(0.2, 0.7, 0.2, 1);
  --ease-soft: cubic-bezier(0.25, 1, 0.35, 1);
  --dur-fast: 140ms;
  --dur-base: 220ms;
  --dur-enter: 420ms;
  --dur-reveal: 720ms;
  --reveal-distance: 18px;

  color-scheme: light;
}

@media (min-width: 48rem) {
  :root { --header-h: 4.5rem; }
}
```

### 6.2 App extension: `app-tokens.css` (proposed, **needs Harsh or Urmi to approve**)
The brand has no status colours. The proposal below stays in the red family wherever it can and adds **one** muted forest green for "present", because an attendance screen where every state is red stops being readable. Every pair below was checked: text on its tint is at least 5.2:1 (WCAG AA). **Always pair colour with an icon and a word**, never colour alone.

```css
:root {
  /* Attendance states: text colour on its tint. Small marks and chips only; never buttons
     (the one red button per view stays --accent). */
  --status-present: #2f6b47;          /* new hue, forest; 5.7:1 on its tint, 6.3:1 on white */
  --status-present-bg: #eef5f0;
  --status-late: var(--henna-600);    /* #9a3b1b; 6.2:1 on its tint */
  --status-late-bg: #fbf0ea;
  --status-absent: var(--red-700);    /* #8f0e16; 8.2:1 on rose-100. Darker than --accent, so it never reads as a button */
  --status-absent-bg: var(--rose-100);
  --status-leave: var(--plum-700);    /* #6e1e4e; 9.4:1 on its tint */
  --status-leave-bg: #f6edf2;
  --status-off: var(--ink-500);       /* weekly off / not scheduled; 5.2:1 on rose-50 */
  --status-off-bg: var(--rose-50);

  /* App chrome */
  --app-bar-h: 4.75rem;               /* same height as the site's phone booking bar */
  --tabbar-h: 4rem;                   /* bottom nav, plus env(safe-area-inset-bottom) */
}
```
Icons: present `check-circle`, late `clock`, absent `x-circle`, leave `airplane-tilt` or `umbrella`, off `minus`.

If Urmi rejects green, fall back to `--status-present: var(--ink-900)` with a filled `check-circle`, so that state is shown by the icon instead of a colour.

### 6.3 Tailwind v4 theme (only if the build team insists on Tailwind; the reference uses plain CSS)
It maps the same values and **clears Tailwind's default palette, radii, shadows and type sizes**, so nothing generic (`gray-500`, `rounded-xl`, `text-xs` 12px) can creep in. Load the font with `@fontsource-variable/plus-jakarta-sans`, exactly as the reference does.

```css
@import "tailwindcss";
@import "@fontsource-variable/plus-jakarta-sans/wght.css";
@import "@fontsource-variable/plus-jakarta-sans/wght-italic.css";

@theme {
  /* Colours: brand only */
  --color-*: initial;
  --color-white: #ffffff;
  --color-rose-50: #fff7f6;
  --color-rose-100: #fbeceb;
  --color-rose-200: #f2d8d6;
  --color-rose-line: #efe3e1;
  --color-ink-900: #1e1214;
  --color-ink-700: #4b3b3e;
  --color-ink-500: #76656a;
  --color-ink-300: #9a888d;
  --color-sindoor: #b3121b;        /* = --red-600 */
  --color-sindoor-700: #8f0e16;    /* = --red-700 */
  --color-maroon-800: #5c0a14;
  --color-maroon-900: #3a0710;
  --color-tone-bridal: #b3121b;
  --color-tone-nails: #be1e5a;
  --color-tone-mehndi: #9a3b1b;
  --color-tone-salon: #c2412d;
  --color-tone-academy: #6e1e4e;
  /* semantic aliases (preferred in markup) */
  --color-bg: #ffffff;
  --color-bg-soft: #fff7f6;
  --color-bg-tint: #fbeceb;
  --color-bg-deep: #5c0a14;
  --color-bg-deepest: #3a0710;
  --color-text: #1e1214;
  --color-text-body: #4b3b3e;
  --color-text-muted: #76656a;
  --color-accent: #b3121b;
  --color-accent-hover: #8f0e16;
  --color-border: #efe3e1;
  --color-border-strong: #f2d8d6;
  --color-border-control: #9a888d;
  /* status (proposal, see 6.2) */
  --color-present: #2f6b47;
  --color-present-bg: #eef5f0;
  --color-late: #9a3b1b;
  --color-late-bg: #fbf0ea;
  --color-absent: #8f0e16;
  --color-absent-bg: #fbeceb;
  --color-leave: #6e1e4e;
  --color-leave-bg: #f6edf2;

  /* Type: one family, four weights, nothing under 13px */
  --font-*: initial;
  --font-sans: "Plus Jakarta Sans Variable", "Plus Jakarta Sans", "Segoe UI", system-ui, -apple-system, sans-serif;
  --font-weight-*: initial;
  --font-weight-normal: 400;     /* body */
  --font-weight-semibold: 600;   /* nav, meta */
  --font-weight-bold: 700;       /* buttons, names, sub-heads */
  --font-weight-extrabold: 800;  /* h1, h2, numerals */
  --text-*: initial;
  --text-xs: 0.8125rem;
  --text-sm: 0.9375rem;
  --text-base: 1.0625rem;
  --text-base--line-height: 1.65;
  --text-lg: 1.25rem;
  --text-xl: clamp(1.375rem, 1.15rem + 0.9vw, 1.75rem);
  --text-2xl: clamp(1.875rem, 1.3rem + 2.3vw, 3rem);
  --text-2xl--line-height: 1.1;
  --text-3xl: clamp(2.5rem, 1.5rem + 4vw, 4.5rem);
  --text-3xl--line-height: 1.04;
  --tracking-h1: -0.032em;
  --tracking-display: -0.025em;
  --tracking-name: -0.015em;
  --tracking-eyebrow: 0.09em;
  --leading-tight: 1.04;
  --leading-snug: 1.1;
  --leading-body: 1.65;

  /* Shape and depth (rounded-full = pill buttons) */
  --radius-*: initial;
  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-lg: 22px;
  --shadow-*: initial;
  --shadow-sm: 0 1px 2px rgb(30 18 20 / 0.06), 0 2px 8px -2px rgb(30 18 20 / 0.08);
  --shadow-md: 0 1px 2px rgb(30 18 20 / 0.05), 0 14px 34px -14px rgb(30 18 20 / 0.24);
  --shadow-cta: 0 10px 24px -10px rgb(179 18 27 / 0.55);   /* = brand --shadow-accent */
  --shadow-header: 0 10px 30px -18px rgb(30 18 20 / 0.28);

  /* Spacing: Tailwind's default 4px step. Brand scale 1..10 = Tailwind 1,2,3,4,6,8,12,16,24,32 */
  --spacing: 0.25rem;
  --container-page: 76rem;
  --container-narrow: 46rem;

  /* Breakpoints used by the brand */
  --breakpoint-*: initial;
  --breakpoint-sm: 30rem;
  --breakpoint-md: 48rem;
  --breakpoint-lg: 56rem;
  --breakpoint-xl: 64rem;

  /* Motion */
  --ease-out: cubic-bezier(0.2, 0.7, 0.2, 1);
  --ease-soft: cubic-bezier(0.25, 1, 0.35, 1);
  --animate-bindi-in: bindi-in 520ms cubic-bezier(0.34, 1.5, 0.5, 1) both;
  @keyframes bindi-in { from { transform: scale(0); } }
}

@layer base {
  body { @apply bg-bg text-text-body font-sans text-base font-normal antialiased; }
  h1, h2 { @apply text-text font-extrabold tracking-display text-balance; }
  h1 { @apply text-3xl tracking-h1; }
  h1 em, h2 em { @apply text-accent italic; }
  :focus-visible { outline: 2px solid var(--color-accent); outline-offset: 3px; border-radius: 6px; }
  ::selection { @apply bg-bg-tint text-text; }
}

@layer components {
  .bindi { display: inline-block; width: .17em; height: .17em; margin-left: .07em; border-radius: 50%; background: var(--tone, var(--color-accent)); }
  /* use as class="btn btn-primary" */
  .btn { @apply inline-flex min-h-12 items-center justify-center gap-[.55em] rounded-full border border-transparent px-[1.4rem] py-3 text-base font-bold leading-[1.1] whitespace-nowrap transition active:scale-[.98]; }
  .btn-primary { @apply bg-accent text-white hover:bg-accent-hover hover:shadow-cta; }
  .btn-secondary { @apply bg-bg border-border-strong text-text hover:border-text; }
  .eyebrow { @apply text-xs font-bold uppercase tracking-eyebrow text-text-muted; }
}
```
Naming note: the brand's `--shadow-accent` is called `--shadow-cta` in Tailwind, because a `shadow-accent` utility would clash with the `accent` colour (Tailwind reads `shadow-<colour>` as a shadow colour).

**Tailwind v3 alternative** (`tailwind.config.js`). Keep `tokens.css` as the source and point Tailwind at the variables:
```js
export default {
  theme: {
    colors: { transparent: "transparent", current: "currentColor", white: "#fff",
      bg: { DEFAULT: "var(--bg)", soft: "var(--bg-soft)", tint: "var(--bg-tint)", deep: "var(--bg-deep)", deepest: "var(--bg-deepest)" },
      text: { DEFAULT: "var(--text)", body: "var(--text-body)", muted: "var(--text-muted)" },
      accent: { DEFAULT: "var(--accent)", hover: "var(--accent-hover)" },
      border: { DEFAULT: "var(--border)", strong: "var(--border-strong)", control: "var(--border-control)" },
      tone: { bridal: "var(--tone-bridal)", nails: "var(--tone-nails)", mehndi: "var(--tone-mehndi)", salon: "var(--tone-salon)", academy: "var(--tone-academy)" } },
    fontFamily: { sans: ["Plus Jakarta Sans Variable", "Plus Jakarta Sans", "Segoe UI", "system-ui", "sans-serif"] },
    fontWeight: { normal: "400", semibold: "600", bold: "700", extrabold: "800" },
    borderRadius: { none: "0", sm: "6px", md: "12px", lg: "22px", full: "999px" },
    boxShadow: { none: "none", sm: "var(--shadow-sm)", md: "var(--shadow-md)", cta: "var(--shadow-accent)", header: "var(--shadow-header)" },
    screens: { sm: "30rem", md: "48rem", lg: "56rem", xl: "64rem" },
    extend: { transitionTimingFunction: { out: "var(--ease-out)", soft: "var(--ease-soft)" } },
  },
};
```

### 6.4 PWA manifest values that match the brand
```json
{
  "name": "Feelings Beauty Care Staff",
  "short_name": "FBC Staff",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#ffffff",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```
The icon is the red bindi on white, rendered from `public/favicon.svg`. `theme_color` is `#ffffff`, matching `Seo.astro:42`. A maroon `#5c0a14` status bar is an option, but the site deliberately keeps chrome white.

---

## 7. Recommendations for the new app's stack (chosen to match what Harsh already runs for this client)

1. **Hosting: a new Cloudflare Pages project with Git integration**, in the same Cloudflare account, built from a new private repo (for example `harshbhx/feelings-attendance`). Use the same flow as the website: push to `main` deploys, every branch gets a preview URL Harsh can review on his phone, and nobody runs `wrangler pages deploy`. Attach `staff.feelingsbeautycare.in` as a custom domain through the Pages API; the owner then activates the DNS record in the dashboard, exactly as with `review.`.
2. **Frontend: Astro 5 (pin 5.18.x, Node 22)**, the same toolchain as the site. Add small interactive islands for check-in, location and the camera, either in vanilla TS (as the site does) or in **Preact** if the screens get stateful (the admin roster and calendar). Use plain CSS with the copied `tokens.css`, `global.css` and the motion subset; this is the closest match to the brand and needs no Tailwind. If the team prefers Tailwind, use v4 with the locked-down `@theme` in §6.3. Add Plus Jakarta Sans through Fontsource and Phosphor regular through `@phosphor-icons/core`.
3. **Backend:** Pages Functions under `functions/api/*`, written in the same style as `tap.ts` (host allow-list, Origin check, quiet failures with an `X-…` status header). Use a **new D1 database** such as `fbc-attendance` (APAC), separate from `fbc-analytics`, bound as `DB`. If check-in selfies are wanted, store them in **R2** with short retention.
4. **Scheduled jobs: Pages Functions have no cron triggers.** For daily "mark absent" runs or a monthly summary to Urmi, either compute those states when the data is read, or add a tiny companion **Worker with a cron trigger** bound to the same D1. Harsh already runs Workers in this account.
5. **Auth:** reuse the design already agreed for `/admin` (`TODO.md:28-35`). Owner and admin use a password checked against a Pages secret, then a signed HttpOnly, Secure, SameSite=Strict cookie, with D1-counted lockout. Staff use a per-person PIN or phone plus PIN, issued by Urmi, hashed in D1, with a long-lived device session. Keep secret names in the site's style (`ADMIN_PASSWORD`, `SESSION_SECRET`). Never pass secrets through the assistant (`CLAUDE.md:59`).
6. **Geofence:** default to 22.4606479, 70.0565093 with a radius of about 120 m, configurable. Check `coords.accuracy`. Add a **"venue / off-site" check-in** with a note and location for bridal jobs, because the team travels to weddings. Use **Asia/Kolkata** everywhere: copy `indiaDay()` and the `OpenNow` schedule logic, and use `site.hours` as the default shift window.
7. **PWA:** a hand-written `manifest.webmanifest` (§6.4) and a small service worker, either hand-rolled or `@vite-pwa/astro`. It caches the app shell and queues check-ins while offline (IndexedDB + Background Sync, with a manual retry fallback on iOS).
8. **Headers:** the site's `_headers` plus the `scripts/csp.mjs` approach, but with `Permissions-Policy: geolocation=(self)` (and `camera=(self)` for selfies). Add `X-Robots-Tag: noindex` and a `robots.txt` that disallows everything, because a staff app must never be indexed.
9. **CI** (Harsh's rule: heavy work in GitHub Actions; the website has none): add `.github/workflows/ci.yml` running `npm ci`, `astro check`, `astro build`, the node:assert function tests (copy the `test-tap-function.mjs` pattern), and Playwright screenshots at 390px and 1440px uploaded as artifacts. Let Cloudflare Pages build the previews.
10. **Conventions:** `feat/…` and `fix/…` branches, conventional commits with scopes, PR bodies with a Preview line, results and acceptance checks, Harsh's git identity, no AI attribution. Keep `CLAUDE.md`, `HANDOFF.md`, `TODO.md` and `docs/0x-*.md` in the same shape as the website repo.

## 8. Open questions for the PRD
- Is a new non-red "present" green OK (§6.2), or should every state stay in the red family with icons?
- Which languages do the staff need? The site is English or Hinglish; staff might need Gujarati.
- Is a selfie on check-in wanted? It affects the camera permission, R2 and privacy.
- What are the shifts? The site hours (Mon–Sat 10–20, Sun 10–13) are still marked CONFIRM.
- How should off-site wedding jobs be approved, and who approves them (Urmi only)?
- Is recolouring the logo approved by the client (`Logo.astro:4`)? Is a vector logo available?
- Which domain: `staff.` or `team.feelingsbeautycare.in`? Neither record exists yet.
