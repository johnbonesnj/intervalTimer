'use strict';

const READY_SECS = 3;      // lead-in before set 1
const WARN_SECS = 3;       // beeps at 3, 2, 1 seconds left
const STORE_KEY = 'intervals.favs.v1';

const $ = (id) => document.getElementById(id);

// ---------- Favorites ----------
function loadFavs() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; }
}
function saveFavs(favs) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(favs)); } catch {}
}
function fmtLen(s) {
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}
function renderFavs() {
  const favs = loadFavs();
  const ul = $('favs');
  ul.replaceChildren();
  $('no-favs').hidden = favs.length > 0;
  favs.forEach((f, i) => {
    const li = document.createElement('li');
    li.className = 'fav';
    li.innerHTML = `
      <button class="fav-main"><div class="fav-name"></div><div class="fav-meta"></div></button>
      <div class="fav-actions"><button class="edit">Edit</button><button class="del">Delete</button></div>`;
    li.querySelector('.fav-name').textContent = f.name;
    li.querySelector('.fav-meta').textContent = `${fmtLen(f.secs)} × ${f.sets} sets`;
    li.querySelector('.fav-main').onclick = () => start(f.secs, f.sets, f.name);
    li.querySelector('.edit').onclick = () => {
      $('secs').value = f.secs; $('sets').value = f.sets; $('fav-name').value = f.name;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    li.querySelector('.del').onclick = () => {
      if (li.dataset.confirm) {
        const all = loadFavs(); all.splice(i, 1); saveFavs(all); renderFavs();
      } else {
        li.dataset.confirm = '1';
        const b = li.querySelector('.del'); b.textContent = 'Sure?';
        setTimeout(() => { if (b.isConnected) { delete li.dataset.confirm; b.textContent = 'Delete'; } }, 3000);
      }
    };
    ul.appendChild(li);
  });
}

function readInputs() {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || lo)));
  const secs = clamp($('secs').value, 1, 3600);
  const sets = clamp($('sets').value, 1, 99);
  $('secs').value = secs; $('sets').value = sets;
  return { secs, sets };
}

document.querySelectorAll('[data-step]').forEach((b) => {
  b.onclick = () => {
    const input = $(b.dataset.step);
    const delta = Number(b.dataset.delta);
    let v = (Number(input.value) || 0) + delta;
    // secs stepper: step by 5, but allow small values
    if (b.dataset.step === 'secs' && v < 5) v = delta < 0 ? Math.max(1, (Number(input.value) || 1) - 1) : 5;
    input.value = Math.max(1, v);
  };
});

$('save').onclick = () => {
  const { secs, sets } = readInputs();
  const name = $('fav-name').value.trim() || `${fmtLen(secs)} × ${sets}`;
  const favs = loadFavs();
  const existing = favs.findIndex((f) => f.name.toLowerCase() === name.toLowerCase());
  if (existing >= 0) favs[existing] = { name, secs, sets };
  else favs.push({ name, secs, sets });
  saveFavs(favs);
  $('fav-name').value = '';
  renderFavs();
};

$('start').onclick = () => {
  const { secs, sets } = readInputs();
  start(secs, sets, '');
};

