"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ModelTestState = {
  aframeLoaded: boolean;
  modelLoaded: boolean;
  modelError: boolean;
  object3DSet: boolean;
  object3DRemoved: boolean;
  boundingBoxSize: string;
  appliedScale: string;
  lastEvent: string;
};

const AFRAME_SCRIPT_ID = "aframe-runtime";
const AFRAME_SRC = "https://aframe.io/releases/1.5.0/aframe.min.js";
const MODEL_URL = "/models/buddha_001.glb";
const AFRAME_LOAD_TIMEOUT_MS = 10000;
const GLB_LOAD_TIMEOUT_MS = 20000;

const initialState: ModelTestState = {
  aframeLoaded: false,
  modelLoaded: false,
  modelError: false,
  object3DSet: false,
  object3DRemoved: false,
  boundingBoxSize: "not measured",
  appliedScale: "not applied",
  lastEvent: "waiting"
};

type AFrameModelElement = HTMLElement & {
  object3D?: {
    position: {
      x: number;
      y: number;
      z: number;
      set: (x: number, y: number, z: number) => void;
      sub: (value: unknown) => unknown;
    };
    scale: {
      setScalar: (scale: number) => void;
    };
  };
};

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
      finish(() => reject(createTimeoutError("A-Frame load", timeoutMs)));
    }, timeoutMs);
  });
}

function formatNumber(value: number) {
  return Number.isFinite(value) ? value.toFixed(4) : "unknown";
}

function autoFitModel(model: AFrameModelElement) {
  const win = window as typeof window & {
    THREE?: {
      Box3: new () => {
        setFromObject: (object: unknown) => {
          getSize: (target: unknown) => unknown;
          getCenter: (target: unknown) => unknown;
        };
      };
      Vector3: new () => {
        x: number;
        y: number;
        z: number;
      };
    };
  };

  if (!win.THREE || !model.object3D) {
    return {
      appliedScale: 1,
      boundingBoxSize: "THREE/object3D unavailable"
    };
  }

  model.object3D.scale.setScalar(1);
  model.object3D.position.set(0, 0, -3);

  const box = new win.THREE.Box3().setFromObject(model.object3D);
  const size = new win.THREE.Vector3();
  const center = new win.THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxDimension = Math.max(size.x, size.y, size.z);
  const appliedScale = maxDimension > 0 ? 2 / maxDimension : 1;

  model.object3D.scale.setScalar(appliedScale);
  model.object3D.position.sub(center);
  model.object3D.position.set(
    model.object3D.position.x * appliedScale,
    model.object3D.position.y * appliedScale,
    model.object3D.position.z * appliedScale - 3
  );

  return {
    appliedScale,
    boundingBoxSize: `${formatNumber(size.x)} ${formatNumber(size.y)} ${formatNumber(size.z)}`
  };
}

