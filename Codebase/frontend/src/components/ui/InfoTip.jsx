import { useId } from 'react';

/**
 * A small "i" next to a heading. Its explanation shows on hover, on keyboard
 * focus, or on tap (focus) on phones, so the text is there when wanted
 * without a subtitle under every title.
 */
export default function InfoTip({ text, label }) {
  const id = useId();
  if (!text) return null;
  return (
    <span className="ui-info">
      <button type="button" className="ui-info-btn" aria-describedby={id} aria-label={label || 'Info'}>
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <circle cx="10" cy="10" r="7.25" />
          <path d="M10 9v4.5M10 6.5h.01" />
        </svg>
      </button>
      <span role="tooltip" id={id} className="ui-info-tip">{text}</span>
    </span>
  );
}
