import { CONFIG as C } from './config.js';
import { Game } from './game.js';
import { sfx } from './audio.js';
import { spriteIcon, SPR, SNAKE } from './sprites.js';
import { ranking, initRanking, getRanking, mergeMyScore, renameInCache, PERIODS } from './ranking.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* noop */ } },
};

// ================= 画面切り替え =================
let current = 'home';
function showScreen(name) {
  current = name;
  $('#home').classList.toggle('is-active', name === 'home');
  $('#gameScreen').classList.toggle('is-active', name === 'game');
  if (name === 'game') requestAnimationFrame(fitCanvas);
}

// ================= ゲーム =================
const canvas = $('#gameCanvas');
const hudScore = $('#hudScore');
const hudTime = $('#hudTime');
const hudLevel = $('#hudLevel');

let currentGame = Promise.resolve({ gameId: null });

const game = new Game(canvas, {
  onScore: (s) => { hudScore.textContent = s; },
  onTime: (sec) => { hudTime.textContent = sec; },
  onLevel: (lv, initial) => {
    hudLevel.textContent = `Lv.${lv}`;
    if (!initial) {
      hudLevel.classList.remove('flash');
      void hudLevel.offsetWidth;
      hudLevel.classList.add('flash');
      sfx.levelUp();
    }
  },
  onEat: (type, streak) => {
    if (type === 'gold') {
      sfx.gold();
      vibrate(15);
    } else {
      sfx.eat(streak);
    }
  },
  onCountdown: (n) => sfx.count(n),
  onDie: (reason) => {
    sfx.die(reason);
    vibrate([60, 40, 90]);
  },
  onGameOver: (result) => showResult(result),
});

function vibrate(p) {
  try { navigator.vibrate?.(p); } catch { /* noop */ }
}

function fitCanvas() {
  const stage = $('#stage');
  const aw = stage.clientWidth;
  const ah = stage.clientHeight;
  if (!aw || !ah) return;
  const fit = Math.min(aw / C.VIEW_W, ah / C.VIEW_H);
  const dpr = window.devicePixelRatio || 1;
  const dev = fit * dpr;
  const di = Math.floor(dev);
  // 低解像度のときだけ整数倍に丸めてドットを均等にする。
  // 高DPI（1論理px ≧ 2.5物理px）ではズレが目に見えないので画面いっぱいに使う
  let devScale;
  if (dev >= 2.5) devScale = dev;
  else if (di >= 1 && di / dev >= 0.85) devScale = di;
  else devScale = Math.max(dev, 0.5);
  game.setDeviceScale(devScale);
  canvas.style.width = `${(C.VIEW_W * devScale) / dpr}px`;
  canvas.style.height = `${(C.VIEW_H * devScale) / dpr}px`;
}
window.addEventListener('resize', () => { if (current === 'game') fitCanvas(); });

function startGame() {
  sfx.unlock();
  $('#pauseOverlay').hidden = true;
  $('#resultOverlay').hidden = true;
  showScreen('game');
  fitCanvas();
  // gameId の発行はゲームと並行して行う（待たせない）
  currentGame = ranking.beginGame().catch(() => ({ gameId: null }));
  game.start();
}

function goHome() {
  game.quit();
  $('#pauseOverlay').hidden = true;
  $('#resultOverlay').hidden = true;
  showScreen('home');
  refreshHome();
}

function pauseGame() {
  if (current !== 'game') return;
  if (game.pause()) {
    updateMuteLabels();
    $('#pauseOverlay').hidden = false;
  }
}

function resumeGame() {
  $('#pauseOverlay').hidden = true;
  game.resume();
}

// ================= リザルト =================
const REASON_TEXT = {
  miss: 'リンゴを取り逃した…',
  poison: 'どくリンゴを食べちゃった…',
};

