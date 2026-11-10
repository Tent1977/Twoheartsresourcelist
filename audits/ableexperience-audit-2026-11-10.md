---
target: https://ableexperience.org
netlify_project: beamish-dusk-fe99bf (site a1175a9c-1a4d-4be3-88e3-bbb1c42b893c)
current_deploy: 6af0186e394de6d0f5ca49b7 (upload, published 2026-11-08T06:36Z)
audit_date: 2026-11-10
auditor: Claude Code (read-only; nothing submitted, signed in, written or deployed)
pages_crawled: 31            # distinct HTML pages (plus .html aliases and both netlify.app hosts, which return identical bodies)
files_fetched: 57            # HTTP 200 responses from same-site hosts (HTML, JS, manifest, images, PDF, robots, sitemap); 45 probe URLs returned 404
method:
  - curl crawl from seeds (sitemap.xml, robots.txt, known page names, guessed routes /caseworker /portal /login /admin /app ...), following every same-site href/src/JS string
  - all first-party JS is inline; read every <script> block on every page
  - Playwright Chromium render of all 31 pages at 1280px and 390px (console errors, page errors, failed requests, HTTP>=400, overflow, labels, headings, meta); Firestore/identitytoolkit/Formspree requests were aborted by the auditor so no backend data was read
  - offline Playwright reproduction of the directory's onclick-building code (no network)
  - Netlify MCP read-only: get-project, get-forms-for-project, get-deploy-for-site
  - third-party hosts (gstatic, cdnjs, firestore.googleapis.com, formspree.io, fonts, maps, external links) are blocked by the sandbox proxy -> NOT_CHECKED
backends_seen:
  - Firebase project able-website-ec33b (SDK 10.7.1 compat + Firestore REST): collections resources, verifications, claims, submissions
  - Firebase project the-can-t-be-reached-app (SDK 10.12.2 modular, /app only): posts, chats, questions, caseworkers, room, reports, lockers, limits
  - Formspree form maqllayw (homepage join + contact only)
  - Netlify Forms: able-forms (schedule/suggestions/certification/events copy), caseworker-signup (/app)
note_on_keys: Both Firebase web apiKeys in the HTML (AIza…) are normal public client identifiers, not secrets. No private key, service-account key, admin token or third-party secret was found in any fetched file.
severity_counts: {critical: 0, high: 3, medium: 8, low: 10}
evidence_dir: /tmp/claude-0/-home-user-Twoheartsresourcelist/cd605e7d-0ecb-57e7-80c9-ff001a94dc42/scratchpad/   # audit-site/pages (downloaded files, named by URL path), audit-render (render.json, screenshots, onclick_test_output.txt). Scratch space; may not persist.
---

# FINDINGS

Line numbers refer to the live HTML as downloaded on 2026-11-10 (file = URL path; `/` = index).

