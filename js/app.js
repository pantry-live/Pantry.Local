/*
 * Pantry — bootstrap, local splash gate, navigation, and shared chrome.
 */

import * as store from "./store.js";
import * as cookingView from "./views/cooking.js";
import * as shoppingView from "./views/shopping.js";
import * as brainstormView from "./views/brainstorm.js";
import * as settingsView from "./views/settings.js";
import { runOnboarding, showTutorial } from "./onboarding.js";
import { detectLanguage, setLanguage, t } from "./i18n.js";
import { escapeHtml, icon } from "./ui.js";

const VIEWS = {
  cooking: cookingView,
  shopping: shoppingView,
  brainstorm: brainstormView
};

const elements = {
  splash: document.getElementById("splash"),
  splashButton: document.getElementById("splash-button"),
  splashHint: document.getElementById("splash-hint"),
  splashWarning: document.getElementById("splash-warning"),
  splashPrivacy: document.getElementById("splash-privacy"),
  splashPrivacyTitle: document.getElementById("splash-privacy-title"),
  splashPrivacyBody: document.getElementById("splash-privacy-body"),
  app: document.getElementById("app"),
  view: document.getElementById("view"),
  headerBack: document.getElementById("header-back"),
  homeButton: document.getElementById("header-home"),
  settingsButton: document.getElementById("open-settings"),
  tabbar: document.querySelector(".tabbar"),
  tabButtons: [...document.querySelectorAll("[data-tab]")]
};

let currentTab = "cooking";
let currentScreen = "tab";
let activeCleanup = null;
let backHandler = null;
let busy = false;

const ctx = {
  navigate(tab) {
    showTab(tab);
  },
  openSettings,
  closeSettings() {
    showTab(currentTab);
  },
  setBack(handler) {
    setBackHandler(handler);
  },
  rerender() {
    mountCurrent();
  },
  updateChrome() {
    applyChrome();
  },
  showTutorial
};

/* ------------------------------ Splash ---------------------------------- */

function setSplashHint(text) {
  if (elements.splashHint && text) elements.splashHint.textContent = text;
}

function setSplashWarning(message) {
  if (!elements.splashWarning) return;
  elements.splashWarning.textContent = message || "";
  elements.splashWarning.hidden = !message;
}

function setSplashDisabled(disabled) {
  if (elements.splashButton) elements.splashButton.disabled = disabled;
}

function applySplashLabels() {
  if (elements.splashPrivacyTitle) {
    elements.splashPrivacyTitle.textContent = t("splash.privacyTitle");
  }
  if (elements.splashPrivacyBody) {
    elements.splashPrivacyBody.textContent = t("splash.privacyBody");
  }
  if (elements.splashPrivacy) elements.splashPrivacy.hidden = false;
  elements.splashButton?.setAttribute("aria-label", t("splash.signIn"));
}

async function handleSplashClick() {
  if (busy) return;

  busy = true;
  setSplashDisabled(true);
  setSplashWarning("");

  try {
    await openApp();
  } catch (error) {
    console.error(error);
    elements.app.hidden = true;
    elements.splash.hidden = false;
    setSplashWarning(t("common.error"));
    setSplashHint(t("splash.tapToStart"));
  } finally {
    busy = false;
    if (elements.splash && !elements.splash.hidden) {
      setSplashDisabled(false);
    }
  }
}

/* ----------------------------- App entry -------------------------------- */

async function openApp() {
  setSplashHint(t("splash.loadingRecipes"));
  setSplashDisabled(true);

  const detectedLanguage = detectLanguage(navigator.language);
  const detectedLocale = navigator.language || "";

  try {
    await store.init({ detectedLanguage });
  } catch (error) {
    console.error(error);
    elements.app.hidden = true;
    elements.splash.hidden = false;
    setSplashWarning(t("common.error"));
    setSplashHint(t("splash.tapToStart"));
    return false;
  }

  elements.splash.hidden = true;
  elements.app.hidden = false;
  elements.view.innerHTML = "";
  applyChrome();
  showTab("cooking");

  try {
    await runOnboarding({
      detectedLanguage,
      detectedLocale,
      onNavigate(tab) {
        showTab(tab);
      },
      onLanguageChanged() {
        applyChrome();
        mountCurrent();
      }
    });
  } catch (error) {
    console.error(error);
  }

  return true;
}

