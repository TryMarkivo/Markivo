import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import LanguageSelector from './LanguageSelector';
import ThemeToggle from './ThemeToggle';
import ConnectionsPanel from './ConnectionsPanel';
import api from '../lib/api';
import './SettingsPane.css';

/**
 * Dashboard Settings tab: appearance (theme + language), platform
 * connections, and account basics — including the account deletion described
 * in the published policy at /data-deletion.html.
 */
export default function SettingsPane({ activeProfile, theme, onToggleTheme, onLanguageChange, onLogout }) {
  const { t } = useTranslation();

  // Deletion is irreversible, so it is gated behind typing the word DELETE
  // rather than a single click that could be hit by accident.
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const CONFIRM_WORD = t('settings.danger.confirmWord', 'DELETE');
  const canDelete = typed.trim().toUpperCase() === CONFIRM_WORD.toUpperCase();

  const cancel = () => {
    setConfirming(false);
    setTyped('');
    setError('');
  };

  const handleDelete = async () => {
    if (!canDelete || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.deleteAccount();
      // Show the confirmation code before the session tears down — it is the
      // only way to check the erasure afterwards.
      window.alert(
        t('settings.danger.done', {
          defaultValue:
            'Your account and all associated data have been permanently deleted.\n\nConfirmation code: {{code}}\n\nKeep this code — you can check the deletion at /data-deletion.html',
          code: res.confirmationCode,
        })
      );
      onLogout?.();
    } catch (err) {
      setError(err.message || t('settings.danger.failed', 'Could not delete your account. Please try again.'));
      setBusy(false);
    }
  };

  return (
    <div className="settings-pane animate-fade-in">
      <h2 className="settings-title">{t('settings.title', 'Settings')}</h2>

      {/* APPEARANCE */}
      <section className="settings-section glass-card">
        <h3><i className="fa-solid fa-palette text-accent"></i> {t('settings.appearance', 'Appearance')}</h3>
        <div className="settings-row">
          <span>{t('settings.theme', 'Theme')}</span>
          <div className="settings-row-control">
            <span className="settings-muted">{theme === 'dark' ? t('settings.dark', 'Dark') : t('settings.light', 'Light')}</span>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          </div>
        </div>
        <div className="settings-row">
          <span>{t('settings.language', 'Language')}</span>
          <LanguageSelector onChange={onLanguageChange} />
        </div>
      </section>

      {/* PLATFORM CONNECTIONS */}
      <ConnectionsPanel activeProfile={activeProfile} />

      {/* DANGER ZONE */}
      <section className="settings-section glass-card settings-danger">
        <h3><i className="fa-solid fa-triangle-exclamation"></i> {t('settings.danger.title', 'Danger zone')}</h3>
        <p className="settings-muted">
          {t('settings.danger.blurb', 'Deleting your account permanently erases your business profiles, all content and uploaded media, every platform connection, and your history. This cannot be undone.')}
          {' '}
          <a href="/data-deletion.html" target="_blank" rel="noopener noreferrer">
            {t('settings.danger.learnMore', 'What gets deleted')}
          </a>
        </p>

        {!confirming ? (
          <button className="btn btn-danger" onClick={() => setConfirming(true)} id="btn_delete_account">
            {t('settings.danger.deleteAccount', 'Delete account')}
          </button>
        ) : (
          <div className="settings-danger-confirm">
            <label htmlFor="delete_confirm">
              {t('settings.danger.prompt', { defaultValue: 'Type {{word}} to confirm:', word: CONFIRM_WORD })}
            </label>
            <input
              id="delete_confirm"
              type="text"
              value={typed}
              autoComplete="off"
              onChange={(e) => setTyped(e.target.value)}
              placeholder={CONFIRM_WORD}
              disabled={busy}
            />
            <div className="settings-danger-actions">
              <button className="btn btn-danger" onClick={handleDelete} disabled={!canDelete || busy}>
                {busy
                  ? t('settings.danger.deleting', 'Deleting…')
                  : t('settings.danger.confirmDelete', 'Permanently delete')}
              </button>
              <button className="btn btn-secondary" onClick={cancel} disabled={busy}>
                {t('common.cancel', 'Cancel')}
              </button>
            </div>
            {error && <p className="settings-danger-error">{error}</p>}
          </div>
        )}
      </section>
    </div>
  );
}