```yaml
- id: F-001
  severity: high
  area: access-control / resource directory
  location: /able_resource_directory lines 1263-1330 (verifyWithGoogle/verifyWithFacebook/_completeVerification), 403 (canEdit), 1217
  evidence: |
    1217: "Your listing will be marked <strong>Verified</strong> right away and ABLE will be notified."
    1312-1316: await updateDoc(doc(db, "resources", _verifyResourceId), { claimed: true, claimStatus: "claimed", claimedByEmail: user.email, ...
    403: const canEdit = currentUser && (isAdmin || r.claimedByEmail === (currentUser ? currentUser.email : null));
    The personal-domain block (line 140, gmail.com etc.) exists only in signInWithGoogle(); verifyWithGoogle()/verifyWithFacebook() have no domain check and no approval step.
  impact: The intended flow lets any Google or Facebook account self-mark any listing "Verified" and then edit its phone, address, hours and notes; the client applies no approval step or ownership check. (Firestore rules are not visible. See U-001.)
  fix_hint: Write a pending claim only, and have the admin approve it (or enforce this in Firestore rules); do not grant edit rights from a client-side email match.

- id: F-002
  severity: high
  area: XSS / admin dashboard
  location: /admin lines 407, 418, 421 (activityCard -> container.innerHTML); source of data: /able_resource_directory lines 224-229, 1321-1328
  evidence: |
    admin 418: <h4>🏢 ${a.resourceName || 'Unknown Organization'}</h4>
    admin 421: &nbsp;by <strong>${a.verifiedByName || a.verifiedByEmail || 'Unknown'}</strong>
    directory 1326: verifiedByName: user.displayName || user.email   (Google/Facebook display name, chosen by the user)
  impact: Any signed-in verifier controls strings that the admin page renders as raw HTML. This is stored XSS that runs in the admin's authenticated session.
  fix_hint: Escape all fields (textContent or an esc() helper) in activityCard and in the error branch at admin line 392.

- id: F-003
  severity: high
  area: JS bug + XSS / resource directory cards
  location: /able_resource_directory lines 451 (editBtn) and 454 (claimBtn)
  evidence: |
    451: onclick='openEditModal(${JSON.stringify(r).replace(/'/g,"\'")})'   -> "\'" === "'" so the replace is a no-op
    454: onclick="openVerifyModal('${r.id || ""}','${esc(r.name).replace(/'/g,"\\'")}')"  -> esc() already turned ' into &#39;, which the HTML parser decodes back to ' before JS runs
    Offline reproduction with name "Children's Cabinet" (audit-render/onclick_test_output.txt):
      edit onclick attribute truncated to: openEditModal({"id":"abc123","name":"Children
      pageerrors: "SyntaxError ... Invalid or unexpected token", "SyntaxError ... missing ) after argument list"
    16 of 325 embedded listings have an apostrophe in the name (e.g. "Children's Cabinet", "RISE Women's CrossRoads Program").
  impact: The "Verify This Listing" and "Edit Listing" buttons do nothing for those listings. An apostrophe in any field breaks out of the single-quoted onclick attribute, so a claimant can inject attributes or script that runs when an admin or editor views the directory.
  fix_hint: Attach handlers with addEventListener and look up records by id; never put JSON or strings inside inline onclick attributes.

- id: F-004
  severity: medium
  area: forms / admin
  location: /admin lines 287-304
  evidence: |
    298: "All submissions from the Contact, Join, Suggestions, Schedule, Certification, and Events forms are emailed directly to ablelivingexperience.org@gmail.com via Formspree."
    Code: only / join + contact post to Formspree (index 1650, 1668, 1705). /schedule, /suggestions, /certification, /events-pricing call ableSubmit(), which POSTs to Firestore `submissions` + Netlify `able-forms` (e.g. schedule 404-427). No page reads the Firestore `submissions` collection (grep: no client read anywhere).
  impact: The admin dashboard sends staff to Formspree, which does not hold 4 of the 6 form types. Those submissions sit in Firestore and Netlify, and the admin UI does not show them.
  fix_hint: Correct the admin text and either add a Submissions view or point staff at Netlify Forms / Firestore.

- id: F-005
  severity: medium
  area: forms / delivery
  location: / lines 1650-1724; /schedule,/suggestions,/certification,/events-pricing ableSubmit block (e.g. /schedule 404-427); Netlify forms list
  evidence: |
    Netlify registered forms (MCP): able-forms (5 subs, last 2026-11-08), caseworker-signup (0), contact (1, last 2026-11-06), join-interest (1, last 2026-11-06), suggestions (1, last 2026-11-06), schedule-notify (1, last 2026-11-06).
    No current page posts to form-name contact, join-interest, suggestions or schedule-notify (only "able-forms" and "caseworker-signup" appear in live HTML).
    /schedule 410-416: "// Copy 2 (best effort): Netlify Forms." fetch("/", ...).catch(function () {});
    Success is reported when the Firestore write succeeds (418-420). Firestore has no email path.
  impact: Submissions go to three places (Formspree, Firestore, Netlify) depending on the form. Netlify copies fail silently, and four registered Netlify forms are stale. Whether a meeting, certification, event or suggestion submission ever reaches an inbox depends on Netlify notification settings that this audit could not see (U-004).
  fix_hint: Pick one delivery path per form with a confirmed email notification, delete the stale Netlify forms, and surface Netlify POST failures.

- id: F-006
  severity: medium
  area: forms / validation
  location: /schedule 299, /certification 355, /events-pricing 305 (submit handlers start at /schedule 379, /certification 445, /events-pricing 392)
  evidence: |
    <form onsubmit="submitMeeting(event)" novalidate>  ... <input type="text" id="m-name" ... required/>
    submitMeeting() calls ableSubmit() directly with no check of required fields (same pattern in submitCert, submitEvent).
  impact: Because `novalidate` turns off the browser's `required` checks and the JS adds none, blank or no-email requests are saved and the user sees the success screen.
  fix_hint: Remove novalidate or validate required fields in the submit handlers (as /suggestions already does).

- id: F-007
  severity: medium
  area: resilience / resource directory
  location: /able_resource_directory lines 9-11, 81, 92; screenshot audit-render/ableexperience_org_able_resource_directory_390.png
  evidence: |
    When www.gstatic.com Firebase scripts fail to load: pageerror "ReferenceError: firebase is not defined" (line 81: class GoogleAuthProvider extends firebase.auth.GoogleAuthProvider {}).
    Page stays on "Loading resources…" / result-count "Loading…" permanently; the embedded STATIC_RESOURCES (325 listings) and the "Offline copy" banner are never shown.
  impact: Users whose network, filter or ad-blocker blocks gstatic.com get an empty directory, even though a full backup copy is in the HTML.
  fix_hint: Guard on typeof firebase === "undefined" before using it, and fall back to renderResources(STATIC_RESOURCES) + showStaticBanner().

- id: F-008
  severity: medium
  area: security headers
  location: all responses (e.g. GET / and /admin headers); deploy 6af0186e summary
  evidence: |
    Response headers: cache-control, content-type, etag, server: Netlify, strict-transport-security: max-age=31536000 ... no content-security-policy, x-frame-options, x-content-type-options, referrer-policy, permissions-policy.
    Deploy summary: "No header rules processed".
  impact: Nothing limits the XSS in F-002/F-003. /admin and /app (sign-in and caseworker screens) can be framed (clickjacking), and there is no MIME-sniffing protection.
  fix_hint: Add a _headers file with CSP (at least frame-ancestors 'none' for /admin and /app), X-Content-Type-Options: nosniff and Referrer-Policy.

- id: F-009
  severity: medium
  area: privacy / data exposure
  location: /able_resource_directory 189 (anonymous getDocs of full resources docs), 222, 1315-1316, 445; / 1751; /app 242
  evidence: |
    189: const snap = await getDocs(collection(db, "resources"));   (runs for signed-out visitors via onAuthStateChanged)
    222: updatedBy: currentUser.email      1315: claimedByEmail: user.email      1316: claimedByName: user.displayName || user.email
    445: `<div class="claimed-by">Managed by: ${esc(r.claimedByName)}</div>`
    /app 242 FS = ".../documents/resources?pageSize=300&key=..." (no field mask, unauthenticated)
  impact: Verifiers' and editors' personal Google/Facebook emails and names are stored on documents that the site itself reads publicly. Anyone can retrieve them through the REST URL the site uses. (Whether populated values exist now was not checked, since Firestore data was not read.)
  fix_hint: Move claimant identity to a non-public collection (e.g. claims/verifications with restricted read) and keep only a boolean on the public resource doc.

- id: F-010
  severity: medium
  area: privacy notice
  location: /privacy, /privacy.html, /terms -> 404; no "privacy" link in any nav/footer
  evidence: |
    curl /privacy -> 404 (Netlify default "Page not found"). Only inline notes exist (/ line 1385 "We respect your privacy..."; /suggestions privacy-note).
    PII collected: names, emails, phones (6 forms), Google account email + uid (caseworker sign-up, /app 1017), map location of posts, chats, ID/document photos in the /app locker, Google/Facebook profile on directory verify.
  impact: There is no privacy policy for a site that collects contact details, location and identity documents from vulnerable users and sends data to Formspree, Google Firebase and Netlify.
  fix_hint: Publish a privacy page listing what is collected, where it goes (Formspree, Firebase, Netlify) and how long it is retained, and link it from every form.

- id: F-011
  severity: medium
  area: accessibility / form labels
  location: / lines 1353-1383 and 1532-1555 (join + contact forms); /able_resource_directory 1028 (search), 1114-1175 (edit modal); /donate 416
  evidence: |
    Render audit, unlabeled visible controls on /: INPUT[name=firstName], INPUT[name=lastName], INPUT[name=email], INPUT[name=phone], SELECT[name=role], TEXTAREA[name=message], INPUT[name=name], INPUT[name=email], SELECT[name=subject], TEXTAREA[name=message]
    e.g. <label>First Name *</label> <input type="text" name="firstName" required ...>   (no for/id pairing)
    /able_resource_directory: <input type="text" id="search-input" placeholder=...> (no label); /donate: <input type="number" id="custom-amount" placeholder="00.00"> (no label)
  impact: Screen readers announce these fields without names, which fails WCAG 1.3.1/4.1.2 on the main join and contact forms.
  fix_hint: Add matching for/id pairs (or wrap inputs in their labels) and give the search and amount inputs an aria-label.

- id: F-012
  severity: low
  area: spam protection
  location: ableSubmit on /schedule,/suggestions,/certification,/events-pricing; / Formspree handlers; Netlify forms metadata
  evidence: |
    Detection form declares bot-field, Netlify shows able-forms honeypot:true, recaptcha:false; the JS POST never includes or checks bot-field.
    Firestore write is an unauthenticated REST POST: ".../documents/submissions?key=AIza…" with only the public key.
  impact: The honeypot and captcha give no protection, so bots can fill the submissions collection and Netlify forms freely.
  fix_hint: Add a real honeypot/turnstile check, and/or Firestore rules that validate shape and size, plus App Check.

- id: F-013
  severity: low
  area: content / phone link
  location: /help/food line 119; /help/children-family line 156
  evidence: '<a href="tel:7753313663152">775-331-3663 ext. 152</a>   (13 digits; extension concatenated)'
  impact: Tapping the Sparks Family Resource Center number dials an invalid number.
  fix_hint: Use tel:+17753313663,152 (or ;ext=152).

- id: F-014
  severity: low
  area: content / email links
  location: /able_resource_directory line 42 (STATIC_RESOURCES) + buildCard line 427-428
  evidence: |
    Email button renders whenever the field contains "@": 29 listings have values that are not a single valid address, e.g.
    "office.reno@visitng angels.com", "accounting@the bridgereno.com   info@thebridgereno.com", "orders@momsmeals.com.", "jhunt@ahcfacilities   fzamora@ahvfacilities.com"
  impact: The "Email" button opens a mailto with a broken address for those listings.
  fix_hint: Clean the email field to one valid address per record (or validate before rendering the button).

- id: F-015
  severity: low
  area: PWA manifest
  location: /app.webmanifest line 13
  evidence: '{"src": "/app-icon-512-maskable.png", ... "purpose": "maskable"}  -> GET /app-icon-512-maskable.png = 404; manifest served as content-type: application/octet-stream'
  impact: The maskable icon is missing (Android install falls back or shows a console warning), and the manifest MIME type is wrong.
  fix_hint: Upload the icon (or remove the entry) and serve the manifest as application/manifest+json.

- id: F-016
  severity: low
  area: donate page / dead code
  location: /donate lines 478-501, 434, 453
  evidence: |
    selectedAmount is set by selectTier()/updateDonateButtons() but never read; the donate buttons are static links to https://www.renoinitiative.org/donate-1
    505: "// Payment links are configured directly on the buttons above"
  impact: The tier and custom-amount picker has no effect, and the amount a donor picks is not carried to the payment page.
  fix_hint: Remove the picker or pass the amount to the payment link, if RISE supports it.

- id: F-017
  severity: low
  area: accessibility / heading order
  location: all 17 /help/* pages, /suggestions, /admin (h1->h3); /the-411-coordinated-entry, /the-411-psh-nevada (h2->h4)
  evidence: Render audit headingSkips: ['h1->h3'] / ['h2->h4']
  impact: The skipped heading levels make the outline harder to follow with a screen reader.
  fix_hint: Insert the missing level or re-level headings.

- id: F-018
  severity: low
  area: SEO / duplicates
  location: /the-411*, /schedule, /suggestions, /donate, /certification, /events-pricing, /able_resource_directory (no canonical); /able_resource_directory (no meta description); netlify.app hosts
  evidence: |
    No <link rel="canonical"> on 10 public pages (index, /help/*, /app have one).
    https://main--beamish-dusk-fe99bf.netlify.app/ -> 200 and https://beamish-dusk-fe99bf.netlify.app/ -> 200 (same body as apex, no redirect); /the-411.html, /app.html, /admin.html etc. -> 200 duplicates.
    /favicon.ico -> 404; only /help/* and /app declare an icon.
  impact: Duplicate URLs can be indexed under several addresses, and the directory, the main resource page, has no search snippet text.
  fix_hint: Add canonical and description tags, and a favicon.

- id: F-019
  severity: low
  area: mobile layout
  location: /help/children-family (Reno Parks & Recreation entry)
  evidence: 'At 390px viewport document.scrollWidth = 417; overflowing text node: "https://www.reno.gov/government/departments/parks-recreation-community-services/important-information/registration"'
  impact: The page scrolls horizontally on phones.
  fix_hint: Add overflow-wrap:anywhere to .res p or shorten the URL into link text.

- id: F-020
  severity: low
  area: leftover placeholder / dead code
  location: /suggestions 520-523; /able_resource_directory 14-26, 160-163, 448, 1012; / 1577
  evidence: |
    /suggestions 521: "// Replace this URL with your Google Apps Script Web App URL // (same setup as the resource directory — see SETUP_GUIDE.md)"
    /able_resource_directory 448: const rJson = ... (never used); 1012: <img id="user-avatar" src="" alt=""/> (empty src resolves to the page URL; render audit reports it as a broken image)
    / 1577: footer Facebook button <a href="#" class="social-btn facebook"> (goes nowhere; the header one points to facebook.com/ablereno)
  impact: Leftover setup comments, unused code, an empty-src image and a dead footer link.
  fix_hint: Remove the stale comments and unused variable, set the avatar src only when one exists, and fix the footer link.
```

