# UI redesign plan (cold-start brief)

For the designer agent that starts at 14:30 UTC on 21 Oct 2026 with no other context. Read this file first, then the sources in section 0. Nothing here is code; it is the plan, the problems, the targets and the slice list.

## 0. Read first

| What | Where |
|---|---|
| Design system and anti-slop checklist | `docs/PRD.md` section 12 (tokens, status colours, type, layout, components, voice) and 12.11 (review checklist) |
| Brand source, exact tokens, logo files | `docs/research/brand-and-stack.md` (sections 1.2 to 1.5) |
| Current UI screenshots (CI baselines) | `e2e/tests/__screenshots__/{owner-phone,owner-desktop,staff-android}/` (390 px phone, 1280 px desktop, 390 px Android staff) |
| UI components and styles | `packages/ui/src/components/*.tsx`, `packages/ui/src/styles/` (`tokens.css` is a frozen copy of the brand; app additions go in `app-tokens.css`) |
| Screens | `app/src/features/owner/*` and `app/src/features/staff/*` |
| Work rules | `CONTRIBUTING.md`, plus the usage and CI rules in section 6 and 7 below |

The salon: Feelings Beauty Care, Jamnagar, owner Urmi. At most 15 active staff. The brand source is the new public site https://review.feelingsbeautycare.in (not the apex `feelingsbeautycare.in`, which is the old rejected dark-and-gold site).

## 1. Context and hard constraints

- Production is live at https://staff.feelingsbeautycare.in (Worker `feelings-staff`). Real staff use it. **Never break sign-in or check-in.** Any slice that touches `features/staff/punch`, `features/staff/scan`, the sign-in screens, the PIN pad or the shell must be tested on the preview first and must keep every E2E id green.
- **Staff initial JS budget: 170 KB gzip, strict** (`scripts/size-budgets.mjs`, run in `ci`). It sits at about 169.8 KB, so headroom is about 0.2 KB. Other budgets: each owner route chunk 120 KB gzip, CSS 25 KB gzip per route. Anything added to the staff entry chunk (a font, a logo, an icon set, a component) must be paid for by removing something else, or be lazy-loaded. See section 7.
- **E2E ids stay.** Playwright specs select by `data-testid`, roles and the ids named after acceptance criteria (for example `S-04.3`, `E2E-xx`). Do not rename test ids, do not change accessible names that specs match on, do not change copy that specs assert unless the same PR updates the spec and says so.
- **Baselines** are generated only by the `snapshots` workflow in the Playwright Docker image, never on the VM, never by hand. A visual change means regenerated baselines in the same PR (section 6).
- Copy: all strings come from `packages/i18n` (`t('ns:key')`). Copy keeps its meaning. Rewording for tone is fine but goes through the i18n files; English only (Gujarati and Hindi are out of scope).
- Contracts are frozen (`packages/contracts`). The status-model slice (section 3, fix 2) may need extra fields; if the API does not already expose them, that is a separate small `contract-change` PR, flagged to the lead first. Prefer deriving from fields that exist.
- Heavy work runs only in GitHub Actions (2-CPU VM). No local builds, tests, browsers or `mint dev`. Biome before each commit: `npx -y @biomejs/biome@2.5.15 check --write <paths>`.
- Merging: the lead merges. Deploy to production only from a green `main`, using the redeploy recipe in `STATUS.md` (section 6). The designer never deploys.

## 2. The 10 problems of the current UI

Screenshot names are files in `e2e/tests/__screenshots__/<project>/`. The first group is what the owner (Urmi) already named. The second group is what the screenshots add. Problem 1 is partly a misdiagnosis worth knowing: the app already uses the website's tokens and Plus Jakarta Sans, so it is the *application* of the brand that is thin, not the token set.

### Named by the owner

1. **Not on-brand.** Evidence: `owner-phone/owner-today.png`, `staff-android/staff-today.png`, `owner-desktop/owner-today.png`.
   - The phone owner header is only the word "Today" and a bell. The real wordmark appears nowhere on phones. On desktop the rail shows a plain text "Feelings" with a dot, not the logo file.
   - The staff Today header is a small grey date and a bell. It does not feel like the salon; the greeting "Good morning, Priya." is a normal body-weight line with no brand surface behind it.
   - The page is pure white everywhere. The website uses white as the base but leans on blush (`--rose-50`, `--rose-100`) bands and a maroon anchor. The app uses blush only for avatars and chips, so it reads as a generic admin tool.
   - The five service tone colours (bridal, nails, mehndi, salon, academy) exist in tokens but are not used for people or roles. Display type is the same Plus Jakarta Sans 800 as the site, but headings are set small (screen title about 20 px), so the "big confident" display feel of the site is lost.
2. **Several statuses per row, and late is not a number.** Evidence: `owner-phone/owner-today.png` (Sejal Makwana: "+21m", "Waiting for you" and "Edge" on one row; Jinal Kotak: "+15m", "Needs a look", "Edge"), `owner-desktop/owner-today.png`.
   - A row can carry up to three chips; the eye cannot tell which one matters. "+28m" is a number, but it sits in a chip with the same weight as "Inside", and on the Register the late state is a letter `P` with a clock icon, so a late day looks almost the same as an on-time one (`owner-phone/owner-register.png`).
3. **Owner Today is a stat-chip grid, not a hero, and has too many filters.** Evidence: `owner-phone/owner-today.png`, `owner-desktop/owner-today.png`.
   - "8 of 9 in" is good, but it is followed by a callout card, then a six-chip grid (everyone, in, late, not in yet, on leave, week off) that is both a summary and a filter. Two of the chips (everyone 12, in 8) do not add up with "8 of 9" at a glance, and the grid pushes the list down (about 700 px before the first person on a phone).
   - PRD 12.11 rule 5 (no dashboard of stat cards) is bent here.
