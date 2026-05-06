import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { MTLLoader, type MaterialCreator } from "three/addons/loaders/MTLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { artifactAssetUrl, artifactUrl, type ArtifactRecord } from "@/lib/api";

export function ObjModelViewer({ artifact }: { artifact: ArtifactRecord }): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let frameId = 0;
    setStatus("loading");

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    camera.position.set(0, 1.2, 3.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x606070, 2.2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
    keyLight.position.set(3, 4, 5);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 1.1);
    fillLight.position.set(-4, 2, -3);
    scene.add(fillLight);

    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      const nextWidth = Math.max(1, Math.floor(width));
      const nextHeight = Math.max(1, Math.floor(height));
      renderer.setSize(nextWidth, nextHeight, false);
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(animate);
    };
    animate();

    void loadObjArtifact(artifact).then(
      (object) => {
        if (disposed) return;
        normalizeObject(object);
        scene.add(object);
        setStatus("ready");
      },
      () => {
        if (!disposed) setStatus("error");
      }
    );

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          disposeMaterial(object.material);
        }
      });
      renderer.domElement.remove();
    };
  }, [artifact]);

  return (
    <div className="relative h-[32rem] min-h-96 overflow-hidden rounded-md bg-muted">
      <div ref={containerRef} className="h-full w-full" />
      {status === "loading" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background/55 text-sm text-muted-foreground">
          Loading model...
        </div>
      ) : null}
      {status === "error" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 p-4 text-center text-sm text-muted-foreground">
          3D model preview unavailable.
        </div>
      ) : null}
    </div>
  );
}

async function loadObjArtifact(artifact: ArtifactRecord): Promise<THREE.Group> {
  const metadata = getModelArtifactMetadata(artifact.metadata);
  const objUrl = metadata.objFileName ? await artifactAssetUrl(artifact.id, metadata.objFileName) : await artifactUrl(artifact.id);
  const objLoader = new OBJLoader();

  if (metadata.mtlFileName) {
    const mtlUrl = await artifactAssetUrl(artifact.id, metadata.mtlFileName);
    const materials = await new Promise<MaterialCreator>((resolve, reject) => {
      new MTLLoader().load(mtlUrl, resolve, undefined, reject);
    });
    materials.preload();
    objLoader.setMaterials(materials);
  }

  return new Promise((resolve, reject) => {
    objLoader.load(objUrl, resolve, undefined, reject);
  });
}

function getModelArtifactMetadata(metadata: unknown): { objFileName?: string; mtlFileName?: string } {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const record = metadata as Record<string, unknown>;
  return {
    ...(typeof record.objFileName === "string" ? { objFileName: record.objFileName } : {}),
    ...(typeof record.mtlFileName === "string" ? { mtlFileName: record.mtlFileName } : {})
  };
}

function normalizeObject(object: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  object.position.sub(center);
  const maxDimension = Math.max(size.x, size.y, size.z);
  if (maxDimension > 0) {
    object.scale.setScalar(2.2 / maxDimension);
  }
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  const materials = Array.isArray(material) ? material : [material];
  for (const item of materials) {
    for (const value of Object.values(item as Record<string, unknown>)) {
      if (value instanceof THREE.Texture) value.dispose();
    }
    item.dispose();
  }
}
