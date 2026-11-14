import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { loadSettings, saveSettings } from './settings.js';

const settings = loadSettings();
const canvas = document.getElementById('c');
const status = document.getElementById('status');
const fileInput = document.getElementById('vrmFile');
const trackingBtn = document.getElementById('trackingBtn');
const calibrateBtn = document.getElementById('calibrateBtn');
const cleanBtn = document.getElementById('cleanBtn');
const exitCleanBtn = document.getElementById('exitClean');
const camVideo = document.getElementById('cam');
const perfEl = document.getElementById('perf');
const gpuMode = document.getElementById('gpuMode');
const aaToggle = document.getElementById('antialias');
const vcamBtn = document.getElementById('vcamBtn');
const calibGuide = document.getElementById('calibGuide');
const calibTitle = document.getElementById('calibTitle');
const calibPose = document.getElementById('calibPose');
const calibText = document.getElementById('calibText');
const bgLayer = document.getElementById('bgLayer');
const bgType = document.getElementById('bgType');
const bgColor = document.getElementById('bgColor');
const bgImage = document.getElementById('bgImage');

const params = new URLSearchParams(location.search);
const isOutputMode = params.has('output');
const isControlMode = params.has('control');
const isElectron = /electron/i.test(navigator.userAgent);
if (isOutputMode) document.body.classList.add('output-mode', 'clean');
// In Electron tray app, control window drives UI; hidden output window is the render/vcam engine.
const isEngine = isOutputMode || (!isControlMode && isElectron && !params.has('ui-only'));
const bc = ('BroadcastChannel' in window) ? new BroadcastChannel('web_vtube') : null;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: !!settings.antialias, alpha: true, powerPreference: settings.powerPreference || 'default' });
renderer.setPixelRatio(settings.pixelRatio > 0 ? settings.pixelRatio : devicePixelRatio);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
camera.position.set(0, 1.4, 1.8);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = true;
controls.target.set(0, 1.4, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
const dir = new THREE.DirectionalLight(0xffffff, 1);
dir.position.set(1, 2, 1);
scene.add(dir);

let vrm, clock = new THREE.Clock(), faceLandmarker, handLandmarker, poseLandmarker, tracking = false;
let calib = { active: false, stage: 0, samples: [], baseline: null, headLock: null, armLock: null };
let perf = { frames: 0, last: performance.now(), fps: 0, ms: 0 };

function applyBackground() {
  const t = settings.outputBgType || 'green';
  const c = t === 'green' ? '#00b140' : (settings.outputBgColor || '#00b140');
  document.body.style.background = t === 'transparent' ? 'transparent' : c;
  if (bgLayer) {
    if (t === 'image' && settings.outputBgImage) {
      bgLayer.style.backgroundImage = `url("${settings.outputBgImage}")`;
      bgLayer.style.backgroundColor = c;
    } else {
      bgLayer.style.backgroundImage = 'none';
      bgLayer.style.backgroundColor = t === 'transparent' ? 'transparent' : c;
    }
  }
}

if (gpuMode) gpuMode.value = settings.powerPreference || 'default';
if (aaToggle) aaToggle.checked = !!settings.antialias;
if (bgType) bgType.value = settings.outputBgType || 'green';
if (bgColor) bgColor.value = settings.outputBgColor || '#00b140';
applyBackground();

gpuMode?.addEventListener('change', () => { settings.powerPreference = gpuMode.value; saveSettings(settings); location.reload(); });
aaToggle?.addEventListener('change', () => { settings.antialias = aaToggle.checked; saveSettings(settings); location.reload(); });
bgType?.addEventListener('change', () => { settings.outputBgType = bgType.value; saveSettings(settings); applyBackground(); });
bgColor?.addEventListener('input', () => { settings.outputBgColor = bgColor.value; if (settings.outputBgType === 'green') { settings.outputBgType = 'color'; if (bgType) bgType.value = 'color'; } saveSettings(settings); applyBackground(); });
bgImage?.addEventListener('change', async (e) => {
  const f = e.target.files?.[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { settings.outputBgImage = String(r.result || ''); settings.outputBgType = 'image'; if (bgType) bgType.value = 'image'; saveSettings(settings); applyBackground(); };
  r.readAsDataURL(f);
});

addEventListener('storage', (e) => {
  if (e.key === 'web_vtube_settings') {
    Object.assign(settings, loadSettings());
    if (bgType) bgType.value = settings.outputBgType || 'green';
    if (bgColor) bgColor.value = settings.outputBgColor || '#00b140';
    applyBackground();
  }
});

bc?.addEventListener('message', async (ev) => {
  const msg = ev.data || {};
  if (msg.type === 'vrm-saved' && isEngine) { try { await tryLoadSavedVrm(); } catch {} }
  if (msg.type === 'toggle-tracking' && isEngine) { toggleTracking(); }
  if (msg.type === 'calibrate' && isEngine) { handleCalibrateClick(true); bc.postMessage({ type: 'calib-state', text: status.textContent, active: calib.active, stage: calib.stage, samples: calib.samples.length }); }
  if (msg.type === 'calib-sample' && isEngine) { handleCanvasCalibClick(true); bc.postMessage({ type: 'calib-state', text: status.textContent, active: calib.active, stage: calib.stage, samples: calib.samples.length }); }
  if (msg.type === 'tracking-state' && !isEngine) { status.textContent = msg.text || status.textContent; if (typeof msg.tracking === 'boolean') { tracking = msg.tracking; if (trackingBtn) trackingBtn.textContent = tracking ? 'Stop tracking' : 'Start tracking'; } }
  if (msg.type === 'calib-state' && !isEngine) { status.textContent = msg.text || status.textContent; }
});

let vcamWin = null;
vcamBtn?.addEventListener('click', () => {
  const stream = canvas.captureStream(30);
  if (vcamWin && !vcamWin.closed) { vcamWin.close(); vcamWin = null; vcamBtn.textContent = 'Browser virtual cam'; status.textContent = 'Virtual cam stopped.'; return; }
  vcamWin = window.open('', 'web_vtube_vcam', 'width=640,height=480');
  if (!vcamWin) { status.textContent = 'Popup blocked: allow popups for virtual cam window.'; return; }
  vcamWin.document.title = 'web_vtube virtual cam';
  vcamWin.document.body.style.cssText = 'margin:0;background:#000';
  const v = vcamWin.document.createElement('video');
  v.autoplay = true; v.muted = true; v.playsInline = true; v.srcObject = stream; v.style.cssText = 'width:100%;height:100%;object-fit:contain';
  vcamWin.document.body.append(v);
  vcamBtn.textContent = 'Stop virtual cam';
  status.textContent = 'Virtual cam window opened (capture this window/tab in OBS).';
});

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const VRM_DB_NAME = 'web_vtube';
const VRM_STORE = 'models';
const VRM_RECORD = 'current';

function openVrmDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VRM_DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(VRM_STORE)) request.result.createObjectStore(VRM_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveVrmToDb(file) {
  const db = await openVrmDb();
  const data = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(VRM_STORE, 'readwrite');
    transaction.objectStore(VRM_STORE).put({ name: file.name, data }, VRM_RECORD);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}

async function loadVrmFromDb() {
  const db = await openVrmDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(VRM_STORE, 'readonly');
    const request = transaction.objectStore(VRM_STORE).get(VRM_RECORD);
    request.onsuccess = () => {
      db.close();
      const result = request.result;
      if (!result) return resolve(null);
      if (result instanceof ArrayBuffer) return resolve(new File([result], 'saved.vrm', { type: 'model/vrm' }));
      resolve(new File([result.data], result.name || 'saved.vrm', { type: 'model/vrm' }));
    };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

async function loadVrmFile(file) {
  const url = URL.createObjectURL(file);
  status.textContent = 'Loading VRM...';
  const loader = new GLTFLoader();
  loader.register((p) => new VRMLoaderPlugin(p));
  const gltf = await loader.loadAsync(url);
  if (vrm) { scene.remove(vrm.scene); VRMUtils.deepDispose(vrm.scene); }
  vrm = gltf.userData.vrm;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.removeUnnecessaryJoints(gltf.scene);
  // vrm.scene.rotation.y = Math.PI;
  scene.add(vrm.scene);
  status.textContent = `Loaded: ${file.name}`;
  URL.revokeObjectURL(url);
}

fileInput?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  await loadVrmFile(file);
  await saveVrmToDb(file);
  bc?.postMessage({ type: 'vrm-saved' });
});

async function tryLoadSavedVrm() {
  const file = await loadVrmFromDb();
  if (!file) return;
  await loadVrmFile(file);
}

tryLoadSavedVrm();

cleanBtn.addEventListener('click', () => document.body.classList.add('clean'));
exitCleanBtn.addEventListener('click', () => document.body.classList.remove('clean'));
addEventListener('keydown', (e) => { if (e.key === 'Escape') document.body.classList.remove('clean'); });

function handleVrmDrop(e) {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file || !file.name.toLowerCase().endsWith('.vrm')) return;
  loadVrmFile(file).then(() => saveVrmToDb(file));
}
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', handleVrmDrop);

