import { useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import api from '../lib/api';
import './LandingPage.css';
import logoUrl from '../assets/markivo-logo.png';

// The hero shows the product's own opening composition rather than a mock
// browser window: the warp band of channels over the day's queue. It is
// illustrative — the numbers below are sample content, not customer data.
const DEMO_CHANNELS = [
  { key: 'instagram', label: 'Instagram', icon: 'fa-brands fa-instagram', state: 'live' },
  { key: 'telegram', label: 'Telegram', icon: 'fa-brands fa-telegram', state: 'live' },
  { key: 'google', label: 'Google', icon: 'fa-brands fa-google', state: 'sim' },
  { key: 'tiktok', label: 'TikTok', icon: 'fa-brands fa-tiktok', state: 'off' },
];

export default function LandingPage({ onStartOnboarding, onOpenLogin, isLoggedIn, controls }) {
  const { t } = useTranslation();
  const [billingPeriod, setBillingPeriod] = useState('monthly'); // 'monthly' | 'yearly'

  const pricing = {
    freemium: { monthly: 0, yearly: 0 },
    pro: { monthly: 20, yearly: 16 },
    ultimate: { monthly: 50, yearly: 40 },
  };

  // Pricing CTA: logged-out users go through the register flow; logged-in
  // users hit billing checkout (Stripe redirect or instant simulated upgrade).
  const handlePlanClick = async (tier) => {
    if (!isLoggedIn) {
      onStartOnboarding('B');
      return;
    }
    if (tier === 'freemium') {
      onStartOnboarding('dashboard');
      return;
    }
    try {
      const data = await api.post('/api/billing/checkout', { tier });
      if (data.url) {
        window.location.assign(data.url);
        return;
      }
    } catch (err) {
      console.warn('Billing checkout failed:', err);
    }
    onStartOnboarding('dashboard');
  };

  const demoQueue = [
    { time: '09:00', ch: 'Instagram', state: 'live', text: t('landing.preview.q1', 'Morning roast is on — first fifty cups half price.') },
    { time: '13:00', ch: 'Telegram', state: 'live', text: t('landing.preview.q2', 'Bugun tushlik menyusi: lagʻmon va shirin choy.') },
    { time: '18:30', ch: 'Instagram', state: 'queued', text: t('landing.preview.q3', 'Study booths free all evening. Wi-Fi is fast, coffee is faster.') },
  ];

  return (
    <div className="landing">
      {/* --- HEADER --- */}
      <header className="landing-header">
        <div className="logo-text">
          <img src={logoUrl} alt={t('common.brandName', 'Markivo')} className="logo-img" />
          Markivo
        </div>
        <nav className="header-nav">
          <a href="#how">{t('landing.nav.how', 'How it works')}</a>
          <a href="#features">{t('landing.nav.features', 'Features')}</a>
          <a href="#pricing">{t('landing.nav.pricing', 'Pricing')}</a>
        </nav>
        {/* Language + theme live IN the header here. Left as fixed floating
            controls they landed on top of the sign-in buttons. */}
        <div className="header-actions">
          {controls}
          {isLoggedIn ? (
            <button className="btn btn-primary btn-sm" onClick={() => onStartOnboarding('dashboard')} id="btn_goto_dash">
              {t('landing.header.goToDashboard', 'Open dashboard')}
            </button>
          ) : (
            <>
              <button className="btn btn-ghost btn-sm" onClick={onOpenLogin} id="btn_login_showcase">
                {t('auth.login', 'Sign in')}
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => onStartOnboarding('B')} id="btn_get_started_header">
                {t('landing.header.getStarted', 'Get started')}
              </button>
            </>
          )}
        </div>
      </header>

      {/* --- HERO --- */}
      <section className="hero">
        <div className="hero-copy">
          <h1 className="hero-title">
            {t('landing.hero.title', 'Your business posts every day. You do not.')}
          </h1>
          <p className="hero-sub">
            {t('landing.hero.subtitle', 'Markivo writes the copy, holds the queue, and publishes to Instagram and Telegram from one business profile you fill in once — in Uzbek, Russian and English, in the order you choose.')}
          </p>
          <div className="hero-actions">
            {isLoggedIn ? (
              <button className="btn btn-primary" onClick={() => onStartOnboarding('dashboard')} id="btn_hero_cta">
                {t('landing.hero.ctaDashboard', 'Open my dashboard')}
                <i className="fa-solid fa-arrow-right" aria-hidden="true"></i>
              </button>
            ) : (
              <>
                <button className="btn btn-primary" onClick={() => onStartOnboarding('B')} id="btn_hero_cta">
                  {t('landing.hero.ctaBuild', 'Start from zero')}
                  <i className="fa-solid fa-arrow-right" aria-hidden="true"></i>
                </button>
                <button className="btn btn-secondary" onClick={() => onStartOnboarding('A')} id="btn_hero_discover">
                  {t('landing.hero.ctaScan', 'Scan what I already have')}
                </button>
              </>
            )}
          </div>
          <p className="hero-langs">
            <span className="label">{t('landing.hero.langsLabel', 'Publishes in')}</span>
            O&lsquo;zbekcha · Русский · English
          </p>
        </div>

        {/* The product's actual opening composition, at hero scale. */}
        <div className="hero-demo" aria-label={t('landing.preview.aria', 'Product preview')}>
          <div className="hero-demo-head">
            <span className="label">{t('landing.preview.demoBrand', 'Cafe Noir · Tashkent')}</span>
            <span className="label">{t('landing.preview.sample', 'Sample')}</span>
          </div>

          <div className="warp">
            {DEMO_CHANNELS.map((c) => (
              <div key={c.key} className={`warp-stripe is-${c.state} ${c.state === 'sim' ? 'frayed' : ''}`}>
                <span className="warp-name"><i className={c.icon} aria-hidden="true"></i></span>
                <span className="warp-state">
                  {c.state === 'live'
                    ? t('landing.preview.live', 'Live')
                    : c.state === 'sim'
                      ? t('truth.simulated', 'Simulated')
                      : t('dashboard.warp.notConnected', 'Off')}
                </span>
              </div>
            ))}
          </div>

          <ul className="hero-queue">
            {demoQueue.map((row) => (
              <li key={row.time} className={`hero-queue-row is-${row.state}`}>
                <span className="num hero-queue-time">{row.time}</span>
                <span className="hero-queue-ch">{row.ch}</span>
                <span className="hero-queue-text">{row.text}</span>
                <span className={`stamp stamp-${row.state}`}>
                  {row.state === 'live' ? t('dashboard.queue.status.live', 'Posted') : t('dashboard.queue.status.queued', 'Queued')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* --- THE PROBLEM ---
          One argument, laid out as a stated case rather than three identical
          icon cards. --- */}
      <section className="argument">
        <h2 className="section-head">
          {t('landing.problem.title', 'Millions of businesses have no marketing — and no idea where to start.')}
        </h2>
        <div className="argument-rows">
          <div className="argument-row">
            <h3>{t('landing.problem.card1Title', 'No team, no time')}</h3>
            <p>{t('landing.problem.card1Text', 'Owner-operators do everything themselves. Marketing falls to the bottom of the list — or never happens at all.')}</p>
          </div>
          <div className="argument-row">
            <h3>{t('landing.problem.card2Title', 'Tools assume you exist')}</h3>
            <p>{t('landing.problem.card2Text', 'HubSpot, Hootsuite and the rest are built for businesses that already have a presence, a budget, and a marketer.')}</p>
          </div>
          <div className="argument-row">
            <h3>{t('landing.problem.card3Title', 'Emerging markets ignored')}</h3>
            <p>{t('landing.problem.card3Text', "In Uzbekistan, Central Asia and the CIS, businesses are hungry for digital growth — but the tools aren't in their language.")}</p>
          </div>
        </div>
        <p className="argument-close">
          <Trans i18nKey="landing.problem.gap">
            The gap: every existing tool helps you <em>manage</em> marketing. None of them <strong>start it for you.</strong>
          </Trans>
        </p>
      </section>

      {/* --- TWO PATHS --- */}
      <section className="paths" id="how">
        <h2 className="section-head">{t('landing.paths.title', "Two paths. One outcome: a business that's fully online.")}</h2>
        <p className="section-sub">{t('landing.paths.subtitle', 'Markivo either discovers your existing presence — or builds one from scratch — then runs it.')}</p>

        <div className="paths-grid">
          <div className="path-panel">
            <h3>{t('landing.paths.pathATitle', '"I already have something"')}</h3>
            <ol className="path-steps">
              <li>{t('landing.paths.pathAStep1', 'Scan the web for accounts, maps listing, reviews & ads')}</li>
              <li>{t('landing.paths.pathAStep2', 'See everything found in a confirm / reject view')}</li>
              <li>{t('landing.paths.pathAStep3', 'Connect verified platforms securely')}</li>
              <li>{t('landing.paths.pathAStep4', 'Dashboard fills with live data instantly')}</li>
            </ol>
            <button className="btn btn-secondary btn-block" onClick={() => onStartOnboarding('A')} id="btn_path_a">
              {t('landing.paths.pathACta', 'Scan my presence')}
            </button>
          </div>
          <div className="path-panel is-primary">
            <h3>{t('landing.paths.pathBTitle', '"I have nothing yet"')}</h3>
            <ol className="path-steps">
              <li>{t('landing.paths.pathBStep1', 'Guided wizard: category, brand tone, audience')}</li>
              <li>{t('landing.paths.pathBStep2', 'AI generates your slogan + logo, on brand')}</li>
              <li>{t('landing.paths.pathBStep3', 'Sets up Google Business & social channels')}</li>
              <li>{t('landing.paths.pathBStep4', 'Builds the first content calendar — then posts')}</li>
            </ol>
            <button className="btn btn-primary btn-block" onClick={() => onStartOnboarding('B')} id="btn_path_b">
              {t('landing.paths.pathBCta', 'Build from scratch')}
            </button>
          </div>
        </div>
        <p className="section-sub paths-outro">
          <Trans i18nKey="landing.paths.outro">
            Once set up, <strong>Markiv</strong> — your AI agent — takes over the day-to-day: content, inbox, analytics and growth. Day after day.
          </Trans>
        </p>
      </section>

      {/* --- FEATURES ---
          A seamed index, not six shadowed tiles. --- */}
      <section className="features" id="features">
        <h2 className="section-head">{t('landing.features.title', 'One platform replaces an entire marketing stack.')}</h2>

        <dl className="feature-index">
          <div className="feature-entry">
            <dt>{t('landing.features.brandTitle', 'Brand & identity')}</dt>
            <dd>{t('landing.features.brandText', 'AI logo, slogan and tone-of-voice generated in seconds — a complete identity before your first post.')}</dd>
          </div>
          <div className="feature-entry">
            <dt>{t('landing.features.postingTitle', 'Multi-platform posting')}</dt>
            <dd>{t('landing.features.postingText', 'Instagram, TikTok, Telegram, X & Google — written, scheduled and published from one place.')}</dd>
          </div>
          <div className="feature-entry">
            <dt>{t('landing.features.contentTitle', 'Content engine')}</dt>
            <dd>{t('landing.features.contentText', 'Shoot tips, automatic photo & video enhancement, and AI-generated video tuned to each platform.')}</dd>
          </div>
          <div className="feature-entry">
            <dt>{t('landing.features.inboxTitle', 'Inbox agent')}</dt>
            <dd>{t('landing.features.inboxText', 'Gmail summarized, sorted and auto-replied — and it learns your answers as it goes.')}</dd>
          </div>
          <div className="feature-entry">
            <dt>{t('landing.features.seoTitle', 'SEO + AI search')}</dt>
            <dd>{t('landing.features.seoText', 'Rank on Google — and surface inside ChatGPT & Perplexity, where your customers now search.')}</dd>
          </div>
          <div className="feature-entry">
            <dt>{t('landing.features.intelTitle', 'Competitor intel')}</dt>
            <dd>{t('landing.features.intelText', "Track rivals' posting, growth and gaps automatically — and get moves to counter them.")}</dd>
          </div>
        </dl>
      </section>

      {/* --- PRICING --- */}
      <section className="pricing" id="pricing">
        <h2 className="section-head">{t('landing.pricing.title', 'Start free. Pay when it is doing the work.')}</h2>

        <div className="billing-selector" role="group" aria-label={t('landing.pricing.periodAria', 'Billing period')}>
          <button
            className={`billing-btn ${billingPeriod === 'monthly' ? 'active' : ''}`}
            onClick={() => setBillingPeriod('monthly')}
            aria-pressed={billingPeriod === 'monthly'}
          >
            {t('landing.pricing.monthly', 'Monthly')}
          </button>
          <button
            className={`billing-btn ${billingPeriod === 'yearly' ? 'active' : ''}`}
            onClick={() => setBillingPeriod('yearly')}
            aria-pressed={billingPeriod === 'yearly'}
          >
            {t('landing.pricing.yearly', 'Yearly')}
            <span className="discount-badge">{t('landing.pricing.save20', '−20%')}</span>
          </button>
        </div>

        <div className="pricing-grid">
          {/* FREE */}
          <div className="price-panel">
            <h3>{t('landing.pricing.free.name', 'Free')}</h3>
            <p className="plan-description">{t('landing.pricing.free.desc', 'Everything needed to get online')}</p>
            <p className="plan-price num">
              <span className="price-number">$0</span>
              <span className="price-duration">{t('landing.pricing.perMonth', '/mo')}</span>
            </p>
            <ul className="plan-features">
              <li>{t('landing.pricing.free.feat1', 'Full onboarding — both paths')}</li>
              <li>{t('landing.pricing.free.feat2', 'AI logo & slogan generation')}</li>
              <li>{t('landing.pricing.free.feat3', 'Google Business setup')}</li>
              <li>{t('landing.pricing.free.feat4', 'Social channels connected')}</li>
              <li>{t('landing.pricing.free.feat5', '25 AI generations / month')}</li>
            </ul>
            <button className="btn btn-secondary btn-block" onClick={() => handlePlanClick('freemium')} id="btn_plan_free">
              {t('landing.pricing.free.cta', 'Get started free')}
            </button>
          </div>

          {/* PRO */}
          <div className="price-panel is-primary">
            <span className="stamp stamp-action popular-badge">{t('landing.pricing.pro.badge', 'Most value')}</span>
            <h3>{t('landing.pricing.pro.name', 'Pro')}</h3>
            <p className="plan-description">{t('landing.pricing.pro.desc', 'For active, growing businesses')}</p>
            <p className="plan-price num">
              <span className="price-number">${pricing.pro[billingPeriod]}</span>
              <span className="price-duration">{t('landing.pricing.perMonth', '/mo')}</span>
            </p>
            <ul className="plan-features">
              <li>{t('landing.pricing.pro.feat1', 'Everything in Free')}</li>
              <li>{t('landing.pricing.pro.feat2', 'AI image enhance & editor')}</li>
              <li>{t('landing.pricing.pro.feat3', 'AI video — 3 / week')}</li>
              <li>{t('landing.pricing.pro.feat4', 'Gmail summary & sorting')}</li>
              <li>{t('landing.pricing.pro.feat5', 'Markiv agent · 100 generations / mo')}</li>
            </ul>
            <button className="btn btn-primary btn-block" onClick={() => handlePlanClick('pro')} id="btn_plan_pro">
              {t('landing.pricing.pro.cta', 'Scale up')}
            </button>
          </div>

          {/* ULTIMATE */}
          <div className="price-panel">
            <h3>{t('landing.pricing.ultimate.name', 'Ultimate')}</h3>
            <p className="plan-description">{t('landing.pricing.ultimate.desc', 'A full autonomous marketing team')}</p>
            <p className="plan-price num">
              <span className="price-number">${pricing.ultimate[billingPeriod]}</span>
              <span className="price-duration">{t('landing.pricing.perMonth', '/mo')}</span>
            </p>
            <ul className="plan-features">
              <li>{t('landing.pricing.ultimate.feat1', 'Everything in Pro')}</li>
              <li>{t('landing.pricing.ultimate.feat2', 'AI video — 7 / week')}</li>
              <li>{t('landing.pricing.ultimate.feat3', 'Gmail auto-reply (learns you)')}</li>
              <li>{t('landing.pricing.ultimate.feat4', 'AI website generation')}</li>
              <li>{t('landing.pricing.ultimate.feat5', 'Markiv agent · 250 generations / mo')}</li>
            </ul>
            <button className="btn btn-secondary btn-block" onClick={() => handlePlanClick('ultimate')} id="btn_plan_ultimate">
              {t('landing.pricing.ultimate.cta', 'Go autonomous')}
            </button>
          </div>
        </div>
      </section>

      {/* --- FOUNDER --- */}
      <section className="founder" id="about">
        <h2 className="section-head">{t('landing.founder.title', "Built by someone who's done it for real.")}</h2>
        <div className="founder-panel">
          <div className="founder-head">
            <span className="founder-mark">E</span>
            <div>
              <h3>{t('landing.founder.name', 'Elshod — Founder & Builder')}</h3>
              <small>{t('landing.founder.meta', 'CS + Business · ships solo · UZ / RU / EN')}</small>
            </div>
          </div>
          <div className="founder-points">
            <p><strong>{t('landing.founder.point1Title', 'Builds the whole thing.')}</strong> {t('landing.founder.point1Text', 'CS background — architects the AI agents, automations and data pipelines, and ships the product solo.')}</p>
            <p><strong>{t('landing.founder.point2Title', 'Thinks in solutions.')}</strong> {t('landing.founder.point2Text', 'A business education means features that solve real owner problems, not tech for its own sake.')}</p>
            <p><strong>{t('landing.founder.point3Title', 'Owns the market.')}</strong> {t('landing.founder.point3Text', 'Deep Uzbekistan knowledge, where demand for digital growth is high and the tools are absent.')}</p>
            <p><strong>{t('landing.founder.point4Title', 'Lived experience.')}</strong> {t('landing.founder.point4Text', 'Personally ran full marketing for a local business — this product exists because that job was too hard.')}</p>
          </div>
        </div>
      </section>

      {/* --- CLOSE --- */}
      <section className="close-banner">
        <h2>{t('landing.cta.title', "Let's give every business a marketing team — in code.")}</h2>
        <p>{t('landing.cta.subtitle', 'Markivo turns zero into a running online presence — autonomously, multilingually, and in the markets the giants ignore.')}</p>
        <button className="btn btn-primary" onClick={() => onStartOnboarding(isLoggedIn ? 'dashboard' : 'B')} id="btn_cta_bottom">
          {t('landing.cta.button', 'Start free today')}
          <i className="fa-solid fa-arrow-right" aria-hidden="true"></i>
        </button>
      </section>

      <footer className="landing-footer">
        <p>{t('landing.footer.copyright', { defaultValue: '© {{year}} Markivo. From zero to fully running.', year: new Date().getFullYear() })}</p>
      </footer>
    </div>
  );
}
