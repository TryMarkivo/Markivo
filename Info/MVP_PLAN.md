# Markivo MVP Implementation Plan

## Overview
This document outlines the Minimum Viable Product (MVP) implementation plan for Markivo, based on the Overview document specifications. The MVP focuses on core functionality that delivers immediate value while adhering to the ruthless scope control defined in Section 12.

**MVP Scope**: Onboarding wizard → Google Business + Instagram → AI content generation → Basic analytics → AI agent (chat only)

**Excluded from MVP** (per Section 12):
- ~~Telegram integration~~ — built 2026-06-10, briefly de-scoped, **re-enabled for launch 2026-06-11** (`TELEGRAM_ENABLED` flag kept for rollback)
- Affiliate marketing system
- AI website generation  
- Gmail auto-reply learning
- Agency multi-client dashboard
- YouTube integration
- WhatsApp Business API
- Google Ads / Meta Ads management
- AI video generation (Phase 2)
- UGC engine

---

## Phase 1: Foundation & Authentication (Week 1)

### Tasks:
- [ ] Set up development environment with proper React/Vite configuration
- [ ] Implement secure authentication system (JWT-based with refresh tokens)
- [ ] Create protected routes and authentication context
- [ ] Design and implement global state management (Context API or Zustand)
- [ ] Set up API service layer with environment Variable configuration
- [ ] Implement responsive design foundation (mobile-first approach)
- [ ] Create reusable UI components (buttons, forms, modals, cards)
- [ ] Establish coding standards and linting rules

### Deliverables:
- Working authentication system (login/register)
- Protected route structure
- API service abstraction layer
- Responsive UI Foundation

---

## Phase 2: MVP Onboarding Wizard (Weeks 2-3)

### Tasks:
#### Onboarding Path A: Discovery Mode
- [ ] Implement business name + location input form
- [ ] Create scanning simulation with progress indicators
- [ ] Design results verification grid with toggle selections
- [ ] Implement AI summary insights display
- [ ] Add rescan functionality
- [ ] Connect to backend discovery API endpoints
- [ ] Implement OAuth flows for platform connections (Google Business, Instagram, Telegram)

#### Onboarding Path B: Build From Scratch Mode
- [ ] Implement 9-step guided setup wizard:
  1. Business Category dropdown + search
  2. Business Description textarea
  3. Location input + online/remote toggle
  4. Target Audience input
  5. Brand Tone selection (6 options)
  6. Brand Identity/Slogan (user input + AI generation)
  7. Logo (upload + AI generation options)
  8. Website URL input (optional)
  9. Existing Social Accounts multi-select (limited to MVP: Google Business, Instagram, Telegram only)
  
- [ ] Implement action sequence execution:
  1. Brand identity package generation (visual preview)
  2. Google Business Profile setup simulation
  3. Instagram account setup simulation
  4. Telegram business channel setup simulation
  5. SEO baseline setup
  6. Initial content calendar generation
  
- [ ] Create live progress feed showing action execution
- [ ] Implement proper OAuth flows for all platform connections (replacing simple toggles)
- [ ] Add language selection (Uzbek/Russian/English)
- [ ] Implement brand preview throughout onboarding process

### Deliverables:
- Complete onboarding wizard with both paths
- Working OAuth integrations for Google Business, Instagram, Telegram
- Brand identity generation system
- Language localization framework
- MVP-compliant platform selection (no TikTok/WhatsApp)

---

## Phase 3: Marketing Dashboard (Week 4)

### Tasks:
- [ ] Create dashboard layout with responsive grid
- [ ] Implement connected platforms overview section
- [ ] Add follower counts and growth trends visualization
- [ ] Implement post engagement rates display per platform
- [ ] Add Google Business metrics (views, calls, direction requests)
- [ ] Create SEO position tracking dashboard
- [ ] Implement AI search visibility metrics (ChatGPT/Perplexity appearances)
- [ ] Add basic content calendar view (scheduled/posted/drafts)
- [ ] Create competitor tracking panel (manual input + AI suggestions)
- [ ] Implement dashboard real-time updates (WebSocket or polling)

### Deliverables:
- Fully functional marketing dashboard
- Real-time metrics display
- Content calendar view
- Competitor tracking interface
- SEO and AI search analytics

---

## Phase 4: Content Engine (Week 5)

### Tasks:
- [ ] Implement AI content generation interface
- [ ] Create platform-specific content formatters (Instagram ≠ Telegram ≠ etc.)
- [ ] Add hashtag research and auto-tagging system
- [ ] Implement content scheduling calendar
- [ ] Create photo/video workflow:
  * Tutorial mode: AI-guided shooting instructions
  * Upload & enhance: automatic quality improvement, editing, captioning, formatting
  * Cross-platform posting with AI-generated descriptions
