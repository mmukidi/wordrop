// Verify a hand-designed monotonic target curve against the survival ceiling.
const GRID = 14*8, START = 4*8;
const RISE_TILES = 8, CLEAR_TILES = 3.3, BEST_WORD = 9.5;
const mult = n => 1 + (n-1)*0.5;
const speed = n => n <= 10 ? [15,12.5,10.5,9,7.5,6.5,5.5,5,4.5,4][n-1] : 4;
const TARGETS = [100,175,250,325,400,475,550,625,700,775];
const target = n => n <= 10 ? TARGETS[n-1] : 775 + (n-10)*50;

function maxPts(n, spw) {
  const net = RISE_TILES/speed(n) - CLEAR_TILES/spw;
  if (net <= 0) return Infinity;
  return ((GRID-START)/net/spw) * BEST_WORD * mult(n);
}
console.log("Lvl  rise  target   strongMax  use%   avgMax  use%   verdict");
let bad = 0;
for (const n of [1,2,3,4,5,6,7,8,9,10,12,15,20,25]) {
  const s = maxPts(n,3.5), a = maxPts(n,5.0), t = target(n);
  const su = s===Infinity ? 0 : t/s, au = a===Infinity ? 0 : t/a;
  // Strong player should need <70% of their ceiling; average <130%.
  const ok = su < 0.70 && au < 1.35;
  if (!ok) bad++;
  console.log(
    String(n).padEnd(4), String(speed(n)+"s").padEnd(5), String(t).padEnd(8),
    (s===Infinity?"endless":Math.round(s)).toString().padEnd(10),
    (s===Infinity?"--":(su*100).toFixed(0)+"%").padEnd(6),
    (a===Infinity?"endless":Math.round(a)).toString().padEnd(7),
    (a===Infinity?"--":(au*100).toFixed(0)+"%").padEnd(6),
    ok ? "OK" : "TOO HARD"
  );
}
console.log(bad === 0 ? "\nAll sampled levels winnable with headroom." : `\n${bad} level(s) too hard.`);