async function startTracking() {
  if (tracking) { tracking = false; trackingBtn.textContent = 'Start tracking'; status.textContent = 'Tracking stopped.'; return; }
  status.textContent = 'Starting webcam tracking...';
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API unavailable. Use localhost/HTTPS and a supported browser.');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
  camVideo.srcObject = stream;
  await camVideo.play();
  const local = window.WEB_VTUBE_VENDOR === 'local';
  const visionUrl = local ? './vendor/mediapipe/vision_bundle.mjs' : 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const wasmUrl = local ? './vendor/mediapipe/wasm' : 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
  const faceModel = local ? './vendor/mediapipe/models/face_landmarker.task' : 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  const poseModel = local ? './vendor/mediapipe/models/pose_landmarker_lite.task' : 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
  const vision = await import(visionUrl);
  const fileset = await vision.FilesetResolver.forVisionTasks(wasmUrl);
  const handModel = local ? './vendor/mediapipe/models/hand_landmarker.task' : 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  [faceLandmarker, poseLandmarker, handLandmarker] = await Promise.all([
    vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: faceModel },
      runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true
    }),
    vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: poseModel },
      runningMode: 'VIDEO', numPoses: 1
    }).catch(() => null),
    vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: handModel },
      runningMode: 'VIDEO', numHands: 2
    }).catch(() => null)
  ]);
  tracking = true;
  trackingBtn.textContent = 'Stop tracking';
  status.textContent = 'Tracking on (face' + (poseLandmarker ? '+pose' : '') + (handLandmarker ? '+hands' : '') + ').';
}