// ---------- Audio ----------
let ctx = null;
function initAudio() {
  // Play through the iPhone silent switch (Safari 17+).
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
  }
  if (ctx.state !== 'running') ctx.resume();
  // Silent blip to fully unlock audio on iOS within the user gesture.
  tone(440, 0.01, 0.0001);
}
function tone(freq, dur, vol = 0.5, type = 'square', when = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(vol, t + 0.005);
  gain.gain.setValueAtTime(vol, t + Math.max(0.005, dur - 0.03));
  gain.gain.linearRampToValueAtTime(0, t + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}
const sound = {
  warn: () => tone(880, 0.12, 0.35),
  go: () => tone(1320, 0.45, 0.45),
  done: () => { tone(784, 0.25, 0.4, 'square', 0); tone(988, 0.25, 0.4, 'square', 0.28); tone(1319, 0.7, 0.4, 'square', 0.56); },
};

// ---------- Wake lock ----------
let wakeLock = null;
async function lockScreen() {
  try { if ('wakeLock' in navigator && !wakeLock) {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } } catch {}
}
function unlockScreen() { try { wakeLock && wakeLock.release(); } catch {} wakeLock = null; }

// ---------- Timer ----------
// Timeline: [ready READY_SECS] [set 1] [set 2] ... [set N]
let run = null;

function start(secs, sets, name) {
  initAudio();
  lockScreen();
  run = { secs, sets, name, startedAt: performance.now(), pausedAt: null, pausedTotal: 0, last: null, timer: null };
  $('home').hidden = true;
  $('run').hidden = false;
  $('run-name').textContent = name || `${fmtLen(secs)} × ${sets}`;
  $('pause').textContent = 'Pause';
  run.timer = setInterval(tick, 50);
  tick();
}

function elapsed() {
  const now = run.pausedAt ?? performance.now();
  return (now - run.startedAt - run.pausedTotal) / 1000;
}

// Where are we on the timeline at time t (seconds)?
function position(t) {
  if (t < READY_SECS) return { seg: 0, len: READY_SECS, left: Math.ceil(READY_SECS - t) };
  const w = t - READY_SECS;
  const seg = Math.floor(w / run.secs) + 1;
  if (seg > run.sets) return { seg: run.sets + 1, len: 0, left: 0 }; // done
  return { seg, len: run.secs, left: Math.ceil(run.secs - (w - (seg - 1) * run.secs)) };
}

function tick() {
  if (!run) return;
  const p = position(elapsed());
  const prev = run.last;
  const changed = !prev || prev.seg !== p.seg || prev.left !== p.left;
  run.last = p;

  if (changed) {
    const done = p.seg > run.sets;
    if (done) { sound.done(); finish(); return; }

    const newSeg = !prev || prev.seg !== p.seg;
    if (newSeg && p.seg >= 1) sound.go();
    else if (p.seg === 0 && p.left <= WARN_SECS) sound.warn();       // get-ready countdown
    else if (p.left <= WARN_SECS && p.left < p.len) sound.warn();     // set ending soon

    render(p);
  }
}

function render(p) {
  const el = $('run');
  const ready = p.seg === 0;
  el.className = 'screen ' + (ready ? 'ready' : 'work') + (!ready && p.left <= WARN_SECS ? ' warning' : '') + (run.pausedAt ? ' paused' : '');
  $('phase').textContent = ready ? 'Get ready' : 'Go';
  $('clock').textContent = p.left >= 60 ? `${Math.floor(p.left / 60)}:${String(p.left % 60).padStart(2, '0')}` : p.left;
  $('setinfo').textContent = ready ? `${run.sets} sets` : `Set ${p.seg} of ${run.sets}`;
}

function finish() {
  clearInterval(run.timer);
  const el = $('run');
  el.className = 'screen done';
  $('phase').textContent = 'Done';
  $('clock').textContent = '✓';
  $('setinfo').textContent = `${run.sets} × ${fmtLen(run.secs)} complete`;
  $('pause').textContent = 'Again';
  run.finished = true;
  unlockScreen();
}

$('pause').onclick = () => {
  if (!run) return;
  if (run.finished) { const { secs, sets, name } = run; start(secs, sets, name); return; }
  if (run.pausedAt) {
    initAudio();
    run.pausedTotal += performance.now() - run.pausedAt;
    run.pausedAt = null;
    $('pause').textContent = 'Pause';
    lockScreen();
  } else {
    run.pausedAt = performance.now();
    $('pause').textContent = 'Resume';
  }
  render(run.last);
};

$('stop').onclick = () => {
  if (run) clearInterval(run.timer);
  run = null;
  unlockScreen();
  $('run').hidden = true;
  $('home').hidden = false;
};

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && run && !run.finished) {
    if (ctx && ctx.state !== 'running') ctx.resume();
    if (!run.pausedAt) lockScreen();
  }
});

renderFavs();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
