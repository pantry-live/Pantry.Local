/*
 * Pantry — builds the chat prompt for the offline Brainstorm flow.
 *
 * The prompt asks an external AI chat to answer in Pantry's plain-text import
 * format, so the pasted reply can be parsed by importer.js without any extra
 * transformation.
 */

import { getLanguageMeta, t } from "./i18n.js";

function optionLabel(prefix, value) {
  const key = String(value || "");
  return t(`brainstorm.${prefix}${key.charAt(0).toUpperCase()}${key.slice(1)}`);
}

function countryLabel(code) {
  if (!code || code === "any") return t("brainstorm.countryAny");

  try {
    return new Intl.DisplayNames([getLanguageMeta().locale], { type: "region" }).of(code)
      || String(code);
  } catch {
    return String(code);
  }
}

function restrictionsText(answers) {
  const labels = (Array.isArray(answers.restrictions) ? answers.restrictions : [])
    .filter((value) => value !== "none")
    .map((value) => optionLabel("restriction", value));
  const other = String(answers.restrictionsOther || "").trim();

  if (other) labels.push(other);
  if (!labels.length) return t("brainstorm.restrictionNone");
  return labels.join(", ");
}

function categorySection(categories) {
  return [
    "Category matching:",
    "Pantry categories already used in the app:",
    categories.length
      ? categories.map((category) => `- ${category}`).join("\n")
      : "- (none yet)",
    "",
    'If one of the Pantry categories above is a good fit, use its exact spelling for "Category". Otherwise use a short, clear category name. "Subcategory" must also be short and non-empty.'
  ].join("\n");
}

function outputSection(languageName) {
  return [
    "Output format:",
    "Return the recipe in chat using exactly this plain-text layout.",
    "Do not use code fences, JSON, HTML, markdown tables, or extra commentary.",
    "Use the English field labels exactly as shown, and replace the dots with the recipe content.",
    "",
    "Title: ...",
    "Category: ...",
    "Subcategory: ...",
    "Tags:",
    "",
    "Ingredients:",
    "...",
    "",
    "Steps:",
    "...",
    "",
    `Write all recipe content in ${languageName}.`,
    'The "Tags:" line may be left empty or contain a short comma-separated list.',
    "One ingredient per line. Put the quantity first on every line.",
    "One step per line. Do not add step numbers.",
    "The ingredients list must be one flat list of every ingredient needed for the finished recipe, with no grouping headers or section labels.",
    "Use metric quantities first, with imperial equivalents in parentheses where practical."
  ].join("\n");
}

/**
 * Build one deterministic chat prompt from the wizard answers and Pantry
 * categories. The same answers, categories, and UI language always produce the
 * same text.
 */
export function buildChatPrompt(answers = {}, categories = []) {
  const isPantry = answers.source === "pantry";
  const languageName = getLanguageMeta().nativeName;
  const categoryList = (Array.isArray(categories) ? categories : [])
    .map((category) => String(category || "").trim())
    .filter(Boolean);

  const shared = [
    categorySection(categoryList),
    "",
    outputSection(languageName)
  ].join("\n");

  if (isPantry) {
    const inventory = String(answers.pantry || "").trim();

    return [
      "You are an inventive home-economics chef specializing in pantry-clearing cooking. Create one cohesive, appetizing recipe for 2 servings using the user's available ingredients, plus standard household staples and any other ingredients needed to complete the dish.",
      "",
      "Respect every answer below. Do not ignore or contradict any of them:",
      "- Starting point: Use what I have at home",
      `- Available inventory (a starting point, not a complete or exhaustive ingredient list): ${inventory}`,
      `- Dietary restrictions and preferences: ${restrictionsText(answers)}`,
      `- Meal type: ${optionLabel("meal", answers.mealType || "any")}`,
      `- Maximum time: ${optionLabel("time", answers.maxTime || "any")}`,
      `- Cuisine style — continent: ${optionLabel("continent", answers.continent || "any")}`,
      `- Cuisine style — country: ${countryLabel(answers.country)}`,
      "",
      "Recipe quality guidelines:",
      "1. Create exactly one recipe for exactly 2 servings.",
      "2. The listed inventory is a starting point, not a complete ingredient list and not a restriction on what may be added.",
      "3. Use as many listed inventory items as make sense.",
      "4. Add every other ingredient needed for a complete dish, including standard household staples such as oil, salt, pepper, water, flour, stock, spices, and common complementary ingredients.",
      "5. Prefer common, widely available ingredients.",
      "6. Do not return a recipe made only from the inventory unless those items already form a complete dish.",
      '7. The "Ingredients:" list must list every ingredient needed for the finished recipe, not only the inventory items.',
      "8. Do not list inventory items that are not used.",
      "9. If an inventory item conflicts with a dietary restriction or allergy, omit it and do not add it.",
      "10. Keep the recipe practical for a standard home kitchen and a normal home cook.",
      "11. If a core ingredient is missing, choose a sensible common substitution directly in the ingredient list and steps rather than adding a separate substitutions section.",
      "12. Use clear ingredient quantities, metric first with imperial equivalents where practical.",
      "13. Write clear, chronological steps.",
      "",
      'Do not include separate "Ingredients Used from Inventory", "Standard Staples Added", or "Substitution Alternatives" sections.',
      "",
      shared
    ].join("\n");
  }

  const craving = String(answers.craving || "").trim();

  return [
    "You are an executive chef and culinary nutrition expert. Create one custom, creative, and delicious recipe for 2 servings, tailored precisely to the user's inputs and preferences.",
    "",
    "Respect every answer below. Do not ignore or contradict any of them:",
    "- Starting point: Start with a new idea",
    `- Flavor preferences and notes: ${craving}`,
    `- Dietary restrictions and allergies: ${restrictionsText(answers)}`,
    `- Meal type: ${optionLabel("meal", answers.mealType || "any")}`,
    `- Maximum time: ${optionLabel("time", answers.maxTime || "any")}`,
    `- Cuisine style — continent: ${optionLabel("continent", answers.continent || "any")}`,
    `- Cuisine style — country: ${countryLabel(answers.country)}`,
    "",
    "Recipe quality guidelines:",
    "1. Create exactly one recipe for exactly 2 servings.",
    "2. Strictly respect the dietary restrictions and allergies above.",
    "3. Build a complete recipe from scratch. Do not assume any ingredients are already available.",
    "4. Keep the recipe practical for a standard home kitchen and a normal home cook.",
    "5. Keep the total recipe within the maximum time.",
    "6. Use clear ingredient quantities, metric first with imperial equivalents where practical.",
    "7. Write clear, chronological steps.",
    "",
    "Do not include a metadata block, difficulty, chef's tip, or substitutions section. The response must contain only the plain-text recipe layout below.",
    "",
    shared
  ].join("\n");
}

/** Remove a surrounding or leading/trailing markdown code fence from AI output. */
export function stripCodeFences(text) {
  let value = String(text || "").trim();
  const block = value.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```$/);
  if (block) value = block[1].trim();
  return value.replace(/^```[a-zA-Z0-9_-]*\s*\n?/i, "").replace(/\n?```$/i, "").trim();
}
