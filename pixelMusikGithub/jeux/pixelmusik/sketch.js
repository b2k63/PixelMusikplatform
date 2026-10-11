// ─────────────────────────────────────────────────────────────
//  PIXEL MUSIK — version web (p5.js + MediaPipe + WebAudio)
//  Port de PixelMUSIK5.pde : plus d'OSC ni de Python, tout tourne
//  dans le navigateur. Sans caméra, la souris remplace la main.
// ─────────────────────────────────────────────────────────────
const FREQS = [293.66, 349.23, 369.99, 440, 554.37, 587.33, 659.26, 739.99, 830.61, 880, 987.77, 1108.73, 1318.51];
const NOTE_NAMES = ["Fa3","Sol#3","La3","Do4","Mi4","Fa4","Sol4","La4","Si4","Do5","Ré5","Mi5","Sol5"];
const RIFFS = [
  { name: "Tetris", notes: [11,8,9,10,9,8,7,7], durs: [400,200,200,400,200,200,400,400],
    opts: ["Tetris","Zelda","Titanic"], answer: 0 },
  { name: "Super Mario", notes: [11,11,-1,11,-1,9,11,12,-1,6], durs: [150,150,150,150,150,150,300,300,300,300],
    opts: ["Sonic","Super Mario","One Piece"], answer: 1 },
  { name: "Star Wars", notes: [2,2,2,0,3,2,0,3,2], durs: [500,500,500,375,125,500,375,125,750],
    opts: ["Star Wars","Harry Potter","Minecraft"], answer: 0 }
];
const SM = 0.07, HOLD_MS = 500, THRESHOLD = 128;
const GREEN = [60, 200, 80], RED = [200, 60, 60];

// États : -1 démarrage, 0 accueil, 1 jeu, 2 victoire+replay, 3 quiz, 4 résultat
let state = -1, level = 0, noteIdx = 0;
let notePlaying = false, noteStartMs = 0, holding = false, holdStart = 0, holdProgress = 0, greenIntensity = 0;
let replayIdx = 0, replayNoteMs = 0, replayDone = false, replayStarted = false;
let selectedBtn = -1, answered = false, correct = false, answeredTime = 0;
let noteSuccessAnim = 0, halos = [];
let rightHandY = 0.5, sRY = 0.5;

// Caméra / pose
let video, camOK = false, landmarker = null, lastVideoT = -1, lastPoseMs = -9999, camStatus = "";
let small, sctx, PIXEL_SIZE = 9;

// Audio
let AC, osc = [];

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  small = document.createElement("canvas");
  sctx = small.getContext("2d", { willReadFrequently: true });
  computeGrid();
}
function windowResized() { resizeCanvas(windowWidth, windowHeight); computeGrid(); }
function computeGrid() {
  PIXEL_SIZE = max(6, round(width / 160));
  small.width = floor(width / PIXEL_SIZE);
  small.height = floor(height / PIXEL_SIZE);
}
const fb = () => { textFont("Pixelify Sans"); textStyle(BOLD); };
const fm = () => { textFont("Courier New"); textStyle(NORMAL); };

// ── Démarrage (geste utilisateur requis pour audio + caméra) ──
async function startApp() {
  initAudio();
  state = 0;
  camStatus = "Chargement de la caméra…";
  try { await initCam(); }
  catch (e) { console.warn(e); camStatus = "Caméra indisponible : contrôle à la souris"; }
}
function initAudio() {
  AC = new (window.AudioContext || window.webkitAudioContext)();
  [["triangle"], ["triangle"], ["sine"]].forEach(([type]) => {
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; g.gain.value = 0; o.connect(g).connect(AC.destination); o.start();
    osc.push({ o, g });
  });
}
async function initCam() {
  video = document.getElementById("cam");
  video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" } });
  await video.play();
  camOK = true;
  camStatus = "Chargement du suivi du corps…";
  const V = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
  const { PoseLandmarker, FilesetResolver } = await import(V + "/vision_bundle.mjs");
  const fs = await FilesetResolver.forVisionTasks(V + "/wasm");
  landmarker = await PoseLandmarker.createFromOptions(fs, {
    baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task", delegate: "GPU" },
    runningMode: "VIDEO", numPoses: 1
  });
  camStatus = "Lève la main droite devant la caméra";
}
function updatePose() {
  if (landmarker && video && video.currentTime !== lastVideoT) {
    lastVideoT = video.currentTime;
    const res = landmarker.detectForVideo(video, performance.now());
    const lm = res.landmarks && res.landmarks[0];
    if (lm) {
      // poignet droit = point 16 ; on resserre la plage pour qu'elle reste atteignable
      rightHandY = constrain(map(1 - lm[16].y, 0.15, 0.85, 0, 1), 0, 1);
      lastPoseMs = millis();
    }
  }
  if (millis() - lastPoseMs > 1500) rightHandY = constrain(1 - mouseY / height, 0, 1); // repli souris
}

