"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import StartScreen from "./StartScreen";
import { arExhibits, imageTargetSrc } from "@/data/statues";
import type { ARExhibitConfig, Vec3 } from "@/data/statues";

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
  gltfAssetLoaded: boolean;
  gltfAssetFailed: boolean;
  object3DAttached: boolean;
  object3DRemoved: boolean;
  modelLocked: boolean;
};

type ExhibitTransform = {
  offset: Vec3;
  rotation: Vec3;
  scaleMultiplier: number;
};

type ExhibitTransforms = Record<string, ExhibitTransform>;

type LockedWorldTransform = {
  exhibitId: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
};

type ThreeVector3 = {
  x: number;
  y: number;
  z: number;
};

type ThreeQuaternion = unknown;

type ThreeEuler = ThreeVector3 & {
  setFromQuaternion: (quaternion: ThreeQuaternion, order?: string) => ThreeEuler;
};

type ThreeLike = {
  Vector3: new () => ThreeVector3;
  Quaternion: new () => ThreeQuaternion;
  Euler: new () => ThreeEuler;
};

type WorldReadableEntity = HTMLElement & {
  object3D?: {
    getWorldPosition: (target: ThreeVector3) => ThreeVector3;
    getWorldQuaternion: (target: ThreeQuaternion) => ThreeQuaternion;
    getWorldScale: (target: ThreeVector3) => ThreeVector3;
  };
};

type LocalJitterReductionComponent = {
  data: {
    position: string;
    rotation: string;
    scale: string;
    factor: number;
  };
  el: HTMLElement & {
    object3D?: {
      position: {
        x: number;
        y: number;
        z: number;
        set: (x: number, y: number, z: number) => void;
      };
      rotation: {
        x: number;
        y: number;
        z: number;
        set: (x: number, y: number, z: number) => void;
      };
      scale: {
        x: number;
        y: number;
        z: number;
        set: (x: number, y: number, z: number) => void;
      };
    };
  };
  targetPosition: Vec3;
  targetRotation: Vec3;
  targetScale: Vec3;
  parseVec3: (value: string, fallback: Vec3) => Vec3;
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
  modelLoadFailed: false,
  gltfAssetLoaded: false,
  gltfAssetFailed: false,
  object3DAttached: false,
  object3DRemoved: false,
  modelLocked: false
};

const AFRAME_SCRIPT_ID = "aframe-runtime";
const MINDAR_SCRIPT_ID = "mindar-image-aframe-runtime";
const AFRAME_SRC = "https://aframe.io/releases/1.5.0/aframe.min.js";
const MINDAR_SRC =
  "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-aframe.prod.js";
const SCRIPT_LOAD_TIMEOUT_MS = 10000;
const GLB_LOAD_TIMEOUT_MS = 20000;
const MODEL_LOAD_ERROR =
  "佛像模型未能载入。请确认 /public/models/buddha_001.glb 存在，并且已经替换为适合移动 WebAR 的优化 GLB 文件。";
const MODEL_OFFSET_STEP = 0.05;
const MODEL_OFFSET_LIMIT = 1;
const MODEL_SCALE_UP = 1.2;
const MODEL_SCALE_DOWN = 0.8;
const MODEL_SCALE_MIN = 0.001;
const MODEL_SCALE_MAX = 1;
const MODEL_ROTATION_STEP = 5;
// Experimental local-only smoothing amount for 防抖测试. Tune or remove this
// after real-device testing if it does not improve perceived target jitter.
const JITTER_REDUCTION_FACTOR = 0.15;

function vec3ToAttribute([x, y, z]: [number, number, number]) {
  return `${x} ${y} ${z}`;
}

function addVec3([ax, ay, az]: Vec3, [bx, by, bz]: Vec3): Vec3 {
  return [ax + bx, ay + by, az + bz];
}

function multiplyVec3([x, y, z]: Vec3, scalar: number): Vec3 {
  return [x * scalar, y * scalar, z * scalar];
}

function multiplyVec3ByVec3([ax, ay, az]: Vec3, [bx, by, bz]: Vec3): Vec3 {
  return [ax * bx, ay * by, az * bz];
}

function createDefaultTransform(): ExhibitTransform {
  return {
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    scaleMultiplier: 1
  };
}

function createInitialExhibitTransforms(): ExhibitTransforms {
  return Object.fromEntries(
    arExhibits.map((exhibit) => [exhibit.id, createDefaultTransform()])
  );
}

