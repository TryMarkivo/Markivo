// AUTO-ASSEMBLED marketing knowledge for Mark (Markivo's AI marketing agent).
// Few-shot good/bad exemplars per platform (teach the quality bar by example).
// Source: mark-marketing-brain workflow (2026-06-22), reviewed before commit.

const BY_PLATFORM = {
  "instagram": {
    "good": [
      {
        "text": "Caption: Rainy Tashkent afternoon? We've got the window seat with your name on it. ☕\n\nOur new cardamom raf is back by demand — steamed milk, a hit of green cardamom, that ASMR top foam. 12k so'm until 5pm today.\n\n📍 Amir Temur 14, second floor. Tap directions in our bio.\n\nMedia: phone photo of the raf on the windowsill, rain blurred behind the glass.",
        "why": "Specific product (cardamom raf), specific price + deadline, real local landmark, one CTA (directions). Reads like THIS cafe wrote it. Owner can shoot it on a phone."
      },
      {
        "text": "Caption: Sevgi, our colorist, fixed this box-dye orange in one sitting. 🧡➡️🤎\n\nSwipe for the before. Balayage correction, Olaplex through the ends, blow-dry included — booked out 3 weeks but we just got two Thursday slots.\n\nDM the word \"THURSDAY\" to grab one.\n\nMedia: before/after carousel, salon chair, natural window light.",
        "why": "Names a real stylist, a real service (box-dye correction), shows proof (before/after), and a frictionless CTA (DM one word). Scarcity is true, not fake-urgent."
      }
    ],
    "bad": [
      {
        "text": "✨ Quality you can trust ✨ At our cafe, we believe every cup tells a story. Come experience the difference today! #coffee #cafe #love #instagood #happy",
        "why": "Zero specifics — no product, price, place, or person. 'Every cup tells a story' is filler. Generic spray-of-hashtags signals a bot, not a neighborhood spot."
      },
      {
        "text": "We are pleased to announce that we are now open and serving our valued customers. Visit us for an unforgettable experience you will never forget. Looking forward to seeing you! 🙏",
        "why": "Corporate-speak ('valued customers', 'unforgettable experience'), redundant ('never forget' after 'unforgettable'), no hook, no offer, no CTA destination. Could be any business on earth."
      }
    ]
  },
  "tiktok": {
    "good": [
      {
        "text": "On-screen text (0-2s): \"POV: you ordered the 'spicy' lagman and lied about your tolerance\"\nThen: close-up of the lagman, a sweat-wipe, a thumbs up through tears.\nVoiceover/caption: Level 3 chili, hand-pulled noodles, we warned you 😅 Chilonzor branch, open till 11.\nCTA on screen: \"Tag who'd lose\"\n#tashkentfood #lagman #osh",
        "why": "Native TikTok hook (POV + relatable lie), a real menu item with a real spec (Level 3, hand-pulled), specific branch + hours, and a share-driving CTA ('tag who'd lose'). Shootable in one take."
      },
      {
        "text": "On-screen text (0-2s): \"things my gym bros didn't believe about a 90k/month membership\"\nQuick cuts: the squat rack, the actual chalk bowl, the 24/7 keycard door, the one working scale everyone fights over.\nCaption: Yunusobod, no contract, first week free. \nCTA: \"Comment 'IN' and I'll send the location\"\n#tashkentgym #gymtok",
        "why": "Listicle-style hook that invites disbelief = watch time. Concrete proof shots, real price + terms (no contract, free week), and a comment CTA that boosts the algorithm. Authentically scrappy."
      }
    ],
    "bad": [
      {
        "text": "Welcome to our amazing business! We offer the best products and services in town. Don't forget to like, follow, and subscribe for more content! #fyp #viral #foryou #trending #explore",
        "why": "No hook in the first 2 seconds = instant scroll. 'Best in town' with no proof. 'Like, follow, subscribe' is YouTube-brain, not TikTok. Hashtag-stuffing #viral never makes things viral."
      },
      {
        "text": "Check out our new collection! So excited to share these amazing pieces with you all. Link in bio to shop now! 🛍️✨ #fashion #style #ootd #shopping #love",
        "why": "Pure ad with no native format — no POV, no story, no on-screen hook. 'So excited / amazing' is empty enthusiasm. 'Link in bio' friction on a platform that rewards in-feed payoff."
      }
    ]
  },
  "telegram": {
    "good": [
      {
        "text": "🔥 Friday drop — Plov is ON\n\nFresh qazy plov out of the kazan at 1pm sharp. We make 40 portions, Fridays sell out by 2.\n\n• Portion: 35k so'm\n• Add qazy: +15k\n• Call-ahead pickup: 71-200-44-44\n\nReply to this message with your order and we'll set it aside. 🍛",
        "why": "Telegram = utility channel for regulars. Real menu/price list, a true scarcity fact (40 portions), a working pickup mechanic (reply to reserve). Scannable in chat, no fluff."
      },
      {
        "text": "📦 Restock alert — your size is back\n\nThe matte-black AirMax 90 (sizes 40–44) landed this morning. Last drop sold out in two days.\n\nPrice held at 890k so'm (no markup).\n\n👉 Send us the size and we'll hold it 24h. Located at Mega Planet, 1st floor near the fountain.",
        "why": "Notification-style headline does a real job (restock). Specific product, size range, price-hold promise, and a hold-it CTA. Landmark location ('near the fountain') is how locals actually navigate."
      }
    ],
    "bad": [
      {
        "text": "Hello dear subscribers! We hope you are having a wonderful day. Stay tuned to our channel for more exciting updates and offers coming soon. Thank you for your continued support! ❤️",
        "why": "Says nothing. No offer, no product, no action — a 'we'll post later' post that trains subscribers to mute. 'Stay tuned / coming soon' is the cardinal Telegram sin."
      },
      {
        "text": "🎉 BIG SALE!!! Don't miss our amazing discounts!!! Everything must go!!! Hurry up before it's too late!!! Limited time only!!! Shop now!!! 🎉🎉🎉",
        "why": "All caps, all exclamation, zero information — no item, no percentage, no date, no link. Reads like spam, gets reported/muted. Manufactured urgency with no real deadline or scope."
      }
    ]
  }
};

module.exports = {
  byPlatform: BY_PLATFORM,
  forPlatform(key) {
    const k = String(key || '').toLowerCase();
    return BY_PLATFORM[key] || BY_PLATFORM[k] || null;
  },
};
