/*
 * Pantry — small DOM helpers shared by all views.
 * No framework, no dependencies.
 */

let scrollLocks = 0;

export function lockScroll() {
  scrollLocks += 1;
  document.body.classList.add("is-locked");
}

export function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) document.body.classList.remove("is-locked");
}

/** Escape any string that will be interpolated into an HTML template. */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

/** Return an inline SVG reference from the sprite in index.html. */
export function icon(name) {
  const safeName = String(name || "").replace(/[^a-z0-9-]/gi, "");
  return `<svg class="icon" aria-hidden="true"><use href="#icon-${safeName}"></use></svg>`;
}

/** Fire-and-forget toast message. */
export function toast(message, type = "", duration = 2800) {
  const root = document.getElementById("toast-root");
  if (!root || !message) return;

  while (root.children.length >= 3) {
    root.firstElementChild?.remove();
  }

  const element = document.createElement("div");
  element.className = `toast${type ? ` toast--${type}` : ""}`.trim();
  element.textContent = message;
  root.append(element);

  window.setTimeout(() => {
    element.style.opacity = "0";
    element.style.transform = "translateY(6px)";
    element.style.transition = "opacity 0.15s ease, transform 0.15s ease";
    window.setTimeout(() => element.remove(), 170);
  }, duration);
}

function getFocusable(root) {
  return Array.from(root.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )).filter((element) => !element.disabled && element.offsetParent !== null);
}

function actionClass(variant) {
  if (!variant || variant === "primary") return "button";
  return `button button--${variant}`;
}

/**
 * Open an accessible modal. `body` can be an HTML string or a DOM Node.
 * Returns handles for the caller, plus a close function.
 */
export function openModal({
  title = "",
  body = "",
  actions = [],
  closable = true,
  className = "",
  onClose
} = {}) {
  const root = document.getElementById("modal-root");
  if (!root) return { close() {}, modal: null, body: null, actions: null };

  const previousFocus = document.activeElement;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";

  const modal = document.createElement("div");
  modal.className = `modal ${className}`.trim();
  modal.tabIndex = -1;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");

  const titleId = `modal-title-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  modal.setAttribute("aria-labelledby", titleId);

  const titleElement = document.createElement("h2");
  titleElement.className = "modal__title";
  titleElement.id = titleId;
  titleElement.textContent = title;
  titleElement.hidden = !title;

  const bodyElement = document.createElement("div");
  bodyElement.className = "modal__body";
  if (body instanceof Node) bodyElement.append(body);
  else bodyElement.innerHTML = body;

  const actionsElement = document.createElement("div");
  actionsElement.className = "modal__actions";

  modal.append(titleElement, bodyElement, actionsElement);
  backdrop.append(modal);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKeydown, true);
    backdrop.remove();
    unlockScroll();
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
    onClose?.();
  };

  const onKeydown = (event) => {
    if (event.key === "Escape" && closable) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = getFocusable(modal);
    if (!focusable.length) {
      event.preventDefault();
      modal.focus();
      return;
    }

    if (!modal.contains(document.activeElement)) {
      event.preventDefault();
      focusable[0].focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  for (const action of actions) {
    if (!action) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = actionClass(action.variant);
    button.textContent = action.label || "";
    if (action.icon) button.insertAdjacentHTML("afterbegin", icon(action.icon));

    button.addEventListener("click", async () => {
      if (button.disabled) return;
      let result;
      try {
        result = action.onClick ? await action.onClick() : undefined;
      } catch (error) {
        console.error(error);
        return;
      }
      if (result !== false) close();
    });

    actionsElement.append(button);
  }

  if (closable) {
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) close();
    });
  }

  document.addEventListener("keydown", onKeydown, true);
  root.append(backdrop);
  lockScroll();

  window.requestAnimationFrame(() => {
    const focusable = getFocusable(modal);
    (focusable[0] || modal).focus();
  });

  return { close, modal, body: bodyElement, actions: actionsElement };
}

/** Promise-based confirmation modal. */
export function confirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  closable = true
}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    openModal({
      title,
      body: `<p>${escapeHtml(message || "")}</p>`,
      closable,
      onClose: () => finish(false),
      actions: [
        {
          label: cancelLabel,
          variant: "secondary",
          onClick: () => finish(false)
        },
        {
          label: confirmLabel,
          variant: danger ? "danger" : "primary",
          onClick: () => finish(true)
        }
      ]
    });
  });
}

/** Simple event delegation. */
export function delegate(root, eventName, selector, handler) {
  root.addEventListener(eventName, (event) => {
    const target = event.target.closest(selector);
    if (!target || !root.contains(target)) return;
    handler(event, target);
  });
}
