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
