/*
 * Pantry — cooking tab.
 *
 * This module owns the recipe list, recipe form, recipe detail view, category
 * editor, and the full-screen cooking overlay. State is kept in this module so
 * list filters survive opening a recipe and returning to the list.
 */

import {
  getBackCommands,
  getLanguageMeta,
  getVoiceCommands,
  servingsLabel,
  t
} from "../i18n.js";
import {
  ingredientPreview,
  matchesSearch,
  scaleIngredientLine,
  splitLines
} from "../recipe.js";
import { escapeHtml, icon, openModal, confirmDialog, toast, lockScroll, unlockScroll } from "../ui.js";
import { createSpeechController, isSpeechSupported } from "../speech.js";
import { setRecipeOpen } from "../wakelock.js";
import * as store from "../store.js";

const SERVINGS_MIN = 1;
const SERVINGS_MAX = 99;

function createState() {
  return {
    mode: "list",
    query: "",
    category: "all",
    subcategory: "all",
    recipeId: null,
    servings: 2
  };
}

let state = createState();
let root = null;
let ctx = null;
let cookingOverlay = null;

/* ------------------------------ Lifecycle ------------------------------- */

export function render(container, appContext) {
  root = container;
  ctx = appContext;
  state = createState();

  root.addEventListener("click", handleClick);
  root.addEventListener("input", handleInput);
  root.addEventListener("submit", handleSubmit);
  root.addEventListener("change",handleChange);

  paint();
  return cleanup;
}

export function reset() {
  closeCooking();
  setRecipeOpen(false);
  state = createState();
}

function cleanup() {
  closeCooking();
  setRecipeOpen(false);
  root = null;
  ctx = null;
}

function paint() {
  if (!root || !ctx) return;

  if (state.mode === "detail") {
    const recipe = store.getRecipe(state.recipeId);
    if (!recipe) {
      showList();
      return;
    }
    setRecipeOpen(true);
    ctx.setBack(showList);
    renderDetail(recipe);
    return;
  }

  if (state.mode === "form") {
    setRecipeOpen(false);
    ctx.setBack(cancelForm);
    renderForm(store.getRecipe(state.recipeId));
    return;
  }

  setRecipeOpen(false);
  ctx.setBack(null);
  renderList();
}

function showList() {
  closeCooking();
  setRecipeOpen(false);
  state.mode = "list";
  state.recipeId = null;
  ctx?.setBack(null);
  paint();
}

function showDetail(id) {
  closeCooking();
  state.mode = "detail";
  state.recipeId = id;
  state.servings = 2;
  paint();
}

function showForm(id = null) {
  closeCooking();
  setRecipeOpen(false);
  state.mode = "form";
  state.recipeId = id;
  paint();
}

function cancelForm() {
  if (state.recipeId) showDetail(state.recipeId);
  else showList();
}

/* --------------------------- Event handling ----------------------------- */

function handleClick(event) {
  const actionElement = event.target.closest("[data-action]");
  const action = actionElement?.dataset.action;

  if (action) {
    switch (action) {
      case "add":
        showForm();
        return;
      case "edit-categories":
        openCategoryEditor();
        return;
      case "clear-search":
        clearSearch();
        return;
      case "add-first":
        showForm();
        return;
      case "add-subcategory":
        openSubcategoryEditor();
        return;
      case "clear-filters":
        state.query = "";
        state.category = "all";
        state.subcategory = "all";
        renderList();
        return;
      case "back":
        showList();
        return;
      case "edit":
        if (state.recipeId) showForm(state.recipeId);
        return;
      case "delete":
        if (state.recipeId) deleteRecipe(state.recipeId);
        return;
      case "decrease":
        changeServings(-1);
        return;
      case "increase":
        changeServings(1);
        return;
      case "start-cooking":
        startCooking();
        return;
      case "cancel-form":
        cancelForm();
        return;
      default:
        return;
    }
  }

  const categoryButton = event.target.closest("[data-category]");
  if (categoryButton && root.contains(categoryButton)) {
    const value = categoryButton.dataset.category || "all";
    state.category = state.category === value ? "all" : value;
    state.subcategory = "all";
    renderChips();
    renderSubChips();
    renderResults();
    return;
  }

  const subcategoryButton = event.target.closest("[data-subcategory]");
  if (subcategoryButton && root.contains(subcategoryButton)) {
    const value = subcategoryButton.dataset.subcategory || "all";
    state.subcategory = state.subcategory === value ? "all" : value;
    renderSubChips();
    renderResults();
    return;
  }

  const recipeCard = event.target.closest("[data-recipe-id]");
  if (recipeCard && root.contains(recipeCard)) {
    showDetail(recipeCard.dataset.recipeId);
  }
}

function handleInput(event) {
  if (event.target.matches('[data-ref="search"]')) {
    state.query = event.target.value;
    const clearButton = root.querySelector('[data-action="clear-search"]');
    if (clearButton) clearButton.hidden = state.query.length === 0;
    renderResults();
  }
}

