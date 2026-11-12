/*
 * Pantry — shared user manual modal.
 */

import { getManual, t } from "./i18n.js";
import { escapeHtml, icon, openModal } from "./ui.js";

export function openManual(sectionId = "") {
  const wrapper = document.createElement("div");
  wrapper.className = "manual";
  wrapper.innerHTML = `
    <div class="manual__bar">
      <h2 class="manual__title">${escapeHtml(t("manual.title"))}</h2>
      <button class="icon-button" type="button" data-manual-close
              aria-label="${escapeHtml(t("common.close"))}">
        ${icon("close")}
      </button>
    </div>
    ${getManual().map((section) => `
      <section class="manual__section" data-manual-section="${escapeHtml(section.id)}">
        <h2>${escapeHtml(t(section.title))}</h2>
        <p>${escapeHtml(t(section.body))}</p>
      </section>
    `).join("")}
    <p class="manual__meta">${escapeHtml(t("manual.version"))}</p>
  `;

  const modal = openModal({
    title: "",
    body: wrapper,
    actions: []
  });

  modal.modal?.removeAttribute("aria-labelledby");
  modal.modal?.setAttribute("aria-label", t("manual.title"));

  wrapper.querySelector("[data-manual-close]")
    .addEventListener("click", () => modal.close());

  if (sectionId) {
    window.requestAnimationFrame(() => {
      wrapper.querySelector(`[data-manual-section="${sectionId}"]`)
        ?.scrollIntoView({ block: "start" });
    });
  }

  return modal;
}
