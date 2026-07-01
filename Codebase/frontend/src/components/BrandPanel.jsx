import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import './Brand.css';

// Tolerate BOTH brief shapes: rich (Claude-generated objects) and flat
// (template fallback strings/arrays) — mirrors backend brand.briefDigest.
const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const hexOf = (s) => {
  const m = String(s).match(/#[0-9a-fA-F]{3,8}/);
  return m ? m[0] : null;
};

const normFacts = (f = {}) => ({
  signatureItems: asArray(f.signatureItems).join(', '),
  pricePoints: f.pricePoints || '',
  hours: f.hours || '',
  bookingLink: f.bookingLink || '',
  phone: f.phone || '',
  offerType: (f.offer && f.offer.type) || '',
  offerValue: (f.offer && f.offer.value) || '',
  offerDeadline: (f.offer && f.offer.deadline) || '',
});

export default function BrandPanel({ activeProfile, onProfileUpdate }) {
  const { t } = useTranslation();
  const [brief, setBrief] = useState(activeProfile?.brandBrief || null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [savingFacts, setSavingFacts] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [facts, setFacts] = useState(() => normFacts(activeProfile?.brandBrief?.businessFacts));

  useEffect(() => {
    let live = true;
    api.get('/api/brand')
      .then((d) => {
        if (!live) return;
        setBrief(d.brandBrief || null);
        setFacts(normFacts(d.brandBrief?.businessFacts));
      })
      .catch((e) => { if (live) setError(e.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [activeProfile]);

  // Auto-dismiss the toast (setState in a timer, not synchronously in the effect).
  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const applyBrief = (next) => {
    setBrief(next);
    setFacts(normFacts(next?.businessFacts));
    onProfileUpdate?.({ ...activeProfile, brandBrief: next });
  };

  const regenerate = async () => {
    setRegenerating(true);
    setError('');
    try {
      const d = await api.post('/api/brand/generate');
      applyBrief(d.brandBrief);
      setToast(t('brand.regenerated', 'Brand identity refreshed.'));
    } catch (e) {
      setError(e.data?.error || e.message);
    } finally {
      setRegenerating(false);
    }
  };

  const saveFacts = async () => {
    setSavingFacts(true);
    setError('');
    const businessFacts = {
      signatureItems: facts.signatureItems.split(',').map((s) => s.trim()).filter(Boolean),
      pricePoints: facts.pricePoints.trim(),
      hours: facts.hours.trim(),
      bookingLink: facts.bookingLink.trim(),
      phone: facts.phone.trim(),
      offer: (facts.offerValue.trim() || facts.offerType.trim())
        ? { type: facts.offerType.trim(), value: facts.offerValue.trim(), deadline: facts.offerDeadline.trim() }
        : null,
    };
    try {
      const d = await api.put('/api/brand', { brandBrief: { businessFacts } });
      applyBrief(d.brandBrief);
      setToast(t('brand.factsSaved', 'Saved — Mark will use these real details (and never invent others).'));
    } catch (e) {
      setError(e.data?.error || e.message);
    } finally {
      setSavingFacts(false);
    }
  };

  const setF = (k) => (e) => setFacts((s) => ({ ...s, [k]: e.target.value }));

  if (loading) {
    return (
      <div className="brand-panel animate-fade-in">
        <div className="brand-loading text-center">
          <i className="fa-solid fa-spinner fa-spin fa-2x text-accent"></i>
          <p className="mt-20 text-muted">{t('brand.loading', 'Loading your brand identity…')}</p>
        </div>
      </div>
    );
  }

  // ---- derived, shape-tolerant views ----
  const vd = (brief && brief.visualDirection) || {};
  const palette = brief ? (asArray(brief.palette).length ? asArray(brief.palette) : asArray(vd.palette)) : [];
  const imagery = brief ? (brief.imageryStyle || vd.imageryStyle) : '';
  const taglines = brief ? (asArray(brief.taglineOptions).length ? asArray(brief.taglineOptions) : asArray(brief.tagline)) : [];
  const persona = brief && brief.persona;

  return (
    <div className="brand-panel animate-fade-in">
      <div className="brand-head">
        <div>
          <h2 className="brand-title">
            <i className="fa-solid fa-fingerprint text-accent"></i> {t('brand.title', 'Brand Identity')}
          </h2>
          <p className="panel-subtitle">
            {t('brand.subtitle', 'The brand brief Mark reads on every post, caption, and design — so everything sounds like you.')}
          </p>
        </div>
        <button className="btn btn-primary" onClick={regenerate} disabled={regenerating} id="btn_brand_regenerate">
          {regenerating
            ? <><i className="fa-solid fa-spinner fa-spin"></i> {t('brand.regenerating', 'Thinking…')}</>
            : <><i className="fa-solid fa-wand-magic-sparkles"></i> {brief ? t('brand.regenerate', 'Regenerate') : t('brand.generate', 'Generate brand identity')}</>}
        </button>
      </div>

      {error && (
        <div className="brand-error" role="alert">
          <i className="fa-solid fa-triangle-exclamation"></i> {error}
        </div>
      )}

      {!brief ? (
        <div className="brand-empty glass-card">
          <i className="fa-solid fa-fingerprint fa-2x text-accent"></i>
          <p>{t('brand.emptyBody', 'No brand brief yet. Generate one — Mark will build your positioning, voice, audience, content pillars and visual direction from your business profile.')}</p>
        </div>
      ) : (
        <>
          <div className="brand-grid">
            {/* Positioning + value */}
            <section className="brand-card glass-card brand-span-2">
              <h3 className="brand-card-title">{t('brand.positioning', 'Positioning')}</h3>
              <p className="brand-lead">{brief.positioning}</p>
              {brief.valueProposition && <p className="text-muted">{brief.valueProposition}</p>}
              {brief.elevatorPitch && (
                <p className="brand-pitch"><i className="fa-solid fa-quote-left"></i> {brief.elevatorPitch}</p>
              )}
            </section>

            {/* USP */}
            {asArray(brief.usp).length > 0 && (
              <section className="brand-card glass-card">
                <h3 className="brand-card-title">{t('brand.usp', 'What makes you different')}</h3>
                <ul className="brand-list">
                  {asArray(brief.usp).map((u, i) => <li key={i}>{u}</li>)}
                </ul>
              </section>
            )}

            {/* Voice */}
            <section className="brand-card glass-card">
              <h3 className="brand-card-title">{t('brand.voice', 'Voice & tone')}</h3>
              {brief.archetype && <p className="brand-archetype">{brief.archetype}</p>}
              <div className="brand-chips">
                {asArray(brief.voiceAdjectives).map((a, i) => <span className="brand-chip" key={i}>{a}</span>)}
              </div>
              {asArray(brief.voiceDo).length > 0 && (
                <div className="brand-dodont">
                  <p className="brand-do"><b>{t('brand.do', 'Do')}</b></p>
                  <ul className="brand-list">{asArray(brief.voiceDo).map((d, i) => <li key={i}>{d}</li>)}</ul>
                </div>
              )}
              {asArray(brief.voiceDont).length > 0 && (
                <div className="brand-dodont">
                  <p className="brand-dont"><b>{t('brand.dont', "Don't")}</b></p>
                  <ul className="brand-list">{asArray(brief.voiceDont).map((d, i) => <li key={i}>{d}</li>)}</ul>
                </div>
              )}
            </section>

            {/* Persona */}
            {persona && (
              <section className="brand-card glass-card">
                <h3 className="brand-card-title">{t('brand.persona', 'Who you serve')}</h3>
                {typeof persona === 'string' ? (
                  <p>{persona}</p>
                ) : (
                  <>
                    {persona.name && <p className="brand-persona-name">{persona.name}</p>}
                    {persona.demographics && <p className="text-muted">{persona.demographics}</p>}
                    {persona.context && <p><b>{t('brand.moment', 'Moment')}:</b> {persona.context}</p>}
                    {persona.motivations && <p><b>{t('brand.wants', 'Wants')}:</b> {persona.motivations}</p>}
                    {persona.objections && <p><b>{t('brand.objection', 'Objection')}:</b> {persona.objections}</p>}
                    {persona.languageNote && <p className="text-muted"><i className="fa-solid fa-language"></i> {persona.languageNote}</p>}
                  </>
                )}
              </section>
            )}

            {/* Content pillars */}
            {asArray(brief.contentPillars).length > 0 && (
              <section className="brand-card glass-card brand-span-2">
                <h3 className="brand-card-title">{t('brand.pillars', 'Content pillars')}</h3>
                <div className="brand-pillars">
                  {asArray(brief.contentPillars).map((p, i) => {
                    const name = typeof p === 'string' ? p : p.name;
                    const purpose = typeof p === 'object' ? p.purpose : '';
                    const angles = typeof p === 'object' ? asArray(p.exampleAngles) : [];
                    return (
                      <div className="brand-pillar" key={i}>
                        <div className="brand-pillar-head">
                          <strong>{name}</strong>
                          {purpose && <span className="brand-chip subtle">{purpose}</span>}
                        </div>
                        {angles.length > 0 && <ul className="brand-list small">{angles.map((a, j) => <li key={j}>{a}</li>)}</ul>}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Visual direction */}
            {(palette.length > 0 || imagery) && (
              <section className="brand-card glass-card brand-span-2">
                <h3 className="brand-card-title">{t('brand.visual', 'Visual direction')}</h3>
                {palette.length > 0 && (
                  <div className="brand-swatches">
                    {palette.map((c, i) => {
                      const hex = hexOf(c);
                      return (
                        <div className="brand-swatch" key={i}>
                          <span className="brand-swatch-dot" style={{ background: hex || 'var(--accent-primary)' }}></span>
                          <span className="brand-swatch-label">{c}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {imagery && <p className="text-muted"><i className="fa-solid fa-camera"></i> {imagery}</p>}
                {taglines.length > 0 && (
                  <div className="brand-taglines">
                    <b>{t('brand.taglines', 'Tagline ideas')}:</b>
                    <div className="brand-chips">{taglines.map((tg, i) => <span className="brand-chip" key={i}>{tg}</span>)}</div>
                  </div>
                )}
              </section>
            )}
          </div>

          {/* Business facts — the ONLY source of real numbers Mark may use */}
          <section className="brand-card glass-card brand-facts">
            <h3 className="brand-card-title">{t('brand.facts', 'Business facts')}</h3>
            <p className="panel-subtitle">
              {t('brand.factsHelp', 'Add your real details so Mark can write specific, true posts — it will never invent prices, hours, or numbers you haven\'t given.')}
            </p>
            <div className="brand-facts-grid">
              <label className="brand-field brand-field-wide">
                <span>{t('brand.signatureItems', 'Signature items / services')}</span>
                <input value={facts.signatureItems} onChange={setF('signatureItems')} placeholder={t('brand.signaturePh', 'e.g. cardamom bun, flat white, beard trim')} />
              </label>
              <label className="brand-field">
                <span>{t('brand.prices', 'Price points')}</span>
                <input value={facts.pricePoints} onChange={setF('pricePoints')} placeholder={t('brand.pricesPh', 'e.g. coffee from 18,000 so’m')} />
              </label>
              <label className="brand-field">
                <span>{t('brand.hours', 'Opening hours')}</span>
                <input value={facts.hours} onChange={setF('hours')} placeholder={t('brand.hoursPh', 'e.g. 8:00–22:00 daily')} />
              </label>
              <label className="brand-field">
                <span>{t('brand.booking', 'Booking / order link')}</span>
                <input value={facts.bookingLink} onChange={setF('bookingLink')} placeholder="https://…" />
              </label>
              <label className="brand-field">
                <span>{t('brand.phone', 'Phone')}</span>
                <input value={facts.phone} onChange={setF('phone')} placeholder="+998 …" />
              </label>
            </div>

            <div className="brand-offer">
              <span className="brand-offer-label">{t('brand.offer', 'Current offer (optional)')}</span>
              <div className="brand-facts-grid">
                <label className="brand-field">
                  <span>{t('brand.offerType', 'Type')}</span>
                  <input value={facts.offerType} onChange={setF('offerType')} placeholder={t('brand.offerTypePh', 'discount, freebie, combo…')} />
                </label>
                <label className="brand-field">
                  <span>{t('brand.offerValue', 'Value')}</span>
                  <input value={facts.offerValue} onChange={setF('offerValue')} placeholder={t('brand.offerValuePh', 'e.g. 20% off, free pastry')} />
                </label>
                <label className="brand-field">
                  <span>{t('brand.offerDeadline', 'Until')}</span>
                  <input value={facts.offerDeadline} onChange={setF('offerDeadline')} placeholder={t('brand.offerDeadlinePh', 'e.g. Sunday')} />
                </label>
              </div>
            </div>

            <button className="btn btn-secondary mt-10" onClick={saveFacts} disabled={savingFacts} id="btn_brand_save_facts">
              {savingFacts
                ? <><i className="fa-solid fa-spinner fa-spin"></i> {t('common.saving', 'Saving…')}</>
                : <><i className="fa-solid fa-floppy-disk"></i> {t('brand.saveFacts', 'Save facts')}</>}
            </button>
          </section>
        </>
      )}

      {toast && (
        <div className="brand-toast" role="status">
          <i className="fa-solid fa-circle-check"></i> {toast}
        </div>
      )}
    </div>
  );
}
