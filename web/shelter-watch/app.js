/* Shelter Watch — page logic. Plain JS, no build step. */
(function () {
  const SW = self.ShelterWatch;
  const { schema, moderation, factcheck, ratings } = SW;
  const app = document.getElementById('app');
  const banner = document.getElementById('banner');

  const state = { facilities: [], comments: [], store: null, uid: null, filters: { q: '', group: '', pop: '', conf: '' } };

  const RELATIONSHIPS = [
    ['current_resident', 'I live there now'],
    ['former_resident', 'I used to live there'],
    ['family_or_friend', 'Family or friend of a resident'],
    ['staff', 'I work or worked there'],
    ['service_provider', 'Service provider / case manager'],
    ['other', 'Other'],
  ];
  const POPULATIONS = [
    ['men', /\bmen\b|\bmale|men's|men only/i],
    ['women', /women|female/i],
    ['families', /famil|children|parent/i],
    ['youth', /youth|18-24|18–24|young/i],
    ['veterans', /veteran/i],
    ['seniors', /senior|62\+|55\+|elder/i],
    ['disabilities', /disab/i],
    ['recovery', /recover|sober|substance/i],
    ['reentry', /reentry|re-entry|parole|incarcerat/i],
  ];
  const OPTION_LABELS = {
    yes: 'Yes', no: 'No', service_animals_only: 'Service animals only', restricted: 'Restricted',
    few: 'Few rules', moderate: 'Moderate', many: 'Many rules', individual: 'Individual', communal: 'Communal',
    both: 'Both', none: 'None', private: 'Private', partial: 'Partly', '24_7': '24/7',
    business_hours: 'Business hours', some: 'Some of the time', case_by_case: 'Case by case',
  };

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const optLabel = (v) => (v == null ? '—' : OPTION_LABELS[v] || v);
  const commentsFor = (id) => state.comments.filter((c) => c.facilityId === id);
  const safeUrl = (u) => {
    const t = String(u || '').trim();
    if (/^https?:\/\/[^\s]+$/i.test(t)) return t;
    if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s]*)?$/i.test(t)) return `https://${t}`;
    return null;
  };
  const fullAddress = (x) =>
    x.address && x.city && !x.address.toLowerCase().includes(x.city.toLowerCase()) ? `${x.address}, ${x.city}` : x.address || x.city;

  function scoreBadge(r) {
    return r.score == null
      ? `<span class="score none">Not enough reviews</span>`
      : `<span class="score" title="Claude Rating">${r.score}/100</span>`;
  }

  // ---------- List view ----------
  function renderList() {
    const f = state.filters;
    const groups = [...new Set(state.facilities.map((x) => x.group))].sort();
    const q = f.q.trim().toLowerCase();
    const popRe = (POPULATIONS.find((p) => p[0] === f.pop) || [])[1];
    const list = state.facilities.filter((x) => {
      if (f.group && x.group !== f.group) return false;
      if (f.conf && x.researchConfidence !== f.conf) return false;
      if (popRe && !popRe.test(`${x.population || ''} ${x.name}`)) return false;
      if (q && !`${x.name} ${x.operator || ''} ${x.address || ''} ${x.city || ''} ${x.category || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });

    app.innerHTML = `
      <div class="filters">
        <input class="search" type="search" id="q" placeholder="Search name, operator, street…" value="${esc(f.q)}" aria-label="Search">
        <select id="group" aria-label="Type"><option value="">All types</option>${groups
          .map((g) => `<option ${g === f.group ? 'selected' : ''}>${esc(g)}</option>`)
          .join('')}</select>
        <select id="pop" aria-label="Who it serves"><option value="">Anyone</option>${POPULATIONS.map(
          ([k]) => `<option value="${k}" ${k === f.pop ? 'selected' : ''}>${k[0].toUpperCase() + k.slice(1)}</option>`
        ).join('')}</select>
        <select id="conf" aria-label="Research confidence"><option value="">Any confidence</option>${['high', 'medium', 'low']
          .map((c) => `<option value="${c}" ${c === f.conf ? 'selected' : ''}>${c} confidence</option>`)
          .join('')}</select>
      </div>
      <p class="count">${list.length} of ${state.facilities.length} places</p>
      <div class="cards">${list
        .map((x) => {
          const cs = commentsFor(x.id);
          const r = ratings.claudeRating(x, cs);
          const n = cs.filter(moderation.isPublic).length;
          return `<a class="card" href="#/f/${encodeURIComponent(x.id)}">
            <h3>${esc(x.name)}</h3>
            <p class="meta">${esc(x.operator || 'Operator unknown')}${x.city ? ' · ' + esc(x.city) : ''}</p>
            <div class="row">${scoreBadge(r)}<span class="chip">${n} review${n === 1 ? '' : 's'}</span>
              <span class="chip">${esc(x.group)}</span><span class="chip ${esc(x.researchConfidence)}">${esc(
            x.researchConfidence
          )} confidence</span></div>
          </a>`;
        })
        .join('')}</div>`;

    ['q', 'group', 'pop', 'conf'].forEach((id) => {
      const el = document.getElementById(id);
      el.addEventListener(id === 'q' ? 'input' : 'change', () => {
        state.filters[id] = el.value;
        const pos = id === 'q' ? el.selectionStart : null;
        renderList();
        if (id === 'q') {
          const again = document.getElementById('q');
          again.focus();
          again.setSelectionRange(pos, pos);
        }
      });
    });
  }

  // ---------- Detail view ----------
  function renderDetail(id) {
    const x = state.facilities.find((f) => f.id === id);
    if (!x) {
      app.innerHTML = `<a class="back" href="#/">← All places</a><p>That listing wasn't found.</p>`;
      return;
    }
    const cs = commentsFor(x.id);
    const visible = cs.filter(moderation.isPublic).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const r = ratings.claudeRating(x, cs);
    const agg = ratings.aggregate(cs);
    const checks = factcheck.checkFacility(x, cs);
    const site = safeUrl(x.website);

    const row = (label, value) => (value == null || value === '' ? '' : `<dt>${label}</dt><dd>${value}</dd>`);
    const sources = x.sources
      .map(safeUrl)
      .filter(Boolean)
      .map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener nofollow">[${i + 1}]</a>`)
      .join(' ');

    app.innerHTML = `
      <a class="back" href="#/">← All places</a>
      <article class="detail">
        <h1>${esc(x.name)}</h1>
        <p class="meta">${esc(x.group)} · ${esc((x.category || '').replace(/_/g, ' '))}</p>

        <div class="grid2">
          <section class="panel">
            <h2>The basics</h2>
            <dl class="facts">
              ${row('Run by', esc(x.operator))}
              ${row('Who it serves', esc(x.population))}
              ${row('Address', esc(fullAddress(x)))}
              ${row('Phone', x.phone ? `<a href="tel:${esc(x.phone.replace(/[^\d+]/g, ''))}">${esc(x.phone)}</a>` : null)}
              ${row('Website', site ? `<a href="${esc(site)}" target="_blank" rel="noopener">${esc(site.replace(/^https?:\/\//, ''))}</a>` : null)}
              ${row('How to get in', esc(x.howToApply))}
              ${row('Units / beds', esc(x.units))}
              ${row('Cost', esc(x.rent))}
              ${row('Waitlist', esc(x.waitlist))}
              ${row('Status', esc(x.status))}
              ${row('Funding', esc(x.funding))}
              <dt>People in charge</dt><dd>Not yet researched. Only publicly listed leaders will be named.</dd>
            </dl>
            <p class="meta" style="margin-top:10px">Research confidence: <span class="chip ${esc(x.researchConfidence)}">${esc(
      x.researchConfidence
    )}</span> ${sources ? '· Sources ' + sources : ''}</p>
            ${x.researchNotes ? `<details><summary>Research notes</summary><p class="meta">${esc(x.researchNotes)}</p></details>` : ''}
          </section>

          <section class="panel">
            <h2>Claude Rating</h2>
            <p class="sub">An automated score, calculated the same way for every place. Every input is shown.</p>
            <div class="big-score">${r.score == null ? '—' : r.score + '<small style="font-size:1rem">/100</small>'}</div>
            <ul class="components">
              <li><span>What residents say (50%)</span><strong>${r.components.residents ?? '—'}</strong></li>
              <li><span>Fact checker (20%)</span><strong>${r.components.accountability ?? '—'}</strong></li>
              <li><span>Transparency (20%)</span><strong>${r.components.transparency ?? '—'}</strong></li>
              <li><span>Research quality (10%)</span><strong>${r.components.research}</strong></li>
            </ul>
            <ul class="explain">${r.explanation.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
          </section>
        </div>

        <section class="panel">
          <h2>What residents rate it</h2>
          <p class="sub">Support staff: <strong>${esc(ratings.demeanorLabel(agg.staff.average))}</strong> ·
            Management: <strong>${esc(ratings.demeanorLabel(agg.management.average))}</strong></p>
          ${schema.DIMENSIONS.map((d) => {
            const a = agg[d.key];
            const pct = a.average == null ? 0 : (a.average / 5) * 100;
            return `<div class="bar"><span>${esc(d.label)}</span><span class="track"><span class="fill" style="width:${pct}%"></span></span>
              <span>${a.average == null ? '—' : a.average + ' (' + a.count + ')'}</span></div>`;
          }).join('')}
        </section>

        <section class="panel">
          <h2>Fact checker</h2>
          <p class="sub">What the establishment says, what residents say (needs 3+ residents agreeing), and what independent evidence shows.</p>
          <div class="table-scroll"><table>
            <thead><tr><th>Fact</th><th>Establishment says</th><th>Residents say</th><th>Verified</th><th>Verdict</th></tr></thead>
            <tbody>${checks
              .map(
                (c) => `<tr><td>${esc(c.label)}</td><td>${esc(optLabel(c.establishment))}</td>
                <td>${esc(optLabel(c.residents))}${c.residentCount ? ` <span class="meta">(${c.residentCount})</span>` : ''}</td>
                <td>${esc(optLabel(c.verified))}</td><td class="v-${c.verdict}"><span title="${esc(c.verdictLabel)}">${esc(c.verdictLabel.split(' — ')[0])}</span></td></tr>`
              )
              .join('')}</tbody>
          </table></div>
        </section>

        <section class="panel">
          <h2>Reviews (${visible.length})</h2>
          ${visible.length ? '' : '<p class="meta">No reviews yet. Be the first.</p>'}
          ${visible
            .map(
              (c) => `<div class="comment">
                <div class="row"><span class="chip">${esc((RELATIONSHIPS.find((rl) => rl[0] === c.relationship) || [])[1] || 'Other')}</span>
                  <span class="meta">${esc(String(c.createdAt).slice(0, 10))}</span></div>
                <p>${esc(c.text)}</p>
                ${Object.keys(c.ratings || {}).length ? `<p class="meta">${Object.entries(c.ratings)
                  .map(([k, v]) => `${esc((schema.DIMENSIONS.find((d) => d.key === k) || {}).label || k)}: ${v}/5`)
                  .join(' · ')}</p>` : ''}
                ${(c.reports || []).includes(state.uid)
                  ? '<span class="meta">You reported this.</span>'
                  : `<button class="linkbtn" data-report="${esc(c.id)}">Report</button>`}
              </div>`
            )
            .join('')}
        </section>

        <section class="panel">
          <h2>Add your review</h2>
          <p class="sub">Good or bad, tell it like it is. Don't post phone numbers, emails, or private details about anyone. Reviews with those are held for a moderator.</p>
          <form id="review">
            <div class="field"><label for="rel">How do you know this place?</label>
              <select id="rel" name="relationship" required><option value="">Choose one…</option>${RELATIONSHIPS.map(
                ([k, l]) => `<option value="${k}">${l}</option>`
              ).join('')}</select></div>
            <div class="field"><label for="text">Your review</label>
              <textarea id="text" name="text" rows="5" minlength="${moderation.MIN_LENGTH}" maxlength="${moderation.MAX_LENGTH}" required></textarea></div>
            <fieldset><legend>Rate it (1 = worst, 5 = best, skip any)</legend><div class="rating-grid">
              ${schema.DIMENSIONS.map(
                (d) => `<label>${esc(d.label)}<select name="r_${d.key}"><option value="">Skip</option>${[5, 4, 3, 2, 1]
                  .map((n) => `<option>${n}</option>`)
                  .join('')}</select></label>`
              ).join('')}
            </div></fieldset>
            <fieldset><legend>What's it really like? (skip any you don't know)</legend><div class="rating-grid">
              ${schema.FACTS.filter((f) => f.options)
                .map(
                  (f) => `<label>${esc(f.label)}<select name="f_${f.key}"><option value="">Don't know</option>${f.options
                    .map((o) => `<option value="${o}">${esc(optLabel(o))}</option>`)
                    .join('')}</select></label>`
                )
                .join('')}
            </div></fieldset>
            <p id="form-msg" role="status"></p>
            <button class="primary" type="submit">Post review</button>
          </form>
        </section>
      </article>`;

    app.querySelectorAll('[data-report]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('Report this review? Three reports hide it until a moderator looks at it.')) return;
        await state.store.report(b.dataset.report, state.uid);
        state.comments = await state.store.listAll();
        renderDetail(x.id);
      })
    );

    document.getElementById('review').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const msg = document.getElementById('form-msg');
      const input = { facilityId: x.id, text: fd.get('text'), relationship: fd.get('relationship'), ratings: {}, facts: {} };
      schema.DIMENSIONS.forEach((d) => (input.ratings[d.key] = fd.get(`r_${d.key}`)));
      schema.RESIDENT_REPORTABLE.forEach((k) => (input.facts[k] = fd.get(`f_${k}`)));
      try {
        const prepared = moderation.prepareComment(input, { confidential: x.confidential });
        await state.store.add(prepared);
        state.comments = await state.store.listAll();
        renderDetail(x.id);
        const after = document.getElementById('form-msg');
        after.className = 'notice';
        after.textContent =
          prepared.status === 'held'
            ? `Thanks. Your review is held for a moderator: ${prepared.heldReasons.join(', ')}.`
            : 'Thanks. Your review is posted.';
        after.scrollIntoView({ block: 'center' });
      } catch (err) {
        msg.className = 'error';
        msg.textContent = err.message;
      }
    });
  }

  function route() {
    const m = location.hash.match(/^#\/f\/(.+)$/);
    if (m) renderDetail(decodeURIComponent(m[1]));
    else renderList();
    if (m) window.scrollTo(0, 0);
  }

  async function start() {
    try {
      const [res, store] = await Promise.all([fetch('facilities.json'), self.ShelterWatchStore.create()]);
      if (!res.ok) throw new Error(`facilities.json: HTTP ${res.status}`);
      state.facilities = (await res.json()).facilities;
      state.store = store;
      state.uid = await store.userId();
      state.comments = await store.listAll();
      if (store.mode === 'demo') {
        banner.innerHTML =
          '<p class="banner"><strong>Demo mode.</strong> Reviews are saved in this browser only and nobody else can see them. A Firebase config in config.js turns on shared reviews.</p>';
      }
      window.addEventListener('hashchange', route);
      route();
    } catch (err) {
      app.innerHTML = `<p class="error">Shelter Watch couldn't load: ${esc(err.message)}</p>`;
    }
  }

  start();
})();
