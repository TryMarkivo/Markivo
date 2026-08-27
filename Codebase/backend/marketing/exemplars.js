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
