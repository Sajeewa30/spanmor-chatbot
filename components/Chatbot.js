"use client";
import React, { useCallback, useMemo, useState, useEffect, useRef } from "react";

// Render message text with clickable links.
// Supports Markdown links [text](https://...) and bare URLs.
function renderMessageWithLinks(text) {
  const safeText = String(text ?? "");
  const lines = safeText.split(/\n/);
  const mdLink = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  const bareUrl = /(https?:\/\/[^\s]+)/g;

  return lines.map((line, li) => {
    const pattern = new RegExp(`${mdLink.source}|${bareUrl.source}`, "g");
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push(line.slice(lastIndex, match.index));
      }
      let href, label;
      if (match[1] && match[2]) {
        // Markdown link
        label = match[1];
        href = match[2];
      } else {
        // Bare URL
        label = match[0];
        href = match[0];
      }
      parts.push(
        <a
          key={`msg-link-${li}-${parts.length}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--chat--color-primary)", textDecoration: "underline" }}
        >
          {label}
        </a>
      );
      lastIndex = pattern.lastIndex;
    }

    if (lastIndex < line.length) {
      parts.push(line.slice(lastIndex));
    }

    return (
      <React.Fragment key={`msg-line-${li}`}>
        {parts}
        {li < lines.length - 1 ? <br /> : null}
      </React.Fragment>
    );
  });
}

// Note: Messages are rendered via ReactMarkdown with remark-gfm
// to support links, lists, tables, code blocks, etc.

const defaultConfig = {
  webhook: { url: "", route: "" },
  branding: {
    logo: "",
    name: "",
    welcomeText: "",
    responseTimeText: "",
    poweredBy: {
      text: "Powered by Spanmor",
      link: "https://spanmor.com.au/",
    },
  },
  style: {
    primaryColor: "#854fff",
    secondaryColor: "#6b3fd4",
    position: "right",
    backgroundColor: "#ffffff",
    fontColor: "#333333",
  },
};

export default function Chatbot({ config: userConfig }) {
  const config = useMemo(() => {
    const merged = {
      webhook: { ...defaultConfig.webhook, ...(userConfig?.webhook || {}) },
      branding: { ...defaultConfig.branding, ...(userConfig?.branding || {}) },
      style: { ...defaultConfig.style, ...(userConfig?.style || {}) },
    };
    return merged;
  }, [userConfig]);

  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]); // { role: 'user'|'bot', text: string }
  const [sending, setSending] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const [mounted, setMounted] = useState(false);

  const positionLeft = config.style.position === "left";

  // Refs for outside-click handling
  const containerRef = useRef(null);
  const toggleRef = useRef(null);
  // Refs for scrolling behavior
  const messagesRef = useRef(null);
  const lastBotRef = useRef(null);

  // Close when clicking outside the chat container and toggle button
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e) => {
      const withinContainer = containerRef.current?.contains(e.target);
      const withinToggle = toggleRef.current?.contains(e.target);
      if (!withinContainer && !withinToggle) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  // Mount gate to avoid FOUC during SSR/hydration
  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto-scroll behavior: user → bottom, bot → start of reply
  useEffect(() => {
    if (!messages.length) return;
    const container = messagesRef.current;
    if (!container) return;
    const last = messages[messages.length - 1];
    if (last.role === "user") {
      // Scroll to bottom so the sent message is visible
      container.scrollTop = container.scrollHeight;
    } else {
      // Align to the top of the new bot reply
      if (lastBotRef.current) {
        lastBotRef.current.scrollIntoView({ block: "start", behavior: "smooth" });
      } else {
        // Fallback: near-bottom
        container.scrollTop = container.scrollHeight;
      }
    }
  }, [messages]);

  // Ensure typing indicator stays visible by keeping view scrolled
  useEffect(() => {
    if (!sending) return;
    const container = messagesRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [sending]);

  const addMessage = useCallback((role, text) => {
    setMessages((prev) => [...prev, { role, text }]);
  }, []);

  const startNewConversation = useCallback(async () => {
    try {
      const id = crypto.randomUUID();
      setSessionId(id);
      const payload = [
        {
          action: "loadPreviousSession",
          sessionId: id,
          route: config.webhook.route,
          metadata: { userId: "" },
        },
      ];

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let data = null;
      try {
        data = await res.json();
      } catch (_) {
        data = null;
      }

      setStarted(true);
      const botReply = Array.isArray(data) ? data?.[0]?.output : data?.output;
      addMessage(
        "bot",
        botReply || "Hi! I'm here to help you with anything related to our products."
      );
    } catch (e) {
      // Fail gracefully
      setStarted(true);
      addMessage(
        "bot",
        "Hi! I'm here to help you with anything related to our products."
      );
    }
  }, [addMessage, config.webhook.route]);

  const sendMessage = useCallback(async () => {
    const message = input.trim();
    if (!message || !sessionId || sending) return;
    addMessage("user", message);
    setInput("");
    setSending(true);

    const payload = {
      action: "sendMessage",
      sessionId,
      route: config.webhook.route,
      chatInput: message,
      metadata: { userId: "" },
    };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let data = null;
      try {
        data = await res.json();
      } catch (_) {
        data = null;
      }
      const botReply = Array.isArray(data) ? data?.[0]?.output : data?.output;
      addMessage("bot", botReply || "Hi! I'm here to help you.");
    } catch (e) {
      addMessage("bot", "Sorry, there was a problem sending your message.");
    } finally {
      setSending(false);
    }
  }, [addMessage, config.webhook.route, input, sending, sessionId]);

  // Send a pre-defined quick message using the same webhook flow
  const sendQuickMessage = useCallback(
    async (quickText) => {
      const message = String(quickText || "").trim();
      if (!message || !sessionId || sending) return;
      addMessage("user", message);
      setSending(true);

      const payload = {
        action: "sendMessage",
        sessionId,
        route: config.webhook.route,
        chatInput: message,
        metadata: { userId: "" },
      };

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        let data = null;
        try {
          data = await res.json();
        } catch (_) {
          data = null;
        }
        const botReply = Array.isArray(data) ? data?.[0]?.output : data?.output;
        addMessage("bot", botReply || "Hi! I'm here to help you.");
      } catch (e) {
        addMessage("bot", "Sorry, there was a problem sending your message.");
      } finally {
        setSending(false);
      }
    },
    [addMessage, config.webhook.route, sending, sessionId]
  );

  if (!mounted) return null;

  return (
    <div
      className="n8n-chat-widget"
      style={{
        // Expose CSS vars like the original widget
        ["--n8n-chat-primary-color"]: config.style.primaryColor,
        ["--n8n-chat-secondary-color"]: config.style.secondaryColor,
        ["--n8n-chat-background-color"]: config.style.backgroundColor,
        ["--n8n-chat-font-color"]: config.style.fontColor,
      }}
    >
        <div
          className={`chat-container${open ? " open" : ""}${positionLeft ? " position-left" : ""}`}
          ref={containerRef}
          style={{ display: open ? "flex" : "none" }}
        >
        {/* Welcome/new conversation view */}
        {!started && (
          <>
            <div className="brand-header">
              {config.branding.logo ? (
                <img src={config.branding.logo} alt={config.branding.name} />
              ) : null}
              <button
                className="close-button"
                aria-label="Close"
                onClick={() => setOpen(false)}
              />
            </div>
            <div className="new-conversation">
              <h2 className="welcome-text">{config.branding.welcomeText}</h2>
              <button className="new-chat-btn" onClick={startNewConversation}>
                <svg
                  className="message-icon"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                >
                  <path
                    fill="currentColor"
                    d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"
                  />
                </svg>
                Send us a message
              </button>
              <p className="response-text">{config.branding.responseTimeText}</p>
            </div>
          </>
        )}

        {/* Chat interface */}
        {started && (
          <div className="chat-interface active">
            <div className="brand-header">
              {config.branding.logo ? (
                <img src={config.branding.logo} alt={config.branding.name} />
              ) : null}
              <button
                className="close-button"
                aria-label="Close"
                onClick={() => setOpen(false)}
              />
            </div>
            <div className="chat-messages" ref={messagesRef}>
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`chat-message ${m.role}`}
                  ref={i === messages.length - 1 && m.role === "bot" ? lastBotRef : null}
                  style={{ whiteSpace: "pre-wrap" }}
                >
                  {renderMessageWithLinks(m.text)}
                </div>
              ))}
              {/* User typing indicator */}
              {hasFocus && !sending && input && (
                <div className="chat-message user typing-indicator">
                  <span className="typing-dots"><span className="dot" /><span className="dot" /><span className="dot" /></span>
                </div>
              )}
              {/* Bot typing indicator while awaiting response */}
              {sending && (
                <div className="chat-message bot typing-indicator" ref={lastBotRef}>
                  <span className="typing-dots"><span className="dot" /><span className="dot" /><span className="dot" /></span>
                </div>
              )}
          </div>
          <div className="chat-input">
            <textarea
              placeholder="Type your message here..."
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setHasFocus(true)}
              onBlur={() => setHasFocus(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
            />
            <button type="button" onClick={sendMessage} disabled={sending}>
              {sending ? "Sending..." : "Send"}
            </button>
          </div>
          {/* Initial quick-start options */}
          {messages.filter((m) => m.role === "user").length === 0 && (
            <div className="quick-replies">
              <button
                type="button"
                className="quick-reply"
                disabled={sending}
                onClick={() => sendQuickMessage("I need to start a quote with my deck size")}
                aria-label="I need to start a quote with my deck size"
              >
                I need to start a quote with my deck size
              </button>
              <button
                type="button"
                className="quick-reply"
                disabled={sending}
                onClick={() => sendQuickMessage("I Want to know about Spanmor.")}
                aria-label="I Want to know about Spanmor."
              >
                I Want to know about Spanmor.
              </button>
            </div>
          )}
          <div className="chat-footer">
            <a href={config.branding.poweredBy.link} target="_blank">
              {config.branding.poweredBy.text}
            </a>
          </div>
          </div>
        )}
      </div>

      {/* Floating toggle */}
      <button
        className={`chat-toggle${positionLeft ? " position-left" : ""}`}
        ref={toggleRef}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Open chat"
        style={{
          position: "fixed",
          bottom: 20,
          right: positionLeft ? "auto" : 20,
          left: positionLeft ? 20 : "auto",
          width: 60,
          height: 60,
          borderRadius: 30,
          zIndex: 999,
          background: `linear-gradient(135deg, ${config.style.primaryColor} 0%, ${config.style.secondaryColor} 100%)`,
          color: "white",
          border: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
          <path d="M12 2C6.477 2 2 6.477 2 12c0 1.821.487 3.53 1.338 5L2.5 21.5l4.5-.838A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18c-1.476 0-2.886-.313-4.156-.878l-3.156.586.586-3.156A7.962 7.962 0 014 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z" />
        </svg>
      </button>

      {/* Styles ported from the original widget */}
      <style jsx global>{`
        .n8n-chat-widget {
          --chat--color-primary: var(--n8n-chat-primary-color, #854fff);
          --chat--color-secondary: var(--n8n-chat-secondary-color, #6b3fd4);
          --chat--color-background: var(--n8n-chat-background-color, #ffffff);
          --chat--color-font: var(--n8n-chat-font-color, #333333);
          font-family: var(--font-geist-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif);
        }

        .n8n-chat-widget .chat-container {
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 1000;
          display: none;
          width: 380px;
          height: 600px;
          background: var(--chat--color-background);
          border-radius: 12px;
          box-shadow: 0 8px 32px rgba(133, 79, 255, 0.15);
          border: 1px solid rgba(133, 79, 255, 0.2);
          overflow: hidden;
          font-family: inherit;
        }

        .n8n-chat-widget .chat-container.position-left {
          right: auto;
          left: 20px;
        }

        .n8n-chat-widget .chat-container.open {
          display: flex;
          flex-direction: column;
        }

        .n8n-chat-widget .brand-header {
          padding: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          border-bottom: 1px solid rgba(133, 79, 255, 0.1);
          position: relative;
        }

        .n8n-chat-widget .close-button {
          position: absolute;
          right: 16px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          color: var(--chat--color-font);
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color 0.2s;
          font-size: 20px;
          opacity: 0.6;
        }

        .n8n-chat-widget .close-button:hover {
          opacity: 1;
        }

        .n8n-chat-widget .brand-header img {
          height: 48px;
          width: auto;
        }

        

        .n8n-chat-widget .new-conversation {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          padding: 20px;
          text-align: center;
          width: 100%;
          max-width: 300px;
        }

        .n8n-chat-widget .welcome-text {
          font-size: 24px;
          font-weight: 600;
          color: var(--chat--color-font);
          margin-bottom: 24px;
          line-height: 1.3;
        }

        .n8n-chat-widget .new-chat-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: 100%;
          padding: 16px 24px;
          background: linear-gradient(135deg, var(--chat--color-primary) 0%, var(--chat--color-secondary) 100%);
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: transform 0.3s;
          font-weight: 500;
          font-family: inherit;
          margin-bottom: 12px;
        }

        .n8n-chat-widget .new-chat-btn:hover { transform: scale(1.02); }

        .n8n-chat-widget .message-icon { width: 20px; height: 20px; }

        .n8n-chat-widget .response-text {
          font-size: 14px;
          color: var(--chat--color-font);
          opacity: 0.7;
          margin: 0;
        }

        .n8n-chat-widget .chat-interface { display: none; flex-direction: column; height: 100%; }
        .n8n-chat-widget .chat-interface.active { display: flex; }

        .n8n-chat-widget .chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
          background: var(--chat--color-background);
          display: flex;
          flex-direction: column;
          max-height: 100%;
        }

        .n8n-chat-widget .chat-message {
          padding: 12px 16px;
          margin: 8px 0;
          border-radius: 12px;
          max-width: 80%;
          word-wrap: break-word;
          font-size: 14px;
          line-height: 1.5;
        }

        .n8n-chat-widget .chat-message.user {
          background: linear-gradient(135deg, var(--chat--color-primary) 0%, var(--chat--color-secondary) 100%);
          color: white;
          align-self: flex-end;
          box-shadow: 0 4px 12px rgba(133, 79, 255, 0.2);
          border: none;
        }

        .n8n-chat-widget .chat-message.bot {
          background: var(--chat--color-background);
          border: 1px solid rgba(133, 79, 255, 0.2);
          color: var(--chat--color-font);
          align-self: flex-start;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
        }

        /* Typing indicator */
        .n8n-chat-widget .chat-message.typing-indicator {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 24px;
        }
        .n8n-chat-widget .typing-dots {
          display: inline-flex;
          gap: 6px;
          align-items: center;
        }
        .n8n-chat-widget .typing-dots .dot {
          width: 6px;
          height: 6px;
          background: currentColor;
          border-radius: 50%;
          opacity: 0.3;
          animation: chat-typing-blink 1.4s infinite both;
        }
        .n8n-chat-widget .typing-dots .dot:nth-child(2) { animation-delay: 0.2s; }
        .n8n-chat-widget .typing-dots .dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes chat-typing-blink {
          0%, 80%, 100% { opacity: 0.2; }
          40% { opacity: 1; }
        }

        .n8n-chat-widget .chat-input {
          padding: 16px;
          background: var(--chat--color-background);
          border-top: 1px solid rgba(133, 79, 255, 0.1);
          display: flex;
          gap: 8px;
        }

        .n8n-chat-widget .chat-input textarea {
          flex: 1;
          padding: 12px;
          border: 1px solid rgba(133, 79, 255, 0.2);
          border-radius: 8px;
          background: var(--chat--color-background);
          color: var(--chat--color-font);
          resize: none;
          font-family: inherit;
          font-size: 14px;
        }

        .n8n-chat-widget .chat-input textarea::placeholder {
          color: var(--chat--color-font);
          opacity: 0.6;
        }

        .n8n-chat-widget .chat-input button {
          background: linear-gradient(135deg, var(--chat--color-primary) 0%, var(--chat--color-secondary) 100%);
          color: white;
          border: none;
          border-radius: 8px;
          padding: 0 20px;
          cursor: pointer;
          transition: transform 0.2s;
          font-family: inherit;
          font-weight: 500;
        }

        .n8n-chat-widget .chat-input button:hover { transform: scale(1.05); }

        /* Quick-reply buttons */
        .n8n-chat-widget .quick-replies {
          padding: 0 16px 12px 16px;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          background: var(--chat--color-background);
        }

        .n8n-chat-widget .quick-reply {
          border: 1px solid rgba(133, 79, 255, 0.25);
          color: var(--chat--color-font);
          background: rgba(133, 79, 255, 0.06);
          padding: 8px 12px;
          border-radius: 999px;
          cursor: pointer;
          font-size: 13px;
          line-height: 1;
          transition: background 0.2s, transform 0.2s, border-color 0.2s;
          font-family: inherit;
        }

        .n8n-chat-widget .quick-reply:hover {
          background: rgba(133, 79, 255, 0.12);
          transform: translateY(-1px);
          border-color: rgba(133, 79, 255, 0.35);
        }

        .n8n-chat-widget .quick-reply:disabled {
          opacity: 0.6;
          pointer-events: none;
        }

        .n8n-chat-widget .chat-toggle {
          position: fixed;
          bottom: 20px;
          right: 20px;
          width: 60px;
          height: 60px;
          border-radius: 30px;
          background: linear-gradient(135deg, var(--chat--color-primary) 0%, var(--chat--color-secondary) 100%);
          color: white;
          border: none;
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(133, 79, 255, 0.3);
          z-index: 999;
          transition: transform 0.3s;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .n8n-chat-widget .chat-toggle.position-left { right: auto; left: 20px; }
        .n8n-chat-widget .chat-toggle:hover { transform: scale(1.05); }
        .n8n-chat-widget .chat-toggle svg { width: 24px; height: 24px; fill: currentColor; }

        .n8n-chat-widget .chat-footer {
          padding: 8px;
          text-align: center;
          background: var(--chat--color-background);
          border-top: 1px solid rgba(133, 79, 255, 0.1);
        }

        .n8n-chat-widget .chat-footer a {
          color: var(--chat--color-primary);
          text-decoration: none;
          font-size: 12px;
          opacity: 0.8;
          transition: opacity 0.2s;
          font-family: inherit;
        }

        .n8n-chat-widget .chat-footer a:hover { opacity: 1; }
      `}</style>
    </div>
  );
}
