declare module "three" {
  export class Vector3 {
    constructor(x?: number, y?: number, z?: number);
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): this;
    setScalar(value: number): this;
    sub(value: Vector3): this;
  }

  export class Color {
    constructor(color?: number | string);
    r: number;
    g: number;
    b: number;
    setRGB(r: number, g: number, b: number): this;
    lerp(color: Color, alpha: number): this;
  }

  export class Object3D {
    position: Vector3;
    scale: Vector3;
    add(object: Object3D): this;
    traverse(callback: (object: Object3D) => void): void;
    updateMatrixWorld(force?: boolean): void;
  }

  export class Group extends Object3D {}

  export class Scene extends Object3D {
    add(object: Object3D): this;
  }

  export class Camera extends Object3D {}

  export class PerspectiveCamera extends Camera {
    constructor(fov?: number, aspect?: number, near?: number, far?: number);
    aspect: number;
    updateProjectionMatrix(): void;
  }

  export class Box3 {
    setFromObject(object: Object3D): this;
    getSize(target: Vector3): Vector3;
    getCenter(target: Vector3): Vector3;
  }

  export class Texture {
    image?: unknown;
    dispose(): void;
  }

  export class Material {
    needsUpdate: boolean;
    side: number;
    dispose(): void;
    [key: string]: unknown;
  }

  export class BufferGeometry {
    getAttribute(name: string): { count: number } | undefined;
    computeVertexNormals(): void;
    dispose(): void;
  }

  export class Mesh extends Object3D {
    castShadow: boolean;
    geometry: BufferGeometry;
    material: Material | Material[];
    receiveShadow: boolean;
  }

  export class LoadingManager {
    onStart?: (url: string, itemsLoaded: number, itemsTotal: number) => void;
    onLoad?: () => void;
    onError?: (url: string) => void;
  }

  export class Loader<T = unknown> {
    constructor(manager?: LoadingManager);
    load(
      url: string,
      onLoad: (data: T) => void,
      onProgress?: (event: ProgressEvent) => void,
      onError?: (error: unknown) => void
    ): void;
  }

  export class WebGLRenderer {
    constructor(parameters?: { antialias?: boolean; alpha?: boolean });
    domElement: HTMLCanvasElement;
    outputColorSpace: string;
    toneMapping: number;
    toneMappingExposure: number;
    setPixelRatio(value: number): void;
    setClearColor(color: number, alpha?: number): void;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    render(scene: Scene, camera: Camera): void;
    dispose(): void;
  }

  export class HemisphereLight extends Object3D {
    constructor(skyColor?: number, groundColor?: number, intensity?: number);
  }

  export class AmbientLight extends Object3D {
    constructor(color?: number, intensity?: number);
  }

  export class DirectionalLight extends Object3D {
    constructor(color?: number, intensity?: number);
  }

  export const ACESFilmicToneMapping: number;
  export const DoubleSide: number;
  export const SRGBColorSpace: string;
}

declare module "three/addons/controls/OrbitControls.js" {
  import type { Camera, Vector3 } from "three";

  export class OrbitControls {
    constructor(object: Camera, domElement?: HTMLElement);
    enableDamping: boolean;
    target: Vector3;
    update(): boolean;
    dispose(): void;
  }
}

declare module "three/addons/loaders/MTLLoader.js" {
  import type { Loader, LoadingManager, Material } from "three";

  export class MaterialCreator {
    preload(): void;
    materials: Record<string, Material>;
  }

  export class MTLLoader extends Loader<MaterialCreator> {
    constructor(manager?: LoadingManager);
  }
}

declare module "three/addons/loaders/FBXLoader.js" {
  import type { Group, Loader, LoadingManager } from "three";

  export class FBXLoader extends Loader<Group> {
    constructor(manager?: LoadingManager);
  }
}

declare module "three/addons/loaders/OBJLoader.js" {
  import type { Group, Loader, LoadingManager } from "three";
  import type { MaterialCreator } from "three/addons/loaders/MTLLoader.js";

  export class OBJLoader extends Loader<Group> {
    constructor(manager?: LoadingManager);
    setMaterials(materials: MaterialCreator): this;
  }
}
