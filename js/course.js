import { CONFIG as C, distanceAtTime, levelAtDistance } from './config.js';

// コースは「走行距離 w」で管理し、必要な分だけ先読み生成する（チャンク生成）
// items は w の昇順に並ぶ
export class Course {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.reset();
  }

  reset() {
    this.items = [];
    let w = 0;
    for (let i = 0; i < C.START_STRAIGHT; i++) {
      this.items.push({ col: 1, w, type: 'red', done: false });
      w += C.CELL;
    }
    this.nextW = w;
    this.lastCol = 1;
    this.count = 0;
    // 毒リンゴは「Lv3に到達する距離」以降にだけ置く
    this.poisonStartW = distanceAtTime((C.POISON_FROM_LEVEL - 1) * C.LEVEL_SEC);
  }

  ensure(uptoW) {
    while (this.nextW < uptoW) this._genOne();
  }

  prune(minW) {
    let n = 0;
    while (n < this.items.length && this.items[n].w < minW) n++;
    if (n > 0) this.items.splice(0, n);
  }

  _genOne() {
    const r = this.rng;
    if (this.count > C.GOLD_AFTER && r() < C.GOLD_CHANCE) {
      // 金リンゴ：2マス空けてランダムなレーンに
      const col = Math.floor(r() * C.COLS);
      this.nextW += C.CELL * 2;
      this.items.push({ col, w: this.nextW, type: 'gold', done: false });
      this.lastCol = col;
      this.nextW += C.CELL;
    } else {
      let col = this.lastCol;
      if (r() < C.LANE_CHANGE_CHANCE) {
        const dir = r() < 0.5 ? -1 : 1;
        col = Math.max(0, Math.min(C.COLS - 1, this.lastCol + dir));
      }
      const w = this.nextW;
      this.items.push({ col, w, type: 'red', done: false });

      // 毒リンゴ：赤リンゴと同じ行の別レーンに置く（必ず通れるルートが残る）
      if (w >= this.poisonStartW) {
        const lv = levelAtDistance(w);
        const chance = Math.min(
          C.POISON_CHANCE_MAX,
          C.POISON_CHANCE_BASE + (lv - C.POISON_FROM_LEVEL) * C.POISON_CHANCE_INC
        );
        if (r() < chance) {
          const others = [0, 1, 2].filter(c => c !== col);
          const pc = others[Math.floor(r() * others.length)];
          this.items.push({ col: pc, w, type: 'poison', done: false });
        }
      }
      this.lastCol = col;
      this.nextW += C.CELL;
    }
    this.count++;
  }
}
