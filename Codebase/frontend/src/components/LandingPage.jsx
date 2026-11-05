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

/* Small inline icons on a 20px grid, drawn with currentColor. */
const svg = (d, size = 20) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);
const Icon = {
  arrow: svg(<path d="M4 10h11.5M11 5.5l4.5 4.5-4.5 4.5" />, 16),
  check: svg(<path d="M4.5 10.5l3.5 3.5 7.5-8.5" />, 16),
  sun: svg(<><circle cx="10" cy="10" r="3.6" /><path d="M10 1.8v2M10 16.2v2M1.8 10h2M16.2 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4" /></>, 18),
  moon: svg(<path d="M16.5 12.3A7 7 0 017.7 3.5a7 7 0 108.8 8.8z" />, 18),
  forward: svg(<path d="M11 4.5l5 5-5 5M16 9.5H8.5A4.5 4.5 0 004 14v1.5" />),
  calendar: svg(<><rect x="3" y="4.5" width="14" height="12.5" rx="2" /><path d="M3 8.5h14M7 2.5v3.5M13 2.5v3.5" /></>),
  tap: svg(<path d="M8 9V4.2a1.6 1.6 0 013.2 0V9l3.3.7a2 2 0 011.5 2.3l-.8 4.2a2 2 0 01-2 1.6H9.4a2 2 0 01-1.6-.8L4.6 12.8a1.5 1.5 0 012.2-2L8 12" />),
  globe: svg(<><circle cx="10" cy="10" r="7" /><path d="M3 10h14M10 3c2 2 3 4.4 3 7s-1 5-3 7c-2-2-3-4.4-3-7s1-5 3-7z" /></>),
  shield: svg(<><path d="M10 2.5l6 2.3v4.6c0 3.9-2.6 6.9-6 8.1-3.4-1.2-6-4.2-6-8.1V4.8l6-2.3z" /><path d="M7.3 10l2 2 3.6-4" /></>),
  image: svg(<><rect x="3" y="3.5" width="14" height="13" rx="2" /><circle cx="7.5" cy="8" r="1.5" /><path d="M17 13l-4-4-7 7.5" /></>),
  chart: svg(<path d="M3.5 16.5h13M6 13.5V10M10 13.5V6.5M14 13.5V8.5" />),
  spark: svg(<path d="M10 2.5l1.8 4.7 4.7 1.8-4.7 1.8L10 15.5l-1.8-4.7L3.5 9l4.7-1.8L10 2.5z" />),
};

/* The product in one picture: Autopilot asking the owner in Telegram, with
   the same buttons the real Markivo bot sends. Built from markup (not a
   screenshot) so it follows the language and theme. */
function TelegramPreview() {
  const { t } = useTranslation();
  return (
    <div className="lp-stage" role="img" aria-label={t('landing.chat.label', 'Example: Autopilot asks for your OK in Telegram')}>
      <div className="lp-tg">
        <div className="lp-tg-head">
          <img src={logoUrl} alt="" width="36" height="36" className="lp-tg-avatar" />
          <div>
            <div className="lp-tg-name">Markivo</div>
            <div className="lp-tg-sub">{t('landing.chat.bot', 'bot')}</div>
          </div>
        </div>
        <div className="lp-tg-body">
          <div className="lp-tg-msg">
            <p className="lp-tg-intro">
              {t('landing.chat.intro', 'Autopilot wrote a post for “Noir Coffee” — it goes out Thursday at 18:30:')}
            </p>
            <p className="lp-tg-post">
              {t('landing.chat.post', 'New on the menu: pistachio croissant. Baked this morning, usually gone by lunch. Come early ☕️')}
            </p>
            <span className="lp-tg-time">09:12</span>
          </div>
          <div className="lp-tg-keys">
            <span className="lp-tg-key is-pressed">✅ {t('landing.chat.approve', 'Post it')}</span>
            <span className="lp-tg-key">⏭ {t('landing.chat.skip', 'Skip')}</span>
          </div>
          <div className="lp-tg-msg lp-tg-reply">
            <p>{t('landing.chat.reply', 'Approved. It goes out at the planned time.')}</p>
            <span className="lp-tg-time">09:13</span>
          </div>
        </div>
      </div>

      <div className="lp-learned">
        <div className="lp-learned-head">
          <span className="lp-learned-icon">{Icon.spark}</span>
          {t('landing.learned.title', 'Learned from your posts')}
        </div>
        <dl>
          <div>
            <dt>{t('landing.learned.voiceLabel', 'Voice')}</dt>
            <dd>{t('landing.learned.voice', 'Warm, short, talks to regulars')}</dd>
          </div>
          <div>
            <dt>{t('landing.learned.bestLabel', 'Best time')}</dt>
            <dd>{t('landing.learned.best', 'Thursday, 18:30')}</dd>
          </div>
          <div>
            <dt>{t('landing.learned.topicsLabel', 'Topics')}</dt>
            <dd className="lp-learned-tags">
              <span>{t('landing.learned.topic1', 'New on the menu')}</span>
              <span>{t('landing.learned.topic2', 'Offers')}</span>
              <span>{t('landing.learned.topic3', 'Behind the counter')}</span>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

/* Step visuals for the Autopilot section. Decorative: the step text says it. */
function ForwardVisual() {
  const { t } = useTranslation();
  return (
    <div className="lp-vis lp-vis-fwd" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="lp-fwd" style={{ '--i': i }}>
          <span className="lp-fwd-from">{t('landing.how.fwdFrom', 'Forwarded from Noir Coffee')}</span>
          <span className="lp-fwd-line" />
          <span className="lp-fwd-line is-short" />
        </div>
      ))}
      <span className="lp-vis-badge">{Icon.check} {t('landing.how.fwdCount', '8 posts learned')}</span>
    </div>
  );
}

