import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "@fontsource/jetbrains-mono/latin-600.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "./styles.css";

const motionToggle = document.querySelector(".motion-toggle");
const motionLabel = document.querySelector("[data-motion-label]");
const motionPreferenceKey = "navoke-motion";
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

function storedMotionPreference() {
  try {
    return window.localStorage.getItem(motionPreferenceKey);
  } catch {
    return null;
  }
}

function motionIsEnabled() {
  const stored = storedMotionPreference();
  if (stored === "on") return true;
  if (stored === "off") return false;
  return !reducedMotionQuery.matches;
}

function applyMotionPreference(enabled) {
  document.documentElement.dataset.motion = enabled ? "on" : "off";
  motionToggle?.setAttribute("aria-pressed", String(enabled));
  motionToggle?.setAttribute("aria-label", enabled ? "Pause motion" : "Resume motion");
  if (motionLabel) motionLabel.textContent = enabled ? "Motion on" : "Motion off";
  window.dispatchEvent(new CustomEvent("navoke:motionchange", { detail: { enabled } }));
}

applyMotionPreference(motionIsEnabled());

motionToggle?.addEventListener("click", () => {
  const enabled = document.documentElement.dataset.motion !== "on";
  try {
    window.localStorage.setItem(motionPreferenceKey, enabled ? "on" : "off");
  } catch {
    // The visual preference still applies for this page view.
  }
  applyMotionPreference(enabled);
});

reducedMotionQuery.addEventListener("change", () => {
  if (storedMotionPreference() === null) applyMotionPreference(!reducedMotionQuery.matches);
});

const revealItems = [...document.querySelectorAll(".reveal")];

if ("IntersectionObserver" in window && motionIsEnabled()) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8%", threshold: 0.08 }
  );

  revealItems.forEach((item) => revealObserver.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}

const gateway = document.querySelector("[data-gateway]");

