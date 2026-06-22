// AUTO-ASSEMBLED marketing knowledge for Mark (Markivo's AI marketing agent).
// Quality rubric, banned-cliche bank, anti-patterns, and critique/refine prompts.
// Source: mark-marketing-brain workflow (2026-06-22), reviewed before commit.

const BANNED_CLICHES = [
  "something special",
  "we've prepared something special",
  "we have prepared something special",
  "come by, relax",
  "come by and relax",
  "sit back and relax",
  "the best [X] in town",
  "best espresso in tashkent",
  "best in town",
  "best in the city",
  "number one in town",
  "support local (as the entire message)",
  "quality you can trust",
  "real local quality",
  "quality you deserve",
  "the luxury you deserve",
  "experience the difference",
  "we've got you covered",
  "look no further",
  "check us out",
  "check it out",
  "come see for yourself",
  "stop by today",
  "drop by today",
  "visit us today",
  "don't miss out",
  "hurry, limited time (with no actual deadline)",
  "one-stop shop",
  "second to none",
  "top-notch",
  "top notch",
  "unmatched quality",
  "unparalleled quality",
  "world-class (for a local SMB)",
  "a cut above the rest",
  "taste the difference",
  "feel the difference",
  "where quality meets [X]",
  "your one and only",
  "more than just a [X]",
  "not your average [X]",
  "like no other",
  "simply the best",
  "nothing beats",
  "we go above and beyond",
  "passion for perfection",
  "crafted with love (as filler)",
  "made with love (as filler)",
  "for all your [X] needs",
  "satisfaction guaranteed (with no actual guarantee)",
  "perfect for any occasion",
  "something for everyone",
  "at affordable prices (vague)",
  "prices you'll love",
  "unbeatable prices",
  "the perfect place to [X]",
  "your new favorite [X]",
  "welcome to [X] (as a hook)",
  "introducing [X] (as a hook with nothing behind it)",
  "amazing",
  "incredible (empty)",
  "exciting news! (empty)",
  "we are thrilled / we are excited (empty)",
  "game-changer",
  "next level (empty)",
  "take it to the next level",
  "elevate your [X] (empty)",
  "hidden gem (self-applied)",
  "you won't be disappointed",
  "trust us, you'll love it",
  "link in bio (as the only CTA)",
  "follow us for more (as the CTA)",
  "dm us for more info (vague)",
  "hit us up",
  "the talk of the town",
  "a feast for the senses",
  "journey of flavors",
  "explore our wide range",
  "wide range of options",
  "one of a kind (empty)",
  "handcrafted with care (filler)",
  "POV: you found the best [X] in town",
  "passion for excellence",
  "elevate your experience",
  "we strive to",
  "customer-centric",
  "nestled in the heart of",
  "your trusted partner in solutions",
  "committed to excellence",
  "we pride ourselves",
  "valued customers",
  "unforgettable experience",
  "stay tuned",
  "coming soon (with nothing concrete)"
];

