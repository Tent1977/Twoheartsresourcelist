# Shelter Watch — web app (phase 1)

Static site, no build tools. Open `index.html` through any web server (e.g. `python3 -m http.server`).

## What phase 1 does
- 155 shelter and housing listings for Reno, Sparks and Washoe County, searchable and filterable
  (type, who it serves, research confidence).
- Facility profile: basics, sources, research notes. DV shelter / confidential addresses are never shown.
- Resident reviews: 11 ratings (happy, comfortable, affordable, residents first, clean, safe, rules fair,
  privacy, support staff, management, would recommend) plus "what's it really like" facts
  (pets, visitors, rules, kitchen, bathroom, furnished, staff on site, peer support, trauma-informed,
  harm reduction, events, accepts registrants).
- Moderation: **post now, flag later.** Phone numbers (including spelled-out digits), emails
  (including "at"/"dot"), and threats against a person are held for a moderator. Every review of a
  confidential (DV) site is held. Three reports from different people hide a review. The same
  screen runs again on the server (`functions/`), because the browser check can be skipped.
- One review per person per place, one post per minute, enforced by the database rules.
- Confidential sites: address, notes, source links, unit counts and street names are stripped at build time.
- Call buttons: each number is parsed and checked at build time; the build fails on an uncallable number.
- Emergency strip (911, 211, DV 24/7 line, 988) is in the HTML, so it works before data loads.
- Fact checker: establishment says / residents say (3+ residents, 60% agreement) / verified.
- Claude Rating: 0–100, formula shown on every page. Residents 50%, fact checker 20%,
  openness 20% (only once the operator has been asked), research quality 10%.
  Only residents and their family/friends count, one per person. No score until 5 of them rate it.

## Turning on shared reviews
Demo mode keeps reviews in one browser. To go live:
1. Add a Web app in a Firebase project; paste its config into `config.js`.
2. Enable **Anonymous** sign-in (Authentication → Sign-in method).
3. Merge `firestore.rules` into the project's rules and deploy `firestore.indexes.json`.
4. Deploy `functions/` (server-side review screen). Run `node scripts/build-shelter-watch.js` first.
5. Turn on **App Check** — anonymous sign-in makes new accounts cheap, so App Check is what stops
   one person farming accounts to stuff reviews or mass-report.
6. Moderate in the Firebase console: set a comment's `status` to `approved`, `hidden` or `removed`.

Known limits: someone clearing their browser gets a new anonymous account, so the one-per-person
rules slow abuse rather than stop it. App Check plus a human moderator are the real backstop.
Nothing here has been deployed.

## Updating listings
`python3 -I data/shelter-watch/merge.py data/shelter-watch/raw data/shelter-watch` then
`node scripts/build-shelter-watch.js`. Listing IDs are slugs of the name and reviews are keyed to
them — renaming a listing orphans its reviews.

## Phase 2 (not built)
News coverage per facility, funding history, leadership (public names only), crime near each site
(police calls for service, with context), operator fact submissions (`establishmentAskedAt`).