if (gateway) {
  const canvas = gateway.querySelector("[data-gateway-canvas]");
  const connectionLayer = gateway.querySelector("[data-gateway-connections]");
  const hub = gateway.querySelector("[data-gateway-hub]");
  const routes = [...gateway.querySelectorAll("[data-gateway-route]")];
  const cards = [...gateway.querySelectorAll("[data-gateway-card]")];
  const agentCards = [...gateway.querySelectorAll("[data-gateway-agent]")];
  const siteCards = [...gateway.querySelectorAll("[data-gateway-site]")];
  const outputs = [...gateway.querySelectorAll("[data-gateway-output]")];
  const compactGatewayQuery = window.matchMedia("(max-width: 640px)");
  const phases = ["agent-request", "site-request", "site-result", "agent-result", "complete"];
  const phaseDurations = [820, 820, 900, 900, 880];
  let activeFlow = 0;
  let sequenceTimer = null;
  let pointerSelection = null;
  let focusSelection = null;
  let gatewayIsVisible = true;
  let layoutFrame = null;

  function requestedSelection() {
    return focusSelection ?? pointerSelection;
  }

  function stopGatewaySequence() {
    if (sequenceTimer !== null) {
      window.clearTimeout(sequenceTimer);
      sequenceTimer = null;
    }
  }

  function setGatewayRoute(flowIndex, phase) {
    activeFlow = flowIndex;
    gateway.dataset.activeFlow = String(flowIndex);
    gateway.dataset.flowPhase = phase;
    delete gateway.dataset.interaction;

    routes.forEach((route, index) => {
      const isActive = index === flowIndex;
      route.classList.toggle("is-active", isActive);
      route.dataset.phase = isActive ? phase : "idle";
    });

    cards.forEach((card) => {
      card.classList.toggle("is-active", Number(card.dataset.flowIndex) === flowIndex);
    });

    const resultIsVisible = phase === "site-result" || phase === "agent-result" || phase === "complete";
    outputs.forEach((output) => {
      output.classList.toggle("is-active", resultIsVisible && Number(output.dataset.flowIndex) === flowIndex);
    });

    hub?.classList.toggle("is-active", phase !== "complete");
  }

  function setGatewayCapability(selection, phase = "complete") {
    activeFlow = selection.index;
    gateway.dataset.activeFlow = String(selection.index);
    gateway.dataset.flowPhase = phase;
    gateway.dataset.interaction = selection.kind;

    routes.forEach((route) => {
      route.classList.add("is-active");
      route.dataset.phase = phase;
    });

    agentCards.forEach((card, index) => {
      card.classList.toggle("is-active", selection.kind === "agent" ? index === selection.index : true);
    });
    siteCards.forEach((card, index) => {
      card.classList.toggle("is-active", selection.kind === "site" ? index === selection.index : true);
    });

    const resultIsVisible = phase === "site-result" || phase === "agent-result" || phase === "complete";
    outputs.forEach((output, index) => {
      output.classList.toggle("is-active", resultIsVisible && (selection.kind === "agent" || index === selection.index));
    });

    hub?.classList.add("is-active");
  }

  function showStaticGateway() {
    stopGatewaySequence();
    gateway.dataset.flowPhase = "static";
    delete gateway.dataset.interaction;
    routes.forEach((route) => {
      route.classList.remove("is-active");
      route.dataset.phase = "static";
    });
    cards.forEach((card) => card.classList.remove("is-active"));
    outputs.forEach((output) => output.classList.remove("is-active"));
    hub?.classList.remove("is-active");
  }

  function gatewayCanAutoPlay() {
    return document.documentElement.dataset.motion === "on"
      && !document.hidden
      && gatewayIsVisible
      && requestedSelection() === null;
  }

  function playGatewayFlow(flowIndex, advanceWhenComplete = true) {
    stopGatewaySequence();
    let phaseIndex = 0;

    function runPhase() {
      const phase = phases[phaseIndex];
      setGatewayRoute(flowIndex, phase);

      sequenceTimer = window.setTimeout(() => {
        if (phaseIndex < phases.length - 1) {
          phaseIndex += 1;
          runPhase();
          return;
        }

        sequenceTimer = null;
        if (advanceWhenComplete && gatewayCanAutoPlay()) {
          playGatewayFlow((flowIndex + 1) % routes.length, true);
          return;
        }

        const interaction = requestedSelection();
        if (interaction !== null) {
          setGatewayCapability(interaction);
          scheduleGatewayLayout();
        } else if (gatewayCanAutoPlay()) {
          playGatewayFlow((flowIndex + 1) % routes.length, true);
        }
      }, phaseDurations[phaseIndex]);
    }

    runPhase();
  }

  function playGatewayCapability(selection) {
    stopGatewaySequence();
    let phaseIndex = 0;

    function runPhase() {
      const phase = phases[phaseIndex];
      setGatewayCapability(selection, phase);
      scheduleGatewayLayout();

      sequenceTimer = window.setTimeout(() => {
        if (phaseIndex < phases.length - 1) {
          phaseIndex += 1;
          runPhase();
          return;
        }

        sequenceTimer = null;
        const interaction = requestedSelection();
        if (interaction !== null) {
          setGatewayCapability(interaction);
          scheduleGatewayLayout();
        } else if (gatewayCanAutoPlay()) {
          playGatewayFlow(activeFlow, true);
        }
      }, phaseDurations[phaseIndex]);
    }

    runPhase();
  }

  function refreshGatewayMotion() {
    stopGatewaySequence();
    if (document.documentElement.dataset.motion !== "on") {
      showStaticGateway();
      return;
    }

    const interaction = requestedSelection();
    if (interaction !== null) {
      setGatewayCapability(interaction);
    } else if (gatewayCanAutoPlay()) {
      playGatewayFlow(activeFlow, true);
    } else {
      setGatewayRoute(activeFlow, "complete");
    }
    scheduleGatewayLayout();
  }

  function pointFor(element, horizontalSide, verticalSide, laneOffset = 0) {
    const canvasBounds = canvas.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    const x = horizontalSide === "left"
      ? bounds.left - canvasBounds.left
      : horizontalSide === "right"
        ? bounds.right - canvasBounds.left
        : bounds.left - canvasBounds.left + bounds.width / 2 + laneOffset;
    const y = verticalSide === "top"
      ? bounds.top - canvasBounds.top
      : verticalSide === "bottom"
        ? bounds.bottom - canvasBounds.top
        : bounds.top - canvasBounds.top + bounds.height / 2 + laneOffset;
    return { x, y };
  }

  function horizontalCurve(start, end) {
    const bend = Math.max(24, Math.abs(end.x - start.x) * 0.48);
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} C ${(start.x + bend).toFixed(2)} ${start.y.toFixed(2)}, ${(end.x - bend).toFixed(2)} ${end.y.toFixed(2)}, ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  }

  function verticalCurve(start, end) {
    const bend = Math.max(24, Math.abs(end.y - start.y) * 0.46);
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} C ${start.x.toFixed(2)} ${(start.y + bend).toFixed(2)}, ${end.x.toFixed(2)} ${(end.y - bend).toFixed(2)}, ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
  }

  function setRoutePath(route, name, pathData) {
    route.querySelectorAll(`[data-gateway-path="${name}"], [data-gateway-signal="${name}"]`).forEach((path) => {
      path.setAttribute("d", pathData);
    });
  }

  function updateGatewayPaths() {
    layoutFrame = null;
    if (!canvas || !connectionLayer || !hub || routes.length === 0) return;

    const canvasBounds = canvas.getBoundingClientRect();
    if (canvasBounds.width === 0 || canvasBounds.height === 0) return;
    connectionLayer.setAttribute("viewBox", `0 0 ${canvasBounds.width} ${canvasBounds.height}`);

    const compact = compactGatewayQuery.matches;
    const hubBounds = hub.getBoundingClientRect();
    const interaction = requestedSelection();

    routes.forEach((route, index) => {
      const agentIndex = interaction?.kind === "agent" ? interaction.index : index;
      const siteIndex = interaction?.kind === "site" ? interaction.index : index;
      const agent = agentCards[agentIndex];
      const site = siteCards[siteIndex];
      const output = outputs[siteIndex];
      if (!agent || !site || !output) return;

      if (compact) {
        const hubLane = (index - 1) * hubBounds.width * 0.28;
        const requestOffset = -3;
        const resultOffset = 4;
        const agentRequestStart = pointFor(agent, "center", "bottom", requestOffset);
        const agentRequestEnd = pointFor(hub, "center", "top", hubLane + requestOffset);
        const siteRequestStart = pointFor(hub, "center", "bottom", hubLane + requestOffset);
        const siteRequestEnd = pointFor(site, "center", "top", requestOffset);
        const siteResultStart = pointFor(site, "center", "top", resultOffset);
        const siteResultEnd = pointFor(hub, "center", "bottom", hubLane + resultOffset);
        const agentResultStart = pointFor(hub, "center", "top", hubLane + resultOffset);
        const agentResultEnd = pointFor(agent, "center", "bottom", resultOffset);

        setRoutePath(route, "agent-request", verticalCurve(agentRequestStart, agentRequestEnd));
        setRoutePath(route, "site-request", verticalCurve(siteRequestStart, siteRequestEnd));
        setRoutePath(route, "site-result", verticalCurve(siteResultStart, siteResultEnd));
        setRoutePath(route, "agent-result", verticalCurve(agentResultStart, agentResultEnd));

        const labelProgress = 0.22;
        const labelX = siteResultStart.x + (siteResultEnd.x - siteResultStart.x) * labelProgress;
        const labelY = siteResultStart.y + (siteResultEnd.y - siteResultStart.y) * labelProgress;
        if (interaction?.kind !== "site" || index === interaction.index) {
          output.style.left = `${labelX}px`;
          output.style.top = `${labelY}px`;
        }
      } else {
        const hubLane = (index - 1) * hubBounds.height * 0.27;
        const requestOffset = -4;
        const resultOffset = 5;
        const agentRequestStart = pointFor(agent, "right", "center", requestOffset);
        const agentRequestEnd = pointFor(hub, "left", "center", hubLane + requestOffset);
        const siteRequestStart = pointFor(hub, "right", "center", hubLane + requestOffset);
        const siteRequestEnd = pointFor(site, "left", "center", requestOffset);
        const siteResultStart = pointFor(site, "left", "center", resultOffset);
        const siteResultEnd = pointFor(hub, "right", "center", hubLane + resultOffset);
        const agentResultStart = pointFor(hub, "left", "center", hubLane + resultOffset);
        const agentResultEnd = pointFor(agent, "right", "center", resultOffset);

        setRoutePath(route, "agent-request", horizontalCurve(agentRequestStart, agentRequestEnd));
        setRoutePath(route, "site-request", horizontalCurve(siteRequestStart, siteRequestEnd));
        setRoutePath(route, "site-result", horizontalCurve(siteResultStart, siteResultEnd));
        setRoutePath(route, "agent-result", horizontalCurve(agentResultStart, agentResultEnd));

        const labelProgress = 0.46;
        const labelX = siteResultStart.x + (siteResultEnd.x - siteResultStart.x) * labelProgress;
        const labelY = siteResultStart.y + (siteResultEnd.y - siteResultStart.y) * labelProgress - 12;
        if (interaction?.kind !== "site" || index === interaction.index) {
          output.style.left = `${labelX}px`;
          output.style.top = `${labelY}px`;
        }
      }
    });
  }

  function scheduleGatewayLayout() {
    if (layoutFrame !== null) window.cancelAnimationFrame(layoutFrame);
    layoutFrame = window.requestAnimationFrame(updateGatewayPaths);
  }

  cards.forEach((card) => {
    const selection = {
      kind: card.hasAttribute("data-gateway-agent") ? "agent" : "site",
      index: Number(card.dataset.flowIndex)
    };
    card.addEventListener("pointerenter", () => {
      pointerSelection = selection;
      refreshGatewayMotion();
    });
    card.addEventListener("pointerleave", () => {
      pointerSelection = null;
      refreshGatewayMotion();
    });
    card.addEventListener("focus", () => {
      focusSelection = selection;
      refreshGatewayMotion();
    });
    card.addEventListener("blur", () => {
      focusSelection = null;
      refreshGatewayMotion();
    });
    card.addEventListener("click", () => {
      if (document.documentElement.dataset.motion === "on") {
        playGatewayCapability(selection);
      } else {
        showStaticGateway();
      }
    });
  });

  if ("ResizeObserver" in window && canvas) {
    const gatewayResizeObserver = new ResizeObserver(scheduleGatewayLayout);
    gatewayResizeObserver.observe(canvas);
    gatewayResizeObserver.observe(hub);
    cards.forEach((card) => gatewayResizeObserver.observe(card));
  } else {
    window.addEventListener("resize", scheduleGatewayLayout);
  }

  if ("IntersectionObserver" in window) {
    const gatewayVisibilityObserver = new IntersectionObserver(
      ([entry]) => {
        gatewayIsVisible = entry.isIntersecting;
        refreshGatewayMotion();
      },
      { threshold: 0.12 }
    );
    gatewayVisibilityObserver.observe(gateway);
  }

  compactGatewayQuery.addEventListener("change", scheduleGatewayLayout);
  document.addEventListener("visibilitychange", refreshGatewayMotion);
  window.addEventListener("navoke:motionchange", refreshGatewayMotion);
  window.addEventListener("load", scheduleGatewayLayout, { once: true });
  document.fonts?.ready.then(scheduleGatewayLayout);
  scheduleGatewayLayout();
  refreshGatewayMotion();
}