- [ ] Implement content approval workflow (human approval required before publishing)
- [ ] Add content template library based on brand tone
- [ ] Create content performance analytics

### Deliverables:
- AI-powered content creation system
- Platform-specific content optimization
- Photo/video enhancement workflow
- Scheduled publishing with approval gates
- Content performance tracking

---

## Phase 5: AI Agent (Week 6)

### Tasks:
- [ ] Implement AI agent sidebar/chat interface
- [ ] Create intent classification system (content, email, analytics, publishing)
- [ ] Implement task router to appropriate agents:
  * Content Agent → Content Engine
  * Gmail Agent → Email functions
  * Data Agent → Analytics & tracking
  * Publish Agent → Content scheduling/posting
- [ ] Implement approval gate system (required for: new email replies, first-time content publishing, ad campaigns, money actions)
- [ ] Add Gmail inbox monitoring, summarizing, and smart sorting
- [ ] Implement analytics tracking and anomaly flagging
- [ ] Create agent learning system (flag unknown questions, learn from owner responses)
- [ ] Add conversational interface for business owner interaction

### Deliverables:
- Functional AI agent with task routing
- Approval gate system for sensitive actions
- Gmail monitoring and summarization
- Analytics tracking and anomaly detection
- Conversational business owner interface

---

## Technical Infrastructure (Throughout)

### Tasks:
- [ ] Set up backend API with Node.js/Express or Python FastAPI
- [ ] Implement PostgreSQL database schema for:
  * User accounts and authentication
  * Business profiles and onboarding data
  * Connected platform credentials (encrypted)
  * Content library and scheduling
  * Analytics and metrics
  * Agent interactions and learning
- [ ] Implement Redis for caching and job queues
- [ ] Set up BullMQ for background job processing
- [ ] Implement proper security measures:
  * HTTP-only cookies for token storage (or secure localStorage with expiration)
  * Token refresh mechanism
  * Input validation and sanitization
  * Rate limiting and API security
- [ ] Implement environment-based configuration
- [ ] Set up logging and error monitoring
- [ ] Create Docker configuration for easy deployment
- [ ] Implement comprehensive testing strategy

### Deliverables:
- Fully functional backend API
- Secure database schema
- Caching and job queue systems
- Production-ready deployment configuration
- Security implementation

---

## Success Criteria & Metrics

### Functional Requirements:
- [ ] Users can complete both onboarding paths (Discovery and Build From Scratch)
- [ ] Successful OAuth connections to Google Business, Instagram, and Telegram
- [ ] AI-generated brand identity package (logo, colors, tone guidelines)
- [ ] Content creation and scheduling across connected platforms
- [ ] Dashboard displays real-time metrics from connected platforms
- [ ] AI agent responds to business owner queries and executes approved tasks
- [ ] Multilingual support (Uzbek, Russian, English) functional
- [ ] Mobile-responsive design working across devices

### Non-Functional Requirements:
- [ ] Page load times < 3 seconds on 3G connection
- [ ] Authentication secure with proper token handling
- [ ] Data encrypted at rest and in transit
- [ ] System handles concurrent users effectively
- [ ] Error boundaries and graceful degradation implemented
- [ ] Accessibility compliant (WCAG 2.1 AA)

### Business Metrics:
- [ ] Time to complete onboarding < 10 minutes
- [ ] Content creation time reduced by 70% vs manual process
- [ ] User satisfaction score (NPS) > 40 in beta testing
- [ ] System uptime > 99% during active hours
- [ ] Error rate < 1% for core flows

---

## Risk Mitigation

### Technical Risks:
- **API Integration Complexity**: Mitigation - Implement abstraction layer, start with mock implementations, use sandbox APIs
- **OAuth Flow Complexity**: Mitigation - Use established libraries (passport.js, simple-oauth2), document each flow clearly
- **AI Service Costs**: Mitigation - Implement token usage monitoring, optimize prompts, set tier-based limits
- **Browser Compatibility**: Mitigation - Test across major mobile browsers, use responsive design principles
- **Data Privacy**: Mitigation - Encrypt sensitive data, implement data deletion features, clear privacy policy

### Scope Risks:
- **Feature Creep**: Mitigation - Strict adherence to MVP scope document, weekly scope review meetings
- **Platform Changes**: Mitigation - Build abstraction layers, monitor platform developer blogs, maintain flexibility
- **Performance Issues**: Mitigation - Implement performance budgets, use code splitting, lazy loading, optimize images
- **Security Vulnerabilities**: Mitigation - Regular security audits, dependency scanning, penetration testing before launch

