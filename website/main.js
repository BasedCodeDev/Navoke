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
    if (document.documentElement.dataset.motion !== "on" || document.hidden || interactionIsPaused() || slides.length < 2) return;
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
    { id: "how-it-works", label: "How it works" },
    { id: "real-project", label: "Real project" },
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