const productStack = document.querySelector("[data-product-stack]");

if (productStack) {
  const slides = [...productStack.querySelectorAll("[data-stack-slide]")];
  const stackClasses = ["is-front", "is-middle", "is-back", "is-queued", "is-exiting"];
  let frontIndex = Math.max(0, slides.findIndex((slide) => slide.classList.contains("is-front")));
  let cycleTimer = null;
  let transitionTimer = null;
  let pointerPaused = false;
  let focusPaused = false;
  let isAdvancing = false;
  let tiltFrame = null;
  let targetTiltX = 0;
  let targetTiltY = 0;
  let currentTiltX = 0;
  let currentTiltY = 0;
  let stackIsVisible = !("IntersectionObserver" in window);

  function renderStackTilt() {
    const easing = 0.085;
    currentTiltX += (targetTiltX - currentTiltX) * easing;
    currentTiltY += (targetTiltY - currentTiltY) * easing;
    productStack.style.setProperty("--stack-tilt-x", `${currentTiltX.toFixed(3)}deg`);
    productStack.style.setProperty("--stack-tilt-y", `${currentTiltY.toFixed(3)}deg`);

    if (Math.abs(targetTiltX - currentTiltX) > 0.005 || Math.abs(targetTiltY - currentTiltY) > 0.005) {
      tiltFrame = window.requestAnimationFrame(renderStackTilt);
    } else {
      currentTiltX = targetTiltX;
      currentTiltY = targetTiltY;
      productStack.style.setProperty("--stack-tilt-x", `${currentTiltX}deg`);
      productStack.style.setProperty("--stack-tilt-y", `${currentTiltY}deg`);
      tiltFrame = null;
    }
  }

  function setStackTilt(x, y) {
    targetTiltX = x;
    targetTiltY = y;
    if (tiltFrame === null) tiltFrame = window.requestAnimationFrame(renderStackTilt);
  }

  function resetStackTilt() {
    setStackTilt(0, 0);
  }

  function interactionIsPaused() {
    return pointerPaused || focusPaused;
  }

  function updateStackLabel() {
    const currentTitle = slides[frontIndex]?.querySelector(".product-shot__bar span")?.textContent?.trim() ?? "Product screenshot";
    productStack.setAttribute(
      "aria-label",
      `Navoke screenshot ${frontIndex + 1} of ${slides.length}: ${currentTitle}. Activate to show the next screenshot.`
    );
  }

  function arrangeStack() {
    slides.forEach((slide, index) => {
      const distance = (index - frontIndex + slides.length) % slides.length;
      slide.classList.remove(...stackClasses);
      slide.classList.add(distance === 0 ? "is-front" : distance === 1 ? "is-middle" : distance === 2 ? "is-back" : "is-queued");
      slide.setAttribute("aria-hidden", String(distance !== 0));
    });
    updateStackLabel();
  }

  function advanceStack() {
    if (isAdvancing || slides.length < 2) return;
    isAdvancing = true;
    const outgoingSlide = slides[frontIndex];
    frontIndex = (frontIndex + 1) % slides.length;

    slides.forEach((slide, index) => {
      const distance = (index - frontIndex + slides.length) % slides.length;
      slide.classList.remove(...stackClasses);

      if (slide === outgoingSlide) {
        slide.classList.add("is-exiting");
        slide.setAttribute("aria-hidden", "true");
        return;
      }

      slide.classList.add(distance === 0 ? "is-front" : distance === 1 ? "is-middle" : distance === 2 ? "is-back" : "is-queued");
      slide.setAttribute("aria-hidden", String(distance !== 0));
    });

    updateStackLabel();

    const settleOutgoingSlide = () => {
      outgoingSlide?.classList.remove("is-exiting");
      outgoingSlide?.classList.add("is-queued");
      transitionTimer = null;
      isAdvancing = false;
    };

    if (document.documentElement.dataset.motion === "on") {
      transitionTimer = window.setTimeout(settleOutgoingSlide, 640);
    } else {
      settleOutgoingSlide();
    }
  }

  function stopCycle() {
    if (cycleTimer !== null) {
      window.clearInterval(cycleTimer);
      cycleTimer = null;
    }
    if (transitionTimer !== null) {
      window.clearTimeout(transitionTimer);
      transitionTimer = null;
      isAdvancing = false;
      arrangeStack();
    }
  }

  function startCycle() {
    stopCycle();
    if (document.documentElement.dataset.motion !== "on" || document.hidden || !stackIsVisible || interactionIsPaused() || slides.length < 2) return;
    cycleTimer = window.setInterval(advanceStack, 4000);
  }

  productStack.addEventListener("pointerenter", () => {
    pointerPaused = true;
    stopCycle();
  });

  productStack.addEventListener("pointermove", (event) => {
    if (document.documentElement.dataset.motion !== "on" || (event.pointerType !== "mouse" && event.pointerType !== "pen")) return;
    const bounds = productStack.getBoundingClientRect();
    const pointerX = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width - 0.5) * 2));
    const pointerY = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height - 0.5) * 2));
    setStackTilt(pointerY * -1.55, pointerX * 2.35);
  });

  productStack.addEventListener("pointerleave", () => {
    pointerPaused = false;
    resetStackTilt();
    startCycle();
  });

  productStack.addEventListener("focus", () => {
    focusPaused = true;
    stopCycle();
  });

  productStack.addEventListener("blur", () => {
    focusPaused = false;
    startCycle();
  });

  productStack.addEventListener("click", advanceStack);
  productStack.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    advanceStack();
  });

  document.addEventListener("visibilitychange", startCycle);
  window.addEventListener("navoke:motionchange", (event) => {
    if (!event.detail?.enabled) resetStackTilt();
    startCycle();
  });

  if ("IntersectionObserver" in window) {
    const productStackObserver = new IntersectionObserver(
      ([entry]) => {
        stackIsVisible = entry.isIntersecting;
        startCycle();
      },
      { threshold: 0.18 }
    );
    productStackObserver.observe(productStack);
  }

  arrangeStack();
  const imageDecodeTasks = slides
    .map((slide) => slide.querySelector("img"))
    .filter(Boolean)
    .map((image) => image.decode?.() ?? Promise.resolve());

  Promise.allSettled(imageDecodeTasks).then(startCycle);
}