### Market Risks:
- **User Acquisition**: Mitigation - Founder-led initial sales, build-in-public strategy, free tier value proposition
- **Technical Adoption**: Mitigation - Extensive onboarding tutorials, contextual help, responsive support
- **Local Market Specifics**: Mitigation - Continuous user feedback from Uzbekistan/Central Asia beta users

---

## Dependencies & External Services

### Required APIs:
- Google Business Profile API
- Instagram Graph API (via Meta)
- Telegram Bot API
- Claude API (Anthropic) for AI agent and content generation
- OpenAI API or Stable Diffusion for image generation (logo, content visuals)
- Whisper API for audio transcription (if implementing video features later)
- Google Search Console API for SEO
- Optional: Yandex/2GIS APIs for CIS markets (Phase 2)

### Third-party Services:
- Authentication: JWT implementation (custom or Auth0-like)
- Hosting: Vercel (frontend), Railway/Render (backend)
- Monitoring: Custom logging or Sentry
- Payments: Stripe via international entity (UBT not available directly in Uzbekistan)
- File Storage: AWS S3 or equivalent

### Development Tools:
- IDE: VS Code or equivalent
- Version Control: Git/GitHub
- Package Management: npm/yarn
- Testing: Jest, React Testing Library, Cypress
- CI/CD: GitHub Actions

---

## Appendices

### Appendix A: Component Mapping to MVP Features

| Component | MVP Feature | Status |
|-----------|-------------|--------|
| OnboardingPathA.jsx | Discovery Mode Onboarding | Needs OAuth implementation |
| OnboardingPathB.jsx | Build From Scratch Onboarding | Needs scope correction (TikTok/WhatsApp removal) |
| Dashboard.jsx | Marketing Dashboard | Needs metrics implementation |
| ContentEngine.jsx | AI Content Generation | Needs backend integration |
| AIAgentSidebar.jsx | AI Agent | Needs task routing implementation |
| CompetitorIntel.jsx | Competitor Intelligence | Needs implementation |
| LandingPage.jsx | Marketing Site | Completed |

### Appendix B: API Endpoints Required

Authentication:
- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/logout
- GET /api/auth/me
- POST /api/auth/refresh

Onboarding:
- POST /api/discovery/scan (Path A)
- POST /api/onboarding/slogans (Path B)
- POST /api/onboarding/construct (Both paths)

Platform Connections:
- GET /api/platforms/google/auth
- GET /api/platforms/instagram/auth
- GET /api/platforms/telegram/auth
- POST /api/platforms/{platform}/callback

Content:
- POST /api/content/generate
- POST /api/content/schedule
- GET /api/content/calendar
- POST /api/content/publish

Analytics:
- GET /api/analytics/dashboard
- GET /api/analytics/seo
- GET /api/analytics/platforms/{platform}

Agent:
- POST /api/agent/chat
- POST /api/agent/learn
- GET /api/agent/history

### Appendix C: Database Schema Overview

Users:
- id, email, password_hash, full_name, role, created_at, updated_at

BusinessProfiles:
- id, user_id, business_name, category, description, location, is_online, audience, tone, slogan, logo_data, onboarded_at, onboard_path

PlatformConnections:
- id, business_id, platform_type, access_token (encrypted), refresh_token (encrypted), expires_at, connected_at

ContentLibrary:
- id, business_id, content_type, platform, generated_text, media_urls, scheduled_at, published_at, performance_metrics

AgentInteractions:
- id, business_id, session_id, message_type, content, response, created_at, learning_flag

Analytics:
- id, business_id, date, platform, metrics_json, created_at

---

## Implementation Notes

1. **ToS Compliance**: All platform connections MUST use proper OAuth flows with user authorization - NO automated account creation without explicit user consent via platform authorization screens.

2. **Language Implementation**: Use react-i18next or similar for Uzbek/Russian/English support. Store translations in JSON files.

3. **State Management**: Consider Zustand for simplicity or Context API for prop drilling avoidance.

4. **Styling**: Continue with Tailwind CSS as specified in Overview, implement dark/light mode options.

5. **Performance**: Implement React.memo, useCallback, useMemo where appropriate. Use code splitting for route-based components.

6. **Testing Strategy**: Unit tests for utilities and hooks, integration tests for components, e2e tests for critical user flows.

7. **Deployment**: Use environment variables for all configuration. Implement blue-green deployment strategy for zero-downtime upgrades.

8. **Monitoring**: Implement comprehensive logging, error tracking, and performance monitoring from day one.

Let me know when you're ready to proceed with implementation, and I'll help you execute each phase systematically.