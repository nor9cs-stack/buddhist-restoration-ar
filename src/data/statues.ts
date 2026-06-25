export type Vec3 = [number, number, number];

export type ARExhibitConfig = {
  id: string;
  title: string;
  description: string;
  targetIndex: number;
  modelUrl: string;
  anchorImageUrl: string;
  defaultPosition: Vec3;
  defaultRotation: Vec3;
  defaultScale: Vec3;
};

export const imageTargetSrc = "/targets/buddha_targets.mind";

export const arExhibits: ARExhibitConfig[] = [
  {
    id: "buddha_001",
    title: "佛像修复 001",
    description: "数字佛像修复展示，用于佛教文化遗产 WebAR 展陈。",
    targetIndex: 0,
    modelUrl: "/models/buddha_001.glb",
    anchorImageUrl: "/targets/buddha_targets.mind",
    defaultPosition: [0, 0, 0],
    defaultRotation: [0, 0, 0],
    defaultScale: [0.03, 0.03, 0.03]
  }

  // Add future AR museum exhibits here. Each exhibit must use a targetIndex
  // that exists inside /public/targets/buddha_targets.mind.
  // {
  //   id: "buddha_002",
  //   title: "佛像修复 002",
  //   description: "下一件数字修复展品说明。",
  //   targetIndex: 1,
  //   modelUrl: "/models/buddha_002.glb",
  //   anchorImageUrl: "/targets/buddha_002.jpg",
  //   defaultPosition: [0, 0, 0],
  //   defaultRotation: [0, 0, 0],
  //   defaultScale: [0.03, 0.03, 0.03]
  // }
];