# UNVERIFIED

```yaml
- id: U-001
  area: Firestore rules (able-website-ec33b) / resources
  suspicion: The directory client calls updateDoc on resources/{id} for any signed-in user (verify flow, claim flow line 275) and setDoc on empty-collection seeding (seedFirestore, line 208) for anonymous visitors. If rules match the client, any authenticated user can rewrite any listing (F-001 becomes directly exploitable).
  confirm_by: Read firestore.rules in the Firebase console, or run the rules emulator with an unprivileged token. Do not test against production.

- id: U-002
  area: Firestore rules / submissions, verifications, claims
  suspicion: submissions takes unauthenticated create (by design). It is unknown whether list/get is also open, which would expose all form PII. The same question applies to verifications (names and emails) and claims.
  confirm_by: Check the rules for read on submissions, verifications and claims (rules review only; this audit did not attempt reads).

- id: U-003
  area: /app (the-can-t-be-reached-app) access control
  suspicion: Admin and caseworker gating is client-side (ADMIN_EMAILS list at /app 436, isAdminEmail(), cwProfile.status !== "verified"). Protection of caseworkers (name, phone, agency, googleEmail), room, reports, posts/*/private/contact and lockers depends entirely on rules not visible here. A code comment says "the database enforces the same numbers".
  confirm_by: Review firestore.rules for that project, especially that only verified caseworkers can read room/questions and only admins can read caseworkers, reports and private/contact.

- id: U-004
  area: email delivery
  suspicion: No email notification may be configured for Netlify forms able-forms / caseworker-signup. In that case meeting, certification, event, suggestion and caseworker sign-ups never reach an inbox (Firestore has no email path).
  confirm_by: Netlify UI -> Project configuration -> Notifications -> Form submission notifications (not exposed by the MCP tools).

- id: U-005
  area: Formspree
  suspicion: Formspree form maqllayw (homepage Join + Contact) may be inactive, unverified, or over quota.
  confirm_by: Formspree dashboard for maqllayw (formspree.io is blocked from this sandbox).

- id: U-006
  area: contact address
  suspicion: hello@ableexperience.org is the fallback in every form error alert and on the directory and donate pages, but the admin page says the inbox is ablelivingexperience.org@gmail.com. The domain may have no mailbox or MX.
  confirm_by: dig MX ableexperience.org and send a test message (DNS lookups were not permitted in this sandbox).

- id: U-007
  area: Facebook login
  suspicion: The Facebook provider (App ID 2908373292842968) may not be enabled in Firebase Auth, which would make the Facebook buttons on the directory fail.
  confirm_by: Firebase console -> Authentication -> Sign-in method.

- id: U-008
  area: homepage QR code
  suspicion: QR rendering depends on cdnjs qrcodejs 1.0.0. In the sandbox it failed only because cdnjs is blocked ("ReferenceError: QRCode is not defined"). The target URL (/ABLE_Resource_Directory.html) does 301 to /able_resource_directory, which is OK.
  confirm_by: Load / in a normal browser and scan the code.
```

