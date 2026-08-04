import { metaFor } from '../lib/platforms';
import './CreatePost.css';

/**
 * Single-select channel row — reuses CreatePost's avatar-chip look (cp-avatar)
 * so the AI Generation and Edit Templates popups feel like the same app as
 * the composer they both feed into.
 */
export default function PlatformPicker({ catalogue, connectStatus, platformKey, onSelect }) {
  return (
    <div className="cp-channel-row">
      {catalogue.map((p) => {
        const m = metaFor(p.key);
        const isConnected = !!(connectStatus[p.key] && connectStatus[p.key].connected);
        return (
          <button
            key={p.key}
            type="button"
            className={`cp-avatar ${platformKey === p.key ? 'selected' : ''}`}
            style={{ '--ch-color': m.color }}
            onClick={() => onSelect(p.key)}
            title={isConnected ? p.label : `${p.label} (not connected)`}
            id={`btn_platform_pick_${p.key}`}
          >
            <i className={m.icon}></i>
          </button>
        );
      })}
    </div>
  );
}
