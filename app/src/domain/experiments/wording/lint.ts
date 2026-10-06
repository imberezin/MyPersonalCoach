/**
 * The ONE set of word lists for the new code (First Week build): the AI wording validator reads them,
 * and so does the copy test of the catalogs (`firstWeek.messages.test.ts`), so the two cannot drift.
 *
 * All lists are lowercase and in the form the validator compares (Hebrew without niqqud, one ASCII
 * apostrophe). An entry with a space is a phrase: its words must appear next to each other. Lists are
 * deliberately short starter lists; each is a second line of defence behind `overlap` and
 * `new_tokens`, and any of them can grow without touching the rest.
 */

export interface LocaleLists<T> {
  readonly he: readonly T[];
  readonly en: readonly T[];
}

/**
 * Words that must never appear in product copy (shame, compensation, calories, scores, counting days).
 * Matched as substrings of the lowercase text, like the catalog-wide test in
 * `src/domain/interventions/library.test.ts`, whose inline list is a subset of this one (pinned by `lint.test.ts`).
 * `src/i18n/messages/copyLint.messages.test.ts` applies the whole list to every text of both catalogs.
 */
export const COPY_LINT_WORDS: LocaleLists<string> = {
  he: [
    "נכשל",
    "הרסת",
    "מתחילים מחדש",
    "להתחיל מחדש",
    "פיצוי",
    "קלוריות",
    "לשרוף",
    "החמצת",
    "פספסת",
    "ציון",
    "אחוז",
    "רצף",
    "חרגת",
    "לא דיווחת",
    "סיימת בהצלחה",
    "מתוך",
  ],
  en: [
    "failed",
    "ruined",
    "start over",
    "compensat",
    "calorie",
    "burn",
    "missed",
    "score",
    "percent",
    "streak",
    "overdue",
    "behind",
    "you didn't",
    "completed successfully",
    "of 15",
    "remaining",
  ],
};

/** Foods and drinks. A reworded experiment may name one only if the approved sentence already does. */
export const FOOD_WORDS: LocaleLists<string> = {
  he: [
    "לחם", "פיתה", "חלה", "לחמניה", "חלב", "גבינה", "גבינות", "ביצה", "ביצים", "חביתה", "שוקולד", "ממתק", "ממתקים", "סוכריה",
    "סוכר", "עוגה", "עוגות", "עוגיה", "עוגיות", "חטיף", "חטיפים", "גלידה", "פיצה", "המבורגר", "פסטה", "אורז", "תפוח", "בננה",
    "פרי", "פירות", "ירק", "ירקות", "סלט", "מרק", "בשר", "עוף", "שניצל", "דג", "דגים", "טונה", "חומוס", "טחינה", "שקדים",
    "אגוזים", "בוטנים", "יוגורט", "קפה", "תה", "מים", "מיץ", "קולה", "שתייה", "שתיה", "משקה", "משקאות", "יין", "בירה",
    "אלכוהול", "קרקר", "קרקרים", "פופקורן", "אוכל", "מזון", "נשנוש", "נשנושים", "לנשנש", "דייסה", "קורנפלקס", "דגנים", "כריך", "כריכים", "צ'יפס",
  ],
  en: [
    "bread", "toast", "bagel", "milk", "cheese", "egg", "eggs", "omelette", "chocolate", "candy", "sweets", "sugar", "cake",
    "cookie", "cookies", "biscuit", "biscuits", "snack", "snacks", "snacking", "chips", "crisps", "fries", "ice cream",
    "icecream", "dessert", "pizza", "burger", "hamburger", "pasta", "rice", "noodles", "apple", "banana", "fruit", "fruits",
    "vegetable", "vegetables", "veggies", "salad", "soup", "meat", "chicken", "fish", "tuna", "hummus", "tahini", "nuts",
    "peanuts", "almonds", "yogurt", "yoghurt", "cereal", "oats", "porridge", "sandwich", "coffee", "tea", "water", "juice",
    "cola", "soda", "drink", "drinks", "beverage", "wine", "beer", "alcohol", "cracker", "crackers", "popcorn", "food", "foods", "junk", "treat", "treats",
  ],
};

/** Words and phrases that turn a sentence into an instruction or a duty. The approved sentence's own advice words stay allowed. */
export const ADVICE_MARKERS: LocaleLists<string> = {
  he: [
    "צריך", "צריכה", "צריכים", "צריכות", "חייב", "חייבת", "חייבים", "חייבות", "כדאי", "אסור", "אסורה", "תימנע", "תימנעי",
    "הימנע", "הימנעי", "תפסיק", "תפסיקי", "הפסק", "הפסיקי", "פחות", "מומלץ", "עדיף", "חובה", "רצוי", "תפחית", "הפחת",
    // Restriction and weight talk: an experiment names an action, never a diet and never a weight (the weight goal is
    // voiced only, and indirectly, on the summary page).
    "דלג", "תדלג", "צום", "דיאטה", "שקול", "תשקול", "לרזות", "משקל", "תרד", "ירידה במשקל",
  ],
  en: [
    "should", "shouldn't", "must", "mustn't", "need to", "needs to", "have to", "has to", "avoid", "less", "stop", "ought to",
    "better to", "better if", "recommend", "recommended", "make sure", "cut down", "cut back", "reduce", "limit", "restrict",
    "skip", "fast", "fasting", "diet", "fewer", "cut", "weigh", "burn off", "weight", "lose weight", "slim",
  ],
};

