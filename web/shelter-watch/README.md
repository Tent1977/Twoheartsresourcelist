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
- Moderation: **post now, flag later.** Phone numbers, emails, threats, and street addresses on
  confidential sites are held for a moderator. Three reports from different people hide a review.
- Fact checker: establishment says / residents say (3+ residents, 60% agreement) / verified.
- Claude Rating: 0–100, formula shown on every page. Residents 50%, fact checker 20%,
  transparency 20% (only once the operator has been asked), research quality 10%.
  No score until 5 rated reviews.

## Turning on shared reviews
Demo mode keeps reviews in one browser. To go live:
1. Add a Web app in a Firebase project; paste its config into `config.js`.
2. Enable **Anonymous** sign-in (Authentication → Sign-in method).
3. Merge `firestore.rules` into the project's Firestore rules.
4. Moderate in the Firebase console: set a comment's `status` to `approved` or `removed`.

Note: the auto-hold screen runs in the browser, so a determined person can bypass it. The report
button and moderator review are the backstop.

## Updating listings
`python3 -I data/shelter-watch/merge.py data/shelter-watch/raw data/shelter-watch` then
`node scripts/build-shelter-watch.js`. Listing IDs are slugs of the name and reviews are keyed to
them — renaming a listing orphans its reviews.

## Phase 2 (not built)
News coverage per facility, funding history, leadership (public names only), crime near each site
(police calls for service, with context), operator fact submissions (`establishmentAskedAt`).
