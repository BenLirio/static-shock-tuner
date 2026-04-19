// Static Shock Tuner — drag across CRT static to lock onto a daily hidden carrier.
// Daily deterministic target + deterministic fallback broadcast.
// One-shot AI flourish, cached by date in localStorage.

const AI_ENDPOINT = 'https://uy3l6suz07.execute-api.us-east-1.amazonaws.com/ai';
const SLUG = 'static-shock-tuner';

// ---------- date + hashing ----------
function todayUTC() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}
function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
// mulberry32 PRNG from a uint32 seed
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- today's target ----------
const DATE = todayUTC();
const DATE_HASH = hashStr(DATE + '::static-shock-tuner::v1');
const prng = mulberry32(DATE_HASH);
// keep it away from edges so it's always findable
const TARGET = {
  x: 0.15 + prng() * 0.70,   // 0.15–0.85
  y: 0.15 + prng() * 0.70,
};
// short callsign derived from date hash, e.g. "417"
const CALLSIGN = String(DATE_HASH % 1000).padStart(3, '0');

// ---------- fallback broadcasts (~25) ----------
const FALLBACKS = [
  "NINE · NINE · SEVEN — the dog knows.",
  "FOUR · TWO · THREE — meet me where the bread used to be.",
  "ONE · ONE · ONE · ONE — bring your second-best name.",
  "SIX · SIX · TWO — the moon filed a complaint.",
  "TWO · TWO · EIGHT — flowers received. destroy the mailbox.",
  "THREE · ZERO · NINE — the clock was lying. it always was.",
  "FIVE · FIVE · FIVE — wear the red coat. do not wave.",
  "SEVEN · ZERO · SEVEN — the pigeons have updated terms.",
  "EIGHT · EIGHT · ONE — count only in whispers tonight.",
  "ZERO · ONE · NINE — the lighthouse is lonely. be kind.",
  "FOUR · FOUR · FOUR — we forgive the bakery. once.",
  "SIX · ONE · TWO — your third drawer, back left, small envelope.",
  "TWO · NINE · FIVE — bury the letter. plant the rest.",
  "THREE · THREE · THREE — the cat is a double agent.",
  "ONE · EIGHT · SEVEN — the song from the car is the proof.",
  "NINE · FOUR · TWO — do not answer the second knock.",
  "FIVE · ZERO · ONE — the river is keeping notes.",
  "SEVEN · SEVEN · SEVEN — the birthday was a ruse.",
  "TWO · FIVE · ZERO — the stairs remember your weight.",
  "EIGHT · THREE · SIX — trust only the sandwich with olives.",
  "ZERO · ZERO · ZERO — the fog has receipts.",
  "FOUR · SIX · EIGHT — the radio is listening back.",
  "THREE · ONE · FOUR — the pie lied. eat it anyway.",
  "SIX · NINE · SIX — the candle voted against you.",
  "ONE · FIVE · TWO — the field is greener. do not believe it.",
];

const FALLBACK_MICRO = [
  "message will not repeat.",
  "please do not respond. they will know.",
  "verify via second radio, if possible.",
  "rebroadcast prohibited by the fog.",
  "message has been rewritten already.",
  "signed, the operator.",
  "this frequency expires at midnight utc.",
  "only the recipient will understand. maybe.",
];

const DAILY_BROADCAST = FALLBACKS[DATE_HASH % FALLBACKS.length];
const DAILY_MICRO = FALLBACK_MICRO[(DATE_HASH >> 8) % FALLBACK_MICRO.length];

// ---------- DOM ----------
const staticCanvas = document.getElementById('static');
const needleCanvas = document.getElementById('needle');
const sctx = staticCanvas.getContext('2d');
const nctx = needleCanvas.getContext('2d');
const barFill = document.getElementById('barfill');
const pctEl = document.getElementById('pct');
const hintCopy = document.getElementById('hintcopy');
const lockStatus = document.getElementById('lockstatus');
const lockClock = document.getElementById('lockclock');
const lockLine = lockStatus.parentElement;
const revealEl = document.getElementById('reveal');
const cardEl = document.getElementById('card');
const broadcastEl = document.getElementById('broadcast');
const microEl = document.getElementById('microcopy');
const cardDateEl = document.getElementById('cardDate');
const callsignEl = document.getElementById('callsign');
const utcDateEl = document.getElementById('utcdate');

callsignEl.textContent = CALLSIGN;
utcDateEl.textContent = DATE + ' UTC';
cardDateEl.textContent = DATE;

