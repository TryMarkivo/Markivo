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
              {t('landing.header.goToDashboard', 'Open dashboard')} <i className="fa-solid fa-gauge"></i>
            </button>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={onOpenLogin} id="btn_login_showcase">
                {t('auth.login', 'Sign in')}
              </button>
              <button className="btn btn-primary" onClick={() => onStartOnboarding('B')} id="btn_get_started_header">
                {t('landing.header.getStarted', 'Start free')}
              </button>
            </>
          )}
        </div>
      </header>

      {/* --- HERO SECTION --- */}
      <section className="hero-section">
        <div className="hero-content">
          <div className="badge animate-fade-in">{t('landing.hero.badge', 'For cafes, salons and shops')}</div>
          {/* Two short lines: the owner's job, then ours. The break keeps them
              reading as a pair instead of one run-on sentence. */}
          <h1 className="hero-title animate-fade-in">
            {t('landing.hero.titlePre', 'You run the business.')}<br />
            <span className="gradient-text">{t('landing.hero.titleHighlight', 'Markivo runs the marketing.')}</span> {t('landing.hero.titlePost', '')}
          </h1>
          <p className="hero-subtitle animate-fade-in">
            {t('landing.hero.subtitle', 'Markivo writes your posts, plans your week, watches your competitors and makes your ads, in Uzbek, Russian or English. Approve each post with one tap, or let it publish on its own.')}
          </p>
          <div className="hero-actions animate-fade-in">
            {isLoggedIn ? (
              <button className="btn btn-primary btn-lg" onClick={() => onStartOnboarding('dashboard')} id="btn_hero_cta">
                {t('landing.hero.ctaDashboard', 'Open my dashboard')} <i className="fa-solid fa-arrow-right"></i>
              </button>
            ) : (
              <>
                <button className="btn btn-primary btn-lg" onClick={() => onStartOnboarding('B')} id="btn_hero_cta">
                  {t('landing.hero.ctaBuild', 'Get my business online')} <i className="fa-solid fa-arrow-right"></i>
                </button>
                <button className="btn btn-secondary btn-lg" onClick={() => onStartOnboarding('A')} id="btn_hero_discover">
                  {t('landing.hero.ctaScan', 'Scan what I already have')} <i className="fa-solid fa-magnifying-glass"></i>
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
              <div className="preview-menu-item"><i className="fa-solid fa-pen-nib"></i> {t('landing.preview.menuContent', 'Posts')}</div>
              <div className="preview-menu-item"><i className="fa-solid fa-users"></i> {t('landing.preview.menuCompetitors', 'Competitors')}</div>
            </div>
            <div className="preview-main">
              <div className="preview-row">
                <div className="preview-stat-card">
                  <span className="stat-label">{t('landing.preview.statGoogle', 'Google Maps views')}</span>
                  <span className="stat-value text-accent">+12.4%</span>
                  <div className="stat-chart-mini"><i className="fa-solid fa-chart-area"></i></div>
                </div>
                <div className="preview-stat-card">
                  <span className="stat-label">{t('landing.preview.statInstagram', 'Instagram growth')}</span>
                  <span className="stat-value text-purple">+15.6%</span>
                  <div className="stat-chart-mini"><i className="fa-solid fa-chart-line"></i></div>
                </div>
              </div>
              <div className="preview-post-box glass-card">
                <div className="post-header">
                  <span className="post-avatar">🤖</span>
                  <div>
                    <h4>{t('landing.preview.agentName', 'Markiv, your AI marketer')}</h4>
                    <small>{t('landing.preview.agentStatus', 'Written and scheduled. Waiting for your OK.')}</small>
                  </div>
                </div>
                <p className="post-text">{t('landing.preview.postText', '"Warm pastries, a proper espresso and a quiet booth to get some work done. ☕ We open at 8. Come early: the window seats go first."')}</p>
                <div className="post-footer">
                  <span className="badge badge-success"><i className="fa-solid fa-check"></i> {t('landing.preview.approved', 'Approved')}</span>
                  <span className="badge badge-primary">{t('landing.preview.uzRuReady', 'In Uzbek and Russian')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --- PROBLEM SECTION --- */}
      <section className="problem-section">
        <h2 className="section-title">{t('landing.problem.title', 'You opened a business, not a marketing agency.')}</h2>
        <div className="grid-3">
          <div className="feature-card glass-card">
            <div className="feature-icon icon-gold"><i className="fa-solid fa-user-clock"></i></div>
            <h3>{t('landing.problem.card1Title', 'It all lands on you')}</h3>
            <p>{t('landing.problem.card1Text', "You open up, serve customers, chase suppliers and close the till. There's no time left to post, so your page goes quiet for weeks.")}</p>
          </div>
          <div className="feature-card glass-card">
            <div className="feature-icon icon-blue"><i className="fa-solid fa-puzzle-piece"></i></div>
            <h3>{t('landing.problem.card2Title', 'The tools expect a marketer')}</h3>
            <p>{t('landing.problem.card2Text', 'HubSpot, Hootsuite and the rest assume you already have followers, a budget and someone who knows marketing.')}</p>
          </div>
          <div className="feature-card glass-card">
            <div className="feature-icon icon-purple"><i className="fa-solid fa-earth-asia"></i></div>
            <h3>{t('landing.problem.card3Title', 'Not in your language')}</h3>
            <p>{t('landing.problem.card3Text', 'Your customers in Uzbekistan read Uzbek and Russian. The big marketing tools were made for other markets.')}</p>
          </div>
        </div>
        <p className="problem-gap">
          <Trans i18nKey="landing.problem.gap">Other tools help you <em>manage</em> your marketing. Markivo <strong className="gradient-text">does it for you.</strong></Trans>
        </p>
      </section>

      {/* --- HOW IT WORKS: TWO PATHS --- */}
      <section className="paths-section" id="how">
        <h2 className="section-title">{t('landing.paths.title', 'Start from where you are.')}</h2>
        <p className="section-subtitle">{t('landing.paths.subtitle', "If you're already online, Markivo finds what you have. If you're starting from nothing, it builds it with you. Either way, it keeps things running after that.")}</p>

        <div className="grid-2 paths-grid">
          <div className="path-card glass-card">
            <div className="path-label">{t('landing.paths.pathALabel', 'PATH A')}</div>
            <h3>{t('landing.paths.pathATitle', '"I already have something"')}</h3>
            <ol className="path-steps">
              <li>{t('landing.paths.pathAStep1', 'Markivo searches the web for your Maps listing, social pages and reviews')}</li>
              <li>{t('landing.paths.pathAStep2', "You tick what's yours and skip what isn't")}</li>
              <li>{t('landing.paths.pathAStep3', 'Connect your accounts securely')}</li>
              <li>{t('landing.paths.pathAStep4', 'Your dashboard fills with your real numbers')}</li>
            </ol>
            <button className="btn btn-secondary w-full" onClick={() => onStartOnboarding('A')} id="btn_path_a">
              {t('landing.paths.pathACta', 'Scan my business')}
            </button>
          </div>
          <div className="path-card glass-card glass-card-glow">
            <div className="path-label">{t('landing.paths.pathBLabel', 'PATH B')}</div>
            <h3>{t('landing.paths.pathBTitle', '"I have nothing yet"')}</h3>
            <ol className="path-steps">
              <li>{t('landing.paths.pathBStep1', 'Tell Markivo what you do, where, and who your customers are')}</li>
              <li>{t('landing.paths.pathBStep2', 'Pick a logo and slogan made for your business')}</li>
              <li>{t('landing.paths.pathBStep3', 'Markivo sets up your Google Business Profile and social pages')}</li>
              <li>{t('landing.paths.pathBStep4', 'It plans your first posts, then starts publishing')}</li>
            </ol>
            <button className="btn btn-primary w-full" onClick={() => onStartOnboarding('B')} id="btn_path_b">
              {t('landing.paths.pathBCta', 'Start from scratch')}
            </button>
          </div>
        </div>
        <p className="paths-outro">
          <Trans i18nKey="landing.paths.outro">Once you're set up, <strong>Markiv</strong>, your AI marketer, takes over the daily work: writing posts, sorting your inbox, reading the numbers and suggesting your next move.</Trans>
        </p>
      </section>

      {/* --- FEATURES GRID --- */}
      <section className="features-section" id="features">
        <h2 className="section-title">{t('landing.features.title', "A marketing team's work, without hiring one.")}</h2>
        <p className="section-subtitle">{t('landing.features.subtitle', 'Everything it takes to bring customers in, from your neighborhood and beyond.')}</p>

        <div className="grid-3">
          <div className="feature-card glass-card">
            <div className="feature-icon icon-gold"><i className="fa-solid fa-wand-magic-sparkles"></i></div>
            <h3>{t('landing.features.brandTitle', 'A brand from day one')}</h3>
            <p>{t('landing.features.brandText', 'Your logo, slogan and tone of voice, made in seconds. You have a complete brand before your first post.')}</p>
          </div>
          <div className="feature-card glass-card">
            <div className="feature-icon icon-blue"><i className="fa-solid fa-paper-plane"></i></div>
            <h3>{t('landing.features.postingTitle', 'All your pages, one place')}</h3>
            <p>{t('landing.features.postingText', 'Instagram, Telegram, Facebook and Google. Posts are written, scheduled and published from one screen.')}</p>
          </div>
          <div className="feature-card glass-card">
            <div className="feature-icon icon-purple"><i className="fa-solid fa-camera"></i></div>
            <h3>{t('landing.features.contentTitle', 'Photos and video')}</h3>
            <p>{t('landing.features.contentText', 'Markivo shows you how to shoot on your phone, touches up your photos and video, and makes AI video sized for each platform.')}</p>
          </div>
          <div className="feature-card glass-card">
            <div className="feature-icon icon-blue"><i className="fa-solid fa-inbox"></i></div>
            <h3>{t('landing.features.inboxTitle', 'Your inbox, handled')}</h3>
            <p>{t('landing.features.inboxText', 'Markiv sums up your Gmail, sorts it and answers for you. It learns how you reply as it goes.')}</p>
          </div>
          {/* DISABLED: SEO/Meta temporarily off — see 2026-08-13
              The SEO + AI search feature card.

              <div className="feature-card glass-card">
              <div className="feature-icon icon-gold"><i className="fa-solid fa-magnifying-glass-chart"></i></div>
              <h3>{t('landing.features.seoTitle', 'Found on Google and in AI search')}</h3>
              <p>{t('landing.features.seoText', 'Show up higher on Google, and in ChatGPT and Perplexity, where more of your customers now search.')}</p>
              </div>
          */}
          <div className="feature-card glass-card">
            <div className="feature-icon icon-purple"><i className="fa-solid fa-users-viewfinder"></i></div>
            <h3>{t('landing.features.intelTitle', 'Eyes on your competitors')}</h3>
            <p>{t('landing.features.intelText', 'Markivo tracks what rivals post, how fast they grow and where they fall short, then tells you how to answer.')}</p>
          </div>
        </div>
      </section>

      {/* --- PRICING SECTION --- */}
      <section className="pricing-section" id="pricing">
        <h2 className="section-title">{t('landing.pricing.title', 'Start free. Upgrade when you need more.')}</h2>
        <p className="section-subtitle">{t('landing.pricing.subtitle', 'Getting online costs nothing. When you want Markiv and AI video working for you every week, choose Pro or Ultimate.')}</p>

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
            <p className="plan-description">{t('landing.pricing.free.desc', 'Everything you need to get online')}</p>
            <div className="plan-price">
              <span className="price-symbol">$</span>
              <span className="price-number">0</span>
              <span className="price-duration">{t('landing.pricing.perMonth', '/mo')}</span>
            </div>
            <ul className="plan-features">
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.free.feat1', 'Full setup on either path')}</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.free.feat2', 'AI logo and slogan')}</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.free.feat3', 'Google Business setup')}</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.free.feat4', 'Social channels connected')}</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.free.feat5', '25 AI generations a month')}</li>
            </ul>
            <button className="btn btn-secondary w-full mt-auto" onClick={() => handlePlanClick('freemium')} id="btn_plan_free">
              {t('landing.pricing.free.cta', 'Start free')}
            </button>
          </div>

          {/* PRO */}
          <div className="pricing-card glass-card pro-card glass-card-glow">
            <div className="popular-badge">{t('landing.pricing.pro.badge', 'BEST VALUE')}</div>
            <h3>{t('landing.pricing.pro.name', 'Pro')}</h3>
            <p className="plan-description">{t('landing.pricing.pro.desc', 'For businesses ready to grow')}</p>
            <div className="plan-price">
              <span className="price-symbol">$</span>
              <span className="price-number">{pricing.pro[billingPeriod]}</span>
              <span className="price-duration">{t('landing.pricing.perMonth', '/mo')}</span>
            </div>
            <ul className="plan-features">
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.pro.feat1', 'Everything in Free')}</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.pro.feat2', 'AI photo touch-ups and editor')}</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.pro.feat3', '3 AI videos a week')}</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.pro.feat4', 'Gmail summaries and sorting')}</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.pro.feat5', 'Markiv, with 100 generations a month')}</li>
            </ul>
            <button className="btn btn-primary w-full mt-auto" onClick={() => handlePlanClick('pro')} id="btn_plan_pro">
              {t('landing.pricing.pro.cta', 'Choose Pro')}
            </button>
          </div>

          {/* ULTIMATE */}
          <div className="pricing-card glass-card">
            <h3>{t('landing.pricing.ultimate.name', 'Ultimate')}</h3>
            <p className="plan-description">{t('landing.pricing.ultimate.desc', 'Your whole marketing team, on autopilot')}</p>
            <div className="plan-price">
              <span className="price-symbol">$</span>
              <span className="price-number">{pricing.ultimate[billingPeriod]}</span>
              <span className="price-duration">{t('landing.pricing.perMonth', '/mo')}</span>
            </div>
            <ul className="plan-features">
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.ultimate.feat1', 'Everything in Pro')}</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.ultimate.feat2', '7 AI videos a week')}</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.ultimate.feat3', 'Gmail auto-replies in your voice')}</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.ultimate.feat4', 'AI-built website')}</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> {t('landing.pricing.ultimate.feat5', 'Markiv, with 250 generations a month')}</li>
            </ul>
            <button className="btn btn-secondary w-full mt-auto" onClick={() => handlePlanClick('ultimate')} id="btn_plan_ultimate">
              {t('landing.pricing.ultimate.cta', 'Choose Ultimate')}
            </button>
          </div>
        </div>
      </section>

      {/* --- FOUNDER SECTION --- */}
      <section className="founder-section" id="about">
        <h2 className="section-title">{t('landing.founder.title', 'Made by someone who has done this job himself.')}</h2>
        <div className="founder-card glass-card">
          <div className="founder-head">
            <div className="avatar avatar-lg">E</div>
            <div>
              <h3>{t('landing.founder.name', 'Elshod, founder and builder')}</h3>
              <small>{t('landing.founder.meta', 'CS and business · builds Markivo solo · UZ / RU / EN')}</small>
            </div>
          </div>
          <div className="grid-2 founder-points">
            <p><strong>{t('landing.founder.point1Title', 'He builds it himself.')}</strong> {t('landing.founder.point1Text', 'With a computer science background, he designs the AI, the automations and the data behind Markivo, and ships the product on his own.')}</p>
            <p><strong>{t('landing.founder.point2Title', 'He starts with your problem.')}</strong> {t('landing.founder.point2Text', "His business studies keep every feature tied to a real owner's problem. No tech for the sake of tech.")}</p>
            <p><strong>{t('landing.founder.point3Title', 'He knows this market.')}</strong> {t('landing.founder.point3Text', "He knows Uzbekistan from the inside: owners here want to grow online, and the right tools simply weren't there.")}</p>
            <p><strong>{t('landing.founder.point4Title', "He's been there.")}</strong> {t('landing.founder.point4Text', "He once ran all the marketing for a local business on his own. It was too much for one person. That's why Markivo exists.")}</p>
          </div>
        </div>
      </section>

      {/* --- CLOSING CTA --- */}
      <section className="cta-banner glass-card glass-card-glow">
        <h2>{t('landing.cta.titlePre', 'Get back to your customers.')} <span className="gradient-text">{t('landing.cta.titleHighlight', 'Markivo takes it from here.')}</span></h2>
        <p>{t('landing.cta.subtitle', 'From zero to a business people can find online, in Uzbek, Russian and English. Start on the free plan and see what Markivo writes for you.')}</p>
        <button className="btn btn-primary btn-lg" onClick={() => onStartOnboarding(isLoggedIn ? 'dashboard' : 'B')} id="btn_cta_bottom">
          {t('landing.cta.button', 'Start free today')} <i className="fa-solid fa-arrow-right"></i>
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