# NOT_CHECKED

```yaml
- item: Third-party hosts (www.gstatic.com Firebase SDKs, cdnjs (qrcode, leaflet), firestore.googleapis.com, formspree.io, fonts.googleapis.com, tile.openstreetmap.org, facebook.com, renoinitiative.org)
  reason: host blocked by the sandbox proxy (ERR_TUNNEL_CONNECTION_FAILED). Firestore and Formspree requests were also deliberately aborted by the auditor.
- item: ~950 outbound links (782 Google Maps, ~150 other hosts incl. washoecounty.gov, renown.org, nevada211.org, news sites on the 411 pages)
  reason: host blocked; link rot was not tested.
- item: http:// -> https:// redirect on apex
  reason: proxy could not resolve plain-http requests.
- item: DNS / MX / SPF for ableexperience.org
  reason: not permitted in this session.
- item: Signed-in flows (directory verify/edit/claim, /admin dashboard, /app caseworker, admin, board, chats, locker)
  reason: out of scope by instruction (no sign-in, no writes). Reviewed by code reading only.
- item: Firestore data and rules (both projects)
  reason: forbidden by instruction. See U-001..U-003.
- item: Netlify form notification settings
  reason: not exposed by the read-only MCP tools.
- item: Color contrast measurement, keyboard-trap testing of modals
  reason: not instrumented. Directory modals close on backdrop click and the x button; no automated contrast scan was run.
- item: /app Give & Need map, chats, locker runtime behaviour
  reason: needs the Firebase SDK (blocked) and anonymous sign-in (would write to the backend).
```

