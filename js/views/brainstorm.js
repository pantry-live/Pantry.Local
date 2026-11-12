/*
 * Pantry — Brainstorm tab view.
 */

import { getLanguageMeta, t } from "../i18n.js";
import { escapeHtml, icon, openModal, toast } from "../ui.js";
import { openManual } from "../manual.js";
import {
  generateRecipe,
  hasConnection,
  saveConnectionCode
} from "../brainstorm-api.js";
import * as store from "../store.js";

let activeController = null;
let mountedRoot = null;   // the screen Brainstorm is currently drawn on
let pendingResult = null; // { answers, recipe } waiting to be shown

export function render(root) {
  mountedRoot = root;

  if (!hasConnection()) {
    renderIntro(root);
    return;
  }

  if (activeController) {
    renderLoading(root, activeController);
  } else if (pendingResult) {
    renderResult(root, pendingResult.answers, pendingResult.recipe);
  } else {
    renderReady(root);
  }
}

/* ------------------------------- Intro ---------------------------------- */

function renderIntro(root) {
  root.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${escapeHtml(t("brainstorm.title"))}</h1>
      <span class="badge badge--optional">${escapeHtml(t("brainstorm.optionalBadge"))}</span>
    </div>

    <section class="brainstorm-card">
      <div class="brainstorm-card__icon" aria-hidden="true">${icon("bulb")}</div>
      <div class="brainstorm-card__body">
        <h2 class="brainstorm-card__title">${escapeHtml(t("brainstorm.introTitle"))}</h2>
        <p class="brainstorm-card__text">${escapeHtml(t("brainstorm.introText"))}</p>

        <ul class="brainstorm-points">
          <li class="brainstorm-point">
            ${icon("check")}
            <span>${escapeHtml(t("brainstorm.introPointOptional"))}</span>
          </li>
          <li class="brainstorm-point">
            ${icon("check")}
            <span>${escapeHtml(t("brainstorm.introPointPrivacy"))}</span>
          </li>
          <li class="brainstorm-point">
            ${icon("check")}
            <span>${escapeHtml(t("brainstorm.introPointDisconnect"))}</span>
          </li>
        </ul>

        <div class="brainstorm-actions">
          <button class="button" type="button" data-action="setup">
            ${escapeHtml(t("brainstorm.setupBtn"))}
          </button>
          <button class="link-button" type="button" data-action="manual">
            ${escapeHtml(t("brainstorm.howItWorks"))}
          </button>
        </div>
        <p class="brainstorm-note">${escapeHtml(t("brainstorm.setupTime"))}</p>
      </div>
    </section>
  `;

  root.querySelector('[data-action="setup"]')?.addEventListener("click", () => {
    openSetup(root);
  });

  root.querySelector('[data-action="manual"]')?.addEventListener("click", () => {
    openManual("brainstorm");
  });
}

/* ---------------------------- Setup wizard ------------------------------ */

function openSetup(root) {
  const wrapper = document.createElement("div");
  wrapper.className = "brainstorm-setup";

  const modal = openModal({
    title: "",
    body: wrapper,
    actions: []
  });

  modal.modal?.removeAttribute("aria-labelledby");
  modal.modal?.setAttribute("aria-label", t("brainstorm.setupTitle"));

  const totalSteps = 3;
  let step = 1;
  let codeValue = "";

  const showError = (message) => {
    const error = wrapper.querySelector('[data-ref="error"]');
    if (!error) return;
    error.textContent = message;
    error.hidden = false;
  };

  const save = () => {
    const input = wrapper.querySelector('[data-ref="code"]');
    const code = String(input?.value || codeValue || "").trim();

    if (!code) {
      showError(t("brainstorm.setupEmpty"));
      input?.focus();
      return;
    }

    if (!saveConnectionCode(code)) {
      showError(t("common.error"));
      return;
    }

    modal.close();
    toast(t("brainstorm.setupSaved"), "success");
    renderReady(root);
  };

  const next = () => {
    if (step < totalSteps) {
      step += 1;
      renderStep();
      return;
    }
    save();
  };

  const renderStep = () => {
    const isLast = step === totalSteps;
    const titleKey = step === 1
      ? "brainstorm.setupNeedTitle"
      : step === 2
        ? "brainstorm.setupCodeTitle"
        : "brainstorm.setupPasteTitle";

    const content = step === 1
      ? `
        <p class="wizard__text">${escapeHtml(t("brainstorm.setupNeedText"))}</p>
        <ul class="brainstorm-points">
          <li class="brainstorm-point">
            ${icon("check")}
            <span>${escapeHtml(t("brainstorm.setupNeedPointTime"))}</span>
          </li>
          <li class="brainstorm-point">
            ${icon("check")}
            <span>${escapeHtml(t("brainstorm.setupNeedPointLocal"))}</span>
          </li>
        </ul>
      `
      : step === 2
        ? `
          <p class="wizard__text">${escapeHtml(t("brainstorm.setupCodeText"))}</p>
          <a class="button button--secondary" href="https://aistudio.google.com/app/apikey"
             target="_blank" rel="noopener">
            ${escapeHtml(t("brainstorm.setupOpenStudio"))}
          </a>
          <p class="field__hint">${escapeHtml(t("brainstorm.introPointPrivacy"))}</p>
        `
        : `
          <p class="wizard__text">${escapeHtml(t("brainstorm.setupPasteText"))}</p>
          <label class="field">
            <span class="field__label">${escapeHtml(t("brainstorm.setupCodeLabel"))}</span>
            <input class="input" type="password" data-ref="code" autocomplete="off"
                   spellcheck="false" placeholder="${escapeHtml(t("brainstorm.keyPlaceholder"))}"
                   value="${escapeHtml(codeValue)}">
          </label>
          <p class="field__hint">${escapeHtml(t("brainstorm.introPointPrivacy"))}</p>
        `;

    wrapper.innerHTML = `
      <div class="wizard__head">
        <div>
          <p class="wizard__progress">
            ${escapeHtml(t("brainstorm.setupStepCounter", { current: step, total: totalSteps }))}
          </p>
          <h2 class="wizard__title" tabindex="-1" data-ref="title">
            ${escapeHtml(t(titleKey))}
          </h2>
        </div>
        <button class="icon-button" type="button" data-action="close"
                aria-label="${escapeHtml(t("common.close"))}">
          ${icon("close")}
        </button>
      </div>

      ${content}

      <p class="form-error" data-ref="error" role="alert" hidden></p>

      <div class="wizard__actions">
        <button class="button button--secondary" type="button" data-action="back">
          ${escapeHtml(step === 1 ? t("common.cancel") : t("common.back"))}
        </button>
        <button class="button" type="button" data-action="next">
          ${escapeHtml(isLast ? t("brainstorm.connectBtn") : t("common.continue"))}
        </button>
      </div>
    `;

    const input = wrapper.querySelector('[data-ref="code"]');

    if (input) {
      input.addEventListener("input", () => {
        codeValue = input.value;
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          next();
        }
      });
    }

    wrapper.querySelector('[data-action="close"]')?.addEventListener("click", () => {
      modal.close();
    });

    wrapper.querySelector('[data-action="back"]')?.addEventListener("click", () => {
      if (step === 1) {
        modal.close();
        return;
      }
      step -= 1;
      renderStep();
    });

    wrapper.querySelector('[data-action="next"]')?.addEventListener("click", next);

    const focusTarget = input || wrapper.querySelector('[data-ref="title"]');
    window.requestAnimationFrame(() => focusTarget?.focus());
  };

  renderStep();
}

/* ------------------------------- Ready ---------------------------------- */

function renderReady(root) {
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

/* ------------------------- Generation and result ------------------------- */

const GENERATION_ERROR_KEYS = {
  invalidKey: "brainstorm.errorInvalidKey",
  permission: "brainstorm.errorPermission",
  rateLimit: "brainstorm.errorRateLimit",
  modelUnavailable: "brainstorm.errorModelUnavailable",
  request: "brainstorm.errorRequest",
  server: "brainstorm.errorServer",
  network: "brainstorm.errorNetwork",
  malformed: "brainstorm.errorMalformed"
};

function recipeLines(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function renderLoading(root, controller) {
  root.innerHTML = `
    <div class="page-header">
      <div>
        <p class="wizard__progress">${escapeHtml(t("brainstorm.resultEyebrow"))}</p>
        <h1 class="page-title" tabindex="-1" data-ref="title">
          ${escapeHtml(t("brainstorm.generatingTitle"))}
        </h1>
      </div>
      <button class="icon-button" type="button" data-action="exit"
              aria-label="${escapeHtml(t("common.close"))}">
        ${icon("close")}
      </button>
    </div>

    <section class="brainstorm-card brainstorm-loading" role="status" aria-busy="true">
      <div class="spinner" aria-hidden="true"></div>
      <p class="brainstorm-loading__text">${escapeHtml(t("brainstorm.generatingText"))}</p>
    </section>
  `;

  root.querySelector('[data-action="exit"]')?.addEventListener("click", () => {
    controller.abort();
    if (activeController === controller) activeController = null;
    renderReady(root);
  });

  window.requestAnimationFrame(() => {
    root.querySelector('[data-ref="title"]')?.focus();
  });
}

function renderGenerationError(root, answers, error) {
  const messageKey = GENERATION_ERROR_KEYS[error?.code] || "brainstorm.errorServer";

  root.innerHTML = `
    <div class="page-header">
      <div>
        <p class="wizard__progress">${escapeHtml(t("brainstorm.resultEyebrow"))}</p>
        <h1 class="page-title" tabindex="-1" data-ref="title">
          ${escapeHtml(t("brainstorm.errorTitle"))}
        </h1>
      </div>
    </div>

    <section class="brainstorm-card brainstorm-error" role="alert">
      <div class="brainstorm-card__body">
        <h2 class="brainstorm-card__title">${escapeHtml(t("brainstorm.errorTitle"))}</h2>
        <p class="brainstorm-card__text">${escapeHtml(t(messageKey))}</p>

        <div class="brainstorm-actions">
          <button class="button" type="button" data-action="retry">
            ${escapeHtml(t("brainstorm.tryAgain"))}
          </button>
          <button class="button button--secondary" type="button" data-action="change">
            ${escapeHtml(t("brainstorm.changeAnswers"))}
          </button>
        </div>
      </div>
    </section>
  `;

  root.querySelector('[data-action="retry"]')?.addEventListener("click", () => {
    runGeneration(root, answers);
  });

  root.querySelector('[data-action="change"]')?.addEventListener("click", () => {
    openWizard(root, answers);
  });

  window.requestAnimationFrame(() => {
    root.querySelector('[data-ref="title"]')?.focus();
  });
}

function renderResult(root, answers, recipe) {
  const ingredients = recipeLines(recipe.ingredients);
  const steps = recipeLines(recipe.steps);

  root.innerHTML = `
    <div class="page-header">
      <div>
        <p class="wizard__progress">${escapeHtml(t("brainstorm.resultEyebrow"))}</p>
        <h1 class="page-title" tabindex="-1" data-ref="title">
          ${escapeHtml(t("brainstorm.resultTitle"))}
        </h1>
      </div>
      <button class="icon-button" type="button" data-action="reject"
              aria-label="${escapeHtml(t("brainstorm.rejectBtn"))}">
        ${icon("close")}
      </button>
    </div>

    <section class="brainstorm-card brainstorm-result">
      <div class="brainstorm-card__body">
        <div>
          <h2 class="brainstorm-result__title">${escapeHtml(recipe.title)}</h2>
          <p class="brainstorm-result__meta">
            ${escapeHtml(recipe.category)} · ${escapeHtml(recipe.subcategory)}
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

        <div class="brainstorm-actions brainstorm-result__actions">
          <button class="button" type="button" data-action="add">
            ${escapeHtml(t("brainstorm.addBtn"))}
          </button>
          <button class="button button--secondary" type="button" data-action="retry">
            ${escapeHtml(t("brainstorm.retryInputBtn"))}
          </button>
          <button class="button button--ghost" type="button" data-action="reject">
            ${escapeHtml(t("brainstorm.rejectBtn"))}
          </button>
        </div>
      </div>
    </section>
  `;

  root.querySelector('[data-action="add"]')?.addEventListener("click", (event) => {
    addRecipeToPantry(root, recipe, event.currentTarget);
  });

  root.querySelector('[data-action="retry"]')?.addEventListener("click", () => {
    pendingResult = null;
    openWizard(root, answers);
  });

  root.querySelectorAll('[data-action="reject"]').forEach((button) => {
    button.addEventListener("click", () => {
      pendingResult = null;
      renderReady(root);
    });
  });

  window.requestAnimationFrame(() => {
    root.querySelector('[data-ref="title"]')?.focus();
  });
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

function addRecipeToPantry(root, recipe, button) {
  if (button?.disabled) return;
  if (button) button.disabled = true;

  const category = ensureCategory(recipe.category);
  const subcategory = ensureSubcategory(category, recipe.subcategory);
  const saved = store.addRecipe({ ...recipe, category, subcategory });

  if (!saved) {
    if (button) button.disabled = false;
    toast(t("brainstorm.saveFailedToast"), "error");
    return;
  }

  toast(t("brainstorm.addedToast"), "success");
  pendingResult = null;
  renderReady(root);
}

async function runGeneration(root, answers) {
  if (activeController) return;

  const controller = new AbortController();
  activeController = controller;
  renderLoading(root, controller);

  try {
    const recipe = await generateRecipe(answers, store.getCategories(), {
      signal: controller.signal
    });
    if (controller.signal.aborted) return;
    pendingResult = { answers, recipe };
    if (mountedRoot?.isConnected) renderResult(mountedRoot, answers, recipe);
  } catch (error) {
    if (controller.signal.aborted || error?.code === "aborted") return;
    if (mountedRoot?.isConnected) renderGenerationError(mountedRoot, answers, error);
  } finally {
    if (activeController === controller) activeController = null;
  }
}

function openWizard(root, initialAnswers) {
  const answers = createAnswers(initialAnswers);
  let step = 1;

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
              ? `<button class="button" type="button" data-action="generate">
                  ${escapeHtml(t("brainstorm.generateBtn"))}
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
      root.querySelector('[data-action="generate"]')?.addEventListener("click", () => {
        runGeneration(root, answers);
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
