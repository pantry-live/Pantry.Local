/*
 * Pantry — Brainstorm connection storage and Gemini requests.
 *
 * The connection code is kept in its own localStorage key so it is not part of
 * the exported recipe data. Requests send the code only in a request header.
 */

import { getLanguageMeta, t } from "./i18n.js";

const STORAGE_KEY = "pantry_gemini_api_key";

export const GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const REQUEST_TIMEOUT_MS = 30000;
const RECIPE_FIELDS = ["title", "category", "subcategory", "ingredients", "steps"];

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    category: { type: "STRING" },
    subcategory: { type: "STRING" },
    ingredients: { type: "STRING" },
    steps: { type: "STRING" }
  },
  required: RECIPE_FIELDS,
  propertyOrdering: RECIPE_FIELDS
};

export class BrainstormError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "BrainstormError";
    this.code = code;
    this.status = details.status ?? null;
    this.reason = details.reason || "";
    this.apiStatus = details.apiStatus || "";
  }
}

function getStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function getConnectionCode() {
  const storage = getStorage();
  if (!storage) return "";

  try {
    return String(storage.getItem(STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function hasConnection() {
  return Boolean(getConnectionCode());
}

export function saveConnectionCode(code) {
  const value = String(code || "").trim();
  if (!value) return false;

  const storage = getStorage();
  if (!storage) return false;

  try {
    storage.setItem(STORAGE_KEY, value);
    return true;
  } catch {
    return false;
  }
}

export function clearConnectionCode() {
  const storage = getStorage();
  if (!storage) return false;

  try {
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/* ---------------------------- Prompt builder ----------------------------- */

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
    "Pantry categories already used in the app:",
    categories.length
      ? categories.map((category) => `- ${category}`).join("\n")
      : "- (none yet)",
    "",
    'Category matching rule: if one of the Pantry categories above is a good fit, use its exact spelling for "category". Otherwise use a short, clear category name. "subcategory" must also be short and non-empty.'
  ].join("\n");
}

function outputContract(languageName) {
  return [
    "Output contract:",
    "- Create exactly one recipe for exactly 2 servings.",
    `- Write every field entirely in ${languageName}.`,
    "- Return strict JSON only. No markdown fences, no commentary, no HTML, and no extra fields.",
    "- Use exactly these five string fields:",
    "{",
    '  "title": "Recipe title",',
    '  "category": "One category",',
    '  "subcategory": "One subcategory",',
    '  "ingredients": "One ingredient per line. Put the quantity first on every line.",',
    '  "steps": "One step per line. Do not add step numbers."',
    "}",
    "- Every field must be a non-empty string. Use \\n between lines inside ingredients and steps.",
    '- The "ingredients" field must be one flat list of every ingredient needed for the finished recipe, one per line, quantity first, with no grouping headers or section labels.',
    "- Use metric quantities first, with imperial equivalents in parentheses where practical.",
    '- The "steps" field must contain clear chronological steps, one per line, without leading numbers because the app renders them as an ordered list.'
  ].join("\n");
}

/**
 * Build one deterministic prompt from the Phase 3 answers and Pantry categories.
 * The same answers, categories, and UI language always produce the same text.
 */
export function buildRecipePrompt(answers = {}, categories = []) {
  const isPantry = answers.source === "pantry";
  const languageName = getLanguageMeta().nativeName;
  const categoryList = (Array.isArray(categories) ? categories : [])
    .map((category) => String(category || "").trim())
    .filter(Boolean);

  const shared = [
    categorySection(categoryList),
    "",
    outputContract(languageName)
  ].join("\n");

  if (isPantry) {
    const inventory = String(answers.pantry || "").trim();

    return [
      "You are an inventive home-economics chef specializing in pantry-clearing cooking. Create one cohesive, appetizing recipe for 2 servings using the user's available ingredients, plus standard household staples and any other ingredients needed to complete the dish.",
      "",
      "Respect every answer below. Do not ignore or contradict any of them:",
      `- Available inventory (a starting point, not a complete or exhaustive ingredient list): ${inventory}`,
      `- Dietary restrictions and preferences: ${restrictionsText(answers)}`,
      `- Meal type: ${optionLabel("meal", answers.mealType || "any")}`,
      `- Maximum time: ${optionLabel("time", answers.maxTime || "any")}`,
      `- Cuisine style — continent: ${optionLabel("continent", answers.continent || "any")}`,
      `- Cuisine style — country: ${countryLabel(answers.country)}`,
      "",
      "Guidelines:",
      "1. The listed inventory is a starting point, not a complete ingredient list and not a restriction on what may be added.",
      "2. Use as many listed inventory items as make sense.",
      "3. Add every other ingredient needed for a complete dish, including standard household staples such as oil, salt, pepper, water, flour, stock, spices, and common complementary ingredients.",
      "4. Prefer common, widely available ingredients.",
      "5. Do not return a recipe made only from the inventory unless those items already form a complete dish.",
      '6. The "ingredients" field must list every ingredient needed for the finished recipe, not only the inventory items.',
      "7. Do not list inventory items that are not used.",
      "8. If an inventory item conflicts with a dietary restriction or allergy, omit it and do not add it.",
      "9. Keep the recipe practical for a standard home kitchen and a normal home cook.",
      "10. If a core ingredient is missing, choose a sensible common substitution directly in the ingredient list and steps rather than adding a separate substitutions section.",
      "11. Use clear ingredient quantities, metric first with imperial equivalents where practical.",
      "12. Write clear, chronological steps.",
      "",
      'Do not include separate "Ingredients Used from Inventory", "Standard Staples Added", or "Substitution Alternatives" sections. The app accepts only one flat "ingredients" string.',
      "",
      shared
    ].join("\n");
  }

  const craving = String(answers.craving || "").trim();

  return [
    "You are an executive chef and culinary nutrition expert. Create one custom, creative, and delicious recipe for 2 servings, tailored precisely to the user's inputs and preferences.",
    "",
    "Respect every answer below. Do not ignore or contradict any of them:",
    `- Cuisine style — continent: ${optionLabel("continent", answers.continent || "any")}`,
    `- Cuisine style — country: ${countryLabel(answers.country)}`,
    `- Dietary restrictions and allergies: ${restrictionsText(answers)}`,
    `- Meal type: ${optionLabel("meal", answers.mealType || "any")}`,
    `- Maximum time: ${optionLabel("time", answers.maxTime || "any")}`,
    `- Flavor preferences and notes: ${craving}`,
    "",
    "Guidelines:",
    "1. Strictly respect the dietary restrictions and allergies above.",
    "2. Build a complete recipe from scratch. Do not assume any ingredients are already available.",
    "3. Keep the recipe practical for a standard home kitchen and a normal home cook.",
    "4. Keep the total recipe within the maximum time.",
    "5. Use clear ingredient quantities, metric first with imperial equivalents where practical.",
    "6. Write clear, chronological steps.",
    "",
    "Do not include a metadata block, difficulty, chef's tip, or substitutions section. The response must contain only the five fields in the output contract.",
    "",
    shared
  ].join("\n");
}

/* ---------------------------- Gemini request ----------------------------- */

function parseErrorInfo(raw) {
  try {
    const error = JSON.parse(raw)?.error;
    if (!error || typeof error !== "object") return null;

    const details = Array.isArray(error.details) ? error.details : [];
    const reason = details.find((detail) => typeof detail?.reason === "string")?.reason || "";

    return {
      apiStatus: String(error.status || ""),
      reason: String(reason),
      message: String(error.message || "")
    };
  } catch {
    return null;
  }
}

function statusToCode(status, info) {
  const reason = info?.reason || "";
  const apiStatus = info?.apiStatus || "";
  const message = info?.message || "";

  if (status === 401) return "invalidKey";
  if (status === 400) {
    return reason === "API_KEY_INVALID" || /api key/i.test(message)
      ? "invalidKey"
      : "request";
  }
  if (status === 403 || apiStatus === "PERMISSION_DENIED") return "permission";
  if (status === 404 || apiStatus === "NOT_FOUND") return "modelUnavailable";
  if (status === 429 || apiStatus === "RESOURCE_EXHAUSTED") return "rateLimit";
  if (status >= 500) return "server";
  return "server";
}

function requestError(status, raw) {
  const info = parseErrorInfo(raw);
  return new BrainstormError(statusToCode(status, info), {
    status,
    reason: info?.reason || "",
    apiStatus: info?.apiStatus || ""
  });
}

function extractResponseText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";

  return parts
    .filter((part) => part && typeof part.text === "string" && !part.thought)
    .map((part) => part.text)
    .join("")
    .trim();
}

function parseRecipe(text) {
  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BrainstormError("malformed");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BrainstormError("malformed");
  }

  const recipe = {};
  for (const field of RECIPE_FIELDS) {
    if (typeof parsed[field] !== "string") throw new BrainstormError("malformed");

    const value = parsed[field].replace(/\r\n?/g, "\n").trim();
    if (!value) throw new BrainstormError("malformed");
    recipe[field] = value;
  }

  return recipe;
}

/**
 * Request one recipe from Gemini. The connection code travels only in the
 * x-goog-api-key header. `signal` lets the caller discard a pending request.
 */
export async function generateRecipe(answers, categories, { signal } = {}) {
  const key = getConnectionCode();
  if (!key) throw new BrainstormError("invalidKey");

  const controller = new AbortController();
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  const forwardAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      globalThis.clearTimeout(timeout);
      throw new BrainstormError("aborted");
    }
    signal.addEventListener("abort", forwardAbort, { once: true });
  }

  try {
    const response = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: buildRecipePrompt(answers, categories) }]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.7
        }
      }),
      signal: controller.signal
    });

    const raw = await response.text();
    if (!response.ok) throw requestError(response.status, raw);

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new BrainstormError("malformed");
    }

    const text = extractResponseText(payload);
    if (!text) throw new BrainstormError("malformed");
    return parseRecipe(text);
  } catch (error) {
    if (error instanceof BrainstormError) throw error;
    if (signal?.aborted) throw new BrainstormError("aborted");
    if (timedOut) throw new BrainstormError("network");
    throw new BrainstormError("network");
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener("abort", forwardAbort);
  }
}
