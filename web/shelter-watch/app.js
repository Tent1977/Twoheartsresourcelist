/* Shelter Watch — page logic. Plain JS, no build step. */
(function () {
  const SW = self.ShelterWatch;
  const { schema, moderation, factcheck, ratings } = SW;
  const app = document.getElementById('app');
  const banner = document.getElementById('banner');
  const srStatus = document.getElementById('sr-status');

  const GROUP_ORDER = ['Shelter', 'Transitional / Recovery', 'PSH / Public / HUD', 'Affordable / Low-cost'];
  const GROUP_LABELS = {
    Shelter: 'Shelter (tonight)',
    'Transitional / Recovery': 'Transitional & recovery housing',
    'PSH / Public / HUD': 'Supportive & public housing',
    'Affordable / Low-cost': 'Affordable rentals',
  };
  const WHO = [
    ['women', 'Women', /(^| )(women|womens|woman|female|females|mothers?)( |$)/],
    ['men', 'Men', /(^| )(men|mens|male|males)( |$)/],
    ['families', 'Families', /(^| )(famil\w*|children|child|parents?|parenting)( |$)/],
    ['youth', 'Youth', /(^| )(youth|young|teens?|18 24|12 17|minors?)( |$)/],
    ['veterans', 'Veterans', /(^| )veterans?( |$)/],
    ['seniors', 'Seniors', /(^| )(seniors?|elderly|62|55)( |$)/],
    ['disabilities', 'Disabilities', /(^| )disab\w*/],
    ['recovery', 'Recovery', /(^| )(recovery|sober|substance|addiction)( |$)/],
    ['reentry', 'Re-entry', /(^| )(reentry|re entry|parole|probation|incarcerat\w*|prison)( |$)/],
    ['dv', 'Domestic violence', /(^| )(domestic|dv|survivors?|family violence|abuse)( |$)/],
  ];
  const PETS = /(^| )(pets?|pet friendly|dogs?|cats?|animals?)( |$)/;
  const RELATIONSHIPS = [
    ['current_resident', 'I live there now'],
    ['former_resident', 'I used to live there'],
    ['family_or_friend', 'Family or friend of a resident'],
    ['staff', 'I work or worked there'],
    ['service_provider', 'Case manager or service provider'],
    ['other', 'Other'],
  ];
  const OPTION_LABELS = {
    yes: 'Yes', no: 'No', service_animals_only: 'Service animals only', restricted: 'Limited',
    few: 'Few rules', moderate: 'Some rules', many: 'Many rules', individual: 'Own kitchen', communal: 'Shared',
    both: 'Both', none: 'None', private: 'Private', partial: 'Partly', '24_7': '24/7',
    business_hours: 'Daytime only', some: 'Some of the time', case_by_case: 'Case by case',
  };
  const VERDICT_SHORT = {
    verified: 'Checked', contradicted: 'Wrong', disputed: 'Disputed', consistent: 'Agree',
    unverified: 'One side only', unknown: 'Unknown',
  };

  const state = {
    facilities: [],
    byId: new Map(),
    aliases: {},
    comments: [],
    store: null,
    myReview: null,
    filters: { q: '', type: '', who: '', pets: false, conf: '' },
    listScroll: 0,
    lastOpened: null,
    cameFromList: false,
  };

  // ---------- helpers ----------
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const optLabel = (v) => (v == null ? '—' : OPTION_LABELS[v] || v);
  const commentsFor = (id) => state.comments.filter((c) => c.facilityId === id);
  const safeUrl = (u) => {
    const t = String(u || '').trim();
    if (/^https?:\/\/[^\s<>"']+$/i.test(t)) return t;
    if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s<>"']*)?$/i.test(t)) return `https://${t}`;
    return null;
  };
  const fullAddress = (x) =>
    x.address && x.city && !x.address.toLowerCase().includes(x.city.toLowerCase()) ? `${x.address}, ${x.city}` : x.address || x.city;
  const say = (msg) => {
    srStatus.textContent = '';
    setTimeout(() => (srStatus.textContent = msg), 50);
  };
  const telLink = (p) =>
    `<a href="tel:${esc(p.number)}">${esc(p.display)}</a>${p.label ? ` <span class="meta">${esc(p.label)}</span>` : ''}`;

  function hydrate(f) {
    const facts = schema.emptyFacts();
    Object.entries(f.facts || {}).forEach(([k, v]) => {
      if (facts[k]) facts[k] = { establishment: v.establishment || null, verified: v.verified || null };
    });
    const full = {
      phones: [], sources: [], leadership: [], confidential: false, researchConfidence: 'low', establishmentAskedAt: null,
      ...f, facts,
    };
    full.searchText = schema.normalizeSearch(
      [full.name, full.operator, full.address, full.city, full.category, full.population, full.researchNotes, full.howToApply, full.group].join(' ')
    );
    full.whoText = schema.normalizeSearch(`${full.name} ${full.population || ''} ${full.category || ''}`);
    full.petText = schema.normalizeSearch(`${full.population || ''} ${full.researchNotes || ''} ${full.howToApply || ''}`);
    return full;
  }

  // ---------- URL <-> filters ----------
  function filtersToHash() {
    const f = state.filters;
    const p = new URLSearchParams();
    if (f.q) p.set('q', f.q);
    if (f.type) p.set('type', f.type);
    if (f.who) p.set('who', f.who);
    if (f.pets) p.set('pets', '1');
    if (f.conf) p.set('conf', f.conf);
    const s = p.toString();
    return s ? `#/?${s}` : '#/';
  }
  function hashToFilters(hash) {
    const q = hash.indexOf('?');
    const p = new URLSearchParams(q >= 0 ? hash.slice(q + 1) : '');
    state.filters = {
      q: (p.get('q') || '').slice(0, 200),
      type: GROUP_ORDER.includes(p.get('type')) ? p.get('type') : '',
      who: WHO.some((w) => w[0] === p.get('who')) ? p.get('who') : '',
      pets: p.get('pets') === '1',
      conf: ['high', 'medium', 'low'].includes(p.get('conf')) ? p.get('conf') : '',
    };
  }

  function filtered() {
    const f = state.filters;
    const words = schema.normalizeSearch(f.q).split(' ').filter(Boolean);
    const whoRe = (WHO.find((w) => w[0] === f.who) || [])[2];
    return state.facilities.filter((x) => {
      if (f.type && x.group !== f.type) return false;
      if (f.conf && x.researchConfidence !== f.conf) return false;
      if (whoRe && !whoRe.test(` ${x.whoText} `)) return false;
      if (f.pets && !PETS.test(` ${x.petText} `)) return false;
      return words.every((w) => x.searchText.includes(w));
    });
  }

  // ---------- List view ----------
  function renderListShell() {
    const f = state.filters;
    const chip = (attrs, label, pressed) =>
      `<button type="button" class="quick" ${attrs} aria-pressed="${pressed ? 'true' : 'false'}">${esc(label)}</button>`;
    app.innerHTML = `
      <h1 class="visually-hidden" tabindex="-1">Find shelter and housing</h1>
      <div class="quick-row" role="group" aria-label="Quick filters">
        ${chip('data-type="Shelter"', 'Need a bed tonight', f.type === 'Shelter')}
        ${WHO.filter((w) => ['women', 'men', 'families', 'youth', 'veterans', 'dv'].includes(w[0]))
          .map((w) => chip(`data-who="${w[0]}"`, w[1], f.who === w[0]))
          .join('')}
        ${chip('data-pets="1"', 'Mentions pets', f.pets)}
      </div>
      <div class="filters">
        <label class="search"><span class="visually-hidden">Search</span>
          <input type="search" id="q" placeholder="Search a name, street or need…" value="${esc(f.q)}" autocomplete="off"></label>
      </div>
      <details class="more-filters"${f.type || f.who || f.conf ? ' open' : ''}><summary>More filters</summary><div class="filters-more">
        <label><span class="visually-hidden">Type of place</span><select id="type"><option value="">All types</option>${GROUP_ORDER.map(
          (g) => `<option value="${esc(g)}" ${g === f.type ? 'selected' : ''}>${esc(GROUP_LABELS[g])}</option>`
        ).join('')}</select></label>
        <label><span class="visually-hidden">Who it serves</span><select id="who"><option value="">Anyone</option>${WHO.map(
          ([k, l]) => `<option value="${k}" ${k === f.who ? 'selected' : ''}>${esc(l)}</option>`
        ).join('')}</select></label>
        <label><span class="visually-hidden">How sure we are</span><select id="conf"><option value="">Any confidence</option>${['high', 'medium', 'low']
          .map((c) => `<option value="${c}" ${c === f.conf ? 'selected' : ''}>${c[0].toUpperCase() + c.slice(1)} confidence</option>`)
          .join('')}</select></label>
      </div></details>
      <p class="count" id="count" role="status"></p>
      <div class="cards" id="results"></div>`;

    const update = () => {
      history.replaceState(null, '', filtersToHash());
      renderResults();
    };
    document.getElementById('q').addEventListener('input', (e) => {
      state.filters.q = e.target.value;
      update();
    });
    ['type', 'who', 'conf'].forEach((id) =>
      document.getElementById(id).addEventListener('change', (e) => {
        state.filters[id] = e.target.value;
        syncChips();
        update();
      })
    );
    app.querySelectorAll('.quick').forEach((b) =>
      b.addEventListener('click', () => {
        if (b.dataset.type) state.filters.type = state.filters.type === b.dataset.type ? '' : b.dataset.type;
        if (b.dataset.who) state.filters.who = state.filters.who === b.dataset.who ? '' : b.dataset.who;
        if (b.dataset.pets) state.filters.pets = !state.filters.pets;
        document.getElementById('type').value = state.filters.type;
        document.getElementById('who').value = state.filters.who;
        syncChips();
        update();
      })
    );
    app.onclick = onResultsClick;
    renderResults();
  }

  function syncChips() {
    app.querySelectorAll('.quick').forEach((b) => {
      const on =
        (b.dataset.type && state.filters.type === b.dataset.type) ||
        (b.dataset.who && state.filters.who === b.dataset.who) ||
        (b.dataset.pets && state.filters.pets);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function onResultsClick(e) {
    if (e.target.closest('#clear-filters')) {
      state.filters = { q: '', type: '', who: '', pets: false, conf: '' };
      history.replaceState(null, '', '#/');
      renderListShell();
      document.getElementById('q').focus();
      return;
    }
    const open = e.target.closest('a[data-open]');
    if (open) {
      state.listScroll = window.scrollY;
      state.lastOpened = open.dataset.open;
      state.cameFromList = true;
    }
  }

  function renderResults() {
    const list = filtered();
    const total = state.facilities.length;
    document.getElementById('count').textContent = `${list.length} of ${total} places`;
    const results = document.getElementById('results');
    if (!list.length) {
      results.innerHTML = `<div class="empty"><p><strong>No places match.</strong></p>
        <p><button type="button" class="secondary" id="clear-filters">Clear filters</button>
        or call <a href="tel:211">211</a> — they can check who has space today.</p></div>`;
      return;
    }
    results.innerHTML = list
      .map((x) => {
        const cs = commentsFor(x.id);
        const r = ratings.claudeRating(x, cs);
        const n = cs.filter(moderation.isPublic).length;
        const call = x.phones[0];
        return `<article class="card">
          <h2 class="card-title"><a href="#/f/${encodeURIComponent(x.id)}" data-open="${esc(x.id)}">${esc(x.name)}</a></h2>
          <p class="meta">${esc(GROUP_LABELS[x.group] || x.group)}${x.city ? ' · ' + esc(x.city) : ''}${
            x.status && !/^(open|active)/i.test(x.status) ? ` · <strong>${esc(String(x.status).split(/[;(]/)[0].trim())}</strong>` : ''
          }</p>
          ${call ? `<a class="call-btn" href="tel:${esc(call.number)}" aria-label="Call ${esc(x.name)} at ${esc(call.display)}">Call ${esc(call.display)}</a>` : ''}
          ${x.population ? `<p class="meta who">${esc(String(x.population).slice(0, 110))}</p>` : ''}
          <div class="row">
            ${r.score == null ? `<span class="score none">No score yet</span>` : `<span class="score">Claude Rating ${r.score}/100</span>`}
            <span class="chip">${n} review${n === 1 ? '' : 's'}</span>
            <span class="chip conf-${esc(x.researchConfidence)}">${esc(x.researchConfidence)} confidence</span>
          </div>
        </article>`;
      })
      .join('');
  }

  function showList(fromHash) {
    hashToFilters(fromHash);
    document.title = 'Shelter Watch — Washoe County shelter & housing';
    renderListShell();
    if (state.lastOpened) {
      window.scrollTo(0, state.listScroll);
      const link = app.querySelector(`a[data-open="${CSS.escape(state.lastOpened)}"]`);
      if (link) link.focus({ preventScroll: true });
      state.lastOpened = null;
    } else {
      window.scrollTo(0, 0);
    }
  }

  // ---------- Detail view ----------
  async function showDetail(rawId) {
    let id;
    try {
      id = decodeURIComponent(rawId);
    } catch (e) {
      id = null;
    }
    if (id && !state.byId.has(id) && typeof state.aliases[id] === 'string') {
      history.replaceState(null, '', `#/f/${encodeURIComponent(state.aliases[id])}`);
      id = state.aliases[id];
    }
    const x = id && state.byId.get(id);
    if (!x) {
      document.title = 'Not found — Shelter Watch';
      app.innerHTML = `<h1 tabindex="-1">We couldn't find that place</h1>
        <p>The link may be old or mistyped.</p>
        <p><a href="#/">See all places</a> or call <a href="tel:211">211</a> for help finding shelter.</p>`;
      app.querySelector('h1').focus();
      return;
    }
    document.title = `${x.name} — Shelter Watch`;
    state.myReview = null;
    if (state.store) {
      try {
        state.myReview = await state.store.myReview(x.id);
      } catch (e) {
        state.myReview = null;
      }
    }
    renderDetail(x);
    window.scrollTo(0, 0);
    app.querySelector('h1').focus({ preventScroll: true });
    if (state.store && state.store.mode === 'live') {
      try {
        const fresh = await state.store.listFor(x.id);
        state.comments = [...state.comments.filter((c) => c.facilityId !== x.id), ...fresh];
        if (location.hash.startsWith(`#/f/${encodeURIComponent(x.id)}`)) refreshDetailSections(x, { form: false });
      } catch (e) {
        /* keep what we have */
      }
    }
  }

  function basicsPanel(x) {
    const site = safeUrl(x.website);
    const row = (label, value) => (value == null || value === '' ? '' : `<dt>${label}</dt><dd>${value}</dd>`);
    const sources = x.sources
      .map(safeUrl)
      .filter(Boolean)
      .map((u, i) => `<a class="src" href="${esc(u)}" target="_blank" rel="noopener noreferrer nofollow">${i + 1}</a>`)
      .join(' ');
    return `<section class="panel" aria-labelledby="h-basics">
      <h2 id="h-basics">The basics</h2>
      <dl class="facts">
        ${row('Run by', esc(x.operator))}
        ${row('Who it serves', esc(x.population))}
        ${row('Address', esc(fullAddress(x)))}
        ${row('Phone', x.phones.length ? x.phones.map(telLink).join('<br>') : esc(x.phone))}
        ${row('Website', site ? `<a href="${esc(site)}" target="_blank" rel="noopener noreferrer">${esc(site.replace(/^https?:\/\//, ''))}</a>` : null)}
        ${row('How to get in', esc(x.howToApply))}
        ${row('Beds / units', esc(x.units))}
        ${row('Cost', esc(x.rent))}
        ${row('Waitlist', esc(x.waitlist))}
        ${row('Status', esc(x.status))}
        ${row('Funding', esc(x.funding))}
        <dt>People in charge</dt><dd>Not researched yet. We only name leaders the place lists publicly.</dd>
      </dl>
      <p class="meta mt">How sure we are about this listing: <span class="chip conf-${esc(x.researchConfidence)}">${esc(
        x.researchConfidence
      )}</span>${sources ? ` · Sources: ${sources}` : ''}</p>
      ${x.researchNotes ? `<details><summary>Research notes</summary><p class="meta">${esc(x.researchNotes)}</p></details>` : ''}
    </section>`;
  }

  function ratingPanel(x, cs) {
    const r = ratings.claudeRating(x, cs);
    const c = r.components;
    return `<section class="panel" aria-labelledby="h-rating">
      <h2 id="h-rating">Claude Rating</h2>
      <p class="sub">A score worked out by a formula, the same way for every place. Here is everything that goes into it.</p>
      <p class="big-score">${r.score == null ? 'No score yet' : `${r.score}<small>/100</small>`}</p>
      <ul class="components">
        <li><span>What residents say (half)</span><strong>${c.residents ?? '—'}</strong></li>
        <li><span>Fact check (one fifth)</span><strong>${c.accountability ?? '—'}</strong></li>
        <li><span>Openness (one fifth)</span><strong>${c.transparency ?? '—'}</strong></li>
        <li><span>Our research (one tenth)</span><strong>${c.research}</strong></li>
      </ul>
      <ul class="explain">${r.explanation.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
    </section>`;
  }

  function residentsPanel(cs) {
    const agg = ratings.aggregate(cs);
    return `<section class="panel" aria-labelledby="h-res">
      <h2 id="h-res">What residents say</h2>
      <p class="sub">Support staff: <strong>${esc(ratings.demeanorLabel(agg.staff.average))}</strong> ·
        Management: <strong>${esc(ratings.demeanorLabel(agg.management.average))}</strong><br>
        Scores are out of 5. Only residents and their family or friends count. Staff reviews are shown but not counted.</p>
      <ul class="bars">${schema.DIMENSIONS.map((d) => {
        const a = agg[d.key];
        const pct = a.average == null ? 0 : Math.max(0, Math.min(100, (a.average / 5) * 100));
        const text = a.average == null ? 'no ratings yet' : `${a.average} out of 5 (${a.count} ${a.count === 1 ? 'person' : 'people'})`;
        return `<li class="bar"><span>${esc(d.label)}</span><span class="track" aria-hidden="true"><span class="fill" data-pct="${pct}"></span></span><span class="val">${esc(text)}</span></li>`;
      }).join('')}</ul>
    </section>`;
  }

  function factPanel(x, cs) {
    const checks = factcheck.checkFacility(x, cs);
    return `<section class="panel" aria-labelledby="h-facts">
      <h2 id="h-facts">Fact check</h2>
      <p class="sub">What the place says, what residents say (needs 3 or more residents agreeing), and what we can prove.</p>
      <div class="table-scroll"><table>
        <caption class="visually-hidden">Fact check for ${esc(x.name)}</caption>
        <thead><tr><th scope="col">Question</th><th scope="col">The place says</th><th scope="col">Residents say</th><th scope="col">Proof</th><th scope="col">Result</th></tr></thead>
        <tbody>${checks
          .map(
            (c) => `<tr><th scope="row">${esc(c.label)}</th><td>${esc(optLabel(c.establishment))}</td>
              <td>${esc(optLabel(c.residents))}${c.residentCount ? ` <span class="meta">(${c.residentCount} said)</span>` : ''}</td>
              <td>${esc(optLabel(c.verified))}</td><td class="v-${esc(c.verdict)}">${esc(VERDICT_SHORT[c.verdict])}</td></tr>`
          )
          .join('')}</tbody>
      </table></div>
      <details><summary>What the results mean</summary><dl class="facts">${Object.entries(factcheck.VERDICTS)
        .map(([k, v]) => `<dt class="v-${k}">${esc(VERDICT_SHORT[k])}</dt><dd>${esc(v.split(' — ')[1])}</dd>`)
        .join('')}</dl></details>
    </section>`;
  }

  function reviewsPanel(x, cs) {
    const visible = cs.filter(moderation.isPublic).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const mine = state.myReview && state.myReview.id;
    return `<section class="panel" aria-labelledby="h-reviews">
      <h2 id="h-reviews">Reviews (${visible.length})</h2>
      ${visible.length ? '' : '<p class="meta">No reviews yet.</p>'}
      ${visible
        .map((c) => {
          const rel = (RELATIONSHIPS.find((r) => r[0] === c.relationship) || [])[1] || 'Other';
          const rs = moderation.sanitizeRatings(c.ratings);
          let reportUi = '';
          if (mine && c.id === mine) reportUi = '<span class="meta">Your review</span>';
          else if (state.store && state.store.hasReported(c.id)) reportUi = '<span class="meta">You reported this.</span>';
          else if (state.store && c.id) reportUi = `<button type="button" class="linkbtn" data-report="${esc(c.id)}">Report</button>`;
          return `<article class="comment">
            <div class="row"><span class="chip">${esc(rel)}</span><span class="meta">${esc(String(c.createdAt).slice(0, 10))}</span></div>
            <p class="comment-text">${esc(c.text)}</p>
            ${Object.keys(rs).length ? `<p class="meta">${Object.entries(rs)
              .map(([k, v]) => `${esc(schema.DIMENSIONS.find((d) => d.key === k).label)}: ${v}/5`)
              .join(' · ')}</p>` : ''}
            <div class="report-ui">${reportUi}</div>
          </article>`;
        })
        .join('')}
    </section>`;
  }

  function formPanel(x) {
    if (!state.store) {
      return `<section class="panel" id="review"><h2>Add your review</h2><p>Reviews can't be posted right now. Please try again later.</p></section>`;
    }
    if (state.myReview) {
      return `<section class="panel" id="review"><h2>Add your review</h2><p>You already reviewed this place. Thank you.</p></section>`;
    }
    const sel = (name, options, blank, id) =>
      `<select name="${name}"${id ? ` id="${id}"` : ''}><option value="">${blank}</option>${options
        .map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`)
        .join('')}</select>`;
    const stars = [5, 4, 3, 2, 1].map((n) => [n, `${n}${n === 5 ? ' — best' : n === 1 ? ' — worst' : ''}`]);
    return `<section class="panel" aria-labelledby="h-form" id="review">
      <h2 id="h-form">Add your review</h2>
      <p class="sub">Good or bad, tell it like it is. Don't post phone numbers, emails, or anyone's private details. Reviews with those wait for a moderator.
      ${x.confidential ? '<br><strong>This is a confidential safe place.</strong> A moderator checks reviews here first. Never mention where it is.' : ''}</p>
      <form id="review-form" novalidate>
        <div class="field"><label for="rel">How do you know this place? <span class="req">(required)</span></label>
          <select id="rel" name="relationship" required><option value="">Choose one…</option>${RELATIONSHIPS.map(
            ([k, l]) => `<option value="${k}">${esc(l)}</option>`
          ).join('')}</select></div>
        <div class="field"><label for="text">Your review <span class="req">(required)</span></label>
          <textarea id="text" name="text" rows="5" maxlength="${moderation.MAX_LENGTH}" required aria-describedby="text-hint"></textarea>
          <span class="meta" id="text-hint">At least ${moderation.MIN_LENGTH} characters.</span></div>
        <div class="field"><label for="r_recommend">Would you recommend it?</label>
          ${sel('r_recommend', stars, 'Skip', 'r_recommend')}</div>
        <details><summary>Rate more things (optional)</summary><div class="rating-grid">
          ${schema.DIMENSIONS.filter((d) => d.key !== 'recommend')
            .map((d) => `<label>${esc(d.label)}${sel(`r_${d.key}`, stars, 'Skip')}</label>`)
            .join('')}
        </div></details>
        <details><summary>What's it really like? (optional)</summary><div class="rating-grid">
          ${schema.FACTS.filter((f) => f.options)
            .map((f) => `<label>${esc(f.label)}${sel(`f_${f.key}`, f.options.map((o) => [o, optLabel(o)]), "Don't know")}</label>`)
            .join('')}
        </div></details>
        <p id="form-msg" class="form-msg" tabindex="-1"></p>
        <button class="primary" type="submit">Post review</button>
      </form>
    </section>`;
  }

  function renderDetail(x) {
    const cs = commentsFor(x.id);
    const callButtons = x.phones
      .slice(0, 2)
      .map((p) => `<a class="call-btn big" href="tel:${esc(p.number)}">Call ${esc(p.display)}${p.label ? ` <small>${esc(p.label)}</small>` : ''}</a>`)
      .join('');
    app.innerHTML = `
      <nav class="crumbs" aria-label="Breadcrumb"><a href="#/" id="back">← All places</a></nav>
      <article class="detail">
        <h1 tabindex="-1">${esc(x.name)}</h1>
        <p class="meta">${esc(GROUP_LABELS[x.group] || x.group)} · ${esc((x.category || '').replace(/_/g, ' '))}</p>
        <div class="actions">${callButtons}<a class="secondary" href="#review" id="jump-review">Write a review</a></div>
        <div class="grid2">${basicsPanel(x)}<div id="rating-slot">${ratingPanel(x, cs)}</div></div>
        <div id="res-slot">${residentsPanel(cs)}</div>
        <div id="facts-slot">${factPanel(x, cs)}</div>
        <div id="reviews-slot">${reviewsPanel(x, cs)}</div>
        <div id="form-slot">${formPanel(x)}</div>
      </article>`;
    wireDetail(x);
  }

  function refreshDetailSections(x, { form = true } = {}) {
    const cs = commentsFor(x.id);
    document.getElementById('rating-slot').innerHTML = ratingPanel(x, cs);
    document.getElementById('res-slot').innerHTML = residentsPanel(cs);
    document.getElementById('facts-slot').innerHTML = factPanel(x, cs);
    document.getElementById('reviews-slot').innerHTML = reviewsPanel(x, cs);
    if (form) document.getElementById('form-slot').innerHTML = formPanel(x);
    wireDetail(x);
  }

  function wireDetail(x) {
    app.onclick = null;
    // Bar widths are set from script because the page's security policy blocks inline styles.
    app.querySelectorAll('.fill[data-pct]').forEach((el) => {
      el.style.width = `${Number(el.dataset.pct) || 0}%`;
    });
    document.getElementById('back').onclick = (e) => {
      if (state.cameFromList) {
        e.preventDefault();
        history.back();
      }
    };
    document.getElementById('jump-review').onclick = (e) => {
      e.preventDefault();
      const target = document.getElementById('review');
      target.scrollIntoView({ block: 'start' });
      const first = target.querySelector('select, textarea');
      if (first) first.focus({ preventScroll: true });
    };

    document.getElementById('reviews-slot').onclick = async (e) => {
      const btn = e.target.closest('[data-report]');
      const yes = e.target.closest('[data-confirm-report]');
      const no = e.target.closest('[data-cancel-report]');
      if (btn) {
        const box = btn.parentElement;
        box.innerHTML = `<span>Report this review? It's hidden after 3 people report it.</span>
          <button type="button" class="secondary small" data-confirm-report="${esc(btn.dataset.report)}">Yes, report</button>
          <button type="button" class="linkbtn" data-cancel-report>Cancel</button>`;
        box.querySelector('[data-confirm-report]').focus();
      } else if (no) {
        refreshDetailSections(x, { form: false });
      } else if (yes) {
        const id = yes.dataset.confirmReport;
        yes.disabled = true;
        yes.textContent = 'Sending…';
        try {
          await state.store.report(id);
          if (state.store.mode === 'live') {
            state.comments = state.comments.map((c) => (c.id === id ? moderation.addReport(c) : c));
          } else {
            state.comments = await state.store.listAll();
          }
          refreshDetailSections(x, { form: false });
          say('Thanks. Your report was sent.');
        } catch (err) {
          yes.disabled = false;
          yes.textContent = 'Yes, report';
          yes.insertAdjacentHTML('afterend', `<span class="error"> ${esc(err.message)}</span>`);
          say(err.message);
        }
      }
    };

    const form = document.getElementById('review-form');
    if (!form) return;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]');
      if (btn.disabled) return;
      const fd = new FormData(form);
      const msg = document.getElementById('form-msg');
      const input = { facilityId: x.id, text: fd.get('text'), relationship: fd.get('relationship'), ratings: {}, facts: {} };
      schema.DIMENSIONS.forEach((d) => (input.ratings[d.key] = fd.get(`r_${d.key}`)));
      schema.RESIDENT_REPORTABLE.forEach((k) => (input.facts[k] = fd.get(`f_${k}`)));
      let prepared;
      try {
        prepared = moderation.prepareComment(input, { confidential: x.confidential, allowNumbers: x.phones.map((p) => p.number) });
      } catch (err) {
        msg.className = 'form-msg error';
        msg.textContent = err.message;
        msg.focus();
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Posting…';
      try {
        const saved = await state.store.add(prepared);
        state.comments.push(saved);
        state.myReview = { id: saved.id };
        refreshDetailSections(x);
        const text =
          prepared.status === 'held'
            ? `Thanks. Your review was saved and is waiting for a moderator (${prepared.heldReasons.join('; ').toLowerCase()}).`
            : 'Thanks. Your review is posted.';
        document.getElementById('form-slot').insertAdjacentHTML('afterbegin', `<p class="panel notice" id="posted-msg" tabindex="-1">${esc(text)}</p>`);
        document.getElementById('posted-msg').focus();
        say(text);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Post review';
        msg.className = 'form-msg error';
        msg.textContent = err.message;
        msg.focus();
      }
    };
  }

  // ---------- routing ----------
  function route() {
    const h = location.hash || '#/';
    const m = h.match(/^#\/f\/([^/?#]+)/);
    if (m) {
      showDetail(m[1]);
    } else {
      showList(h);
      state.cameFromList = false;
    }
  }

  async function start() {
    let data;
    try {
      const res = await fetch('facilities.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (err) {
      app.innerHTML = `<h1 tabindex="-1">Shelter Watch couldn't load</h1>
        <p>Check your connection and <a href="">try again</a>. For shelter help right now, call <a href="tel:211">211</a>.</p>`;
      return;
    }
    const rank = (g) => GROUP_ORDER.indexOf(g) + 1 || 99;
    // Open places first; planned, under construction, closed or temporary ones last.
    const CATEGORY_ORDER = ['emergency_shelter', 'family_shelter', 'seasonal_overflow', 'youth_shelter', 'dv_shelter', 'safe_camp/sanctioned_camp', 'motel_voucher'];
    const catRank = (c) => (CATEGORY_ORDER.indexOf(c) + 1) || 50;
    const statusRank = (st) => {
      const v = String(st || '').toLowerCase();
      if (/planned|construction|closed|temporar|ended|evacuation/.test(v)) return 2;
      return /^(open|active)/.test(v) ? 0 : 1;
    };
    state.facilities = (Array.isArray(data.facilities) ? data.facilities : [])
      .filter((f) => f && f.id && f.name)
      .map(hydrate)
      .sort((a, b) => rank(a.group) - rank(b.group) || statusRank(a.status) - statusRank(b.status) || catRank(a.category) - catRank(b.category) || a.name.localeCompare(b.name));
    state.facilities.forEach((f) => state.byId.set(f.id, f));
    state.aliases = data.aliases && typeof data.aliases === 'object' ? data.aliases : {};

    try {
      state.store = await self.ShelterWatchStore.create();
      state.comments = await state.store.listAll();
    } catch (err) {
      state.store = null;
      state.comments = [];
      banner.innerHTML = '<p class="banner">Reviews are unavailable right now. Listings still work.</p>';
    }
    if (state.store && state.store.mode === 'demo') {
      banner.innerHTML = state.store.persistent
        ? '<p class="banner"><strong>Test version.</strong> Reviews you post are saved only on this device. Nobody else can see them yet.</p>'
        : "<p class=\"banner\"><strong>Test version.</strong> This browser isn't saving data, so reviews disappear when you close the page.</p>";
    }
    window.addEventListener('hashchange', route);
    route();
  }

  start();
})();