function clampOffset(value: number) {
  return Math.max(-MODEL_OFFSET_LIMIT, Math.min(MODEL_OFFSET_LIMIT, value));
}

function clampScale(value: number) {
  return Math.max(MODEL_SCALE_MIN, Math.min(MODEL_SCALE_MAX, value));
}

function degToRad(value: number) {
  return (value * Math.PI) / 180;
}

function radToDeg(value: number) {
  return (value * 180) / Math.PI;
}

function getThree() {
  return (
    window as typeof window & {
      AFRAME?: {
        THREE?: ThreeLike;
      };
    }
  ).AFRAME?.THREE;
}

function readLockedWorldTransform(
  anchor: HTMLElement,
  exhibitId: string
): LockedWorldTransform | undefined {
  const THREE = getThree();
  const object3D = (anchor as WorldReadableEntity).object3D;

  if (!THREE || !object3D) {
    return undefined;
  }

  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();

  object3D.getWorldPosition(position);
  object3D.getWorldQuaternion(quaternion);
  object3D.getWorldScale(scale);
  euler.setFromQuaternion(quaternion, "XYZ");

  return {
    exhibitId,
    position: [position.x, position.y, position.z],
    rotation: [radToDeg(euler.x), radToDeg(euler.y), radToDeg(euler.z)],
    scale: [scale.x, scale.y, scale.z]
  };
}

function getLockedModelTransform(
  exhibit: ARExhibitConfig,
  transform: ExhibitTransform,
  lockedBase: LockedWorldTransform
) {
  return {
    position: addVec3(
      lockedBase.position,
      addVec3(exhibit.defaultPosition, transform.offset)
    ),
    rotation: addVec3(
      addVec3(lockedBase.rotation, exhibit.defaultRotation),
      transform.rotation
    ),
    scale: multiplyVec3(
      multiplyVec3ByVec3(lockedBase.scale, exhibit.defaultScale),
      transform.scaleMultiplier
    )
  };
}

function registerLocalJitterReduction() {
  const win = window as typeof window & {
    AFRAME?: {
      components?: Record<string, unknown>;
      registerComponent: (name: string, definition: unknown) => void;
    };
  };

  if (!win.AFRAME || win.AFRAME.components?.["local-jitter-reduction"]) {
    return;
  }

  win.AFRAME.registerComponent("local-jitter-reduction", {
    schema: {
      position: { default: "0 0 0" },
      rotation: { default: "0 0 0" },
      scale: { default: "1 1 1" },
      factor: { default: JITTER_REDUCTION_FACTOR }
    },

    init: function init(this: LocalJitterReductionComponent) {
      this.targetPosition = this.parseVec3(this.data.position, [0, 0, 0]);
      this.targetRotation = this.parseVec3(this.data.rotation, [0, 0, 0]);
      this.targetScale = this.parseVec3(this.data.scale, [1, 1, 1]);
    },

    update: function update(this: LocalJitterReductionComponent) {
      this.targetPosition = this.parseVec3(this.data.position, [0, 0, 0]);
      this.targetRotation = this.parseVec3(this.data.rotation, [0, 0, 0]);
      this.targetScale = this.parseVec3(this.data.scale, [1, 1, 1]);
    },

    parseVec3: function parseVec3(value: string, fallback: Vec3) {
      const parsed = value
        .trim()
        .split(/\s+/)
        .map((item) => Number(item));

      return parsed.length === 3 && parsed.every(Number.isFinite)
        ? [parsed[0], parsed[1], parsed[2]]
        : fallback;
    },

    tick: function tick(this: LocalJitterReductionComponent) {
      const object3D = this.el.object3D;

      if (!object3D) {
        return;
      }

      const factor = this.data.factor;

      object3D.position.set(
        object3D.position.x + (this.targetPosition[0] - object3D.position.x) * factor,
        object3D.position.y + (this.targetPosition[1] - object3D.position.y) * factor,
        object3D.position.z + (this.targetPosition[2] - object3D.position.z) * factor
      );
      object3D.rotation.set(
        object3D.rotation.x + (degToRad(this.targetRotation[0]) - object3D.rotation.x) * factor,
        object3D.rotation.y + (degToRad(this.targetRotation[1]) - object3D.rotation.y) * factor,
        object3D.rotation.z + (degToRad(this.targetRotation[2]) - object3D.rotation.z) * factor
      );
      object3D.scale.set(
        object3D.scale.x + (this.targetScale[0] - object3D.scale.x) * factor,
        object3D.scale.y + (this.targetScale[1] - object3D.scale.y) * factor,
        object3D.scale.z + (this.targetScale[2] - object3D.scale.z) * factor
      );
    }
  });
}