4. **Needs action is not grouped by urgency and every card looks alike.** Evidence: `owner-phone/owner-actions.png` (3,662 px tall), `owner-desktop/owner-actions.png`.
   - Nine sections (new phones, waiting for approval, at a venue, check-ins to look at, leave, fix a day, overtime, auto-closed days, advance requests) are the same white bordered card with two similar outline buttons. Money and check-in decisions (which block a person's day or pay) look identical to routine leave.
   - Several cards have three buttons (at a venue: Approve, Approve and let others check in here, Reject). There is no single clear primary action per card.
5. **Undifferentiated lists.** Evidence: `owner-phone/owner-staff.png`, `owner-phone/owner-credits.png`, `owner-phone/owner-today.png`.
   - Every person is a pale pink circle with initials in maroon. No photo, no per-person or per-role colour, so twelve rows look the same. Hierarchy is flat: name, then a grey line, then chips, all at nearly the same visual weight.
6. **Register is unreadable on a phone and not a real two-column layout on desktop.** Evidence: `owner-phone/owner-register.png`, `owner-desktop/owner-register.png`.
   - On the phone, the staff column is 120 px wide and wraps names ("Meena / Chavda", "Komal / Rathod", "Sejal / Makwana"), cells are small (about 40 px) and show icon, letter and tint at once, and the grid scrolls sideways with only six days visible. The summary chips take a whole card above it.
   - On desktop the grid is one wide table and the key is a long row below it; the right side of the screen is not used for anything (no selected-person or selected-day panel).
7. **Weak contrast and type scale.** Evidence: `owner-phone/owner-staff.png`, `owner-phone/owner-settings.png`, `staff-android/staff-payslips.png`.
   - Secondary lines (role and employee code, settings descriptions, "Paid 5 Oct by UPI") are `--text-muted` `#76656a` at 15 px, light against white and the same weight as the neighbouring text. Titles and secondary text differ by weight but only a little by size.
   - Payslips (`staff-payslips.png`) is a plain list with no hero: the latest take-home (₹11,987, not marked paid) should be the page's main number.
8. **"Not checked in" is not prominent on staff Today.** Evidence: `staff-android/staff-today-ready.png`.
   - At 10:42, 42 minutes after the shift started, the state is a tiny grey chip "Not checked in" with a dash icon. The clock (10:42) and a calm privacy card dominate. The big red Check in button is right, but nothing says "you are late" or "you have not started".
9. **Check-in sheet close button is error-red.** Evidence: `staff-android/staff-sheet-venue.png` (and the other `staff-sheet-*` images).
   - The X in the sheet header has a red circular ring. Red in this system means action or error; a close control must be neutral (ink or muted outline). It also competes with the one red action.

### Found in the screenshots

10. **Settings and Setup hierarchy.** Evidence: `owner-phone/owner-setup.png`, `owner-phone/owner-settings.png`.
    - Setup shows eight rows, seven of which carry a green "Done" pill and a repeated check icon; the one thing left to do ("Selfie on check-in", "Skipped") is the same size as the finished ones. Completed steps should recede and the next step should lead.
    - Settings is a flat list of 15 rows with identical icons in identical pink circles; there are no groups (the salon, the people, the pay, the system), so finding "Pay rules" or "Security" means reading the whole list.

## 3. The five fixes and the per-screen targets

All colours below are tokens (names in section 4). No hex in components. Sizes use the existing scale (`--text-xs` 13, `--text-sm` 15, `--text-base` 17, `--text-lg` 20, `--text-xl` 22 to 28, `--text-2xl` 30 to 48, `--text-3xl` 40 to 72). "Copy unchanged in meaning" applies to every screen.

### Fix 1: Brand layer

What it is: the real wordmark and bindi in the shell, a warm page background, brand surfaces for headers and hero areas, and service tone colours for people. This is the foundation; slices 1 to 3 build it.

**Shell (all owner screens)**
- 390: sticky header 64 px, `--bg-glass`. Left: the wordmark (logo mask, `--maroon-800`, 24 px tall) on Today only; on other screens the screen title at `--text-xl` 800 with the bindi, and the wordmark moves into More. Right: bell. Page background `--bg-soft` (`#fff7f6`), content cards stay white with a hairline.
- 1280: rail 240 px, `--bg` white. Logo mask in `--maroon-800`, 28 px tall, replacing the text "Feelings". Active item: `--bg-tint` pill plus the 6 px bindi, as today. Content area background `--bg-soft`; cards white.

**Staff shell and staff Today**
- 390: the top area becomes a brand header: `--bg-soft` surface with the wordmark (20 px) at top left, bell right, then the greeting at `--text-xl` 800 ("Good morning, Priya" with the bindi as the full stop), then "Full day, 10:00 to 20:00" at `--text-sm` muted. No gradients, no photo. The bottom action bar and tab bar are unchanged in structure.

**People colour (used by Fix 5)**
- Avatar: initials 700 on a tint of the person's role tone (see section 4: `--role-*` map to the service tones: Stylist and Beautician to salon coral, Makeup artist to bridal red, Nail technician to nails rose, Mehndi artist to mehndi henna, Trainee to academy plum, Helper and Receptionist to ink). Avatar size 40 px phone list, 48 px profile, 36 px register. If a profile photo exists in R2 later, it replaces initials (not in scope now).

### Fix 2: Status model

What it is: exactly one status per row, picked by priority, and lateness as a number.

Priority (highest wins the row's main chip; the rest become a single quiet line of text or a small marker, never a second chip):
1. Needs a look (flagged) or Waiting for you (pending approval): action for the owner.
2. Absent, Half day.
3. Late with minutes ("+28 m", shown as a number in `--status-late`, `--text-sm` 700, `tabular-nums`).
4. Present / Inside.
5. Leave, Week off, Holiday, Not scheduled.

Targets
- Owner Today row (390 and 1280): name (`--text-base` 700), under it one muted line ("In 10:28, 13 m so far"), right side one status chip only. Late shows as the chip text "+28 m" in late colours with the clock icon, replacing "Inside". The "Edge" and "Inside" location notes become part of the muted line ("In 10:28 at the edge of the salon area"), not chips.
- Register cell (390 and 1280): late shows the minutes, not `P`: a cell with `+28` (or `+1h` over 60) on `--status-late-bg`; present shows `P`. Half day shows `H`, absent `A` as today. Icon is dropped from cells of 36 px or less (letter or number plus tint is enough; the full chip with icon stays in the detail view and key). This keeps "status = colour + icon + word" at the legend and detail level, and needs an explicit amendment (section 4).
- Month (staff, 390): same rule in day cells; late shows `+28`.
- Credits and Staff lists: one trailing chip per row (for example "Phone waiting for you" wins over everything else on `owner-staff.png`).

### Fix 3: Owner Today hero

Targets
- 390: the hero card replaces the chip grid and the callout. White card, hairline, `--radius-md`, 16 px padding. Line 1: "Mon, 19 Oct, updated 10:42" at `--text-sm` muted. Line 2: "8 of 9 in" at `--text-2xl` 800 (about 40 px on a phone), with the progress strip beneath (present green, late henna, remaining blush; unchanged data). Line 3: one sentence of context at `--text-sm`: "3 late, 1 not in yet, 1 on leave, 2 off today". Bottom of the card: if `needs action > 0`, one sindoor button "9 things need your OK" with an arrow (this is the screen's one red button); otherwise nothing.
- Below the hero: one segmented control with three options only: "In" (8), "Not in yet" (1), "Away" (leave, week off; 3). Default "In". Remove "everyone" (it is the sum) and "late" (late is a number on the rows, and "3 late" lives in the hero sentence). Rows follow the Fix 2 model.
- 1280: two columns. Left (about 58 percent): hero card, then the segmented list. Right (about 42 percent): "Not in yet" with Call and WhatsApp buttons on each row, then "Due later", then "Away". The current hero line, progress strip and callout merge into the single hero card; the full-width callout bar goes away.

### Fix 4: Needs action triage

Targets
- Three urgency groups with headings, in this order (headings at `--text-lg` 700 with a count): **Decide now** (anything that blocks a person's day or pay: waiting for approval, check-ins to look at, at a venue, fix a day, overtime, auto-closed days, advance requests); **New devices** (new phones, because it needs a PIN); **Routine** (leave). Final grouping to be confirmed with Urmi using the screenshot of the draft, but the rule is: money and check-ins first, leave last.
- Card design by group: "Decide now" cards get a 4 px left rule in `--accent` and a bold one-line title; "Routine" cards have the standard hairline only. Each card shows one primary button (the safe default: Approve, Looks fine, Keep 20:00) in the sindoor fill, and the other actions as a text-style row ("Reject", "Approve part", "Change time"). Because PRD 12.2 says one red button per view, only the first card in the list has the filled sindoor button; every other card uses a filled `--bg-tint` pill with `--accent` text for its primary, and a ghost for the rest. This is an explicit amendment (section 4).
- 390: group headings sticky under the header; cards 16 px apart; maximum two visible buttons in a row (primary and a "More" menu for the third). Quote text (the person's reason) at `--text-sm` italic in a blush block.
- 1280: two-column grid of cards inside each group, 20 px gap; the left rail shows the count per group as a mini index.
- A "Select all and approve" is out of scope; do not add new actions.

### Fix 5: List and register rework

Targets
- Staff list, Credits, Roster, Roll-call (390 and 1280): `ListRow` gets the role-toned avatar (Fix 1), name at `--text-base` 700, a muted line at `--text-sm` using `--text-muted` darkened one step (`--ink-700` for the first line, `--ink-500` for the second; this addresses problem 7), one trailing value or chip. Row height 64 px, hairline separators. On 1280 lists use a table-like layout with columns (name, role, code, trailing status) when width allows.
- Register 390: switch to a **person-first list**: one row per person with a 7-day strip (this week) of 36 px cells showing the Fix 2 cell, name on top at `--text-base` 700 without wrapping (single line with ellipsis, 100 percent of the row width above the strip). Tapping a person opens the existing month view for that person (`register/:userId/:date` already exists). A "Month grid" toggle keeps the full table for those who want it, with a sticky first column of 96 px showing first name plus initial ("Meena C."), cells 40 px, 7 days visible. The summary card shrinks to a single line of text with the counts.
- Register 1280: two columns. Left (about 66 percent): the grid with 36 px cells, sticky header and first column. Right (about 34 percent): a detail panel for the selected person and day (status, punches, source, note, "Fix this day" action), defaulting to today and the first person that "needs a look". The key moves to a popover under an info button in the header instead of a row at the bottom.
- Staff Payslips (390): hero card for the latest month (`--text-2xl` take-home, status "Not marked paid yet" as a chip), then the older months as rows.
- Settings (390 and 1280): group the 15 rows under four muted headings (The salon, People and pay, Attendance, Account and safety), icons in `--bg-tint` circles keep one colour. Setup (390): the next undone step is a card with a sindoor button; completed steps collapse into one line "7 of 8 done" with an expander, and the "Done" pills disappear in favour of a small check.
- Sheet close button (all `Sheet`s, problem 9): 44 px circle, `--border-strong` outline, ink X icon, `--bg-soft` hover. No red.
- Staff Today "Not checked in" (problem 8): when the shift has started and there is no check-in, show a banner card under the greeting: `--status-late-bg`, henna text, clock icon, "Not checked in. Shift started at 10:00, 42 min ago." at `--text-base` 700. The big time moves below. The Check in button stays the one red button. Before the shift starts the existing calm chip stays.

## 4. Brand tokens table and PRD amendments

Extracted from the public site's inlined CSS on https://review.feelingsbeautycare.in (fetched 21 Oct 2026; matches `docs/research/brand-and-stack.md`, no drift found). Existing app token names already exist in `packages/ui/src/styles/tokens.css` (frozen copy); the right-hand column proposes the names to add in `app-tokens.css` where nothing exists yet.

| Site token | Value | Role on the site | App token (exists or proposed) |
|---|---|---|---|
| `--white` / `--bg` | `#ffffff` | page | `--bg` (exists) |
| `--rose-50` / `--bg-soft` | `#fff7f6` | warm band | `--bg-soft` (exists); **proposed: use as the app page background** (`--app-page`) |
| `--rose-100` / `--bg-tint` | `#fbeceb` | tint surface | `--bg-tint` (exists) |
| `--rose-200` / `--border-strong` | `#f2d8d6` | card outline | exists |
| `--rose-line` / `--border` | `#efe3e1` | hairline | exists |
| `--ink-900` | `#1e1214` | headings | `--text` (exists) |
| `--ink-700` | `#4b3b3e` | body | `--text-body` (exists); **proposed: use for secondary lines in lists** |
| `--ink-500` | `#76656a` | muted | `--text-muted` (exists); keep for captions only |
| `--ink-300` | `#9a888d` | control outlines | `--border-control` (exists) |
| `--red-600` | `#b3121b` | sindoor, primary action | `--accent` (exists) |
| `--red-700` | `#8f0e16` | hover, pressed | `--accent-hover` (exists) |
| `--maroon-800` | `#5c0a14` | deep band, logo colour | `--bg-deep` (exists); **proposed: `--logo` alias** |
| `--maroon-900` | `#3a0710` | footer | `--bg-deepest` (exists) |
| `--tone-bridal` | `#b3121b` | service tone | **`--role-makeup`** (proposed, alias) |
| `--tone-nails` / `--rose-600` | `#be1e5a` | service tone | **`--role-nails`** |
| `--tone-mehndi` / `--henna-600` | `#9a3b1b` | service tone | **`--role-mehndi`** |
| `--tone-salon` / `--coral-600` | `#c2412d` | service tone | **`--role-salon`** (stylist, beautician) |
| `--tone-academy` / `--plum-700` | `#6e1e4e` | service tone | **`--role-trainee`** |
| (none) | n/a | helper, receptionist | **`--role-neutral`** = `--ink-500` |
| avatar tints | `color-mix(in oklab, var(--role-x) 12%, white)` | none | **`--role-x-bg`** (proposed; checks needed: initials in `--role-x` must reach 4.5:1 on the tint) |
| `--bg-glass` | `rgb(255 255 255 / .94)` | sticky header | exists |
| `--radius-sm / md / lg / pill` | 6 / 12 / 22 / 999 px | shape | exists |
| `--shadow-sm / md / accent` | see brand doc | depth | exists |

Display font: **Plus Jakarta Sans variable** (the site preloads `plus-jakarta-sans-latin-wght-normal.woff2`). Weights 400, 600, 700, 800. Licence: SIL Open Font License 1.1, so self-hosting and embedding in the app are allowed with the licence text kept in the repo (already satisfied by the Fontsource package). The app already uses this font; no new font is needed. If the designer wants a distinct display face for the greeting, that needs a decision from Urmi and the owner (the site's rule, from the brand doc: never bring back a serif or thin display face).

Logo: the site's wordmark is `src/assets/brand/logo.webp` in the private repo `harshbhx/feelings-beauty-care` (1024 by 291, 22 KB; the client's original is navy; the site draws it as a CSS mask in `--maroon-800` or white). There is no vector. The public `logo.png` is 800 by 800. The bindi (`favicon.svg`, one `#b3121b` circle) is the favicon and the PWA icon. **Licence status: the wordmark is the client's artwork. Recolouring it is marked CONFIRM with the client in the site's source. Ask Urmi to confirm before shipping the recoloured mask, and ask her for an SVG if she has one (it would be smaller than the webp).** The service tone colours and the site copy are the salon's own and free to use in its own app.

### Where PRD section 12 needs an explicit amendment

Each amendment goes into `docs/PRD.md` in the slice that needs it, with the reason, so the 12.11 checklist stays honest.

1. **12.2 "One sindoor button per view."** Needs a clarification for lists of decisions: one *filled* sindoor button per view (the first card on Needs action); the others use the tinted pill with sindoor text. Without this, Fix 4 would break the rule on every card.
2. **12.3 and "status = colour + icon + word, always" (12.11 rule 12).** Register and Month day cells at 40 px or smaller may show colour plus a letter or minutes without the icon; the icon, word and full chip stay in the key, the detail panel and every other list. Late can show as a number.
3. **12.2 "White page."** The app page background becomes `--bg-soft` with white cards. The website keeps white as the base; this is an app-only change, documented.
4. **12.6 Avatar: "Initials in 700 on `--bg-tint`, maroon text."** Becomes role-toned initials (the service tones, section 3). Still no stock photos.
5. **12.5 Owner desktop and 12.6 `RegisterGrid`.** Add the two-column detail panel layout for Register and Needs action, and the person-first week list for phones.
6. **12.11 rule 5 (no stat-card dashboards).** Reaffirmed: the Today hero is one card with one number and one sentence, not a grid.
7. **12.9 bindi list.** Add: the logo in the shell (not a bindi use, but record it); keep the bindi as the greeting full stop.
8. **12.4.** Add one line: list secondary text uses `--text-body` for the first line, `--text-muted` only for captions.

## 5. Slices in execution order

Each slice is one small PR into `main` (draft first, label `wp`, ready after `ci` green, then `e2e` green), branch off a fresh `origin/main`. No slice mixes a visual change with a logic change. "Before/after" means the PR body embeds the baseline images (before from `main`, after from the `snapshots` artifact) for every screen in the slice.

| # | Slice | Files likely touched | E2E and baseline impact | Size note | Acceptance criteria |
|---|---|---|---|---|---|
| 0 | **Design spike (no code)**: a one-page mock set at 390 and 1280 for Today (owner and staff), Needs action, Register, as PNGs in the PR, plus the proposed Needs action grouping for Urmi. Opus does this. | `docs/` only, images in the PR body (not committed) | none | none | Lead and Urmi agree the grouping and the logo question; tokens table confirmed |
| 1 | **Brand tokens and shell**: add the `--role-*` and `--app-page` tokens, page background, logo mask component, shell header and rail logo (owner and staff), amend PRD 12. | `packages/ui/src/styles/app-tokens.css`, `packages/ui/src/components/Logo.tsx` (new), `Rail.tsx`, `app/src/features/owner/shell/*`, `app/src/features/staff/shell/*`, `docs/PRD.md` | Nearly every baseline changes (background, header). Regenerate all. E2E ids unchanged | **Staff entry chunk: the logo must not go into the entry.** Load the mask image lazily or as a CSS background in the route CSS; measure with `scripts/size-budgets.mjs`; if over, drop an unused icon or lazy-load a component | Logo shows on owner phone Today, desktop rail and staff Today; background is `--bg-soft`; axe 0 serious or critical; staff initial JS at or under 170 KB; sign-in and check-in specs green |
| 1b | **Interaction layer** (see section 5a): motion tokens, press/hover/focus/disabled states and elevation for `Button`, `Chip`, `ListRow`, nav items, `Switch`, `Sheet` controls; pending/optimistic/success pattern in the mutation hook; haptics helper; check-in success moment. | `packages/ui/src/styles/*`, `Button.tsx`, `Chip.tsx`, `ListRow.tsx`, `Switch.tsx`, `Sheet.tsx`, `app/src/lib/haptics.ts`, `app/src/lib/useAction.ts`, `/__kit` page | Kit baselines (`kit-*`) and every screen with a button; regenerate in one snapshots run | Haptics helper tiny and eager (under 0.3 KB gzip); the rest is CSS | Every control has the six states below; no flat identical outlined buttons; axe clean; reduced motion verified; check-in success reviewed on a real phone |
| 2 | **Status model**: one status per row, late as a number, in Today rows, Staff, Credits lists; `StatusChip` priority helper in `app/src/features/owner/lib/status.ts`. | `status.ts`, `StatusChip.tsx`, owner Today and lists, i18n keys | Owner today, staff, credits, roster baselines; E2E assertions on chips may change (update in the same PR and list them) | Owner chunks only; keep each under 120 KB gzip | No row ever shows more than one chip; late rows show "+N m"; unit tests for the priority function cover every status pair |
| 3 | **Owner Today hero and filters**: hero card, three-option segmented filter, two-column desktop. | `app/src/features/owner/today/*`, `StatChip.tsx`, `ProgressStrip.tsx`, i18n | `owner-today*` (all variants) at both sizes | Owner chunk; remove the unused chip grid code to compensate | Hero shows "N of M in" and the sentence; one sindoor button; first person visible within 420 px on 390; axe clean |
| 4 | **Needs action triage**: groups, urgency rule, card hierarchy, one primary per card. | `app/src/features/owner/actions/*`, `Card.tsx`, `Button.tsx`, PRD amendment 1 | `owner-actions*` (phone is tall; keep per-group images small) | Owner chunk | Three groups in the agreed order; max two visible buttons per card; first card has the filled sindoor, others tinted; no new actions; existing approve and reject E2E flows green |
| 5 | **Lists, avatars, Sheet close**: role-toned avatar, `ListRow` hierarchy, contrast changes, Sheet close button neutral. | `Avatar.tsx`, `ListRow.tsx`, `Sheet.tsx`, `sheet.css`, `list.css` | Many baselines (all lists and every `staff-sheet-*`) | Sheet is in the staff entry: **keep CSS-only changes there**, no new JS | Close X is neutral on every sheet; list secondary text meets 4.5:1; E2E sheet specs green |
| 6 | **Staff Today and Payslips**: brand header, "Not checked in" late banner, payslip hero. | `app/src/features/staff/today/*`, `payslips/*`, `staff.css`, i18n | `staff-today*`, `staff-payslips*` | **Staff entry budget is the main risk**: Today is in the entry. Reuse existing components and CSS; no new dependency; check size in CI before asking for review | Banner shows only when the shift started and there is no check-in; the Check in button is untouched in position and test id; punch specs green; size budget green |
| 7 | **Register rework**: person-first week list (390), compact first column, number cells, desktop detail panel, key to a popover. | `app/src/features/owner/register/*`, `RegisterGrid` styles, i18n | `owner-register*` both sizes | Owner chunk under 120 KB | Names never wrap on 390; cells show late minutes; desktop panel updates on selection; keyboard navigation kept; axe clean |
| 8 | **Settings and Setup hierarchy**: grouped settings, setup next-step card. | `app/src/features/owner/settings/*`, `setup/*` | `owner-settings*`, `owner-setup*` | Owner chunk | Four groups; only one primary action on Setup; no "Done" pills |
| 9 | **Staff Month and remaining polish**: number cells, legend, small fixes from the review. | `app/src/features/staff/month/*` | `staff-month*` | Staff route chunk (not the entry); keep small | Late shows minutes; legend unchanged in meaning |
| 10 | **Docs and screens refresh**: update `docs/` screenshots, `STATUS.md` handled by the lead. | docs | none | none | Docs match the shipped UI |

Order rationale: tokens first so later slices reuse them, status model before the screens that show it, Today before Needs action (owner's first screen), staff Today late in the list because of the entry-chunk budget and sign-in risk, Register after the status model since it reuses the cell.

## 5a. Interaction design

Harsh's note (21 Oct 2026): every clickable thing (buttons, chips, rows, nav, toggles, sheets) feels like slop. This section is the contract for how controls behave. It ships with the 8 PM IST redesign, slice 1b, before the screens that use it. It sits inside PRD 12.8 (motion) and amends it where noted; hairlines-not-shadows (12.11) is relaxed only for the pressed/raised states named here.

### Principles

1. **Everything pressable answers within 100 ms**: a visible pressed state, then pending, then a result. Nothing is ever silent.
2. **Depth comes from tone and a hairline, not blur**: a control is raised by a 1 px lighter top edge and a 1 px darker bottom edge on the same colour (an inner edge, no drop shadow), pressed by removing both and darkening 6 percent. Amendment to PRD 12.11: these inset edges are allowed on buttons and chips; soft shadows stay banned.
3. **Hierarchy is visible at a glance**: one primary per view, secondaries are quieter but not "all outlined the same", destructive is its own look. No row of three identical outlined buttons.
4. **Honest states**: disabled controls say why; loading says what is happening; errors say what to do.

### The six states every control has

| State | Behaviour |
|---|---|
| Rest | Raised look per its role (table below). Minimum target 44 x 44 px, 48 px for the hero and sheet actions; hit area may be larger than the visible box. |
| Hover (pointer only, `@media (hover: hover)`) | Tone steps up one notch (for example sindoor 600 to 500), cursor pointer, 140 ms. Rows get a soft `--bg-soft` fill. No hover on touch. |
| Pressed | `transform: scale(0.97)` (0.98 for rows and chips), tone steps down, raised edges removed, 80 ms in and 140 ms out. A ripple is not used on iOS-style rows; on buttons a 220 ms radial wash from the touch point is allowed (opacity and transform only, one element, removed on end). |
| Focus-visible | The 2 px sindoor ring with a 2 px offset (PRD 12), never removed, also on rows, chips and nav. Keyboard focus on a primary button keeps the ring outside the hover tone. |
| Pending | The label stays, a 16 px ring replaces the leading icon (the one allowed spinner, inline in the control only), the control is `aria-busy` and ignores further presses; width does not change (no layout jump). After 8 s without an answer the label becomes "Still trying" and the control offers Cancel where the action is cancellable. |
| Disabled | 45 percent tone, not 45 percent opacity of text (contrast stays 3:1 for the label); `aria-disabled` rather than `disabled` where a reason is shown, so the reason can be read by touch and screen readers. The reason is a visible line under the control or in a press-and-hold hint ("Check in opens at 09:00", "Ask Urmi to approve your phone"). Never a disabled control without a reason on a primary action. |

### Roles and the look of each

| Role | Used for | Look |
|---|---|---|
| Primary | The one thing to do on the view (Check in, Approve, Finalise) | Solid sindoor, white label, raised edges, 48 px, bold. At most one per view and one per card. |
| Secondary | Common alternatives | Cream-tinted fill (`--bg-soft`) with a 1 px hairline and dark label, raised edges at 60 percent. Not an outline on white. |
| Tertiary | Low-stakes (Cancel, Skip, See details) | Text button with an underline on hover/focus, 44 px target, no box. |
| Destructive | Reject, Delete, Void | Never the default focus. Rest: secondary look with a red label and red icon. Armed (after the confirm sheet): solid red, still one tap. The close X on a sheet is neutral, never red. |
| Chip / segmented | Filters, reasons | Rest: hairline pill; selected: filled tone with a check; pressed scale 0.98; selected state announced (`aria-pressed`). |
| Row | List rows that open a detail | Whole row is the target (minimum 56 px), chevron at the end, pressed fill, hover fill, and a stable focus ring that wraps the row. |
| Toggle | Switches | 44 px track area, thumb slides 140 ms, optimistic flip then rollback with a toast on failure, label always states the result ("Selfie on check-in: on"). |
| Nav (tab bar, rail) | Moving around | Active marker is the bindi (existing); pressed scale 0.96 on the icon; 140 ms cross-fade of the label weight; a badge never covers the icon. |

### Motion tokens (one place, `packages/ui/src/styles/motion.css`)

| Token | Value | Use |
|---|---|---|
| `--dur-press` | 80 ms | Press in |
| `--dur-fast` | 140 ms | Hover, toggles, chips, press out, toast fade |
| `--dur-base` | 220 ms | Sheets, screen enter (fade + 8 px rise), ripple |
| `--dur-hero` | 520 ms | The check-in success moment only |
| `--ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Entering and pressing out |
| `--ease-soft` | `cubic-bezier(0.4, 0, 0.2, 1)` | Colour and state changes |
| `--ease-spring` | `cubic-bezier(0.34, 1.5, 0.5, 1)` | The bindi landing (existing) |

Animate opacity and transform only (colour for state changes is the one exception). No looping animation anywhere, no shimmer. **Reduced motion:** tier 1 (slides, lifts, ripple, spring, scale) off; tier 2 enters become 160 ms fades; tier 3 colour and focus changes stay; no haptics. The kit page has a "reduce motion" toggle for baselines.

### Feedback on every action: the pattern

One hook, `useAction`, wraps every mutation so the behaviour is the same everywhere:

1. **Press** (visual, instant).
2. **Pending**: the control shows the inline ring; for reversible changes (toggles, marks, approvals of routine items) apply the result **optimistically** at once and roll back with a toast that says what to do if it fails. Money, check-ins and anything needing the PIN are **never** optimistic: they wait, show the ring, and then show the result.
3. **Result**: success is a quiet confirmation in place (the card collapses with a 220 ms fade and a one-line toast "Approved. Priya can check in now." with Undo for 6 s where undo is possible), or the hero moment for check-in. Failure keeps the user's input, names the reason in plain words and offers the retry in the same place.
4. **Offline**: the control says "Saved on this phone, will send when you are online" with the queue count; this already exists for check-in and extends to leave and fix requests.
5. **Idempotency**: pressing twice never sends twice (the control ignores presses while pending; the idempotency key already exists on the API).

Every list that loads shows skeleton rows of the final height (no layout jump), not a spinner. Every empty state says what it is and the next action.

### Success moments

- **Check-in and check-out (the hero moment)**: after the server confirms, the sheet closes, the bindi lands on the Today header (520 ms spring), the headline reads "You're in at 10:02." and the quiet line shows "At the salon" (and the distance, see the check-in distance slice already shipped). One short vibration (`navigator.vibrate(8)`; a second 8 ms tick 90 ms later for check-out). The "Check in" hero button becomes the "Step out" and "Check out" pair without a layout jump.
- **Owner approvals** (new phone, overtime, leave): the card collapses, the Needs action count in the hero and tab badge decrements with a 140 ms change, toast with Undo. A light vibration (8 ms) on approve where supported.
- **Payroll finalise and mark paid**: a calm full-width confirmation strip ("September is final. 12 payslips are ready.") that stays until dismissed; no confetti, no counters.
- **Failures**: no shake, no red flash. A short, specific sentence and the next step.

### Haptics (where supported, never with reduced motion)

`app/src/lib/haptics.ts`, about 200 bytes: `tick()` = `navigator.vibrate(8)`, `success()` = `[8, 90, 8]`, `warn()` = `[16]`; guarded for iOS Safari (no Vibration API: do nothing, never throw) and for the user's reduced-motion and in-app "Vibration" preference in Me. Used only on: check-in/out success, approve/decline on owner cards, a failed check-in (warn), PIN accepted. Never on plain taps, scrolls or toggles, with one exception decided on 21 Oct 2026: the tick the app already gives on the Check in, Check out, Scan, Step out and I'm back taps stays.

### Targets and spacing

- Minimum 44 x 44 px for every pressable (PRD 12.11), 48 px for primary and sheet actions, 56 px for rows. Adjacent targets are at least 8 px apart.
- The pressed area is at least the visible area; thumb-zone: the primary action of a phone view sits in the lower third (sticky action bar), safe-area aware.

### Enforcement and tests

- `scripts/check-ui.mjs` gains rules: no `button` or `[role=button]` without a pressed style from the kit; no pressable under 44 px (extends KIT-04 to the main screens, not only the kit); no `transition` that animates anything but opacity, transform and color; no hard-coded durations or easings outside `motion.css`; no disabled primary without a reason element.
- E2E: a spec drives each control type with the keyboard (focus ring visible), asserts `aria-busy` while a delayed route is pending and that a double press sends one request (extends the idempotency test), asserts a disabled primary shows its reason, and that with `reducedMotion: 'reduce'` no transform transition runs and `navigator.vibrate` is never called (spy).
- Visual baselines: the kit page gets a "States" section (rest, hover, pressed, focus, pending, disabled for every role) captured with forced states, at 390 and 1280; the screens' baselines are regenerated once after slice 1b.
- Manual check by Harsh on a real Android phone and an iPhone before the layer is called done: press feel, vibration on Android, no accidental double sends over a throttled connection.

### Risks

- The inline pending ring and press states must stay in the shared kit CSS, not per feature, or the staff entry chunk budget (170 KB, about 0.2 KB headroom) is lost. Haptics is the only new eager code.
- Optimistic UI must never be applied to money, check-ins or PIN-gated actions; the hook takes an explicit `optimistic: false` default for those and the review checklist asks for it.
- Pressed and hover states are the usual source of screenshot flakes (see #85): baselines park the pointer away from controls before each shot and force states only on the kit page.

## 5b. Owner access screens (addendum)

Decision: [ADR-19](decisions/0019-owner-access-on-its-own-host-behind-cloudflare-access-with-passkeys.md), design in [owner access](owner-access.md). The owner app moves to its own host and signs in with passkeys. These screens are new and must use the redesigned kit and the interaction layer (section 5a); the logic slices come first, the visual treatment follows the plan's order (they are built once, in the new look, not twice).

| Screen | Content | Interaction notes |
|---|---|---|
| Owner sign-in | Salon logo, "Welcome back, Urmi" (name from settings), one primary "Use your fingerprint" (or "Use Face ID" by platform), a tertiary "Email me a code" shown only before the first device is enrolled, a quiet line "Lost your phone?" | The primary shows the pending ring while the system sheet is open; if the sheet is cancelled the control returns with "Nothing happened. Try again." No error red for a cancel. |
| First-device enrolment | Step 1 email code (6 boxes, auto-advance, paste support), step 2 "Make this phone your key" with a clear one-line explanation, step 3 success with the device name field prefilled ("Urmi's iPhone") | Success moment: the bindi lands once; haptic success on Android. |
| Add this device (new device) | A large code ("482 913") and "Approve this on your other phone", a countdown in plain words ("Expires in 14 minutes"), Cancel | No spinner on the whole screen; the code card is the focus; polls quietly, announces the result in a live region. |
| Approval card (Needs action, on an approved device) | Device name and platform, when and from where (city level only), the code to compare, two actions: Approve (primary, asks for fingerprint, then PIN) and Decline (secondary) | One primary per card; Decline is not red-armed (it is reversible by asking again); approving shows the fingerprint sheet first, the PIN pad second. |
| Settings, Security, Devices | List rows with platform icon, name, "This device", added and last used; Remove as a destructive row action behind the same fingerprint plus PIN; the last device shows a reason instead of Remove | Disabled Remove explains why ("Add another device first"); removal collapses the row with Undo not offered (it is a security action); toast "Removed. That phone is signed out." |
| Recovery | One field for the recovery code, a plain explanation that Harsh issues it, then the first-device enrolment | Error text names the reason (expired, used, wrong) without revealing which codes exist. |

Constraints: owner screens are lazy owner-entry code (no staff budget impact); no owner screen or string may appear in the staff entry; the owner host name never appears in design files, screenshots committed to the repo or docs for staff.

## 5c. iOS layer (24 Oct 2026, PR #127, draft)

Harsh asked for the whole app in Apple's iOS design language, keeping the brand. The layer lives in `packages/ui/src/styles/ios.css` plus the kit component files; `tokens.css` and `app-tokens.css` are unchanged, and every new value is a brand token, a mix of two brand tokens in oklab, or a brand colour at an alpha.

| Area | Decision |
|---|---|
| Type | The SF ramp on Plus Jakarta Sans: large title 34, title 28, headline and body 17, subhead 15, footnote 13 (13 stays the floor). rem throughout, so text zoom scales it. |
| Surfaces | Grouped page (`--rose-50` mixed 55 percent toward `--rose-100`), white cells with 12 px corners and no border, separators inset to the text, iOS fills (ink at 7 and 12 percent), materials (page or cell at about 86 percent, blurred). |
| Navigation | A bar that is clear at the top and turns to the material with a hairline once content runs under it; tab-level screens show a large title on the page (the h1) and its small twin fades into the bar; detail screens carry the h1 in the bar. Round bar buttons (back, bell). |
| Tab bar | A floating material capsule above the home indicator; the current tab is the sindoor tint on a soft tinted capsule. Replaces WP-10's solid bar (its test now checks the material). |
| Controls | Filled, gray, plain and tinted-red buttons; segmented control with a raised thumb; the 51 x 31 switch in the present green; check circles; passcode keys; sheets with a grabber, centred title and gray close circle on the grouped background; filter chips as capsules; menus on a material. |
| Gestures | Pull to refresh in both shells (refetches what is on screen; a lazy chunk after first paint). Swipe left on an inbox row to mark it read (a shortcut beside opening the row and Mark all read). |
| Dark | Follows the system (`prefers-color-scheme`), no in-app switch. Cells `--ink-900`, page `--ink-900` toward black, text `--rose-50` at iOS label alphas, tint `--red-400`, filled buttons stay `--red-600`, statuses mixed 55 percent toward `--rose-50` on a 28 percent tint (4.9:1 or more). QR codes stay dark on white. |
| Shadows | Soft shadows are allowed on floating chrome (tab bar, floating action capsules, toasts, the segmented thumb, the switch thumb) besides sheets: an amendment to PRD 12.11 for the iOS layer. |

PRD amendments this needs, for the lead: 12.11 (soft shadows on floating chrome), the non-goal "Dark mode (the brand is light only)" in section 1, and the route CSS budget (25 to 27 KB gzip in `scripts/size-budgets.mjs`).

## 6. CI, baselines and review process

- Branch off `origin/main` in a fresh worktree, push, open a draft PR into `main`, label it `wp` through REST (`gh api -X POST repos/harshbhx/feelings-staff/issues/<n>/labels -f "labels[]=wp"`; `gh pr edit` is broken). Edit bodies with `gh api -X PATCH repos/harshbhx/feelings-staff/pulls/<n> -F body=@file.md`.
- `ci` runs on every push (typecheck, Biome, `check-ui`, `check-arch`, `check-i18n`, unit and Workers tests, build, `size-budgets`). `gh run watch <id> --exit-status --interval 60`, then `gh run view <id> --log-failed | tail -80`.
- Baselines: `gh workflow run snapshots -R harshbhx/feelings-staff -f ref=<branch> [-f grep=<pattern>]`, then `gh run download <run-id> -n visual-baselines -D <tmp dir under /tmp/claude-1001/>`. The workflow can also commit directly with `-f commit=true`; a push by the workflow does not trigger `ci`, so push a follow-up commit after. **Look at the changed images with the Read tool** (brand, no overflow, no truncation, real copy) before copying them into `e2e/tests/__screenshots__/<project>/`. Copy only changed images; never bulk-overwrite.
- Review process: the PR body carries before and after images for each affected screen at 390 and 1280 (staff at 390), a one-line statement per acceptance criterion, and the size numbers from `size-budgets`. The lead reviews and merges; the designer does not self-merge.
- `gh pr ready <n>` runs the `e2e` workflow (Playwright in Docker, four projects, axe, visual). Needs `ci` and `e2e` green, with 0 serious or critical axe violations, before the lead merges.
- Docs links: `node scripts/check-docs-links.mjs` (light, allowed locally).
- **Deploy to production only from a green `main`**, using the redeploy recipe in `STATUS.md` (LEAD 5 21 Oct 06:55 UTC entry): download the `app-dist` artifact of a green `main` `ci` run and run `wrangler deploy -c dist/feelings_staff/wrangler.json --secrets-file deploy/prod-secrets.json` from the dist directory with the account id in `STATUS.md`. The lead or the deployer agent does this, not the designer, and not after every slice: batch slices, redeploy once, and check sign-in and check-in on the live site right after. The preview (https://demo-feelings-staff.creharsh.workers.dev, seeded demo data) is redeployed with `deploy/redeploy.sh <green main ci run id> --seed` and is where the owner reviews a slice first.

## 6b. Round 2 of the iOS layer: fields, guidance, motion (PR #127)

Decisions taken in this round. Each needs an amendment to PRD 12 when the PR is accepted.

- **Fields.** Inputs, date and time fields and textareas are iOS filled fields: the tertiary fill (`--fill`) with a hairline edge in `--border-strong`, lifting to the cell colour under the 2 px sindoor ring on focus. The edge stays so the control is visible against the page in light and dark (WCAG 1.4.11 asks for it where the fill alone is faint); label, hint and placeholder still name it. Search is the iOS search bar: filled capsule, magnifier, no edge at rest.
- **Guidance layer** (`app/src/lib/ux`). Nothing asks or interrupts on first paint. The layer mounts two seconds after the shell, as its own chunk, and never in an automated browser unless the URL has `?guide=1`.
  - *Permissions.* A card says what the permission is for, in three lines, then the Allow tap triggers the browser prompt. Refused permissions get the how-to-fix steps for the phone's platform and a "try again" that re-reads the state. Alerts on iPhone outside the Home Screen send the person to the install guide first.
  - *Install gate (compulsory).* Installing is not optional. On a phone or tablet in a browser tab, a full-screen gate replaces the whole app (staff and owner): no close button, no "later", back on every load until the page runs standalone (`display-mode: standalone` or `navigator.standalone`). iPhone Safari gets the three numbered steps with their glyphs and a drawn Safari bar; Android gets a real Install button once Chrome offers `beforeinstallprompt`, with the menu steps as the fallback; other iPhone browsers and in-app browsers are told to open the link in Safari or Chrome, with Copy link. Standalone is re-detected on `appinstalled`, display-mode changes and when the tab returns. Left alone: the installed app, the staff sign-in, invite and waiting pages (they teach the install themselves and carry the join code), the door display, the public verify page, the kit, automated browsers (`?installGate=1` switches the gate on for them) and `?allowBrowser=1` on a non-production host. On a computer nothing is blocked: a slim hint says the app is for phones, with the link to copy.
  - *Tour.* Staff and owner each get a short coach-mark tour on first sign-in: a welcome card, then one lit tab per step. Skippable at every step, remembered per person and role in localStorage, replayable from Me (staff) and More (owner). The tour and the permission sheets only run inside the installed app.
- **Motion.** One sheet curve (`--ease-sheet`, 380 ms) and one settle (`--ease-settle`, a small overshoot covered by the sheet's skirt). Screens enter with a short slide and fade (`.fs-route`, owner main keyed by path; `.staff-main`); toasts settle in; the selected tab's icon bounces once. Reduced motion turns every slide and bounce into a 160 ms fade or nothing.
- **Desktop for staff.** From 48rem the column is 40rem. From 64rem the tab bar becomes a left rail like the owner's and the content a 44rem reading column with the action button floating at its foot.

## 7. Risks and rules

### Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Staff entry chunk at 169.8 of 170 KB | A single icon or component can fail `ci` | Staff slices (1, 5, 6) are CSS-first; the logo is a lazy or CSS-background asset; include the `size-budgets` output in every staff PR; if a gain needs bytes, remove dead code or lazy-load something else in the same PR; never raise the budget without the lead |
| Fonts and logo weight | The logo webp is 22 KB, the font is already loaded | No new font. Use the existing mask technique; ask Urmi for an SVG; the wordmark must not be preloaded on staff routes |
| Sign-in and check-in regressions | Production staff cannot work | No change to `punch`, `scan`, PIN pad logic or routes; only styles and layout around them; run the punch and sign-in E2E specs on every slice that touches the shell; check on the preview before any production redeploy |
| Baseline churn | Slice 1 changes almost every screenshot, so later diffs are noisy | Merge slice 1 first and regenerate baselines once; later slices only touch their own screens; use `-f grep=` to limit |
| Flaky screenshots | Failed `e2e` runs waste Actions minutes | Known flaky areas: the staff Today bottom action bar race (the bar mounts after the first paint), hover states (do not snapshot hover), and animated moments (the bindi landing, sheet slide). Wait on a stable selector, disable animations in the screenshot helper, never snapshot a state that depends on the clock without the fixed test time |
| Needs action grouping is a product decision | Wrong grouping confuses the owner | Slice 0 gets Urmi's OK on the grouping before slice 4 starts |
| Logo licence | Recolouring the wordmark is unconfirmed | Ask Urmi before slice 1 ships the logo; fall back to the bindi plus the text name if she says no |
| PRD drift | Redesign breaks 12.11 | Amend 12 in the slice that needs it (section 4); `check-ui` must stay green |

### Rules

- **One designer agent at a time.** No parallel designers on the same screens. Sonnet implementers may work on separate slices only if their files do not overlap.
- **Opus only for design decisions**: slice 0, the Needs action grouping, the register layout and any new token. **Sonnet for implementation** of every slice and all i18n, tests and docs helpers.
- Usage caps (`/home/ubuntu/.local/state/guard/usage.json`, field `pct`): check before starting and after each push. At 85 or above, finish the current slice, push, stop and report. At 90 or above, push what you have at once and stop. Do not start new helpers above 70 (Sonnet only) or at 90.
- No AI attribution anywhere (commits, PR bodies, code, docs). Conventional commits with a scope, for example `feat(ui): add role-toned avatar`.
- Do not touch `STATUS.md`, `agents.tsv` or WhatsApp; the lead does. Never commit secrets or real client data (demo seed only). Contracts stay frozen.
- Every UI PR obeys PRD 12.11 (as amended): brand tokens only, no hex outside `packages/ui/src/styles`, Phosphor regular icons only, nothing under 13 px, sentence case, 44 px targets, visible sindoor focus ring, status as colour plus icon plus word (with the Register exception), mobile first at 390.
- Final report per slice, under 12 lines: PR URL, run URLs, state, size numbers, next step.