async function toggleTracking() {
  try {
    await startTracking();
  } catch (err) {
    console.error(err);
    status.textContent = 'Tracking error: ' + err.message;
  }
  bc?.postMessage({ type: 'tracking-state', tracking, text: status.textContent });
}
trackingBtn?.addEventListener('click', () => {
  if (isElectron && !isOutputMode && bc) { bc.postMessage({ type: 'toggle-tracking' }); status.textContent = tracking ? 'Stopping tracking...' : 'Starting tracking in output engine...'; return; }
  toggleTracking();
});

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function applyTracking() {
  if (!tracking || !vrm || camVideo.readyState < 2) return;
  const now = performance.now();
  const hum = vrm.humanoid;
  const em = vrm.expressionManager;
  const lockHead = calib.active && calib.stage === 0;
  const lockArms = calib.active && calib.stage <= 1;

  if (faceLandmarker) {
    const res = faceLandmarker.detectForVideo(camVideo, now);
    const bs = res.faceBlendshapes?.[0]?.categories || [];
    const get = (n) => bs.find(c => c.categoryName === n)?.score || 0;
    const b = calib.baseline || {};
    const jaw = clamp((get('jawOpen') - (b.jawOpen || 0)) / Math.max(0.2, 1 - (b.jawOpen || 0)), 0, 1);
    const blinkL = clamp(get('eyeBlinkLeft'), 0, 1);
    const blinkR = clamp(get('eyeBlinkRight'), 0, 1);
    const smile = clamp(((get('mouthSmileLeft') + get('mouthSmileRight')) / 2 - (b.smile || 0)) / 0.5, 0, 1);
    if (em) {
      em.setValue('aa', jaw);
      em.setValue('ih', clamp((get('mouthFunnel') - (b.funnel || 0)) * 1.5, 0, 1));
      em.setValue('ou', clamp((get('mouthPucker') - (b.pucker || 0)) * 1.5, 0, 1));
      em.setValue('blinkLeft', blinkL);
      em.setValue('blinkRight', blinkR);
      em.setValue('happy', smile);
    }
    const head = hum?.getNormalizedBoneNode('head');
    const neck = hum?.getNormalizedBoneNode('neck');
    const mat = res.facialTransformationMatrixes?.[0]?.data;
    if (!lockHead && mat) {
      const m = new THREE.Matrix4().fromArray(mat);
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      const hq = calib.headLock ? calib.headLock.clone() : q;
      if (calib.active && calib.stage === 1) calib.headLock = q.clone();
      const target = calib.active && calib.stage === 0 ? (calib.headLock || hq) : q;
      head?.quaternion.slerp(target, 0.35);
      neck?.quaternion.slerp(target, 0.15);
    } else if (lockHead && head && calib.headLock) {
      head.quaternion.slerp(calib.headLock, 0.5);
    }
  }

  if (poseLandmarker && !lockArms) {
    const pres = poseLandmarker.detectForVideo(camVideo, now);
    const lm = pres.landmarks?.[0];
    applyPose(lm, hum);
  } else if (!lockArms) {
    resetArms(hum);
  }

  if (handLandmarker) {
    const hres = handLandmarker.detectForVideo(camVideo, now);
    applyHands(hres, hum);
  } else {
    resetFingers(hum);
  }
}