/** Number words. A reworded experiment may use one only if the approved sentence already does. */
export const NUMBER_WORDS: LocaleLists<string> = {
  he: [
    "אחד", "אחת", "שני", "שניים", "שנים", "שתי", "שתיים", "שלוש", "שלושה", "ארבע", "ארבעה", "חמש", "חמישה", "שש", "שישה",
    "שבע", "שבעה", "שמונה", "תשע", "תשעה", "עשר", "עשרה", "עשרים", "שלושים", "מאה", "אלף", "חצי", "רבע", "זוג", "פעמיים",
    "כפול", "כפולה", "ארבעים", "חמישים", "שישים", "שבעים", "שמונים", "תשעים", "מאתיים", "ארבעת", "חמשת", "שלושת", "עשרת",
  ],
  en: [
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "twenty", "thirty",
    "forty", "fifty", "hundred", "thousand", "half", "quarter", "twice", "double", "triple", "couple", "dozen", "thirteen",
    "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "sixty", "seventy", "eighty", "ninety",
  ],
};

/**
 * Quantity words with no digit in them ("a few minutes", "כמה דקות"). The approved sentence may carry no number at all
 * and still fix a quantity, so the validator compares the SET of these words between the candidate and the approved
 * sentence: "a few minutes" may become neither "a minute" (the "few" is dropped) nor "many minutes".
 */
export const QUANTIFIERS: LocaleLists<string> = {
  he: ["כמה", "מעט", "קצת", "הרבה", "מספר"],
  en: ["few", "several", "many", "couple", "a bit", "a little"],
};

/**
 * Units of time, by canonical name. The validator compares the SET of canonical units of the candidate with the
 * approved sentence's: a unit may be neither added nor dropped ("10 seconds" must stay "10 seconds").
 */
export const UNIT_WORDS: { readonly he: Readonly<Record<string, readonly string[]>>; readonly en: Readonly<Record<string, readonly string[]>> } = {
  he: {
    second: ["שנייה", "שניה", "שניות"],
    minute: ["דקה", "דקות"],
    hour: ["שעה", "שעות"],
    day: ["יום", "ימים"],
    week: ["שבוע", "שבועות"],
    month: ["חודש", "חודשים"],
  },
  en: {
    second: ["second", "seconds", "sec", "secs"],
    minute: ["minute", "minutes", "min", "mins"],
    hour: ["hour", "hours", "hr", "hrs"],
    day: ["day", "days"],
    week: ["week", "weeks"],
    month: ["month", "months"],
  },
};

/** Verdict words: the experiment describes an action and never judges the hour, the food or the person. Absolute (no exception for the approved text). */
export const JUDGMENT_WORDS: LocaleLists<string> = {
  he: [
    "מאוחר מדי", "מוקדם מדי", "יותר מדי", "מדי", "לא בריא", "לא בריאה", "בריא", "בריאה", "לא טוב", "גרוע", "רע", "אשם", "אשמה",
    "בושה", "טעות", "שגוי", "עצלן", "חטא", "בעיה", "בעייתי",
  ],
  en: [
    "too late", "too much", "too many", "too little", "too early", "bad", "unhealthy", "healthy", "junk", "wrong", "mistake",
    "guilty", "guilt", "shame", "lazy", "sin", "problem", "problematic",
  ],
};

/**
 * The CLOSED negator lists. A negator changes what an action IS ("without a screen" vs "with a screen"), so
 * the set found in the candidate must equal the set found in the approved sentence, and each one must still apply to
 * the same object. Tokens are matched whole, after dropping a leading ו and/or ש ("ובלי" is read as "בלי", "שאין" as
 * "אין"); any English "...n't" contraction counts as well (`NEGATIVE_CONTRACTION`).
 */
export const NEGATORS: LocaleLists<string> = {
  he: ["בלי", "אל", "לא", "אין", "ללא", "שלא", "אינו", "אינה", "אינך", "איני", "איננו", "אינם", "אינן", "בלא", "מבלי", "לבלי"],
  en: ["without", "no", "not", "don't", "never", "avoid", "cannot", "nothing", "none", "nobody", "neither", "nor"],
};

/** English contractions of "not" (can't, won't, isn't, ...) are negators too, whatever the verb. */
export const NEGATIVE_CONTRACTION = /n't$/;

/** The words of `COPY_LINT_WORDS` found in `text` (substring match on the lowercase text). Empty when the text is clean. */
export function copyLintHits(text: string, locale: "he" | "en"): string[] {
  const lower = text.toLowerCase();
  return COPY_LINT_WORDS[locale].filter((word) => lower.includes(word.toLowerCase()));
}
