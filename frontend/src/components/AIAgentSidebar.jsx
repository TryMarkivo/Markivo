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

export default function AIAgentSidebar({ activeProfile, telegramStatus }) {
  const { t, i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(true);
  const greetingMessage = () => ({
    sender: 'agent',
    text: t('agent.greeting', { defaultValue: "Hi! I'm Markiv 🤖 — your marketing agent. I can draft content, analyse competitors, and post straight to your Telegram channel when you ask.\n\nWhat shall we work on today?" }),
    time: t('agent.justNow', 'Just now')
  });
  const [messages, setMessages] = useState(() => [greetingMessage()]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showApprovalGate, setShowApprovalGate] = useState(false);
  const [approvalDetails, setApprovalDetails] = useState(null);
  const [approvalId, setApprovalId] = useState(null);
  const [approvalSuccess, setApprovalSuccess] = useState(false);
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
      console.warn('Agent API offline. Triggering local backup simulation.');
      // Offline fallback simulation
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
        defaultValue: '🎯 Preview: "Experience the ultimate {{category}} vibe at #{{businessName}}! High-speed Wi-Fi, handcrafted coffee, and quiet study booths ready for you."',
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
        resultText = data.message || t('agent.approval.executed', '✅ Action approved and executed!');
      } else {
        // Offline simulation path (no server-side approval record).
        resultText = t('agent.approval.simulated', '✅ Action approved! (Simulated — server offline.)');
      }
    } catch (err) {
      resultText = `⚠️ ${err.message || t('agent.approval.error', 'The action could not be executed. Please try again.')}`;
    }

    setShowApprovalGate(false);
    setMessages(prev => [...prev, { sender: 'agent', text: resultText, time: t('agent.justNow', 'Just now') }]);
  };

  return (
    <>
      <div className={`agent-sidebar-container glass-card ${isOpen ? 'open' : 'closed'}`} id="agent_sidebar_container">
        {/* HEADER */}
        <div className="agent-header flex-between">
          <div className="agent-title-wrap">
            <span className="agent-avatar-icon">🤖</span>
            <div>
              <h4>Markiv</h4>
              <small>{t('agent.subtitle', 'Your AI marketing agent')}</small>
            </div>
          </div>
          <div className="agent-header-actions">
            {isOpen && (
              <button
                className="agent-clear-btn"
                onClick={handleClearChat}
                id="btn_clear_chat"
                title={t('agent.clearChat', 'Clear conversation')}
                aria-label={t('agent.clearChat', 'Clear conversation')}
              >
                <i className="fa-solid fa-trash-can"></i>
              </button>
            )}
            <button className="agent-toggle-btn" onClick={() => setIsOpen(!isOpen)} id="btn_toggle_agent">
              {isOpen ? <i className="fa-solid fa-angles-right"></i> : <i className="fa-solid fa-angles-left"></i>}
            </button>
          </div>
        </div>

        {isOpen && (
          <>
            {/* CHAT THREAD */}
            <div className="chat-thread-container" ref={threadRef}>
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
                className="suggestion-pill"
                onClick={() => handleSendMessage(
                  telegramStatus?.comingSoon
                    ? t('agent.prompts.draftAnnouncement', 'Draft a short announcement post for our business')
                    : telegramStatus?.connected
                      ? t('agent.prompts.postTelegram', 'Post a friendly update about our business to Telegram')
                      : t('agent.prompts.connectTelegram', 'How do I connect my Telegram channel?')
                )}
                id="btn_sug_telegram"
              >
                {telegramStatus?.comingSoon ? t('agent.suggestions.draftAnnouncement', '📣 Draft announcement') : t('agent.suggestions.postTelegram', '📣 Post to Telegram')}
              </button>
              <button className="suggestion-pill" onClick={() => handleSendMessage(t('agent.prompts.instagramCopy', 'Generate Instagram post copy'))} id="btn_sug_insta">
                {t('agent.suggestions.instagram', '✍️ Draft Instagram post')}
              </button>
              <button className="suggestion-pill" onClick={() => handleSendMessage(t('agent.prompts.competitorGaps', 'Check competitor gaps'))} id="btn_sug_gaps">
                {t('agent.suggestions.gaps', '📊 Check competitor gaps')}
              </button>
              <button className="suggestion-pill" onClick={() => handleSendMessage(t('agent.prompts.createAd', 'Create ad campaign'))} id="btn_sug_ad">
                {t('agent.suggestions.ad', '🚀 Create ad campaign')}
              </button>
            </div>

            {/* INPUT PANEL */}
            <div className="chat-input-panel">
              <input
                type="text"
                placeholder={t('agent.inputPlaceholder', 'Ask AI Agent to execute...')}
                className="input-field chat-field"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSendMessage(); }}
                id="inp_agent_chat"
              />
              <button className="btn btn-primary btn-send" onClick={() => handleSendMessage()} disabled={isTyping} id="btn_send_agent">
                <i className="fa-solid fa-paper-plane"></i>
              </button>
            </div>
          </>
        )}
      </div>

      {/* --- APPROVAL GATE MODAL OVERLAY --- */}
      {showApprovalGate && approvalDetails && (
        <div className="approval-gate-overlay animate-fade-in" id="approval_gate_modal">
          <div className="approval-gate-card glass-card glass-card-glow text-left">
            <div className="approval-gate-header">
              <i className="fa-solid fa-shield-halved text-accent shield-icon"></i>
              <div>
                <h3>{t('agent.approval.titleSuffix', { defaultValue: '{{action}} — APPROVAL REQUIRED', action: approvalDetails.action || t('agent.approval.defaultAction', 'Action') })}</h3>
                <small className="text-muted">{t('agent.approval.subtitle', 'Requires direct human confirmation')}</small>
              </div>
            </div>

            <div className="approval-gate-details mt-20">
              <div className="gate-detail-row">
                <span>{t('agent.approval.actionLabel', 'Action:')}</span>
                <strong>{approvalDetails.action}</strong>
              </div>
              {approvalDetails.cost && (
                <div className="gate-detail-row">
                  <span>{t('agent.approval.costLabel', 'Cost:')}</span>
                  <strong className="text-accent">{approvalDetails.cost}</strong>
                </div>
              )}
              {approvalDetails.target && (
                <div className="gate-detail-row">
                  <span>{t('agent.approval.destinationLabel', 'Destination:')}</span>
                  <strong>{approvalDetails.target}</strong>
                </div>
              )}
              <div className="gate-creative-box mt-10">
                <pre>{approvalDetails.creative}</pre>
              </div>
            </div>

            <div className="approval-gate-actions flex-between mt-30">
              <button
                className="btn btn-secondary"
                onClick={() => setShowApprovalGate(false)}
                disabled={approvalSuccess}
                id="btn_reject_ad"
              >
                <i className="fa-solid fa-circle-xmark text-danger"></i> {t('agent.approval.reject', 'Disapprove & Cancel')}
              </button>

              <button
                className="btn btn-primary"
                onClick={handleApproveAction}
                disabled={approvalSuccess}
                id="btn_approve_ad"
              >
                {approvalSuccess ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin"></i> {t('agent.approval.executing', 'Executing...')}
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-circle-check text-success"></i> {t('agent.approval.approve', 'Approve & Execute')}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