// ── Boucle principale ─────────────────────────────────────────
function draw() {
  background(255);
  if (state === -1) return drawStart();
  updatePose();
  sRY = lerp(sRY, rightHandY, SM);
  if (camOK) drawPixelSilhouette();
  for (let i = halos.length - 1; i >= 0; i--) { halos[i].update(); halos[i].draw(); if (halos[i].dead()) halos.splice(i, 1); }
  [drawAccueil, drawJeu, drawVictoire, drawQuiz, drawResultat][state]();
  fm(); fill(0, 90); textSize(11); textAlign(RIGHT, BOTTOM);
  text(millis() - lastPoseMs < 1500 ? "Suivi du corps actif" : camStatus || "Souris", width - 14, height - 14);
}

function drawStart() {
  fb(); textAlign(CENTER, CENTER); fill(...GREEN); textSize(28);
  text("PIXEL MUSIK", width / 2, height * 0.30);
  drawBtn(width / 2, height * 0.5, 380, "Cliquer pour démarrer");
  fm(); fill(0, 120); textSize(12);
  text("Autorise la caméra pour jouer avec ta main.", width / 2, height * 0.6);
}
function drawAccueil() {
  stopSound();
  fb(); textAlign(CENTER, CENTER); fill(40, 190, 70); textSize(28);
  text("PIXEL MUSIK", width / 2, height * 0.20);
  fill(40, 160, 60); textSize(14);
  text("Place ta main sur le cercle pour jouer chaque note.", width / 2, height * 0.30);
  fm(); fill(60, 140, 60, 180); textSize(12);
  text("Devine ensuite quel son tu as joué.", width / 2, height * 0.345);
  ["I  —  Niveau 1", "II  —  Niveau 2", "III  —  Niveau 3"].forEach((l, i) => drawBtn(width / 2, height * (0.48 + i * 0.13), 380, l));
}

function drawJeu() {
  const { notes, durs, name } = RIFFS[level];
  if (noteIdx >= notes.length) { stopSound(); state = 2; replayDone = replayStarted = false; replayIdx = 0; return; }
  const now = millis();
  if (notes[noteIdx] === -1) { // silence : on attend
    if (!notePlaying) { stopSound(); notePlaying = true; noteStartMs = now; }
    if (now - noteStartMs >= durs[noteIdx]) { noteIdx++; notePlaying = false; }
    drawProgressDots(notes); drawBtnHome(); return;
  }
  const tgt = notes[noteIdx], tgtY = noteToY(tgt), handY = height * (1 - sRY);
  const onTgt = abs(handY - tgtY) < height * 0.09;
  greenIntensity = lerp(greenIntensity, onTgt ? 1 : 0, 0.08);

  if (!notePlaying) {
    if (onTgt) {
      if (!holding) { holding = true; holdStart = now; }
      holdProgress = min(1, (now - holdStart) / HOLD_MS);
      if (holdProgress >= 1) {
        notePlaying = true; noteStartMs = now; playNote(tgt);
        noteSuccessAnim = 1; halos.push(new Halo(width * 0.72, tgtY, true));
      }
    } else { holding = false; holdProgress = max(0, holdProgress - 0.03); }
  } else if (now - noteStartMs >= durs[noteIdx]) {
    noteIdx++; notePlaying = false; holding = false; holdProgress = 0;
  }

  const pulse = 0.5 + 0.5 * sin(now * 0.004);
  noteSuccessAnim = lerp(noteSuccessAnim, 0, 0.06);
  drawTargetCircle(width * 0.72, tgtY, onTgt, pulse, 1 + noteSuccessAnim * 0.35);
  drawProgressDots(notes);

  fb(); textSize(32 + noteSuccessAnim * 18); textAlign(CENTER, CENTER);
  fill(notePlaying ? lerpColor(color(0, 180), color(40, 200, 70), noteSuccessAnim) : onTgt ? color(40, 200, 70) : color(0, 160));
  text(NOTE_NAMES[tgt], width * 0.72 - 80, tgtY);

  noStroke(); fill(onTgt ? color(60, 200, 80, 200) : color(0, 120)); ellipse(width * 0.72, handY, 28, 28);
  if (holding && !notePlaying) {
    stroke(60, 200, 80, 230); strokeWeight(3); noFill();
    arc(width * 0.72, handY, 48, 48, -HALF_PI, -HALF_PI + TWO_PI * holdProgress);
  }
  fm(); noStroke(); fill(0, 140); textSize(12); textAlign(CENTER, BOTTOM);
  text(`Niveau ${level + 1}  ·  note ${noteIdx + 1}/${notes.length}`, width / 2, height - 18);
  drawBtnHome();
}

