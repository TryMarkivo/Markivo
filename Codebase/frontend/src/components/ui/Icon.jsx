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
  sun: 'M10 6.5a3.5 3.5 0 110 7 3.5 3.5 0 010-7zM10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4',
  moon: 'M16.5 12.3A7 7 0 017.7 3.5a7 7 0 108.8 8.8z',
  menu: 'M3.5 6h13M3.5 10h13M3.5 14h13',
  chart: 'M4 16V10M10 16V4M16 16v-7',
  calendar: 'M4 6.5a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2v-8zM4 8.5h12M7.5 3v3M12.5 3v3',
  users: 'M7.5 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM2.5 16a5 5 0 0110 0M13 4.3a2.5 2.5 0 010 4.4M15 11.3a5 5 0 012.5 4.7',
  sliders: 'M3.5 6h8M15 6h1.5M3.5 14h1.5M8.5 14h8M13 4v4M6.5 12v4',
  logout: 'M8 4H5.5A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8M12 6.5L15.5 10 12 13.5M15.5 10H8',
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

// Platform marks, drawn inline so they never depend on an icon font.
const MARKS = {
  instagram: (
    <>
      <rect x="3" y="3" width="14" height="14" rx="4" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="10" cy="10" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="14.2" cy="5.8" r="1" fill="currentColor" />
    </>
  ),
  telegram: (
    <path d="M17.6 3.2L2.9 8.9c-.8.3-.8 1.2 0 1.5l3.6 1.2 1.4 4.4c.2.6.9.8 1.4.4l2-1.7 3.8 2.8c.6.4 1.4.1 1.5-.6l2.3-12.5c.1-.8-.6-1.4-1.3-1.2zM8.2 11.4l6.3-4.6-5 5.3-.3 2.4-1-3.1z" fill="currentColor" />
  ),
};

export function ChannelMark({ channel, size = 14 }) {
  const c = channelInfo(channel);
  const mark = MARKS[channel];
  if (!mark) return <i className={c.icon} style={{ color: c.color, fontSize: size, width: size, textAlign: 'center' }} aria-hidden="true"></i>;
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" style={{ color: c.color, flex: 'none' }} aria-hidden="true">
      {mark}
    </svg>
  );
}
