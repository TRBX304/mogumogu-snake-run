// ランキングのサービス層。
// firebase-config.js に設定があれば Firebase（匿名認証 + Firestore Lite）、
// なければ「この端末だけ」の LocalRanking で動く。
//
// interface:
//   mode                                  … 'firebase' | 'local'
//   uid                                   … 端末ごとのID（Firebaseでは匿名認証のUID）
//   beginGame()      -> { gameId|null }   … ゲーム開始時にIDを発行（games/{id} に開始時刻を記録）
//   submit({ gameId, score, nickname })   -> { ok, improved: string[], reason? }
//   fetchTop(period, limit)               -> [{ uid, name, score }]
//   renameAll(nickname)                   … 今期のランキング上の表示名をまとめて変更

import { FIREBASE_CONFIG, FIREBASE_SDK_VERSION } from './firebase-config.js';

export const PERIODS = ['week', 'month', 'all'];
export const PERIOD_LABEL = { week: '週間', month: '月間', all: '全期間' };

// 期間キー（日本時間・週は月曜0時区切り）
// firestore.rules でも同じ計算をして、期間キーの偽装を防いでいる
export function periodKey(period, date = new Date()) {
  const jst = date.getTime() + 9 * 3600 * 1000;
  if (period === 'week') {
    const day = Math.floor(jst / 86400000);       // 1970-01-01(木) = 0
    return `w${Math.floor((day + 3) / 7)}`;       // +3 で月曜始まりに揃える
  }
  if (period === 'month') {
    const d = new Date(jst);
    return `m${d.getUTCFullYear() * 100 + d.getUTCMonth() + 1}`;
  }
  return 'all';
}

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* noop */ }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
}

// ================= ローカル（Firebase未設定時） =================
class LocalRanking {
  constructor() {
    this.mode = 'local';
    this.uid = 'local';
  }
  async beginGame() { return { gameId: 'local' }; }

  async submit({ score, nickname }) {
    const bests = load('msr.localBests', {});
    const improved = [];
    for (const p of PERIODS) {
      const key = periodKey(p);
      const cur = bests[p];
      if (!cur || cur.key !== key || score > cur.score) {
        bests[p] = { key, score, name: nickname };
        improved.push(p);
      }
    }
    save('msr.localBests', bests);
    return { ok: true, improved };
  }

  async fetchTop(period) {
    const bests = load('msr.localBests', {});
    const b = bests[period];
    if (!b || b.key !== periodKey(period)) return [];
    return [{ uid: this.uid, name: b.name, score: b.score }];
  }

  async renameAll(nickname) {
    const bests = load('msr.localBests', {});
    for (const p of PERIODS) if (bests[p]) bests[p].name = nickname;
    save('msr.localBests', bests);
  }
}

// ================= Firebase =================
const GAME_TTL_MS = 24 * 60 * 60 * 1000; // games は1日で期限切れ
class FirebaseRanking {
  constructor(fb) {
    this.mode = 'firebase';
    this.fb = fb;            // { db, auth, fs: firestore関数群 }
    this.uid = fb.auth.currentUser.uid;
  }

  // 自分の今期ベスト（送信前の判定用）。読み取りを節約するため localStorage に保持
  _myBests() {
    const m = load('msr.myBests', null);
    if (!m || m.uid !== this.uid) return {};
    return m.bests || {};
  }
  _myBest(period) {
    const b = this._myBests()[period];
    return b && b.key === periodKey(period) ? b.score : 0;
  }
  _setMyBest(period, score) {
    const bests = this._myBests();
    bests[period] = { key: periodKey(period), score };
    save('msr.myBests', { uid: this.uid, bests });
  }

  async _refreshMyBests() {
    const { db, fs } = this.fb;
    await Promise.all(PERIODS.map(async (p) => {
      const snap = await fs.getDoc(fs.doc(db, 'ranks', periodKey(p), 'entries', this.uid));
      this._setMyBest(p, snap.exists() ? snap.data().score : 0);
    }));
  }

  async beginGame() {
    if (!navigator.onLine) return { gameId: null };
    const { db, fs } = this.fb;
    const ref = fs.doc(fs.collection(db, 'games'));
    try {
      await withTimeout(fs.setDoc(ref, {
        uid: this.uid,
        startedAt: fs.serverTimestamp(),
        used: false,
        // この日時を過ぎたら Firestore の TTL で自動削除される（3時間を過ぎた game はもう使えない）
        expireAt: new Date(Date.now() + GAME_TTL_MS),
      }), 5000);
      return { gameId: ref.id };
    } catch {
      return { gameId: null };
    }
  }

