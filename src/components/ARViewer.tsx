"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import StartScreen from "./StartScreen";
import { imageTargetSrc, statues } from "@/data/statues";

type RuntimeState = "idle" | "loading" | "running" | "error";

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
  componentMounted: boolean;
  aframeScriptLoaded: boolean;
  mindarScriptLoaded: boolean;
  cameraPermissionRequested: boolean;
  cameraPermissionGranted: boolean;
  cameraPermissionDenied: boolean;
  targetFound: boolean;
  targetLost: boolean;
  modelLoaded: boolean;
  modelLoadFailed: boolean;
};

const initialDebugState: DebugState = {
  componentMounted: false,
  aframeScriptLoaded: false,
  mindarScriptLoaded: false,
  cameraPermissionRequested: false,
  cameraPermissionGranted: false,
  cameraPermissionDenied: false,
  targetFound: false,
  targetLost: false,
  modelLoaded: false,
  modelLoadFailed: false
};

const AFRAME_SCRIPT_ID = "aframe-runtime";
const MINDAR_SCRIPT_ID = "mindar-image-aframe-runtime";
const AFRAME_SRC = "https://aframe.io/releases/1.5.0/aframe.min.js";
const MINDAR_SRC =
  "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-aframe.prod.js";
const MODEL_LOAD_ERROR =
  "佛像模型未能载入。请确认 /public/models/buddha_001.glb 存在，并且已经替换为适合移动 WebAR 的优化 GLB 文件。";

function vec3ToAttribute([x, y, z]: [number, number, number]) {
  return `${x} ${y} ${z}`;
}

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function waitForScript(id: string, src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(id) as HTMLScriptElement | null;

    if (existing?.dataset.loaded === "true") {
      resolve();
      return;
    }

    if (existing?.dataset.failed === "true") {
      reject(new Error(`Unable to load ${src}`));
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
        resolve();
      },
      { once: true }
    );

    script.addEventListener(
      "error",
      () => {
        script.dataset.failed = "true";
        reject(new Error(`Unable to load ${src}`));
      },
      { once: true }
    );

    if (!existing) {
      document.head.appendChild(script);
    }
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

async function ensureModelIsAvailable(modelUrl: string) {
  const response = await fetch(modelUrl, {
    cache: "no-store",
    method: "HEAD"
  });

  if (!response.ok) {
    throw new Error(MODEL_LOAD_ERROR);
  }
}

async function requestCameraAccess() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      "当前浏览器不支持相机访问，或当前页面不是 HTTPS。Android Chrome 和 iOS Safari 通常要求 HTTPS 才能打开相机。"
    );
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" }
    },
    audio: false
  });

  stream.getTracks().forEach((track) => track.stop());
}

