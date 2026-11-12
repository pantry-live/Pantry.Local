/*
 * Pantry — first-run language confirmation, welcome screen, and tutorial.
 * The same tutorial is reused from Settings.
 */

import {
  LANGUAGES,
  getLanguage,
  getTutorial,
  isSupportedLocale,
  languageLabel,
  normalizeLanguage,
  t
} from "./i18n.js";
import { icon, escapeHtml, lockScroll, unlockScroll } from "./ui.js";
import * as store from "./store.js";

let activeOverlay = null;
let activeCleanup = null;

function closeOverlay() {
  if (!activeOverlay) return;

  const overlay = activeOverlay;
  const cleanup = activeCleanup;
  activeOverlay = null;
  activeCleanup = null;

  try {
    cleanup?.();
  } catch (error) {
    console.error(error);
  }

  overlay.remove();
  unlockScroll();
}

function openOverlay(html, { center = false, onClose = null } = {}) {
  closeOverlay();

  const overlay = document.createElement("div");
  overlay.className = "onboarding";
  overlay.tabIndex = -1;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const inner = document.createElement("div");
  inner.className = `onboarding__inner${center ? " onboarding__inner--center" : ""}`.trim();
  inner.innerHTML = html;
  overlay.append(inner);

  document.getElementById("overlay-root")?.append(overlay);
  lockScroll();

  activeOverlay = overlay;
  activeCleanup = onClose;

  window.requestAnimationFrame(() => {
    const focusable = overlay.querySelector(
      "button:not([disabled]), [href], input, select, textarea"
    );
    (focusable || overlay).focus();
  });

  return overlay;
}

/* ------------------------------ Language -------------------------------- */

function showLanguageScreen({ detectedLanguage, detectedLocale }) {
  return new Promise((resolve) => {
    const initial = normalizeLanguage(store.getSettings().language || detectedLanguage);
    const known = isSupportedLocale(detectedLocale || detectedLanguage);
    const detectedText = known
      ? t("language.detected", { language: languageLabel(detectedLanguage, getLanguage()) })
      : t("language.detectedUnknown");

    const overlay = openOverlay(`
      <div class="onboarding__logo" aria-hidden="true">${icon("hat")}</div>
      <div class="onboarding__stack">
        <h1 class="onboarding__title">${escapeHtml(t("language.title"))}</h1>
        <p class="onboarding__text">${escapeHtml(detectedText)}</p>
        <div class="language-picker" role="group" aria-label="${escapeHtml(t("language.label"))}">
          ${LANGUAGES.map((language) => `
            <button
              class="button ${language.code === initial ? "is-selected" : "button--secondary"}"
              type="button"
              data-language="${language.code}"
              aria-pressed="${language.code === initial ? "true" : "false"}"
            >${escapeHtml(language.nativeName)}</button>
          `).join("")}
        </div>
        <p class="field__hint">${escapeHtml(t("language.hint"))}</p>
      </div>
      <button class="button button--block" type="button" data-action="continue">
        ${escapeHtml(t("language.continue"))}
      </button>
    `);

    let selected = initial;
    let settled = false;
    const languageButtons = [...overlay.querySelectorAll("[data-language]")];

    const paintSelection = () => {
      for (const button of languageButtons) {
        const isSelected = button.dataset.language === selected;
        button.classList.toggle("is-selected", isSelected);
        button.classList.toggle("button--secondary", !isSelected);
        button.setAttribute("aria-pressed", isSelected ? "true" : "false");
      }
    };

    overlay.addEventListener("click", (event) => {
      const languageButton = event.target.closest("[data-language]");
      if (languageButton) {
        selected = normalizeLanguage(languageButton.dataset.language);
        paintSelection();
        return;
      }

      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "continue" && !settled) {
        settled = true;
        store.confirmLanguage(selected);
        closeOverlay();
        resolve(true);
      }
    });
  });
}

/* ------------------------------- Welcome -------------------------------- */

