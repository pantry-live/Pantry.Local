# Pantry Local

Pantry Local is a small, static recipe app for GitHub Pages. It has no backend, no build step, and no dependencies. Recipes are stored locally in the browser on the device. There is no account, no tracking, and no automatic network request.

The interface is available in **Dutch, English, and German**. On first start, Pantry detects the browser language, suggests it, and asks the user to confirm. The language can be changed later in Settings. Recipe text is never translated automatically.

## Features

- Local-only storage in the browser.
- Recipe list with search by title or ingredient and category filters.
- Add, edit, and delete recipes.
- Category and subcategory management.
- Import and export of recipes as text files or ZIP archives.
- Serving scaler: every recipe starts at 2 servings and leading ingredient quantities scale live.
- Full-screen cooking mode with tap, keyboard, and optional voice navigation.
- Screen Wake Lock while a recipe is open (when supported).
- Automatic light and dark theme.
- Brainstorm: answer a few questions, copy a ready-made prompt into the AI chat of your choice, then paste the returned recipe back to preview and save it.
- Shopping tab: a translated placeholder for now.

## Requirements

- A modern browser with ES module support: current Chrome, Edge, Safari, or Firefox.
- The app served over HTTP(S). Opening `index.html` directly from disk will not work because ES modules require an origin.

Brainstorm works with any AI chat that accepts a text prompt. Pantry Local itself makes no network request.

Voice recognition works in most Chromium browsers and Safari, but not Firefox. Wake Lock support varies by browser. Both features fail gracefully.

## Run locally

From this folder:

```sh
python3 -m http.server 8001
```

Open <http://localhost:8001>.

## Deploy to GitHub Pages

1. Create a standalone repository for this folder.
2. Commit and push the files, including `.nojekyll`.
3. In the repository, open **Settings → Pages**.
4. Deploy from the `main` branch and the repository root.
5. Open the Pages URL.

No build or CI step is needed.

## How data is stored

Recipes, categories, and settings are stored in `localStorage` under the key `pantry.local.v1`. Nothing is sent to a server. The app works without an account.

### Data shape

```json
{
  "version": 1,
  "recipes": [
    {
      "id": "uuid",
      "title": "Pasta sauce",
      "category": "Dinner",
      "subcategory": "Pasta",
      "ingredients": "2 onions\n1 can of tomatoes",
      "steps": "Chop the onion.\nSimmer everything.",
      "baseServings": 2,
      "createdAt": "2026-01-01T12:00:00.000Z",
      "updatedAt": "2026-01-01T12:00:00.000Z"
    }
  ],
  "categories": ["Breakfast", "Lunch", "Dinner", "Snack", "Dessert", "Drinks"],
  "subcategories": { "Dinner": ["Pasta"] },
  "settings": {
    "language": "en",
    "languageConfirmed": true,
    "welcomeSeen": true,
    "tutorialSeen": true
  },
  "updatedAt": "2026-01-01T12:00:00.000Z"
}
```

Recipes are text only: title, category, subcategory, ingredients, and steps. There are no photos.

## How the app works

- **Loading:** Pantry reads the local data from the browser. A missing or unreadable store starts a fresh recipe book with default categories.
- **Saving:** Changes are saved with a short debounce. Storage failures keep the in-memory state usable and show an error.
- **Servings:** `baseServings` is always 2. The ingredient scaler changes a quantity only when it appears at the start of an ingredient line. It supports whole numbers, decimals, fractions, mixed fractions, unicode fractions, and simple ranges.
- **Cooking mode:** Shows ingredients first, then steps. Tap the stage or use the Next button. Arrow keys work too. Voice recognition starts only when the microphone button is tapped. English commands: “next”, “continue”, “forward”, “done”. Dutch commands: “volgende”, “verder”, “ga door”, “klaar”.
- **Brainstorm:** Answer seven questions (starting point, restrictions, meal type, maximum time, ingredients or craving, continent, and country). Pantry builds a prompt that asks for a 2-serving recipe in its own plain-text format. Copy the prompt into your AI chat, ask for the recipe, paste the reply back, review the preview, and save it. You can paste the reply with or without a code fence.
- **Language:** Dutch, English, and German strings live in `js/i18n.js`. Default categories swap with the interface language if they have not been customised.

## Plain-text recipe format

Pasted replies use the same layout as import and export:

```text
Title: ...
Category: ...
Subcategory: ...
Tags:

Ingredients:
...

Steps:
...
```

One ingredient or step per line. A recipe without a title cannot be saved.

## File overview

```text
.
├── .nojekyll
├── README.md
├── index.html                 # static shell, splash screen, icon sprite
├── css/
│   └── styles.css             # design tokens, themes, layout, components
└── js/
    ├── app.js                 # bootstrap, navigation, shared chrome
    ├── brainstorm-prompt.js   # builds the copy-prompt text for AI chats
    ├── manual.js              # user manual, opened from Settings
    ├── exchange.js            # recipe text format and export
    ├── i18n.js                # Dutch/English/German strings and language helpers
    ├── importer.js            # import and parsing of recipe text files and ZIP archives
    ├── keywords.js            # keywords for sorting imported recipes
    ├── onboarding.js          # language confirmation, welcome, tutorial
    ├── recipe.js              # ingredient scaling and search helpers
    ├── speech.js              # Web Speech API wrapper
    ├── store.js               # state and local persistence
    ├── ui.js                  # modal, toast, icons, escaping helpers
    ├── unzip.js               # minimal ZIP reader
    ├── wakelock.js            # Screen Wake Lock helper
    ├── zip.js                 # minimal ZIP writer
    └── views/
        ├── cooking.js         # recipe list, detail, form, categories, cooking mode
        ├── shopping.js        # placeholder
        ├── brainstorm.js      # questions, prompt copy, paste, preview, save
        └── settings.js        # export, import, language, manual, tutorial, delete data
```

## Privacy and security

- No backend, analytics, ads, or tracking by Pantry.
- Recipes, categories, and settings stay on the device, in the browser.
- Brainstorm does not call any AI service itself. The app only builds a prompt and parses the reply you paste. If you paste the prompt into an external AI chat, that service handles the request under its own terms.
- Nothing from Brainstorm is stored except the recipe you choose to save.

## Limitations

- Shopping is a placeholder; it is not implemented yet.
- Brainstorm recipes come from the AI chat you use. Check ingredients and steps before cooking.
- No recipe images, sharing, or multi-user collaboration.
- No automatic language translation of recipe content.
- Data is tied to the browser and device. Clearing browser storage removes it, so make a backup from Settings.
- Voice and Wake Lock depend on browser support.
- Bulk selection for delete, export, and edit is future work.

## Troubleshooting

- **Changes not saving:** browser storage may be unavailable or full. Check the browser settings and try again.
- **Recipes missing:** browser storage may have been cleared. Restore a backup via Settings.
- **No microphone:** voice recognition is not supported in this browser or microphone access was denied.
- **Brainstorm save does nothing:** the pasted reply must include a `Title:` line and the `Ingredients:` and `Steps:` sections. Check the preview before saving.
- **Screen turns off:** Wake Lock is not supported in this browser, or the page is not visible.
