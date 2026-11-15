/*
 * Pantry — Brainstorm tab view.
 *
 * The wizard builds a prompt. The user copies it into an AI chat, then pastes
 * the reply back so the app can parse it and save it to Pantry.
 */

import { getLanguageMeta, t } from "../i18n.js";
import { escapeHtml, icon, toast } from "../ui.js";
import { parseRecipeText } from "../importer.js";
import { buildChatPrompt, stripCodeFences } from "../brainstorm-prompt.js";
import * as store from "../store.js";

let activeController = null;
let mountedRoot = null;
let pendingResult = null;
let wizardDraft = null; // { step, answers } while the wizard is open

export function render(root) {
  if (wizardDraft) {
    openWizard(root, wizardDraft.answers, wizardDraft.step);
  } else {
    renderReady(root);
  }
}

/* ------------------------------- Ready ---------------------------------- */

function renderReady(root) {
  wizardDraft = null;
  root.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${escapeHtml(t("brainstorm.title"))}</h1>
    </div>

    <section class="brainstorm-card">
      <div class="brainstorm-card__icon" aria-hidden="true">${icon("bulb")}</div>
      <div class="brainstorm-card__body">
        <h2 class="brainstorm-card__title">${escapeHtml(t("brainstorm.readyTitle"))}</h2>
        <p class="brainstorm-card__text">${escapeHtml(t("brainstorm.readyText"))}</p>

        <div class="brainstorm-actions">
          <button class="button" type="button" data-action="start">
            ${escapeHtml(t("brainstorm.startBtn"))}
          </button>
        </div>
      </div>
    </section>
  `;

  root.querySelector('[data-action="start"]')?.addEventListener("click", () => {
    openWizard(root);
  });
}

/* ---------------------------- Question flow ----------------------------- */

const TOTAL_STEPS = 8;

const RESTRICTION_OPTIONS = ["none", "vegetarian", "vegan", "glutenFree", "dairyFree", "nutFree"];
const MEAL_OPTIONS = ["any", "breakfast", "lunch", "dinner", "snack", "dessert"];
const TIME_OPTIONS = ["15", "30", "45", "60", "any"];
const CONTINENT_OPTIONS = ["any", "africa", "asia", "europe", "northAmerica", "southAmerica", "oceania"];

const COUNTRY_CODES = {
  africa: ["MA", "EG", "NG", "ET", "ZA", "TN", "KE", "GH"],
  asia: ["CN", "JP", "IN", "TH", "VN", "KR", "ID", "TR", "LB", "IR"],
  europe: ["IT", "FR", "ES", "GR", "DE", "NL", "PT", "GB", "PL", "SE"],
  northAmerica: ["MX", "US", "CA", "CU", "JM"],
  southAmerica: ["BR", "AR", "PE", "CO", "CL"],
  oceania: ["AU", "NZ", "FJ", "WS"]
};

function optionLabel(prefix, value) {
  const key = String(value);
  return t(`brainstorm.${prefix}${key.charAt(0).toUpperCase()}${key.slice(1)}`);
}

function countryName(code) {
  if (!code) return "";
  if (code === "any") return t("brainstorm.countryAny");

  try {
    return new Intl.DisplayNames([getLanguageMeta().locale], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}

function countryCodesFor(continent) {
  if (continent && continent !== "any" && COUNTRY_CODES[continent]) {
    return [...COUNTRY_CODES[continent]];
  }
  return Object.values(COUNTRY_CODES).flat();
}

function sortedCountryCodes(codes) {
  const locale = getLanguageMeta().locale;
  return [...codes].sort((a, b) => countryName(a).localeCompare(countryName(b), locale));
}

function createAnswers(initial = {}) {
  const defaults = {
    source: "",
    pantry: "",
    craving: "",
    restrictions: [],
    restrictionsOther: "",
    mealType: "",
    maxTime: "",
    continent: "",
    country: ""
  };

  if (!initial || typeof initial !== "object") return defaults;

  return {
    ...defaults,
    ...initial,
    restrictions: Array.isArray(initial.restrictions) ? [...initial.restrictions] : []
  };
}

function stepTitle(step, answers) {
  switch (step) {
    case 2: return t("brainstorm.step3Title");
    case 3: return t("brainstorm.step4Title");
    case 4: return t("brainstorm.step5Title");
    case 5:
      return t(answers.source === "pantry"
        ? "brainstorm.step2PantryTitle"
        : "brainstorm.step2CravingTitle");
    case 6: return t("brainstorm.step6Title");
    case 7: return t("brainstorm.step7Title");
    case 8: return t("brainstorm.summaryTitle");
    default: return t("brainstorm.step1Title");
  }
}

function isStepValid(step, answers) {
  switch (step) {
    case 1:
      return Boolean(answers.source);
    case 2:
      return answers.restrictions.length > 0 || Boolean(answers.restrictionsOther.trim());
    case 3:
      return Boolean(answers.mealType);
    case 4:
      return Boolean(answers.maxTime);
    case 5:
      return Boolean((answers.source === "pantry" ? answers.pantry : answers.craving).trim());
    case 6:
      return Boolean(answers.continent);
    case 7:
      return Boolean(answers.country);
    default:
      return true;
  }
}

function renderChoiceList(name, prefix, values, selected, legend) {
  return `
    <fieldset class="choice-list">
      <legend class="visually-hidden">${escapeHtml(legend)}</legend>
      ${values.map((value) => `
        <label class="choice${selected === value ? " is-selected" : ""}">
          <input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(value)}"
            ${selected === value ? "checked" : ""}>
          <span class="choice__body">
            <span class="choice__title">${escapeHtml(optionLabel(prefix, value))}</span>
          </span>
        </label>
      `).join("")}
    </fieldset>
  `;
}

function renderQuestion(step, answers) {
  switch (step) {
    case 1:
      return `
        <p class="brainstorm-card__text">${escapeHtml(t("brainstorm.step1Text"))}</p>
        ${renderChoiceList(
          "brainstorm-source",
          "choice",
          ["pantry", "fresh"],
          answers.source,
          t("brainstorm.step1Title")
        )}
      `;

    case 5: {
      const isPantry = answers.source === "pantry";
      const field = isPantry ? "pantry" : "craving";
      const titleKey = isPantry ? "brainstorm.step2PantryTitle" : "brainstorm.step2CravingTitle";
      const textKey = isPantry ? "brainstorm.step2PantryText" : "brainstorm.step2CravingText";
      const labelKey = isPantry ? "brainstorm.step2PantryLabel" : "brainstorm.step2CravingLabel";
      const placeholderKey = isPantry
        ? "brainstorm.step2PantryPlaceholder"
        : "brainstorm.step2CravingPlaceholder";

      return `
        <p class="brainstorm-card__text">${escapeHtml(t(textKey))}</p>
        <label class="field">
          <span class="field__label">${escapeHtml(t(labelKey))}</span>
          <input class="input" type="text" data-ref="answer" autocomplete="off"
            spellcheck="false" value="${escapeHtml(answers[field])}"
            placeholder="${escapeHtml(t(placeholderKey))}"
            aria-label="${escapeHtml(t(titleKey))}">
        </label>
      `;
    }

    case 2: {
      const chips = RESTRICTION_OPTIONS.map((value) => {
        const active = answers.restrictions.includes(value);
        return `
          <button class="chip${active ? " is-active" : ""}" type="button"
            data-restriction="${escapeHtml(value)}" aria-pressed="${active ? "true" : "false"}">
            ${escapeHtml(optionLabel("restriction", value))}
          </button>
        `;
      }).join("");

      return `
        <p class="brainstorm-card__text">${escapeHtml(t("brainstorm.step3Text"))}</p>
        <div class="chip-set" role="group" aria-label="${escapeHtml(t("brainstorm.step3Title"))}">
          ${chips}
        </div>
        <label class="field">
          <span class="field__label">${escapeHtml(t("brainstorm.restrictionsOtherLabel"))}</span>
          <input class="input" type="text" data-ref="restrictionsOther" autocomplete="off"
            value="${escapeHtml(answers.restrictionsOther)}"
            placeholder="${escapeHtml(t("brainstorm.restrictionsOtherPlaceholder"))}">
        </label>
      `;
    }

    case 3:
      return `
        <p class="brainstorm-card__text">${escapeHtml(t("brainstorm.step4Text"))}</p>
        ${renderChoiceList(
          "brainstorm-meal",
          "meal",
          MEAL_OPTIONS,
          answers.mealType,
          t("brainstorm.step4Title")
        )}
      `;

    case 4:
      return `
        <p class="brainstorm-card__text">${escapeHtml(t("brainstorm.step5Text"))}</p>
        ${renderChoiceList(
          "brainstorm-time",
          "time",
          TIME_OPTIONS,
          answers.maxTime,
          t("brainstorm.step5Title")
        )}
      `;

    case 6:
      return `
        <p class="brainstorm-card__text">${escapeHtml(t("brainstorm.step6Text"))}</p>
        ${renderChoiceList(
          "brainstorm-continent",
          "continent",
          CONTINENT_OPTIONS,
          answers.continent,
          t("brainstorm.step6Title")
        )}
      `;

    case 7: {
      const codes = sortedCountryCodes(countryCodesFor(answers.continent));
      if (answers.country && answers.country !== "any" && !codes.includes(answers.country)) {
        answers.country = "";
      }

      return `
        <p class="brainstorm-card__text">${escapeHtml(t("brainstorm.step7Text"))}</p>
        <label class="field">
          <span class="field__label">${escapeHtml(t("brainstorm.countryLabel"))}</span>
          <select class="select" data-ref="country">
            <option value="">${escapeHtml(t("brainstorm.countryPlaceholder"))}</option>
            <option value="any" ${answers.country === "any" ? "selected" : ""}>
              ${escapeHtml(t("brainstorm.countryAny"))}
            </option>
            ${codes.map((code) => `
              <option value="${escapeHtml(code)}" ${answers.country === code ? "selected" : ""}>
                ${escapeHtml(countryName(code))}
              </option>
            `).join("")}
          </select>
        </label>
      `;
    }

    default:
      return renderSummary(answers);
  }
}

function renderSummary(answers) {
  const rows = [
    [
      t("brainstorm.summarySource"),
      answers.source === "pantry" ? t("brainstorm.choicePantry") : t("brainstorm.choiceFresh")
    ],
    [t("brainstorm.summaryRestrictions"), restrictionSummary(answers)],
    [t("brainstorm.summaryMealType"), optionLabel("meal", answers.mealType)],
    [t("brainstorm.summaryMaxTime"), optionLabel("time", answers.maxTime)],
    answers.source === "pantry"
      ? [t("brainstorm.summaryIngredients"), answers.pantry]
      : [t("brainstorm.summaryCraving"), answers.craving],
    [t("brainstorm.summaryContinent"), optionLabel("continent", answers.continent)],
    [t("brainstorm.summaryCountry"), countryName(answers.country)]
  ];

  return `
    <p class="brainstorm-card__text">${escapeHtml(t("brainstorm.summaryText"))}</p>
    <div class="brainstorm-summary">
      ${rows.map(([label, value]) => `
        <div class="brainstorm-summary__row">
          <span class="brainstorm-summary__label">${escapeHtml(label)}</span>
          <span class="brainstorm-summary__value">${escapeHtml(value)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function restrictionSummary(answers) {
  const labels = answers.restrictions
    .filter((value) => value !== "none")
    .map((value) => optionLabel("restriction", value));
  const other = answers.restrictionsOther.trim();

  if (other) labels.push(other);
  if (!labels.length && answers.restrictions.includes("none")) {
    return t("brainstorm.restrictionNone");
  }

  return labels.join(", ");
}

function updateNextButton(root, step, answers) {
  const button = root.querySelector('[data-action="next"]');
  if (button) button.disabled = !isStepValid(step, answers);
}

function syncChoices(root, name) {
  root.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
    input.closest(".choice")?.classList.toggle("is-selected", input.checked);
  });
}

function bindChoice(root, name, field, answers, step, onChange) {
  const inputs = [...root.querySelectorAll(`input[name="${name}"]`)];

  inputs.forEach((input) => {
    input.addEventListener("change", () => {
      answers[field] = input.value;
      onChange?.();
      syncChoices(root, name);
      updateNextButton(root, step, answers);
    });
  });

  syncChoices(root, name);
}

function bindQuestion(root, step, answers, goNext) {
  switch (step) {
    case 1:
      bindChoice(root, "brainstorm-source", "source", answers, step);
      break;

    case 5: {
      const field = answers.source === "pantry" ? "pantry" : "craving";
      const input = root.querySelector('[data-ref="answer"]');

      input?.addEventListener("input", () => {
        answers[field] = input.value;
        updateNextButton(root, step, answers);
      });

      input?.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.isComposing) {
          event.preventDefault();
          goNext();
        }
      });
      break;
    }

    case 2: {
      const chips = [...root.querySelectorAll("[data-restriction]")];
      const otherInput = root.querySelector('[data-ref="restrictionsOther"]');

      const syncChips = () => {
        chips.forEach((chip) => {
          const active = answers.restrictions.includes(chip.dataset.restriction);
          chip.classList.toggle("is-active", active);
          chip.setAttribute("aria-pressed", active ? "true" : "false");
        });
      };

      chips.forEach((chip) => {
        chip.addEventListener("click", () => {
          const value = chip.dataset.restriction;

          if (value === "none") {
            answers.restrictions = answers.restrictions.includes("none") ? [] : ["none"];
            if (answers.restrictions.includes("none")) answers.restrictionsOther = "";
          } else {
            const selected = answers.restrictions.filter((item) => item !== "none");
            const index = selected.indexOf(value);
            if (index >= 0) selected.splice(index, 1);
            else selected.push(value);
            answers.restrictions = selected;
          }

          if (otherInput) otherInput.value = answers.restrictionsOther;
          syncChips();
          updateNextButton(root, step, answers);
        });
      });

      otherInput?.addEventListener("input", () => {
        answers.restrictionsOther = otherInput.value;

        if (answers.restrictionsOther.trim() && answers.restrictions.includes("none")) {
          answers.restrictions = answers.restrictions.filter((item) => item !== "none");
          syncChips();
        }

        updateNextButton(root, step, answers);
      });
      break;
    }

    case 3:
      bindChoice(root, "brainstorm-meal", "mealType", answers, step);
      break;

    case 4:
      bindChoice(root, "brainstorm-time", "maxTime", answers, step);
      break;

    case 6:
      bindChoice(root, "brainstorm-continent", "continent", answers, step, () => {
        answers.country = "";
      });
      break;

    case 7: {
      const select = root.querySelector('[data-ref="country"]');
      select?.addEventListener("change", () => {
        answers.country = select.value;
        updateNextButton(root, step, answers);
      });
      break;
    }
  }
}

/* ------------------------- Prompt and result ---------------------------- */

function recipeLines(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function renderPreview(recipe) {
  const ingredients = recipeLines(recipe.ingredients);
  const steps = recipeLines(recipe.steps);

  return `
    <section class="prompt-preview" aria-live="polite">
      <h2 class="prompt-preview__title">${escapeHtml(t("brainstorm.previewTitle"))}</h2>
      <div>
        <h3 class="brainstorm-result__title">${escapeHtml(recipe.title)}</h3>
        <p class="brainstorm-result__meta">
          ${escapeHtml(recipe.category || t("brainstorm.previewNoCategory"))} ·
          ${escapeHtml(recipe.subcategory || t("brainstorm.previewNoSubcategory"))}
        </p>
      </div>

      <div class="brainstorm-result__section">
        <h3 class="brainstorm-result__heading">${escapeHtml(t("brainstorm.ingredientsLabel"))}</h3>
        <ul class="brainstorm-result__list">
          ${ingredients.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
        </ul>
      </div>

      <div class="brainstorm-result__section">
        <h3 class="brainstorm-result__heading">${escapeHtml(t("brainstorm.stepsLabel"))}</h3>
        <ol class="brainstorm-result__list">
          ${steps.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
        </ol>
      </div>
    </section>
  `;
}

function renderPrompt(root, answers) {
  const prompt = buildChatPrompt(answers, store.getCategories());

  root.innerHTML = `
    <div class="page-header">
      <div>
        <p class="wizard__progress">${escapeHtml(t("brainstorm.promptEyebrow"))}</p>
        <h1 class="page-title" tabindex="-1" data-ref="title">
          ${escapeHtml(t("brainstorm.promptTitle"))}
        </h1>
      </div>
      <button class="icon-button" type="button" data-action="exit"
              aria-label="${escapeHtml(t("common.close"))}">
        ${icon("close")}
      </button>
    </div>

    <section class="brainstorm-card">
      <div class="brainstorm-card__body">
        <p class="brainstorm-card__text">${escapeHtml(t("brainstorm.promptExplain"))}</p>

        <div class="prompt-box">
          <label class="field__label" for="brainstorm-prompt">
            ${escapeHtml(t("brainstorm.promptLabel"))}
          </label>
          <textarea class="textarea prompt-box__text" id="brainstorm-prompt"
            data-ref="prompt" rows="14" readonly>${escapeHtml(prompt)}</textarea>
          <div class="prompt-box__actions">
            <button class="button button--secondary" type="button" data-action="copy">
              ${escapeHtml(t("brainstorm.copyBtn"))}
            </button>
          </div>
        </div>

        <label class="field">
          <span class="field__label">${escapeHtml(t("brainstorm.pasteLabel"))}</span>
          <textarea class="textarea" data-ref="paste" rows="10"
            placeholder="${escapeHtml(t("brainstorm.pastePlaceholder"))}"></textarea>
        </label>

        <p class="form-error" data-ref="error" role="alert" hidden></p>

        <div data-ref="preview">
          <section class="prompt-preview prompt-preview--empty">
            <p class="brainstorm-card__text">${escapeHtml(t("brainstorm.previewEmpty"))}</p>
          </section>
        </div>

        <div class="brainstorm-actions brainstorm-actions--split">
          <button class="button" type="button" data-action="save" disabled>
            ${escapeHtml(t("brainstorm.saveBtn"))}
          </button>
          <div class="brainstorm-actions">
            <button class="button button--secondary" type="button" data-action="change">
              ${escapeHtml(t("brainstorm.changeAnswers"))}
            </button>
            <button class="button button--ghost" type="button" data-action="start-over">
              ${escapeHtml(t("brainstorm.startOverBtn"))}
            </button>
          </div>
        </div>
      </div>
    </section>
  `;

  const paste = root.querySelector('[data-ref="paste"]');
  const preview = root.querySelector('[data-ref="preview"]');
  const error = root.querySelector('[data-ref="error"]');
  const saveButton = root.querySelector('[data-action="save"]');

  const updatePreview = () => {
    const raw = String(paste?.value || "").trim();

    if (!raw) {
      preview.innerHTML = `
        <section class="prompt-preview prompt-preview--empty">
          <p class="brainstorm-card__text">${escapeHtml(t("brainstorm.previewEmpty"))}</p>
        </section>
      `;
      saveButton.disabled = true;
      error.hidden = true;
      return;
    }

    const recipe = parseRecipeText(stripCodeFences(raw));
    const valid = Boolean(recipe.title.trim());

    preview.innerHTML = valid
      ? renderPreview(recipe)
      : `
        <section class="prompt-preview prompt-preview--empty">
          <p class="brainstorm-card__text">${escapeHtml(t("brainstorm.previewEmpty"))}</p>
        </section>
      `;
    saveButton.disabled = !valid;
    error.textContent = t("brainstorm.missingTitle");
    error.hidden = valid;
  };

  paste?.addEventListener("input", updatePreview);

  root.querySelector('[data-action="copy"]')?.addEventListener("click", () => {
    copyPrompt(root);
  });

  saveButton?.addEventListener("click", () => {
    savePromptRecipe(root, answers, saveButton);
  });

  root.querySelector('[data-action="change"]')?.addEventListener("click", () => {
    openWizard(root, answers);
  });

  root.querySelectorAll('[data-action="start-over"], [data-action="exit"]').forEach((button) => {
    button.addEventListener("click", () => {
      renderReady(root);
    });
  });

  window.requestAnimationFrame(() => {
    root.querySelector('[data-ref="title"]')?.focus();
  });
}

async function copyPrompt(root) {
  const textarea = root.querySelector('[data-ref="prompt"]');
  if (!textarea) return;

  try {
    await navigator.clipboard.writeText(textarea.value);
    toast(t("brainstorm.copiedToast"), "success");
  } catch {
    textarea.focus();
    textarea.select();

    try {
      if (document.execCommand("copy")) {
        toast(t("brainstorm.copiedToast"), "success");
        return;
      }
    } catch {
      /* Fall through. */
    }

    toast(t("brainstorm.copyFailedToast"), "error");
  }
}

function ensureCategory(name) {
  const value = String(name || "").trim();
  if (!value) return "";

  const existing = store.getCategories().find((category) => (
    category.toLowerCase() === value.toLowerCase()
  ));
  if (existing) return existing;

  store.addCategory(value);
  return value;
}

function ensureSubcategory(category, name) {
  const value = String(name || "").trim();
  if (!value) return "";

  const existing = store.getSubcategories(category).find((subcategory) => (
    subcategory.toLowerCase() === value.toLowerCase()
  ));
  if (existing) return existing;

  store.addSubcategory(category, value);
  return value;
}

function savePromptRecipe(root, answers, button) {
  if (button?.disabled) return;
  if (button) button.disabled = true;

  const paste = root.querySelector('[data-ref="paste"]');
  const recipe = parseRecipeText(stripCodeFences(paste?.value || ""));

  if (!recipe.title.trim()) {
    if (button) button.disabled = false;
    toast(t("brainstorm.missingTitle"), "error");
    return;
  }

  const category = ensureCategory(recipe.category);
  const subcategory = ensureSubcategory(category, recipe.subcategory);
  const saved = store.addRecipe({
    title: recipe.title,
    category,
    subcategory,
    ingredients: recipe.ingredients,
    steps: recipe.steps
  });

  if (!saved) {
    if (button) button.disabled = false;
    toast(t("brainstorm.saveFailedToast"), "error");
    return;
  }

  toast(t("brainstorm.addedToast"), "success");
  pendingResult = null;
  renderReady(root);
}

function openWizard(root, initialAnswers, initialStep = 1) {
  const answers = createAnswers(initialAnswers);
  let step = initialStep;

  const goNext = () => {
    if (!isStepValid(step, answers) || step >= TOTAL_STEPS) return;
    step += 1;
    paint();
  };

  const goBack = () => {
    if (step === 1) {
      renderReady(root);
      return;
    }
    step -= 1;
    paint();
  };

  function paint() {
    wizardDraft = { step, answers };
    const isSummary = step === TOTAL_STEPS;

    root.innerHTML = `
      <div class="page-header">
        <div>
          <p class="wizard__progress">
            ${escapeHtml(t("brainstorm.stepCounter", { current: step, total: TOTAL_STEPS }))}
          </p>
          <h1 class="page-title" tabindex="-1" data-ref="title">
            ${escapeHtml(stepTitle(step, answers))}
          </h1>
        </div>
        <button class="icon-button" type="button" data-action="exit"
                aria-label="${escapeHtml(t("common.close"))}">
          ${icon("close")}
        </button>
      </div>

      <section class="brainstorm-card">
        <div class="brainstorm-card__body">
          ${renderQuestion(step, answers)}

          <div class="brainstorm-actions brainstorm-actions--split">
            <button class="button button--secondary" type="button" data-action="back">
              ${escapeHtml(t("common.back"))}
            </button>
            ${isSummary
              ? `<button class="button" type="button" data-action="copy-prompt">
                  ${escapeHtml(t("brainstorm.copyPromptBtn"))}
                </button>`
              : `<button class="button" type="button" data-action="next"
                  ${isStepValid(step, answers) ? "" : "disabled"}>
                  ${escapeHtml(t("common.next"))}
                </button>`}
          </div>
        </div>
      </section>
    `;

    root.querySelector('[data-action="exit"]')?.addEventListener("click", () => {
      renderReady(root);
    });

    root.querySelector('[data-action="back"]')?.addEventListener("click", goBack);

    if (isSummary) {
      root.querySelector('[data-action="copy-prompt"]')?.addEventListener("click", () => {
        renderPrompt(root, answers);
      });
    } else {
      root.querySelector('[data-action="next"]')?.addEventListener("click", goNext);
      bindQuestion(root, step, answers, goNext);
    }

    window.requestAnimationFrame(() => {
      const target = step === 5
        ? root.querySelector('[data-ref="answer"]')
        : root.querySelector('[data-ref="title"]');
      target?.focus();
    });
  }

  paint();
}