function vis(lm, i) { const p = lm?.[i]; return !!p && (p.visibility ?? 1) > 0.45 && (p.presence ?? 1) > 0.45; }

const restAxis = {
  leftUpperArm: new THREE.Vector3(-1, 0, 0), leftLowerArm: new THREE.Vector3(-1, 0, 0), leftHand: new THREE.Vector3(-1, 0, 0),
  rightUpperArm: new THREE.Vector3(1, 0, 0), rightLowerArm: new THREE.Vector3(1, 0, 0), rightHand: new THREE.Vector3(1, 0, 0),
};
const downPose = {
  leftUpperArm: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -1.2),
  leftLowerArm: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.15),
  rightUpperArm: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.2),
  rightLowerArm: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.15),
  leftHand: new THREE.Quaternion(), rightHand: new THREE.Quaternion(),
};
function resetBone(hum, name, s = 0.2) {
  const b = hum?.getNormalizedBoneNode(name);
  b?.quaternion.slerp(downPose[name] || new THREE.Quaternion(), s);
}
function resetArms(hum) {
  ['leftUpperArm','leftLowerArm','leftHand','rightUpperArm','rightLowerArm','rightHand'].forEach(n => resetBone(hum, n));
}

function setBoneDir(hum, name, fromIdx, toIdx, lm, s = 0.3) {
  const bone = hum?.getNormalizedBoneNode(name);
  if (!bone) return;
  const rest = restAxis[name] || new THREE.Vector3(0, 1, 0);
  if (!vis(lm, fromIdx) || !vis(lm, toIdx)) { resetBone(hum, name); return; }
  const a = lm[fromIdx], b = lm[toIdx];
  // camera/image space -> approx world space facing camera
  const v = new THREE.Vector3(-(b.x - a.x), (b.y - a.y), (b.z - a.z));
  if (v.lengthSq() < 1e-5) { resetBone(hum, name); return; }
  v.normalize();
  const parentQ = new THREE.Quaternion();
  bone.parent?.getWorldQuaternion(parentQ);
  const dirLocal = v.clone().applyQuaternion(parentQ.clone().invert());
  if (dirLocal.lengthSq() < 1e-5) { resetBone(hum, name); return; }
  dirLocal.normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(rest, dirLocal);
  bone.quaternion.slerp(q, s);
}

