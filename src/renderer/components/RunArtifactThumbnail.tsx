import { useEffect, useRef, useState } from "react";
import { Box, ImageIcon } from "lucide-react";
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { MTLLoader, type MaterialCreator } from "three/addons/loaders/MTLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { artifactAssetUrl, artifactUrl, type RunArtifactPreview } from "@/lib/api";
import {
  addPreviewLighting,
  applyPreviewDiffuseTextureFallback,
  disposeMaterial,
  ensurePreviewGeometryNormals,
  getModelArtifactMetadata,
  isPreviewableModelArtifact,
  modelArtifactFormat,
  normalizePreviewObject,
  preparePreviewMaterials,
  selectDiffuseTextureFileName,
  waitForPreviewAssets,
  waitForPreviewTextures
} from "@/lib/modelPreview";
import { cn } from "@/lib/utils";

export function RunArtifactThumbnail({ artifact, className }: { artifact: RunArtifactPreview; className?: string }): JSX.Element {
  if (artifact.kind === "model" && isPreviewableModelArtifact(artifact)) return <StaticModelThumbnail artifact={artifact} className={className} />;
  if (artifact.kind === "model") return <ModelArtifactThumbnail artifact={artifact} className={className} />;
  return <ImageArtifactThumbnail artifact={artifact} className={className} />;
}

function ModelArtifactThumbnail({ artifact, className }: { artifact: RunArtifactPreview; className?: string }): JSX.Element {
  return (
    <div className={cn("relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border bg-muted", className)} title={artifact.name}>
      <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
        <Box className="h-4 w-4" />
      </div>
    </div>
  );
}

function ImageArtifactThumbnail({ artifact, className }: { artifact: RunArtifactPreview; className?: string }): JSX.Element {
  const [fileUrl, setFileUrl] = useState("");

  useEffect(() => {
    let active = true;
    void artifactUrl(artifact.id).then((url) => {
      if (active) setFileUrl(url);
    });
    return () => {
      active = false;
    };
  }, [artifact.id]);

  return (
    <div className={cn("relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border bg-muted", className)} title={artifact.name}>
      {fileUrl ? <img src={fileUrl} alt={artifact.name} className="h-full w-full object-cover" loading="lazy" /> : null}
      {!fileUrl ? (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <ImageIcon className="h-4 w-4" />
        </div>
      ) : null}
    </div>
  );
}

function StaticModelThumbnail({ artifact, className }: { artifact: RunArtifactPreview; className?: string }): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const metadataKey = JSON.stringify(artifact.metadata ?? null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px" }
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!visible || !container) return;

    let disposed = false;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
    camera.position.set(0, 1.1, 3.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const { width, height } = container.getBoundingClientRect();
    const nextWidth = Math.max(48, Math.floor(width));
    const nextHeight = Math.max(48, Math.floor(height));
    renderer.setSize(nextWidth, nextHeight, false);
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();

    addPreviewLighting(scene, camera);

    setStatus("loading");
    void loadModelArtifact(artifact).then(
      (object) => {
        if (disposed) return;
        ensurePreviewGeometryNormals(object);
        normalizePreviewObject(object, 2);
        preparePreviewMaterials(object);
        scene.add(object);
        renderer.render(scene, camera);
        setStatus("ready");
      },
      () => {
        if (!disposed) setStatus("error");
      }
    );

    return () => {
      disposed = true;
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          disposeMaterial(object.material);
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [artifact.id, metadataKey, visible]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border bg-muted",
        status === "ready" && "bg-background",
        className
      )}
      title={artifact.name}
    >
      {status !== "ready" ? (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <Box className="h-4 w-4" />
        </div>
      ) : null}
    </div>
  );
}

async function loadModelArtifact(artifact: RunArtifactPreview): Promise<THREE.Group> {
  const format = modelArtifactFormat(artifact);
  if (format === "obj") return loadObjArtifact(artifact);
  if (format === "fbx") return loadFbxArtifact(artifact);
  throw new Error(`Unsupported model artifact: ${artifact.name}`);
}

async function loadObjArtifact(artifact: RunArtifactPreview): Promise<THREE.Group> {
  const metadata = getModelArtifactMetadata(artifact.metadata);
  const objUrl = metadata.objFileName ? await artifactAssetUrl(artifact.id, metadata.objFileName) : await artifactUrl(artifact.id);
  const mtlUrl = metadata.mtlFileName ? await artifactAssetUrl(artifact.id, metadata.mtlFileName) : null;
  const fallbackTextureFileName = selectDiffuseTextureFileName(metadata.textureFileNames);
  const fallbackTextureUrl = fallbackTextureFileName ? await artifactAssetUrl(artifact.id, fallbackTextureFileName) : null;
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
  await applyPreviewDiffuseTextureFallback(object, fallbackTextureUrl, manager);
  await assetsLoaded;
  await waitForPreviewTextures(object);
  return object;
}

async function loadFbxArtifact(artifact: RunArtifactPreview): Promise<THREE.Group> {
  const fbxUrl = await artifactUrl(artifact.id);
  const manager = new THREE.LoadingManager();
  const assetsLoaded = waitForPreviewAssets(manager);
  const object = await new Promise<THREE.Group>((resolve, reject) => {
    new FBXLoader(manager).load(fbxUrl, resolve, undefined, reject);
  });
  await assetsLoaded;
  await waitForPreviewTextures(object);
  return object;
}
