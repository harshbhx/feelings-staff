# Research: live in-salon photo check-in instead of QR (21 Oct 2026)

Status: research only, nothing built. Requested by Harsh. Estimates are the researcher's, unverified where noted.

## What the repo already has
- PRD already has an optional selfie: owner toggle, off by default, live getUserMedia only (no gallery), SHA-256 in the signed payload, 480 px JPEG. Face matching is NOT in v1 (PRD section 10.4, ADR-11, S-07, S-21).
- Selfie is an extra layer on top of geofence, PIN and device key. The door QR is the strong-mode fallback (section 4.5).
- Retention: 30 days in R2 via lifecycle rule + nightly purge (docs/runbooks/retention-purge.md). Selfie consent is separate and withdrawable.
- Dropping the QR for a photo is a weaker check, not a stronger one: keep geofence + PIN + device key and make the photo an addition.

## Build time (estimates)
- Phase 0: about 1 agent-day, 2 PR slices: required-selfie mode with a background-scene hint, then an owner review queue.
- Phase 1: about 1.5 to 2 days, 2-3 PRs: reference-photo upload, similarity scoring, tuning.
- Phase 2 (face matching): 3+ days plus legal review. Not recommended.

## Resources and cost (arithmetic, not a quote)
- 15 staff x 4 punches = about 60 photos/day, 1,800/month, about 60 KB each = about 100 MB with 30-day retention: R2 free tier.
- Workers AI: $0.011 per 1,000 Neurons, 10,000 Neurons/day free on Free and Paid (pricing page, 20 Oct 2026).
- gemma-4-26b-a4b-it has vision, $0.10 per M input tokens, listed as available on Free. About 1.5k tokens per image (unverified): under $1/month, probably free.
- No Queues, no Cloudflare Images needed; the Worker can call env.AI directly.
- Workers Paid ($5/month) is only needed for some models (kimi-k2.6, kimi-k2.7-code, glm-5.2). Account plan not checked.

## Do Workers AI models help?
- Vision models available: gemma-4-26b-a4b-it, llama-4-scout, llama-3.2-11b-vision, mistral-small-3.1, moondream3.1, llava-1.5-7b (beta), kimi-k2.6.
- Also resnet-50 (classification), detr-resnet-50 (detection). Embedding models are text-only; qwen3-vl-embedding-2b may allow image embeddings (not verified).
- NO face-recognition or face-match model found. Workers AI is not a face-ID service.
- "Taken inside our salon": a vision LLM can say whether a photo looks like a salon interior (weak check). Comparing to reference photos is unproven, no benchmark. Real false-reject risk (lighting, another corner, crowds, wedding days).
- Screenshot or photo-of-a-screen detection: not reliable.
- Latency about 1-5 s (guess). Use the score only as a flag for the owner, never as auto-reject.

## Cheating vectors and no-ML fixes
- Old photo / gallery: live capture only, no file input (already in PRD), plus a server-issued nonce.
- Photo of a photo: show a one-time random code or colour on screen that must appear in frame, or a random gesture. Most value without ML.
- Someone else's face: no ML fix; device-bound key + PIN do most of the work; owner compares to enrolled photo.
- Fake location: keep geofence; EXIF is stripped by canvas capture so rely on server time and signed hash.
- Owner review queue: cheapest and strongest layer for 15 staff.

## Privacy and legal
- PRD cites the SPDI Rules 2011 and says no face templates (photo-only side). Face matching creates a biometric template (sensitive data). DPDP Act 2023 / Rules timelines not verified: check with a lawyer.
- Keep separate consent, 30-day retention, withdrawal (PRD has all three). Consent is weak when staff depend on pay: keep a non-photo fallback ("Send to Urmi without a photo").

## Recommended plan
- Phase 0 (about 1 day): required live selfie, nonce/code on screen, owner review queue, QR kept as fallback. Risk: dark photos, old Androids without camera; fall back to owner approval.
- Phase 1 (about 2 days): vision model scores "looks like the salon" against 3-5 reference photos, flag only, shadow mode for 2 weeks first (risk: false flags make the owner ignore them).
- Phase 2: skip unless proxy punching shows up in the data.
- Bottom line: do Phase 0 now; keep the QR rather than removing it.

## Not verified
Exact Neuron cost per vision call, Workers Paid status of the account, current DPDP Rules timelines, accuracy of the salon-scene check, usability of qwen3-vl image embedding.
