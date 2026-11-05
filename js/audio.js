// WebAudioで鳴らすチップチューン風の効果音（音声ファイル不要）
const PENTA = [0, 2, 4, 7, 9];

class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('msr.muted') === '1'; } catch { /* noop */ }
  }

  // ブラウザの自動再生制限のため、最初の操作時に呼ぶ
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('msr.muted', m ? '1' : '0'); } catch { /* noop */ }
  }

  tone(freq, dur, { type = 'square', vol = 0.08, at = 0, slide = 0 } = {}) {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.linearRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // 連続で取るほど音程が上がる（ペンタトニックで3オクターブ巡回）
  eat(streak) {
    const i = (streak - 1) % (PENTA.length * 3);
    const semi = PENTA[i % PENTA.length] + 12 * Math.floor(i / PENTA.length);
    this.tone(523.25 * Math.pow(2, semi / 12), 0.07, { vol: 0.06 });
  }

  gold() {
    [0, 4, 7, 12, 16].forEach((s, i) =>
      this.tone(659.25 * Math.pow(2, s / 12), 0.09, { type: 'triangle', vol: 0.12, at: i * 0.045 }));
  }

  levelUp() {
    this.tone(523.25, 0.08, { vol: 0.07 });
    this.tone(783.99, 0.12, { vol: 0.07, at: 0.08 });
  }

  count(n) {
    if (n > 0) this.tone(440, 0.08, { vol: 0.07 });
    else this.tone(880, 0.16, { vol: 0.08 });
  }

  die(reason) {
    if (reason === 'poison') {
      this.tone(300, 0.35, { type: 'sawtooth', vol: 0.08, slide: -220 });
      this.tone(150, 0.4, { type: 'square', vol: 0.05, at: 0.05, slide: -100 });
    } else {
      this.tone(392, 0.12, { vol: 0.07 });
      this.tone(311, 0.12, { vol: 0.07, at: 0.12 });
      this.tone(233, 0.3, { vol: 0.07, at: 0.24, slide: -60 });
    }
  }

  click() { this.tone(660, 0.04, { vol: 0.04 }); }
}

export const sfx = new Sfx();