function handleSubmit(event) {
  const form = event.target.closest('[data-form="recipe"]');
  if (!form) return;

  event.preventDefault();
  saveRecipeForm(form);
}

/* ------------------------------- List ----------------------------------- */

function renderList() {
  const categoryLabel = t("cooking.categoriesTitle");
  const categoryAction = state.category;

  root.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${escapeHtml(t("cooking.title"))}</h1>
      <div class="page-actions">
        <button class="icon-button" type="button" data-action="edit-categories"
          aria-label="${escapeHtml(t("cooking.editCategories"))}">
          ${icon("edit")}
        </button>
        <button class="button button--small" type="button" data-action="add">
          ${icon("plus")}
          <span>${escapeHtml(t("cooking.addRecipe"))}</span>
        </button>
      </div>
    </div>

    <div class="search-row">
      <div class="search">
        ${icon("search")}
        <input class="input" type="search" data-ref="search"
          value="${escapeHtml(state.query)}"
          placeholder="${escapeHtml(t("cooking.searchPlaceholder"))}"
          aria-label="${escapeHtml(t("cooking.searchPlaceholder"))}">
        <button class="search__clear" type="button" data-action="clear-search"
          aria-label="${escapeHtml(t("cooking.searchClear"))}"
          ${state.query ? "" : "hidden"}>
          ${icon("close")}
        </button>
      </div>
    </div>

    <div class="chips" data-ref="chips" role="group"
      aria-label="${escapeHtml(categoryLabel)}"></div>

    <div class="chips" data-ref="subchips" role="group" hidden
      aria-label="${escapeHtml(t("cooking.subcategoriesTitle"))}"></div>

    <div data-ref="results"></div>
  `;

  renderChips();
  renderSubChips();
  renderResults();

  if (categoryAction !== "all") {
    const active = root.querySelector(`[data-category="${cssEscape(categoryAction)}"]`);
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

function renderChips() {
  const chips = root.querySelector('[data-ref="chips"]');
  if (!chips) return;

  const categories = store.getCategories();
  if (state.category !== "all" && !categories.includes(state.category)) {
    state.category = "all";
  }

  const items = [
    { value: "all", label: t("common.all") },
    ...categories.map((category) => ({ value: category, label: category }))
  ];

  chips.innerHTML = items.map((item) => {
    const active = state.category === item.value;
    return `
      <button class="chip${active ? " is-active" : ""}" type="button"
        data-category="${escapeHtml(item.value)}"
        aria-pressed="${active ? "true" : "false"}">
        ${escapeHtml(item.label)}
      </button>
    `;
  }).join("");
}

function renderResults() {
  const results = root.querySelector('[data-ref="results"]');
  if (!results) return;

  const recipes = store.getRecipes();
  const filtered = recipes.filter((recipe) => (
    (state.category === "all" || recipe.category === state.category)
    && (state.subcategory === "all" || recipe.subcategory === state.subcategory)
    && matchesSearch(recipe, state.query)
  ));

  if (!recipes.length) {
    results.innerHTML = emptyState({
      iconName: "pot",
      title: t("cooking.noRecipesTitle"),
      text: t("cooking.noRecipesText"),
      actionLabel: t("cooking.addFirst"),
      action: "add-first"
    });
    return;
  }

  if (!filtered.length) {
    results.innerHTML = emptyState({
      iconName: "search",
      title: t("cooking.noResultsTitle"),
      text: t("cooking.noResultsText"),
      actionLabel: t("cooking.clearFilters"),
      action: "clear-filters"
    });
    return;
  }

  results.innerHTML = `
        <div class="recipe-grid">
      ${filtered.map(recipeCard).join("")}
    </div>
  `;
}

function emptyState({ iconName, title, text, actionLabel, action }) {
  return `
    <div class="empty-state">
      <div class="empty-state__icon" aria-hidden="true">${icon(iconName)}</div>
      <h2 class="empty-state__title">${escapeHtml(title)}</h2>
      <p class="empty-state__text">${escapeHtml(text)}</p>
      <button class="button button--small" type="button" data-action="${action}">
        ${escapeHtml(actionLabel)}
      </button>
    </div>
  `;
}

function recipeCard(recipe) {
  const meta = [recipe.category, recipe.subcategory]
    .filter(Boolean)
    .map((value) => escapeHtml(value))
    .join(" · ");

  return `
    <button class="recipe-card" type="button" data-recipe-id="${escapeHtml(recipe.id)}">
      <span class="recipe-card__title">${escapeHtml(recipe.title)}</span>
      <span class="recipe-card__meta">${meta}</span>
    </button>
  `;
}

function clearSearch() {
  state.query = "";
  const input = root.querySelector('[data-ref="search"]');
  if (input) {
    input.value = "";
    input.focus();
  }
  const clearButton = root.querySelector('[data-action="clear-search"]');
  if (clearButton) clearButton.hidden = true;
  renderResults();
}

function renderSubChips() {
  const row = root.querySelector('[data-ref="subchips"]');
  if (!row) return;

  if (state.category === "all") {
    row.hidden = true;
    row.innerHTML = "";
    state.subcategory = "all";
    return;
  }

  const names = store.getSubcategories(state.category);
  if (state.subcategory !== "all" && !names.includes(state.subcategory)) {
    state.subcategory = "all";
  }

  const items = [
    { value: "all", label: t("common.all") },
    ...names.map((name) => ({ value: name, label: name }))
  ];

  row.hidden = false;
  row.innerHTML = items.map((item) => {
    const active = state.subcategory === item.value;
    return `
      <button class="chip${active ? " is-active" : ""}" type="button"
        data-subcategory="${escapeHtml(item.value)}"
        aria-pressed="${active ? "true" : "false"}">
        ${escapeHtml(item.label)}
      </button>
    `;
  }).join("") + `
    <button class="chip" type="button" data-action="add-subcategory">
      ${icon("plus")}
      <span>${escapeHtml(t("cooking.addSubcategory"))}</span>
    </button>
  `;
}

function openSubcategoryEditor() {
  if (state.category === "all") return;
  const parent = state.category;

  const body = document.createElement("div");
  body.className = "field";
  body.innerHTML = `
    <label class="field__label" for="new-subcategory">
      ${escapeHtml(t("cooking.subcategoryPlaceholder"))}
    </label>
    <input class="input" type="text" id="new-subcategory" autocomplete="off"
      placeholder="${escapeHtml(t("cooking.subcategoryPlaceholder"))}">
    <p class="field__hint text-danger" data-ref="subcategory-error" role="alert" hidden></p>
  `;

  const input = body.querySelector("#new-subcategory");
  const errorElement = body.querySelector('[data-ref="subcategory-error"]');

  openModal({
    title: t("cooking.addSubcategory"),
    body,
    actions: [
      { label: t("common.cancel"), variant: "secondary" },
      {
        label: t("common.add"),
        onClick: () => {
          const result = store.addSubcategory(parent, input.value);
          if (!result.ok) {
            errorElement.textContent = result.reason === "empty"
              ? t("cooking.subcategoryEmpty")
              : result.reason === "duplicate"
                ? t("cooking.subcategoryDuplicate")
                : t("common.error");
            errorElement.hidden = false;
            input.focus();
            return false;
          }

          state.subcategory = result.value;
          renderSubChips();
          renderResults();
          toast(t("cooking.subcategoryAdded"), "success");
          return true;
        }
      }
    ]
  });

  window.requestAnimationFrame(() => input.focus());
}

/* ------------------------------- Detail --------------------------------- */

function renderDetail(recipe) {
  const ingredientLines = splitLines(recipe.ingredients);
  const stepLines = splitLines(recipe.steps);

  root.innerHTML = `
    <div class="back-row">
      <button class="button button--ghost button--small" type="button" data-action="back">
        ${icon("back")}
        <span>${escapeHtml(t("cooking.backToList"))}</span>
      </button>
    </div>

    <div class="recipe-detail">
      <header class="recipe-detail__header">
        <div class="page-header">
          <h1 class="recipe-detail__title">${escapeHtml(recipe.title)}</h1>
          <div class="page-actions">
            <button class="icon-button" type="button" data-action="edit"
              aria-label="${escapeHtml(t("cooking.editRecipe"))}">
              ${icon("edit")}
            </button>
            <button class="icon-button icon-button--danger" type="button" data-action="delete"
              aria-label="${escapeHtml(t("common.delete"))}">
              ${icon("trash")}
            </button>
          </div>
        </div>
        ${recipe.category ? `
          <div class="recipe-detail__meta">
            <span class="badge">${escapeHtml(recipe.category)}</span>
          </div>
        ` : ""}
      </header>

      <div class="recipe-controls">
        <div class="servings">
          <div>
            <div class="servings__label">${escapeHtml(t("cooking.servingsLabel"))}</div>
            <div class="servings__value" data-ref="servings-value">${escapeHtml(servingsLabel(state.servings))}</div>
          </div>
          <div class="servings__controls">
            <button class="servings__button" type="button" data-action="decrease"
              aria-label="${escapeHtml(t("cooking.decreaseServings"))}">
              ${icon("minus")}
            </button>
            <button class="servings__button" type="button" data-action="increase"
              aria-label="${escapeHtml(t("cooking.increaseServings"))}">
              ${icon("plus")}
            </button>
          </div>
        </div>

        <div class="cook-toggle">
          <div class="cook-toggle__head">
            <div>
              <div class="cook-toggle__title">${escapeHtml(t("cooking.cookingMode"))}</div>
              <div class="cook-toggle__text">${escapeHtml(t("cooking.cookingModeHint"))}</div>
            </div>
          </div>

          <div class="cook-start">
            <button class="button button--block" type="button" data-action="start-cooking">
              ${icon("play")}
              <span>${escapeHtml(t("cooking.startCooking"))}</span>
            </button>
          </div>
        </div>
      </div>

      <section class="recipe-section">
        <h2 class="section-title">${escapeHtml(t("cooking.ingredientsTitle"))}</h2>
        <ul class="ingredient-list" data-ref="ingredients">
          ${renderIngredients(recipe)}
        </ul>
        <p class="scale-note">${escapeHtml(t("cooking.scaleNote"))}</p>
      </section>

      <section class="recipe-section">
        <h2 class="section-title">${escapeHtml(t("cooking.stepsTitle"))}</h2>
        ${stepLines.length ? `
          <ol class="step-list">
            ${stepLines.map((step, index) => `
              <li class="step-list__item">
                <span class="step-list__num">${index + 1}</span>
                <span class="step-list__text">${escapeHtml(step)}</span>
              </li>
            `).join("")}
          </ol>
        ` : `<p class="muted">${escapeHtml(t("cooking.noSteps"))}</p>`}
      </section>

    </div>
  `;

  if (!ingredientLines.length) {
    const list = root.querySelector('[data-ref="ingredients"]');
    if (list) list.innerHTML = `<li class="muted">${escapeHtml(t("cooking.noIngredients"))}</li>`;
  }
}

function renderIngredients(recipe) {
  const factor = state.servings / (Number(recipe.baseServings) || 2);
  const lines = splitLines(recipe.ingredients);

  if (!lines.length) {
    return `<li class="muted">${escapeHtml(t("cooking.noIngredients"))}</li>`;
  }

  return lines.map((line) => (
    `<li>${escapeHtml(scaleIngredientLine(line, factor))}</li>`
  )).join("");
}

function changeServings(delta) {
  const recipe = store.getRecipe(state.recipeId);
  if (!recipe) return;

  state.servings = Math.min(
    SERVINGS_MAX,
    Math.max(SERVINGS_MIN, state.servings + delta)
  );

  const value = root.querySelector('[data-ref="servings-value"]');
  if (value) value.textContent = servingsLabel(state.servings);

  const list = root.querySelector('[data-ref="ingredients"]');
  if (list) list.innerHTML = renderIngredients(recipe);
}

async function deleteRecipe(id) {
  const recipe = store.getRecipe(id);
  if (!recipe) return;

  const confirmed = await confirmDialog({
    title: t("cooking.deleteRecipeTitle"),
    message: t("cooking.deleteRecipeText", { title: recipe.title }),
    confirmLabel: t("common.delete"),
    cancelLabel: t("common.cancel"),
    danger: true
  });

  if (!confirmed) return;

  if (store.deleteRecipe(id)) {
    toast(t("cooking.recipeDeleted"), "success");
    showList();
  } else {
    toast(t("common.error"), "error");
  }
}

/* -------------------------------- Form ---------------------------------- */

const NEW_OPTION = "__new__";

function categoryOptions(selected) {
  const options = store.getCategories().map((category) => `
    <option value="${escapeHtml(category)}" ${category === selected ? "selected" : ""}>${escapeHtml(category)}</option>
  `).join("");

  return `${options}
    <option value="${NEW_OPTION}">${escapeHtml(t("cooking.newCategoryPlaceholder"))}</option>`;
}

function subcategoryOptions(category, selected = "") {
  const names = category && category !== NEW_OPTION ? store.getSubcategories(category) : [];
  const options = names.map((name) => `
    <option value="${escapeHtml(name)}" ${name === selected ? "selected" : ""}>${escapeHtml(name)}</option>
  `).join("");

  return `
    <option value="">${escapeHtml(t("cooking.noSubcategory"))}</option>${options}
    <option value="${NEW_OPTION}">${escapeHtml(t("cooking.subcategoryPlaceholder"))}</option>
  `;
}

function handleChange(event) {
  const form = event.target.closest('[data-form="recipe"]');
  if (!form) return;

  if (event.target.name === "category") {
    const isNew = event.target.value === NEW_OPTION;
    form.querySelector('[data-ref="new-category-field"]').hidden = !isNew;
    form.querySelector('select[name="subcategory"]').innerHTML = subcategoryOptions(event.target.value);
    form.querySelector('[data-ref="new-subcategory-field"]').hidden = true;
    if (isNew) form.elements.newCategory.focus();
    return;
  }

  if (event.target.name === "subcategory") {
    const isNew = event.target.value === NEW_OPTION;
    form.querySelector('[data-ref="new-subcategory-field"]').hidden = !isNew;
    if (isNew) form.elements.newSubcategory.focus();
  }
}

function renderForm(recipe) {
  const isEditing = Boolean(recipe);
  const categoryValue = recipe?.category || store.getCategories()[0] || "";
  const subcategoryValue = recipe?.subcategory || "";

  root.innerHTML = `
    <div class="back-row">
      <button class="button button--ghost button--small" type="button" data-action="cancel-form">
        ${icon("back")}
        <span>${escapeHtml(t("common.back"))}</span>
      </button>
    </div>

    <div class="page-header">
      <h1 class="page-title">
        ${escapeHtml(isEditing ? t("cooking.editRecipe") : t("cooking.newRecipe"))}
      </h1>
    </div>

    <form class="form" data-form="recipe" novalidate>
      <div class="field">
        <label class="field__label" for="recipe-title">${escapeHtml(t("cooking.titleLabel"))}</label>
        <input class="input" type="text" id="recipe-title" name="title"
          value="${escapeHtml(recipe?.title || "")}"
          placeholder="${escapeHtml(t("cooking.titlePlaceholder"))}"
          autocomplete="off">
      </div>

      <div class="field">
        <label class="field__label" for="recipe-category">${escapeHtml(t("cooking.categoryLabel"))}</label>
        <select class="select" name="category" id="recipe-category">
          ${categoryOptions(categoryValue)}
        </select>
        <div class="field" data-ref="new-category-field" hidden>
          <input class="input" type="text" name="newCategory" autocomplete="off"
            aria-label="${escapeHtml(t("cooking.newCategoryPlaceholder"))}"
            placeholder="${escapeHtml(t("cooking.newCategoryPlaceholder"))}">
        </div>
      </div>

      <div class="field">
        <label class="field__label" for="recipe-subcategory">${escapeHtml(t("cooking.subcategoryLabel"))}</label>
        <select class="select" name="subcategory" id="recipe-subcategory">
          ${subcategoryOptions(categoryValue, subcategoryValue)}
        </select>
        <div class="field" data-ref="new-subcategory-field" hidden>
          <input class="input" type="text" name="newSubcategory" autocomplete="off"
            aria-label="${escapeHtml(t("cooking.subcategoryPlaceholder"))}"
            placeholder="${escapeHtml(t("cooking.subcategoryPlaceholder"))}">
        </div>
      </div>

      <div class="field">
        <label class="field__label" for="recipe-ingredients">${escapeHtml(t("cooking.ingredientsLabel"))}</label>
        <textarea class="textarea" id="recipe-ingredients" name="ingredients"
          placeholder="${escapeHtml(t("cooking.ingredientsPlaceholder"))}">${escapeHtml(recipe?.ingredients || "")}</textarea>
        <p class="field__hint">${escapeHtml(t("cooking.ingredientsHint"))}</p>
      </div>

      <div class="field">
        <label class="field__label" for="recipe-steps">${escapeHtml(t("cooking.stepsLabel"))}</label>
        <textarea class="textarea" id="recipe-steps" name="steps"
          placeholder="${escapeHtml(t("cooking.stepsPlaceholder"))}">${escapeHtml(recipe?.steps || "")}</textarea>
        <p class="field__hint">${escapeHtml(t("cooking.stepsHint"))}</p>
      </div>

      <p class="field__hint text-danger" data-ref="form-error" role="alert" hidden></p>

      <div class="form-actions">
        <button class="button button--secondary" type="button" data-action="cancel-form">
          ${escapeHtml(t("common.cancel"))}
        </button>
        <button class="button" type="submit">
          ${escapeHtml(t("cooking.saveRecipe"))}
        </button>
      </div>
    </form>
  `;

  window.requestAnimationFrame(() => {
    root.querySelector("#recipe-title")?.focus();
  });
}

function saveRecipeForm(form) {
  const elements = form.elements;
  const title = String(elements.title.value || "").trim();
  const ingredients = String(elements.ingredients.value || "");
  const steps = String(elements.steps.value || "");
  const errorElement = root.querySelector('[data-ref="form-error"]');

  const showError = (message, field) => {
    if (errorElement) {
      errorElement.textContent = message;
      errorElement.hidden = false;
    }
    field?.focus();
  };

  if (!title) {
    showError(t("cooking.titleRequired"), elements.title);
    return;
  }

  // Category: an existing one, or a new name typed under "New category".
  let finalCategory = String(elements.category.value || "").trim();
  if (finalCategory === NEW_OPTION) {
    finalCategory = String(elements.newCategory.value || "").trim();
  }
  if (!finalCategory) {
    showError(t("cooking.categoryRequired"), elements.newCategory);
    return;
  }

  const existingCategory = store.getCategories().find((item) => (
    item.toLowerCase() === finalCategory.toLowerCase()
  ));
  if (existingCategory) {
    finalCategory = existingCategory;
  } else {
    const result = store.addCategory(finalCategory);
    if (!result.ok) {
      showError(t("cooking.categoryRequired"), elements.newCategory);
      return;
    }
    finalCategory = result.value;
  }

  // Subcategory is optional: an empty value means none.
  let finalSubcategory = String(elements.subcategory.value || "").trim();
  if (finalSubcategory === NEW_OPTION) {
    const newName = String(elements.newSubcategory.value || "").trim();
    if (!newName) {
      showError(t("cooking.subcategoryEmpty"), elements.newSubcategory);
      return;
    }

    const existingSubcategory = store.getSubcategories(finalCategory).find((item) => (
      item.toLowerCase() === newName.toLowerCase()
    ));
    if (existingSubcategory) {
      finalSubcategory = existingSubcategory;
    } else {
      const subResult = store.addSubcategory(finalCategory, newName);
      if (!subResult.ok) {
        showError(t("common.error"), elements.newSubcategory);
        return;
      }
      finalSubcategory = subResult.value;
    }
  }

  if (errorElement) {
    errorElement.hidden = true;
    errorElement.textContent = "";
  }

  const fields = {
    title,
    category: finalCategory,
    subcategory: finalSubcategory,
    ingredients,
    steps
  };

  const wasEditing = Boolean(state.recipeId);
  const recipe = wasEditing
    ? store.updateRecipe(state.recipeId, fields)
    : store.addRecipe(fields);

  if (!recipe) {
    showError(t("common.error"), elements.title);
    return;
  }

  toast(
    wasEditing ? t("cooking.recipeUpdated") : t("cooking.recipeSaved"),
    "success"
  );
  showDetail(recipe.id);
}

/* --------------------------- Category editor ---------------------------- */

function openCategoryEditor() {
  const body = document.createElement("div");
  body.className = "category-editor";
  body.innerHTML = `
    <p class="field__hint">${escapeHtml(t("cooking.categoriesHint"))}</p>
    <div class="category-editor__list" data-ref="category-list"></div>
    <form class="category-editor__add" data-ref="category-form">
      <label class="visually-hidden" for="new-category">
        ${escapeHtml(t("cooking.newCategoryPlaceholder"))}
      </label>
      <input class="input" type="text" id="new-category" name="category"
        placeholder="${escapeHtml(t("cooking.newCategoryPlaceholder"))}"
        autocomplete="off">
      <button class="button" type="submit">
        ${icon("plus")}
        <span>${escapeHtml(t("common.add"))}</span>
      </button>
    </form>
    <button class="button button--secondary button--small category-editor__restore" type="button"
      data-ref="restore-defaults">
      ${escapeHtml(t("cooking.restoreDefaults"))}
    </button>
    <p class="field__hint text-danger" data-ref="category-error" role="alert" hidden></p>
    <p class="field__hint" data-ref="category-info" aria-live="polite" hidden></p>
  `;

  const list = body.querySelector('[data-ref="category-list"]');
  const form = body.querySelector('[data-ref="category-form"]');
  const input = body.querySelector("#new-category");
  const errorElement = body.querySelector('[data-ref="category-error"]');

  const showError = (message) => {
    errorElement.textContent = message;
    errorElement.hidden = false;
    input.focus();
  };

  const clearError = () => {
    errorElement.hidden = true;
    errorElement.textContent = "";
  };

  const paintCategories = () => {
    const categories = store.getCategories();
    list.innerHTML = categories.map((category) => `
      <div class="category-editor__row" data-category-row="${escapeHtml(category)}">
        <span class="category-editor__name">${escapeHtml(category)}</span>
        <span class="category-editor__actions">
          <button class="icon-button icon-button--small" type="button"
            data-cat-action="rename" aria-label="${escapeHtml(t("cooking.renameCategory"))}">
            ${icon("edit")}
          </button>
          <button class="icon-button icon-button--small icon-button--danger" type="button"
            data-cat-action="delete" aria-label="${escapeHtml(t("cooking.deleteCategory"))}">
            ${icon("trash")}
          </button>
        </span>
      </div>
    `).join("");
  };

  const refreshListAfterCategories = () => {
    if (state.mode !== "list") return;
    const categories = store.getCategories();
    if (state.category !== "all" && !categories.includes(state.category)) {
      state.category = "all";
    }
    renderChips();
    renderResults();
  };

  const editCategory = (name) => {
    const wrapper = document.createElement("div");
    wrapper.className = "field";
    wrapper.innerHTML = `
      <label class="field__label" for="rename-category">
        ${escapeHtml(t("cooking.categoryNameLabel"))}
      </label>
      <input class="input" type="text" id="rename-category"
        value="${escapeHtml(name)}" autocomplete="off">
      <p class="field__hint text-danger" data-ref="rename-error" role="alert" hidden></p>
    `;

    const renameInput = wrapper.querySelector("#rename-category");
    const renameError = wrapper.querySelector('[data-ref="rename-error"]');

    openModal({
      title: t("cooking.renameCategory"),
      body: wrapper,
      actions: [
        {
          label: t("common.cancel"),
          variant: "secondary"
        },
        {
          label: t("common.save"),
          onClick: () => {
            const value = renameInput.value.trim();
            const result = store.renameCategory(name, value);

            if (!result.ok) {
              const message = result.reason === "empty"
                ? t("cooking.categoryEmpty")
                : result.reason === "duplicate"
                  ? t("cooking.categoryDuplicate")
                  : t("common.error");
              renameError.textContent = message;
              renameError.hidden = false;
              renameInput.focus();
              return false;
            }

            paintCategories();
            refreshListAfterCategories();
            toast(t("cooking.categoryRenamed"), "success");
            return true;
          }
        }
      ]
    });

    window.requestAnimationFrame(() => {
      renameInput.focus();
      renameInput.select();
    });
  };

  const removeCategory = async (name) => {
    const count = store.getRecipes().filter((recipe) => recipe.category === name).length;
    if (count > 0) {
      showError(t("cooking.categoryInUse", { count }));
      return;
    }

    if (store.getCategories().length <= 1) {
      showError(t("cooking.categoryLast"));
      return;
    }

    clearError();
    const confirmed = await confirmDialog({
      title: t("cooking.deleteCategoryTitle"),
      message: t("cooking.deleteCategoryText", { name }),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
      danger: true
    });

    if (!confirmed) return;

    const result = store.deleteCategory(name);
    if (!result.ok) {
      if (result.reason === "in_use") {
        showError(t("cooking.categoryInUse", { count: result.count || 0 }));
      } else if (result.reason === "last") {
        showError(t("cooking.categoryLast"));
      } else {
        showError(t("common.error"));
      }
      return;
    }

    paintCategories();
    refreshListAfterCategories();
    toast(t("cooking.categoryDeleted"), "success");
    input.focus();
  };

  const restoreButton = body.querySelector('[data-ref="restore-defaults"]');
  const infoElement = body.querySelector('[data-ref="category-info"]');

  restoreButton.addEventListener("click", () => {
    const result = store.restoreDefaultCategories();
    if (!result.ok) {
      showError(t("common.error"));
      return;
    }

    clearError();
    paintCategories();
    refreshListAfterCategories();
    infoElement.textContent = result.added
      ? t("cooking.defaultsRestored")
      : t("cooking.defaultsPresent");
    infoElement.hidden = false;
  });

  body.addEventListener("click", (event) => {
    const action = event.target.closest("[data-cat-action]")?.dataset.catAction;
    if (!action) return;

    const row = event.target.closest("[data-category-row]");
    const name = row?.dataset.categoryRow;
    if (!name) return;

    if (action === "rename") editCategory(name);
    else if (action === "delete") removeCategory(name);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const result = store.addCategory(input.value);

    if (!result.ok) {
      const message = result.reason === "empty"
        ? t("cooking.categoryEmpty")
        : result.reason === "duplicate"
          ? t("cooking.categoryDuplicate")
          : t("common.error");
      showError(message);
      return;
    }

    clearError();
    input.value = "";
    paintCategories();
    refreshListAfterCategories();
    toast(t("cooking.categoryAdded"), "success");
    input.focus();
  });

  paintCategories();

  openModal({
    title: t("cooking.categoriesTitle"),
    body,
    actions: [
      {
        label: t("common.done"),
        variant: "secondary"
      }
    ],
    onClose: refreshListAfterCategories
  });

  window.requestAnimationFrame(() => input.focus());
}

/* --------------------------- Cooking overlay ---------------------------- */

function buildCookingItems(recipe) {
  const factor = state.servings / (Number(recipe.baseServings) || 2);
  const ingredients = splitLines(recipe.ingredients);
  const steps = splitLines(recipe.steps);

  return [
    ...ingredients.map((line, index) => ({
      kind: "ingredient",
      text: scaleIngredientLine(line, factor),
      current: index + 1,
      total: ingredients.length
    })),
    ...steps.map((step, index) => ({
      kind: "step",
      text: step,
      current: index + 1,
      total: steps.length
    }))
  ];
}

function startCooking() {
  const recipe = store.getRecipe(state.recipeId);
  if (!recipe) return;

  const items = buildCookingItems(recipe);
  if (!items.length) {
    toast(t("cooking.nothingToCook"));
    return;
  }

  closeCooking();

  const voiceSupported = isSpeechSupported();
  let index = 0;
  let closed = false;
  let voiceListening = false;
  let voice = null;

  const overlay = document.createElement("div");
  overlay.className = "cooking-overlay";
  overlay.tabIndex = -1;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", t("cooking.cookingMode"));
  overlay.innerHTML = `
    <header class="cooking-overlay__header">
      <div class="cooking-overlay__progress" data-ref="progress"></div>
      <button class="icon-button" type="button" data-action="close-cooking"
        aria-label="${escapeHtml(t("cooking.exitCooking"))}">
        ${icon("close")}
      </button>
    </header>

    <div class="cooking-overlay__stage" data-ref="stage" aria-live="polite"></div>

    <div class="cooking-overlay__controls">
      <button class="button button--secondary" type="button" data-action="previous">
        ${escapeHtml(t("cooking.previous"))}
      </button>
      <button class="mic-button" type="button" data-action="voice"
        aria-label="${escapeHtml(t("cooking.startVoice"))}" ${voiceSupported ? "" : "hidden"}>
        ${icon("mic")}
      </button>
      <button class="button" type="button" data-action="next">
        ${escapeHtml(t("cooking.nextItem"))}
      </button>
    </div>
  `;

  document.getElementById("overlay-root")?.append(overlay);
  lockScroll();

  const progressElement = overlay.querySelector('[data-ref="progress"]');
  const stageElement = overlay.querySelector('[data-ref="stage"]');
  const previousButton = overlay.querySelector('[data-action="previous"]');
  const nextButton = overlay.querySelector('[data-action="next"]');
  const micButton = overlay.querySelector('[data-action="voice"]');
  const voiceHint = voiceSupported
    ? `${t("cooking.tapHint")} · ${t("cooking.voiceHint")}`
    : t("cooking.tapHint");

  const stopVoice = () => {
    if (voice && voiceListening) voice.stop();
    voiceListening = false;
    updateMic();
  };

  const updateMic = () => {
    if (!micButton) return;
    micButton.classList.toggle("is-listening", voiceListening);
    micButton.setAttribute(
      "aria-label",
      voiceListening ? t("cooking.stopVoice") : t("cooking.startVoice")
    );
    micButton.innerHTML = icon(voiceListening ? "stop" : "mic");
  };

  const updateStage = () => {
    const atFinish = index >= items.length;

    if (atFinish) {
      progressElement.textContent = t("cooking.finishTitle");
      stageElement.innerHTML = `
        <div class="cooking-overlay__stage-inner">
          <div class="cooking-overlay__finish">
            <span aria-hidden="true">${icon("check")}</span>
            <h2 class="cooking-overlay__finish-title">${escapeHtml(t("cooking.finishTitle"))}</h2>
            <p class="cooking-overlay__finish-text">${escapeHtml(t("cooking.finishText"))}</p>
          </div>
        </div>
      `;
      previousButton.disabled = items.length === 0;
      nextButton.textContent = t("cooking.doneCooking");
      if (micButton) micButton.hidden = true;
      return;
    }

    const item = items[index];
    const isIngredient = item.kind === "ingredient";
    progressElement.textContent = isIngredient
      ? t("cooking.ingredientProgress", { current: item.current, total: item.total })
      : t("cooking.stepProgress", { current: item.current, total: item.total });

    stageElement.innerHTML = `
      <div class="cooking-overlay__stage-inner">
        <div class="cooking-overlay__kicker">
          ${escapeHtml(isIngredient ? t("cooking.ingredientsTitle") : t("cooking.stepsTitle"))}
        </div>
        <p class="cooking-overlay__text${isIngredient ? "" : " cooking-overlay__text--step"}">
          ${escapeHtml(item.text)}
        </p>
        <p class="cooking-overlay__hint">
          ${escapeHtml(voiceListening ? t("cooking.listening") : voiceHint)}
        </p>
      </div>
    `;

    previousButton.disabled = index === 0;
    nextButton.textContent = t("cooking.nextItem");
    if (micButton) micButton.hidden = !voiceSupported;
    updateMic();
  };

  const advance = () => {
    if (index < items.length) {
      index += 1;
      if (index >= items.length) stopVoice();
      updateStage();
    } else {
      close();
    }
  };

  const previous = () => {
    if (index <= 0) return;
    index -= 1;
    updateStage();
  };

  function close() {
    if (closed) return;
    closed = true;

    if (voice) voice.stop();
    document.removeEventListener("keydown", onKeydown);
    overlay.remove();
    unlockScroll();
    if (cookingOverlay?.close === close) cookingOverlay = null;
  }

  const onKeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      advance();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      previous();
    }
  };

  if (voiceSupported) {
    voice = createSpeechController({
      lang: getLanguageMeta().speech,
      commands: getVoiceCommands(),
      backCommands: getBackCommands(),
      onCommand: advance,
      onBack: previous,
      onStateChange: (voiceState) => {
        voiceListening = voiceState === "listening";
        updateMic();
        if (!closed) updateStage();
      },
      onError: (error) => {
        voiceListening = false;
        updateMic();
        toast(
          error === "not-allowed" || error === "audio-capture"
            ? t("cooking.micDenied")
            : t("cooking.voiceError"),
          "error"
        );
      }
    });
  }

  overlay.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;

    if (action === "close-cooking") close();
    else if (action === "previous") previous();
    else if (action === "next") advance();
    else if (action === "voice") {
      if (!voice?.supported) {
        toast(t("cooking.voiceUnsupported"));
      } else if (voiceListening) {
        voice.stop();
      } else {
        voice.start();
      }
    }
  });

  stageElement.addEventListener("click", advance);
  document.addEventListener("keydown", onKeydown);

  cookingOverlay = { close };
  updateStage();
  overlay.focus();
}

function closeCooking() {
  cookingOverlay?.close();
  cookingOverlay = null;
}

/* ------------------------------- Helpers -------------------------------- */

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}