function showWelcomeScreen() {
  return new Promise((resolve) => {
    const tabs = [
      { tab: "cooking", icon: "pot", title: "welcome.cookingTitle", text: "welcome.cookingText" },
      { tab: "shopping", icon: "bag", title: "welcome.shoppingTitle", text: "welcome.shoppingText" },
      { tab: "brainstorm", icon: "bulb", title: "welcome.brainstormTitle", text: "welcome.brainstormText" }
    ];

    const overlay = openOverlay(`
      <div class="onboarding__logo" aria-hidden="true">${icon("hat")}</div>
      <div class="onboarding__stack">
        <h1 class="onboarding__title">${escapeHtml(t("welcome.title"))}</h1>
        <p class="onboarding__text">${escapeHtml(t("welcome.text"))}</p>
        <div class="welcome-tabs">
          ${tabs.map((item) => `
            <button class="welcome-tab" type="button" data-tab-choice="${item.tab}">
              <span class="welcome-tab__icon" aria-hidden="true">${icon(item.icon)}</span>
              <span>
                <span class="welcome-tab__title">${escapeHtml(t(item.title))}</span>
                <span class="welcome-tab__text">${escapeHtml(t(item.text))}</span>
              </span>
              <span class="welcome-tab__arrow" aria-hidden="true">${icon("arrow-right")}</span>
            </button>
          `).join("")}
        </div>
      </div>
      <button class="onboarding__skip" type="button" data-action="skip">
        ${escapeHtml(t("welcome.skipTutorial"))}
      </button>
    `);

    let settled = false;
    const finish = (choice) => {
      if (settled) return;
      settled = true;
      store.markWelcomeSeen();
      if (choice === "skip") store.markTutorialSeen();
      closeOverlay();
      resolve(choice);
    };

    overlay.addEventListener("click", (event) => {
      const choice = event.target.closest("[data-tab-choice]")?.dataset.tabChoice;
      if (choice) {
        finish(choice);
        return;
      }
      if (event.target.closest('[data-action="skip"]')) finish("skip");
    });
  });
}

/* ------------------------------- Tutorial ------------------------------- */

export function showTutorial() {
  return new Promise((resolve) => {
    const steps = getTutorial();
    let index = 0;
    let settled = false;

    const onKeydown = (event) => {
      if (event.key === "Escape") finish();
    };

    const overlay = openOverlay(`
      <div class="tutorial">
        <div class="tutorial__top">
          <div class="tutorial__dots" aria-hidden="true">
            ${steps.map((_, stepIndex) => `
              <span class="tutorial__dot${stepIndex === 0 ? " is-active" : ""}"></span>
            `).join("")}
          </div>
          <button class="onboarding__skip" type="button" data-action="skip">
            ${escapeHtml(t("tutorial.skip"))}
          </button>
        </div>

        <div class="tutorial__content">
          <div class="tutorial__icon" aria-hidden="true" data-ref="icon"></div>
          <h1 class="tutorial__title" data-ref="title"></h1>
          <p class="tutorial__text" data-ref="text"></p>
        </div>

        <div>
          <div class="tutorial__actions">
            <button class="button button--secondary" type="button" data-action="back" hidden>
              ${escapeHtml(t("tutorial.back"))}
            </button>
            <button class="button" type="button" data-action="next"></button>
          </div>
          <p class="tutorial__counter" data-ref="counter"></p>
        </div>
      </div>
    `, {
      onClose: () => document.removeEventListener("keydown", onKeydown)
    });

    const iconElement = overlay.querySelector('[data-ref="icon"]');
    const titleElement = overlay.querySelector('[data-ref="title"]');
    const textElement = overlay.querySelector('[data-ref="text"]');
    const counterElement = overlay.querySelector('[data-ref="counter"]');
    const backButton = overlay.querySelector('[data-action="back"]');
    const nextButton = overlay.querySelector('[data-action="next"]');
    const dots = [...overlay.querySelectorAll(".tutorial__dot")];

    const paint = () => {
      const step = steps[index];
      iconElement.innerHTML = icon(step.icon);
      titleElement.textContent = t(step.title);
      textElement.textContent = t(step.text);
      counterElement.textContent = t("tutorial.counter", {
        current: index + 1,
        total: steps.length
      });
      backButton.hidden = index === 0;
      nextButton.textContent = index === steps.length - 1
        ? t("tutorial.done")
        : t("tutorial.next");
      dots.forEach((dot, dotIndex) => {
        dot.classList.toggle("is-active", dotIndex === index);
      });
    };

    function finish() {
      if (settled) return;
      settled = true;
      store.markTutorialSeen();
      closeOverlay();
      resolve(true);
    }

    overlay.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "skip") {
        finish();
      } else if (action === "back" && index > 0) {
        index -= 1;
        paint();
      } else if (action === "next") {
        if (index >= steps.length - 1) {
          finish();
        } else {
          index += 1;
          paint();
        }
      }
    });

    document.addEventListener("keydown", onKeydown);
    paint();
  });
}

/* ------------------------------- Sequence ------------------------------- */

/**
 * Run whichever onboarding screens are still needed.
 * Resolves when the user is ready to use the app.
 */
export async function runOnboarding({
  detectedLanguage = "en",
  detectedLocale = "",
  onNavigate,
  onLanguageChanged
} = {}) {
  if (!store.getSettings().languageConfirmed) {
    await showLanguageScreen({ detectedLanguage, detectedLocale });
    onLanguageChanged?.();
  }

  if (!store.getSettings().welcomeSeen) {
    const choice = await showWelcomeScreen();
    if (choice === "skip") return;

    onNavigate?.(choice);
    if (!store.getSettings().tutorialSeen) await showTutorial();
    return;
  }

  if (!store.getSettings().tutorialSeen) {
    await showTutorial();
  }
}