# INVENTORY

## Pages (HTTP 200)

```yaml
pages:
  - https://ableexperience.org/                      # also /index.html, both *.netlify.app hosts; www -> 301 apex
  - https://ableexperience.org/able_resource_directory   # also .html; /ABLE_Resource_Directory(.html) -> 301 here
  - https://ableexperience.org/the-411
  - https://ableexperience.org/the-411-coordinated-entry
  - https://ableexperience.org/the-411-psh-nevada
  - https://ableexperience.org/the-411-rep-payee-gap
  - https://ableexperience.org/schedule
  - https://ableexperience.org/suggestions
  - https://ableexperience.org/donate
  - https://ableexperience.org/certification
  - https://ableexperience.org/events-pricing
  - https://ableexperience.org/app                   # PWA "The Can't Be Reached App"; caseworker + admin live here as #cw and #admin hash routes
  - https://ableexperience.org/admin                 # not in sitemap; linked from footers; robots Disallow
  - https://ableexperience.org/help/
  - https://ableexperience.org/help/{children-family,clothing-supplies,dental,disability,domestic-violence,food,hospice-palliative,housing-shelter,insurance,jobs,legal,medical-health,mental-health,seniors,substance-use,transportation,veterans}
other_files_200: [robots.txt, sitemap.xml, app-sw.js, app.webmanifest, app-icon-180.png, app-icon-192.png, app-icon-512.png, able-logo.png, able_logo.png, able-bobby.jpg, able-capitol.jpg, able-conference.jpg, able-housing-meeting.jpg, able-speaking.jpg, able-team-flowers.jpg, team-community.jpg, docs/LEAB-Coordinated-Entry-Focus-Group-Results-2024.pdf]
probed_404: [/caseworker, /caseworker.html, /caseworkers, /caseworker-app, /portal, /login, /login.html, /dashboard, /signup, /privacy, /privacy.html, /terms, /about, /contact, /favicon.ico, /manifest.json, /manifest.webmanifest, /site.webmanifest, /sw.js, /service-worker.js, /_redirects, /_headers, /netlify.toml, /firebase.json, /.well-known/security.txt, /humans.txt, /404.html, /app-icon-512-maskable.png]
first_party_js: all inline (no first-party .js files except /app-sw.js). No first-party CSS files.
third_party_scripts: [gstatic firebasejs 10.7.1 compat (directory, admin), gstatic firebasejs 10.12.2 modular (app, dynamic import), cdnjs qrcodejs 1.0.0 (index), cdnjs leaflet 1.9.4 with SRI (app), Google Fonts css (app)]
```