module.exports = {
  dimensions: [
  {
    "key": "specificity_to_business",
    "label": "Specific to THIS business",
    "description": "The draft could ONLY have been written for this exact business. It uses concrete proof — the real menu item, service, neighborhood, price, hour, or owner detail from the profile (businessName, category, description, slogan, location, targetAudience) — not category-generic filler that would fit any cafe/salon/shop. Reject anything where swapping in a competitor's name would leave the post equally true. A pulled-from-profile noun (a named dish, a service, a street, a guarantee) must appear.",
    "weight": 5,
    "passBar": 8
  },
  {
    "key": "hook_strength",
    "label": "Scroll-stopping hook",
    "description": "The first line (first ~7 words, before any line break) earns the second line. It creates a curiosity gap, names a specific pain/desire of the targetAudience, or makes a concrete claim — not a label or greeting. 'Something special at X', 'Welcome to X', 'Check out our...' all fail. On a muted phone feed, would a local actually stop? Judge ONLY line one.",
    "weight": 5,
    "passBar": 8
  },
  {
    "key": "single_clear_cta",
    "label": "One clear, doable CTA",
    "description": "Exactly one call to action, and it is concrete and frictionless for an SMB: a specific verb tied to a real next step (DM the word X, tap the map pin, come in before 11am Tue, call to reserve). 'Visit us', 'link in bio', 'follow for updates', 'check it out' are weak/vague and fail. Two or more competing CTAs splits intent and fails. The CTA must match what this business can actually fulfil.",
    "weight": 4,
    "passBar": 8
  },
  {
    "key": "on_brand_voice",
    "label": "On-brand voice",
    "description": "Tone matches the profile brandTone (Cozy & Warm / Modern & Minimalist / Luxury & Premium / Playful & Fun / Professional & Trustworthy / Energetic & Fast-paced) consistently across the whole draft — word choice, sentence length, punctuation, emoji density. A Luxury & Premium clinic must not read Playful & Fun. Emoji count must suit the tone (Luxury/Professional = sparse; Playful/Energetic = allowed but not littered).",
    "weight": 4,
    "passBar": 7
  },
  {
    "key": "originality_no_cliche",
    "label": "Original, zero cliche",
    "description": "Contains NONE of the banned phrases and no equivalent template filler. No 'best in town', no hollow superlatives ('amazing', 'the perfect', 'top-notch'), no empty 'something special', no generic 'support local' as the whole point. The angle should feel freshly observed about this business, not assembled from marketing Lego. One reused banned phrase = automatic fail of this dimension.",
    "weight": 5,
    "passBar": 8
  },
  {
    "key": "clarity_skim",
    "label": "Clarity & skimmability",
    "description": "A busy owner's customer understands the offer, the place, and the action in one read on a phone. Concrete over abstract; short lines; no jargon, no corporate fluff, no run-ons. Any specific number (price, %, hours, deadline) is stated plainly. If a reader would ask 'okay but what exactly is this / what do I do', it fails.",
    "weight": 3,
    "passBar": 7
  },
  {
    "key": "platform_fit",
    "label": "Platform-native fit",
    "description": "Format, length, and mechanics fit the target platform. Instagram: caption hook + value + 1 CTA, hashtags returned SEPARATELY (never in body). TikTok: spoken/POV-style hook for a short vertical video, not a written ad. Telegram: channel broadcast, scannable, link/action explicit. Google Business Profile: factual, keyword-honest, hours/offer/location forward, minimal emoji. Facebook: slightly longer ok, community framing. YouTube: title+description logic. Wrong-platform shape fails.",
    "weight": 4,
    "passBar": 7
  },
  {
    "key": "trilingual_readiness",
    "label": "Trilingual readiness",
    "description": "Applies when languages[] includes uz or ru. Each requested language reads as natural, native copy — NOT a literal calque of the English. Uzbek is Latin script with correct o' and g'; Russian is idiomatic. The hook and CTA survive translation (still hooky, still one clear action). Languages are clearly separated, not interleaved mid-sentence. If only English is requested, score N/A and exclude from the weighted total.",
    "weight": 3,
    "passBar": 7
  },
  {
    "key": "actionable_value",
    "label": "Concrete value / reason now",
    "description": "The post gives the reader a real reason to act today: a specific offer, a named new item, a limited window, a genuine benefit — not vague vibes. SMB posts that just 'exist' (a photo + a mood) waste the slot. If there is no offer or news, there must be at least one concrete, useful, specific detail the reader didn't know. Pure ambience with no takeaway fails.",
    "weight": 3,
    "passBar": 7
  }
],
  bannedCliches: BANNED_CLICHES,
  antiPatterns: [
  {
    "pattern": "Label-as-hook: opening with the business name, a greeting, or 'Something special at X' / 'Welcome to X'.",
    "why": "Line one is the only line most of the feed sees. A label gives zero reason to stop, so the rest of the well-written post is never read. Mark's current fallback ('✨ Something special at ${name}! ✨') is exactly this failure.",
    "fix": "Lead with a concrete, specific hook drawn from the profile: a customer pain, a sensory detail of a named item, a number, or a curiosity gap. Move the business name to where it's earned (CTA or sign-off), not line one."
  },
  {
    "pattern": "Generic-swappable copy: the draft would read identically with a competitor's name pasted in.",
    "why": "It proves nothing specific and builds no preference. 'Real local quality', 'come by and relax' fit any cafe in any city — so they sell for none of them.",
    "fix": "Mine the profile for one irreplaceable detail (a named dish/service, the actual neighborhood/landmark in location, the owner's promise in description) and make the post hinge on it. The name-swap test must FAIL."
  },
  {
    "pattern": "Superlative with no proof: 'best ... in town', 'top-notch', 'unmatched'.",
    "why": "Self-applied superlatives are noise — every business claims them, so customers discount them. Uzbek SMB audiences are especially skeptical of empty bragging.",
    "fix": "Replace the claim with the evidence behind it: the specific thing that makes it good (single-origin beans roasted Tuesdays; 12-minute lunch guarantee; the barber with 15 years on Amir Temur St). Show, don't boast."
  },
  {
    "pattern": "CTA soup or dead-end CTA: 'visit us — link in bio', 'follow for updates', plus 'DM us' all in one post.",
    "why": "Multiple asks split the reader's intent and usually none get done; vague asks ('check it out') give no actual next step. SMB conversion dies here.",
    "fix": "Pick ONE concrete action the business can fulfil and make it frictionless: 'Tap the map pin and come before 11 — first 10 get a free cortado.' One verb, one outcome, one path."
  },
  {
    "pattern": "Emoji confetti / sparkle padding: '✨ ... ✨', strings of emoji standing in for substance.",
    "why": "Decorative emoji read as low-effort and clash with Luxury/Professional tones; they also hide the absence of a real idea. The current fallback wraps weak copy in sparkles to look finished.",
    "fix": "Cap emoji to tone (Luxury/Professional: 0-1; Playful/Energetic: up to ~3, each doing a job). Earn attention with the words, not the glyphs."
  },
  {
    "pattern": "Hashtags inside the post body, or junk hashtags (#fyp, #instagood, #SupportLocal as the whole tag set).",
    "why": "Inline tags clutter the caption and break the platform contract (the app returns hashtags separately); broad junk tags bring no local reach. The fallback's '#SupportLocal #Tashkent' is generic and untargeted.",
    "fix": "Return hashtags as a separate array, never in the body. Use a tight, specific mix: 1-2 geo (the actual district/city), 1-2 niche category, 1 branded. Drop spray-and-pray tags."
  },
  {
    "pattern": "Literal calque translation: Uzbek/Russian lines are word-for-word renders of the English hook.",
    "why": "Direct translation kills the hook and reads as machine output to native speakers, eroding trust in exactly the trilingual audiences Markivo serves.",
    "fix": "Re-write (don't translate) the hook and CTA so each language is natively persuasive. Uzbek in correct Latin script (o', g'); idiomatic Russian. Keep the hook hooky and the CTA actionable in every language."
  },
  {
    "pattern": "Vibes-only post: a mood and a photo with no offer, no news, and nothing the reader didn't already know.",
    "why": "It occupies a posting slot without giving anyone a reason to act, follow, or visit. For a budget-constrained SMB every slot must work.",
    "fix": "Add one concrete takeaway: a named new item, a real limited window, a price, a tip, or a genuine reason to come now. If there's truly no news, lead with a specific, surprising detail about the business."
  },
  {
    "pattern": "Corporate fluff in an SMB voice: 'we strive to deliver', 'committed to excellence', 'your trusted partner in solutions'.",
    "why": "Big-brand boilerplate sounds hollow from a neighborhood shop and creates distance instead of the warmth that drives local loyalty.",
    "fix": "Write like the owner talking to a regular: plain, specific, human. Name the thing, name the benefit, name the action. Cut every sentence that doesn't carry a fact or a feeling tied to this place."
  },
  {
    "pattern": "Overpromising / fake urgency: 'limited time!' with no date, 'satisfaction guaranteed' with no policy.",
    "why": "Manufactured scarcity and guarantees the business can't honor erode trust fast in tight-knit local markets and can mislead customers.",
    "fix": "Only claim urgency or guarantees that are real and specific ('this Friday only', 'free re-do if your fade isn't right'). If there's no real deadline or policy, drop the claim entirely."
  }
],
  critiqueSystemPrompt: "You are Markivo's ruthless brand editor. You score ONE draft social post written by Mark, the in-app AI marketing agent, for a small local business (cafes, salons, shops, clinics, gyms, restaurants — many in Tashkent, Uzbekistan and the wider region; audiences are often trilingual: English, Russian, Uzbek in Latin script). Your only job is to make the draft sharper and more specific. You are never satisfied by competent-but-generic copy.\n\nYou receive: the business profile (businessName, category, brandTone, description, targetAudience, location, slogan, languages[]), the target platform (instagram | facebook | tiktok | telegram | google_business | youtube), and the draft (post body + hashtags array, plus any non-English lines).\n\nScore the draft 0-10 on each dimension you are given, using the dimension's description and passBar. Be hard. Apply these decisive tests:\n- NAME-SWAP TEST: paste a competitor's name over the business name. If the post is still equally true, specificity fails — score it <=4 and say which concrete profile detail was missing.\n- HOOK TEST: read ONLY line one (up to the first line break / first ~7 words). If it's a label, greeting, or 'something special'-style filler, hook fails — score it <=4.\n- CTA TEST: count the calls to action. Zero or 2+ = fail. One vague CTA ('visit us', 'link in bio', 'follow for updates') = score <=5. Pass only a single concrete, doable action.\n- CLICHE TEST: scan against the banned list and any equivalent filler. Any one banned phrase or empty superlative = originality scores <=4. Quote the offending span exactly.\n- TRILINGUAL TEST (only if languages[] includes uz/ru): if a non-English line is a literal calque of the English, that language fails; flag it and show the natural rewrite direction. If only English is requested, mark trilingual_readiness N/A and exclude it.\n\nRules:\n- Judge against THIS business and THIS platform, never an abstract ideal.\n- Quote the exact problem span; never give vague praise like 'nice tone' or 'could be punchier'.\n- Every dimension below its passBar MUST come with a concrete, rewrite-ready fix that names the specific profile detail to use (e.g. 'open with the cardamom bun from the description', 'CTA: come before 11 Tue–Fri').\n- Do not rewrite the whole post — that's the refiner's job. Give targeted, surgical fixes.\n- Honor the brandTone: a Luxury & Premium clinic and a Playful & Fun gym have different bars for emoji, slang, and exclamation marks.\n- If a quantitative claim (price, %, hours, deadline) is vague or missing where the offer needs one, flag it.\n\nReturn STRICT JSON only, no prose outside it:\n{\n  \"scores\": [{ \"key\": string, \"score\": number, \"verdict\": \"pass\" | \"fail\", \"evidence\": string (exact quoted span or 'missing'), \"fix\": string (specific, rewrite-ready; '' if pass) }],\n  \"weightedTotal\": number,        // sum(score*weight) / sum(weight) over scored (non-N/A) dimensions, 0-10\n  \"passedBar\": boolean,           // true only if EVERY scored dimension is >= its passBar\n  \"bannedHits\": [string],         // exact banned/cliche spans found, [] if none\n  \"nameSwapSurvives\": boolean,    // true = specificity problem (post survives name swap)\n  \"topFixes\": [string]            // the 1-3 highest-leverage changes, ordered, each naming the exact profile detail or action to use\n}\nOutput ONLY this JSON object.",
  refineSystemPrompt: "You are Markivo's senior brand strategist and direct-response copywriter — the level of a creative director who has shipped thousands of high-performing posts for small local businesses. You rewrite ONE draft using a structured critique so it clears every bar. The result must read like it was made by hand for THIS business, on THIS platform, for THIS audience — never generic, never corporate-fluffy.\n\nYou receive: the business profile (businessName, category, brandTone, description, targetAudience, location, slogan, languages[]), the target platform, the original draft, and the critique JSON (scores, bannedHits, topFixes). Treat the critique as a binding work order: every failed dimension and every banned hit MUST be fixed.\n\nHard constraints — the rewrite MUST:\n1. SPECIFICITY: hinge on at least one irreplaceable detail pulled from the profile (a named item/service from description, the real district/landmark from location, the owner's actual promise, the slogan if it earns its place). The rewrite must FAIL the name-swap test — swapping a competitor's name in should make it read wrong.\n2. HOOK: line one (first ~7 words, before the first line break) must stop a local mid-scroll — a concrete claim, a named sensory detail, a specific customer pain/desire of the targetAudience, or a real curiosity gap. NEVER open with the business name, a greeting, 'welcome', 'introducing', or 'something special'.\n3. ONE CTA: exactly one call to action, concrete and frictionless and fulfillable by this business (e.g. 'Come before 11, Tue–Fri', 'Tap the pin', 'DM the word BUN'). No 'link in bio' / 'follow for updates' as the action. No competing second ask.\n4. ZERO CLICHE: use none of the banned phrases or any empty superlative ('best in town', 'top-notch', 'amazing', 'something special', 'quality you can trust', 'come by, relax', 'support local' as the whole point). If you need to make a claim, show the proof instead of asserting it.\n5. ON-BRAND: match brandTone exactly in word choice, rhythm, punctuation, and emoji density. Luxury & Premium / Professional & Trustworthy: 0-1 emoji, no slang, restrained punctuation. Playful & Fun / Energetic & Fast-paced: lively, up to ~3 purposeful emoji. Cozy & Warm: warm and human, light emoji. Modern & Minimalist: clean, terse, minimal or no emoji.\n6. PLATFORM FIT: shape to the platform. Instagram — caption with hook+value+1 CTA; hashtags returned ONLY in the separate array, NEVER in the body; 3-6 tight tags (1-2 geo using the real district/city, 1-2 niche category, 1 branded). TikTok — a spoken POV/hook for a short vertical video, not a written ad. Telegram — a clean channel broadcast, scannable, explicit action. Google Business Profile — factual, hours/offer/location forward, 0-1 emoji, honest keywords. Facebook — community framing, slightly longer ok. YouTube — title + description logic.\n7. TRILINGUAL (only for languages in languages[]): produce each requested language as a native, idiomatic REWRITE — not a translation of the English. Uzbek in correct Latin script with o' and g'; idiomatic Russian. The hook stays hooky and the CTA stays one clear action in every language. Separate the languages cleanly; never interleave mid-sentence. Do NOT add languages that weren't requested.\n8. VALUE: give a real reason to act now — a specific offer, named new item, genuine limited window, or a concrete useful detail. Only claim urgency/guarantees that are real. No invented deadlines or unfulfillable promises.\n9. TRUTH: never fabricate a price, hours, product, award, or detail not supported by the profile. If a number would strengthen the post but isn't in the profile, write the copy so the owner can drop it in (e.g. a clearly-marked placeholder), rather than inventing one.\n\nKeep it tight: cut every word that doesn't carry a fact or a feeling about this place. Then self-check the rewrite against all 9 constraints and silently fix any miss before returning.\n\nReturn STRICT JSON only, matching the platform's content schema, no prose outside it:\n{\n  \"post\": string,                       // the final post body in the primary language, hooks/CTA/value all fixed, NO hashtags inside\n  \"translations\": { \"uz\"?: string, \"ru\"?: string },  // include ONLY the languages requested in languages[]; omit if English-only\n  \"hashtags\": [string],                 // separate array, tight and specific, [] if the platform doesn't use them\n  \"mediaTip\": string,                   // one concrete, phone-shootable direction tied to this business and tone\n  \"changeLog\": [string]                 // 1-4 bullets naming what you fixed and which profile detail you used\n}\nOutput ONLY this JSON object.",
  // True if any banned cliche appears in the text (case-insensitive).
  hasCliche(text) {
    const t = String(text || '').toLowerCase();
    return BANNED_CLICHES.some((c) => t.includes(String(c).toLowerCase()));
  },
};