/* ----------------------------- Navigation ------------------------------- */

function setBackHandler(handler) {
  backHandler = handler;
  if (elements.headerBack) elements.headerBack.hidden = !handler;
}

function updateActiveTab() {
  for (const button of elements.tabButtons) {
    const active = button.dataset.tab === currentTab;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}

function showTab(tab) {
  if (!VIEWS[tab]) return;

  currentTab = tab;
  currentScreen = "tab";
  mountCurrent();
  updateActiveTab();
  applyChrome();
}

function openSettings() {
  if (!store.getData()) return;

  currentScreen = "settings";
  mountCurrent();
  updateActiveTab();
  applyChrome();
}

function mountCurrent() {
  if (!elements.view) return;

  if (activeCleanup) {
    try {
      activeCleanup();
    } catch (error) {
      console.error(error);
    }
    activeCleanup = null;
  }

  setBackHandler(null);
  elements.view.innerHTML = "";

  const content = document.createElement("div");
  content.className = "page";
  elements.view.append(content);

  const module = currentScreen === "settings" ? settingsView : VIEWS[currentTab];

  try {
    activeCleanup = module.render(content, ctx) || null;
  } catch (error) {
    console.error(error);
    content.innerHTML = `
      <div class="error-card">
        <div class="error-card__title">${escapeHtml(t("common.error"))}</div>
        <p class="error-card__text">${escapeHtml(t("errors.unknownError"))}</p>
      </div>
    `;
  }

  updateOfflineBanner();
}

function applyChrome() {
  document.querySelectorAll("[data-nav-label]").forEach((element) => {
    element.textContent = t(`nav.${element.dataset.navLabel}`);
  });

  elements.tabbar?.setAttribute("aria-label", t("nav.main"));
  elements.settingsButton?.setAttribute("aria-label", t("nav.settings"));
  elements.headerBack?.setAttribute("aria-label", t("common.back"));
  applySplashLabels();

  if (elements.app?.hidden) {
    document.title = "Pantry";
  } else {
    const label = currentScreen === "settings" ? t("nav.settings") : t(`nav.${currentTab}`);
    document.title = `${label} · Pantry`;
  }
}

/* ------------------------------ Offline --------------------------------- */

function updateOfflineBanner() {
  if (!elements.view) return;

  const banner = elements.view.querySelector(".offline-banner");
  const offline = store.isOffline();

  if (!offline) {
    banner?.remove();
    return;
  }

  if (banner) {
    const label = banner.querySelector("span");
    if (label) label.textContent = t("common.offline");
    return;
  }

  const element = document.createElement("div");
  element.className = "offline-banner";
  element.innerHTML = `${icon("refresh")}<span>${escapeHtml(t("common.offline"))}</span>`;
  elements.view.prepend(element);
}

function handleStoreEvent(event) {
  if (!event) return;

  if (event.type === "saved" || event.type === "save-error") {
    updateOfflineBanner();
    return;
  }

  if (event.type === "language") {
    applyChrome();
    updateOfflineBanner();
  }
}

/* ------------------------------- Boot ----------------------------------- */

function bindEvents() {
  elements.splashButton?.addEventListener("click", handleSplashClick);

  elements.headerBack?.addEventListener("click", () => {
    if (backHandler) backHandler();
  });

  elements.homeButton?.addEventListener("click", () => {
    showTab("cooking");
  });

  elements.settingsButton?.addEventListener("click", openSettings);

  for (const button of elements.tabButtons) {
    button.addEventListener("click", () => showTab(button.dataset.tab));
  }

  window.addEventListener("pagehide", () => {
    store.flush().catch(() => {});
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      store.flush().catch(() => {});
    }
  });

  store.subscribe(handleStoreEvent);
}

async function boot() {
  setLanguage(detectLanguage(navigator.language));
  applyChrome();
  setSplashHint(t("splash.tapToStart"));
  bindEvents();
  setSplashDisabled(false);
}

boot();