function stopGltfAnimations(model: HTMLElement) {
  const aframeModel = model as HTMLElement & {
    components?: {
      "animation-mixer"?: {
        mixer?: {
          stopAllAction?: () => void;
          _actions?: Array<{
            enabled?: boolean;
            paused?: boolean;
            stop?: () => void;
          }>;
        };
        remove?: () => void;
      };
    };
    object3D?: {
      rotation?: {
        set: (x: number, y: number, z: number) => void;
      };
      traverse?: (callback: (object: { animations?: unknown[] }) => void) => void;
      animations?: unknown[];
    };
  };

  const animationGroups: unknown[] = [];

  if (aframeModel.object3D?.animations?.length) {
    animationGroups.push(...aframeModel.object3D.animations);
  }

  aframeModel.object3D?.traverse?.((object) => {
    if (object.animations?.length) {
      animationGroups.push(...object.animations);
    }
  });

  console.log("[AR Debug] GLTF animation clips found", animationGroups.length);

  const mixer = aframeModel.components?.["animation-mixer"]?.mixer;
  mixer?.stopAllAction?.();
  mixer?._actions?.forEach((action) => {
    action.stop?.();
    action.paused = true;
    action.enabled = false;
  });

  aframeModel.components?.["animation-mixer"]?.remove?.();
  model.removeAttribute("animation-mixer");
  model.removeAttribute("animation");
}

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function createTimeoutError(label: string, timeoutMs: number) {
  return new Error(`${label} timed out after ${timeoutMs / 1000} seconds.`);
}

