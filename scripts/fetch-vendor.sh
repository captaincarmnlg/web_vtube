#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p vendor/three/build vendor/three/examples/jsm/controls vendor/three/examples/jsm/loaders vendor/three/examples/jsm/utils vendor/three-vrm vendor/mediapipe/wasm vendor/mediapipe/models
base_three=https://cdn.jsdelivr.net/npm/three@0.164.1
base_vrm=https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3
base_mp=https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14
curl -fsSL "$base_three/build/three.module.js" -o vendor/three/build/three.module.js
curl -fsSL "$base_three/examples/jsm/controls/OrbitControls.js" -o vendor/three/examples/jsm/controls/OrbitControls.js
curl -fsSL "$base_three/examples/jsm/loaders/GLTFLoader.js" -o vendor/three/examples/jsm/loaders/GLTFLoader.js
curl -fsSL "$base_three/examples/jsm/utils/BufferGeometryUtils.js" -o vendor/three/examples/jsm/utils/BufferGeometryUtils.js
curl -fsSL "$base_vrm/lib/three-vrm.module.min.js" -o vendor/three-vrm/three-vrm.module.min.js
curl -fsSL "$base_mp/vision_bundle.mjs" -o vendor/mediapipe/vision_bundle.mjs
curl -fsSL "$base_mp/wasm/vision_wasm_internal.js" -o vendor/mediapipe/wasm/vision_wasm_internal.js
curl -fsSL "$base_mp/wasm/vision_wasm_internal.wasm" -o vendor/mediapipe/wasm/vision_wasm_internal.wasm
curl -fsSL "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" -o vendor/mediapipe/models/face_landmarker.task
curl -fsSL "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task" -o vendor/mediapipe/models/pose_landmarker_lite.task
curl -fsSL "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task" -o vendor/mediapipe/models/hand_landmarker.task
echo "Vendored assets fetched."
