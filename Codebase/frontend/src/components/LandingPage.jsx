import { useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import api from '../lib/api';
import './LandingPage.css';
import logoUrl from '../assets/markivo-logo.png';

export default function LandingPage({ onStartOnboarding, onOpenLogin, isLoggedIn }) {
  const { t } = useTranslation();
  const [billingPeriod, setBillingPeriod] = useState('monthly'); // 'monthly' | 'yearly'

  const pricing = {
    freemium: { monthly: 0, yearly: 0 },
    pro: { monthly: 20, yearly: 16 },
    ultimate: { monthly: 50, yearly: 40 }
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

  return (
    <div className="landing-container animate-fade-in">
      {/* --- HEADER --- */}
      <header className="landing-header glass-card">
        <div className="logo-text">
          <img src={logoUrl} alt={t('common.brandName', 'Markivo')} className="logo-img" />
          Markivo
        </div>
        <nav className="header-nav">
          <a href="#how">{t('landing.nav.how', 'How it works')}</a>
          <a href="#features">{t('landing.nav.features', 'Features')}</a>
          <a href="#pricing">{t('landing.nav.pricing', 'Pricing')}</a>
        </nav>
        <div className="header-actions">
          {isLoggedIn ? (
            <button className="btn btn-primary" onClick={() => onStartOnboarding('dashboard')} id="btn_goto_dash">
              {t('landing.header.goToDashboard', 'Go to Dashboard')} <i className="fa-solid fa-gauge"></i>
            </button>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={onOpenLogin} id="btn_login_showcase">
                {t('auth.login', 'Sign In')}
              </button>
              <button className="btn btn-primary" onClick={() => onStartOnboarding('B')} id="btn_get_started_header">
                {t('landing.header.getStarted', 'Get Started')}
              </button>
            </>
          )}
        </div>
      </header>

      {/* --- HERO SECTION --- */}
      <section className="hero-section">
        <div className="hero-content">
          <div className="badge animate-fade-in">{t('landing.hero.badge', '✦ THE AI MARKETING PLATFORM')}</div>
          <h1 className="hero-title animate-fade-in">
            {t('landing.hero.titlePre', 'From')} <span className="gradient-text">{t('landing.hero.titleHighlight', 'zero')}</span> {t('landing.hero.titlePost', 'to fully running.')}
          </h1>
          <p className="hero-subtitle animate-fade-in">
            {t('landing.hero.subtitle', "Markivo is an all-in-one marketing platform that builds, manages, and grows your business's entire online presence — across every channel, in any language, fully autonomously. Native Uzbek, Russian, and English.")}
          </p>
          <div className="hero-actions animate-fade-in">
            {isLoggedIn ? (
              <button className="btn btn-primary btn-lg" onClick={() => onStartOnboarding('dashboard')} id="btn_hero_cta">
                {t('landing.hero.ctaDashboard', 'Go to My Dashboard')} <i className="fa-solid fa-arrow-right"></i>
              </button>
            ) : (
              <>
                <button className="btn btn-primary btn-lg" onClick={() => onStartOnboarding('B')} id="btn_hero_cta">
                  {t('landing.hero.ctaBuild', 'Build My Presence From Zero')} <i className="fa-solid fa-arrow-right"></i>
                </button>
                <button className="btn btn-secondary btn-lg" onClick={() => onStartOnboarding('A')} id="btn_hero_discover">
                  {t('landing.hero.ctaScan', 'Scan My Existing Brand')} <i className="fa-solid fa-magnifying-glass"></i>
                </button>
              </>
            )}
          </div>
          <div className="hero-channels animate-fade-in">
            <span><i className="fa-brands fa-google"></i> Google</span>
            <span><i className="fa-brands fa-instagram"></i> Instagram</span>
            <span><i className="fa-brands fa-telegram"></i> Telegram</span>
          </div>
        </div>

        {/* --- DYNAMIC PREVIEW GRID --- */}
        <div className="hero-preview glass-card animate-fade-in">
          <div className="preview-header">
            <div className="preview-dot dot-red"></div>
            <div className="preview-dot dot-yellow"></div>
            <div className="preview-dot dot-green"></div>
            <span className="preview-url">app.markivo.io/dashboard</span>
          </div>
          <div className="preview-body">
            <div className="preview-sidebar">
              <div className="preview-logo">{t('landing.preview.demoBrand', '☕ Cafe Noir')}</div>
              <div className="preview-menu-item active"><i className="fa-solid fa-chart-line"></i> {t('landing.preview.menuDashboard', 'Dashboard')}</div>
              <div className="preview-menu-item"><i className="fa-solid fa-pen-nib"></i> {t('landing.preview.menuContent', 'Content Engine')}</div>
              <div className="preview-menu-item"><i className="fa-solid fa-users"></i> {t('landing.preview.menuCompetitors', 'Competitor Gaps')}</div>
            </div>
            <div className="preview-main">
              <div className="preview-row">
                <div className="preview-stat-card">
                  <span className="stat-label">{t('landing.preview.statGoogle', 'Google Maps Views')}</span>
                  <span className="stat-value text-accent">+12.4%</span>
                  <div className="stat-chart-mini"><i className="fa-solid fa-chart-area"></i></div>
                </div>
                <div className="preview-stat-card">
                  <span className="stat-label">{t('landing.preview.statInstagram', 'Instagram Growth')}</span>
                  <span className="stat-value text-purple">+15.6%</span>
                  <div className="stat-chart-mini"><i className="fa-solid fa-chart-line"></i></div>
                </div>
              </div>
              <div className="preview-post-box glass-card">
                <div className="post-header">
                  <span className="post-avatar">🤖</span>
                  <div>
                    <h4>{t('landing.preview.agentName', 'Markiv — AI Marketing Agent')}</h4>
                    <small>{t('landing.preview.agentStatus', 'Drafted & scheduled, pending your approval')}</small>
                  </div>
                </div>
                <p className="post-text">{t('landing.preview.postText', '"Looking for the best espresso in Tashkent? ☕ We\'ve got you covered with fresh local pastries and cozy workspace booths!"')}</p>
                <div className="post-footer">
                  <span className="badge badge-success"><i className="fa-solid fa-check"></i> {t('landing.preview.approved', 'Approved')}</span>
                  <span className="badge badge-primary">{t('landing.preview.uzRuReady', 'Uzbek/Russian Ready')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --- PROBLEM SECTION --- */}
      <section className="problem-section">
        <h2 className="section-title">{t('landing.problem.title', 'Millions of businesses have no marketing — and no idea where to start.')}</h2>
        <div className="grid-3">
          <div className="feature-card glass-card">
            <div className="feature-icon icon-gold"><i className="fa-solid fa-user-clock"></i></div>
            <h3>{t('landing.problem.card1Title', 'No team, no time')}</h3>
            <p>{t('landing.problem.card1Text', 'Owner-operators do everything themselves. Marketing falls to the bottom of the list — or never happens at all.')}</p>
          </div>
          <div className="feature-card glass-card">
            <div className="feature-icon icon-blue"><i className="fa-solid fa-puzzle-piece"></i></div>
            <h3>{t('landing.problem.card2Title', 'Tools assume you exist')}</h3>
            <p>{t('landing.problem.card2Text', 'HubSpot, Hootsuite and the rest are built for businesses that already have a presence, a budget, and a marketer.')}</p>
          </div>
          <div className="feature-card glass-card">
            <div className="feature-icon icon-purple"><i className="fa-solid fa-earth-asia"></i></div>
            <h3>{t('landing.problem.card3Title', 'Emerging markets ignored')}</h3>
            <p>{t('landing.problem.card3Text', "In Uzbekistan, Central Asia and the CIS, businesses are hungry for digital growth — but the tools aren't in their language.")}</p>
          </div>
        </div>
        <p className="problem-gap">
          <Trans i18nKey="landing.problem.gap">The gap: every existing tool helps you <em>manage</em> marketing. None of them <strong className="gradient-text">start it for you.</strong></Trans>
        </p>
      </section>

      {/* --- HOW IT WORKS: TWO PATHS --- */}
      <section className="paths-section" id="how">
        <h2 className="section-title">{t('landing.paths.title', "Two paths. One outcome: a business that's fully online.")}</h2>
        <p className="section-subtitle">{t('landing.paths.subtitle', 'Markivo either discovers your existing presence — or builds one entirely from scratch — then runs it on autopilot.')}</p>

        <div className="grid-2 paths-grid">
          <div className="path-card glass-card">
            <div className="path-label">{t('landing.paths.pathALabel', 'PATH A')}</div>
            <h3>{t('landing.paths.pathATitle', '"I already have something"')}</h3>
            <ol className="path-steps">
              <li>{t('landing.paths.pathAStep1', 'Scan the web for accounts, maps listing, reviews & ads')}</li>
              <li>{t('landing.paths.pathAStep2', 'See everything found in a confirm / reject view')}</li>
              <li>{t('landing.paths.pathAStep3', 'Connect verified platforms securely')}</li>
              <li>{t('landing.paths.pathAStep4', 'Dashboard fills with live data instantly')}</li>
            </ol>
            <button className="btn btn-secondary w-full" onClick={() => onStartOnboarding('A')} id="btn_path_a">
              {t('landing.paths.pathACta', 'Scan My Digital Presence')}
            </button>
          </div>
          <div className="path-card glass-card glass-card-glow">
            <div className="path-label">{t('landing.paths.pathBLabel', 'PATH B')}</div>
            <h3>{t('landing.paths.pathBTitle', '"I have nothing yet"')}</h3>
            <ol className="path-steps">
              <li>{t('landing.paths.pathBStep1', 'Guided wizard: category, brand tone, audience')}</li>
              <li>{t('landing.paths.pathBStep2', 'AI generates your slogan + logo, on brand')}</li>
              <li>{t('landing.paths.pathBStep3', 'Sets up Google Business & social channels')}</li>
              <li>{t('landing.paths.pathBStep4', 'Builds the first content calendar — then posts')}</li>
            </ol>
            <button className="btn btn-primary w-full" onClick={() => onStartOnboarding('B')} id="btn_path_b">
              {t('landing.paths.pathBCta', 'Build From Scratch')}
            </button>
          </div>
        </div>
        <p className="paths-outro">
          <Trans i18nKey="landing.paths.outro">Once set up, <strong>Markiv</strong> — your AI agent — takes over the day-to-day: content, inbox, analytics and growth. Day after day.</Trans>
        </p>
      </section>

      {/* --- FEATURES GRID --- */}
      <section className="features-section" id="features">
        <h2 className="section-title">{t('landing.features.title', 'One platform replaces an entire marketing stack.')}</h2>
        <p className="section-subtitle">{t('landing.features.subtitle', 'Everything you need to capture customers locally and globally')}</p>

        <div className="grid-3">
          <div className="feature-card glass-card">
            <div className="feature-icon icon-gold"><i className="fa-solid fa-wand-magic-sparkles"></i></div>
            <h3>{t('landing.features.brandTitle', 'Brand & identity')}</h3>
            <p>{t('landing.features.brandText', 'AI logo, slogan and tone-of-voice generated in seconds — a complete identity before your first post.')}</p>
          </div>
          <div className="feature-card glass-card">
            <div className="feature-icon icon-blue"><i className="fa-solid fa-paper-plane"></i></div>
            <h3>{t('landing.features.postingTitle', 'Multi-platform posting')}</h3>
            <p>{t('landing.features.postingText', 'Instagram, Telegram, X & Google — written, scheduled and published from one place.')}</p>
          </div>
          <div className="feature-card glass-card">
            <div className="feature-icon icon-purple"><i className="fa-solid fa-camera"></i></div>
            <h3>{t('landing.features.contentTitle', 'Content engine')}</h3>
            <p>{t('landing.features.contentText', 'Shoot tips, automatic photo & video enhancement, and AI-generated video tuned to each platform.')}</p>
          </div>
          <div className="feature-card glass-card">
            <div className="feature-icon icon-blue"><i className="fa-solid fa-inbox"></i></div>
            <h3>{t('landing.features.inboxTitle', 'Inbox agent')}</h3>
            <p>{t('landing.features.inboxText', 'Gmail summarized, sorted and auto-replied — and it learns your answers as it goes.')}</p>
          </div>
          {/* DISABLED: SEO/Meta temporarily off — see 2026-08-13
              The SEO + AI search feature card.

              <div className="feature-card glass-card">
              <div className="feature-icon icon-gold"><i className="fa-solid fa-magnifying-glass-chart"></i></div>
              <h3>{t('landing.features.seoTitle', 'SEO + AI search')}</h3>
              <p>{t('landing.features.seoText', 'Rank on Google — and surface inside ChatGPT & Perplexity, where your customers now search.')}</p>
              </div>
          */}
          <div className="feature-card glass-card">
            <div className="feature-icon icon-purple"><i className="fa-solid fa-users-viewfinder"></i></div>
            <h3>{t('landing.features.intelTitle', 'Competitor intel')}</h3>
            <p>{t('landing.features.intelText', "Track rivals' posting, growth and gaps automatically — and get moves to counter them.")}</p>
          </div>
        </div>
      </section>

      {/* --- PRICING SECTION --- */}
      <section className="pricing-section" id="pricing">
        <h2 className="section-title">{t('landing.pricing.title', 'Freemium that converts — three simple tiers.')}</h2>
        <p className="section-subtitle">{t('landing.pricing.subtitle', "Start free, unlock the autonomous marketing team when you're ready to scale")}</p>

        <div className="billing-selector">
          <button
            className={`billing-btn ${billingPeriod === 'monthly' ? 'active' : ''}`}
            onClick={() => setBillingPeriod('monthly')}
          >
            {t('landing.pricing.monthly', 'Monthly')}
          </button>
          <button
            className={`billing-btn ${billingPeriod === 'yearly' ? 'active' : ''}`}
            onClick={() => setBillingPeriod('yearly')}
          >
            {t('landing.pricing.yearly', 'Yearly')} <span className="discount-badge">{t('landing.pricing.save20', 'Save 20%')}</span>
          </button>
        </div>

        <div className="grid-3 pricing-grid">
          {/* FREE */}
          <div className="pricing-card glass-card">
            <h3>{t('landing.pricing.free.name', 'Free')}</h3>
            <p className="plan-description">{t('landing.pricing.free.desc', 'The hook — everything to get online')}</p>
            <div className="plan-price">
              <span className="price-symbol">$</span>
              <span className="price-number">0</span>
              <span className="price-duration">{t('landing.pricing.perMonth', '/mo')}</span>
            </div>
            <ul className="plan-features">
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.free.feat1', 'Full onboarding — both paths')}</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.free.feat2', 'AI logo & slogan generation')}</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.free.feat3', 'Google Business setup')}</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.free.feat4', 'Social channels connected')}</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.free.feat5', '25 AI generations / month')}</li>
            </ul>
            <button className="btn btn-secondary w-full mt-auto" onClick={() => handlePlanClick('freemium')} id="btn_plan_free">
              {t('landing.pricing.free.cta', 'Get Started Free')}
            </button>
          </div>

          {/* PRO */}
          <div className="pricing-card glass-card pro-card glass-card-glow">
            <div className="popular-badge">{t('landing.pricing.pro.badge', 'MOST VALUE')}</div>
            <h3>{t('landing.pricing.pro.name', 'Pro')}</h3>
            <p className="plan-description">{t('landing.pricing.pro.desc', 'Ideal for active, growing businesses')}</p>
            <div className="plan-price">
              <span className="price-symbol">$</span>
              <span className="price-number">{pricing.pro[billingPeriod]}</span>
              <span className="price-duration">{t('landing.pricing.perMonth', '/mo')}</span>
            </div>
            <ul className="plan-features">
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.pro.feat1', 'Everything in Free')}</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.pro.feat2', 'AI image enhance & editor')}</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.pro.feat3', 'AI video — 3 / week')}</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.pro.feat4', 'Gmail summary & sorting')}</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.pro.feat5', 'Markiv agent · 100 generations / mo')}</li>
            </ul>
            <button className="btn btn-primary w-full mt-auto" onClick={() => handlePlanClick('pro')} id="btn_plan_pro">
              {t('landing.pricing.pro.cta', 'Scale Up Now')}
            </button>
          </div>

          {/* ULTIMATE */}
          <div className="pricing-card glass-card">
            <h3>{t('landing.pricing.ultimate.name', 'Ultimate')}</h3>
            <p className="plan-description">{t('landing.pricing.ultimate.desc', 'A full autonomous marketing team')}</p>
            <div className="plan-price">
              <span className="price-symbol">$</span>
              <span className="price-number">{pricing.ultimate[billingPeriod]}</span>
              <span className="price-duration">{t('landing.pricing.perMonth', '/mo')}</span>
            </div>
            <ul className="plan-features">
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.ultimate.feat1', 'Everything in Pro')}</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.ultimate.feat2', 'AI video — 7 / week')}</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.ultimate.feat3', 'Gmail auto-reply (learns you)')}</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.ultimate.feat4', 'AI website generation')}</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.ultimate.feat5', 'Markiv agent · 250 generations / mo')}</li>
            </ul>
            <button className="btn btn-secondary w-full mt-auto" onClick={() => handlePlanClick('ultimate')} id="btn_plan_ultimate">
              {t('landing.pricing.ultimate.cta', 'Go Autonomous')}
            </button>
          </div>
        </div>
      </section>

      {/* --- FOUNDER SECTION --- */}
      <section className="founder-section" id="about">
        <h2 className="section-title">{t('landing.founder.title', "Built by someone who's done it for real.")}</h2>
        <div className="founder-card glass-card">
          <div className="founder-head">
            <div className="avatar avatar-lg">E</div>
            <div>
              <h3>{t('landing.founder.name', 'Elshod — Founder & Builder')}</h3>
              <small>{t('landing.founder.meta', 'CS + Business · ships solo · UZ / RU / EN')}</small>
            </div>
          </div>
          <div className="grid-2 founder-points">
            <p><strong>{t('landing.founder.point1Title', 'Builds the whole thing.')}</strong> {t('landing.founder.point1Text', 'CS background — architects the AI agents, automations and data pipelines, and ships the product solo.')}</p>
            <p><strong>{t('landing.founder.point2Title', 'Thinks in solutions.')}</strong> {t('landing.founder.point2Text', 'A business education means features that solve real owner problems, not tech for its own sake.')}</p>
            <p><strong>{t('landing.founder.point3Title', 'Owns the market.')}</strong> {t('landing.founder.point3Text', 'Deep Uzbekistan knowledge, where demand for digital growth is high and the tools are absent.')}</p>
            <p><strong>{t('landing.founder.point4Title', 'Lived experience.')}</strong> {t('landing.founder.point4Text', 'Personally ran full marketing for a local business — this product exists because that job was too hard.')}</p>
          </div>
        </div>
      </section>

      {/* --- CLOSING CTA --- */}
      <section className="cta-banner glass-card glass-card-glow">
        <h2>{t('landing.cta.titlePre', "Let's give every business a marketing team —")} <span className="gradient-text">{t('landing.cta.titleHighlight', 'in code.')}</span></h2>
        <p>{t('landing.cta.subtitle', 'Markivo turns zero into a fully-running online presence — autonomously, multilingually, and in the markets the giants ignore.')}</p>
        <button className="btn btn-primary btn-lg" onClick={() => onStartOnboarding(isLoggedIn ? 'dashboard' : 'B')} id="btn_cta_bottom">
          {t('landing.cta.button', 'Start Free Today')} <i className="fa-solid fa-arrow-right"></i>
        </button>
      </section>

      {/* --- FOOTER --- */}
      <footer className="landing-footer">
        <p>{t('landing.footer.copyright', { defaultValue: '© {{year}} Markivo. From zero to fully running. All rights reserved.', year: new Date().getFullYear() })}</p>
        {/* Static pages in public/ — plain anchors, not SPA navigation, so the
            policy URLs stay directly reachable for platform app review. */}
        <nav className="landing-footer-links">
          <a href="/privacy.html">{t('landing.footer.privacy', { defaultValue: 'Privacy Policy' })}</a>
          <a href="/terms.html">{t('landing.footer.terms', { defaultValue: 'Terms of Service' })}</a>
          <a href="/data-deletion.html">{t('landing.footer.dataDeletion', { defaultValue: 'Data Deletion' })}</a>
        </nav>
      </footer>
    </div>
  );
}
