/*
 * Pantry — Web Speech API wrapper for cooking mode.
 *
 * Recognition is started only by an explicit microphone tap. If the browser
 * stops recognition after a pause, the controller restarts it while the user
 * still wants voice control. Voice commands only move forward.
 */

const SpeechRecognition = typeof window !== "undefined"
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

export function isSpeechSupported() {
  return Boolean(SpeechRecognition);
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function transcriptMatches(transcript, commands) {
  const text = normalize(transcript);
  if (!text) return false;

  return commands.some((command) => {
    const value = normalize(command);
    if (!value) return false;
    return text === value
      || text.startsWith(`${value} `)
      || text.endsWith(` ${value}`)
      || text.includes(` ${value} `);
  });
}

/**
 * Create a speech controller. Returns a harmless no-op controller when the
 * browser has no Web Speech API.
 */
export function createSpeechController({
  lang = "nl-NL",
  commands = [],
  onCommand,
  onStateChange,
  onError
} = {}) {
  if (!SpeechRecognition) {
    return {
      supported: false,
      start() {},
      stop() {},
      isListening: () => false
    };
  }

  let recognition = null;
  let listening = false;
  let shouldRestart = false;
  let stoppedByUser = false;
  let restartTimer = null;
  let cooldownUntil = 0;

  const notify = (state) => {
    try {
      onStateChange?.(state);
    } catch (error) {
      console.error(error);
    }
  };

  const build = () => {
    const instance = new SpeechRecognition();
    instance.lang = lang;
    instance.continuous = true;
    instance.interimResults = true;
    instance.maxAlternatives = 1;

    instance.onstart = () => {
      listening = true;
      notify("listening");
    };

    instance.onresult = (event) => {
      if (Date.now() < cooldownUntil) return;

      let transcript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index]?.[0]?.transcript || "";
      }

      if (transcriptMatches(transcript, commands)) {
        cooldownUntil = Date.now() + 900;
        try {
          onCommand?.();
        } catch (error) {
          console.error(error);
        }
      }
    };

    instance.onerror = (event) => {
      const error = event?.error || "speech_error";
      if (error === "no-speech" || error === "aborted") return;

      shouldRestart = false;
      stoppedByUser = true;
      listening = false;
      notify("error");
      try {
        onError?.(error);
      } catch (callbackError) {
        console.error(callbackError);
      }
    };

    instance.onend = () => {
      listening = false;
      notify("stopped");

      if (shouldRestart && !stoppedByUser) {
        window.clearTimeout(restartTimer);
        restartTimer = window.setTimeout(() => {
          if (shouldRestart && !stoppedByUser && recognition) {
            try {
              recognition.start();
            } catch {
              /* InvalidStateError: recognition is already running. */
            }
          }
        }, 350);
      }
    };

    return instance;
  };

  return {
    supported: true,

    start() {
      if (listening) return;
      stoppedByUser = false;
      shouldRestart = true;
      if (!recognition) recognition = build();
      try {
        recognition.start();
      } catch {
        /* InvalidStateError: already started. */
      }
    },

    stop() {
      shouldRestart = false;
      stoppedByUser = true;
      window.clearTimeout(restartTimer);
      restartTimer = null;
      if (recognition) {
        try {
          recognition.abort();
        } catch {
          /* Ignore. */
        }
      }
      listening = false;
      notify("stopped");
    },

    isListening() {
      return listening;
    }
  };
}