function drawVictoire() {
  const { notes, durs } = RIFFS[level], now = millis();
  if (!replayStarted) {
    replayStarted = true; replayIdx = 0; replayNoteMs = now;
    notes[0] >= 0 ? playNote(notes[0]) : stopSound();
  }
  if (!replayDone && now - replayNoteMs >= durs[replayIdx]) {
    replayIdx++; replayNoteMs = now;
    if (replayIdx >= notes.length) { replayDone = true; stopSound(); }
    else notes[replayIdx] >= 0 ? playNote(notes[replayIdx]) : stopSound();
  }
  noStroke(); fill(60, 200, 80, 25); rect(0, 0, width, height);
  fb(); fill(0, 220); textSize(30); textAlign(CENTER, CENTER);
  text("Niveau terminé !", width / 2, height * 0.26);
  const sx = width / 2 - (notes.length * 20) / 2;
  notes.forEach((_, i) => {
    noStroke(); fill(i < replayIdx ? color(60, 200, 80) : i === replayIdx ? color(0, 200) : color(0, 45));
    ellipse(sx + i * 20, height * 0.40, i === replayIdx ? 14 : 8, i === replayIdx ? 14 : 8);
  });
  fm(); fill(0, 110); textSize(12); text(replayDone ? "..." : "Écoute...", width / 2, height * 0.47);
  if (replayDone) drawBtn(width / 2, height * 0.58, 320, "Deviner ce morceau");
  drawBtnHome();
}

function drawQuiz() {
  fb(); fill(0, 210); textSize(22); textAlign(CENTER, CENTER);
  text("C'est quel morceau ?", width / 2, height * 0.24);
  const r = RIFFS[level];
  r.opts.forEach((o, i) => {
    let c = [80, 80, 80];
    if (answered && i === r.answer) c = GREEN; else if (answered && i === selectedBtn) c = RED;
    drawBtnColor(width / 2, height * (0.38 + i * 0.14), 400, o, c, answered);
  });
  if (answered && millis() - answeredTime > 2200) state = 4;
  drawBtnHome();
}
function drawResultat() {
  fb(); fill(0, 210); textSize(24); textAlign(CENTER, CENTER);
  text(correct ? "Bravo !" : "C'était " + RIFFS[level].name, width / 2, height * 0.28);
  drawBtn(width / 2, height * 0.46, 300, "Rejouer");
  drawBtn(width / 2, height * 0.59, 300, level < 2 ? "Niveau suivant" : "Menu");
  drawBtnHome();
}

// ── Dessin utilitaires ────────────────────────────────────────
const overBtn = (x, y, w, h) => mouseX > x - w / 2 && mouseX < x + w / 2 && mouseY > y - h / 2 && mouseY < y + h / 2;
function drawBtn(x, y, w, label) {
  const h = 42, hov = overBtn(x, y, w, h);
  noStroke(); fill(hov ? 30 : 0); rect(x - w / 2, y - h / 2, w, h);
  stroke(255, hov ? 255 : 140); strokeWeight(1); noFill(); rect(x - w / 2, y - h / 2, w, h);
  noStroke(); fill(255); fb(); textSize(13); textAlign(CENTER, CENTER); text(label, x, y);
}
function drawBtnHome() {
  const hov = mouseX > 16 && mouseX < 126 && mouseY > 16 && mouseY < 50;
  noStroke(); fill(hov ? 30 : 0); rect(16, 16, 110, 34);
  stroke(255, hov ? 255 : 100); strokeWeight(1); noFill(); rect(16, 16, 110, 34);
  noStroke(); fill(255); fm(); textSize(11); textAlign(LEFT, CENTER); text("< Accueil", 26, 33);
}
function drawBtnColor(x, y, w, label, c, locked) {
  const h = 42, hov = !locked && overBtn(x, y, w, h);
  noStroke(); fill(c[0] * 0.4, c[1] * 0.4, c[2] * 0.4, hov ? 255 : 200); rect(x - w / 2, y - h / 2, w, h);
  stroke(c[0], c[1], c[2], hov ? 255 : 180); strokeWeight(1); noFill(); rect(x - w / 2, y - h / 2, w, h);
  noStroke(); fill(255); fb(); textSize(11); textAlign(CENTER, CENTER); text(label, x, y);
}
function drawTargetCircle(x, y, on, pulse, sc) {
  const sz = (50 + pulse * 10) * sc;
  noFill(); stroke(on ? color(60, 200, 80, 55 + pulse * 90) : color(0, 55 + pulse * 90)); strokeWeight(on ? 2.5 : 1.5);
  ellipse(x, y, sz + 32, sz + 32);
  noStroke(); fill(on ? color(60, 200, 80, 190) : color(0, 0, 0, 95 + pulse * 60)); ellipse(x, y, sz, sz);
  stroke(0, 20); strokeWeight(1); line(0, y, width, y);
}
function drawProgressDots(notes) {
  const sy = height * 0.14, step = (height * 0.72) / max(notes.length, 1);
  notes.forEach((_, i) => {
    noStroke(); fill(i < noteIdx ? color(60, 200, 80, 210) : i === noteIdx ? color(0, 210) : color(0, 40));
    ellipse(22, sy + i * step, i === noteIdx ? 13 : 8, i === noteIdx ? 13 : 8);
  });
}
const noteToY = (i) => map(i, 0, FREQS.length - 1, height * 0.85, height * 0.10);