// ---------- state ----------
let pointer = null;         // { x: 0..1, y: 0..1 } or null
let strength = 0;            // 0..1
let smoothed = 0;
let lockTime = 0;            // seconds of continuous lock
let revealed = false;
let lastFrame = performance.now();
const LOCK_THRESHOLD = 0.86; // strength needed to accrue lock
const LOCK_DURATION = 1.5;   // seconds required

// ---------- resize canvases ----------
function sizeCanvases() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // static
  const sr = staticCanvas.getBoundingClientRect();
  staticCanvas.width = Math.max(2, Math.floor(sr.width * dpr));
  staticCanvas.height = Math.max(2, Math.floor(sr.height * dpr));
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // needle
  const nr = needleCanvas.getBoundingClientRect();
  needleCanvas.width = Math.max(2, Math.floor(nr.width * dpr));
  needleCanvas.height = Math.max(2, Math.floor(nr.height * dpr));
  nctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', sizeCanvases);

// ---------- pointer tracking ----------
function updatePointerFromEvent(e) {
  const r = staticCanvas.getBoundingClientRect();
  const t = e.touches ? e.touches[0] : e;
  if (!t) return;
  const x = (t.clientX - r.left) / r.width;
  const y = (t.clientY - r.top) / r.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  pointer = { x, y };
}
function clearPointer() { pointer = null; }

// mouse
staticCanvas.addEventListener('mousedown', (e) => { updatePointerFromEvent(e); });
window.addEventListener('mousemove', (e) => {
  // only track when button held OR we've entered via touch — allow simple hover too for desktop
  if (pointer || e.buttons > 0 || e.type === 'mousemove') {
    // allow simple move to tune on desktop (no need to hold)
    updatePointerFromEvent(e);
  }
});
staticCanvas.addEventListener('mouseleave', () => { /* keep last pointer */ });

// touch
staticCanvas.addEventListener('touchstart', (e) => { e.preventDefault(); updatePointerFromEvent(e); }, { passive: false });
staticCanvas.addEventListener('touchmove',  (e) => { e.preventDefault(); updatePointerFromEvent(e); }, { passive: false });
staticCanvas.addEventListener('touchend',   (e) => { e.preventDefault(); /* keep last pointer — stops lock */ clearPointer(); }, { passive: false });
staticCanvas.addEventListener('touchcancel',(e) => { e.preventDefault(); clearPointer(); }, { passive: false });

// ---------- strength calc ----------
function computeStrength() {
  if (!pointer) return 0;
  const dx = pointer.x - TARGET.x;
  const dy = pointer.y - TARGET.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  // max possible diagonal = sqrt(2); but we normalize by ~0.6 so only close positions get high
  // falloff: exp(-d / 0.18) gives a tight hill
  const s = Math.exp(-d / 0.18);
  return Math.max(0, Math.min(1, s));
}

// ---------- render static ----------
function drawStatic() {
  const w = staticCanvas.width;
  const h = staticCanvas.height;
  // we draw in CSS pixel units because ctx is already scaled by dpr
  const cw = staticCanvas.clientWidth;
  const ch = staticCanvas.clientHeight;

  // base black with a faint vignette glow toward target strength
  sctx.fillStyle = '#000';
  sctx.fillRect(0, 0, cw, ch);

  // noise field — sparse pixel dots, density scales DOWN with strength
  const density = 0.045 + (1 - smoothed) * 0.08; // stronger signal = less static
  const pixelSize = 2;
  const cols = Math.ceil(cw / pixelSize);
  const rows = Math.ceil(ch / pixelSize);
  const count = Math.floor(cols * rows * density);

  sctx.fillStyle = 'rgba(51, 255, 102, 0.85)';
  for (let i = 0; i < count; i++) {
    const x = Math.floor(Math.random() * cols) * pixelSize;
    const y = Math.floor(Math.random() * rows) * pixelSize;
    const a = 0.18 + Math.random() * 0.55;
    sctx.globalAlpha = a;
    sctx.fillRect(x, y, pixelSize, pixelSize);
  }
  sctx.globalAlpha = 1;

  // occasional horizontal glitch band
  if (Math.random() < 0.04) {
    const band = 4 + Math.random() * 10;
    const y = Math.random() * ch;
    sctx.fillStyle = 'rgba(51, 255, 102, 0.10)';
    sctx.fillRect(0, y, cw, band);
  }

  // signal halo — as strength rises, glow concentrates near pointer (the ear you're pressing)
  if (pointer && smoothed > 0.15) {
    const px = pointer.x * cw;
    const py = pointer.y * ch;
    const r = 40 + smoothed * 140;
    const grd = sctx.createRadialGradient(px, py, 2, px, py, r);
    grd.addColorStop(0, `rgba(51,255,102,${0.10 + 0.45 * smoothed})`);
    grd.addColorStop(1, 'rgba(51,255,102,0)');
    sctx.fillStyle = grd;
    sctx.beginPath();
    sctx.arc(px, py, r, 0, Math.PI * 2);
    sctx.fill();
  }

  // crosshair guides — very faint
  sctx.strokeStyle = 'rgba(51,255,102,0.06)';
  sctx.lineWidth = 1;
  sctx.beginPath();
  sctx.moveTo(cw / 2, 0); sctx.lineTo(cw / 2, ch);
  sctx.moveTo(0, ch / 2); sctx.lineTo(cw, ch / 2);
  sctx.stroke();
}

