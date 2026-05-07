import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { MTLLoader, type MaterialCreator } from "three/addons/loaders/MTLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { artifactAssetUrl, artifactUrl, type ArtifactRecord } from "@/lib/api";
import {
  addPreviewLighting,
  disposeMaterial,
  ensurePreviewGeometryNormals,
  getModelArtifactMetadata,
  normalizePreviewObject,
  preparePreviewMaterials,
  waitForPreviewAssets,
  waitForPreviewTextures
} from "@/lib/modelPreview";

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

    addPreviewLighting(scene, camera);

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
        ensurePreviewGeometryNormals(object);
        normalizePreviewObject(object);
        preparePreviewMaterials(object);
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
  const mtlUrl = metadata.mtlFileName ? await artifactAssetUrl(artifact.id, metadata.mtlFileName) : null;
  const manager = new THREE.LoadingManager();
  const objLoader = new OBJLoader(manager);
  let assetsLoaded = waitForPreviewAssets(manager);

  if (mtlUrl) {
    const materials = await new Promise<MaterialCreator>((resolve, reject) => {
      new MTLLoader(manager).load(mtlUrl, resolve, undefined, reject);
    });
    assetsLoaded = waitForPreviewAssets(manager);
    materials.preload();
    objLoader.setMaterials(materials);
  }

  const object = await new Promise<THREE.Group>((resolve, reject) => {
    objLoader.load(objUrl, resolve, undefined, reject);
  });
  await assetsLoaded;
  await waitForPreviewTextures(object);
  return object;
}