function drawPixelSilhouette() {
  const cols = small.width, rows = small.height;
  sctx.save(); sctx.translate(cols, 0); sctx.scale(-1, 1); // effet miroir
  sctx.drawImage(video, 0, 0, cols, rows); sctx.restore();
  const d = sctx.getImageData(0, 0, cols, rows).data, ctx = drawingContext, g = greenIntensity;
  ctx.fillStyle = `rgb(${60 * g | 0},${200 * g | 0},${80 * g | 0})`;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const k = (r * cols + c) * 4;
    if (0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2] < THRESHOLD)
      ctx.fillRect(c * PIXEL_SIZE, r * PIXEL_SIZE, PIXEL_SIZE - 1, PIXEL_SIZE - 1);
  }
}

// ── Son (WebAudio) ────────────────────────────────────────────
function playNote(i) {
  if (!AC) return;
  const f = FREQS[i], t = AC.currentTime;
  [[f, 0.28], [f * 1.007, 0.16], [f * 0.5, 0.12]].forEach(([fr, a], k) => {
    osc[k].o.frequency.setValueAtTime(fr, t); osc[k].g.gain.setTargetAtTime(a, t, 0.01);
  });
}
function stopSound() { if (AC) osc.forEach(({ g }) => g.gain.setTargetAtTime(0, AC.currentTime, 0.02)); }

// ── Interactions ──────────────────────────────────────────────
function startLevel(l) {
  level = l; noteIdx = 0; notePlaying = holding = false; holdProgress = greenIntensity = 0;
  answered = false; selectedBtn = -1; halos = []; stopSound(); state = 1;
}
function mousePressed() {
  if (state === -1) { if (overBtn(width / 2, height * 0.5, 380, 42)) startApp(); return; }
  if (state !== 0 && mouseX > 16 && mouseX < 126 && mouseY > 16 && mouseY < 50) { stopSound(); state = 0; return; }
  if (state === 0) {
    for (let i = 0; i < 3; i++) if (overBtn(width / 2, height * (0.48 + i * 0.13), 380, 38)) return startLevel(i);
  } else if (state === 2 && replayDone) {
    if (overBtn(width / 2, height * 0.58, 320, 38)) { answered = false; selectedBtn = -1; state = 3; }
  } else if (state === 3 && !answered) {
    RIFFS[level].opts.forEach((_, i) => {
      if (!answered && overBtn(width / 2, height * (0.38 + i * 0.14), 400, 38)) {
        selectedBtn = i; answered = true; correct = i === RIFFS[level].answer; answeredTime = millis();
        halos.push(new Halo(width / 2, height / 2, correct));
      }
    });
  } else if (state === 4) {
    if (overBtn(width / 2, height * 0.46, 300, 38)) startLevel(level);
    else if (overBtn(width / 2, height * 0.59, 300, 38)) level < 2 ? startLevel(level + 1) : (state = 0);
  }
}
function keyPressed() { if (key === "f" || key === "F") fullscreen(!fullscreen()); }

class Halo {
  constructor(x, y, ok) { this.x = x; this.y = y; this.ok = ok; this.r = 8; this.maxR = random(80, 220); this.a = 200; }
  update() { this.r += (this.maxR - this.r) * 0.055; this.a -= 2.5; }
  draw() {
    const c = this.ok ? GREEN : RED; noFill();
    stroke(c[0], c[1], c[2], this.a); strokeWeight(1.8); ellipse(this.x, this.y, this.r * 2);
    stroke(c[0], c[1], c[2], this.a * 0.3); strokeWeight(0.8); ellipse(this.x, this.y, this.r * 3);
  }
  dead() { return this.a <= 0; }
}
