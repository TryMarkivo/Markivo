import { channelInfo } from '../../lib/channels';

// Small line icons for the redesigned screens, drawn on a 20px grid with a
// 1.6 stroke so they sit on the text baseline at 14–16px type. Platform logos
// (Instagram, Telegram) stay as brand marks; everything else lives here.

const PATHS = {
  plus: 'M10 4v12M4 10h12',
  close: 'M5 5l10 10M15 5L5 15',
  chevronLeft: 'M12.5 4.5L7 10l5.5 5.5',
  chevronRight: 'M7.5 4.5L13 10l-5.5 5.5',
  check: 'M4.5 10.5l3.5 3.5 7.5-8',
  clock: 'M10 6v4l2.5 1.5M17 10a7 7 0 11-14 0 7 7 0 0114 0z',
  repeat: 'M4 9V8a3 3 0 013-3h9m0 0l-2.5-2.5M16 5l-2.5 2.5M16 11v1a3 3 0 01-3 3H4m0 0l2.5 2.5M4 15l2.5-2.5',
  image: 'M3.5 5.5a2 2 0 012-2h9a2 2 0 012 2v9a2 2 0 01-2 2h-9a2 2 0 01-2-2v-9zM3.5 13l3.5-3.5 3 3 2-2 4.5 4.5M12.5 7.5h.01',
  sparkle: 'M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6L10 3zM15.5 13.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6.6-1.4z',
  template: 'M4 4.5h12M4 8.5h8M4 12.5h12M4 16.5h6',
  trash: 'M4 6h12M8 6V4.5h4V6M6 6l.7 10h6.6L14 6',
  spinner: 'M10 3a7 7 0 107 7',
  send: 'M3.5 10l13-6-4.5 13-2.5-5.5L3.5 10z',
  robot: 'M6 8h8a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4a2 2 0 012-2zM10 8V5M8 12h.01M12 12h.01',
};

export default function Icon({ name, size = 16, className = '' }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`${name === 'spinner' ? 'ui-spin ' : ''}${className}`}
    >
      <path d={d} />
    </svg>
  );
}

// Platform marks stay as Font Awesome brand glyphs (loaded app-wide) so they
// match the logos people know; coloured from the UI tokens.
export function ChannelMark({ channel, size = 14 }) {
  const c = channelInfo(channel);
  return <i className={c.icon} style={{ color: c.color, fontSize: size, width: size, textAlign: 'center' }} aria-hidden="true"></i>;
}