function WeekVisual() {
  const { t } = useTranslation();
  const days = [
    t('landing.preview.mon', 'Mon'), t('landing.preview.tue', 'Tue'), t('landing.preview.wed', 'Wed'),
    t('landing.preview.thu', 'Thu'), t('landing.preview.fri', 'Fri'), t('landing.preview.sat', 'Sat'), t('landing.preview.sun', 'Sun'),
  ];
  const slots = { 1: '09:00', 3: '18:30', 5: '11:00' };
  return (
    <div className="lp-vis lp-vis-week" aria-hidden="true">
      {days.map((d, i) => (
        <div key={d} className={`lp-day${slots[i] ? ' has-post' : ''}`}>
          <span className="lp-day-name">{d}</span>
          {slots[i] && <span className="lp-day-slot">{slots[i]}</span>}
        </div>
      ))}
    </div>
  );
}

function ApproveVisual() {
  const { t } = useTranslation();
  return (
    <div className="lp-vis lp-vis-approve" aria-hidden="true">
      <div className="lp-mini-post">
        <span className="lp-fwd-line" />
        <span className="lp-fwd-line" />
        <span className="lp-fwd-line is-short" />
      </div>
      <div className="lp-tg-keys">
        <span className="lp-tg-key is-pressed">✅ {t('landing.chat.approve', 'Post it')}</span>
        <span className="lp-tg-key">⏭ {t('landing.chat.skip', 'Skip')}</span>
      </div>
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
      icon: Icon.forward,
      title: t('landing.how.step1Title', 'Forward a few of your posts'),
      text: t('landing.how.step1Text', 'Send five or more posts you like to the Markivo bot. Autopilot learns how you write, what you post about and when your customers read.'),
      visual: <ForwardVisual />,
    },
    {
      icon: Icon.calendar,
      title: t('landing.how.step2Title', 'It plans your week'),
      text: t('landing.how.step2Text', 'Pick the days and times, or let Autopilot choose the hours your posts do best. Each post is written in your voice, in your customers\' language.'),
      visual: <WeekVisual />,
    },
    {
      icon: Icon.tap,
      title: t('landing.how.step3Title', 'You tap Post or Skip'),
      text: t('landing.how.step3Text', 'Every post comes to your Telegram first. Post it and it goes out on time; skip it and nothing is published. Or let Autopilot post on its own.'),
      visual: <ApproveVisual />,
    },
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
            <p className="lp-eyebrow">
              <span className="lp-eyebrow-dot" aria-hidden="true" />
              {t('landing.hero.eyebrow', 'Autopilot for Telegram and Instagram')}
            </p>
            <h1>
              {t('landing.hero.line1', 'You run the business.')}
              <span>{t('landing.hero.line2', 'Markivo runs the marketing.')}</span>
            </h1>
            <p className="lp-lead">
              {t('landing.hero.lead', 'Markivo learns how you write, then plans and writes your posts for the week. Each one comes to your Telegram first: tap Post or Skip, or let it post on its own.')}
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
            <ul className="lp-proof">
              {!isLoggedIn && <li>{Icon.check}{t('landing.hero.note', 'Free plan, no card needed.')}</li>}
              <li>{Icon.check}{t('landing.hero.proofLang', 'Uzbek, Russian and English')}</li>
              <li>{Icon.check}{t('landing.hero.proofAds', 'Never spends on ads without asking')}</li>
            </ul>
          </div>
          <TelegramPreview />
        </section>

        <section className="lp-section" id="how">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <p className="lp-kicker">{t('landing.how.kicker', 'How it works')}</p>
              <h2>{t('landing.how.title', 'Marketing that runs while you work')}</h2>
              <p className="lp-section-note">
                {t('landing.how.lead', 'Set it up once in a few minutes. After that, your part is a tap in Telegram.')}
              </p>
            </div>
            <ol className="lp-steps">
              {steps.map((s, i) => (
                <li key={s.title} className="lp-step">
                  {s.visual}
                  <div className="lp-step-text">
                    <span className="lp-step-num">{i + 1}</span>
                    <h3>{s.title}</h3>
                    <p>{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="lp-section" id="features">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <p className="lp-kicker">{t('landing.features.kicker', 'Features')}</p>
              <h2>{t('landing.features.title', 'Everything a small business needs to post well')}</h2>
            </div>
            <div className="lp-bento">
              <div className="lp-tile lp-tile-wide">
                <span className="lp-tile-icon">{Icon.globe}</span>
                <h3>{t('landing.features.languageTitle', 'Uzbek, Russian, English')}</h3>
                <p>{t('landing.features.languageText', 'Posts are written the way your customers talk, in the language they read.')}</p>
                {/* The same offer in each language — samples of output, so they stay as written. */}
                <ul className="lp-langs" aria-hidden="true">
                  <li><span>UZ</span>Bugun ikkinchi kofe bizdan ☕️</li>
                  <li><span>RU</span>Сегодня второй кофе — за наш счёт ☕️</li>
                  <li><span>EN</span>Second coffee’s on us today ☕️</li>
                </ul>
              </div>
              <div className="lp-tile lp-tile-ink">
                <span className="lp-tile-icon">{Icon.shield}</span>
                <h3>{t('landing.features.adsTitle', 'Your money stays yours')}</h3>
                <p>{t('landing.features.adsText', 'Markivo writes and posts for free. It never starts a paid ad without your OK.')}</p>
              </div>
              <div className="lp-tile">
                <span className="lp-tile-icon">{Icon.spark}</span>
                <h3>{t('landing.features.brandTitle', 'Logo and slogan')}</h3>
                <p>{t('landing.features.brandText', 'Starting from nothing? Pick a logo and slogan made for your business before your first post.')}</p>
              </div>
              <div className="lp-tile">
                <span className="lp-tile-icon">{Icon.image}</span>
                <h3>{t('landing.features.mediaTitle', 'Photos and video')}</h3>
                <p>{t('landing.features.mediaText', 'Turn a phone photo into a finished post, or make a short video sized for Reels.')}</p>
              </div>
              <div className="lp-tile lp-tile-wide">
                <span className="lp-tile-icon">{Icon.calendar}</span>
                <h3>{t('landing.features.calendarTitle', 'One calendar')}</h3>
                <p>{t('landing.features.calendarText', 'Every planned post in one place. Move one to another day by dragging it.')}</p>
              </div>
              <div className="lp-tile">
                <span className="lp-tile-icon">{Icon.chart}</span>
                <h3>{t('landing.features.competitorsTitle', 'Competitors')}</h3>
                <p>{t('landing.features.competitorsText', 'See what similar businesses post and how fast they grow, with a note on how to answer.')}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-section" id="pricing">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <p className="lp-kicker">{t('landing.pricing.kicker', 'Pricing')}</p>
              <h2>{t('landing.pricing.title', 'Pricing')}</h2>
              <p className="lp-section-note">
                {t('landing.pricing.note', 'Every plan has the full app. Plans differ in how much Markivo makes for you each week. Limits reset every Monday.')}
              </p>
            </div>
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
          <div className="lp-wrap">
            <figure className="lp-founder">
              <blockquote>
                {t('landing.founder.text', "I once ran all the marketing for a local business on my own, on top of everything else. It was too much for one person, and the tools out there weren't made for owners here or in our languages. Markivo is what I wish I'd had.")}
              </blockquote>
              <figcaption>
                <span className="lp-founder-avatar" aria-hidden="true">E</span>
                {t('landing.founder.sign', 'Elshod, founder')}
              </figcaption>
            </figure>
          </div>
        </section>

        <section className="lp-wrap lp-final">
          <div className="lp-final-inner">
            <h2>{t('landing.cta.title', 'See what Markivo writes for you.')}</h2>
            <p>{t('landing.cta.text', 'Set up takes a few minutes. Your first posts are ready the same day.')}</p>
            <button className="lp-btn lp-btn-primary lp-btn-lg" onClick={start} id="btn_cta_bottom">
              {isLoggedIn ? t('landing.hero.ctaDashboard', 'Open my dashboard') : t('landing.hero.cta', 'Start free')} {Icon.arrow}
            </button>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-inner">
          <span className="lp-footer-brand">
            <img src={logoUrl} alt="" width="20" height="20" />
            {t('landing.footer.copyright', { defaultValue: '© {{year}} Markivo', year: new Date().getFullYear() })}
          </span>
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
