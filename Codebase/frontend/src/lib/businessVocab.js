// A profile stores its category and brand tone as the English option text the
// wizard offered (the backend's prompts and lookups key off those exact
// strings). These map a stored value back to its translation key for display,
// falling through to the stored text for anything typed in by hand.

const CATEGORY_KEYS = {
  'Cafe / Coffee Shop': 'cafe',
  'Beauty Salon / Spa': 'beauty',
  'Co-working & Study Space': 'coworking',
  'Retail Boutique / Fashion': 'retail',
  'Local Restaurant / Food': 'restaurant',
  'Professional Tech Agency': 'tech',
};

const TONE_KEYS = {
  'Cozy & Warm': 'cozy',
  'Modern & Minimalist': 'modern',
  'Energetic & Fast-paced': 'energetic',
  'Professional & Trustworthy': 'professional',
  'Playful & Fun': 'playful',
  'Luxury & Premium': 'luxury',
};

export const categoryLabel = (t, value) =>
  CATEGORY_KEYS[value] ? t(`onboarding.categories.${CATEGORY_KEYS[value]}`, value) : value;

export const toneLabel = (t, value) =>
  TONE_KEYS[value] ? t(`onboarding.tones.${TONE_KEYS[value]}`, value) : value;

// An online business is stored with this location (backend onboarding/construct).
export const locationLabel = (t, value) =>
  value === 'Online / Remote' ? t('dashboard.onlineLocation', value) : value;