## Forms

```yaml
forms:
  - page: /            name: join-form (id)       fields: firstName,lastName,email,phone,role,message
    destination: POST https://formspree.io/f/maqllayw (JSON, Accept: application/json); success when response JSON ok; failure -> alert(); NOT Netlify, NOT Firestore
  - page: /            name: contact-form (id)    fields: name,email,subject,message
    destination: same Formspree form maqllayw
  - page: /schedule    name: (none, JS)           fields: m-name,m-org,m-email,m-phone,m-format,m-date,m-topic -> mapped to form,name,org,email,phone,subject,message
    destination: Firestore REST POST able-website-ec33b/submissions (authoritative, success shown only if this saves) + Netlify POST "/" form-name=able-forms (fire-and-forget, errors swallowed); novalidate, no JS validation (F-006)
  - page: /suggestions name: suggestion-form      fields: name,email,phone,category,subject,message,(anon checkbox)
    destination: Firestore submissions + Netlify able-forms (same ableSubmit); JS validates category + message
  - page: /certification name: (none, JS)         fields: c-contact,c-title,c-org,c-email,c-phone,c-type,c-years,c-mission,c-homeless,c-why
    destination: Firestore submissions + Netlify able-forms; novalidate, no JS validation
  - page: /events-pricing name: (none, JS)        fields: e-name,e-org,e-email,e-phone,e-type,e-date,e-location,e-audience,e-details
    destination: Firestore submissions + Netlify able-forms; novalidate, no JS validation
  - page: /schedule,/suggestions,/certification,/events-pricing  name: able-forms (hidden detection form)
    fields: form,name,email,phone,org,subject,message,createdAt,page,bot-field   # matches Netlify-registered fields
  - page: /app         name: caseworker-signup (hidden detection form) + #cwf (rendered after Google sign-in)
    fields: name,agency,title,phone,email (+ googleEmail, uid added by JS)   # matches Netlify-registered fields
    destination: Firestore (the-can-t-be-reached-app) caseworkers/{uid} setDoc (authoritative) + Netlify POST form-name=caseworker-signup (fire-and-forget, .catch(() => {}))
  - page: /app         other JS forms: qf (search, local only), pf (Give&Need post), ansf (answer), repf (report), qf2 (ask a caseworker), cf/rf (chat/room), lo/nlf (locker)
    destination: Firestore the-can-t-be-reached-app (posts, chats, questions, reports, room, lockers); not exercised
  - page: /able_resource_directory  edit-modal + verify/claim (no <form>)
    destination: Firestore able-website-ec33b resources (update), verifications (add), claims (add); verify also opens a mailto: to hello@ableexperience.org
netlify_registered_forms_without_live_markup: [contact, join-interest, suggestions, schedule-notify]   # stale from an earlier deploy (F-005)
```