async function showResult(r) {
  const best = Number(store.get('msr.best', '0')) || 0;
  const isNew = r.score > best;
  if (isNew) store.set('msr.best', String(r.score));

  $('#resultReason').textContent = REASON_TEXT[r.reason] ?? '';
  $('#resultScore').textContent = r.score;
  $('#resultTime').textContent = `${r.time}秒`;
  $('#resultLevel').textContent = `Lv.${r.level}`;
  $('#resultBest').textContent = Math.max(best, r.score);
  $('#newRecord').hidden = !isNew || r.score === 0;
  $('#resultOverlay').hidden = false;
  setupShare(r);

  const status = $('#submitStatus');
  const name = getNickname();
  if (r.score <= 0) {
    status.textContent = '';
    return;
  }
  if (!name) {
    status.textContent = 'ニックネームを入れるとランキングに載ります';
    return;
  }
  status.textContent = '記録中…';
  try {
    const { gameId } = await currentGame;
    const res = await ranking.submit({ gameId, score: r.score, nickname: name });
    if (!res.ok) {
      status.textContent = res.reason || '記録できませんでした';
    } else if (!res.improved.length) {
      status.textContent = 'ランキングの自己ベストは更新ならず';
    } else {
      mergeMyScore(res.improved, ranking.uid, name, r.score);
      const labels = res.improved.map(p => ({ week: '週間', month: '月間', all: '全期間' }[p])).join('・');
      status.textContent = ranking.mode === 'local'
        ? `${labels}の自己ベスト更新！（この端末のみ）`
        : `${labels}ランキングに記録しました！`;
    }
  } catch {
    status.textContent = 'オフラインのためランキング対象外です';
  }
}

// ================= シェア =================
const SITE_URL = 'https://mogumogu-snake-run.pages.dev/';
let shareData = null;

