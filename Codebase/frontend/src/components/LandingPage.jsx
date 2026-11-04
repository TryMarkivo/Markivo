import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import LanguageSelector from './LanguageSelector';
import './LandingPage.css';
import logoUrl from '../assets/markivo-logo.png';

// Prices and weekly allowances shown on the page. They mirror the defaults in
// backend/config.js (`tierPrices` and the WEEKLY `aiLimits` buckets) — keep the
// two in step when pricing changes.
const PLANS = [
  { tier: 'freemium', price: 0, writing: 5, image: 2, video: 0 },
  { tier: 'pro', price: 20, writing: 15, image: 10, video: 4 },
  { tier: 'ultimate', price: 50, writing: 40, image: 25, video: 12 },
];

/* Small inline icons, drawn on a 20px grid so they sit on the text baseline. */
const Icon = {
  arrow: (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h9.5M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  check: (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  sun: (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 1.8v2M10 16.2v2M1.8 10h2M16.2 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  moon: (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M16.5 12.3A7 7 0 017.7 3.5a7 7 0 108.8 8.8z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
};

/* The product in one picture: a week of posts, each with its status. Built
   from markup (not a screenshot) so it follows the language and theme. */
function WeekPreview() {
  const { t } = useTranslation();
  const rows = [
    {
      day: t('landing.preview.mon', 'Mon'), time: '09:00', tone: 'a',
      text: t('landing.preview.post1', 'Warm pastries, a proper espresso and a quiet corner to work in. We open at 8.'),
      status: 'posted',
    },
    {
      day: t('landing.preview.wed', 'Wed'), time: '18:30', tone: 'b',
      text: t('landing.preview.post2', 'Every Wednesday after 4 pm, the second coffee is on us.'),
      status: 'approved',
    },
    {
      day: t('landing.preview.fri', 'Fri'), time: '10:00', tone: 'c',
      text: t('landing.preview.post3', 'New on the menu: pistachio croissant. Baked this morning, gone by lunch.'),
      status: 'waiting',
    },
  ];
  const statusLabel = {
    posted: t('landing.preview.posted', 'Posted'),
    approved: t('landing.preview.approved', 'Approved'),
    waiting: t('landing.preview.waiting', 'Needs your OK'),
  };

  return (
    <div className="lp-week" aria-label={t('landing.preview.label', 'Example: a week of posts for a cafe')}>
      <div className="lp-week-head">
        <span className="lp-week-title">{t('landing.preview.title', 'This week')}</span>
        <span className="lp-week-meta">{t('landing.preview.business', 'Noir Coffee · Instagram')}</span>
      </div>
      <ul className="lp-week-list">
        {rows.map((r) => (
          <li key={r.time} className={`lp-week-row is-${r.status}`}>
            <div className="lp-week-when">
              <span>{r.day}</span>
              <span>{r.time}</span>
            </div>
            <div className={`lp-week-thumb tone-${r.tone}`} aria-hidden="true" />
            <div className="lp-week-body">
              <p>{r.text}</p>
              {r.status === 'waiting' ? (
                <div className="lp-week-actions">
                  <span className="lp-chip lp-chip-solid">{t('landing.preview.approve', 'Approve')}</span>
                  <span className="lp-chip">{t('landing.preview.edit', 'Edit')}</span>
                </div>
              ) : (
                <span className={`lp-status is-${r.status}`}>{statusLabel[r.status]}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function LandingPage({ onStartOnboarding, onOpenLogin, isLoggedIn, theme, onToggleTheme, onLanguageChange }) {
  const { t } = useTranslation();

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

  const start = () => onStartOnboarding(isLoggedIn ? 'dashboard' : 'B');

  const steps = [
    {
      title: t('landing.how.step1Title', 'Tell Markivo about your business'),
      text: t('landing.how.step1Text', "What you sell, where you are and who your customers are. It takes a few minutes. Already online? Markivo finds your pages and reviews instead."),
    },
    {
      title: t('landing.how.step2Title', 'Get a week of posts'),
      text: t('landing.how.step2Text', "Text, photos and short videos in your customers' language, each set for a good time to post."),
    },
    {
      title: t('landing.how.step3Title', 'Approve, or let it post'),
      text: t('landing.how.step3Text', 'Approve each post with one tap, or turn on Autopilot and Markivo publishes for you. It never spends money on ads without asking.'),
    },
  ];

  const features = [
    ['brand', 'Logo and slogan', "Starting from nothing? Pick a logo and slogan made for your business before your first post."],
    ['language', 'Uzbek, Russian, English', 'Posts are written the way your customers talk, in the language they read.'],
    ['media', 'Photos and video', 'Turn a phone photo into a finished post, or make a short video sized for Reels.'],
    ['calendar', 'One calendar', 'Every planned post in one place. Move one to another day by dragging it.'],
    ['competitors', 'Competitors', 'See what similar businesses post and how fast they grow, with a note on how to answer.'],
    ['autopilot', 'Autopilot', 'Let Markivo plan and write posts on its own. It can ask for your OK first, or post by itself.'],
  ];

  return (
    <div className="lp">
      <header className="lp-header">
        <div className="lp-wrap lp-header-inner">
          <a className="lp-brand" href="#top" aria-label="Markivo">
            <img src={logoUrl} alt="" width="28" height="28" />
            <span>Markivo</span>
          </a>
          <nav className="lp-nav" aria-label={t('landing.nav.label', 'Sections')}>
            <a href="#how">{t('landing.nav.how', 'How it works')}</a>
            <a href="#features">{t('landing.nav.features', 'Features')}</a>
            <a href="#pricing">{t('landing.nav.pricing', 'Pricing')}</a>
          </nav>
          <div className="lp-header-actions">
            <LanguageSelector variant="select" onChange={onLanguageChange} />
            <button
              type="button"
              className="lp-icon-btn"
              onClick={onToggleTheme}
              id="btn_theme_toggle"
              aria-label={theme === 'dark' ? t('common.themeToLight', 'Switch to light theme') : t('common.themeToDark', 'Switch to dark theme')}
              title={theme === 'dark' ? t('common.themeToLight', 'Switch to light theme') : t('common.themeToDark', 'Switch to dark theme')}
            >
              {theme === 'dark' ? Icon.sun : Icon.moon}
            </button>
            {isLoggedIn ? (
              <button className="lp-btn lp-btn-primary" onClick={() => onStartOnboarding('dashboard')} id="btn_goto_dash">
                {t('landing.header.goToDashboard', 'Open dashboard')}
              </button>
            ) : (
              <>
                <button className="lp-btn lp-btn-quiet" onClick={onOpenLogin} id="btn_login_showcase">
                  {t('auth.login', 'Sign in')}
                </button>
                <button className="lp-btn lp-btn-primary lp-hide-xs" onClick={() => onStartOnboarding('B')} id="btn_get_started_header">
                  {t('landing.header.getStarted', 'Start free')}
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="top">
        <section className="lp-wrap lp-hero">
          <div className="lp-hero-copy">
            <h1>
              {t('landing.hero.line1', 'You run the business.')}
              <span>{t('landing.hero.line2', 'Markivo runs the marketing.')}</span>
            </h1>
            <p className="lp-lead">
              {t('landing.hero.lead', 'Markivo writes your Instagram posts, makes the photos and short videos, and plans them across the week. Approve each one with a tap, or let it post on its own.')}
            </p>
            <div className="lp-hero-actions">
              {isLoggedIn ? (
                <button className="lp-btn lp-btn-primary lp-btn-lg" onClick={() => onStartOnboarding('dashboard')} id="btn_hero_cta">
                  {t('landing.hero.ctaDashboard', 'Open my dashboard')} {Icon.arrow}
                </button>
              ) : (
                <>
                  <button className="lp-btn lp-btn-primary lp-btn-lg" onClick={() => onStartOnboarding('B')} id="btn_hero_cta">
                    {t('landing.hero.cta', 'Start free')} {Icon.arrow}
                  </button>
                  <button className="lp-btn lp-btn-outline lp-btn-lg" onClick={() => onStartOnboarding('A')} id="btn_hero_discover">
                    {t('landing.hero.ctaScan', "I'm already online")}
                  </button>
                </>
              )}
            </div>
            {!isLoggedIn && (
              <p className="lp-fine">{t('landing.hero.note', 'Free plan, no card needed.')}</p>
            )}
          </div>
          <WeekPreview />
        </section>

        <section className="lp-section" id="how">
          <div className="lp-wrap">
            <h2>{t('landing.how.title', 'How it works')}</h2>
            <ol className="lp-steps">
              {steps.map((s, i) => (
                <li key={s.title}>
                  <span className="lp-step-num">{i + 1}</span>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="lp-section" id="features">
          <div className="lp-wrap">
            <h2>{t('landing.features.title', 'What you get')}</h2>
            <div className="lp-features">
              {features.map(([key, title, text]) => (
                <div key={key} className="lp-feature">
                  <h3>{t(`landing.features.${key}Title`, title)}</h3>
                  <p>{t(`landing.features.${key}Text`, text)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-section" id="pricing">
          <div className="lp-wrap">
            <h2>{t('landing.pricing.title', 'Pricing')}</h2>
            <p className="lp-section-note">
              {t('landing.pricing.note', 'Every plan has the full app. Plans differ in how much Markivo makes for you each week. Limits reset every Monday.')}
            </p>
            <div className="lp-plans">
              {PLANS.map((plan) => {
                const featured = plan.tier === 'pro';
                return (
                  <div key={plan.tier} className={`lp-plan${featured ? ' is-featured' : ''}`}>
                    <h3>{t(`landing.pricing.${plan.tier}.name`, { freemium: 'Free', pro: 'Pro', ultimate: 'Ultimate' }[plan.tier])}</h3>
                    <p className="lp-plan-for">
                      {t(`landing.pricing.${plan.tier}.for`, {
                        freemium: 'To try it out',
                        pro: 'For posting a few times a week',
                        ultimate: 'For posting every day',
                      }[plan.tier])}
                    </p>
                    <p className="lp-price">
                      <span className="lp-price-num">${plan.price}</span>
                      <span className="lp-price-per">{t('landing.pricing.perMonth', 'per month')}</span>
                    </p>
                    <ul>
                      <li>{Icon.check}{t('landing.pricing.writing', { count: plan.writing, defaultValue: '{{count}} AI texts a week' })}</li>
                      <li>{Icon.check}{t('landing.pricing.image', { count: plan.image, defaultValue: '{{count}} AI images a week' })}</li>
                      <li className={plan.video ? '' : 'is-off'}>
                        {plan.video ? Icon.check : <span className="lp-dash" aria-hidden="true" />}
                        {plan.video
                          ? t('landing.pricing.video', { count: plan.video, defaultValue: '{{count}} AI videos a week' })
                          : t('landing.pricing.noVideo', 'No AI video')}
                      </li>
                    </ul>
                    <button
                      className={`lp-btn ${featured ? 'lp-btn-primary' : 'lp-btn-outline'} lp-btn-block`}
                      onClick={() => handlePlanClick(plan.tier)}
                      id={`btn_plan_${plan.tier === 'freemium' ? 'free' : plan.tier}`}
                    >
                      {t(`landing.pricing.${plan.tier}.cta`, { freemium: 'Start free', pro: 'Choose Pro', ultimate: 'Choose Ultimate' }[plan.tier])}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="lp-section" id="about">
          <div className="lp-wrap lp-founder">
            <div className="lp-founder-avatar" aria-hidden="true">E</div>
            <div>
              <p className="lp-founder-text">
                {t('landing.founder.text', "I once ran all the marketing for a local business on my own, on top of everything else. It was too much for one person, and the tools out there weren't made for owners here or in our languages. Markivo is what I wish I'd had.")}
              </p>
              <p className="lp-founder-sign">{t('landing.founder.sign', 'Elshod, founder')}</p>
            </div>
          </div>
        </section>

        <section className="lp-section lp-final">
          <div className="lp-wrap lp-final-inner">
            <h2>{t('landing.cta.title', 'See what Markivo writes for you.')}</h2>
            <button className="lp-btn lp-btn-primary lp-btn-lg" onClick={start} id="btn_cta_bottom">
              {isLoggedIn ? t('landing.hero.ctaDashboard', 'Open my dashboard') : t('landing.hero.cta', 'Start free')} {Icon.arrow}
            </button>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-inner">
          <span>{t('landing.footer.copyright', { defaultValue: '© {{year}} Markivo', year: new Date().getFullYear() })}</span>
          {/* Static pages in public/ — plain anchors, not SPA navigation, so the
              policy URLs stay directly reachable for platform app review. */}
          <nav aria-label={t('landing.footer.label', 'Legal')}>
            <a href="/privacy.html">{t('landing.footer.privacy', 'Privacy Policy')}</a>
            <a href="/terms.html">{t('landing.footer.terms', 'Terms of Service')}</a>
            <a href="/data-deletion.html">{t('landing.footer.dataDeletion', 'Data Deletion')}</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
