import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import './AIAgentSidebar.css';

// Stored payload values are English (payload/lookup keys) — map to translation keys for display only.
const TONE_KEYS = {
  'Cozy & Warm': 'cozy',
  'Modern & Minimalist': 'modern',
  'Energetic & Fast-paced': 'energetic',
  'Professional & Trustworthy': 'professional',
  'Playful & Fun': 'playful',
  'Luxury & Premium': 'luxury'
};

const CATEGORY_KEYS = {
  'Cafe / Coffee Shop': 'cafe',
  'Beauty Salon / Spa': 'beauty',
  'Co-working & Study Space': 'coworking',
  'Retail Boutique / Fashion': 'retail',
  'Local Restaurant / Food': 'restaurant',
  'Professional Tech Agency': 'tech'
};

// `isOpen` is owned by the Dashboard: collapsing the panel has to reflow the
// main column into the freed space, and only the shell can do that.
export default function AIAgentSidebar({ activeProfile, telegramStatus, isOpen, onToggle }) {
  const { t, i18n } = useTranslation();
  const greetingMessage = () => ({
    sender: 'agent',
    text: t('agent.greeting', { defaultValue: "I'm Markiv. I draft posts, read your competitors, and publish to your connected channels when you ask.\n\nWhat are we working on?" }),
    time: t('agent.justNow', 'Just now')
  });
  const [messages, setMessages] = useState(() => [greetingMessage()]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  // 'model' when a real model answered, 'template' when the keyless fallback
  // did. Drives the frayed edge on the panel — a canned reply must never read
  // as a model reply.
  const [engine, setEngine] = useState(null);
  const [showApprovalGate, setShowApprovalGate] = useState(false);
  const [approvalDetails, setApprovalDetails] = useState(null);
  const [approvalId, setApprovalId] = useState(null);
  const [approvalSuccess, setApprovalSuccess] = useState(false);
  const [offline, setOffline] = useState(false);
  const threadRef = useRef(null);

  // Load persisted conversation history on mount; keep the greeting when empty.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get('/api/agent/history');
        if (!cancelled && Array.isArray(data?.messages) && data.messages.length > 0) {
          setMessages(data.messages.map(m => ({
            sender: m.sender,
            text: m.text,
            time: m.created_at
              ? new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : ''
          })));
        }
      } catch {
        /* history unavailable — keep the local greeting */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-scroll the thread to the bottom whenever messages change.
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleSendMessage = async (textToSend) => {
    const text = textToSend || inputText;
    if (!text.trim() || isTyping) return;

    // Add user message
    const userMsg = { sender: 'user', text, time: t('agent.justNow', 'Just now') };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsTyping(true);

    try {
      const data = await api.post('/api/agent/query', { query: text, lang: i18n.language });
      setIsTyping(false);
      setOffline(false);
      if (data.engine) setEngine(data.engine);

      if (data.triggerApproval) {
        setApprovalId(data.approvalId);
        setApprovalDetails(data.payload);
        setApprovalSuccess(false);
        setShowApprovalGate(true);
        setMessages(prev => [...prev, {
          sender: 'agent',
          text: data.reply || t('agent.authorizationNeeded', 'This action needs your authorization. Please review the request below.'),
          time: t('agent.justNow', 'Just now')
        }]);
      } else {
        setMessages(prev => [...prev, { sender: 'agent', text: data.reply, time: t('agent.justNow', 'Just now') }]);
      }
    } catch {
      // Server unreachable — fall back to a clearly-flagged local simulation.
      setOffline(true);
      setEngine('template');
      setTimeout(() => {
        let agentReply = '';
        const lowercaseText = text.toLowerCase();

        setIsTyping(false);

        if (lowercaseText.includes('instagram') || lowercaseText.includes('post') || lowercaseText.includes('copy')) {
          const toneKey = TONE_KEYS[activeProfile.tone];
          const toneLabel = toneKey ? t(`onboarding.tones.${toneKey}`, activeProfile.tone) : activeProfile.tone;
          agentReply = t('agent.fallback.instagramDraft', {
            defaultValue: 'I\'ve prepared a highly optimized Instagram draft post for you in your Content Engine tab. It highlights your custom brand tone "{{tone}}" and is ready for publishing with local hashtags. Let me know if you would like me to schedule it!',
            tone: toneLabel
          });
        } else if (lowercaseText.includes('competitor') || lowercaseText.includes('gap') || lowercaseText.includes('benchmark')) {
          agentReply = t('agent.fallback.competitorGap', 'I ran a local gap analysis. Your nearby competitors post average 8-12 times a week. Your current scheduling cadence is 3 times a week. I suggest scheduling 3-4 more items in your content calendar this week to boost organic engagement!');
        } else if (lowercaseText.includes('ad') || lowercaseText.includes('campaign') || lowercaseText.includes('money') || lowercaseText.includes('spend')) {
          triggerApprovalGate();
          return;
        } else {
          agentReply = t('agent.fallback.generic', {
            defaultValue: 'I understand you want to "{{query}}". I can draft copy, review competitor trends, or optimize your Google Profile keywords. Type \'create ad campaign\' or click the suggestions below to authorize external changes.',
            query: text
          });
        }

        setMessages(prev => [...prev, { sender: 'agent', text: agentReply, time: t('agent.justNow', 'Just now') }]);
      }, 800);
    }
  };

  const handleClearChat = async () => {
    try {
      if (typeof api.del === 'function') {
        await api.del('/api/agent/history');
      } else {
        // api.js has no delete helper — call the endpoint directly.
        await fetch(api.base + '/api/agent/history', {
          method: 'DELETE',
          headers: { Authorization: 'Bearer ' + api.tokens.access() }
        });
      }
    } catch {
      /* best-effort — reset locally regardless */
    }
    setIsTyping(false);
    setMessages([greetingMessage()]);
  };

  const triggerApprovalGate = () => {
    setApprovalId(null); // offline simulation — no server-side approval record
    const rawCategory = activeProfile.category || 'business';
    const categoryKey = CATEGORY_KEYS[rawCategory];
    const categoryLabel = categoryKey ? t(`onboarding.categories.${categoryKey}`, rawCategory) : rawCategory;
    setApprovalDetails({
      action: t('agent.approval.mockAction', 'Create Meta Ad Campaign'),
      cost: t('agent.approval.mockCost', '$5.00 / day'),
      target: t('agent.approval.mockTarget', 'Tashkent, remote workers (2-5km radius)'),
      creative: t('agent.approval.mockCreative', {
        defaultValue: 'Preview: "Experience the ultimate {{category}} vibe at #{{businessName}}! High-speed Wi-Fi, handcrafted coffee, and quiet study booths ready for you."',
        category: categoryLabel.toLowerCase(),
        businessName: activeProfile.businessName
      })
    });
    setApprovalSuccess(false);
    setShowApprovalGate(true);
  };

  const handleApproveAction = async () => {
    setApprovalSuccess(true);

    let resultText;
    try {
      if (approvalId) {
        const data = await api.post('/api/agent/approve', { approvalId });
        resultText = data.message || t('agent.approval.executed', 'Approved and executed.');
      } else {
        // Offline simulation path (no server-side approval record).
        resultText = t('agent.approval.simulated', 'Approved — simulated only, the server is offline.');
      }
    } catch (err) {
      resultText = err.message || t('agent.approval.error', 'The action could not be executed. Please try again.');
    }

    setShowApprovalGate(false);
    setMessages(prev => [...prev, { sender: 'agent', text: resultText, time: t('agent.justNow', 'Just now') }]);
  };

  return (
    <>
      <div className={`band ${isOpen ? 'open' : 'closed'}`} id="agent_sidebar_container">
        {/* HEADER */}
        <div className="band-head">
          {isOpen && (
            <div className="band-title">
              <h4>Markiv</h4>
              <small>{t('agent.subtitle', 'Marketing agent')}</small>
            </div>
          )}
          {!isOpen && <span className="band-stub-label">Markiv</span>}
          <div className="band-actions">
            {isOpen && (
              <button
                className="btn-close"
                onClick={handleClearChat}
                id="btn_clear_chat"
                title={t('agent.clearChat', 'Clear conversation')}
                aria-label={t('agent.clearChat', 'Clear conversation')}
              >
                <i className="fa-solid fa-trash-can"></i>
              </button>
            )}
            <button className="btn-close" onClick={onToggle} id="btn_toggle_agent" aria-label={t(isOpen ? 'agent.collapse' : 'agent.expand', isOpen ? 'Collapse panel' : 'Expand panel')}>
              <i className={`fa-solid ${isOpen ? 'fa-angles-right' : 'fa-angles-left'}`}></i>
            </button>
          </div>
        </div>

        {isOpen && (
          <>
            {/* Markiv answers from canned patterns without a model key. Saying so
                once, at the top of the thread, is the honest version of this
                panel — the alternative is a template passing as intelligence. */}
            {engine === 'template' && !offline && (
              <div className="band-note frayed" style={{ '--fray': 'var(--saffron)' }} role="status">
                <span className="frayed-note">{t('truth.canned', 'Canned replies')}</span>
                <p>{t('agent.templateNote', 'No model key is configured, so Markiv is answering from fixed patterns rather than reasoning about your business.')}</p>
              </div>
            )}

            {/* CHAT THREAD */}
            <div className="chat-thread-container" ref={threadRef}>
              {offline && (
                <div className="chat-offline-note" role="status">
                  <i className="fa-solid fa-triangle-exclamation"></i> {t('common.offlineDemo', 'Demo data — server offline')}
                </div>
              )}
              {messages.map((msg, index) => (
                <div key={index} className={`chat-bubble-wrap ${msg.sender === 'user' ? 'user-bubble' : 'agent-bubble'}`}>
                  <div className="chat-bubble">
                    <pre className="bubble-text">{msg.text}</pre>
                    <span className="bubble-time">{msg.time}</span>
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="chat-bubble-wrap agent-bubble" id="agent_typing_indicator">
                  <div className="chat-bubble typing-bubble">
                    <span className="typing-dots" role="status" aria-label={t('agent.typing', 'Typing...')}>
                      <span></span>
                      <span></span>
                      <span></span>
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* SUGGESTION BARS */}
            <div className="chat-suggestions">
              <button
                className="chip"
                onClick={() => handleSendMessage(
                  telegramStatus?.comingSoon
                    ? t('agent.prompts.draftAnnouncement', 'Draft a short announcement post for our business')
                    : telegramStatus?.connected
                      ? t('agent.prompts.postTelegram', 'Post a friendly update about our business to Telegram')
                      : t('agent.prompts.connectTelegram', 'How do I connect my Telegram channel?')
                )}
                id="btn_sug_telegram"
              >
                {telegramStatus?.comingSoon ? t('agent.suggestions.draftAnnouncement', 'Draft announcement') : t('agent.suggestions.postTelegram', 'Post to Telegram')}
              </button>
              <button className="chip" onClick={() => handleSendMessage(t('agent.prompts.instagramCopy', 'Generate Instagram post copy'))} id="btn_sug_insta">
                {t('agent.suggestions.instagram', 'Draft Instagram post')}
              </button>
              <button className="chip" onClick={() => handleSendMessage(t('agent.prompts.competitorGaps', 'Check competitor gaps'))} id="btn_sug_gaps">
                {t('agent.suggestions.gaps', 'Competitor gaps')}
              </button>
              <button className="chip" onClick={() => handleSendMessage(t('agent.prompts.createAd', 'Create ad campaign'))} id="btn_sug_ad">
                {t('agent.suggestions.ad', 'Create ad campaign')}
              </button>
            </div>

            {/* INPUT PANEL */}
            <div className="chat-input-panel">
              <input
                type="text"
                placeholder={t('agent.inputPlaceholder', 'Ask Markiv to do something…')}
                className="input-field chat-field"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSendMessage(); }}
                id="inp_agent_chat"
              />
              <button className="btn btn-primary btn-send" onClick={() => handleSendMessage()} disabled={isTyping} id="btn_send_agent" aria-label={t('agent.send', 'Send')}>
                <i className="fa-solid fa-arrow-up"></i>
              </button>
            </div>
          </>
        )}
      </div>

      {/* --- APPROVAL GATE MODAL OVERLAY --- */}
      {showApprovalGate && approvalDetails && (
        <div className="auth-overlay" id="approval_gate_modal">
          <div className="auth-card gate-card text-left" role="dialog" aria-modal="true" aria-labelledby="gate_title">
            <div className="gate-head">
              <span className="stamp stamp-action">{t('agent.approval.badge', 'Approval required')}</span>
              <h3 id="gate_title">{approvalDetails.action || t('agent.approval.defaultAction', 'Action')}</h3>
              <p className="small text-secondary">{t('agent.approval.subtitle', 'Markiv cannot run this without you.')}</p>
            </div>

            <dl className="gate-facts">
              {approvalDetails.cost && (
                <div>
                  <dt className="label">{t('agent.approval.costLabel', 'Cost')}</dt>
                  <dd className="text-accent">{approvalDetails.cost}</dd>
                </div>
              )}
              {approvalDetails.target && (
                <div>
                  <dt className="label">{t('agent.approval.destinationLabel', 'Destination')}</dt>
                  <dd>{approvalDetails.target}</dd>
                </div>
              )}
            </dl>

            <div className="gate-creative">
              <span className="label">{t('agent.approval.creativeLabel', 'What will be published')}</span>
              <pre>{approvalDetails.creative}</pre>
            </div>

            <div className="gate-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowApprovalGate(false)}
                disabled={approvalSuccess}
                id="btn_reject_ad"
              >
                {t('agent.approval.reject', 'Cancel')}
              </button>

              <button
                className="btn btn-primary"
                onClick={handleApproveAction}
                disabled={approvalSuccess}
                id="btn_approve_ad"
              >
                {approvalSuccess ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin"></i> {t('agent.approval.executing', 'Executing…')}
                  </>
                ) : (
                  t('agent.approval.approve', 'Approve and run')
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
