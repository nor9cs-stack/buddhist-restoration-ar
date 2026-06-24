"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { imageTargetSrc } from "@/data/statues";

type AFrameScene = HTMLElement & {
  hasLoaded?: boolean;
  systems?: {
    "mindar-image-system"?: {
      start: () => Promise<void>;
      stop: () => void;
    };
  };
};

type DebugState = {
  pageMounted: boolean;
  aframeLoaded: boolean;
  mindarLoaded: boolean;
  cameraGranted: boolean;
  targetFound: boolean;
};

const AFRAME_SCRIPT_ID = "aframe-runtime";
const MINDAR_SCRIPT_ID = "mindar-image-aframe-runtime";
const AFRAME_SRC = "https://aframe.io/releases/1.5.0/aframe.min.js";
const MINDAR_SRC =
  "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-aframe.prod.js";
const SCRIPT_LOAD_TIMEOUT_MS = 10000;

const initialDebugState: DebugState = {
  pageMounted: false,
  aframeLoaded: false,
  mindarLoaded: false,
  cameraGranted: false,
  targetFound: false
};

function waitForScript(id: string, src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      callback();
    };

    if (existing?.dataset.loaded === "true") {
      resolve();
      return;
    }

    const script = existing ?? document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = true;
    script.crossOrigin = "anonymous";

    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "true";
        finish(resolve);
      },
      { once: true }
    );

    script.addEventListener(
      "error",
      () => finish(() => reject(new Error(`Unable to load ${src}`))),
      { once: true }
    );

    if (!existing) {
      document.head.appendChild(script);
    }

    timeoutId = setTimeout(() => {
      finish(() => reject(new Error(`${id} timed out after 10 seconds.`)));
    }, SCRIPT_LOAD_TIMEOUT_MS);
  });
}

function waitForScene(scene: AFrameScene) {
  if (scene.hasLoaded) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    scene.addEventListener("loaded", () => resolve(), { once: true });
  });
}

async function requestCameraAccess() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera access requires a supported browser and HTTPS.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: "environment" } }
  });

  stream.getTracks().forEach((track) => track.stop());
}

export default function ARLiteViewer() {
  const sceneRef = useRef<AFrameScene | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const [debug, setDebug] = useState<DebugState>(initialDebugState);
  const [started, setStarted] = useState(false);
  const [message, setMessage] = useState<string>();

  const updateDebug = useCallback((patch: Partial<DebugState>) => {
    setDebug((current) => ({ ...current, ...patch }));
  }, []);

  useEffect(() => {
    updateDebug({ pageMounted: true });
  }, [updateDebug]);

  useEffect(() => {
    const anchor = anchorRef.current;

    if (!started || !anchor) {
      return;
    }

    const handleTargetFound = () => {
      console.log("[AR Lite] target found");
      updateDebug({ targetFound: true });
    };

    anchor.addEventListener("targetFound", handleTargetFound);

    return () => {
      anchor.removeEventListener("targetFound", handleTargetFound);
    };
  }, [started, updateDebug]);

  const start = useCallback(async () => {
    setMessage("Loading A-Frame");

    try {
      await waitForScript(AFRAME_SCRIPT_ID, AFRAME_SRC);
      updateDebug({ aframeLoaded: true });

      setMessage("Loading MindAR");
      await waitForScript(MINDAR_SCRIPT_ID, MINDAR_SRC);
      updateDebug({ mindarLoaded: true });

      setStarted(true);
      setMessage("Requesting camera");
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await requestCameraAccess();
      updateDebug({ cameraGranted: true });

      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      if (!sceneRef.current) {
        throw new Error("AR scene is not ready.");
      }

      setMessage("Starting AR");
      await waitForScene(sceneRef.current);
      await sceneRef.current.systems?.["mindar-image-system"]?.start();
      setMessage(undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AR Lite failed to start.");
    }
  }, [updateDebug]);

  const rows: Array<[string, string]> = [
    ["page mounted", debug.pageMounted ? "yes" : "no"],
    ["A-Frame loaded", debug.aframeLoaded ? "yes" : "no"],
    ["MindAR loaded", debug.mindarLoaded ? "yes" : "no"],
    ["camera granted", debug.cameraGranted ? "yes" : "no"],
    ["target found", debug.targetFound ? "yes" : "no"]
  ];

  return (
    <main className="ar-lite-page">
      {!started ? (
        <button className="ar-lite-start" type="button" onClick={start}>
          Start AR Lite
        </button>
      ) : null}

      {message ? <div className="ar-lite-message">{message}</div> : null}

      {started ? (
        <a-scene
          ref={sceneRef}
          mindar-image={`imageTargetSrc: ${imageTargetSrc}; autoStart: false; uiLoading: no; uiScanning: yes; uiError: no;`}
          color-space="sRGB"
          renderer="colorManagement: true, physicallyCorrectLights"
          vr-mode-ui="enabled: false"
          device-orientation-permission-ui="enabled: false"
          embedded
        >
          <a-entity
            ref={anchorRef}
            mindar-image-target="targetIndex: 0"
          >
            <a-box color="red" position="0 0 0" scale="0.2 0.2 0.2" />
          </a-entity>
          <a-camera position="0 0 0" look-controls="enabled: false" />
        </a-scene>
      ) : null}

      <aside className="ar-lite-debug">
        <strong>AR Lite Debug</strong>
        <dl>
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </aside>
    </main>
  );
}
