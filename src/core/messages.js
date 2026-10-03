// Renders birthday messages from the template pool in config/messages.yaml.
// Picks a random template, expands {vars}, inserts the name, and randomly
// appends an emoji -- so the ~40 messages sent in a day are not byte-identical,
// which matters for avoiding WhatsApp's spam heuristics.

function pick(arr, rng = Math.random) {
  return arr[Math.floor(rng() * arr.length)];
}

/** Expand {varName} placeholders using the vars pool, one level deep. */
function expandVars(template, vars, rng) {
  return template.replace(/\{(\w+)\}/g, (full, key) => {
    if (key === "name") return full; // handled separately
    const pool = vars?.[key];
    if (!pool || pool.length === 0) return "";
    return pick(pool, rng);
  });
}

/**
 * Render a message for a person.
 * @param {import('./roster.js').Person} person
 * @param {boolean} belated
 * @param {object} messagesConfig  parsed config/messages.yaml
 * @param {Function} [rng] injectable for deterministic tests
 */
export function renderMessage(person, belated, messagesConfig, rng = Math.random) {
  if (person.customMessage && person.customMessage.trim()) {
    // Custom messages are used verbatim (with {name} substitution only),
    // since the person explicitly authored them.
    return person.customMessage.replace(/\{name\}/g, displayName(person));
  }

  const pool = belated ? messagesConfig.belated : messagesConfig.onTime;
  const template = pick(pool, rng);
  let text = expandVars(template, messagesConfig.vars, rng);
  text = text.replace(/\{name\}/g, displayName(person));

  const emojiPool = messagesConfig.emoji;
  if (emojiPool && emojiPool.length > 0 && rng() < 0.6 && !/\p{Emoji}/u.test(text.slice(-2))) {
    text = `${text} ${pick(emojiPool, rng)}`;
  }

  return text;
}

// A salutation is a title ("Mr", "Dr", "Sir"), so it goes in front of the first
// name -- "Mr Abhijit". It used to *replace* the name, which produced "Hey Mr,"
// for the common Excel layout of a short title column. A salutation that already
// contains the first name (e.g. "Dr. Sharma") is a full form of address and is
// used as is, so it isn't doubled up.
function displayName(person) {
  const sal = person.salutation?.trim();
  if (!sal) return person.firstName;
  const first = person.firstName?.trim();
  if (!first) return sal;
  const alreadyNamed = sal.toLowerCase().split(/[\s.,]+/).includes(first.toLowerCase());
  return alreadyNamed ? sal : `${sal} ${first}`;
}