function DebugPanel({
  debug,
  targetFileUrl,
  modelFileUrl,
  expanded,
  onToggle
}: {
  debug: DebugState;
  targetFileUrl: string;
  modelFileUrl: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const rows: Array<[string, string]> = [
    ["AR component mounted", debug.componentMounted ? "yes" : "no"],
    ["A-Frame script loaded", debug.aframeScriptLoaded ? "yes" : "no"],
    ["MindAR script loaded", debug.mindarScriptLoaded ? "yes" : "no"],
    ["target file URL", targetFileUrl],
    ["model file URL", modelFileUrl],
    [
      "camera permission requested",
      debug.cameraPermissionRequested ? "yes" : "no"
    ],
    [
      "camera permission granted or denied",
      debug.cameraPermissionGranted
        ? "granted"
        : debug.cameraPermissionDenied
          ? "denied"
          : "not requested"
    ],
    ["target found", debug.targetFound ? "yes" : "no"],
    ["target lost", debug.targetLost ? "yes" : "no"],
    ["model loaded", debug.modelLoaded ? "yes" : "no"],
    ["model load failed", debug.modelLoadFailed ? "yes" : "no"]
  ];

  return (
    <aside
      className={`debug-panel ${expanded ? "debug-panel--expanded" : "debug-panel--collapsed"}`}
      aria-label="AR debug status"
    >
      <button
        className="debug-panel__toggle"
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        Debug
      </button>
      <div className="debug-panel__content" hidden={!expanded}>
        <strong>AR Debug</strong>
        <dl>
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </aside>
  );
}

export default function ARViewer() {
  const sceneRef = useRef<AFrameScene | null>(null);
  const anchorRefs = useRef<Map<string, HTMLElement>>(new Map());
  const modelRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [runtimeState, setRuntimeState] = useState<RuntimeState>("idle");
  const [message, setMessage] = useState<string>();
  const [sceneEnabled, setSceneEnabled] = useState(false);
  const [assetLoaded, setAssetLoaded] = useState(false);
  const [targetVisible, setTargetVisible] = useState(false);
  const [debug, setDebug] = useState<DebugState>(initialDebugState);
  const [debugExpanded, setDebugExpanded] = useState(false);
  const [origin, setOrigin] = useState("");
  const [httpsWarning, setHttpsWarning] = useState<string>();

  const primaryStatue = useMemo(
    () => statues.find((statue) => statue.targetIndex === 0) ?? statues[0],
    []
  );

  const targetFileUrl = useMemo(
    () => (origin ? new URL(imageTargetSrc, origin).href : imageTargetSrc),
    [origin]
  );

  const modelFileUrl = useMemo(
    () =>
      origin ? new URL(primaryStatue.modelUrl, origin).href : primaryStatue.modelUrl,
    [origin, primaryStatue.modelUrl]
  );

  const updateDebug = useCallback((patch: Partial<DebugState>) => {
    setDebug((current) => {
      const next = { ...current, ...patch };
      console.log("[AR Debug] state update", patch, next);
      return next;
    });
  }, []);

  useEffect(() => {
    console.log("[AR Debug] component mounted");
    setDebug((current) => {
      const next = { ...current, componentMounted: true };
      console.log("[AR Debug] state update", { componentMounted: true }, next);
      return next;
    });

    const currentOrigin = window.location.origin;
    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "::1";

    setOrigin(currentOrigin);
    setDebugExpanded(window.matchMedia("(min-width: 768px)").matches);

    if (window.location.protocol !== "https:" && !isLocalhost) {
      setHttpsWarning(
        "当前是 HTTP 局域网测试地址。界面可以正常显示，但移动浏览器可能要求 HTTPS 才允许相机权限。"
      );
    }
  }, []);

  useEffect(() => {
    if (!sceneEnabled) {
      return;
    }

    const anchors = Array.from(anchorRefs.current.values());

    const handleTargetFound = () => {
      setTargetVisible(true);
      updateDebug({ targetFound: true, targetLost: false });
    };

    const handleTargetLost = () => {
      setTargetVisible(false);
      updateDebug({ targetLost: true });
    };

    anchors.forEach((anchor) => {
      anchor.addEventListener("targetFound", handleTargetFound);
      anchor.addEventListener("targetLost", handleTargetLost);
    });

    return () => {
      anchors.forEach((anchor) => {
        anchor.removeEventListener("targetFound", handleTargetFound);
        anchor.removeEventListener("targetLost", handleTargetLost);
      });
    };
  }, [sceneEnabled, updateDebug]);

  useEffect(() => {
    if (!sceneEnabled) {
      return;
    }

    const models = Array.from(modelRefs.current.values());

    const handleModelLoaded = () => {
      setAssetLoaded(true);
      updateDebug({ modelLoaded: true, modelLoadFailed: false });
    };

    const handleModelError = () => {
      setAssetLoaded(false);
      updateDebug({ modelLoaded: false, modelLoadFailed: true });
      setRuntimeState("error");
      setMessage(MODEL_LOAD_ERROR);
    };

    models.forEach((model) => {
      model.addEventListener("model-loaded", handleModelLoaded);
      model.addEventListener("model-error", handleModelError);
    });

    return () => {
      models.forEach((model) => {
        model.removeEventListener("model-loaded", handleModelLoaded);
        model.removeEventListener("model-error", handleModelError);
      });
    };
  }, [sceneEnabled, updateDebug]);

  const startAR = useCallback(async () => {
    let cameraRequested = false;

    setRuntimeState("loading");
    setMessage("正在载入 AR 脚本");
    setAssetLoaded(false);
    setTargetVisible(false);
    updateDebug({
      aframeScriptLoaded: false,
      mindarScriptLoaded: false,
      cameraPermissionRequested: false,
      cameraPermissionGranted: false,
      cameraPermissionDenied: false,
      targetFound: false,
      targetLost: false,
      modelLoaded: false,
      modelLoadFailed: false
    });

    try {
      await waitForScript(AFRAME_SCRIPT_ID, AFRAME_SRC);
      updateDebug({ aframeScriptLoaded: true });

      await waitForScript(MINDAR_SCRIPT_ID, MINDAR_SRC);
      updateDebug({ mindarScriptLoaded: true });

      setMessage("正在检查佛像模型文件");
      await ensureModelIsAvailable(primaryStatue.modelUrl);

      setSceneEnabled(true);
      setMessage("正在请求相机权限");
      cameraRequested = true;
      updateDebug({ cameraPermissionRequested: true });

      await waitForNextFrame();
      await requestCameraAccess();
      updateDebug({
        cameraPermissionGranted: true,
        cameraPermissionDenied: false
      });

      await waitForNextFrame();

      if (!sceneRef.current) {
        throw new Error("AR 场景尚未准备完成，请稍后重试。");
      }

      setMessage("正在启动扫描");
      await waitForScene(sceneRef.current);
      await sceneRef.current.systems?.["mindar-image-system"]?.start();
      setRuntimeState("running");
      setMessage(undefined);
    } catch (error) {
      setRuntimeState("error");

      if (cameraRequested) {
        updateDebug({
          cameraPermissionGranted: false,
          cameraPermissionDenied: true
        });
      }

      setMessage(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "相机权限已被拒绝。请在浏览器设置中允许相机访问后重试。"
          : error instanceof Error
            ? error.message
            : "AR 启动失败，请检查相机权限、HTTPS 设置与网络连接。"
      );
    }
  }, [primaryStatue.modelUrl, updateDebug]);

  useEffect(() => {
    const scene = sceneRef.current;

    return () => {
      scene?.systems?.["mindar-image-system"]?.stop();
    };
  }, []);

  if (runtimeState === "idle" || runtimeState === "error") {
    return (
      <>
        <StartScreen
          disabled={false}
          message={message ?? httpsWarning}
          onStart={startAR}
        />
        <DebugPanel
          debug={debug}
          expanded={debugExpanded}
          modelFileUrl={modelFileUrl}
          onToggle={() => setDebugExpanded((current) => !current)}
          targetFileUrl={targetFileUrl}
        />
      </>
    );
  }

  return (
    <main className="ar-stage">
      {(runtimeState === "loading" || !assetLoaded || !targetVisible) && (
        <div className="ar-overlay" aria-live="polite">
          <div className="ar-status">
            <strong>
              {runtimeState === "loading"
                ? "正在启动扫描"
                : assetLoaded
                  ? "请对准展品图像"
                  : "正在载入佛像模型"}
            </strong>
            <p>{message ?? "保持手机稳定，识别成功后将显示修复模型"}</p>
          </div>
        </div>
      )}

      {sceneEnabled ? (
        <a-scene
          ref={sceneRef}
          mindar-image={`imageTargetSrc: ${imageTargetSrc}; autoStart: false; uiLoading: no; uiScanning: yes; uiError: no;`}
          color-space="sRGB"
          renderer="colorManagement: true, physicallyCorrectLights"
          vr-mode-ui="enabled: false"
          device-orientation-permission-ui="enabled: false"
          embedded
        >
          <a-assets>
            <a-asset-item
              id={primaryStatue.name}
              src={primaryStatue.modelUrl}
            />
          </a-assets>

          {statues.map((statue) => {
            const anchorKey = `${statue.name}-${statue.targetIndex}`;

            return (
              <a-entity
                key={anchorKey}
                ref={(element) => {
                  if (element) {
                    anchorRefs.current.set(anchorKey, element);
                  } else {
                    anchorRefs.current.delete(anchorKey);
                  }
                }}
                data-ar-anchor={anchorKey}
                mindar-image-target={`targetIndex: ${statue.targetIndex}`}
              >
                <a-gltf-model
                  ref={(element) => {
                    if (element) {
                      modelRefs.current.set(anchorKey, element);
                    } else {
                      modelRefs.current.delete(anchorKey);
                    }
                  }}
                  src={`#${statue.name}`}
                  position={vec3ToAttribute(statue.position)}
                  rotation={vec3ToAttribute(statue.rotation)}
                  scale={vec3ToAttribute(statue.scale)}
                  animation="property: rotation; to: 0 360 0; dur: 12000; easing: linear; loop: true"
                />
              </a-entity>
            );
          })}

          <a-camera position="0 0 0" look-controls="enabled: false" />
        </a-scene>
      ) : null}

      <DebugPanel
        debug={debug}
        expanded={debugExpanded}
        modelFileUrl={modelFileUrl}
        onToggle={() => setDebugExpanded((current) => !current)}
        targetFileUrl={targetFileUrl}
      />
    </main>
  );
}
