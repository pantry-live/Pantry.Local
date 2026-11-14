/*
 * Pantry — application state and local persistence.
 *
 * Everything lives in localStorage under one key. Storage failures keep the
 * in-memory state usable.
 */

import {
  defaultCategories,
  isDefaultCategorySet,
  normalizeLanguage,
  setLanguage as applyLanguage,
  t
} from "./i18n.js";
import { toast } from "./ui.js";

const DATA_VERSION = 1;
const SAVE_DELAY = 600;
const STORAGE_KEY = "pantry.local.v1";

let state = null;
let saveTimer = null;
let storageWarned = false;
const listeners = new Set();

/* ------------------------------ Events --------------------------------- */

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      console.error(error);
    }
  }
}

/* ----------------------------- Helpers --------------------------------- */

function makeId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    /* Fall through. */
  }
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeRecipe(raw) {
  if (!raw || typeof raw !== "object") return null;

  const title = String(raw.title || "").trim();
  if (!title) return null;

  const now = new Date().toISOString();
  return {
    id: String(raw.id || "") || makeId(),
    title,
    category: String(raw.category || "").trim(),
    subcategory: String(raw.subcategory || "").trim(),
    ingredients: String(raw.ingredients || ""),
    steps: String(raw.steps || ""),
    // The app always uses two base servings; this keeps old data compatible.
    baseServings: 2,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now
  };
}

function normalizeData(raw, detectedLanguage = "en") {
  const source = raw && typeof raw === "object" ? raw : {};
  const settingsSource = source.settings && typeof source.settings === "object"
    ? source.settings
    : {};

  const recipes = Array.isArray(source.recipes)
    ? source.recipes.map(normalizeRecipe).filter(Boolean)
    : [];

  const categories = Array.isArray(source.categories)
    ? [...new Set(source.categories.map((item) => String(item || "").trim()).filter(Boolean))]
    : [];

  // Keep categories referenced by old recipes visible in the chip row.
  for (const recipe of recipes) {
    if (recipe.category && !categories.includes(recipe.category)) {
      categories.push(recipe.category);
    }
  }

    // Subcategories are stored per category, e.g. { "Dinner": ["Pasta", "Curry"] }.
  const subcategories = {};
  const sourceSubcategories = source.subcategories && typeof source.subcategories === "object"
    ? source.subcategories
    : {};
  for (const category of categories) {
    const names = Array.isArray(sourceSubcategories[category]) ? sourceSubcategories[category] : [];
    const cleaned = [...new Set(names.map((item) => String(item || "").trim()).filter(Boolean))];
    if (cleaned.length) subcategories[category] = cleaned;
  }

  return {
    version: DATA_VERSION,
    recipes,
    categories,
    subcategories,
    settings: {
      language: normalizeLanguage(settingsSource.language || detectedLanguage || "en"),
      languageConfirmed: Boolean(settingsSource.languageConfirmed),
      welcomeSeen: Boolean(settingsSource.welcomeSeen),
      tutorialSeen: Boolean(settingsSource.tutorialSeen)
    },
    updatedAt: typeof source.updatedAt === "string"
      ? source.updatedAt
      : new Date().toISOString()
  };
}

function reportStorageError(error) {
  console.error(error);
  if (storageWarned) return;
  storageWarned = true;
  toast(t("common.error"), "error");
}

function readStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch (error) {
    reportStorageError(error);
    return null;
  }
}

function writeStorage(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    storageWarned = false;
    return true;
  } catch (error) {
    reportStorageError(error);
    return false;
  }
}

/* ------------------------------ Loading -------------------------------- */

/**
 * Load the single local data file. A missing or unreadable key starts a fresh
 * recipe book with default categories.
 */
export async function init({ detectedLanguage = "en" } = {}) {
  const stored = readStorage();
  const data = normalizeData(stored, detectedLanguage);
  const hadCategories = data.categories.length > 0;

  if (!data.settings.languageConfirmed) {
    data.settings.language = normalizeLanguage(detectedLanguage || data.settings.language);
  }

  if (!hadCategories) {
    data.categories = defaultCategories(data.settings.language);
  }

  state = {
    data,
    offline: false,
    dirty: false,
    lastError: null
  };

  applyLanguage(data.settings.language);
  emit({ type: "loaded", offline: false, error: null });

  if (!stored || !hadCategories) {
    state.dirty = true;
    runSave();
  }

  return { data, offline: false, error: null };
}

/* ------------------------------ Getters -------------------------------- */

export function getData() {
  return state?.data || null;
}