function setupShare(r) {
  const row = $('#shareRow');
  if (r.score <= 0) { row.hidden = true; return; }
  row.hidden = false;
  const text = `MOGUMOGU SNAKE RUN で ${r.score.toLocaleString()}点 もぐもぐしました！🍎\n（${r.time}秒・Lv.${r.level}）\n#MOGUMOGUSNAKERUN`;
  shareData = { title: 'MOGUMOGU SNAKE RUN', text, url: SITE_URL };
  $('#shareX').href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(SITE_URL)}`;
  $('#shareNative').hidden = !navigator.share;
}

$('#shareNative').addEventListener('click', async () => {
  if (!shareData || !navigator.share) return;
  try { await navigator.share(shareData); } catch { /* キャンセル */ }
});

// ================= 入力 =================
const MOVE_LEFT = new Set(['ArrowLeft', 'a', 'A']);
const MOVE_RIGHT = new Set(['ArrowRight', 'd', 'D']);

document.addEventListener('keydown', (e) => {
  sfx.unlock();
  if (current !== 'game') return;

  const st = game.state;
  if (MOVE_LEFT.has(e.key) || MOVE_RIGHT.has(e.key)) {
    e.preventDefault();
    if (e.repeat) return; // 長押しで2レーン飛ぶ事故を防ぐ
    if (MOVE_LEFT.has(e.key)) game.moveLeft(); else game.moveRight();
    return;
  }
  if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
    e.preventDefault();
    if (st === 'playing' || st === 'countdown') pauseGame();
    else if (st === 'paused') resumeGame();
    else if (st === 'over') goHome();
    return;
  }
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (e.repeat) return;
    if (st === 'over') startGame();
    else if (st === 'paused') resumeGame();
  }
});

function bindPad(btn, action) {
  let timer = 0;
  const release = () => btn.classList.remove('is-pressed');
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sfx.unlock();
    action();
    btn.classList.add('is-pressed');
    clearTimeout(timer);
    timer = setTimeout(release, 140);
  });
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('pointerleave', release);
}
bindPad($('#padLeft'), () => game.moveLeft());
bindPad($('#padRight'), () => game.moveRight());

// キャンバスの左右タップでも操作できる
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  if (e.clientX - rect.left < rect.width / 2) game.moveLeft();
  else game.moveRight();
});

$('#gameScreen').addEventListener('contextmenu', (e) => e.preventDefault());

// タッチ操作を検出したらパッドを表示
window.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  if (e.pointerType === 'touch' && !document.body.classList.contains('is-touch')) {
    document.body.classList.add('is-touch');
    if (current === 'game') fitCanvas();
  }
}, { capture: true });

// タブ切り替え・ウィンドウ離脱で自動一時停止
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
window.addEventListener('blur', pauseGame);

$('#pauseBtn').addEventListener('click', pauseGame);
$('#resumeBtn').addEventListener('click', resumeGame);
$('#pauseHomeBtn').addEventListener('click', goHome);
$('#retryBtn').addEventListener('click', startGame);
$('#homeBtn').addEventListener('click', goHome);
$('#startBtn').addEventListener('click', startGame);

// ================= ニックネーム =================
const nickInput = $('#nickname');

function sanitizeName(s) {
  // 制御文字・前後の空白を除去し、12文字まで
  return Array.from(String(s).replace(/[\u0000-\u001f\u007f]/g, '').trim()).slice(0, 12).join('');
}

// 簡易NGワード（ひらがな/カタカナ・大文字小文字・空白の違いを吸収して判定）
const NG_WORDS = ['しね', 'ころす', 'fuck', 'shit', 'bitch', 'nigger', 'ちんこ', 'まんこ'];
function normalizeForNg(s) {
  return s.toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s・._\-ー〜~]/g, '')
    .normalize('NFKC');
}
function isNgName(s) {
  const n = normalizeForNg(s);
  return NG_WORDS.some(w => n.includes(w));
}

function getNickname() { return sanitizeName(store.get('msr.nickname', '')); }

function commitNickname() {
  const v = sanitizeName(nickInput.value);
  if (v && isNgName(v)) {
    nickInput.value = getNickname();
    nickInput.classList.add('is-invalid');
    $('#nickHint').textContent = 'その名前は使えません';
    return;
  }
  nickInput.classList.remove('is-invalid');
  $('#nickHint').textContent = '';
  nickInput.value = v;
  if (v === getNickname()) return;
  store.set('msr.nickname', v);
  if (v) {
    // 今期のランキング上の表示名もまとめて変更
    renameInCache(ranking.uid, v);
    ranking.renameAll(v).catch(() => {});
    refreshRanking();
  }
}

nickInput.value = getNickname();
nickInput.addEventListener('change', commitNickname);
nickInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    nickInput.blur();
    commitNickname();
    startGame();
  }
});

// ================= サウンド切り替え =================
function updateMuteLabels() {
  const label = sfx.muted ? '🔇 サウンド OFF' : '🔊 サウンド ON';
  $('#muteBtn').textContent = label;
  $('#pauseMuteBtn').textContent = label;
}
function toggleMute() {
  sfx.setMuted(!sfx.muted);
  updateMuteLabels();
  sfx.unlock();
  sfx.click();
}
$('#muteBtn').addEventListener('click', toggleMute);
$('#pauseMuteBtn').addEventListener('click', toggleMute);

// ================= ランキング表示 =================
const wideMq = window.matchMedia('(min-width: 900px)');
let activePeriod = 'week';

$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    activePeriod = tab.dataset.period;
    $$('.tab').forEach(t => t.classList.toggle('is-active', t === tab));
    $$('.rank-col').forEach(c => c.classList.toggle('is-active', c.dataset.period === activePeriod));
    loadRanking(activePeriod);
  });
});
wideMq.addEventListener?.('change', () => refreshRanking());

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadRanking(period) {
  const ol = $(`.rank-col[data-period="${period}"] .rank-list`);
  if (!ol.children.length) ol.innerHTML = '<li class="rank-loading">読み込み中…</li>';
  try {
    const list = await getRanking(period);
    if (!list.length) {
      ol.innerHTML = '<li class="rank-empty">まだ記録がありません</li>';
      return;
    }
    ol.innerHTML = list.map((e, i) => `
      <li class="${e.uid === ranking.uid ? 'is-me' : ''}">
        <span class="rank-no">${i + 1}</span>
        <span class="rank-name">${escapeHtml(e.name)}</span>
        <span class="rank-score">${e.score.toLocaleString()}</span>
      </li>`).join('');
  } catch {
    ol.innerHTML = '<li class="rank-empty">読み込めませんでした</li>';
  }
}

let rankingReady = false;
function refreshRanking() {
  if (!rankingReady) {
    $$('.rank-list').forEach(ol => { ol.innerHTML = '<li class="rank-loading">読み込み中…</li>'; });
    return;
  }
  // スマホは表示中のタブだけ、PCは3つとも読む（キャッシュがあれば通信なし）
  const targets = wideMq.matches ? PERIODS : [activePeriod];
  targets.forEach(loadRanking);
  $('#rankingNote').textContent = ranking.mode === 'firebase'
    ? '※ ランキングは数分ごとに更新されます'
    : ranking.offline
      ? '※ オフラインのため、この端末の記録だけを表示しています'
      : '※ 現在はFirebase接続前のため、この端末の記録だけを表示しています';
}

// ================= ホーム =================
function refreshHome() {
  $('#bestScore').textContent = (Number(store.get('msr.best', '0')) || 0).toLocaleString();
  updateMuteLabels();
  refreshRanking();
}

function drawLogoArt() {
  // ロゴ用の小さなドット絵：カクカク曲がるスネークと金リンゴ
  const D = 4;
  const W = 34, H = 16;
  const cv = $('#logoArt');
  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
  cv.width = W * D * dpr;
  cv.height = H * D * dpr;
  cv.style.width = `${W * D}px`;
  cv.style.height = `${H * D}px`;
  const c = cv.getContext('2d');
  c.scale(dpr, dpr);
  c.imageSmoothingEnabled = false;
  const px = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x * D, y * D, w * D, h * D); };

  // 胴体（下から右へ曲がって上へ）
  px(1, 11, 3, 5, SNAKE.body);
  px(1, 9, 14, 3, SNAKE.body);
  px(1, 11, 14, 1, SNAKE.shade);
  px(12, 3, 3, 7, SNAKE.body);
  px(14, 3, 1, 6, SNAKE.shade);
  [5, 9].forEach(x => px(x, 10, 2, 1, SNAKE.scale));
  px(13, 6, 1, 1, SNAKE.scale);
  // 頭
  px(11, 0, 5, 1, SNAKE.body);
  px(10, 1, 7, 4, SNAKE.body);
  px(16, 1, 1, 4, SNAKE.shade);
  px(11, 2, 2, 2, SNAKE.eye); px(14, 2, 2, 2, SNAKE.eye);
  px(12, 2, 1, 1, SNAKE.pupil); px(15, 2, 1, 1, SNAKE.pupil);
  px(10, 4, 1, 1, SNAKE.cheek); px(15, 4, 1, 1, SNAKE.cheek);
  // リンゴ
  c.drawImage(SPR.red.canvas, 22 * D, 3 * D, SPR.red.w * D, SPR.red.h * D);
}

// 開発用：URL末尾に #debug を付けるとコンソールから game を触れる
if (location.hash === '#debug') window.__msr = { game, C };

$$('.rules .icon').forEach((el) => el.appendChild(spriteIcon(el.dataset.sprite, 3)));
drawLogoArt();
refreshHome();
initRanking().then(() => { rankingReady = true; if (current === 'home') refreshRanking(); });

// PWA: Service Worker 登録（プレビュー環境など使えない場所では何もしない）
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker?.register('./sw.js').catch(() => {});
  });
}
document.fonts?.load('16px "DotGothic16"').catch(() => {});
