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
