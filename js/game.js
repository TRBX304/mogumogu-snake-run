import { CONFIG as C, speedAtLevel, levelAtStep } from './config.js';
import { Course } from './course.js';
import { drawSprite, SNAKE, HEAD_ROWS } from './sprites.js';

const laneX = (col) => col * C.LANE_W + C.LANE_W / 2;
const FONT = '"DotGothic16", ui-monospace, monospace';

const FIELD_A = '#b9e28c';
const FIELD_B = '#addb7c';

/**
 * hooks:
 *  onScore(score), onTime(sec), onLevel(lv), onEat(type, streak),
 *  onCountdown(n), onDie(reason), onGameOver(result)
 */
export class Game {
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = hooks;
    this.devScale = 1;
    this.course = new Course();
    this.state = 'idle'; // idle | countdown | playing | paused | dying | over
    this.raf = 0;
    this._loop = this._loop.bind(this);
    this.reset();
  }

  // ---------- 外部API ----------
  setDeviceScale(s) {
    this.devScale = s;
    this.canvas.width = Math.round(C.VIEW_W * s);
    this.canvas.height = Math.round(C.VIEW_H * s);
    this.render(1);
  }

  start() {
    this.reset();
    this.state = 'countdown';
    this.countdown = C.COUNTDOWN_SEC;
    this.lastCount = -1;
    this.hooks.onScore?.(0);
    this.hooks.onTime?.(0);
    this.hooks.onLevel?.(1, true);
    this._run();
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'countdown') return false;
    this.state = 'paused';
    this._stop();
    this.render(1);
    return true;
  }

  resume() {
    if (this.state !== 'paused') return;
    // 再開時も短いカウントダウンを入れる
    this.state = 'countdown';
    this.countdown = C.COUNTDOWN_SEC;
    this.lastCount = -1;
    this._run();
  }

  quit() {
    this._stop();
    this.state = 'idle';
  }

  moveLeft() { this._move(-1); }
  moveRight() { this._move(1); }

  // ---------- 内部 ----------
  reset() {
    this.step = 0;
    this.t = 0;
    this.d = 0;
    this.prevD = 0;
    this.level = 1;
    this.speed = speedAtLevel(1);
    this.lane = 1;
    this.history = [{ d: 0, lane: 1 }];
    this.headFromX = laneX(1);
    this.tweenT = 0;
    this.score = 0;
    this.streak = 0;
    this.course.reset();
    this.particles = [];
    this.popups = [];
    this.banners = [];
    this.shake = 0;
    this.death = null;
    this.deathTimer = 0;
    this.anim = 0;
    this.goTimer = 0;
    this.lastSecond = 0;
    this.acc = 0;
  }

  _move(dir) {
    if (this.state !== 'playing') return;
    const next = Math.max(0, Math.min(C.COLS - 1, this.lane + dir));
    if (next === this.lane) return;
    this.headFromX = this._headX();
    this.tweenT = C.LANE_TWEEN_SEC;
    this.lane = next;
    this.history.push({ d: this.d, lane: next });
  }

  _headX() {
    const target = laneX(this.lane);
    if (C.LANE_TWEEN_SEC <= 0 || this.tweenT <= 0) return target;
    const k = 1 - this.tweenT / C.LANE_TWEEN_SEC;
    return this.headFromX + (target - this.headFromX) * k;
  }

  _run() {
    if (this.raf) return;
    this.lastTs = performance.now();
    this.acc = 0;
    this.raf = requestAnimationFrame(this._loop);
  }

  _stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  _loop(ts) {
    this.raf = requestAnimationFrame(this._loop);
    let dt = (ts - this.lastTs) / 1000;
    this.lastTs = ts;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    this.anim += dt;

    if (this.state === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown / (C.COUNTDOWN_SEC / 3));
      if (n !== this.lastCount && n > 0) {
        this.lastCount = n;
        this.hooks.onCountdown?.(n);
      }
      if (this.countdown <= 0) {
        this.state = 'playing';
        this.goTimer = 0.45;
        this.hooks.onCountdown?.(0);
      }
    } else if (this.state === 'playing') {
      this.acc += dt;
      while (this.acc >= C.STEP && this.state === 'playing') {
        this._step();
        this.acc -= C.STEP;
      }
      if (this.tweenT > 0) this.tweenT = Math.max(0, this.tweenT - dt);
      if (this.goTimer > 0) this.goTimer -= dt;
    } else if (this.state === 'dying') {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) {
        this.state = 'over';
        this.render(1);
        this._stop();
        this.hooks.onGameOver?.(this.result());
        return;
      }
    }

    this._updateFx(dt);
    const alpha = this.state === 'playing' ? this.acc / C.STEP : 1;
    this.render(alpha);
  }

  _step() {
    this.prevD = this.d;
    this.step++;
    this.t = this.step / C.STEPS_PER_SEC;

    const lv = levelAtStep(this.step);
    if (lv !== this.level) {
      this.level = lv;
      this.speed = speedAtLevel(lv);
      this.hooks.onLevel?.(lv, false);
      this._banner(`SPEED UP!  Lv.${lv}`, '#3a86ff');
      if (lv === C.POISON_FROM_LEVEL) this._banner('どくリンゴ出現！ さわるとアウト', '#7b2cbf', 0.5);
    }

    this.d += this.speed * C.STEP;

    const sec = Math.floor(this.t);
    if (sec !== this.lastSecond) {
      this.lastSecond = sec;
      this.hooks.onTime?.(sec);
    }

    this.course.ensure(this.d + C.HEAD_Y + 120);
    this._collide();
    this.course.prune(this.d - (C.VIEW_H - C.HEAD_Y) - 80);

    // 画面外に出た胴体の履歴を捨てる
    while (this.history.length >= 2 && C.HEAD_Y + this.d - this.history[1].d > C.VIEW_H + 40) {
      this.history.shift();
    }
  }

  _collide() {
    for (const it of this.course.items) {
      const diff = it.w - this.d;
      if (diff > C.EAT_WINDOW) break;
      if (it.done) continue;
      if (it.type === 'poison') {
        if (it.col === this.lane && Math.abs(diff) < C.POISON_WINDOW) {
          this._die('poison', it);
          return;
        }
        continue;
      }
      if (it.col === this.lane && Math.abs(diff) < C.EAT_WINDOW) {
        this._eat(it);
        continue;
      }
      if (diff < -C.MISS_LINE) {
        this._die('miss', it);
        return;
      }
    }
  }

  _eat(it) {
    it.done = true;
    this.streak++;
    const x = laneX(it.col);
    const y = C.HEAD_Y;
    if (it.type === 'gold') {
      this.score += C.SCORE_GOLD;
      this._burst(x, y - 8, ['#ffcf33', '#fff7cc', '#e09a00'], 18);
      this._popup(x, y - 40, '+1000', '#e09a00', 20);
    } else {
      this.score += C.SCORE_RED;
      // 赤リンゴは頻度が高いので、文字は出さず粒と音だけにする
      this._burst(x, y - 8, ['#ff595e', '#ffc2c3'], 8);
    }
    this.hooks.onEat?.(it.type, this.streak);
    this.hooks.onScore?.(this.score);
  }

  _die(reason, it) {
    this.state = 'dying';
    this.death = { reason, item: it };
    this.deathTimer = C.DEATH_FREEZE_SEC;
    this.shake = 7;
    this.hooks.onDie?.(reason);
  }

  result() {
    return {
      score: this.score,
      time: Math.floor(this.t),
      timeExact: this.t,
      level: this.level,
      reason: this.death?.reason ?? 'miss',
    };
  }

  // ---------- エフェクト ----------
  _burst(x, y, colors, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 160;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 60,
        life: 0.45 + Math.random() * 0.2,
        color: colors[i % colors.length],
      });
    }
  }

  _popup(x, y, text, color, size) {
    this.popups.push({ x, y, text, color, size, life: 0.7 });
  }

  _banner(text, color, delay = 0) {
    this.banners.push({ text, color, life: 1.4, delay });
  }

  _updateFx(dt) {
    const frozen = this.state === 'paused';
    if (frozen) return;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 700 * dt;
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.y -= 50 * dt;
      p.life -= dt;
      if (p.life <= 0) this.popups.splice(i, 1);
    }
    for (let i = this.banners.length - 1; i >= 0; i--) {
      const b = this.banners[i];
      if (b.delay > 0) { b.delay -= dt; continue; }
      b.life -= dt;
      if (b.life <= 0) this.banners.splice(i, 1);
    }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - 14 * dt);
  }

  // ---------- 描画 ----------
  render(alpha) {
    const ctx = this.ctx;
    const s = this.devScale;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.imageSmoothingEnabled = false;

    const rd = this.prevD + (this.d - this.prevD) * Math.min(1, Math.max(0, alpha));
    const yOf = (w) => Math.round(C.HEAD_Y + rd - w);

    ctx.save();
    if (this.shake > 0) {
      ctx.translate(Math.round((Math.random() - 0.5) * this.shake), Math.round((Math.random() - 0.5) * this.shake));
    }

    this._drawField(ctx, rd);
    this._drawItems(ctx, yOf);
    this._drawSnake(ctx, yOf);
    this._drawFx(ctx);
    if (this.death) this._drawDeath(ctx, yOf);

    ctx.restore();

    this._drawBanners(ctx);
    if (this.state === 'countdown') this._drawCountdown(ctx);
    else if (this.state === 'playing' && this.goTimer > 0) this._drawCenterText(ctx, 'GO!', '#ffcf33', 56);
  }

  _drawField(ctx, rd) {
    // 1マス = レーン幅 x 48px の市松模様。リンゴがマスの中央に来るように配置
    const wTop = rd + C.HEAD_Y;           // 画面上端の w
    const wBottom = rd + C.HEAD_Y - C.VIEW_H;
    const kMin = Math.floor((wBottom - 24) / C.CELL);
    const kMax = Math.ceil((wTop + 24) / C.CELL);
    for (let k = kMin; k <= kMax; k++) {
      const top = Math.round(C.HEAD_Y + rd - (k * C.CELL + 24));
      for (let col = 0; col < C.COLS; col++) {
        ctx.fillStyle = ((k + col) & 1) ? FIELD_A : FIELD_B;
        ctx.fillRect(col * C.LANE_W, top, C.LANE_W, C.CELL);
      }
    }
  }

  _drawItems(ctx, yOf) {
    const D = C.DOT;
    for (const it of this.course.items) {
      if (it.done) continue;
      const y = yOf(it.w);
      if (y < -40) break;
      if (y > C.VIEW_H + 40) continue;
      // 死亡演出中の原因アイテムは点滅
      if (this.death && this.death.item === it && Math.floor(this.anim * 10) % 2 === 0) continue;

      const x = laneX(it.col);
      let bob = 0;
      if (it.type === 'gold') bob = (Math.floor(this.anim * 3) % 2) * -D;

      // フラットな影
      ctx.fillStyle = 'rgba(31, 42, 68, 0.14)';
      ctx.fillRect(x - 3 * D, y + 4 * D, 6 * D, D);

      if (it.type === 'gold') {
        ctx.fillStyle = 'rgba(255, 214, 51, 0.28)';
        ctx.beginPath();
        ctx.arc(x, y + bob, 26 + Math.sin(this.anim * 6) * 2, 0, Math.PI * 2);
        ctx.fill();
      }

      drawSprite(ctx, it.type, x - 5 * D, y - 5 * D + bob, D);

      if (it.type === 'gold') this._drawSparkles(ctx, x, y + bob);
    }
  }

  _drawSparkles(ctx, x, y) {
    const D = C.DOT;
    const pts = [[-22, -18], [20, -14], [18, 18], [-20, 14]];
    ctx.fillStyle = '#ffffff';
    pts.forEach(([ox, oy], i) => {
      const phase = Math.floor(this.anim * 4 + i * 1.7) % 4;
      if (phase !== 0) return;
      const cx = Math.round((x + ox) / D) * D;
      const cy = Math.round((y + oy) / D) * D;
      ctx.fillRect(cx, cy - D, D, D * 3);
      ctx.fillRect(cx - D, cy, D * 3, D);
    });
  }

  _drawSnake(ctx, yOf) {
    const D = C.DOT;
    const half = 10; // 胴体幅 20px = 5ドット
    const h = this.history;
    const headX = Math.round(this._headX());
    const lastIdx = h.length - 1;
    const xOfSeg = (i) => (i === lastIdx ? headX : laneX(h[i].lane));

    // しっぽ（スタート地点）
    const tailY = yOf(0);
    if (h[0].d === 0 && tailY < C.VIEW_H + 20) {
      const tx = xOfSeg(0);
      ctx.fillStyle = SNAKE.body;
      ctx.fillRect(tx - 6, tailY, 12, 8);
      ctx.fillRect(tx - 2, tailY + 8, 4, 8);
      ctx.fillStyle = SNAKE.shade;
      ctx.fillRect(tx + 2, tailY, 4, 8);
    }

    // 縦の胴体
    for (let i = 0; i < h.length; i++) {
      const x = xOfSeg(i);
      const top = i < lastIdx ? yOf(h[i + 1].d) : C.HEAD_Y;
      const bottom = Math.min(yOf(h[i].d), C.VIEW_H + 20);
      if (bottom <= top) continue;
      ctx.fillStyle = SNAKE.body;
      ctx.fillRect(x - half, top, half * 2, bottom - top);
      ctx.fillStyle = SNAKE.shade;
      ctx.fillRect(x + half - D, top, D, bottom - top);

      // うろこ模様（世界座標に固定してスクロールさせる）
      ctx.fillStyle = SNAKE.scale;
      const wTop = h[i + 1] ? h[i + 1].d : this.d;
      const kStart = Math.ceil(h[i].d / 16);
      const kEnd = Math.floor(wTop / 16);
      for (let k = kStart; k <= kEnd; k++) {
        const sy = yOf(k * 16);
        if (sy < top || sy > bottom - D) continue;
        if (sy > C.VIEW_H) continue;
        ctx.fillRect(x - 6, sy, 12, D);
      }
    }

    // 曲がり角（カクカク）
    for (let i = 1; i < h.length; i++) {
      const y = yOf(h[i].d);
      if (y > C.VIEW_H + 20) continue;
      const x1 = xOfSeg(i - 1);
      const x2 = xOfSeg(i);
      const left = Math.min(x1, x2) - half;
      const right = Math.max(x1, x2) + half;
      ctx.fillStyle = SNAKE.body;
      ctx.fillRect(left, y - half, right - left, half * 2);
      ctx.fillStyle = SNAKE.shade;
      ctx.fillRect(left, y + half - D, right - left, D);
    }

    this._drawHead(ctx, headX);
  }

  _drawHead(ctx, hx) {
    const D = C.DOT;
    const ox = hx - 14;
    const oy = C.HEAD_Y - 20;
    const dead = !!this.death;

    // 舌（ときどきチロッと出す）
    if (!dead && this.state !== 'idle' && (this.anim % 1.6) < 0.16) {
      ctx.fillStyle = SNAKE.tongue;
      ctx.fillRect(hx - 2, oy - 2 * D, D, 2 * D);
      ctx.fillRect(hx - 2 - D, oy - 3 * D, D, D);
      ctx.fillRect(hx - 2 + D, oy - 3 * D, D, D);
    }

    for (let y = 0; y < HEAD_ROWS.length; y++) {
      for (let x = 0; x < HEAD_ROWS[y].length; x++) {
        const ch = HEAD_ROWS[y][x];
        if (ch === '.') continue;
        let color = SNAKE.body;
        if (ch === 'S') color = SNAKE.shade;
        else if (ch === 'c') color = SNAKE.cheek;
        else if (ch === 'w') color = dead ? SNAKE.body : SNAKE.eye;
        ctx.fillStyle = color;
        ctx.fillRect(ox + x * D, oy + y * D, D, D);
      }
    }

    if (dead) {
      // 目を閉じる（横線）
      ctx.fillStyle = SNAKE.pupil;
      ctx.fillRect(ox + 1 * D, oy + 3 * D, 2 * D, D);
      ctx.fillRect(ox + 4 * D, oy + 3 * D, 2 * D, D);
      return;
    }

    // 次のリンゴの方向を見る
    const dir = this._lookDir();
    ctx.fillStyle = SNAKE.pupil;
    if (dir < 0) {
      ctx.fillRect(ox + 1 * D, oy + 3 * D, D, D);
      ctx.fillRect(ox + 4 * D, oy + 3 * D, D, D);
    } else if (dir > 0) {
      ctx.fillRect(ox + 2 * D, oy + 3 * D, D, D);
      ctx.fillRect(ox + 5 * D, oy + 3 * D, D, D);
    } else {
      ctx.fillRect(ox + 2 * D, oy + 2 * D, D, D);
      ctx.fillRect(ox + 4 * D, oy + 2 * D, D, D);
    }
  }

  _lookDir() {
    for (const it of this.course.items) {
      if (it.done || it.type === 'poison') continue;
      if (it.w < this.d - C.EAT_WINDOW) continue;
      return Math.sign(it.col - this.lane);
    }
    return 0;
  }

  _drawFx(ctx) {
    const D = C.DOT;
    for (const p of this.particles) {
      ctx.globalAlpha = Math.min(1, p.life * 2.5);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x / 2) * 2, Math.round(p.y / 2) * 2, D, D);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.popups) {
      ctx.globalAlpha = Math.min(1, p.life * 2.5);
      ctx.font = `${p.size}px ${FONT}`;
      ctx.fillStyle = 'rgba(31, 42, 68, 0.35)';
      ctx.fillText(p.text, Math.round(p.x), Math.round(p.y) + 2);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, Math.round(p.x), Math.round(p.y));
    }
    ctx.globalAlpha = 1;
  }

  _drawDeath(ctx, yOf) {
    const it = this.death.item;
    const x = laneX(it.col);
    const y = yOf(it.w);
    const D = C.DOT;
    // 原因の場所を赤い枠で示す
    ctx.fillStyle = '#ff595e';
    const s = 28;
    ctx.fillRect(x - s, y - s, s * 2, D);
    ctx.fillRect(x - s, y + s - D, s * 2, D);
    ctx.fillRect(x - s, y - s, D, s * 2);
    ctx.fillRect(x + s - D, y - s, D, s * 2);
  }

  _drawBanners(ctx) {
    let slot = 0;
    for (const b of this.banners) {
      if (b.delay > 0) continue;
      const a = Math.min(1, b.life * 3, (1.4 - b.life) * 8);
      const y = 150 + slot * 48;
      slot++;
      ctx.globalAlpha = Math.max(0, a);
      ctx.font = `16px ${FONT}`;
      const w = ctx.measureText(b.text).width + 32;
      const x = Math.round(C.VIEW_W / 2 - w / 2);
      ctx.fillStyle = 'rgba(31, 42, 68, 0.18)';
      ctx.fillRect(x, y + 4, Math.round(w), 36);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, Math.round(w), 36);
      ctx.fillStyle = b.color;
      ctx.fillRect(x, y, 4, 36);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = b.color;
      ctx.fillText(b.text, C.VIEW_W / 2, y + 19);
    }
    ctx.globalAlpha = 1;
  }

  _drawCountdown(ctx) {
    const n = Math.max(1, Math.ceil(this.countdown / (C.COUNTDOWN_SEC / 3)));
    ctx.fillStyle = 'rgba(31, 42, 68, 0.18)';
    ctx.fillRect(0, 0, C.VIEW_W, C.VIEW_H);
    this._drawCenterText(ctx, String(n), '#ffffff', 72);
  }

  _drawCenterText(ctx, text, color, size) {
    ctx.font = `${size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(31, 42, 68, 0.45)';
    ctx.fillText(text, C.VIEW_W / 2, 230 + 4);
    ctx.fillStyle = color;
    ctx.fillText(text, C.VIEW_W / 2, 230);
  }
}
