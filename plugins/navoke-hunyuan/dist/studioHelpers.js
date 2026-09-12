"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.acquireExport = exports.isModelRunning = exports.currentModelText = void 0;
exports.modelFailure = modelFailure;
exports.isModelReady = isModelReady;
exports.manualActionReason = manualActionReason;
exports.abortableDelay = abortableDelay;
exports.createExportGate = createExportGate;
exports.projectApiBase = projectApiBase;
exports.referenceUrls = referenceUrls;
exports.verifyRetainedReferences = verifyRetainedReferences;
exports.inspectGlb = inspectGlb;
exports.modelMetadata = modelMetadata;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const currentModelText = (body) => body.split(/\bAssets\s+Layer\s+Property\b/)[0];
exports.currentModelText = currentModelText;
const isModelRunning = (body) => /Generating|Queuing|\d+%/.test((0, exports.currentModelText)(body));
exports.isModelRunning = isModelRunning;
function modelFailure(body) {
    const current = (0, exports.currentModelText)(body);
    return /failed|exhausted|insufficient|server is overloaded/i.test(current) ? current : null;
}
function isModelReady(body) {
    const current = (0, exports.currentModelText)(body);
    return !/Generating|Queuing|Loading|\d+%/.test(current) && /Vertex Count\s*\d+/.test(current);
}
function manualActionReason(body) {
    const current = (0, exports.currentModelText)(body);
    if (/captcha|verify (?:that )?you(?:'re| are) human|human verification|security verification|complete.*verification/i.test(current)) {
        return "Complete the Hunyuan verification in the run-owned Chrome window, then resume.";
    }
    if (/sign in to|log in to|login required|session expired|sign in with|log in with|enter (?:your )?(?:email|verification code)/i.test(current)) {
        return "Sign in to Hunyuan in the run-owned Chrome window, then resume.";
    }
    return null;
}
function abortableDelay(ms, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const stop = () => { clearTimeout(timer); reject(signal.reason ?? new Error("Cancelled")); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, ms);
        signal.addEventListener("abort", stop, { once: true });
    });
}
/** FIFO export gate. Cancelling a waiter releases its position without blocking later runs. */
function createExportGate() {
    let tail = Promise.resolve();
    return async (signal) => {
        signal.throwIfAborted();
        const previous = tail;
        let release;
        const slot = new Promise((resolve) => { release = resolve; });
        tail = previous.then(() => slot);
        let stop;
        const cancelled = new Promise((_resolve, reject) => {
            stop = () => { release(); reject(signal.reason ?? new Error("Cancelled")); };
            signal.addEventListener("abort", stop, { once: true });
        });
        try {
            await Promise.race([previous, cancelled]);
            signal.throwIfAborted();
            return release;
        }
        catch (error) {
            release();
            throw error;
        }
        finally {
            signal.removeEventListener("abort", stop);
        }
    };
}
exports.acquireExport = createExportGate();
function projectApiBase(projectDir) {
    const runtime = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(projectDir, ".navoke", "runtime.json"), "utf8"));
    if (typeof runtime.apiBaseUrl !== "string" || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(runtime.apiBaseUrl)) {
        throw new Error("Workflow Lab requires the project-local Navoke runtime.");
    }
    if (typeof runtime.projectDir !== "string" || node_path_1.default.resolve(runtime.projectDir) !== node_path_1.default.resolve(projectDir)) {
        throw new Error("Navoke runtime file belongs to a different project.");
    }
    return runtime.apiBaseUrl;
}
function referenceUrls(images) {
    return [...new Set(images.map((image) => image.src).filter((src) => /_[a-f0-9]{32}\.png(?:[?#]|$)/i.test(src)))];
}
function verifyRetainedReferences(original, retained) {
    if (original.length !== 2 || !original.every((url) => retained.some((image) => image.src === url))) {
        throw new Error("Original geometry did not retain both verified reference images.");
    }
}
/** Inspect actual exported geometry; requested face count is not an output measurement. */
function inspectGlb(data) {
    const invalid = () => new Error("Invalid GLB download.");
    if (data.length < 28 || data.toString("ascii", 0, 4) !== "glTF" || data.readUInt32LE(4) !== 2 || data.readUInt32LE(8) !== data.length)
        throw invalid();
    let offset = 12;
    let gltf;
    let binBytes = 0;
    while (offset < data.length) {
        if (offset + 8 > data.length)
            throw invalid();
        const length = data.readUInt32LE(offset);
        const type = data.readUInt32LE(offset + 4);
        if (length % 4 !== 0 || offset + 8 + length > data.length)
            throw invalid();
        if (offset === 12) {
            if (type !== 0x4e4f534a)
                throw invalid();
            try {
                gltf = JSON.parse(data.subarray(offset + 8, offset + 8 + length).toString("utf8"));
            }
            catch {
                throw invalid();
            }
        }
        else if (type === 0x004e4942) {
            if (binBytes)
                throw invalid();
            binBytes = length;
        }
        offset += 8 + length;
    }
    if (!gltf || !gltf.meshes?.length || !gltf.images?.length || !gltf.materials?.length || !gltf.textures?.length || !binBytes) {
        throw new Error("GLB lacks embedded mesh textures.");
    }
    for (const image of gltf.images) {
        const view = image.bufferView === undefined ? undefined : gltf.bufferViews?.[image.bufferView];
        if (image.uri || !view || view.buffer !== 0 || !Number.isInteger(view.byteLength) || view.byteLength <= 0 || (view.byteOffset ?? 0) < 0 || (view.byteOffset ?? 0) + view.byteLength > binBytes || gltf.buffers?.[0]?.uri) {
            throw new Error("GLB lacks valid embedded image data.");
        }
    }
    let vertexCount = 0;
    let triangleCount = 0;
    const positions = new Set();
    const count = (index) => {
        const value = index === undefined ? undefined : gltf.accessors?.[index]?.count;
        if (!Number.isSafeInteger(value) || value <= 0)
            throw new Error("GLB has invalid geometry accessors.");
        return value;
    };
    for (const mesh of gltf.meshes) {
        if (!mesh.primitives?.length)
            throw new Error("GLB has no mesh primitives.");
        for (const primitive of mesh.primitives) {
            const position = primitive.attributes?.POSITION;
            const vertices = count(position);
            if (!positions.has(position)) {
                positions.add(position);
                vertexCount += vertices;
            }
            const elements = primitive.indices === undefined ? vertices : count(primitive.indices);
            const mode = primitive.mode ?? 4;
            if (mode === 4 && elements % 3 === 0)
                triangleCount += elements / 3;
            else if ((mode === 5 || mode === 6) && elements >= 3)
                triangleCount += elements - 2;
            else
                throw new Error("GLB has unsupported or invalid triangle geometry.");
        }
    }
    return { meshes: gltf.meshes.length, materials: gltf.materials.length, embeddedImages: gltf.images.length, vertexCount, triangleCount, bytes: data.length };
}
function modelMetadata(input, data) {
    return {
        source: "hunyuan-global-studio", frontImage: input.frontImage, backImage: input.backImage,
        requestedGeometryFaces: 50000, topology: input.topology,
        retopology: input.topology === "Original" ? null : { type: input.topology, density: "Medium" },
        format: "glb", ...inspectGlb(data)
    };
}
