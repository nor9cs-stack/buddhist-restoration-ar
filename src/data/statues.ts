export type Vec3 = [number, number, number];

export type StatueConfig = {
  name: string;
  modelUrl: string;
  targetIndex: number;
  scale: Vec3;
  position: Vec3;
  rotation: Vec3;
};

export const imageTargetSrc = "/targets/buddha_targets.mind";

export const statues: StatueConfig[] = [
  {
    name: "buddha_001",
    modelUrl: "/models/test_cube.glb",
    targetIndex: 0,
    scale: [0.2, 0.2, 0.2],
    position: [0, 0, 0],
    rotation: [0, 0, 0]
  }

  // Add future AR statues here:
  // {
  //   name: "statue_name",
  //   modelUrl: "/models/your_exported_model.glb",
  //   targetIndex: 1,
  //   scale: [0.35, 0.35, 0.35],
  //   position: [0, -0.25, 0],
  //   rotation: [0, 0, 0]
  // }
];
