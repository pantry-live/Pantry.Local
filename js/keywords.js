/*
 * Pantry — keywords used to sort imported recipes.
 *
 * "category" is the English default name. It maps to the same position in the
 * default list for the current language, so Dinner becomes Diner in Dutch.
 * Keywords are matched as whole words, case-insensitive, in the title (weight 3),
 * the Tags line (weight 2), and the ingredients (weight 1). The best match wins.
 * Edit these lists to fit your own recipes.
 */

export const KEYWORD_RULES = [
  {
    category: "Breakfast",
    keywords: ["breakfast", "ontbijt", "frühstück", "pancake", "pancakes", "pfannkuchen",
      "porridge", "oatmeal", "haferbrei", "muesli", "müsli", "granola", "toast",
      "omelette", "omelet", "omelett", "waffle", "waffel", "yogurt", "joghurt"],
    subcategories: [
      { name: "Sweet", keywords: ["pancake", "pancakes", "pfannkuchen", "waffle", "waffel",
        "granola", "muesli", "müsli", "syrup", "sirup"] }
    ]
  },
  {
    category: "Lunch",
    keywords: ["lunch", "mittagessen", "sandwich", "wrap", "salad", "salat", "soup", "suppe",
      "soep", "quesadilla", "bowl"],
    subcategories: [
      { name: "Soup", keywords: ["soup", "soep", "suppe", "broth", "brühe"] },
      { name: "Salad", keywords: ["salad", "salade", "salat"] }
    ]
  },
  {
    category: "Dinner",
    keywords: ["dinner", "diner", "abendessen", "curry", "pasta", "lasagne", "stew", "eintopf",
      "risotto", "roast", "braten", "casserole", "auflauf", "chili", "stir-fry", "bolognese",
      "lentil", "linzen", "linsen", "rice", "rijst", "reis"],
    subcategories: [
      { name: "Pasta", keywords: ["pasta", "spaghetti", "penne", "lasagne", "bolognese",
        "noodles", "nudeln"] },
      { name: "Curry", keywords: ["curry", "masala", "tikka", "korma"] },
      { name: "Soup", keywords: ["soup", "soep", "suppe", "broth", "brühe"] }
    ]
  }
];