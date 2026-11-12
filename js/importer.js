/*
 * Pantry — importing recipe text files and ZIP archives.
 *
 * Reads the text layout written by exchange.js, sorts recipes that have no
 * category using the keyword rules, and saves each one as a new recipe.
 * Duplicate titles are imported as copies, with "(copy)" added.
 */

import { readZip } from "./unzip.js";
import { KEYWORD_RULES } from "./keywords.js";
import { defaultCategories, t } from "./i18n.js";
import * as store from "./store.js";

const FIELD_PATTERN = /^(Title|Category|Subcategory|Tags):(.*)$/i;
const SECTION_PATTERN = /^(Ingredients|Steps):\s*$/i;

/** Read one recipe from the text layout used by the export. */
export function parseRecipeText(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const fields = { title: "", category: "", subcategory: "", tags: "" };
  const sections = { ingredients: [], steps: [] };
  let section = null;

  for (const raw of lines) {
    const line = raw.trim();

    const heading = line.match(SECTION_PATTERN);
    if (heading) {
      section = heading[1].toLowerCase();
      continue;
    }

    if (!section) {
      const field = line.match(FIELD_PATTERN);
      if (field) fields[field[1].toLowerCase()] = field[2].trim();
      continue;
    }

    if (line) sections[section].push(line);
  }

  return {
    title: fields.title,
    category: fields.category,
    subcategory: fields.subcategory,
    tags: fields.tags,
    ingredients: sections.ingredients.join("\n"),
    steps: sections.steps.join("\n")
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Count whole-word, case-insensitive keyword matches in a piece of text. */
function countHits(text, keywords) {
  if (!text) return 0;
  let hits = 0;
  for (const keyword of keywords) {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegex(keyword)}(?![\\p{L}\\p{N}])`,
      "giu"
    );
    hits += (text.match(pattern) || []).length;
  }
  return hits;
}

function weightedScore(recipe, keywords) {
  return countHits(recipe.title, keywords) * 3
    + countHits(recipe.tags, keywords) * 2
    + countHits(recipe.ingredients, keywords);
}

/** Pick a category and subcategory from the keyword rules. Returns null if nothing matches. */
function autoSort(recipe) {
  const englishNames = defaultCategories("en");
  const currentNames = defaultCategories(store.getSettings().language);

  let best = null;
  for (const rule of KEYWORD_RULES) {
    const score = weightedScore(recipe, rule.keywords);
    if (score > 0 && (!best || score > best.score)) best = { rule, score };
  }
  if (!best) return null;

  const index = englishNames.indexOf(best.rule.category);
  const category = index >= 0 && currentNames[index] ? currentNames[index] : best.rule.category;

  let subcategory = "";
  let subScore = 0;
  for (const sub of best.rule.subcategories || []) {
    const score = weightedScore(recipe, sub.keywords);
    if (score > subScore) {
      subScore = score;
      subcategory = sub.name;
    }
  }

  return { category, subcategory };
}

function ensureCategory(name) {
  const existing = store.getCategories().find((item) => (
    item.toLowerCase() === name.toLowerCase()
  ));
  if (existing) return existing;

  const result = store.addCategory(name);
  return result.ok ? result.value : "";
}

function ensureSubcategory(category, name) {
  if (!category || !name) return "";

  const existing = store.getSubcategories(category).find((item) => (
    item.toLowerCase() === name.toLowerCase()
  ));
  if (existing) return existing;

  const result = store.addSubcategory(category, name);
  return result.ok ? result.value : "";
}

/** Decide where a parsed recipe goes: the file's own category, or the keyword sort. */
function placeRecipe(recipe) {
  if (recipe.category) {
    const category = ensureCategory(recipe.category);
    return {
      category,
      subcategory: ensureSubcategory(category, recipe.subcategory)
    };
  }

  const sorted = autoSort(recipe);
  const category = ensureCategory(sorted?.category || t("settings.notSorted"))
    || t("settings.notSorted");
  return {
    category,
    subcategory: ensureSubcategory(category, recipe.subcategory || sorted?.subcategory)
  };
}

function uniqueTitle(title, taken) {
  if (!taken.has(title.toLowerCase())) return title;

  const label = t("settings.copyLabel");
  let candidate = `${title} (${label})`;
  let counter = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${title} (${label} ${counter})`;
    counter += 1;
  }
  return candidate;
}

function isZip(file, buffer) {
  const bytes = new Uint8Array(buffer, 0, 2);
  return file.name.toLowerCase().endsWith(".zip") || (bytes[0] === 0x50 && bytes[1] === 0x4b);
}

/**
 * Import a ZIP of text recipes, or a single text recipe.
 * @param {File} file
 * @returns {Promise<{ imported: number, skipped: number }>}
 */
export async function importFile(file) {
  const buffer = await file.arrayBuffer();
  const entries = isZip(file, buffer)
    ? await readZip(buffer)
    : [{ name: file.name, text: new TextDecoder().decode(buffer) }];

  const taken = new Set(store.getRecipes().map((recipe) => recipe.title.toLowerCase()));
  let imported = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (!entry.name.toLowerCase().endsWith(".txt")) continue;

    const parsed = parseRecipeText(entry.text);
    if (!parsed.title) {
      skipped += 1;
      continue;
    }

    const placement = placeRecipe(parsed);
    const title = uniqueTitle(parsed.title, taken);
    taken.add(title.toLowerCase());

    const recipe = store.addRecipe({
      title,
      category: placement.category,
      subcategory: placement.subcategory,
      ingredients: parsed.ingredients,
      steps: parsed.steps
    });

    if (recipe) imported += 1;
    else skipped += 1;
  }

  return { imported, skipped };
}