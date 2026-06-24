import type { DetailedHTMLProps, HTMLAttributes } from "react";

type AFrameElementProps = DetailedHTMLProps<
  HTMLAttributes<HTMLElement>,
  HTMLElement
> & {
  [key: string]: unknown;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "a-scene": AFrameElementProps;
      "a-assets": AFrameElementProps;
      "a-asset-item": AFrameElementProps;
      "a-camera": AFrameElementProps;
      "a-entity": AFrameElementProps;
      "a-gltf-model": AFrameElementProps;
    }
  }
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "a-scene": AFrameElementProps;
      "a-assets": AFrameElementProps;
      "a-asset-item": AFrameElementProps;
      "a-camera": AFrameElementProps;
      "a-entity": AFrameElementProps;
      "a-gltf-model": AFrameElementProps;
    }
  }
}

export {};
