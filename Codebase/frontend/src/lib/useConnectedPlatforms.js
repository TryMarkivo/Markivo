import { useEffect, useState } from 'react';
import api from './api';
import { FALLBACK_CATALOGUE } from './platforms';

/**
 * Connected-channel picker state, shared by every screen that needs "which of
 * my channels am I writing this for" — originally the AI Content Engine's own
 * platform tabs, now also the Calendar's AI Generation and Edit Templates
 * popups. Mirrors ContentEngine.jsx's fetch/selection logic exactly so all
 * three behave identically.
 */
export default function useConnectedPlatforms(activeProfile, initialPlatformKey = null) {
  const [catalogue, setCatalogue] = useState(null);
  const [connectStatus, setConnectStatus] = useState({});
  const [hasConnections, setHasConnections] = useState(true);
  const [platformKey, setPlatformKey] = useState(initialPlatformKey);

  useEffect(() => {
    api.get('/api/connect/status')
      .then((data) => {
        const all = data.catalogue && data.catalogue.length ? data.catalogue : FALLBACK_CATALOGUE;
        const status = data.status || {};
        // The menu lists only CONNECTED platforms — every social network works
        // differently, and there is no point offering a composer for a channel
        // that cannot receive the post. Nothing connected yet falls back to the
        // full list so the picker is still explorable.
        const connected = all.filter((p) => status[p.key] && status[p.key].connected);
        const menu = connected.length ? connected : all;
        setCatalogue(menu);
        setConnectStatus(status);
        setHasConnections(connected.length > 0);
        setPlatformKey((current) => {
          if (current && menu.some((p) => p.key === current)) return current;
          if (initialPlatformKey && menu.some((p) => p.key === initialPlatformKey)) return initialPlatformKey;
          return menu[0].key;
        });
      })
      .catch(() => {
        setCatalogue(FALLBACK_CATALOGUE);
        setPlatformKey((current) => current || initialPlatformKey || FALLBACK_CATALOGUE[0].key);
      });
  }, [activeProfile, initialPlatformKey]);

  const platform = catalogue && platformKey ? catalogue.find((p) => p.key === platformKey) : null;

  return { catalogue, connectStatus, hasConnections, platformKey, setPlatformKey, platform };
}