export function getRecipes() {
  return state?.data?.recipes || [];
}

export function getRecipe(id) {
  return getRecipes().find((recipe) => recipe.id === id) || null;
}

export function getCategories() {
  return state?.data?.categories || [];
}

export function getSettings() {
  return state?.data?.settings || {};
}

export function isOffline() {
  return false;
}

export function getFileId() {
  return null;
}

export function getProfileSub() {
  return "";
}

/* ----------------------------- Mutations ------------------------------- */

function touch() {
  if (!state) return;
  state.data.updatedAt = new Date().toISOString();
  state.dirty = true;
  scheduleSave(false);
}

export function addRecipe({ title, category, subcategory, ingredients, steps }) {
  if (!state) return null;

  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) return null;

  const now = new Date().toISOString();
  const recipe = {
    id: makeId(),
    title: cleanTitle,
    category: String(category || "").trim(),
    subcategory: String(subcategory || "").trim(),
    ingredients: String(ingredients || ""),
    steps: String(steps || ""),
    baseServings: 2,
    createdAt: now,
    updatedAt: now
  };

  state.data.recipes.unshift(recipe);
  touch();
  return recipe;
}

export function updateRecipe(id, changes) {
  if (!state) return null;

  const recipe = state.data.recipes.find((item) => item.id === id);
  if (!recipe) return null;

  if (changes.title !== undefined) {
    const title = String(changes.title || "").trim();
    if (!title) return null;
    recipe.title = title;
  }
  if (changes.category !== undefined) recipe.category = String(changes.category || "").trim();
  if (changes.subcategory !== undefined) recipe.subcategory = String(changes.subcategory || "").trim();
  if (changes.ingredients !== undefined) recipe.ingredients = String(changes.ingredients || "");
  if (changes.steps !== undefined) recipe.steps = String(changes.steps || "");

  recipe.updatedAt = new Date().toISOString();
  touch();
  return recipe;
}

export function deleteRecipe(id) {
  if (!state) return false;

  const next = state.data.recipes.filter((recipe) => recipe.id !== id);
  if (next.length === state.data.recipes.length) return false;

  state.data.recipes = next;
  touch();
  return true;
}

/** Swap default category names, and the recipes that use them, to the new language. Custom names are kept. */
function swapDefaultCategoryNames(fromLanguage, toLanguage) {
  const from = defaultCategories(fromLanguage);
  const to = defaultCategories(toLanguage);

  const renames = new Map();
  from.forEach((name, index) => {
    if (to[index] && to[index] !== name) renames.set(name, to[index]);
  });
  if (!renames.size) return;

  const renamed = state.data.categories.map((category) => renames.get(category) || category);
  state.data.categories = [...new Set(renamed)];

  state.data.recipes.forEach((recipe) => {
    if (renames.has(recipe.category)) recipe.category = renames.get(recipe.category);
  });
}

export function setLanguage(language) {
  if (!state) return;

  const next = normalizeLanguage(language);
  const previous = state.data.settings.language;

  if (previous === next) {
    applyLanguage(next);
    return;
  }

  swapDefaultCategoryNames(previous, next);

  state.data.settings.language = next;
  applyLanguage(next);
  touch();
  emit({ type: "language", language: next });
}

export function confirmLanguage(language) {
  if (!state) return null;

  const next = normalizeLanguage(language);
  const wasConfirmed = state.data.settings.languageConfirmed;

  state.data.settings.language = next;
  state.data.settings.languageConfirmed = true;

  if (state.data.categories.length === 0 || isDefaultCategorySet(state.data.categories)) {
    state.data.categories = defaultCategories(next);
  }

  applyLanguage(next);
  touch();
  emit({ type: "language", language: next });

  return { wasConfirmed };
}

export function markWelcomeSeen() {
  if (!state || state.data.settings.welcomeSeen) return;
  state.data.settings.welcomeSeen = true;
  touch();
}

export function markTutorialSeen() {
  if (!state || state.data.settings.tutorialSeen) return;
  state.data.settings.tutorialSeen = true;
  touch();
}

export function addCategory(name) {
  if (!state) return { ok: false, reason: "missing" };

  const value = String(name || "").trim();
  if (!value) return { ok: false, reason: "empty" };

  const exists = state.data.categories.some((category) => (
    category.toLowerCase() === value.toLowerCase()
  ));
  if (exists) return { ok: false, reason: "duplicate" };

  state.data.categories.push(value);
  touch();
  return { ok: true, value };
}

