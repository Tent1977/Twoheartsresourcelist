/**
 * Shelter Watch review storage.
 *
 * With a Firebase config in config.js, reviews live in Firestore (see
 * firestore.rules for the data model). Without one the page runs in DEMO
 * MODE: reviews are kept in this browser only and nobody else sees them.
 *
 * Every store returns reviews already passed through moderation.sanitizeStored,
 * so a corrupted or hostile record can't break or hijack the page.
 */
(function (root) {
  const COLLECTION = 'shelterwatch_comments';
  const FIREBASE_VERSION = '10.12.2';
  const LIST_LIMIT = 2000;

  const moderation = () => root.ShelterWatch.moderation;
  const sanitizeAll = (list) => (Array.isArray(list) ? list : []).map((c) => moderation().sanitizeStored(c)).filter(Boolean);

  function safeStorage() {
    try {
      const k = '__sw_test__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return localStorage;
    } catch (e) {
      return null;
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(s);
    });
  }

  // ---------- Demo (browser-only) store ----------
  function demoStore() {
    const KEY = 'shelterwatch_demo_comments';
    const REPORTED = 'shelterwatch_demo_reported';
    const ls = safeStorage();
    const readJson = (key, fallback) => {
      if (!ls) return fallback;
      try {
        const v = JSON.parse(ls.getItem(key));
        return v == null ? fallback : v;
      } catch (e) {
        return fallback;
      }
    };
    const writeJson = (key, value) => {
      if (!ls) return false;
      try {
        ls.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        return false;
      }
    };
    let memory = sanitizeAll(readJson(KEY, []));
    let reported = readJson(REPORTED, []);
    if (!Array.isArray(reported)) reported = [];
    let uid = ls && ls.getItem('shelterwatch_uid');
    if (!uid) {
      uid = `demo-${Math.random().toString(36).slice(2)}`;
      if (ls) ls.setItem('shelterwatch_uid', uid);
    }

    return {
      mode: 'demo',
      persistent: Boolean(ls),
      async listAll() {
        return memory.slice();
      },
      async listFor(facilityId) {
        return memory.filter((c) => c.facilityId === facilityId);
      },
      async myReview(facilityId) {
        return memory.find((c) => c.facilityId === facilityId && c.authorKey === uid) || null;
      },
      hasReported(id) {
        return reported.includes(id);
      },
      async add(comment) {
        if (memory.some((c) => c.facilityId === comment.facilityId && c.authorKey === uid)) {
          throw new Error('You already reviewed this place.');
        }
        const saved = moderation().sanitizeStored({
          ...comment,
          id: `d${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
          authorKey: uid,
        });
        const next = [...memory, saved];
        if (ls && !writeJson(KEY, next)) throw new Error('Your phone is out of storage space, so the review was not saved.');
        memory = next;
        return saved;
      },
      async report(id) {
        if (reported.includes(id)) return;
        memory = memory.map((c) => (c.id === id ? moderation().addReport(c) : c));
        reported = [...reported, id];
        writeJson(KEY, memory);
        writeJson(REPORTED, reported);
      },
    };
  }

  // ---------- Firestore store ----------
  async function firestoreStore(config) {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
    await loadScript(`${base}/firebase-app-compat.js`);
    await loadScript(`${base}/firebase-auth-compat.js`);
    await loadScript(`${base}/firebase-firestore-compat.js`);
    const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(config);
    const auth = app.auth();
    if (!auth.currentUser) await auth.signInAnonymously();
    const db = app.firestore();
    const col = db.collection(COLLECTION);
    const ts = () => firebase.firestore.FieldValue.serverTimestamp();
    const toPlain = (d) => {
      const data = d.data();
      const created = data.createdAt && data.createdAt.toDate ? data.createdAt.toDate().toISOString() : data.createdAt;
      return { ...data, id: d.id, createdAt: created };
    };
    const reportedKey = `shelterwatch_reported_${auth.currentUser.uid}`;
    const ls = safeStorage();
    let reported = [];
    try {
      reported = JSON.parse((ls && ls.getItem(reportedKey)) || '[]');
    } catch (e) {
      reported = [];
    }

    // Rules only allow reading public reviews, so every query filters on that.
    async function publicQuery(q) {
      const [live, approved] = await Promise.all([
        q.where('status', '==', 'visible').where('reportCount', '<', 3).limit(LIST_LIMIT).get(),
        q.where('status', '==', 'approved').limit(LIST_LIMIT).get(),
      ]);
      return sanitizeAll([...live.docs, ...approved.docs].map(toPlain));
    }

    return {
      mode: 'live',
      persistent: true,
      listAll: () => publicQuery(col),
      listFor: (facilityId) => publicQuery(col.where('facilityId', '==', facilityId)),
      async myReview(facilityId) {
        const a = await db.collection('shelterwatch_authors').doc(`${facilityId}__${auth.currentUser.uid}`).get();
        return a.exists ? { id: a.data().commentId } : null;
      },
      hasReported(id) {
        return reported.includes(id);
      },
      async add(comment) {
        const uid = auth.currentUser.uid;
        const ref = col.doc();
        const batch = db.batch();
        batch.set(ref, { ...comment, reportCount: 0, createdAt: ts() });
        batch.set(db.collection('shelterwatch_authors').doc(`${comment.facilityId}__${uid}`), { commentId: ref.id });
        batch.set(db.collection('shelterwatch_ratelimit').doc(uid), { last: ts() });
        try {
          await batch.commit();
        } catch (e) {
          if (e && e.code === 'permission-denied') {
            throw new Error('Not posted. You can review each place once, and post once a minute.');
          }
          throw new Error('Not posted — check your connection and try again.');
        }
        return moderation().sanitizeStored({ ...comment, id: ref.id });
      },
      async report(id) {
        const uid = auth.currentUser.uid;
        const ref = col.doc(id);
        const batch = db.batch();
        batch.set(ref.collection('reports').doc(uid), { createdAt: ts() });
        batch.update(ref, { reportCount: firebase.firestore.FieldValue.increment(1) });
        try {
          await batch.commit();
        } catch (e) {
          if (e && e.code === 'permission-denied') throw new Error('You already reported this review.');
          throw new Error('Report not sent — check your connection and try again.');
        }
        reported = [...reported, id];
        try {
          if (ls) ls.setItem(reportedKey, JSON.stringify(reported));
        } catch (e) {
          /* not critical */
        }
      },
    };
  }

  root.ShelterWatchStore = {
    async create() {
      const config = root.SHELTER_WATCH_CONFIG && root.SHELTER_WATCH_CONFIG.firebase;
      if (!config) return demoStore();
      try {
        return await firestoreStore(config);
      } catch (e) {
        console.error('Shelter Watch: Firestore unavailable, falling back to demo mode', e);
        return demoStore();
      }
    },
  };
})(self);