function waitForScript(id: string, src: string, timeoutMs: number) {
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
        finish(resolve);
      },
      { once: true }
    );

    script.addEventListener(
      "error",
      () => {
        script.dataset.failed = "true";
        finish(() => reject(new Error(`Unable to load ${src}`)));
      },
      { once: true }
    );

    if (!existing) {
      document.head.appendChild(script);
    }

    timeoutId = setTimeout(() => {
      const label = id === MINDAR_SCRIPT_ID ? "MindAR load" : "A-Frame load";
      finish(() => reject(createTimeoutError(label, timeoutMs)));
    }, timeoutMs);
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
  activeExhibitId,
  jitterReductionEnabled,
  worldLockEnabled,
  worldLockActive,
  lockedPosition,
  lockedRotation,
  targetFileUrl,
  modelFileUrl,
  modelOffset,
  modelLocalPosition,
  modelRotation,
  modelScale,
  expanded,
  onToggle
}: {
  debug: DebugState;
  activeExhibitId: string;
  jitterReductionEnabled: boolean;
  worldLockEnabled: boolean;
  worldLockActive: boolean;
  lockedPosition?: Vec3;
  lockedRotation?: Vec3;
  targetFileUrl: string;
  modelFileUrl: string;
  modelOffset: Vec3;
  modelLocalPosition: Vec3;
  modelRotation: Vec3;
  modelScale: Vec3;
  expanded: boolean;
  onToggle: () => void;
}) {
  const rows: Array<[string, string]> = [
    ["AR component mounted", debug.componentMounted ? "yes" : "no"],
    ["A-Frame script loaded", debug.aframeScriptLoaded ? "yes" : "no"],
    ["MindAR script loaded", debug.mindarScriptLoaded ? "yes" : "no"],
    ["active exhibit id", activeExhibitId || "none"],
    ["jitter reduction enabled", jitterReductionEnabled ? "yes" : "no"],
    ["world lock enabled", worldLockEnabled ? "yes" : "no"],
    ["world lock active", worldLockActive ? "yes" : "no"],
    ["locked position", lockedPosition ? vec3ToAttribute(lockedPosition) : "none"],
    ["locked rotation", lockedRotation ? vec3ToAttribute(lockedRotation) : "none"],
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
    ["model load failed", debug.modelLoadFailed ? "yes" : "no"],
    ["gltf asset loaded", debug.gltfAssetLoaded ? "yes" : "no"],
    ["gltf asset failed", debug.gltfAssetFailed ? "yes" : "no"],
    ["object3D attached", debug.object3DAttached ? "yes" : "no"],
    ["object3D removed", debug.object3DRemoved ? "yes" : "no"],
    ["model locked", debug.modelLocked ? "yes" : "no"],
    ["current offset", vec3ToAttribute(modelOffset)],
    ["actual model local position", vec3ToAttribute(modelLocalPosition)],
    ["current model rotation", vec3ToAttribute(modelRotation)],
    ["current model scale", vec3ToAttribute(modelScale)]
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

function CalibrationControls({
  modelOffset,
  jitterReductionEnabled,
  worldLockEnabled,
  open,
  showTestCube,
  onAdjust,
  onAdjustRotation,
  onScaleDown,
  onScaleUp,
  onReset,
  onResetRotation,
  onResetWorldLock,
  onToggleJitterReduction,
  onToggleTestCube,
  onToggleWorldLock,
  onToggle
}: {
  modelOffset: Vec3;
  jitterReductionEnabled: boolean;
  worldLockEnabled: boolean;
  open: boolean;
  showTestCube: boolean;
  onAdjust: (delta: Vec3) => void;
  onAdjustRotation: (delta: Vec3) => void;
  onScaleDown: () => void;
  onScaleUp: () => void;
  onReset: () => void;
  onResetRotation: () => void;
  onResetWorldLock: () => void;
  onToggleJitterReduction: () => void;
  onToggleTestCube: () => void;
  onToggleWorldLock: () => void;
  onToggle: () => void;
}) {
  return (
    <aside
      className={`calibration-panel ${open ? "calibration-panel--open" : ""}`}
      aria-label="Model position adjustment"
    >
      <button className="calibration-toggle" type="button" onClick={onToggle}>
        {open ? "隐藏调整" : "调整位置"}
      </button>
      <button
        className="calibration-toggle"
        type="button"
        onClick={onToggleTestCube}
        aria-pressed={showTestCube}
      >
        Show Test Cube
      </button>
      <button
        className="calibration-toggle"
        type="button"
        onClick={onToggleJitterReduction}
        aria-pressed={jitterReductionEnabled}
      >
        防抖测试
      </button>
      <button
        className="calibration-toggle"
        type="button"
        onClick={onToggleWorldLock}
        aria-pressed={worldLockEnabled}
      >
        世界坐标锁定测试
      </button>
      <button
        className="calibration-toggle"
        type="button"
        onClick={onResetWorldLock}
      >
        重新锁定世界位置
      </button>

      {open ? (
        <div className="calibration-controls">
          <div className="calibration-offset">
            偏移 {vec3ToAttribute(modelOffset)}
          </div>
          <div className="calibration-grid">
            <button type="button" onClick={() => onAdjust([0, MODEL_OFFSET_STEP, 0])}>
              上
            </button>
            <button type="button" onClick={() => onAdjust([0, -MODEL_OFFSET_STEP, 0])}>
              下
            </button>
            <button type="button" onClick={() => onAdjust([-MODEL_OFFSET_STEP, 0, 0])}>
              左
            </button>
            <button type="button" onClick={() => onAdjust([MODEL_OFFSET_STEP, 0, 0])}>
              右
            </button>
            <button type="button" onClick={() => onAdjust([0, 0, MODEL_OFFSET_STEP])}>
              前
            </button>
            <button type="button" onClick={() => onAdjust([0, 0, -MODEL_OFFSET_STEP])}>
              后
            </button>
          </div>
          <div className="calibration-grid">
            <button type="button" onClick={() => onAdjustRotation([0, -MODEL_ROTATION_STEP, 0])}>
              左转
            </button>
            <button type="button" onClick={() => onAdjustRotation([0, MODEL_ROTATION_STEP, 0])}>
              右转
            </button>
            <button type="button" onClick={() => onAdjustRotation([-MODEL_ROTATION_STEP, 0, 0])}>
              前倾
            </button>
            <button type="button" onClick={() => onAdjustRotation([MODEL_ROTATION_STEP, 0, 0])}>
              后仰
            </button>
            <button type="button" onClick={() => onAdjustRotation([0, 0, -MODEL_ROTATION_STEP])}>
              逆时针
            </button>
            <button type="button" onClick={() => onAdjustRotation([0, 0, MODEL_ROTATION_STEP])}>
              顺时针
            </button>
          </div>
          <div className="calibration-grid">
            <button type="button" onClick={onScaleUp}>
              放大
            </button>
            <button type="button" onClick={onScaleDown}>
              缩小
            </button>
          </div>
          <button className="calibration-reset" type="button" onClick={onReset}>
            重置位置
          </button>
          <button className="calibration-reset" type="button" onClick={onResetRotation}>
            重置旋转
          </button>
        </div>
      ) : null}
    </aside>
  );
}

export default function ARViewer() {
  const sceneRef = useRef<AFrameScene | null>(null);
  const anchorRefs = useRef<Map<string, HTMLElement>>(new Map());
  const modelRefs = useRef<Map<string, HTMLElement>>(new Map());
  const lockedModelRef = useRef<HTMLElement | null>(null);
  const modelFinishedRef = useRef(false);
  const lockedWorldTransformRef = useRef<LockedWorldTransform | undefined>(
    undefined
  );
  const [runtimeState, setRuntimeState] = useState<RuntimeState>("idle");
  const [message, setMessage] = useState<string>();
  const [sceneEnabled, setSceneEnabled] = useState(false);
  const [assetLoaded, setAssetLoaded] = useState(false);
  const [targetVisible, setTargetVisible] = useState(false);
  const [debug, setDebug] = useState<DebugState>(initialDebugState);
  const [debugExpanded, setDebugExpanded] = useState(false);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [showTestCube, setShowTestCube] = useState(false);
  const [jitterReductionEnabled, setJitterReductionEnabled] = useState(false);
  const [worldLockEnabled, setWorldLockEnabled] = useState(false);
  const [lockedWorldTransform, setLockedWorldTransform] =
    useState<LockedWorldTransform>();
  const [activeExhibitId, setActiveExhibitId] = useState(
    arExhibits[0]?.id ?? ""
  );
  const [exhibitTransforms, setExhibitTransforms] =
    useState<ExhibitTransforms>(createInitialExhibitTransforms);
  const [origin, setOrigin] = useState("");
  const [httpsWarning, setHttpsWarning] = useState<string>();

  const activeExhibit = useMemo(
    () =>
      arExhibits.find((exhibit) => exhibit.id === activeExhibitId) ??
      arExhibits[0],
    [activeExhibitId]
  );
  const activeTransform =
    exhibitTransforms[activeExhibit?.id ?? ""] ?? createDefaultTransform();

  const targetFileUrl = useMemo(
    () => (origin ? new URL(imageTargetSrc, origin).href : imageTargetSrc),
    [origin]
  );

  const modelFileUrl = useMemo(
    () =>
      activeExhibit
        ? origin
          ? new URL(activeExhibit.modelUrl, origin).href
          : activeExhibit.modelUrl
        : "",
    [activeExhibit, origin]
  );
  const modelLocalPosition = useMemo(
    () =>
      activeExhibit
        ? addVec3(activeExhibit.defaultPosition, activeTransform.offset)
        : ([0, 0, 0] as Vec3),
    [activeExhibit, activeTransform.offset]
  );
  const modelRotation = useMemo(
    () =>
      activeExhibit
        ? addVec3(activeExhibit.defaultRotation, activeTransform.rotation)
        : ([0, 0, 0] as Vec3),
    [activeExhibit, activeTransform.rotation]
  );
  const modelScale = useMemo(
    () =>
      activeExhibit
        ? multiplyVec3(
            activeExhibit.defaultScale,
            activeTransform.scaleMultiplier
          )
        : ([1, 1, 1] as Vec3),
    [activeExhibit, activeTransform.scaleMultiplier]
  );
  const lockedExhibit = useMemo(
    () =>
      lockedWorldTransform
        ? arExhibits.find(
            (exhibit) => exhibit.id === lockedWorldTransform.exhibitId
          )
        : undefined,
    [lockedWorldTransform]
  );
  const lockedModelTransform = useMemo(() => {
    if (!lockedWorldTransform || !lockedExhibit) {
      return undefined;
    }

    const transform =
      exhibitTransforms[lockedWorldTransform.exhibitId] ??
      createDefaultTransform();

    return getLockedModelTransform(
      lockedExhibit,
      transform,
      lockedWorldTransform
    );
  }, [exhibitTransforms, lockedExhibit, lockedWorldTransform]);

  const updateDebug = useCallback((patch: Partial<DebugState>) => {
    setDebug((current) => {
      const next = { ...current, ...patch };
      console.log("[AR Debug] state update", patch, next);
      return next;
    });
  }, []);

  const resetWorldLock = useCallback(() => {
    lockedWorldTransformRef.current = undefined;
    setLockedWorldTransform(undefined);
  }, []);

  const lockWorldTransform = useCallback(
    (anchor: HTMLElement, exhibitId: string) => {
      if (!worldLockEnabled || lockedWorldTransformRef.current) {
        return;
      }

      const locked = readLockedWorldTransform(anchor, exhibitId);

      if (!locked) {
        console.warn("[AR Debug] world lock failed: target world transform unavailable");
        return;
      }

      console.log("[AR Debug] world lock captured", locked);
      lockedWorldTransformRef.current = locked;
      setLockedWorldTransform(locked);
      setActiveExhibitId(exhibitId);
    },
    [worldLockEnabled]
  );

  const toggleWorldLock = useCallback(() => {
    resetWorldLock();
    setWorldLockEnabled((current) => !current);
  }, [resetWorldLock]);

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

    const cleanups: Array<() => void> = [];

    anchorRefs.current.forEach((anchor, exhibitId) => {
      const handleTargetFound = () => {
        setActiveExhibitId(exhibitId);
        setTargetVisible(true);
        lockWorldTransform(anchor, exhibitId);
        updateDebug({
          targetFound: true,
          targetLost: false,
          modelLocked: true
        });
      };

      const handleTargetLost = () => {
        setTargetVisible(false);
        updateDebug({ targetLost: true });
      };

      anchor.addEventListener("targetFound", handleTargetFound);
      anchor.addEventListener("targetLost", handleTargetLost);
      cleanups.push(() => {
        anchor.removeEventListener("targetFound", handleTargetFound);
        anchor.removeEventListener("targetLost", handleTargetLost);
      });
    });

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [lockWorldTransform, sceneEnabled, updateDebug]);

  useEffect(() => {
    if (!sceneEnabled) {
      return;
    }

    const models = Array.from(modelRefs.current.values());
    modelFinishedRef.current = false;

    const logEvent = (eventName: string, event: Event) => {
      console.log(`[AR Debug] ${eventName}`, event);
    };

    const handleModelLoaded = (event: Event) => {
      logEvent("model-loaded", event);
      stopGltfAnimations(event.currentTarget as HTMLElement);
      modelFinishedRef.current = true;
      setAssetLoaded(true);
      updateDebug({
        gltfAssetLoaded: true,
        gltfAssetFailed: false,
        modelLoaded: true,
        modelLoadFailed: false
      });
    };

    const handleModelError = (event: Event) => {
      logEvent("model-error", event);
      modelFinishedRef.current = true;
      setAssetLoaded(false);
      updateDebug({
        gltfAssetLoaded: false,
        gltfAssetFailed: true,
        modelLoaded: false,
        modelLoadFailed: true
      });
      setRuntimeState("error");
      setMessage(MODEL_LOAD_ERROR);
    };

    const handleObject3DSet = (event: Event) => {
      logEvent("object3dset", event);
      updateDebug({ object3DAttached: true, object3DRemoved: false });
    };

    const handleObject3DRemove = (event: Event) => {
      logEvent("object3dremove", event);
      updateDebug({ object3DRemoved: true });
    };

    models.forEach((model) => {
      model.addEventListener("model-loaded", handleModelLoaded);
      model.addEventListener("model-error", handleModelError);
      model.addEventListener("object3dset", handleObject3DSet);
      model.addEventListener("object3dremove", handleObject3DRemove);
    });

    const timeoutId = setTimeout(() => {
      if (modelFinishedRef.current) {
        return;
      }

      const timeoutMessage = createTimeoutError(
        "GLB load",
        GLB_LOAD_TIMEOUT_MS
      ).message;
      console.error("[AR Debug] GLB load timed out");
      setAssetLoaded(false);
      updateDebug({ modelLoaded: false, modelLoadFailed: true });
      setRuntimeState("error");
      setMessage(timeoutMessage);
    }, GLB_LOAD_TIMEOUT_MS);

    return () => {
      clearTimeout(timeoutId);
      models.forEach((model) => {
        model.removeEventListener("model-loaded", handleModelLoaded);
        model.removeEventListener("model-error", handleModelError);
        model.removeEventListener("object3dset", handleObject3DSet);
        model.removeEventListener("object3dremove", handleObject3DRemove);
      });
    };
  }, [sceneEnabled, updateDebug]);

  useEffect(() => {
    const lockedModel = lockedModelRef.current;

    if (!lockedModel) {
      return;
    }

    const handleLockedModelLoaded = (event: Event) => {
      console.log("[AR Debug] world locked model-loaded", event);
      stopGltfAnimations(event.currentTarget as HTMLElement);
    };

    const handleLockedModelError = (event: Event) => {
      console.error("[AR Debug] world locked model-error", event);
    };

    lockedModel.addEventListener("model-loaded", handleLockedModelLoaded);
    lockedModel.addEventListener("model-error", handleLockedModelError);

    return () => {
      lockedModel.removeEventListener("model-loaded", handleLockedModelLoaded);
      lockedModel.removeEventListener("model-error", handleLockedModelError);
    };
  }, [lockedWorldTransform]);

  const startAR = useCallback(async () => {
    let cameraRequested = false;

    setRuntimeState("loading");
    setMessage("正在载入 AR 脚本");
    setAssetLoaded(false);
    setTargetVisible(false);
    setJitterReductionEnabled(false);
    setWorldLockEnabled(false);
    resetWorldLock();
    setActiveExhibitId(arExhibits[0]?.id ?? "");
    setExhibitTransforms(createInitialExhibitTransforms());
    updateDebug({
      aframeScriptLoaded: false,
      mindarScriptLoaded: false,
      cameraPermissionRequested: false,
      cameraPermissionGranted: false,
      cameraPermissionDenied: false,
      targetFound: false,
      targetLost: false,
      modelLoaded: false,
      modelLoadFailed: false,
      gltfAssetLoaded: false,
      gltfAssetFailed: false,
      object3DAttached: false,
      object3DRemoved: false,
      modelLocked: false
    });

    try {
      await waitForScript(
        AFRAME_SCRIPT_ID,
        AFRAME_SRC,
        SCRIPT_LOAD_TIMEOUT_MS
      );
      registerLocalJitterReduction();
      updateDebug({ aframeScriptLoaded: true });

      await waitForScript(
        MINDAR_SCRIPT_ID,
        MINDAR_SRC,
        SCRIPT_LOAD_TIMEOUT_MS
      );
      updateDebug({ mindarScriptLoaded: true });

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
  }, [resetWorldLock, updateDebug]);

  const adjustModelOffset = useCallback((delta: Vec3) => {
    setExhibitTransforms((current) => {
      const transform = current[activeExhibitId] ?? createDefaultTransform();

      return {
        ...current,
        [activeExhibitId]: {
          ...transform,
          offset: [
            clampOffset(transform.offset[0] + delta[0]),
            clampOffset(transform.offset[1] + delta[1]),
            clampOffset(transform.offset[2] + delta[2])
          ]
        }
      };
    });
  }, [activeExhibitId]);

  const adjustModelRotation = useCallback((delta: Vec3) => {
    setExhibitTransforms((current) => {
      const transform = current[activeExhibitId] ?? createDefaultTransform();

      return {
        ...current,
        [activeExhibitId]: {
          ...transform,
          rotation: [
            transform.rotation[0] + delta[0],
            transform.rotation[1] + delta[1],
            transform.rotation[2] + delta[2]
          ]
        }
      };
    });
  }, [activeExhibitId]);

  const scaleModel = useCallback((factor: number) => {
    setExhibitTransforms((current) => {
      const transform = current[activeExhibitId] ?? createDefaultTransform();

      return {
        ...current,
        [activeExhibitId]: {
          ...transform,
          scaleMultiplier: clampScale(transform.scaleMultiplier * factor)
        }
      };
    });
  }, [activeExhibitId]);

  const getExhibitModelTransform = useCallback(
    (exhibit: ARExhibitConfig) => {
      const transform = exhibitTransforms[exhibit.id] ?? createDefaultTransform();

      return {
        position: addVec3(exhibit.defaultPosition, transform.offset),
        rotation: addVec3(exhibit.defaultRotation, transform.rotation),
        scale: multiplyVec3(exhibit.defaultScale, transform.scaleMultiplier)
      };
    },
    [exhibitTransforms]
  );

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
          activeExhibitId={activeExhibit?.id ?? ""}
          debug={debug}
          expanded={debugExpanded}
          jitterReductionEnabled={jitterReductionEnabled}
          lockedPosition={lockedModelTransform?.position}
          lockedRotation={lockedModelTransform?.rotation}
          modelFileUrl={modelFileUrl}
          modelLocalPosition={modelLocalPosition}
          modelOffset={activeTransform.offset}
          modelRotation={modelRotation}
          modelScale={modelScale}
          onToggle={() => setDebugExpanded((current) => !current)}
          targetFileUrl={targetFileUrl}
          worldLockActive={Boolean(lockedWorldTransform)}
          worldLockEnabled={worldLockEnabled}
        />
      </>
    );
  }

  return (
    <main className="ar-stage">
      {(runtimeState === "loading" ||
        !assetLoaded ||
        (!targetVisible && !lockedWorldTransform)) && (
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
          {arExhibits.map((exhibit) => {
            const anchorKey = exhibit.id;
            const transform = getExhibitModelTransform(exhibit);
            const jitterReductionAttribute = `position: ${vec3ToAttribute(transform.position)}; rotation: ${vec3ToAttribute(transform.rotation)}; scale: ${vec3ToAttribute(transform.scale)}; factor: ${JITTER_REDUCTION_FACTOR}`;
            const targetChildVisible =
              !worldLockEnabled ||
              lockedWorldTransform?.exhibitId !== exhibit.id;

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
                mindar-image-target={`targetIndex: ${exhibit.targetIndex}`}
              >
                <a-entity
                  id={`${exhibit.id}-model`}
                  ref={(element) => {
                    if (element) {
                      modelRefs.current.set(anchorKey, element);
                    } else {
                      modelRefs.current.delete(anchorKey);
                    }
                  }}
                  data-ar-model={exhibit.id}
                  gltf-model={exhibit.modelUrl}
                  local-jitter-reduction={
                    jitterReductionEnabled
                      ? jitterReductionAttribute
                      : undefined
                  }
                  position={vec3ToAttribute(transform.position)}
                  rotation={vec3ToAttribute(transform.rotation)}
                  scale={vec3ToAttribute(transform.scale)}
                  visible={targetChildVisible ? "true" : "false"}
                />
                {showTestCube ? (
                  <a-box
                    position="0 0 0"
                    depth="0.1"
                    height="0.1"
                    width="0.1"
                    color="red"
                  />
                ) : null}
              </a-entity>
            );
          })}

          {worldLockEnabled && lockedExhibit && lockedModelTransform ? (
            <a-entity
              id={`${lockedExhibit.id}-world-locked-model`}
              ref={(element) => {
                lockedModelRef.current = element;
              }}
              data-world-locked-model={lockedExhibit.id}
              gltf-model={lockedExhibit.modelUrl}
              position={vec3ToAttribute(lockedModelTransform.position)}
              rotation={vec3ToAttribute(lockedModelTransform.rotation)}
              scale={vec3ToAttribute(lockedModelTransform.scale)}
            />
          ) : null}

          <a-camera position="0 0 0" look-controls="enabled: false" />
        </a-scene>
      ) : null}

      <CalibrationControls
        jitterReductionEnabled={jitterReductionEnabled}
        modelOffset={activeTransform.offset}
        onAdjust={adjustModelOffset}
        onAdjustRotation={adjustModelRotation}
        onReset={() =>
          setExhibitTransforms((current) => {
            const transform =
              current[activeExhibitId] ?? createDefaultTransform();

            return {
              ...current,
              [activeExhibitId]: {
                ...transform,
                offset: [0, 0, 0]
              }
            };
          })
        }
        onResetRotation={() =>
          setExhibitTransforms((current) => {
            const transform =
              current[activeExhibitId] ?? createDefaultTransform();

            return {
              ...current,
              [activeExhibitId]: {
                ...transform,
                rotation: [0, 0, 0]
              }
            };
          })
        }
        onScaleDown={() => scaleModel(MODEL_SCALE_DOWN)}
        onScaleUp={() => scaleModel(MODEL_SCALE_UP)}
        onResetWorldLock={resetWorldLock}
        onToggleJitterReduction={() =>
          setJitterReductionEnabled((current) => !current)
        }
        onToggleTestCube={() => setShowTestCube((current) => !current)}
        onToggleWorldLock={toggleWorldLock}
        onToggle={() => setCalibrationOpen((current) => !current)}
        open={calibrationOpen}
        showTestCube={showTestCube}
        worldLockEnabled={worldLockEnabled}
      />

      <DebugPanel
        activeExhibitId={activeExhibit?.id ?? ""}
        debug={debug}
        expanded={debugExpanded}
        jitterReductionEnabled={jitterReductionEnabled}
        lockedPosition={lockedModelTransform?.position}
        lockedRotation={lockedModelTransform?.rotation}
        modelFileUrl={modelFileUrl}
        modelLocalPosition={modelLocalPosition}
        modelOffset={activeTransform.offset}
        modelRotation={modelRotation}
        modelScale={modelScale}
        onToggle={() => setDebugExpanded((current) => !current)}
        targetFileUrl={targetFileUrl}
        worldLockActive={Boolean(lockedWorldTransform)}
        worldLockEnabled={worldLockEnabled}
      />
    </main>
  );
}
