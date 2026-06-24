"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ModelTestState = {
  aframeLoaded: boolean;
  modelLoaded: boolean;
  modelError: boolean;
  object3DSet: boolean;
  object3DRemoved: boolean;
  lastEvent: string;
};

const AFRAME_SCRIPT_ID = "aframe-runtime";
const AFRAME_SRC = "https://aframe.io/releases/1.5.0/aframe.min.js";
const MODEL_URL = "/models/buddha_001.glb";

const initialState: ModelTestState = {
  aframeLoaded: false,
  modelLoaded: false,
  modelError: false,
  object3DSet: false,
  object3DRemoved: false,
  lastEvent: "waiting"
};

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

export default function ModelTestViewer() {
  const modelRef = useRef<HTMLElement | null>(null);
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

    waitForScript(AFRAME_SCRIPT_ID, AFRAME_SRC)
      .then(() => {
        if (cancelled) {
          return;
        }

        updateState({ aframeLoaded: true, lastEvent: "A-Frame loaded" });
        setReady(true);
      })
      .catch((error) => {
        console.error("[Model Test] A-Frame script failed", error);
        updateState({ lastEvent: "A-Frame script failed" });
      });

    return () => {
      cancelled = true;
    };
  }, [updateState]);

  useEffect(() => {
    const model = modelRef.current;

    if (!ready || !model) {
      return;
    }

    const logEvent = (name: string, event: Event) => {
      console.log(`[Model Test] ${name}`, event);
    };

    const handleModelLoaded = (event: Event) => {
      logEvent("model-loaded", event);
      updateState({
        lastEvent: "model-loaded",
        modelLoaded: true,
        modelError: false
      });
    };

    const handleModelError = (event: Event) => {
      logEvent("model-error", event);
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

    return () => {
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
    ["model URL", MODEL_URL],
    ["last event", state.lastEvent]
  ];

  return (
    <main className="model-test-page">
      <section className="model-test-panel" aria-label="Model test diagnostics">
        <h1>Model Test</h1>
        <dl>
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {ready ? (
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
      ) : (
        <div className="model-test-loading">Loading A-Frame...</div>
      )}
    </main>
  );
}
