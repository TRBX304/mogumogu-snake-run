// ゲーム全体の定数。調整したい値はここに集約しています。
export const CONFIG = {
  // 論理解像度（ドット = 4px。レーン幅108 = 27ドット）
  VIEW_W: 324,
  VIEW_H: 520,
  COLS: 3,
  LANE_W: 108,
  CELL: 48,          // リンゴ同士の間隔（プロトタイプと同じ）
  DOT: 4,
  HEAD_Y: 420,       // 頭の位置（画面下から100px）

  // シミュレーションは固定ステップ（120Hz）。モニターのHzに依存しない
  STEP: 1 / 120,
  STEPS_PER_SEC: 120,

  // 速度（px/秒）。プロトタイプの 4px/frame @60fps = 240px/s を基準に
  LEVEL_SEC: 10,
  SPEED_BASE: 240,
  SPEED_INC_EARLY: 60,   // Lv3まではプロトタイプと同じ +1px/frame 相当
  SPEED_EARLY_UNTIL: 3,
  SPEED_INC_LATE: 24,    // Lv3以降は緩やかに（+0.4px/frame 相当）
  SPEED_MAX: 600,

  // 判定
  EAT_WINDOW: 24,        // ±24px（プロトタイプと同じ）
  MISS_LINE: 38.4,       // 頭より38.4px下を過ぎたら取り逃し（同上）
  POISON_WINDOW: 14,     // 毒リンゴは見た目より少し小さめの判定で理不尽さを減らす

  // コース生成（プロトタイプと同じ確率）
  START_STRAIGHT: 8,
  GOLD_AFTER: 15,
  GOLD_CHANCE: 0.16,
  LANE_CHANGE_CHANCE: 0.65,

  // 毒リンゴ
  POISON_FROM_LEVEL: 3,
  POISON_CHANCE_BASE: 0.18,
  POISON_CHANCE_INC: 0.03,
  POISON_CHANCE_MAX: 0.4,

  SCORE_RED: 100,
  SCORE_GOLD: 1000,

  // 演出
  COUNTDOWN_SEC: 1.2,    // 3-2-1 を 0.4秒ずつ（リトライが多いので短め）
  DEATH_FREEZE_SEC: 0.9,
  LANE_TWEEN_SEC: 0,     // 0 = 瞬間移動。0.05 などにすると頭が滑らかに動く
};

const C = CONFIG;

export function speedAtLevel(lv) {
  let s;
  if (lv <= C.SPEED_EARLY_UNTIL) {
    s = C.SPEED_BASE + (lv - 1) * C.SPEED_INC_EARLY;
  } else {
    s = C.SPEED_BASE + (C.SPEED_EARLY_UNTIL - 1) * C.SPEED_INC_EARLY
      + (lv - C.SPEED_EARLY_UNTIL) * C.SPEED_INC_LATE;
  }
  return Math.min(s, C.SPEED_MAX);
}

export function levelAtStep(step) {
  return 1 + Math.floor(step / (C.LEVEL_SEC * C.STEPS_PER_SEC));
}

// t秒時点での走行距離（速度は時間だけで決まるので一意に計算できる）
// → 将来のスコア上限チェックにも使える
export function distanceAtTime(t) {
  let d = 0, lv = 1, rem = t;
  while (rem > 0) {
    const dur = Math.min(rem, C.LEVEL_SEC);
    d += speedAtLevel(lv) * dur;
    rem -= dur;
    lv++;
  }
  return d;
}

export function levelAtDistance(w) {
  let lv = 1, acc = 0;
  for (;;) {
    const seg = speedAtLevel(lv) * C.LEVEL_SEC;
    if (acc + seg > w) return lv;
    acc += seg;
    lv++;
  }
}