function applyPose(lm, hum) {
  if (!lm) { resetArms(hum); return; }
  // MediaPipe pose: 11 L shoulder,12 R shoulder,13 L elbow,14 R elbow,15 L wrist,16 R wrist,23 L hip,24 R hip
  const leftOk = vis(lm,11) && vis(lm,13) && vis(lm,15);
  const rightOk = vis(lm,12) && vis(lm,14) && vis(lm,16);
  if (leftOk) { setBoneDir(hum, 'leftUpperArm', 11, 13, lm); setBoneDir(hum, 'leftLowerArm', 13, 15, lm); }
  else { resetBone(hum,'leftUpperArm'); resetBone(hum,'leftLowerArm'); resetBone(hum,'leftHand'); }
  if (rightOk) { setBoneDir(hum, 'rightUpperArm', 12, 14, lm); setBoneDir(hum, 'rightLowerArm', 14, 16, lm); }
  else { resetBone(hum,'rightUpperArm'); resetBone(hum,'rightLowerArm'); resetBone(hum,'rightHand'); }
  const spine = hum?.getNormalizedBoneNode('spine') || hum?.getNormalizedBoneNode('chest') || hum?.getNormalizedBoneNode('upperChest');
  if (spine && vis(lm,11) && vis(lm,12) && vis(lm,23) && vis(lm,24)) {
    const sh = new THREE.Vector3((lm[11].x+lm[12].x)/2, -((lm[11].y+lm[12].y)/2), -((lm[11].z+lm[12].z)/2));
    const hp = new THREE.Vector3((lm[23].x+lm[24].x)/2, -((lm[23].y+lm[24].y)/2), -((lm[23].z+lm[24].z)/2));
    const v = sh.sub(hp);
    if (v.lengthSq() > 1e-5) {
      v.normalize();
      if (v.y > 0.4) {
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), v);
        spine.quaternion.slerp(q, 0.08);
      } else {
        spine.quaternion.slerp(new THREE.Quaternion(), 0.1);
      }
    }
  } else {
    spine?.quaternion.slerp(new THREE.Quaternion(), 0.08);
  }
}

const fingerBones = {
  Left: [
    ['leftThumbMetacarpal',1,2],['leftThumbProximal',2,3],['leftThumbDistal',3,4],
    ['leftIndexProximal',5,6],['leftIndexIntermediate',6,7],['leftIndexDistal',7,8],
    ['leftMiddleProximal',9,10],['leftMiddleIntermediate',10,11],['leftMiddleDistal',11,12],
    ['leftRingProximal',13,14],['leftRingIntermediate',14,15],['leftRingDistal',15,16],
    ['leftLittleProximal',17,18],['leftLittleIntermediate',18,19],['leftLittleDistal',19,20],
  ],
  Right: [
    ['rightThumbMetacarpal',1,2],['rightThumbProximal',2,3],['rightThumbDistal',3,4],
    ['rightIndexProximal',5,6],['rightIndexIntermediate',6,7],['rightIndexDistal',7,8],
    ['rightMiddleProximal',9,10],['rightMiddleIntermediate',10,11],['rightMiddleDistal',11,12],
    ['rightRingProximal',13,14],['rightRingIntermediate',14,15],['rightRingDistal',15,16],
    ['rightLittleProximal',17,18],['rightLittleIntermediate',18,19],['rightLittleDistal',19,20],
  ]
};