/** Add any default categories (in the current language) that are missing. Existing categories are kept. */
export function restoreDefaultCategories() {
  if (!state) return { ok: false, added: 0 };

  const existing = state.data.categories;
  const missing = defaultCategories().filter((name) => (
    !existing.some((category) => category.toLowerCase() === name.toLowerCase())
  ));

  if (!missing.length) return { ok: true, added: 0 };

  state.data.categories = [...existing, ...missing];
  touch();
  return { ok: true, added: missing.length };
}

export function renameCategory(fromName, toName) {
  if (!state) return { ok: false, reason: "missing" };

  const from = String(fromName || "").trim();
  const to = String(toName || "").trim();

  if (!to) return { ok: false, reason: "empty" };
  if (!state.data.categories.includes(from)) return { ok: false, reason: "missing" };
  if (from === to) return { ok: true, value: to };

  const duplicate = state.data.categories.some((category) => (
    category.toLowerCase() === to.toLowerCase() && category !== from
  ));
  if (duplicate) return { ok: false, reason: "duplicate" };

  state.data.categories = state.data.categories.map((category) => (
    category === from ? to : category
  ));
  for (const recipe of state.data.recipes) {
    if (recipe.category === from) recipe.category = to;
  }

    if (state.data.subcategories[from]) {
    state.data.subcategories[to] = state.data.subcategories[from];
    delete state.data.subcategories[from];
  }

  touch();
  return { ok: true, value: to };
}

export function deleteCategory(name) {
  if (!state) return { ok: false, reason: "missing" };

  const value = String(name || "").trim();
  if (!state.data.categories.includes(value)) return { ok: false, reason: "missing" };

  if (state.data.categories.length <= 1) {
    return { ok: false, reason: "last" };
  }

  const count = state.data.recipes.filter((recipe) => recipe.category === value).length;
  if (count > 0) return { ok: false, reason: "in_use", count };

  state.data.categories = state.data.categories.filter((category) => category !== value);
  delete state.data.subcategories[value];
  touch();
  return { ok: true };
}

export function getSubcategories(category) {
  if (!state) return [];
  return [...(state.data.subcategories[category] || [])];
}

export function addSubcategory(category, name) {
  if (!state) return { ok: false, reason: "missing" };

  const parent = String(category || "").trim();
  const value = String(name || "").trim();
  if (!state.data.categories.includes(parent)) return { ok: false, reason: "missing" };
  if (!value) return { ok: false, reason: "empty" };

  const list = state.data.subcategories[parent] || [];
  if (list.some((item) => item.toLowerCase() === value.toLowerCase())) {
    return { ok: false, reason: "duplicate" };
  }

  state.data.subcategories[parent] = [...list, value];
  touch();
  return { ok: true, value };
}

export function deleteSubcategory(category, name) {
  if (!state) return { ok: false, reason: "missing" };

  const parent = String(category || "").trim();
  const value = String(name || "").trim();
  const list = state.data.subcategories[parent] || [];
  if (!list.includes(value)) return { ok: false, reason: "missing" };

  for (const recipe of state.data.recipes) {
    if (recipe.category === parent && recipe.subcategory === value) recipe.subcategory = "";
  }

  const remaining = list.filter((item) => item !== value);
  if (remaining.length) state.data.subcategories[parent] = remaining;
  else delete state.data.subcategories[parent];

  touch();
  return { ok: true };
}

/* ------------------------------ Saving --------------------------------- */

function scheduleSave(immediate = false) {
  if (!state) return;

  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }

  if (immediate) {
    runSave();
    return;
  }

  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    runSave();
  }, SAVE_DELAY);
}

function runSave() {
  if (!state) return true;
  if (!state.dirty) return true;

  const success = writeStorage(state.data);

  if (success) {
    state.dirty = false;
    state.lastError = null;
    emit({ type: "saved" });
  } else {
    state.dirty = true;
    state.lastError = new Error("Local storage is unavailable.");
    emit({ type: "save-error", error: state.lastError });
  }

  return success;
}

/** Flush pending changes. Returns true when everything was written. */
export async function flush() {
  if (!state) return true;

  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }

  return runSave();
}

/** Retry a previously failed save. */
export function retrySave() {
  if (state?.dirty) scheduleSave(true);
}

/** Clear in-memory state. */
export function destroy() {
  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  state = null;
}

/** Remove the local data key and forget the in-memory state. */
export function clearLocalData() {
  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }

  try {
    localStorage.removeItem(STORAGE_KEY);
    state = null;
    storageWarned = false;
    return true;
  } catch (error) {
    reportStorageError(error);
    return false;
  }
}
