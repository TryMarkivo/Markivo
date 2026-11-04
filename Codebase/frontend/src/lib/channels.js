// Channels a post can go to, with their display name and brand mark.
const CHANNELS = {
  instagram: { label: 'Instagram', icon: 'fa-brands fa-instagram', color: 'var(--ui-instagram)' },
  telegram: { label: 'Telegram', icon: 'fa-brands fa-telegram', color: 'var(--ui-telegram)' },
};

export const channelInfo = (key) => CHANNELS[key] || {
  label: key ? key[0].toUpperCase() + key.slice(1) : '',
  icon: 'fa-solid fa-share-nodes',
  color: 'var(--ui-ink-3)',
};
