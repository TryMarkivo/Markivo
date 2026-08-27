// AUTO-ASSEMBLED marketing knowledge for Mark (Markivo's AI marketing agent).
// Copy frameworks, hook patterns, CTA library, and per-platform native rules.
// Source: mark-marketing-brain workflow (2026-06-22), reviewed before commit.

const PLATFORM_RULES = {
  "instagram": {
    "structure": "Strong hook in line 1 (only the first ~125 chars show before 'more'). 2-4 short lines of body with line breaks for breathing room. One clear CTA. Hashtags dropped at the very end or in the first comment, never woven through the body. Caption pairs with a single strong visual or carousel.",
    "lengthGuide": "125-150 chars to the fold; 1-3 short paragraphs total. Reels captions shorter (1-2 lines). Hard cap usefully around 300 chars — long captions get truncated and rarely read.",
    "hashtagPolicy": "5-10 mixed: a couple local (#Tashkent #Toshkent), a couple niche category tags, one branded (#${name}). Skip giant generic tags (#love #food) — they bury you. Put them at the end or in the first comment.",
    "emojiPolicy": "Yes, 2-5 purposeful emojis as visual anchors and line-starters. Never emoji-spam a wall of icons.",
    "doList": [
      "Lead with the hook — the first line is the ad",
      "Use line breaks; dense blocks get scrolled past",
      "Write a 4:5 or square visual brief alongside (owner phone photo, window light)",
      "Add alt-text and put the CTA above the hashtag block"
    ],
    "dontList": [
      "Don't bury the offer in paragraph 3",
      "Don't dump 30 hashtags in the caption body",
      "Don't write for desktop — most read on a phone in 2 seconds",
      "Don't use stock-photo energy; real owner shots outperform"
    ]
  },
  "facebook": {
    "structure": "Conversational opener that invites a reply (questions work well — comments drive reach). 1-3 short paragraphs. Plain link or clear CTA. Localness up front since FB still skews to neighbourhood community groups and older locals.",
    "lengthGuide": "40-80 words is the sweet spot; short posts outperform. Can run longer for a story or event, but front-load the point in the first sentence.",
    "hashtagPolicy": "0-2 only. Hashtags barely help on Facebook and look spammy. A single local or event tag at most.",
    "emojiPolicy": "Light, 1-3. Warm and human, not loud. Matches FB's older, community-oriented audience.",
    "doList": [
      "Ask a question to spark comments — engagement = reach here",
      "Post event details, hours, and location plainly (people screenshot them)",
      "Use it for community trust: reviews, milestones, thank-yous",
      "Reply to every comment fast — FB rewards active threads"
    ],
    "dontList": [
      "Don't paste an Instagram caption verbatim — strip the hashtag wall",
      "Don't lead with a hard sell; lead with community",
      "Don't rely on external links for reach (FB throttles them) — put the offer in the text",
      "Don't ignore the comments; a dead thread signals low quality"
    ]
  },
  "telegram": {
    "structure": "Channel post: bold first line as a headline (Telegram supports bold/italic). Short scannable body, 1-2 paragraphs. One clear CTA. Because followers opted in, you can be more direct and offer-led than on discovery platforms. Pin offers; use a button or link for ordering.",
    "lengthGuide": "Headline + 2-4 short lines, ~60-120 words. Telegram readers tolerate a bit more text than IG, but the preview/notification shows only the first line — make it count.",
    "hashtagPolicy": "0-3, optional. Hashtags are weak in Telegram (no discovery feed); use them only for in-channel search/categorisation (#offer #newmenu). Not for reach.",
    "emojiPolicy": "Yes, as bullet markers and emphasis (📢 ✅ 📍 👉). They structure a chat-readable post well. Don't overdo a notification line.",
    "doList": [
      "Lead with a bold headline — it's the notification preview",
      "Be offer-direct; this is a warm, opted-in audience",
      "Use 📍 for address and a clear 👉 CTA line",
      "Add a square/1:1 image with minimal text overlay for chat readability"
    ],
    "dontList": [
      "Don't write a generic post — channel members expect insider value",
      "Don't bury the address/hours in a paragraph",
      "Don't post walls of text; chat formatting rewards short lines",
      "Don't rely on hashtags for discovery — there isn't a feed"
    ]
  },
  "google_business": {
    "structure": "Plain, factual, SEO-aware. First sentence states what + where (helps local search). Include the offer, the key detail, hours/dates, and a Google action button (Order, Book, Call, Learn more). No hooks-for-hooks'-sake — searchers have intent already; answer it clearly.",
    "lengthGuide": "100-300 chars shown before 'more'; keep the essential info in the first 1-2 sentences. Posts expire (~7 days for What's New), so keep them current and specific.",
    "hashtagPolicy": "None. Hashtags do nothing on Google Business Profile. Use natural keywords instead (category + neighbourhood + service).",
    "emojiPolicy": "Minimal, 0-1. This is a search surface — keep it clean and professional. An emoji can lead an offer but don't decorate.",
    "doList": [
      "Front-load city/neighbourhood + category keywords for local SEO",
      "Always attach a CTA button (Book/Order/Call/Learn more)",
      "Post real offers, events, and updates with dates",
      "Add a clear, well-lit photo of the actual product/place"
    ],
    "dontList": [
      "Don't use hashtags or social-media slang",
      "Don't keyword-stuff — write a natural sentence a searcher would read",
      "Don't leave posts stale; expired offers hurt trust",
      "Don't omit hours, address, or the action button"
    ]
  },
  // DISABLED: YouTube temporarily off — see 2026-08-15. This is the voice/
  // rules block for PUBLISHING to YouTube via the connector, not the
  // Competitor Intelligence YouTube tracking (which stays live). Uncomment
  // alongside connectors/youtube.js to restore YouTube as a generation target.
  // "youtube": {
  //   "structure": "Title is the hook (front-load keyword + benefit, ~60 chars). Description: compelling first 2 lines (shown above the fold and used by search), then fuller context, then links/CTA, hours, and location. For Shorts: punchy title + 1-line description + a few tags. Thumbnail + title do most of the work.",
  //   "lengthGuide": "Title under 60 chars. Description first 2 lines (~150 chars) are critical for search/preview; full description can be 200-300+ words with chapters and links for long-form. Shorts: 1-2 lines.",
  //   "hashtagPolicy": "3-5 in the description (first 3 surface above the title). One branded, one local, one category. For Shorts, #Shorts plus 2-3 niche tags.",
  //   "emojiPolicy": "Sparing, 0-2, mainly in Shorts titles/descriptions. Long-form stays cleaner and more professional.",
  //   "doList": [
  //     "Write the title as a searchable benefit hook with a keyword",
  //     "Nail the first 2 description lines — they're the search/preview copy",
  //     "Add a clear CTA (Subscribe, Visit, Book) and your location + hours",
  //     "Use #Shorts for vertical clips and a custom thumbnail for long-form"
  //   ],
  //   "dontList": [
  //     "Don't write a vague title; specificity wins search",
  //     "Don't hide the CTA and links at the very bottom only",
  //     "Don't ignore the description — it's prime SEO real estate",
  //     "Don't upload horizontal-only when a vertical Short would reach more locals"
  //   ]
  // }
};

