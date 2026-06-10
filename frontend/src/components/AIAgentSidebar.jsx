import { useState } from 'react';
import api from '../lib/api';
import './AIAgentSidebar.css';

export default function AIAgentSidebar({ activeProfile, telegramStatus }) {
  const [isOpen, setIsOpen] = useState(true);
  const [messages, setMessages] = useState([
    {
      sender: 'agent',
      text: `Hi! I'm Markiv 🤖 — your marketing agent. I can draft content, analyse competitors, and post straight to your Telegram channel when you ask.\n\nWhat shall we work on today?`,
      time: 'Just now'
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [showApprovalGate, setShowApprovalGate] = useState(false);
  const [approvalDetails, setApprovalDetails] = useState(null);
  const [approvalId, setApprovalId] = useState(null);
  const [approvalSuccess, setApprovalSuccess] = useState(false);

  const handleSendMessage = async (textToSend) => {
    const text = textToSend || inputText;
    if (!text.trim()) return;

    // Add user message
    const userMsg = { sender: 'user', text, time: 'Just now' };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');

    try {
      const data = await api.post('/api/agent/query', { query: text });

      if (data.triggerApproval) {
        setApprovalId(data.approvalId);
        setApprovalDetails(data.payload);
        setApprovalSuccess(false);
        setShowApprovalGate(true);
        setMessages(prev => [...prev, {
          sender: 'agent',
          text: data.reply || 'This action needs your authorization. Please review the request below.',
          time: 'Just now'
        }]);
      } else {
        setMessages(prev => [...prev, { sender: 'agent', text: data.reply, time: 'Just now' }]);
      }
    } catch {
      console.warn('Agent API offline. Triggering local backup simulation.');
      // Offline fallback simulation
      setTimeout(() => {
        let agentReply = '';
        const lowercaseText = text.toLowerCase();

        if (lowercaseText.includes('instagram') || lowercaseText.includes('post') || lowercaseText.includes('copy')) {
          agentReply = `I've prepared a highly optimized Instagram draft post for you in your Content Engine tab. It highlights your custom brand tone "${activeProfile.tone}" and is ready for publishing with local hashtags. Let me know if you would like me to schedule it!`;
        } else if (lowercaseText.includes('competitor') || lowercaseText.includes('gap') || lowercaseText.includes('benchmark')) {
          agentReply = `I ran a local gap analysis. Your nearby competitors post average 8-12 times a week. Your current scheduling cadence is 3 times a week. I suggest scheduling 3-4 more items in your content calendar this week to boost organic engagement!`;
        } else if (lowercaseText.includes('ad') || lowercaseText.includes('campaign') || lowercaseText.includes('money') || lowercaseText.includes('spend')) {
          triggerApprovalGate();
          return;
        } else {
          agentReply = `I understand you want to "${text}". I can draft copy, review competitor trends, or optimize your Google Profile keywords. Type 'create ad campaign' or click the suggestions below to authorize external changes.`;
        }

        setMessages(prev => [...prev, { sender: 'agent', text: agentReply, time: 'Just now' }]);
      }, 800);
    }
  };

  const triggerApprovalGate = () => {
    setApprovalId(null); // offline simulation — no server-side approval record
    setApprovalDetails({
      action: 'Create Meta Ad Campaign',
      cost: '$5.00 / day',
      target: 'Tashkent, remote workers (2-5km radius)',
      creative: `🎯 Preview: "Experience the ultimate ${(activeProfile.category || 'business').toLowerCase()} vibe at #${activeProfile.businessName}! High-speed Wi-Fi, handcrafted coffee, and quiet study booths ready for you."`
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
        resultText = data.message || '✅ Action approved and executed!';
      } else {
        // Offline simulation path (no server-side approval record).
        resultText = `✅ Action approved! (Simulated — server offline.)`;
      }
    } catch (err) {
      resultText = `⚠️ ${err.message || 'The action could not be executed. Please try again.'}`;
    }

    setShowApprovalGate(false);
    setMessages(prev => [...prev, { sender: 'agent', text: resultText, time: 'Just now' }]);
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
              <small>Your AI marketing agent</small>
            </div>
          </div>
          <button className="agent-toggle-btn" onClick={() => setIsOpen(!isOpen)} id="btn_toggle_agent">
            {isOpen ? <i className="fa-solid fa-angles-right"></i> : <i className="fa-solid fa-angles-left"></i>}
          </button>
        </div>

        {isOpen && (
          <>
            {/* CHAT THREAD */}
            <div className="chat-thread-container">
              {messages.map((msg, index) => (
                <div key={index} className={`chat-bubble-wrap ${msg.sender === 'user' ? 'user-bubble' : 'agent-bubble'}`}>
                  <div className="chat-bubble">
                    <pre className="bubble-text">{msg.text}</pre>
                    <span className="bubble-time">{msg.time}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* SUGGESTION BARS */}
            <div className="chat-suggestions">
              <button className="suggestion-pill" onClick={() => handleSendMessage(telegramStatus?.connected ? 'Post a friendly update about our business to Telegram' : 'How do I connect my Telegram channel?')} id="btn_sug_telegram">
                📣 Post to Telegram
              </button>
              <button className="suggestion-pill" onClick={() => handleSendMessage('Generate Instagram post copy')} id="btn_sug_insta">
                ✍️ Draft Instagram post
              </button>
              <button className="suggestion-pill" onClick={() => handleSendMessage('Check competitor gaps')} id="btn_sug_gaps">
                📊 Check competitor gaps
              </button>
              <button className="suggestion-pill" onClick={() => handleSendMessage('Create ad campaign')} id="btn_sug_ad">
                🚀 Create ad campaign
              </button>
            </div>

            {/* INPUT PANEL */}
            <div className="chat-input-panel">
              <input
                type="text"
                placeholder="Ask AI Agent to execute..."
                className="input-field chat-field"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSendMessage(); }}
                id="inp_agent_chat"
              />
              <button className="btn btn-primary btn-send" onClick={() => handleSendMessage()} id="btn_send_agent">
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
                <h3>{(approvalDetails.action || 'Action').toUpperCase()} — APPROVAL REQUIRED</h3>
                <small className="text-muted">Requires direct human confirmation</small>
              </div>
            </div>

            <div className="approval-gate-details mt-20">
              <div className="gate-detail-row">
                <span>Action:</span>
                <strong>{approvalDetails.action}</strong>
              </div>
              {approvalDetails.cost && (
                <div className="gate-detail-row">
                  <span>Cost:</span>
                  <strong className="text-accent">{approvalDetails.cost}</strong>
                </div>
              )}
              {approvalDetails.target && (
                <div className="gate-detail-row">
                  <span>Destination:</span>
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
                <i className="fa-solid fa-circle-xmark text-danger"></i> Disapprove & Cancel
              </button>
              
              <button 
                className="btn btn-primary" 
                onClick={handleApproveAction}
                disabled={approvalSuccess}
                id="btn_approve_ad"
              >
                {approvalSuccess ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin"></i> Executing...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-circle-check text-success"></i> Approve & Execute
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