export default function ModelTestViewer() {
  const modelRef = useRef<HTMLElement | null>(null);
  const modelLoadedRef = useRef(false);
  const modelFailedRef = useRef(false);
  const [started, setStarted] = useState(false);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<ModelTestState>(initialState);

  const updateState = useCallback((patch: Partial<ModelTestState>) => {
    setState((current) => {
      const next = { ...current, ...patch };
      console.log("[Model Test]", patch, next);
      return next;
    });
  }, []);

  const attachModelRef = useCallback(
    (element: HTMLElement | null) => {
      modelRef.current = element;
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    if (!started) {
      return;
    }

    waitForScript(AFRAME_SCRIPT_ID, AFRAME_SRC, AFRAME_LOAD_TIMEOUT_MS)
      .then(() => {
        if (cancelled) {
          return;
        }

        updateState({ aframeLoaded: true, lastEvent: "A-Frame loaded" });
        setReady(true);
      })
      .catch((error) => {
        console.error("[Model Test] A-Frame script failed", error);
        updateState({
          lastEvent:
            error instanceof Error ? error.message : "A-Frame script failed"
        });
      });

    return () => {
      cancelled = true;
    };
  }, [started, updateState]);

  useEffect(() => {
    const model = modelRef.current;

    if (!ready || !model) {
      return;
    }

    modelLoadedRef.current = false;
    modelFailedRef.current = false;

    const logEvent = (name: string, event: Event) => {
      console.log(`[Model Test] ${name}`, event);
    };

    const handleModelLoaded = (event: Event) => {
      logEvent("model-loaded", event);
      modelLoadedRef.current = true;
      const fit = autoFitModel(model);
      updateState({
        appliedScale: formatNumber(fit.appliedScale),
        boundingBoxSize: fit.boundingBoxSize,
        lastEvent: "model-loaded",
        modelLoaded: true,
        modelError: false
      });
    };

    const handleModelError = (event: Event) => {
      logEvent("model-error", event);
      modelFailedRef.current = true;
      updateState({
        lastEvent: "model-error",
        modelLoaded: false,
        modelError: true
      });
    };

    const handleObject3DSet = (event: Event) => {
      logEvent("object3dset", event);
      updateState({
        lastEvent: "object3dset",
        object3DSet: true,
        object3DRemoved: false
      });
    };

    const handleObject3DRemove = (event: Event) => {
      logEvent("object3dremove", event);
      updateState({
        lastEvent: "object3dremove",
        object3DRemoved: true
      });
    };

    model.addEventListener("model-loaded", handleModelLoaded);
    model.addEventListener("model-error", handleModelError);
    model.addEventListener("object3dset", handleObject3DSet);
    model.addEventListener("object3dremove", handleObject3DRemove);

    const timeoutId = setTimeout(() => {
      if (modelLoadedRef.current || modelFailedRef.current) {
        return;
      }

      console.error("[Model Test] GLB load timed out");
      updateState({
        lastEvent: createTimeoutError("GLB load", GLB_LOAD_TIMEOUT_MS).message,
        modelLoaded: false,
        modelError: true
      });
    }, GLB_LOAD_TIMEOUT_MS);

    return () => {
      clearTimeout(timeoutId);
      model.removeEventListener("model-loaded", handleModelLoaded);
      model.removeEventListener("model-error", handleModelError);
      model.removeEventListener("object3dset", handleObject3DSet);
      model.removeEventListener("object3dremove", handleObject3DRemove);
    };
  }, [ready, updateState]);

  const rows: Array<[string, string]> = [
    ["A-Frame loaded", state.aframeLoaded ? "yes" : "no"],
    ["model-loaded", state.modelLoaded ? "yes" : "no"],
    ["model-error", state.modelError ? "yes" : "no"],
    ["object3dset", state.object3DSet ? "yes" : "no"],
    ["object3dremove", state.object3DRemoved ? "yes" : "no"],
    ["bounding box size", state.boundingBoxSize],
    ["applied scale", state.appliedScale],
    ["model URL", MODEL_URL],
    ["last event", state.lastEvent]
  ];

  return (
    <main className="model-test-page">
      <section className="model-test-panel" aria-label="Model test diagnostics">
        <h1>Model Test</h1>
        {!started ? (
          <button
            className="model-test-button"
            type="button"
            onClick={() => {
              updateState({ lastEvent: "loading requested" });
              setStarted(true);
            }}
          >
            加载模型
          </button>
        ) : null}
        <dl>
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {started && ready ? (
        <a-scene
          class="model-test-scene"
          background="color: #d9c5a7"
          renderer="colorManagement: true, physicallyCorrectLights"
          embedded
          vr-mode-ui="enabled: false"
        >
          <a-entity light="type: ambient; intensity: 0.8" />
          <a-entity light="type: directional; intensity: 0.9" position="1 2 1" />
          <a-entity
            ref={attachModelRef}
            gltf-model={MODEL_URL}
            position="0 0 -3"
            scale="1 1 1"
          />
          <a-camera position="0 0 0" />
        </a-scene>
      ) : started ? (
        <div className="model-test-loading">Loading A-Frame...</div>
      ) : (
        <div className="model-test-loading">点击“加载模型”开始测试</div>
      )}
    </main>
  );
}