const swordPreview = document.querySelector("[data-sword-preview]");

async function mountSwordPreview(preview) {
  const canvas = preview.querySelector("canvas");
  if (!canvas) return;

  try {
    const [THREE, { OBJLoader }] = await Promise.all([
      import("three"),
      import("three/examples/jsm/loaders/OBJLoader.js")
    ]);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "low-power"
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    camera.position.set(0, 4.6, 0.15);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.HemisphereLight(0xd9e5ff, 0x24152f, 1.8));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(-2.5, 4, 4);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0xb568c2, 1.8);
    rimLight.position.set(3, 2.5, -3);
    scene.add(rimLight);

    const assetUrl = (fileName) => new URL(`./models/longsword/${fileName}`, document.baseURI).href;
    const textureLoader = new THREE.TextureLoader();
    const objLoader = new OBJLoader();
    const [albedo, normal, metallic, roughness, sword] = await Promise.all([
      textureLoader.loadAsync(assetUrl("albedo.jpg")),
      textureLoader.loadAsync(assetUrl("normal.jpg")),
      textureLoader.loadAsync(assetUrl("metallic.jpg")),
      textureLoader.loadAsync(assetUrl("roughness.jpg")),
      objLoader.loadAsync(assetUrl("longsword.obj"))
    ]);

    albedo.colorSpace = THREE.SRGBColorSpace;
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    [albedo, normal, metallic, roughness].forEach((texture) => {
      texture.anisotropy = Math.min(maxAnisotropy, 8);
    });

    const swordMaterial = new THREE.MeshStandardMaterial({
      map: albedo,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.7, 0.7),
      metalnessMap: metallic,
      roughnessMap: roughness,
      metalness: 0.9,
      roughness: 0.82,
      side: THREE.DoubleSide
    });

    sword.traverse((child) => {
      if (!child.isMesh) return;
      child.material = swordMaterial;
      if (!child.geometry.attributes.normal) child.geometry.computeVertexNormals();
    });

    const bounds = new THREE.Box3().setFromObject(sword);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    sword.position.copy(center).multiplyScalar(-1);
    sword.scale.setScalar(3.4 / Math.max(size.x, size.y, size.z));

    const swordSpin = new THREE.Group();
    swordSpin.add(sword);

    const swordPivot = new THREE.Group();
    swordPivot.rotation.set(0.26, -0.74, 0);
    swordPivot.add(swordSpin);
    scene.add(swordPivot);

    let previewVisible = true;
    let animationFrame = null;
    let motionEnabled = document.documentElement.dataset.motion === "on";
    const pointerTarget = new THREE.Vector2();
    const pointerCurrent = new THREE.Vector2();
    const pointerSurface = preview.closest(".process-node") ?? preview;

    pointerSurface.addEventListener("pointermove", (event) => {
      if (!motionEnabled || (event.pointerType !== "mouse" && event.pointerType !== "pen")) return;
      const rect = pointerSurface.getBoundingClientRect();
      pointerTarget.set(
        THREE.MathUtils.clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1),
        THREE.MathUtils.clamp(((event.clientY - rect.top) / rect.height) * 2 - 1, -1, 1)
      );
    });

    pointerSurface.addEventListener("pointerleave", () => pointerTarget.set(0, 0));

    function renderFrame(time = performance.now()) {
      animationFrame = null;
      if (!previewVisible || document.hidden) return;

      if (motionEnabled) {
        pointerCurrent.lerp(pointerTarget, 0.055);
        swordPivot.rotation.x = 0.26 - pointerCurrent.y * 0.12;
        swordPivot.rotation.y = -0.74 + pointerCurrent.x * 0.08;
        swordSpin.rotation.x = time * 0.00016;
      }

      renderer.render(scene, camera);
      if (motionEnabled) animationFrame = window.requestAnimationFrame(renderFrame);
    }

    function scheduleRender() {
      if (animationFrame === null) animationFrame = window.requestAnimationFrame(renderFrame);
    }

    function resizePreview() {
      const width = Math.max(1, preview.clientWidth);
      const height = Math.max(1, preview.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      scheduleRender();
    }

    const resizeObserver = new ResizeObserver(resizePreview);
    resizeObserver.observe(preview);

    if ("IntersectionObserver" in window) {
      const visibilityObserver = new IntersectionObserver((entries) => {
        previewVisible = entries.some((entry) => entry.isIntersecting);
        if (previewVisible) scheduleRender();
        else if (animationFrame !== null) {
          window.cancelAnimationFrame(animationFrame);
          animationFrame = null;
        }
      });
      visibilityObserver.observe(preview);
    }

    window.addEventListener("navoke:motionchange", (event) => {
      motionEnabled = Boolean(event.detail?.enabled);
      if (!motionEnabled) pointerTarget.set(0, 0);
      scheduleRender();
    });
    document.addEventListener("visibilitychange", scheduleRender);

    resizePreview();
    renderer.render(scene, camera);
    preview.classList.add("is-ready");
  } catch (error) {
    console.warn("The longsword preview could not be initialized.", error);
  }
}

