/**
 * Shelter Watch comment storage.
 *
 * If config.js provides a Firebase config, comments are stored in Firestore
 * (collection `shelterwatch_comments`) using anonymous sign-in so each person
 * can report a comment only once. Without a config the page runs in DEMO
 * MODE: comments are kept in this browser only and nobody else sees them.
 */
(function (root) {
  const COLLECTION = 'shelterwatch_comments';
  const FIREBASE_VERSION = '10.12.2';

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
    const read = () => {
      try {
        return JSON.parse(localStorage.getItem(KEY) || '[]');
      } catch (e) {
        return [];
      }
    };
    const write = (list) => {
      try {
        localStorage.setItem(KEY, JSON.stringify(list));
      } catch (e) {
        /* storage blocked — comments last until reload */
      }
    };
    let memory = read();
    let uid;
    try {
      uid = localStorage.getItem('shelterwatch_uid');
      if (!uid) {
        uid = `demo-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem('shelterwatch_uid', uid);
      }
    } catch (e) {
      uid = `demo-${Math.random().toString(36).slice(2)}`;
    }
    return {
      mode: 'demo',
      async userId() {
        return uid;
      },
      async listAll() {
        return memory.slice();
      },
      async add(comment) {
        const saved = { ...comment, id: `d${Date.now()}${Math.random().toString(36).slice(2, 6)}`, authorUid: uid };
        memory.push(saved);
        write(memory);
        return saved;
      },
      async report(id, reporterId) {
        memory = memory.map((c) => (c.id === id ? root.ShelterWatch.moderation.report(c, reporterId) : c));
        write(memory);
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
    return {
      mode: 'live',
      async userId() {
        return auth.currentUser.uid;
      },
      async listAll() {
        // Rules only allow reading public statuses, so the query must filter on them.
        const snap = await col.where('status', 'in', ['visible', 'approved']).get();
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      },
      async add(comment) {
        const data = { ...comment, authorUid: auth.currentUser.uid };
        const ref = await col.add(data);
        return { id: ref.id, ...data };
      },
      async report(id, reporterId) {
        await col.doc(id).update({ reports: firebase.firestore.FieldValue.arrayUnion(reporterId) });
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
