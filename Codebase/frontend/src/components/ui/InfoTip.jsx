import { useId, useRef } from 'react';

const EDGE = 12; // keep this much space between the tip and the screen edge

/**
 * A small "i" next to a heading. Its explanation shows on hover, on keyboard
 * focus, or on tap (focus) on phones, so the text is there when wanted
 * without a subtitle under every title. When it opens near the right edge of
 * the screen it slides left so it never runs off it.
 */
export default function InfoTip({ text, label }) {
  const id = useId();
  const tipRef = useRef(null);

  const keepOnScreen = () => {
    const tip = tipRef.current;
    if (!tip) return;
    tip.style.transform = '';
    requestAnimationFrame(() => {
      const r = tip.getBoundingClientRect();
      const over = r.right - (window.innerWidth - EDGE);
      if (over > 0) tip.style.transform = `translateX(${-Math.min(over, r.left - EDGE)}px)`;
    });
  };

  if (!text) return null;
  return (
    <span className="ui-info" onMouseEnter={keepOnScreen}>
      <button type="button" className="ui-info-btn" aria-describedby={id} aria-label={label || 'Info'} onFocus={keepOnScreen}>
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <circle cx="10" cy="10" r="7.25" />
          <path d="M10 9v4.5M10 6.5h.01" />
        </svg>
      </button>
      <span role="tooltip" id={id} className="ui-info-tip" ref={tipRef}>{text}</span>
    </span>
  );
}