function resetFingers(hum) {
  Object.values(fingerBones).flat().forEach(([n]) => resetBone(hum, n, 0.25));
}

function applyFingerBone(hum, name, a, b, handed) {
  const bone = hum?.getNormalizedBoneNode(name);
  if (!bone || !a || !b) return;
  // map hand landmarks (image space) to approximate facing-camera space
  const v = new THREE.Vector3(-(b.x - a.x), (b.y - a.y), (b.z - a.z));
  if (v.lengthSq() < 1e-6) { bone.quaternion.slerp(new THREE.Quaternion(), 0.2); return; }
  v.normalize();
  const parentQ = new THREE.Quaternion();
  bone.parent?.getWorldQuaternion(parentQ);
  const dirLocal = v.applyQuaternion(parentQ.clone().invert()).normalize();
  const rest = name.includes('Thumb') ? new THREE.Vector3(handed === 'Left' ? -0.6 : 0.6, -0.8, 0).normalize() : new THREE.Vector3(handed === 'Left' ? -1 : 1, 0, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(rest, dirLocal);
  bone.quaternion.slerp(q, 0.45);
}

function applyHands(hres, hum) {
  if (!hres || !hum) { resetFingers(hum); return; }
  const seen = { Left: false, Right: false };
  const lms = hres.landmarks || [];
  const hands = hres.handednesses || [];
  for (let i = 0; i < lms.length; i++) {
    const label = hands[i]?.[0]?.categoryName;
    if (!label || !fingerBones[label]) continue;
    seen[label] = true;
    const lm = lms[i];
    for (const [name, from, to] of fingerBones[label]) applyFingerBone(hum, name, lm[from], lm[to], label);
  }
  if (!seen.Left) fingerBones.Left.forEach(([n]) => resetBone(hum, n, 0.2));
  if (!seen.Right) fingerBones.Right.forEach(([n]) => resetBone(hum, n, 0.2));
}

const calibStages = [
  {
    title: '1/3 Face baseline',
    need: 3,
    text: 'Face camera, neutral expression, mouth closed, eyes open. Keep head and arms still. Click canvas to capture each sample, then press Calibrate.',
    svg: `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
      <style>.pulse{animation:p 1.2s ease-in-out infinite}@keyframes p{0%,100%{opacity:.4}50%{opacity:1}}</style>
      <circle cx="100" cy="45" r="22" stroke="#fff" stroke-width="3" fill="none"/>
      <circle cx="92" cy="40" r="2.5" fill="#fff"/><circle cx="108" cy="40" r="2.5" fill="#fff"/>
      <line x1="92" y1="52" x2="108" y2="52" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
      <line x1="100" y1="67" x2="100" y2="95" stroke="#fff" stroke-width="4"/>
      <line x1="100" y1="75" x2="70" y2="95" stroke="#fff" stroke-width="4"/><line x1="100" y1="75" x2="130" y2="95" stroke="#fff" stroke-width="4"/>
      <rect class="pulse" x="78" y="108" width="44" height="18" rx="9" fill="#7cf"/>
      <text x="100" y="121" fill="#001" font-size="11" text-anchor="middle">CLICK SAMPLE</text>
    </svg>`
  },
  {
    title: '2/3 Head movement',
    need: 4,
    text: 'Do and hold each pose, then click canvas to sample: center, turn left, turn right, look up/down. Repeat if needed. Press Calibrate when sampled.',
    svg: `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
      <style>.head{transform-origin:100px 70px;animation:turn 3s ease-in-out infinite}@keyframes turn{0%,100%{transform:rotate(0deg)}25%{transform:rotate(-18deg)}50%{transform:rotate(0deg)}75%{transform:rotate(18deg)}}</style>
      <g class="head"><circle cx="100" cy="48" r="22" stroke="#fff" stroke-width="3" fill="none"/>
      <circle cx="92" cy="43" r="2.5" fill="#fff"/><circle cx="108" cy="43" r="2.5" fill="#fff"/></g>
      <line x1="100" y1="70" x2="100" y2="100" stroke="#fff" stroke-width="4"/>
      <line x1="100" y1="80" x2="75" y2="98" stroke="#fff" stroke-width="4"/><line x1="100" y1="80" x2="125" y2="98" stroke="#fff" stroke-width="4"/>
      <path d="M35 48 H60" stroke="#7cf" stroke-width="3"/><path d="M45 40 L35 48 L45 56" stroke="#7cf" stroke-width="3" fill="none"/>
      <path d="M165 48 H140" stroke="#7cf" stroke-width="3"/><path d="M155 40 L165 48 L155 56" stroke="#7cf" stroke-width="3" fill="none"/>
      <text x="100" y="128" fill="#9f9" font-size="13" text-anchor="middle">Hold pose • Click sample</text>
    </svg>`
  },
  {
    title: '3/3 Arms & torso',
    need: 4,
    text: 'Do and hold poses in view, then click canvas: arms down, left arm up, right arm up, both/torso lean. Press Calibrate to finish.',
    svg: `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg">
      <style>.la{transform-origin:100px 68px;animation:la 2.4s ease-in-out infinite}.ra{transform-origin:100px 68px;animation:ra 2.4s ease-in-out infinite}@keyframes la{0%,40%,100%{transform:rotate(25deg)}20%{transform:rotate(-55deg)}}@keyframes ra{0%,60%,100%{transform:rotate(-25deg)}80%{transform:rotate(55deg)}}</style>
      <circle cx="100" cy="40" r="16" stroke="#fff" stroke-width="3" fill="none"/>
      <line x1="100" y1="56" x2="100" y2="92" stroke="#fff" stroke-width="4"/>
      <g class="la"><line x1="100" y1="68" x2="70" y2="92" stroke="#fff" stroke-width="4"/><line x1="70" y1="92" x2="58" y2="112" stroke="#fff" stroke-width="4"/></g>
      <g class="ra"><line x1="100" y1="68" x2="130" y2="92" stroke="#fff" stroke-width="4"/><line x1="130" y1="92" x2="142" y2="112" stroke="#fff" stroke-width="4"/></g>
      <text x="100" y="132" fill="#9f9" font-size="13" text-anchor="middle">Hold pose • Click sample</text>
    </svg>`
  }
];

function updateCalibGuide() {
  if (!calibGuide) return;
  if (!calib.active) { calibGuide.hidden = true; return; }
  const s = calibStages[calib.stage] || calibStages[0];
  calibGuide.hidden = false;
  calibTitle.textContent = s.title;
  calibPose.innerHTML = s.svg;
  const need = s.need || 3;
  calibText.textContent = `${s.text} Samples: ${calib.samples.length}/${need}.`;
}

function captureCalibSample() {
  const now = performance.now();
  if (calib.stage === 0) {
    if (!faceLandmarker || camVideo.readyState < 2) return;
    const res = faceLandmarker.detectForVideo(camVideo, now);
    const bs = res.faceBlendshapes?.[0]?.categories || [];
    const get = (n) => bs.find(c => c.categoryName === n)?.score || 0;
    calib.samples.push({ jawOpen: get('jawOpen'), smile: (get('mouthSmileLeft')+get('mouthSmileRight'))/2, funnel: get('mouthFunnel'), pucker: get('mouthPucker') });
    if (calib.samples.length >= 1) {
      const avg = (k) => calib.samples.reduce((s,x)=>s+x[k],0)/calib.samples.length;
      calib.baseline = { ...(calib.baseline||{}), jawOpen: avg('jawOpen'), smile: avg('smile'), funnel: avg('funnel'), pucker: avg('pucker') };
    }
  } else if (calib.stage === 1) {
    if (!faceLandmarker || camVideo.readyState < 2) return;
    const res = faceLandmarker.detectForVideo(camVideo, now);
    const mat = res.facialTransformationMatrixes?.[0]?.data;
    if (mat) {
      const m = new THREE.Matrix4().fromArray(mat);
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
      calib.samples.push({ x: e.x, y: e.y, z: e.z });
      const maxAbs = (k) => Math.max(...calib.samples.map(s => Math.abs(s[k])), 0.2);
      calib.headRange = { x: maxAbs('x'), y: maxAbs('y'), z: maxAbs('z') };
    }
  } else if (calib.stage === 2) {
    if (!poseLandmarker || camVideo.readyState < 2) return;
    const pres = poseLandmarker.detectForVideo(camVideo, now);
    const lm = pres.landmarks?.[0];
    if (lm) {
      const pick = (i) => lm[i] ? { x: lm[i].x, y: lm[i].y, z: lm[i].z||0, v: lm[i].visibility ?? 1 } : null;
      calib.samples.push({ l: pick(15), r: pick(16), ls: pick(11), rs: pick(12) });
      calib.poseSamples = calib.samples.length;
    }
  }
  updateCalibGuide();
}

function handleCalibrateClick(fromRemote = false) {
  if (isElectron && !isOutputMode && bc && !fromRemote) { bc.postMessage({ type: 'calibrate' }); status.textContent = 'Calibration command sent to output engine.'; return; }
  if (!calib.active) {
    calib = { active: true, stage: 0, samples: [], baseline: calib.baseline || null, headLock: null, headRange: calib.headRange || null };
    status.textContent = 'Calib 1/3: sample neutral face poses.';
    updateCalibGuide();
    return;
  }
  if (calib.samples.length < 1) captureCalibSample();
  if (calib.stage < 2) {
    calib.stage += 1;
    calib.samples = [];
    calib.headLock = null;
    status.textContent = `Calib ${calib.stage + 1}/3: sample poses for this step.`;
    updateCalibGuide();
    return;
  }
  calib.active = false;
  status.textContent = `Calibration complete (${calib.baseline ? 'face' : 'no face'}${calib.headRange ? ', head' : ''}${calib.poseSamples ? ', pose' : ''}).`;
  updateCalibGuide();
}
function handleCanvasCalibClick(fromRemote = false) {
  if (!calib.active) return;
  if (isElectron && !isOutputMode && bc && !fromRemote) { bc.postMessage({ type: 'calib-sample' }); return; }
  captureCalibSample();
  const s = calibStages[calib.stage] || calibStages[0];
  status.textContent = `${s.title}: sampled ${calib.samples.length}/${s.need || 3}.`;
}
calibrateBtn?.addEventListener('click', () => handleCalibrateClick(false));
canvas.addEventListener('click', () => handleCanvasCalibClick(false));

let lastRaf = performance.now();
function tick() {
  const t0 = performance.now();
  const dt = clock.getDelta();
  applyTracking();
  if (vrm) vrm.update(dt);
  controls.update();
  renderer.render(scene, camera);
  perf.ms = performance.now() - t0;
  perf.frames++;
  if (t0 - perf.last >= 1000) {
    perf.fps = perf.frames;
    perf.frames = 0;
    perf.last = t0;
    if (perfEl) perfEl.textContent = `FPS: ${perf.fps}\nFrame: ${perf.ms.toFixed(1)} ms\nDraw: ${renderer.info.render.calls}`;
  }
}

renderer.setAnimationLoop(() => { lastRaf = performance.now(); tick(); });
// Fallback for hidden/offscreen engine windows where rAF may be throttled.
setInterval(() => {
  if (document.hidden || performance.now() - lastRaf > 250) tick();
}, 1000 / 30);
