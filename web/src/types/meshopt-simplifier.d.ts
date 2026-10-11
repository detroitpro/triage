// three ships meshoptimizer's simplifier without types; only what npcCrowd.ts uses.
declare module "three/examples/jsm/libs/meshopt_simplifier.module.js" {
  export const MeshoptSimplifier: {
    ready: Promise<void>;
    /** Returns the new index buffer and the resulting relative error. */
    simplify(
      indices: Uint32Array,
      positions: Float32Array,
      stride: number,
      targetIndexCount: number,
      targetError: number,
      flags?: ("LockBorder" | "Sparse" | "ErrorAbsolute")[],
    ): [Uint32Array, number];
  };
}
