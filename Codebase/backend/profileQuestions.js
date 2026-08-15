// Deferred onboarding questions.
//
// Signup asks only what is needed to build a dashboard (name, category,
// location, description, audience, channels). Everything else is asked later,
// where it costs the owner nothing to abandon: the profile panel and Markiv.
//
// A question set is two halves:
//   FIXED  — the same handful for every business, because every business needs
//            them (tone, slogan, signature items, hours, prices, where to send
//            people). These route into REAL columns / brandBrief.businessFacts,
//            not a side table, so answering one immediately changes what the
//            content pipeline writes.
//   AI     — 2-5 written by Gemini for THIS business specifically. Keyless or on
//            any failure we substitute a deterministic category-aware set, per
//            the project rule that a blank credential degrades the answer and
//            never the app.
//
// Nothing here is required. An unanswered question is a prompt, never a gate —
// the badge counts what is missing and the owner can ignore it forever.

const gemini = require('./gemini');

// The tone vocabulary the rest of the app already speaks (OnboardingPathB's
// TONE_KEYS, brand.js's default). Kept as a closed list so brand_tone stays a
// value the slogan/logo/content prompts recognise.
const TONE_OPTIONS = [
  'Cozy & Warm',
  'Modern & Minimalist',
  'Energetic & Fast-paced',
  'Professional & Trustworthy',
  'Playful & Fun',
  'Luxury & Premium',
];

/**
 * The fixed set, in ask order — most useful to the content pipeline first.
 *
 * `target` is where an answer actually lands:
 *   {kind:'profile', column} -> a profiles column
 *   {kind:'facts',   field}  -> brandBrief.businessFacts, the only source of
 *                               real numbers briefDigest will let a model use
 * `list: true` splits a comma-separated answer into an array (businessFacts
 * .signatureItems is read as an array by brand.briefDigest).
 */
// The languages a post can be written in. Order is meaningful and preserved
// exactly as the owner picks it — a Tashkent business often wants Uzbek first,
// then Russian — which is the same contract gemini.normalizeLanguages honours.
const AUDIENCE_LANGUAGES = ['uz', 'ru', 'en'];

const FIXED = [
  {
    key: 'audienceLanguages',
    type: 'multiselect',
    options: AUDIENCE_LANGUAGES,
    label: 'Which languages do your customers read?',
    hint: 'Every caption, script and on-screen line is written in these, in the order you pick them.',
    placeholder: '',
    target: { kind: 'profile', column: 'audienceLanguages' },
  },
  {
    key: 'brandTone',
    type: 'select',
    options: TONE_OPTIONS,
    label: 'How should your brand sound?',
    hint: 'Sets the voice of every caption Markivo writes for you.',
    placeholder: '',
    target: { kind: 'profile', column: 'brandTone' },
  },
  {
    key: 'signatureItems',
    type: 'text',
    list: true,
    label: 'What do regulars ask for by name?',
    hint: 'Your signature items give posts something specific to show.',
    placeholder: 'e.g. honey cake, filter coffee',
    target: { kind: 'facts', field: 'signatureItems' },
  },
  {
    key: 'hours',
    type: 'text',
    label: 'When are you open?',
    hint: 'So posts never send someone to a closed door.',
    placeholder: 'e.g. Mon-Sat 9:00-21:00, Sun closed',
    target: { kind: 'facts', field: 'hours' },
  },
  {
    key: 'pricePoints',
    type: 'text',
    label: 'What does a typical order or visit cost?',
    hint: 'Without this Markivo has to write around price — and never invents one.',
    placeholder: 'e.g. coffee 25k, breakfast set 60k',
    target: { kind: 'facts', field: 'pricePoints' },
  },
  {
    key: 'bookingLink',
    type: 'text',
    label: 'Where should a post send people to book or order?',
    hint: 'Becomes the call to action at the end of your captions.',
    placeholder: 'e.g. t.me/yourshop, a website link, or your phone number',
    target: { kind: 'facts', field: 'bookingLink' },
  },
  {
    key: 'slogan',
    type: 'text',
    label: 'Do you already have a slogan?',
    hint: 'If you have one we use yours instead of writing a new one.',
    placeholder: 'e.g. Simplicity, refined.',
    target: { kind: 'profile', column: 'slogan' },
  },
];

