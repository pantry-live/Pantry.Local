/*
 * Pantry — recipe text format and export.
 *
 * Each recipe is one plain-text file with a fixed layout, so the importer can
 * read it back exactly:
 *
 *   Title: Lentil curry
 *   Category: Dinner
 *   Subcategory: Curry
 *   Tags:
 *
 *   Ingredients:
 *   2 cloves of garlic
 *   250 g red lentils
 *
 *   Steps:
 *   Chop the onion.
 *   Simmer everything.
 */

import { createZip } from "./zip.js";

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

export function formatRecipe(recipe) {
  return [
    `Title: ${recipe.title}`,
    `Category: ${recipe.category || ""}`,
    `Subcategory: ${recipe.subcategory || ""}`,
    "Tags:",
    "",
    "Ingredients:",
    String(recipe.ingredients || "").trimEnd(),
    "",
    "Steps:",
    String(recipe.steps || "").trimEnd(),
    ""
  ].join("\n");
}

function safeBaseName(title) {
  const cleaned = String(title || "")
    .replace(INVALID_FILENAME_CHARS, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "recipe";
}

function uniqueFileName(base, used) {
  let name = `${base}.txt`;
  let counter = 2;
  while (used.has(name.toLowerCase())) {
    name = `${base} (${counter}).txt`;
    counter += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

export function buildRecipeZip(recipes) {
  const used = new Set();
  const files = recipes.map((recipe) => ({
    name: uniqueFileName(safeBaseName(recipe.title), used),
    text: formatRecipe(recipe)
  }));
  return createZip(files);
}

/** Download all recipes as a ZIP of text files. Saved to the device. */
export function exportRecipes(recipes) {
  const blob = buildRecipeZip(recipes);
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);

  const link = document.createElement("a");
  link.href = url;
  link.download = `pantry-recipes-${date}.zip`;
  document.body.append(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}