// ---------- render needle ----------
// A sine carrier. Amplitude + clarity grow with strength.
let phase = 0;
function drawNeedle(dt) {
  const w = needleCanvas.clientWidth;
  const h = needleCanvas.clientHeight;
  nctx.clearRect(0, 0, w, h);

  // baseline
  nctx.strokeStyle = 'rgba(51,255,102,0.2)';
  nctx.lineWidth = 1;
  nctx.beginPath();
  nctx.moveTo(0, h / 2);
  nctx.lineTo(w, h / 2);
  nctx.stroke();

  // carrier (snaps into a clean sine as strength rises; noisy otherwise)
  phase += dt * (2 + smoothed * 6);
  const amp = 6 + smoothed * (h / 2 - 8);
  const freq = 2 + smoothed * 8;
  const noiseAmp = (1 - smoothed) * (h / 2 - 4);

  nctx.lineWidth = 2;
  // chromatic-aberration ghosts
  const draws = [
    { dx: -1.2, color: `rgba(255, 50, 90, ${0.28 + 0.2 * smoothed})` },
    { dx:  1.2, color: `rgba(0, 180, 255, ${0.22 + 0.2 * smoothed})` },
    { dx:  0,   color: `rgba(51, 255, 102, ${0.75 + 0.25 * smoothed})` },
  ];
  for (const d of draws) {
    nctx.strokeStyle = d.color;
    nctx.beginPath();
    const step = 2;
    for (let x = 0; x <= w; x += step) {
      const t = x / w;
      const sine = Math.sin(t * Math.PI * 2 * freq + phase) * amp;
      const noise = (Math.random() - 0.5) * 2 * noiseAmp;
      const y = h / 2 + sine + noise;
      if (x === 0) nctx.moveTo(x + d.dx, y);
      else nctx.lineTo(x + d.dx, y);
    }
    nctx.stroke();
  }
}

// ---------- copy states ----------
function setHint(text, dim) {
  hintCopy.textContent = text;
  hintCopy.classList.toggle('dim', !!dim);
}

function setLockLineClass(cls) {
  lockLine.classList.remove('locking', 'locked');
  if (cls) lockLine.classList.add(cls);
}

// ---------- reveal ----------
let aiTried = false;
async function maybeUpgradeCopy() {
  if (aiTried) return;
  aiTried = true;

  const cacheKey = 'sst_broadcast_' + DATE;
  const cachedRaw = localStorage.getItem(cacheKey);
  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw);
      if (cached && cached.broadcast) {
        applyBroadcast(cached.broadcast, cached.micro || DAILY_MICRO);
        return;
      }
    } catch (_) {}
  }

  // Single AI call per device per day. Fallback already rendered.
  try {
    const messages = [
      {
        role: 'system',
        content: 'You write a single short message for a Cold-War numbers-station broadcast. Output strict JSON with exactly two string fields: "broadcast" and "micro". "broadcast" must start with 2 to 4 single-digit numbers spelled as uppercase English words separated by " \u00B7 " (middle dot), then an em dash " \u2014 ", then a surreal specific sentence (under 12 words). No emojis. No hashtags. No quotes. "micro" is one lowercase end-of-transmission note under 9 words. Absurd, specific, deterministic-feeling.'
      },
      {
        role: 'user',
        content: 'Date: ' + DATE + '. Callsign EF-' + CALLSIGN + '. Today only. One transmission.'
      }
    ];
    const res = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: SLUG, messages, max_tokens: 120, response_format: 'json_object' })
    });
    if (!res.ok) throw new Error('http_' + res.status);
    const data = await res.json();
    let parsed = null;
    try { parsed = JSON.parse(data.content); } catch (_) {}
    const bc = parsed && typeof parsed.broadcast === 'string' && parsed.broadcast.trim();
    const mc = parsed && typeof parsed.micro === 'string' && parsed.micro.trim();
    if (bc) {
      const clean = bc.slice(0, 180);
      const mcClean = (mc || DAILY_MICRO).slice(0, 80);
      try { localStorage.setItem(cacheKey, JSON.stringify({ broadcast: clean, micro: mcClean })); } catch (_) {}
      applyBroadcast(clean, mcClean);
    }
  } catch (_) {
    // silent — deterministic fallback already on screen
  }
}