const FIXED_KEYS = new Set(FIXED.map((q) => q.key));

// Keys the model must never re-ask, in every spelling it might reach for. Used
// by the sanitizer, so a question that slips past the prompt's HARD RULES is
// still dropped before the owner sees it.
const RESERVED_KEYS = new Set([
  ...FIXED.map((q) => q.key.toLowerCase()),
  'brand_tone', 'tone', 'voice',
  'audience_languages', 'languages', 'language',
  'signature_items', 'signature_item',
  'price_points', 'prices', 'price',
  'booking_link', 'booking', 'link',
  'business_name', 'businessname', 'name',
  'category', 'location', 'address', 'city',
  'description', 'about',
  'target_audience', 'targetaudience', 'audience',
  'hours', 'opening_hours', 'slogan', 'tagline',
]);

// --- keyless fallback -------------------------------------------------------
//
// Category-aware, not personalised — these are the questions that are worth
// asking of ANY business in the category. They are deliberately plainer than
// the live ones; the owner is told which set they are looking at via `source`,
// so a template question never poses as a researched one.

const FALLBACK_SETS = [
  {
    match: /caf|coffee|tea\b|bakery/i,
    questions: [
      { key: 'busiest_hours', label: 'When is the place busiest, and when is it quiet?', hint: 'We schedule posts into the quiet hours you want to fill.', placeholder: 'e.g. packed 8-10am, quiet after 3pm' },
      { key: 'seating_setup', label: 'What is the room like to sit in?', hint: 'The detail that makes a photo caption specific to you.', placeholder: 'e.g. 6 tables, a long window bar, power at every seat' },
      { key: 'beans_or_supplier', label: 'Where do your beans or ingredients come from?', hint: 'Sourcing is a story competitors cannot copy.', placeholder: 'e.g. roasted locally, Ethiopian single origin' },
    ],
  },
  {
    match: /beauty|salon|spa|barber|nail|hair/i,
    questions: [
      { key: 'top_service', label: 'Which service do you most want to be booked for?', hint: 'We push this one instead of spreading posts thin.', placeholder: 'e.g. balayage colouring' },
      { key: 'appointment_length', label: 'How long does a typical appointment take?', hint: 'Lets posts set the right expectation before someone books.', placeholder: 'e.g. 90 minutes for colour, 30 for a trim' },
      { key: 'master_names', label: 'Who are the masters clients ask for by name?', hint: 'Named people outperform anonymous salon photos.', placeholder: 'e.g. Dilnoza (colour), Aziz (barber)' },
    ],
  },
  {
    match: /co-?work|study|office space/i,
    questions: [
      { key: 'membership_options', label: 'How can someone use the space — by hour, day, or month?', hint: 'The first thing a prospective member wants to know.', placeholder: 'e.g. hourly, day pass, monthly desk' },
      { key: 'quiet_rules', label: 'What are the rules on noise, calls, and meeting rooms?', hint: 'Answers the objection that stops people booking.', placeholder: 'e.g. calls only in booths, 2 meeting rooms' },
      { key: 'amenities', label: 'What is included that people actually notice?', hint: 'Concrete amenities beat "great atmosphere".', placeholder: 'e.g. 200 Mbps, free coffee, printer, lockers' },
    ],
  },
  {
    match: /retail|boutique|fashion|shop|store|clothing/i,
    questions: [
      { key: 'restock_rhythm', label: 'How often does new stock arrive?', hint: 'New arrivals are the easiest recurring post you have.', placeholder: 'e.g. a new drop every second Friday' },
      { key: 'size_range', label: 'What sizes or variants do you carry?', hint: 'Stops us writing a post that disappoints a buyer.', placeholder: 'e.g. XS-XXL, shoes 36-42' },
      { key: 'return_policy', label: 'What is your exchange or return policy?', hint: 'Removes the hesitation before a first purchase.', placeholder: 'e.g. exchange within 7 days with the receipt' },
    ],
  },
  {
    match: /restaurant|food|kitchen|pizza|burger|dining/i,
    questions: [
      { key: 'signature_dish_story', label: 'Which dish would you want a first-time guest to order?', hint: 'One dish, repeated, is what makes a place recognisable.', placeholder: 'e.g. the lamb plov, cooked to order' },
      { key: 'delivery_setup', label: 'How do people order for delivery or pickup, if you offer it?', hint: 'We only mention delivery if you actually do it.', placeholder: 'e.g. Telegram orders, pickup only after 21:00' },
      { key: 'group_capacity', label: 'Can you take groups or events, and how large?', hint: 'Group bookings are the highest-value post you can run.', placeholder: 'e.g. up to 20 people with a day of notice' },
    ],
  },
  {
    match: /tech|agency|software|it\b|studio|marketing|consult/i,
    questions: [
      { key: 'core_service', label: 'What kind of project do you want more of?', hint: 'Aims every post at the work you actually want.', placeholder: 'e.g. mobile apps for local retailers' },
      { key: 'project_timeline', label: 'How long does a typical engagement run?', hint: 'Sets expectations before the first call.', placeholder: 'e.g. 6-8 weeks from brief to launch' },
      { key: 'proof_point', label: 'What result can you point to from past work?', hint: 'A concrete outcome is the only proof that travels.', placeholder: 'e.g. cut a client checkout from 5 steps to 2' },
    ],
  },
];