  async submit({ gameId, score, nickname }, retried = false) {
    if (!gameId) return { ok: false, improved: [], reason: 'オフラインのためランキング対象外です' };
    const { db, fs } = this.fb;

    const improved = PERIODS.filter(p => score > this._myBest(p));
    if (!improved.length) return { ok: true, improved };

    const batch = fs.writeBatch(db);
    batch.update(fs.doc(db, 'games', gameId), { used: true });
    for (const p of improved) {
      batch.set(fs.doc(db, 'ranks', periodKey(p), 'entries', this.uid), {
        name: nickname,
        score,
        gameId,
        updatedAt: fs.serverTimestamp(),
      });
    }
    try {
      await withTimeout(batch.commit(), 8000);
      improved.forEach(p => this._setMyBest(p, score));
      return { ok: true, improved };
    } catch (e) {
      // 手元の自己ベストが古かった可能性があるので、一度だけ読み直して再送
      if (!retried && e?.code === 'permission-denied') {
        try {
          await this._refreshMyBests();
          return await this.submit({ gameId, score, nickname }, true);
        } catch { /* fallthrough */ }
      }
      return { ok: false, improved: [], reason: '送信できませんでした' };
    }
  }

  async fetchTop(period, limitN = 30) {
    const { db, fs } = this.fb;
    const q = fs.query(
      fs.collection(db, 'ranks', periodKey(period), 'entries'),
      fs.orderBy('score', 'desc'),
      fs.limit(limitN),
    );
    const snap = await withTimeout(fs.getDocs(q), 8000);
    return snap.docs.map(d => ({ uid: d.id, name: d.data().name, score: d.data().score }));
  }

  async renameAll(nickname) {
    const { db, fs } = this.fb;
    const bests = this._myBests();
    await Promise.all(PERIODS.map(async (p) => {
      const b = bests[p];
      if (!b || b.key !== periodKey(p) || !b.score) return;
      try {
        await fs.updateDoc(fs.doc(db, 'ranks', periodKey(p), 'entries', this.uid), { name: nickname });
      } catch { /* 記録が無い等は無視 */ }
    }));
  }
}

async function connectFirebase() {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
  const [{ initializeApp }, authMod, fs] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore-lite.js`), // Lite版：軽量で、オフライン時に書き込みを溜め込まない
  ]);
  const app = initializeApp(FIREBASE_CONFIG);
  const auth = authMod.getAuth(app);
  const db = fs.getFirestore(app);

  // 既存の匿名ユーザーがいれば復元、いなければ新規発行
  const user = await new Promise((resolve) => {
    const unsub = authMod.onAuthStateChanged(auth, (u) => { unsub(); resolve(u); });
  });
  if (!user) await authMod.signInAnonymously(auth);
  return { app, auth, db, fs };
}

// ES Modules のライブバインディングで、初期化後に差し替わる
export let ranking = new LocalRanking();

export async function initRanking() {
  if (!FIREBASE_CONFIG) return ranking;
  try {
    const fb = await withTimeout(connectFirebase(), 10000);
    ranking = new FirebaseRanking(fb);
  } catch (e) {
    console.warn('[ranking] Firebaseに接続できませんでした。ローカルで続行します', e);
    ranking.offline = true;
  }
  return ranking;
}

// ---------- 読み取り回数を抑えるキャッシュ ----------
// ホーム画面に戻るたびに読み直さないよう、sessionStorage に数分保持する。
// 自分のスコア送信後は再取得せず、キャッシュ上で差し込む。
const TTL_MS = 3 * 60 * 1000;
const LIMIT = 30;

function cacheKey(period) { return `msr.rank.${ranking.mode}.${periodKey(period)}`; }

export async function getRanking(period, { force = false } = {}) {
  const ck = cacheKey(period);
  if (!force) {
    try {
      const c = JSON.parse(sessionStorage.getItem(ck) || 'null');
      if (c && Date.now() - c.at < TTL_MS) return c.list;
    } catch { /* noop */ }
  }
  const list = await ranking.fetchTop(period, LIMIT);
  try { sessionStorage.setItem(ck, JSON.stringify({ at: Date.now(), list })); } catch { /* noop */ }
  return list;
}

// 送信成功後：キャッシュ上の自分の行だけ書き換える（再読み込みしない）
export function mergeMyScore(periods, uid, name, score) {
  for (const p of periods) {
    const ck = cacheKey(p);
    let c;
    try { c = JSON.parse(sessionStorage.getItem(ck) || 'null'); } catch { c = null; }
    if (!c) continue;
    const list = c.list;
    const mine = list.find(e => e.uid === uid);
    if (mine) {
      mine.name = name;
      if (score > mine.score) mine.score = score;
    } else {
      list.push({ uid, name, score });
    }
    list.sort((a, b) => b.score - a.score);
    c.list = list.slice(0, LIMIT);
    try { sessionStorage.setItem(ck, JSON.stringify(c)); } catch { /* noop */ }
  }
}

// 名前変更をキャッシュにも反映
export function renameInCache(uid, name) {
  for (const p of PERIODS) {
    const ck = cacheKey(p);
    try {
      const c = JSON.parse(sessionStorage.getItem(ck) || 'null');
      if (!c) continue;
      c.list.forEach(e => { if (e.uid === uid) e.name = name; });
      sessionStorage.setItem(ck, JSON.stringify(c));
    } catch { /* noop */ }
  }
}
