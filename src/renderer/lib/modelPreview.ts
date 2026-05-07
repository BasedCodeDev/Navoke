import * as THREE from "three";

interface PreviewMaterial extends THREE.Material {
  color?: THREE.Color;
  emissive?: THREE.Color;
  map?: THREE.Texture | null;
  metalness?: number;
  roughness?: number;
}

export function waitForPreviewAssets(manager: THREE.LoadingManager, timeoutMs = 20_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let sawLoadingWork = false;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve();
    };
    const fail = (url: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      reject(new Error(`Failed to load model asset: ${url}`));
    };
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Timed out loading model textures."));
    }, timeoutMs);

    manager.onStart = () => {
      sawLoadingWork = true;
    };
    manager.onLoad = finish;
    manager.onError = fail;

    window.setTimeout(() => {
      if (!sawLoadingWork) finish();
    }, 0);
  });
}

export async function waitForPreviewTextures(object: THREE.Object3D, timeoutMs = 20_000): Promise<void> {
  const textures = new Set<THREE.Texture>();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    for (const material of materialList(child.material)) {
      for (const value of Object.values(material as Record<string, unknown>)) {
        if (value instanceof THREE.Texture) {
          textures.add(value);
        }
      }
    }
  });

  if (textures.size === 0) return;
  await Promise.all([...textures].map((texture) => waitForTextureImageDecode(texture, timeoutMs)));
  await waitForPreviewFrame();
}

export function isObjModelArtifact(artifact: { name: string; metadata?: unknown }): boolean {
  const metadata = getModelArtifactMetadata(artifact.metadata);
  return artifact.name.toLowerCase().endsWith(".obj") || metadata.modelFormat === "obj" || Boolean(metadata.objFileName);
}

export function getModelArtifactMetadata(metadata: unknown): { modelFormat?: string; objFileName?: string; mtlFileName?: string } {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const record = metadata as Record<string, unknown>;
  return {
    ...(typeof record.modelFormat === "string" ? { modelFormat: record.modelFormat } : {}),
    ...(typeof record.objFileName === "string" ? { objFileName: record.objFileName } : {}),
    ...(typeof record.mtlFileName === "string" ? { mtlFileName: record.mtlFileName } : {})
  };
}

export function normalizePreviewObject(object: THREE.Object3D, targetSize = 2.2): void {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  object.position.sub(center);
  const maxDimension = Math.max(size.x, size.y, size.z);
  if (maxDimension > 0) object.scale.setScalar(targetSize / maxDimension);
  object.updateMatrixWorld(true);
}

export function ensurePreviewGeometryNormals(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geometry = child.geometry;
    if (!geometry.getAttribute("normal")) {
      geometry.computeVertexNormals();
    }
  });
}

export function preparePreviewMaterials(object: THREE.Object3D): void {
  const neutralPreviewColor = new THREE.Color(0xb8b8b8);
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = false;
    child.receiveShadow = false;
    for (const material of materialList(child.material)) {
      material.side = THREE.DoubleSide;
      if (material.color) {
        const luminance = colorLuminance(material.color);
        if (material.map) {
          material.color.setRGB(1, 1, 1);
        } else if (!material.map && luminance < 0.16) {
          material.color.lerp(neutralPreviewColor, 0.85);
        }
      }
      if (material.emissive && (!material.map || colorLuminance(material.emissive) < 0.02)) {
        material.emissive.setRGB(0.04, 0.04, 0.04);
      }
      if (typeof material.roughness === "number") {
        material.roughness = Math.min(Math.max(material.roughness, 0.35), 0.78);
      }
      if (typeof material.metalness === "number") {
        material.metalness = Math.min(material.metalness, 0.35);
      }
      material.needsUpdate = true;
    }
  });
}

export function addPreviewLighting(scene: THREE.Scene, camera: THREE.Camera): void {
  scene.add(camera);
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8bcc4, 0.8));

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.45);
  keyLight.position.set(1.2, 1.8, 1.4);
  camera.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
  fillLight.position.set(-1.6, 0.8, 0.4);
  camera.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffffff, 0.25);
  rimLight.position.set(0, 1.2, -1.0);
  camera.add(rimLight);
}

export function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  for (const item of Array.isArray(material) ? material : [material]) {
    for (const value of Object.values(item as Record<string, unknown>)) {
      if (value instanceof THREE.Texture) value.dispose();
    }
    item.dispose();
  }
}

function materialList(material: THREE.Material | THREE.Material[]): PreviewMaterial[] {
  return (Array.isArray(material) ? material : [material]).filter(Boolean) as PreviewMaterial[];
}

function colorLuminance(color: THREE.Color): number {
  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
}

function waitForPreviewFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function waitForTextureImageDecode(texture: THREE.Texture, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const image = texture.image;
      if (image instanceof HTMLImageElement) {
        void waitForImageDecode(image).then(resolve, reject);
        return;
      }
      if (image) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error("Timed out loading model texture image data."));
        return;
      }
      window.setTimeout(check, 25);
    };
    check();
  });
}

function waitForImageDecode(image: HTMLImageElement): Promise<void> {
  if (image.complete && image.naturalWidth > 0) {
    return typeof image.decode === "function" ? image.decode().catch(() => undefined) : Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const finish = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error(`Failed to decode model texture: ${image.currentSrc || image.src || "unknown texture"}`));
    };
    const cleanup = () => {
      image.removeEventListener("load", finish);
      image.removeEventListener("error", fail);
    };
    image.addEventListener("load", finish, { once: true });
    image.addEventListener("error", fail, { once: true });
  });
}