module.exports = {
  hookPatterns: [
  {
    "name": "Local Callout",
    "template": "${location}, your ${category} just got an upgrade.",
    "whenToUse": "Launches, reopenings, or anything new — pins the post to the neighbourhood so locals feel it's for them, not a national brand."
  },
  {
    "name": "POV / Second-Person Scene",
    "template": "POV: it's a slow afternoon in ${location} and you walk into ${name}...",
    "whenToUse": "Instagram Reels and vibe posts. Drops the viewer into a feeling instead of selling. Best with owner-shot footage of the real space."
  },
  {
    "name": "Specific Number",
    "template": "${number} ${category} regulars can't be wrong about one thing at ${name}.",
    "whenToUse": "Social proof when you have a real count (years open, daily customers, items sold). Never invent the number — specificity is the whole point."
  },
  {
    "name": "Problem Snap",
    "template": "Tired of ${painPoint}? Here's what we do differently.",
    "whenToUse": "When the audience has an obvious frustration (cold coffee, long waits, rude service, overpriced cuts). Names the pain in the first 3 words."
  },
  {
    "name": "Bold Claim + Proof",
    "template": "Best ${item} in ${location}. Come prove us wrong.",
    "whenToUse": "Confident brands with a genuinely strong signature item. The dare invites comments and walk-ins. Avoid if the claim isn't defensible."
  },
  {
    "name": "Question Hook",
    "template": "What's the first thing you order at a new ${category}?",
    "whenToUse": "Engagement/comment-bait posts. Works on Facebook and Instagram where replies boost reach. Keep it answerable in 2 words."
  },
  {
    "name": "Behind-the-Scenes Tease",
    "template": "6am at ${name}. Nobody sees this part.",
    "whenToUse": "Build trust and craft-credibility — prep, sourcing, the owner at work. Humanises a faceless small business cheaply."
  },
  {
    "name": "This-or-That",
    "template": "${optionA} or ${optionB}? At ${name} you don't have to choose.",
    "whenToUse": "Menu/product variety posts and polls. Drives Story stickers and quick comments."
  },
  {
    "name": "Time-Bound Urgency",
    "template": "Today only at ${name}: ${offer}. When it's gone, it's gone.",
    "whenToUse": "Real flash offers and end-of-day specials. Only use with a true deadline — fake urgency burns trust with repeat locals."
  },
  {
    "name": "Insider Secret",
    "template": "The ${item} regulars order that's not even on the menu...",
    "whenToUse": "Curiosity-driven reach. Makes followers feel like insiders and gives newcomers a reason to ask for it by name."
  },
  {
    "name": "Relatable Truth",
    "template": "You didn't come to ${location} to drink bad ${item}. We get it.",
    "whenToUse": "Casual, warm, or playful tones. Builds rapport by siding with the customer against a shared low standard."
  },
  {
    "name": "Owner's Voice",
    "template": "Hi, I'm the owner of ${name}. Here's why I opened this place.",
    "whenToUse": "Founder story, anniversary, or trust-building posts. The single most effective hook for a brand-new SMB with no audience yet."
  }
],
  copyFrameworks: [
  {
    "name": "AIDA (Attention-Interest-Desire-Action)",
    "structure": "Attention: a scroll-stopping hook line. Interest: one concrete detail that earns a second of curiosity. Desire: paint the specific outcome/feeling the customer gets. Action: one clear CTA.",
    "example": "Fresh sourdough at 8am ☕ / Baked in-house every morning by hand / Still warm when you bite in — that crackle is the whole point / Grab a loaf before they sell out — we're on Amir Temur St."
  },
  {
    "name": "PAS (Problem-Agitate-Solve)",
    "structure": "Problem: name the customer's pain in plain words. Agitate: twist it — show the cost of leaving it unsolved. Solve: position your offer as the relief, then CTA.",
    "example": "Bad haircut before a big day? / Nothing kills confidence like a cut you have to hide under a cap for two weeks / Our barbers fix-or-redo, free. Book a chair and walk out sure."
  },
  {
    "name": "BAB (Before-After-Bridge)",
    "structure": "Before: the customer's current frustrating state. After: the better state they want. Bridge: your business is how they cross over.",
    "example": "Before: reheated lunch at your desk again. After: a hot, fresh plov that actually wakes you up. Bridge: 5-min walk from your office — order ahead, skip the queue."
  },
  {
    "name": "FAB (Feature-Advantage-Benefit)",
    "structure": "Feature: the concrete thing. Advantage: why that's better than the norm. Benefit: what it means for the customer's day/life.",
    "example": "Single-origin beans (feature) roasted weekly, not months ago (advantage), so your morning cup actually tastes like something (benefit)."
  },
  {
    "name": "4 Ps (Promise-Picture-Proof-Push)",
    "structure": "Promise: the bold result. Picture: help them imagine having it. Proof: a real review, count, or photo. Push: the CTA.",
    "example": "Promise: the glow-up your skin's been waiting for. Picture: walking out lighter, brighter, breathing easy. Proof: 4.9★ from 200+ Tashkent clients. Push: DM 'GLOW' to book this week."
  },
  {
    "name": "Story Arc (Hook-Build-Turn-Land)",
    "structure": "Hook: open mid-action. Build: one or two lines of context. Turn: the moment that matters. Land: the takeaway + soft CTA.",
    "example": "A regular came in on crutches just for our soup. We delivered the next three to her door. That's not a policy — it's just us. Come see why people stay."
  },
  {
    "name": "Offer Stack (What-Why now-What to do)",
    "structure": "State the offer plainly. Give a real reason it's now (season, restock, anniversary). Tell them exactly the one step to claim it.",
    "example": "20% off all colour services this week — our new stylist's launch special. First 15 bookings only. Tap the button to grab a slot."
  },
  {
    "name": "Listicle (Hook + 3-5 scannable points)",
    "structure": "A numbered or bulleted hook, then 3-5 tight, skimmable lines, each one concrete. Close with a CTA. Built for save/share.",
    "example": "3 things to order on your first visit: 1) the lamb samsa (gone by noon) 2) cold-brew, no sugar needed 3) the honey cake. Save this for later 📌"
  }
],
  ctaLibrary: [
  {
    "intent": "visit",
    "examples": [
      "Swing by today — we're on ${location}, look for the green door.",
      "Come taste it for yourself. First visit? Mention this post.",
      "Open till 10pm. Your table's waiting."
    ]
  },
  {
    "intent": "book",
    "examples": [
      "Tap the button to grab your slot — this week fills fast.",
      "Book online in 30 seconds, link in bio.",
      "DM us your preferred time and we'll lock it in."
    ]
  },
  {
    "intent": "call",
    "examples": [
      "Call us now — we'll have it ready before you arrive.",
      "Questions? Ring ${name} directly, we actually pick up.",
      "Phone ahead to reserve — number in bio."
    ]
  },
  {
    "intent": "order",
    "examples": [
      "Order ahead and skip the queue — link in bio.",
      "Tap to order on Yandex/Express, hot in 20 min.",
      "Reply 'ORDER' and we'll sort the rest."
    ]
  },
  {
    "intent": "follow",
    "examples": [
      "Follow for daily specials before they sell out.",
      "Hit follow so you never miss a fresh drop 🔔",
      "Tap follow — your future self ordering lunch will thank you."
    ]
  },
  {
    "intent": "dm",
    "examples": [
      "DM 'MENU' for today's full list.",
      "Slide into our DMs to customise your order.",
      "Send us a message — we reply within the hour."
    ]
  }
],
  platformRules: PLATFORM_RULES,
  rulesFor(key) {
    const k = String(key || '').toLowerCase();
    return PLATFORM_RULES[key] || PLATFORM_RULES[k] || null;
  },
};
