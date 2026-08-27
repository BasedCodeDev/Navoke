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
  let interactionPaused = false;
  let isAdvancing = false;

  function arrangeStack() {
    slides.forEach((slide, index) => {
      const distance = (index - frontIndex + slides.length) % slides.length;
      slide.classList.remove(...stackClasses);
      slide.classList.add(distance === 0 ? "is-front" : distance === 1 ? "is-middle" : distance === 2 ? "is-back" : "is-queued");
      slide.setAttribute("aria-hidden", String(distance !== 0));
    });
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

    transitionTimer = window.setTimeout(() => {
      outgoingSlide?.classList.remove("is-exiting");
      outgoingSlide?.classList.add("is-queued");
      transitionTimer = null;
      isAdvancing = false;
    }, 640);
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
    if (document.documentElement.dataset.motion !== "on" || document.hidden || interactionPaused || slides.length < 2) return;
    cycleTimer = window.setInterval(advanceStack, 4000);
  }

  productStack.addEventListener("pointerenter", () => {
    interactionPaused = true;
    stopCycle();
  });

  productStack.addEventListener("pointerleave", () => {
    interactionPaused = false;
    startCycle();
  });

  document.addEventListener("visibilitychange", startCycle);
  window.addEventListener("navoke:motionchange", startCycle);

  arrangeStack();
  const imageDecodeTasks = slides
    .map((slide) => slide.querySelector("img"))
    .filter(Boolean)
    .map((image) => image.decode?.() ?? Promise.resolve());

  Promise.allSettled(imageDecodeTasks).then(startCycle);
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