function applyBroadcast(text, micro) {
  // color runs of digit-words (ONE, TWO, ... ZERO) to feel numbers-station-y
  const digitWords = ['ZERO','ONE','TWO','THREE','FOUR','FIVE','SIX','SEVEN','EIGHT','NINE','TEN','ELEVEN','TWELVE','THIRTEEN','FOURTEEN','FIFTEEN','SIXTEEN','SEVENTEEN','EIGHTEEN','NINETEEN','TWENTY'];
  const re = new RegExp('\\b(' + digitWords.join('|') + ')\\b', 'gi');
  const safe = String(text).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'})[c]);
  const html = safe.replace(re, (m) => '<span class="num">' + m.toUpperCase() + '</span>');
  broadcastEl.innerHTML = html;
  microEl.textContent = '— ' + micro + ' —';
}

function reveal() {
  if (revealed) return;
  revealed = true;
  // render fallback immediately so the UX never waits
  applyBroadcast(DAILY_BROADCAST, DAILY_MICRO);
  revealEl.classList.remove('hidden');
  // next frame so the transition runs
  requestAnimationFrame(() => {
    revealEl.classList.add('visible');
    // scroll into view — card should sit above the fold even without scrolling on a tall screen
    revealEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  // upgrade asynchronously with AI (cached per day), once
  maybeUpgradeCopy();
  setHint('transmission received.', true);
  setLockLineClass('locked');
  lockStatus.textContent = '— carrier locked —';
  lockClock.textContent = '1.5s';
}

// ---------- loading / error copy ----------
// Pre-interaction: "drag to tune" (in HTML by default)
// Loading during lock: "scanning the ether..."
// Error: if the pointer leaves mid-lock: "signal lost — drag again"

// ---------- main loop ----------
function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  const raw = computeStrength();
  // smooth for nicer bar
  smoothed += (raw - smoothed) * 0.20;
  strength = smoothed;

  // UI
  const pct = Math.round(strength * 100);
  barFill.style.width = pct + '%';
  pctEl.textContent = pct + '%';

  // lock accumulation
  if (!revealed) {
    if (pointer && raw >= LOCK_THRESHOLD) {
      lockTime += dt;
      setLockLineClass(lockTime >= LOCK_DURATION ? 'locked' : 'locking');
      lockStatus.textContent = 'scanning the ether...';
      setHint('hold steady — you found the carrier', false);
    } else {
      if (lockTime > 0.05 && pointer) {
        // user was close but drifted
        setHint('signal lost — drag again', true);
      } else if (!pointer) {
        setHint('drag to tune', false);
      } else if (raw > 0.55) {
        setHint('warmer... the carrier is near', false);
      } else if (raw > 0.30) {
        setHint('faint bearing — keep moving', true);
      } else {
        setHint('drag to tune', true);
      }
      lockTime = Math.max(0, lockTime - dt * 1.8);
      setLockLineClass(null);
      lockStatus.textContent = '— no carrier —';
    }
    lockClock.textContent = lockTime.toFixed(1) + 's';
    if (lockTime >= LOCK_DURATION) reveal();
  }

  drawStatic();
  drawNeedle(dt);

  requestAnimationFrame(frame);
}

// ---------- boot ----------
function boot() {
  sizeCanvases();
  lastFrame = performance.now();
  requestAnimationFrame(frame);
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  boot();
} else {
  document.addEventListener('DOMContentLoaded', boot);
}

// ---------- share ----------
function share() {
  if (navigator.share) {
    navigator.share({ title: document.title, url: location.href }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(location.href)
      .then(() => alert('Link copied — same broadcast for them today.'))
      .catch(() => alert(location.href));
  } else {
    alert(location.href);
  }
}
// expose for inline onclick
window.share = share;