const FALLBACK_DEFAULT = [
  { key: 'best_seller', label: 'What do customers come back for most often?', hint: 'The one thing worth repeating across your posts.', placeholder: 'e.g. our morning set' },
  { key: 'how_to_buy', label: 'How does a customer actually buy from you?', hint: 'Becomes the call to action on every post.', placeholder: 'e.g. walk in, or message us on Telegram' },
  { key: 'one_difference', label: 'What do you do that nearby businesses do not?', hint: 'Without this, posts default to generic praise.', placeholder: 'e.g. we roast on site every morning' },
];

/** Deterministic extras for a category. Always 3, always tagged as template. */
function fallbackQuestions(category) {
  const set = FALLBACK_SETS.find((s) => s.match.test(String(category || '')));
  const questions = (set ? set.questions : FALLBACK_DEFAULT);
  return questions.map((q) => ({ ...q, type: 'text', source: 'template' }));
}

// --- sanitizing the model's answer ------------------------------------------

const clip = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * A live model can return duplicate keys, re-ask something we already hold,
 * overshoot the count, or emit an unrenderable type. Returns a clean 2-5 set,
 * or null when too little survives — the caller then uses the template set
 * rather than showing the owner a one-question stub.
 */
function sanitize(raw) {
  if (!Array.isArray(raw)) return null;
  const seen = new Set();
  const out = [];
  for (const q of raw) {
    if (!q || typeof q !== 'object') continue;
    const key = String(q.key || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (key.length < 3 || key.length > 40) continue;
    if (RESERVED_KEYS.has(key) || seen.has(key)) continue;
    const label = clip(q.label, 120);
    if (!label) continue;
    seen.add(key);
    out.push({
      key,
      label,
      hint: clip(q.hint, 160),
      placeholder: clip(q.placeholder, 80),
      type: q.type === 'textarea' ? 'textarea' : 'text',
      source: 'gemini',
    });
    if (out.length === 5) break;
  }
  return out.length >= 2 ? out : null;
}

/**
 * The personalised half of the set. Never throws and never returns empty:
 * gemini.businessQuestions already degrades to null when keyless or on error,
 * and a null (or unusable) answer becomes the category template.
 */
async function generateQuestions(profile = {}) {
  const raw = await gemini.businessQuestions({
    name: profile.businessName,
    category: profile.category,
    location: profile.location,
    description: profile.description,
    audience: profile.targetAudience || profile.audience,
    fixedLabels: FIXED.map((q) => `- ${q.label}`).join('\n'),
  });
  return sanitize(raw) || fallbackQuestions(profile.category);
}

// --- answered / pending -----------------------------------------------------

const answerRecord = (answers, key) => {
  const rec = (answers || {})[key];
  if (rec === undefined || rec === null) return null;
  // Tolerate a bare string, in case a record was written by hand or by an
  // older shape: {value, at, source} is what we write.
  return typeof rec === 'string' ? { value: rec, at: null, source: null } : rec;
};

/** The value a question already has on the profile, ignoring the answers map. */
function existingValue(profile, q) {
  if (!q.target) return null;
  const v = q.target.kind === 'profile'
    ? profile[q.target.column]
    : ((profile.brandBrief && profile.brandBrief.businessFacts) || {})[q.target.field];
  // An empty array is "not answered", not an answer of nothing — otherwise a
  // profile that has never been asked would read as already handled.
  if (Array.isArray(v)) return v.length ? v : null;
  return v || null;
}

/**
 * Answered, skipped, or already known from a previous onboarding all count as
 * handled — a profile that filled tone and slogan through the old long signup
 * must never be asked for them again.
 */
function isHandled(profile, q) {
  const rec = answerRecord(profile.profileAnswers, q.key);
  if (rec) return true;                      // value OR explicit skip (value:null)
  return existingValue(profile, q) != null;
}

/** Fixed set first, then the cached AI set (generated lazily by the caller). */
function allQuestions(profile = {}) {
  const ai = Array.isArray(profile.profileQuestions) ? profile.profileQuestions : [];
  return [
    ...FIXED.map((q) => ({ ...q, fixed: true, source: 'fixed' })),
    ...ai.map((q) => ({ ...q, fixed: false, source: q.source || 'gemini' })),
  ];
}

/**
 * What the "!" badge reads. `pending` carries the full question objects so the
 * profile panel and Markiv can render or ask them without a second pass.
 */
function completion(profile = {}) {
  const all = allQuestions(profile);
  const pending = all.filter((q) => !isHandled(profile, q));
  return {
    total: all.length,
    answered: all.length - pending.length,
    pending,
    pendingCount: pending.length,
    complete: pending.length === 0,
    // The AI half is generated on first read; until then the count is only the
    // fixed set, and the panel says so rather than implying the list is final.
    generated: Array.isArray(profile.profileQuestions) && profile.profileQuestions.length > 0,
  };
}

/**
 * The whole set as the profile panel renders it: every question, whether it is
 * answered, and the value to prefill. Answered questions stay in the list so
 * the owner can edit or add to what they already told us.
 */
function view(profile = {}) {
  return allQuestions(profile).map((q) => {
    const rec = answerRecord(profile.profileAnswers, q.key);
    const existing = existingValue(profile, q);
    const raw = rec && rec.value != null ? rec.value : existing;
    return {
      key: q.key,
      label: q.label,
      hint: q.hint || '',
      placeholder: q.placeholder || '',
      type: q.type || 'text',
      options: q.options || null,
      fixed: !!q.fixed,
      source: q.source,
      // A skip is answered-and-empty: the badge stops counting it, but the
      // field stays open so the owner can still fill it in later.
      answered: isHandled(profile, q),
      skipped: !!(rec && rec.value == null),
      value: Array.isArray(raw) ? raw.join(', ') : (raw || ''),
      answeredBy: (rec && rec.source) || null,
    };
  });
}

// --- writing answers back ---------------------------------------------------

const splitList = (s) => String(s).split(',').map((x) => x.trim()).filter(Boolean);

/**
 * Turn `{key: answer}` into the field patch db.profiles.update expects.
 *
 * Every answer is recorded in profile_answers (with provenance, so the panel
 * can show what Markiv collected in conversation), AND routed to its real home
 * when it has one. A null/empty answer is an explicit skip: recorded so we stop
 * asking, but never written over a real column.
 *
 * Returns null when nothing valid was supplied, so the caller can 400 instead
 * of issuing an empty UPDATE.
 */
function applyAnswers(profile = {}, answers = {}, source = 'panel') {
  const byKey = new Map(allQuestions(profile).map((q) => [q.key, q]));
  const nextAnswers = { ...(profile.profileAnswers || {}) };
  const fields = {};
  const facts = { ...((profile.brandBrief && profile.brandBrief.businessFacts) || {}) };
  let factsTouched = false;
  let accepted = 0;

  for (const [key, raw] of Object.entries(answers)) {
    const q = byKey.get(key);
    if (!q) continue;                                  // unknown key: ignore, never store free-form
    const value = typeof raw === 'string' ? raw.trim() : raw == null ? '' : String(raw).trim();
    accepted += 1;

    if (!value) {                                      // explicit skip
      nextAnswers[key] = { value: null, at: new Date().toISOString(), source };
      continue;
    }
    const stored = clip(value, q.type === 'textarea' ? 600 : 200);
    nextAnswers[key] = { value: stored, at: new Date().toISOString(), source };

    if (!q.target) continue;
    if (q.target.kind === 'profile') {
      if (q.type === 'multiselect') {
        // Order is the owner's choice and is preserved; unknown entries are
        // dropped rather than passed through to the language instruction.
        const picked = splitList(stored).filter((v) => q.options.includes(v));
        if (!picked.length) continue;
        fields[q.target.column] = picked;
        continue;
      }
      // A closed list stays closed: an off-list tone is kept as an answer but
      // never written to brand_tone, where the content prompts read it.
      if (q.options && !q.options.includes(stored)) continue;
      fields[q.target.column] = stored;
    } else if (q.target.kind === 'facts') {
      facts[q.target.field] = q.list ? splitList(stored) : stored;
      factsTouched = true;
    }
  }

  if (!accepted) return null;
  fields.profileAnswers = nextAnswers;
  if (factsTouched) {
    fields.brandBrief = { ...(profile.brandBrief || {}), businessFacts: facts };
  }
  return fields;
}

// --- Markiv -----------------------------------------------------------------

/**
 * The block appended to the agent's system prompt. Markiv answers the request
 * first and asks at most ONE of these, so a new owner is helped before being
 * questioned. Empty string once the profile is complete, which removes the
 * instruction entirely rather than leaving a rule with nothing to act on.
 */
function agentPromptBlock(profile = {}, max = 4) {
  const { pending } = completion(profile);
  if (!pending.length) return '';
  const list = pending.slice(0, max).map((q) => `- ${q.key}: ${q.label}`).join('\n');
  return [
    '',
    'MISSING BUSINESS DETAILS',
    'These are still unknown about this business:',
    list,
    'After you have fully answered what the owner asked, you MAY ask ONE of these,',
    'in one short sentence, and only if it is relevant to what they just asked about.',
    'Never ask two. Never open with a question. Never ask again in the same reply.',
    'When the owner tells you one of these facts — in any message — call',
    'save_business_detail immediately so they are never asked for it twice.',
  ].join('\n');
}

module.exports = {
  FIXED,
  FIXED_KEYS,
  TONE_OPTIONS,
  AUDIENCE_LANGUAGES,
  RESERVED_KEYS,
  fallbackQuestions,
  sanitize,
  generateQuestions,
  allQuestions,
  completion,
  view,
  applyAnswers,
  agentPromptBlock,
};
