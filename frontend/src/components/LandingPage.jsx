import { useState } from 'react';
import './LandingPage.css';

export default function LandingPage({ onStartOnboarding, onOpenLogin, isLoggedIn }) {
  const [billingPeriod, setBillingPeriod] = useState('monthly'); // 'monthly' | 'yearly'

  const pricing = {
    freemium: { monthly: 0, yearly: 0 },
    pro: { monthly: 20, yearly: 16 },
    ultimate: { monthly: 50, yearly: 40 }
  };

  return (
    <div className="landing-container animate-fade-in">
      {/* --- HEADER --- */}
      <header className="landing-header glass-card">
        <div className="logo-text">
          <div className="logo-icon">M</div>
          Markivo
        </div>
        <nav className="header-nav">
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <a href="#about">About</a>
        </nav>
        <div className="header-actions">
          {isLoggedIn ? (
            <button className="btn btn-primary" onClick={() => onStartOnboarding('dashboard')} id="btn_goto_dash">
              Go to Dashboard <i className="fa-solid fa-gauge"></i>
            </button>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={onOpenLogin} id="btn_login_showcase">
                Sign In
              </button>
              <button className="btn btn-primary" onClick={() => onStartOnboarding('B')} id="btn_get_started_header">
                Get Started
              </button>
            </>
          )}
        </div>
      </header>

      {/* --- HERO SECTION --- */}
      <section className="hero-section">
        <div className="hero-content">
          <div className="badge animate-fade-in">✦ AI-Powered Marketing OS</div>
          <h1 className="hero-title animate-fade-in">
            Build, Manage & Grow Your <span className="gradient-text">Entire Digital Presence</span> Automatically
          </h1>
          <p className="hero-subtitle animate-fade-in">
            No marketing team? No social presence? No problem. Markivo connects or builds your Google, Instagram, and Telegram business channels, designs logos, schedules expert AI posts, and tracks competitors—completely in Uzbek, Russian, and English.
          </p>
          <div className="hero-actions animate-fade-in">
            {isLoggedIn ? (
              <button className="btn btn-primary btn-lg" onClick={() => onStartOnboarding('dashboard')} id="btn_hero_cta">
                Go to My Dashboard <i className="fa-solid fa-arrow-right"></i>
              </button>
            ) : (
              <>
                <button className="btn btn-primary btn-lg" onClick={() => onStartOnboarding('B')} id="btn_hero_cta">
                  Create My Business Presence <i className="fa-solid fa-arrow-right"></i>
                </button>
                <button className="btn btn-secondary btn-lg" onClick={() => onStartOnboarding('A')} id="btn_hero_discover">
                  Scan Existing Brand <i className="fa-solid fa-magnifying-glass"></i>
                </button>
              </>
            )}
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
              <div className="preview-logo">☕ Cafe Noir</div>
              <div className="preview-menu-item active"><i className="fa-solid fa-chart-line"></i> Dashboard</div>
              <div className="preview-menu-item"><i className="fa-solid fa-pen-nib"></i> Content Engine</div>
              <div className="preview-menu-item"><i className="fa-solid fa-users"></i> Competitor Gaps</div>
            </div>
            <div className="preview-main">
              <div className="preview-row">
                <div className="preview-stat-card">
                  <span className="stat-label">Google Maps Views</span>
                  <span className="stat-value text-accent">+12.4%</span>
                  <div className="stat-chart-mini"><i className="fa-solid fa-chart-area"></i></div>
                </div>
                <div className="preview-stat-card">
                  <span className="stat-label">Instagram Growth</span>
                  <span className="stat-value text-purple">+15.6%</span>
                  <div className="stat-chart-mini"><i className="fa-solid fa-chart-line"></i></div>
                </div>
              </div>
              <div className="preview-post-box glass-card">
                <div className="post-header">
                  <span className="post-avatar">🤖</span>
                  <div>
                    <h4>AI Marketing Agent</h4>
                    <small>Scheduled for Telegram channel</small>
                  </div>
                </div>
                <p className="post-text">"Looking for the best espresso in Tashkent? ☕ We've got you covered with fresh local pastries and cozy workspace booths!"</p>
                <div className="post-footer">
                  <span className="badge badge-success"><i className="fa-solid fa-check"></i> Approved</span>
                  <span className="badge badge-primary">Uzbek/Russian Ready</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --- FEATURES GRID --- */}
      <section className="features-section" id="features">
        <h2 className="section-title">The Complete Marketing Toolbox</h2>
        <p className="section-subtitle">Everything you need to capture customers locally and globally</p>

        <div className="grid-3">
          <div className="feature-card glass-card">
            <div className="feature-icon icon-gold"><i className="fa-solid fa-wand-magic-sparkles"></i></div>
            <h3>Onboarding Wizard</h3>
            <p>Scan your existing web profile in seconds, or let our wizard build your logo, social handles, and Google profile from pure description.</p>
          </div>
          <div className="feature-card glass-card">
            <div className="feature-icon icon-blue"><i className="fa-solid fa-brain"></i></div>
            <h3>Multilingual AI Copywriter</h3>
            <p>Generate highly engaging local captions tailored specifically to platform differences. Seamless Uzbek, Russian, and English tone-matching.</p>
          </div>
          <div className="feature-card glass-card">
            <div className="feature-icon icon-purple"><i className="fa-solid fa-camera"></i></div>
            <h3>Photo/Video Assistant</h3>
            <p>Get guided templates on how to capture your store like a professional, upload raw media, and let AI enhance quality and add subtitles.</p>
          </div>
        </div>
      </section>

      {/* --- PRICING SECTION --- */}
      <section className="pricing-section" id="pricing">
        <h2 className="section-title">Transparent, Scaling Plans</h2>
        <p className="section-subtitle">Start free, unlock advanced AI generation when you are ready to scale</p>

        <div className="billing-selector">
          <button 
            className={`billing-btn ${billingPeriod === 'monthly' ? 'active' : ''}`}
            onClick={() => setBillingPeriod('monthly')}
          >
            Monthly
          </button>
          <button 
            className={`billing-btn ${billingPeriod === 'yearly' ? 'active' : ''}`}
            onClick={() => setBillingPeriod('yearly')}
          >
            Yearly <span className="discount-badge">Save 20%</span>
          </button>
        </div>

        <div className="grid-3 pricing-grid">
          {/* FREE */}
          <div className="pricing-card glass-card">
            <h3>Freemium</h3>
            <p className="plan-description">For newly opened local businesses</p>
            <div className="plan-price">
              <span className="price-symbol">$</span>
              <span className="price-number">0</span>
              <span className="price-duration">/mo</span>
            </div>
            <ul className="plan-features">
              <li><i className="fa-solid fa-circle-check text-accent"></i> Full onboarding wizard setup</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> Logo generation (1 time)</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> Google Business setup guide</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> 1 Connected social platform</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> Basic analytics dashboard</li>
            </ul>
            <button className="btn btn-secondary w-full mt-auto" onClick={() => onStartOnboarding('B')} id="btn_plan_free">
              Get Started Free
            </button>
          </div>

          {/* PRO */}
          <div className="pricing-card glass-card pro-card glass-card-glow">
            <div className="popular-badge">MOST POPULAR</div>
            <h3>Pro Plan</h3>
            <p className="plan-description">Ideal for active growing businesses</p>
            <div className="plan-price">
              <span className="price-symbol">$</span>
              <span className="price-number">{pricing.pro[billingPeriod]}</span>
              <span className="price-duration">/mo</span>
            </div>
            <ul className="plan-features">
              <li><i className="fa-solid fa-circle-check text-accent"></i> **Unlimited** platform connections</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> AI Video Generator (3 videos/wk)</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> Scheduled publishing calendar</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> Competitor tracking (3 brands)</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> Gmail inbox AI summaries</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> AI Agent (100 tokens/mo)</li>
            </ul>
            <button className="btn btn-primary w-full mt-auto" onClick={() => onStartOnboarding('B')} id="btn_plan_pro">
              Scale Up Now
            </button>
          </div>

          {/* ULTIMATE */}
          <div className="pricing-card glass-card">
            <h3>Ultimate</h3>
            <p className="plan-description">Full autonomous marketing team</p>
            <div className="plan-price">
              <span className="price-symbol">$</span>
              <span className="price-number">{pricing.ultimate[billingPeriod]}</span>
              <span className="price-duration">/mo</span>
            </div>
            <ul className="plan-features">
              <li><i className="fa-solid fa-circle-check text-accent"></i> **7 AI Videos** per week</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> AI website generation & hosting</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> Autonomous Gmail FAQ replies</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> Unlimited competitor tracking</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> AI Agent (250 tokens/mo)</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> 24/7 VIP Local support</li>
            </ul>
            <button className="btn btn-secondary w-full mt-auto" onClick={() => onStartOnboarding('B')} id="btn_plan_ultimate">
              Go Autonomous
            </button>
          </div>
        </div>
      </section>

      {/* --- TESTIMONIALS --- */}
      <section className="testimonials-section">
        <h2 className="section-title">Loved by Local Founders</h2>
        <p className="section-subtitle">Real feedback from business owners who built their digital storefronts</p>

        <div className="grid-2">
          <div className="testimonial-card glass-card">
            <p className="testimonial-text">
              "We opened our coffee shop in Tashkent and had no social media pages or Google Maps listing. In one evening, Markivo generated a beautiful brown coffee theme logo, registered us on Google, and generated daily Instagram posts in Russian and Uzbek. Our weekend traffic grew by 35%!"
            </p>
            <div className="testimonial-user">
              <div className="avatar">AM</div>
              <div>
                <h4>Anvar Mirzayev</h4>
                <small>Founder, Noir Coffee & Workspace</small>
              </div>
            </div>
          </div>
          <div className="testimonial-card glass-card">
            <p className="testimonial-text">
              "Managing Instagram, Telegram, and Google reviews was overwhelming while managing the barbershop. Markivo handles all post planning, suggests TikTok caption trends, and scans what the nearby barbershops are posting. It is like having a digital marketer on a $20 budget."
            </p>
            <div className="testimonial-user">
              <div className="avatar">SD</div>
              <div>
                <h4>Sardor Dadajonov</h4>
                <small>Owner, Style & Cut Studio</small>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --- FOOTER --- */}
      <footer className="landing-footer">
        <p>© 2026 Markivo. Built for local business builders. All rights reserved.</p>
      </footer>
    </div>
  );
}
