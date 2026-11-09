"use strict";

const camera = document.getElementById("camera");
const startScreen = document.getElementById("start-screen");
const pianoScreen = document.getElementById("piano-screen");
const startButton = document.getElementById("start-button");
const stopButton = document.getElementById("stop-camera");
const startStatus = document.getElementById("start-status");
const handStatus = document.getElementById("hand-status");
const noteDisplay = document.getElementById("note-display");
const keys = [...document.querySelectorAll(".key")];

const fingertips = [
    { landmark: 4, name: "親" },
    { landmark: 8, name: "人" },
    { landmark: 12, name: "中" },
    { landmark: 16, name: "薬" },
    { landmark: 20, name: "小" }
];

const cursors = new Map();
const fingerTargets = new Map();
let cameraStream = null;
let hands = null;
let detecting = false;
let processing = false;
let animationId = null;
let lastVideoTime = -1;

for (let handIndex = 0; handIndex < 2; handIndex += 1) {
    fingertips.forEach((finger, fingerIndex) => {
        const cursor = document.createElement("div");
        cursor.className = "finger-cursor";
        cursor.textContent = finger.name;
        cursor.setAttribute("aria-hidden", "true");
        document.body.appendChild(cursor);
        cursors.set(`${handIndex}-${fingerIndex}`, cursor);
    });
}

function playKey(key) {
    const audio = document.getElementById(key.dataset.audio);

    audio.pause();
    audio.currentTime = 0;
    audio.play().catch((error) => {
        if (error.name === "AbortError") {
            return;
        }
        console.error("音声再生エラー:", error);
        noteDisplay.textContent = `${key.dataset.note}：音声を再生できません`;
    });

    noteDisplay.textContent = `♪ ${key.dataset.note} ♪`;
    key.classList.add("playing");
    setTimeout(() => key.classList.remove("playing"), 200);
}

function getScreenPosition(landmark) {
    const videoWidth = camera.videoWidth;
    const videoHeight = camera.videoHeight;

    if (!videoWidth || !videoHeight) {
        return null;
    }

    const scale = Math.max(
        window.innerWidth / videoWidth,
        window.innerHeight / videoHeight
    );
    const displayWidth = videoWidth * scale;
    const displayHeight = videoHeight * scale;

    return {
        x: landmark.x * displayWidth + (window.innerWidth - displayWidth) / 2,
        y: landmark.y * displayHeight + (window.innerHeight - displayHeight) / 2
    };
}

function findKeyAt(x, y) {
    return keys.find((key) => {
        const rect = key.getBoundingClientRect();
        return x >= rect.left && x <= rect.right &&
            y >= rect.top && y <= rect.bottom;
    }) ?? null;
}

function clearFingerTargets() {
    fingerTargets.clear();
    keys.forEach((key) => key.classList.remove("finger-active"));
    cursors.forEach((cursor) => cursor.classList.remove("active"));
}

function onHandResults(results) {
    const landmarksByHand = results.multiHandLandmarks ?? [];
    const seenFingers = new Set();
    const activeKeys = new Set();
    let recognizedFingers = 0;

    landmarksByHand.forEach((landmarks, handIndex) => {
        fingertips.forEach((finger, fingerIndex) => {
            const cursorId = `${handIndex}-${fingerIndex}`;
            const position = getScreenPosition(landmarks[finger.landmark]);
            const cursor = cursors.get(cursorId);

            if (!position || !cursor) {
                return;
            }

            recognizedFingers += 1;
            seenFingers.add(cursorId);
            cursor.style.left = `${position.x}px`;
            cursor.style.top = `${position.y}px`;
            cursor.style.display = "flex";

            const key = findKeyAt(position.x, position.y);
            const previousKey = fingerTargets.get(cursorId);

            if (key) {
                activeKeys.add(key);
                cursor.classList.add("active");
                if (key !== previousKey) {
                    playKey(key);
                }
                fingerTargets.set(cursorId, key);
            } else {
                cursor.classList.remove("active");
                fingerTargets.delete(cursorId);
            }
        });
    });

    for (const [cursorId, cursor] of cursors) {
        if (!seenFingers.has(cursorId)) {
            cursor.style.display = "none";
            cursor.classList.remove("active");
            fingerTargets.delete(cursorId);
        }
    }

    keys.forEach((key) => {
        key.classList.toggle("finger-active", activeKeys.has(key));
    });

    if (recognizedFingers) {
        handStatus.textContent =
            `${landmarksByHand.length}手・${recognizedFingers}本の指先を認識中`;
    } else {
        handStatus.textContent = "手をカメラに映してください";
        clearFingerTargets();
    }
}

async function detectHands() {
    if (!detecting) {
        return;
    }

    if (
        camera.readyState >= 2 &&
        camera.currentTime !== lastVideoTime &&
        !processing
    ) {
        lastVideoTime = camera.currentTime;
        processing = true;

        try {
            await hands.send({ image: camera });
        } catch (error) {
            console.error("手の認識エラー:", error);
            detecting = false;
            handStatus.textContent = "手の認識に失敗しました。ページを再読み込みしてください";
            return;
        } finally {
            processing = false;
        }
    }

    animationId = requestAnimationFrame(detectHands);
}

async function startCamera() {
    startButton.disabled = true;
    startStatus.textContent = "カメラと手の認識を準備しています...";

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: "environment" },
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        });

        camera.srcObject = cameraStream;
        await camera.play();

        if (typeof Hands !== "function") {
            throw new Error("手認識ライブラリーを読み込めません。インターネット接続を確認してください");
        }

        hands = new Hands({
            locateFile: (file) =>
                `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });
        hands.setOptions({
            maxNumHands: 2,
            modelComplexity: 0,
            minDetectionConfidence: 0.6,
            minTrackingConfidence: 0.6
        });
        hands.onResults(onHandResults);
        await hands.initialize();

        startScreen.classList.add("hidden");
        pianoScreen.classList.remove("hidden");
        handStatus.textContent = "手をカメラに映してください";
        detecting = true;
        detectHands();
    } catch (error) {
        console.error("起動エラー:", error);
        if (cameraStream) {
            cameraStream.getTracks().forEach((track) => track.stop());
            cameraStream = null;
        }
        camera.srcObject = null;
        startStatus.textContent =
            `起動できませんでした: ${error.message || "カメラと通信環境を確認してください"}`;
        startButton.disabled = false;
    }
}

async function stopCamera() {
    detecting = false;

    if (animationId !== null) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    if (hands) {
        await hands.close();
        hands = null;
    }

    if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
        cameraStream = null;
    }

    camera.srcObject = null;
    clearFingerTargets();
    cursors.forEach((cursor) => {
        cursor.style.display = "none";
    });
    pianoScreen.classList.add("hidden");
    startScreen.classList.remove("hidden");
    startStatus.textContent = "";
    startButton.disabled = false;
}

keys.forEach((key) => {
    key.addEventListener("click", () => playKey(key));
});

startButton.addEventListener("click", startCamera);
stopButton.addEventListener("click", stopCamera);

document.addEventListener("keydown", (event) => {
    const number = Number(event.key);
    if (number >= 1 && number <= keys.length) {
        playKey(keys[number - 1]);
    }
});

window.addEventListener("beforeunload", () => {
    detecting = false;
    if (animationId !== null) {
        cancelAnimationFrame(animationId);
    }
    if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
    }
});
