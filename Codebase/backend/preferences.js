/**
 * Preference memory.
 *
 * Turns a business's recently published / approved posts into a compact
 * "match my style" block injected into generation. This is how Mark adapts to
 * each owner's taste over time — WITHOUT retraining any model. Pure retrieval +
 * prompting, keyless-safe (an empty history just yields no block).
 *
 * The strongest signal of what an owner wants is what they actually publish, so
 * every endorsed post becomes a positive few-shot example.
 */

const trim = (s, n = 280) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * Build the preference block from recent endorsed examples.
 * @param {Array<{text:string, platform?:string}>|string[]} examples
 * @returns {string} prompt block, or '' when there is nothing learned yet.
 */
function preferenceDigest(examples) {
  const list = (Array.isArray(examples) ? examples : [])
    .map((e) => (typeof e === 'string' ? { text: e } : e))
    .filter((e) => e && e.text && String(e.text).trim());
  if (!list.length) return '';

  const lines = list.slice(0, 3).map((e) => {
    const plat = e.platform ? ` (${e.platform})` : '';
    return `— ${trim(e.text)}${plat}`;
  });

  return (
    'WHAT THIS OWNER ACTUALLY PUBLISHES — real posts they approved. Match their ' +
    'voice, length, emoji density, language mix, and formatting; lean toward what ' +
    'they clearly prefer. Learn from them, do NOT copy them verbatim:\n' +
    lines.join('\n')
  );
}

module.exports = { preferenceDigest };