if (swordPreview) {
  if ("IntersectionObserver" in window) {
    const swordLoadObserver = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        swordLoadObserver.disconnect();
        mountSwordPreview(swordPreview);
      },
      { rootMargin: "180px" }
    );
    swordLoadObserver.observe(swordPreview);
  } else {
    mountSwordPreview(swordPreview);
  }
}

const finalCta = document.querySelector("[data-final-tilt]");

if (finalCta) {
  let tiltFrame = null;
  let targetTiltX = 0;
  let targetTiltY = 0;
  let currentTiltX = 0;
  let currentTiltY = 0;

  function renderFinalCtaTilt() {
    const easing = 0.085;
    currentTiltX += (targetTiltX - currentTiltX) * easing;
    currentTiltY += (targetTiltY - currentTiltY) * easing;
    finalCta.style.setProperty("--final-tilt-x", `${currentTiltX.toFixed(3)}deg`);
    finalCta.style.setProperty("--final-tilt-y", `${currentTiltY.toFixed(3)}deg`);

    if (Math.abs(targetTiltX - currentTiltX) > 0.005 || Math.abs(targetTiltY - currentTiltY) > 0.005) {
      tiltFrame = window.requestAnimationFrame(renderFinalCtaTilt);
    } else {
      currentTiltX = targetTiltX;
      currentTiltY = targetTiltY;
      finalCta.style.setProperty("--final-tilt-x", `${currentTiltX}deg`);
      finalCta.style.setProperty("--final-tilt-y", `${currentTiltY}deg`);
      tiltFrame = null;
    }
  }

  function setFinalCtaTilt(x, y) {
    targetTiltX = x;
    targetTiltY = y;
    if (tiltFrame === null) tiltFrame = window.requestAnimationFrame(renderFinalCtaTilt);
  }

  finalCta.addEventListener("pointermove", (event) => {
    if (document.documentElement.dataset.motion !== "on" || (event.pointerType !== "mouse" && event.pointerType !== "pen")) return;
    const bounds = finalCta.getBoundingClientRect();
    const pointerX = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width - 0.5) * 2));
    const pointerY = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height - 0.5) * 2));
    setFinalCtaTilt(pointerY * -1.15, pointerX * 1.65);
  });

  finalCta.addEventListener("pointerleave", () => setFinalCtaTilt(0, 0));
  window.addEventListener("navoke:motionchange", (event) => {
    if (!event.detail?.enabled) setFinalCtaTilt(0, 0);
  });
}

