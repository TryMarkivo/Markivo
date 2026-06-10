import { useState } from 'react';
import './LandingPage.css';
import logoUrl from '../assets/markivo-logo.png';

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
          <img src={logoUrl} alt="Markivo" className="logo-img" />
          Markivo
        </div>
        <nav className="header-nav">
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
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
          <div className="badge animate-fade-in">✦ THE AI MARKETING PLATFORM</div>
          <h1 className="hero-title animate-fade-in">
            From <span className="gradient-text">zero</span> to fully running.
          </h1>
          <p className="hero-subtitle animate-fade-in">
            Markivo is an all-in-one marketing platform that builds, manages, and grows your
            business's entire online presence — across every channel, in any language,
            fully autonomously. Native Uzbek, Russian, and English.
          </p>
          <div className="hero-actions animate-fade-in">
            {isLoggedIn ? (
              <button className="btn btn-primary btn-lg" onClick={() => onStartOnboarding('dashboard')} id="btn_hero_cta">
                Go to My Dashboard <i className="fa-solid fa-arrow-right"></i>
              </button>
            ) : (
              <>
                <button className="btn btn-primary btn-lg" onClick={() => onStartOnboarding('B')} id="btn_hero_cta">
                  Build My Presence From Zero <i className="fa-solid fa-arrow-right"></i>
                </button>
                <button className="btn btn-secondary btn-lg" onClick={() => onStartOnboarding('A')} id="btn_hero_discover">
                  Scan My Existing Brand <i className="fa-solid fa-magnifying-glass"></i>
                </button>
              </>
            )}
          </div>
          <div className="hero-channels animate-fade-in">
            <span><i className="fa-brands fa-google"></i> Google</span>
            <span><i className="fa-brands fa-instagram"></i> Instagram</span>
            <span><i className="fa-brands fa-telegram"></i> Telegram</span>
            <span><i className="fa-brands fa-tiktok"></i> TikTok</span>
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
                    <h4>Markiv — AI Marketing Agent</h4>
                    <small>Drafted & scheduled, pending your approval</small>
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

      {/* --- PROBLEM SECTION --- */}
      <section className="problem-section">
        <h2 className="section-title">Millions of businesses have no marketing — and no idea where to start.</h2>
        <div className="grid-3">
          <div className="feature-card glass-card">
            <div className="feature-icon icon-gold"><i className="fa-solid fa-user-clock"></i></div>
            <h3>No team, no time</h3>
            <p>Owner-operators do everything themselves. Marketing falls to the bottom of the list — or never happens at all.</p>
          </div>
          <div className="feature-card glass-card">
            <div className="feature-icon icon-blue"><i className="fa-solid fa-puzzle-piece"></i></div>
            <h3>Tools assume you exist</h3>
            <p>HubSpot, Hootsuite and the rest are built for businesses that already have a presence, a budget, and a marketer.</p>
          </div>
          <div className="feature-card glass-card">
            <div className="feature-icon icon-purple"><i className="fa-solid fa-earth-asia"></i></div>
            <h3>Emerging markets ignored</h3>
            <p>In Uzbekistan, Central Asia and the CIS, businesses are hungry for digital growth — but the tools aren't in their language.</p>
          </div>
        </div>
        <p className="problem-gap">
          The gap: every existing tool helps you <em>manage</em> marketing.
          None of them <strong className="gradient-text">start it for you.</strong>
        </p>
      </section>

      {/* --- HOW IT WORKS: TWO PATHS --- */}
      <section className="paths-section" id="how">
        <h2 className="section-title">Two paths. One outcome: a business that's fully online.</h2>
        <p className="section-subtitle">Markivo either discovers your existing presence — or builds one entirely from scratch — then runs it on autopilot.</p>

        <div className="grid-2 paths-grid">
          <div className="path-card glass-card">
            <div className="path-label">PATH A</div>
            <h3>"I already have something"</h3>
            <ol className="path-steps">
              <li>Scan the web for accounts, maps listing, reviews & ads</li>
              <li>See everything found in a confirm / reject view</li>
              <li>Connect verified platforms securely</li>
              <li>Dashboard fills with live data instantly</li>
            </ol>
            <button className="btn btn-secondary w-full" onClick={() => onStartOnboarding('A')} id="btn_path_a">
              Scan My Digital Presence
            </button>
          </div>
          <div className="path-card glass-card glass-card-glow">
            <div className="path-label">PATH B</div>
            <h3>"I have nothing yet"</h3>
            <ol className="path-steps">
              <li>Guided wizard: category, brand tone, audience</li>
              <li>AI generates your slogan + logo, on brand</li>
              <li>Sets up Google Business & social channels</li>
              <li>Builds the first content calendar — then posts</li>
            </ol>
            <button className="btn btn-primary w-full" onClick={() => onStartOnboarding('B')} id="btn_path_b">
              Build From Scratch
            </button>
          </div>
        </div>
        <p className="paths-outro">
          Once set up, <strong>Markiv</strong> — your AI agent — takes over the day-to-day:
          content, inbox, analytics and growth. Day after day.
        </p>
      </section>

      {/* --- FEATURES GRID --- */}
      <section className="features-section" id="features">
        <h2 className="section-title">One platform replaces an entire marketing stack.</h2>
        <p className="section-subtitle">Everything you need to capture customers locally and globally</p>

        <div className="grid-3">
          <div className="feature-card glass-card">
            <div className="feature-icon icon-gold"><i className="fa-solid fa-wand-magic-sparkles"></i></div>
            <h3>Brand & identity</h3>
            <p>AI logo, slogan and tone-of-voice generated in seconds — a complete identity before your first post.</p>
          </div>
          <div className="feature-card glass-card">
            <div className="feature-icon icon-blue"><i className="fa-solid fa-paper-plane"></i></div>
            <h3>Multi-platform posting</h3>
            <p>Instagram, TikTok, Telegram, X & Google — written, scheduled and published from one place.</p>
          </div>
          <div className="feature-card glass-card">
            <div className="feature-icon icon-purple"><i className="fa-solid fa-camera"></i></div>
            <h3>Content engine</h3>
            <p>Shoot tips, automatic photo & video enhancement, and AI-generated video tuned to each platform.</p>
          </div>
          <div className="feature-card glass-card">
            <div className="feature-icon icon-blue"><i className="fa-solid fa-inbox"></i></div>
            <h3>Inbox agent</h3>
            <p>Gmail summarized, sorted and auto-replied — and it learns your answers as it goes.</p>
          </div>
          <div className="feature-card glass-card">
            <div className="feature-icon icon-gold"><i className="fa-solid fa-magnifying-glass-chart"></i></div>
            <h3>SEO + AI search</h3>
            <p>Rank on Google — and surface inside ChatGPT & Perplexity, where your customers now search.</p>
          </div>
          <div className="feature-card glass-card">
            <div className="feature-icon icon-purple"><i className="fa-solid fa-users-viewfinder"></i></div>
            <h3>Competitor intel</h3>
            <p>Track rivals' posting, growth and gaps automatically — and get moves to counter them.</p>
          </div>
        </div>
      </section>

      {/* --- PRICING SECTION --- */}
      <section className="pricing-section" id="pricing">
        <h2 className="section-title">Freemium that converts — three simple tiers.</h2>
        <p className="section-subtitle">Start free, unlock the autonomous marketing team when you're ready to scale</p>

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
            <h3>Free</h3>
            <p className="plan-description">The hook — everything to get online</p>
            <div className="plan-price">
              <span className="price-symbol">$</span>
              <span className="price-number">0</span>
              <span className="price-duration">/mo</span>
            </div>
            <ul className="plan-features">
              <li><i className="fa-solid fa-circle-check text-accent"></i> Full onboarding — both paths</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> AI logo & slogan generation</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> Google Business setup</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> Social channels connected</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> 25 AI generations / month</li>
            </ul>
            <button className="btn btn-secondary w-full mt-auto" onClick={() => onStartOnboarding('B')} id="btn_plan_free">
              Get Started Free
            </button>
          </div>

          {/* PRO */}
          <div className="pricing-card glass-card pro-card glass-card-glow">
            <div className="popular-badge">MOST VALUE</div>
            <h3>Pro</h3>
            <p className="plan-description">Ideal for active, growing businesses</p>
            <div className="plan-price">
              <span className="price-symbol">$</span>
              <span className="price-number">{pricing.pro[billingPeriod]}</span>
              <span className="price-duration">/mo</span>
            </div>
            <ul className="plan-features">
              <li><i className="fa-solid fa-circle-check text-accent"></i> Everything in Free</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> AI image enhance & editor</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> AI video — 3 / week</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> Gmail summary & sorting</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> Markiv agent · 100 generations / mo</li>
            </ul>
            <button className="btn btn-primary w-full mt-auto" onClick={() => onStartOnboarding('B')} id="btn_plan_pro">
              Scale Up Now
            </button>
          </div>

          {/* ULTIMATE */}
          <div className="pricing-card glass-card">
            <h3>Ultimate</h3>
            <p className="plan-description">A full autonomous marketing team</p>
            <div className="plan-price">
              <span className="price-symbol">$</span>
              <span className="price-number">{pricing.ultimate[billingPeriod]}</span>
              <span className="price-duration">/mo</span>
            </div>
            <ul className="plan-features">
              <li><i className="fa-solid fa-circle-check text-accent"></i> Everything in Pro</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> AI video — 7 / week</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> Gmail auto-reply (learns you)</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> AI website generation</li>
              <li><i className="fa-solid fa-circle-check text-accent"></i> Markiv agent · 250 generations / mo</li>
            </ul>
            <button className="btn btn-secondary w-full mt-auto" onClick={() => onStartOnboarding('B')} id="btn_plan_ultimate">
              Go Autonomous
            </button>
          </div>
        </div>
      </section>

      {/* --- FOUNDER SECTION --- */}
      <section className="founder-section" id="about">
        <h2 className="section-title">Built by someone who's done it for real.</h2>
        <div className="founder-card glass-card">
          <div className="founder-head">
            <div className="avatar avatar-lg">E</div>
            <div>
              <h3>Elshod — Founder & Builder</h3>
              <small>CS + Business · ships solo · UZ / RU / EN</small>
            </div>
          </div>
          <div className="grid-2 founder-points">
            <p><strong>Builds the whole thing.</strong> CS background — architects the AI agents, automations and data pipelines, and ships the product solo.</p>
            <p><strong>Thinks in solutions.</strong> A business education means features that solve real owner problems, not tech for its own sake.</p>
            <p><strong>Owns the market.</strong> Deep Uzbekistan knowledge, where demand for digital growth is high and the tools are absent.</p>
            <p><strong>Lived experience.</strong> Personally ran full marketing for a local business — this product exists because that job was too hard.</p>
          </div>
        </div>
      </section>

      {/* --- CLOSING CTA --- */}
      <section className="cta-banner glass-card glass-card-glow">
        <h2>Let's give every business a marketing team — <span className="gradient-text">in code.</span></h2>
        <p>Markivo turns zero into a fully-running online presence — autonomously, multilingually, and in the markets the giants ignore.</p>
        <button className="btn btn-primary btn-lg" onClick={() => onStartOnboarding(isLoggedIn ? 'dashboard' : 'B')} id="btn_cta_bottom">
          Start Free Today <i className="fa-solid fa-arrow-right"></i>
        </button>
      </section>

      {/* --- FOOTER --- */}
      <footer className="landing-footer">
        <p>© 2026 Markivo. From zero to fully running. All rights reserved.</p>
      </footer>
    </div>
  );
}