const sectionNavigator = document.querySelector("[data-section-navigator]");

if (sectionNavigator) {
  const pageSections = [
    { id: "top", label: "Overview" },
    { id: "product", label: "Inside Navoke" },
    { id: "real-project", label: "Real project" },
    { id: "how-it-works", label: "How it works" },
    { id: "why-navoke", label: "Agent workflows" },
    { id: "workflows", label: "Marketplace" },
    { id: "authors", label: "For plugin authors" },
    { id: "local-first", label: "Local by design" },
    { id: "download", label: "Get Navoke" }
  ]
    .map((section) => ({ ...section, element: document.getElementById(section.id) }))
    .filter((section) => section.element);

  const previousButton = sectionNavigator.querySelector("[data-section-previous]");
  const nextButton = sectionNavigator.querySelector("[data-section-next]");
  const countLabel = sectionNavigator.querySelector("[data-section-count]");
  const statusLabel = sectionNavigator.querySelector("[data-section-status]");
  let activeSectionIndex = 0;
  let updateFrame = null;

  function sectionActionLabel(direction, index) {
    const section = pageSections[index];
    return section ? `${direction} section: ${section.label}` : `No ${direction.toLowerCase()} section`;
  }

  function renderSectionNavigator() {
    const previousIndex = activeSectionIndex - 1;
    const nextIndex = activeSectionIndex + 1;
    const currentSection = pageSections[activeSectionIndex];
    const previousLabel = sectionActionLabel("Previous", previousIndex);
    const nextLabel = sectionActionLabel("Next", nextIndex);

    if (countLabel) {
      countLabel.textContent = `${String(activeSectionIndex + 1).padStart(2, "0")} / ${String(pageSections.length).padStart(2, "0")}`;
    }
    if (statusLabel) statusLabel.textContent = currentSection?.label ?? "";
    if (previousButton) {
      previousButton.disabled = previousIndex < 0;
      previousButton.setAttribute("aria-label", previousLabel);
      previousButton.title = previousIndex < 0 ? "No previous section" : `Previous: ${pageSections[previousIndex].label}`;
    }
    if (nextButton) {
      nextButton.disabled = nextIndex >= pageSections.length;
      nextButton.setAttribute("aria-label", nextLabel);
      nextButton.title = nextIndex >= pageSections.length ? "No next section" : `Next: ${pageSections[nextIndex].label}`;
    }
  }

  function resolveActiveSection() {
    const marker = window.scrollY + Math.min(window.innerHeight * 0.45, 360);
    let nextActiveIndex = 0;

    pageSections.forEach((section, index) => {
      if (section.element.offsetTop <= marker) nextActiveIndex = index;
    });

    if (nextActiveIndex !== activeSectionIndex) {
      activeSectionIndex = nextActiveIndex;
      renderSectionNavigator();
    }
  }

  function scheduleSectionUpdate() {
    if (updateFrame !== null) return;
    updateFrame = window.requestAnimationFrame(() => {
      updateFrame = null;
      resolveActiveSection();
    });
  }

  function goToSection(index) {
    const section = pageSections[index];
    if (!section) return;
    activeSectionIndex = index;
    renderSectionNavigator();
    section.element.scrollIntoView({
      behavior: document.documentElement.dataset.motion === "on" ? "smooth" : "auto",
      block: "start"
    });
  }

  previousButton?.addEventListener("click", () => goToSection(activeSectionIndex - 1));
  nextButton?.addEventListener("click", () => goToSection(activeSectionIndex + 1));
  window.addEventListener("scroll", scheduleSectionUpdate, { passive: true });
  window.addEventListener("resize", scheduleSectionUpdate);
  window.addEventListener("hashchange", scheduleSectionUpdate);

  resolveActiveSection();
  renderSectionNavigator();
}
