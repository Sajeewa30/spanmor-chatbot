"use client";
import React, { useCallback, useMemo, useState, useEffect, useRef } from "react";

// Render message text with clickable links.
// Supports Markdown links [text](https://...) and bare URLs.
function renderMessageWithLinks(text, opts = {}) {
  const isTyping = !!opts.isTyping;
  const safeText = String(text ?? "");
  const lines = safeText.split(/\n/);
  const mdLink = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  const bareUrl = /(https?:\/\/[^\s]+)/g;

  return lines.map((line, li) => {
    // While typing, hide partially-typed markdown link URLs like: [label](https://...<incomplete>)
    // Replace them with just the label so users never see the long URL during typing.
    let displayLine = line;
    if (isTyping) {
      const partialMd = /\[([^\]]+)\]\([^)]*$/; // incomplete markdown link until end of line
      // Replace repeatedly in case of multiple occurrences on the same line
      while (partialMd.test(displayLine)) {
        displayLine = displayLine.replace(partialMd, "$1");
      }
    }

    const pattern = new RegExp(`${mdLink.source}|${bareUrl.source}`, "g");
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(displayLine)) !== null) {
      if (match.index > lastIndex) {
        parts.push(displayLine.slice(lastIndex, match.index));
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
      // Do not render inline links; show only plain label for markdown, and hide bare URLs
      if (match[1] && match[2]) {
        // Markdown link: render label only (no anchor)
        parts.push(
          <React.Fragment key={`msg-link-${li}-${parts.length}`}>
            {label}
          </React.Fragment>
        );
      } else {
        // Bare URL: hide from inline text
        // no-op: do not push anything so raw URL is not visible
      }
      lastIndex = pattern.lastIndex;
    }

    if (lastIndex < displayLine.length) {
      parts.push(displayLine.slice(lastIndex));
    }

    return (
      <React.Fragment key={`msg-line-${li}`}>
        {parts}
        {li < lines.length - 1 ? <br /> : null}
      </React.Fragment>
    );
  });
}

// While typing, show a stable, plain-text view:
// - Convert complete Markdown links [label](url) to just `label`
// - Hide bare URLs entirely so they don't pop in/out
// - Also collapse partially-typed Markdown links to the label
function sanitizeTypingDisplay(text) {
  const safe = String(text ?? "");
  const mdComplete = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  const bareUrl = /(https?:\/\/[^\s]+)/g;
  const mdPartial = /\[([^\]]+)\]\([^)]*$/; // until end of line

  const lines = safe.split(/\n/);
  const out = lines.map((line) => {
    let s = line;
    // Replace complete markdown links with their label
    s = s.replace(mdComplete, "$1");
    // Hide bare URLs from the typing display
    s = s.replace(bareUrl, "");
    // Repeatedly collapse partially-typed markdown to the label
    let guard = 0;
    while (mdPartial.test(s) && guard++ < 10) {
      s = s.replace(mdPartial, "$1");
    }
    return s;
  });
  return out.join("\n");
}

// Note: Messages are rendered via ReactMarkdown with remark-gfm
// to support links, lists, tables, code blocks, etc.

const defaultConfig = {
  webhook: { url: "", route: "" },
  typingSpeedMs: 20,
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
  // Light input normalization: collapse spaces, trim, drop trailing punctuation
  const normalizeInput = useCallback((text) => {
    const raw = String(text ?? "");
    const collapsed = raw.replace(/\s+/g, " ").trim();
    // Remove simple trailing punctuation like ., !, ?, …
    return collapsed.replace(/[.!?…]+$/g, "");
  }, []);
  const config = useMemo(() => {
    const merged = {
      webhook: { ...defaultConfig.webhook, ...(userConfig?.webhook || {}) },
      branding: { ...defaultConfig.branding, ...(userConfig?.branding || {}) },
      style: { ...defaultConfig.style, ...(userConfig?.style || {}) },
      typingSpeedMs: Number(
        userConfig?.typingSpeedMs ?? defaultConfig.typingSpeedMs
      ),
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
  const [isMobile, setIsMobile] = useState(false);
  // CTAs persist per message; no global active gating
  // Typing speed for bot replies (milliseconds per character)
  // Adjust via `config.typingSpeedMs` when using the component.
  const typingSpeedMs = Math.max(1, Number(config?.typingSpeedMs ?? 20));

  const positionLeft = config.style.position === "left";

  // Refs for outside-click handling
  const containerRef = useRef(null);
  const toggleRef = useRef(null);
  // Refs for scrolling behavior
  const messagesRef = useRef(null);
  const lastBotRef = useRef(null);
  const scrollRafRef = useRef(null);
  // Interval reference for the typewriter effect
  const typingTimerRef = useRef(null);
  // Track which bot message is currently being typed (by id)
  const typingMessageIdRef = useRef(null);
  // Full text of the message currently being typed (for graceful finalization)
  const typingFullTextRef = useRef("");

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

  // Track mobile layout for inline overrides
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 640px)");
    const update = () => setIsMobile(mq.matches);
    update();
    if (mq.addEventListener) mq.addEventListener("change", update);
    else mq.addListener(update);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", update);
      else mq.removeListener(update);
    };
  }, []);

  // Clear any running typing interval on unmount
  useEffect(() => {
    return () => {
      if (typingTimerRef.current) {
        clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;
      }
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, []);

  const scheduleScrollToBottom = useCallback(() => {
    const container = messagesRef.current;
    if (!container) return;
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      container.scrollTop = container.scrollHeight;
    });
  }, []);

  // Auto-scroll behavior: user → bottom, bot → start of reply
  useEffect(() => {
    if (!messages.length) return;
    const container = messagesRef.current;
    if (!container) return;
    const last = messages[messages.length - 1];
    if (last.role === "user") {
      // Scroll to bottom so the sent message is visible
      scheduleScrollToBottom();
    } else {
      // Align to the top of the new bot reply
      if (lastBotRef.current) {
        lastBotRef.current.scrollIntoView({ block: "start", behavior: "auto" });
      } else {
        // Fallback: near-bottom
        scheduleScrollToBottom();
      }
    }
  }, [messages, scheduleScrollToBottom]);

  // Ensure typing indicator stays visible by keeping view scrolled
  useEffect(() => {
    if (!sending) return;
    scheduleScrollToBottom();
  }, [sending, scheduleScrollToBottom]);

  const addMessage = useCallback((role, text) => {
    const id = crypto.randomUUID();
    setMessages((prev) => [...prev, { id, role, text }]);
  }, []);

  // Typewriter effect for bot messages: streams characters over time
  // Extract links from full text (markdown and bare URLs)
  const extractLinks = useCallback((fullText) => {
    const s = String(fullText || "");

    const stripTrailingPunct = (u) => (u || "").trim().replace(/[\)\]\}\>\.,!?:;]+$/g, "");

    const normalizeKey = (rawUrl) => {
      try {
        const cleaned = stripTrailingPunct(rawUrl);
        const u = new URL(cleaned);
        const host = (u.hostname || "").toLowerCase().replace(/^www\./, "");
        // Remove tracking params and order query params for stable keys
        const sp = new URLSearchParams(u.search);
        const kept = new URLSearchParams();
        for (const [k, v] of sp.entries()) {
          if (!/^utm_/i.test(k) && k.toLowerCase() !== "fbclid") kept.append(k, v);
        }
        const query = kept.toString();
        // Normalize path: remove trailing slash (except root)
        let path = u.pathname || "/";
        if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
        return { key: `${host}${path}${query ? `?${query}` : ""}`, host };
      } catch {
        return { key: null, host: null };
      }
    };

    const mdLinksRaw = [];
    const bareLinksRaw = [];

    // Markdown links (preferred)
    const md = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    let m;
    while ((m = md.exec(s)) !== null) {
      mdLinksRaw.push({ url: m[2], label: (m[1] || "").trim() });
    }

    // Bare URLs (used only if no markdown links exist)
    const bare = /(https?:\/\/[^\s]+)/g;
    while ((m = bare.exec(s)) !== null) {
      bareLinksRaw.push({ url: m[0], label: m[0] });
    }

    // Choose source: prefer markdown links, but also include important bare URLs
    const raw = [];
    if (mdLinksRaw.length) {
      // Start with explicit markdown links
      raw.push(...mdLinksRaw);
      // Also include bare URLs from allowed domains that are likely task links
      // Heuristics: has query string OR path depth > 1
      for (const it of bareLinksRaw) {
        try {
          const u = new URL(stripTrailingPunct(it.url));
          const host = (u.hostname || "").toLowerCase();
          const allowedHost = host === "spanmor.com.au" || host.endsWith(".spanmor.com.au");
          const pathDepth = (u.pathname || "/").split("/").filter(Boolean).length;
          if (allowedHost && (u.search || pathDepth > 1)) {
            raw.push(it);
          }
        } catch { /* ignore */ }
      }
    } else {
      raw.push(...bareLinksRaw);
    }

    // Whitelist domain (spanmor.com.au and subdomains) and de-duplicate canonically
    const results = [];
    const seen = new Set();
    for (const it of raw) {
      const cleanedUrl = stripTrailingPunct(it.url);
      const { key, host } = normalizeKey(cleanedUrl);
      if (!key || !host) continue;
      const allowedHost = host === "spanmor.com.au" || host.endsWith(".spanmor.com.au");
      if (!allowedHost) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ url: cleanedUrl, label: it.label });
    }

    return results;
  }, []);

  const typeOutBotMessage = useCallback(
    (fullText) => {
      const text = String(fullText ?? "").trim();

      // If a previous typing timer is active, clear it before starting a new one
      if (typingTimerRef.current) {
        // Finalize the currently typing message before starting a new one
        const prevId = typingMessageIdRef.current;
        const prevFull = typingFullTextRef.current || "";
        if (prevId) {
          setMessages((prev) => {
            const updated = [...prev];
            const idx = updated.findIndex((m) => m.id === prevId);
            if (idx !== -1) {
              updated[idx] = { ...updated[idx], text: prevFull };
            }
            return updated;
          });
        }
        clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;
      }
      // Reset any previous typing target
      typingMessageIdRef.current = null;
      typingFullTextRef.current = "";

      // Skip creating an empty bot bubble if there's no content
      const len = text.length;
      if (len === 0) {
        return;
      }

      // Create a dedicated bot message with a stable id to update
      const id = crypto.randomUUID();
      typingMessageIdRef.current = id;
      typingFullTextRef.current = text;
      // Create the target bot message we will progressively update
      // Extract links once so we can show CTAs and clickable anchors immediately
      const links = extractLinks(text);
      setMessages((prev) => [...prev, { id, role: "bot", text: "", links }]);

      let i = 0;

      typingTimerRef.current = setInterval(() => {
        i += 1;
        // Use the stable id captured in closure to avoid racing with ref clearing
        const targetId = id;
        setMessages((prev) => {
          if (!prev.length) return prev;
          const updated = [...prev];
          const idx = updated.findIndex((m) => m.id === targetId);
          if (idx === -1) return prev;
          updated[idx] = { ...updated[idx], text: text.slice(0, i) };
          return updated;
        });

        // Keep the latest content visible as it grows
        scheduleScrollToBottom();

        if (i >= len) {
          clearInterval(typingTimerRef.current);
          typingTimerRef.current = null;
          typingMessageIdRef.current = null;
          // Bot message finished typing; CTAs render based on message state
        }
      }, typingSpeedMs);
    },
    [typingSpeedMs, extractLinks, scheduleScrollToBottom]
  );

  const startNewConversation = useCallback(() => {
    // Open UI and immediately show the fixed local welcome message
    const id = crypto.randomUUID();
    setSessionId(id);
    setStarted(true);
    setSending(false);
    typeOutBotMessage(
      `Hi there! Welcome to Spanmor. I'm here to help you plan your deck and get a quick, accurate quote.
Our Deck Calculator allows you to design, price, and customise your deck in under 5 minutes. You can see a visual layout preview, get real-time pricing, and download a PDF of your design and quote.

Shall we get started?`
    );
  }, [typeOutBotMessage]);

  const sendMessage = useCallback(async () => {
    const display = String(input ?? "").trim();
    const message = normalizeInput(input);
    if (!message || !sessionId || sending) return;
    // Show what the user typed (with punctuation) in UI
    addMessage("user", display);
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
      // Hide the loading indicator and start typing the reply
      setSending(false);
      typeOutBotMessage(botReply || "Hi! I'm here to help you.");
    } catch (e) {
      setSending(false);
      addMessage("bot", "Sorry, there was a problem sending your message.");
    } finally {
      // no-op: sending already handled above
    }
  }, [addMessage, config.webhook.route, input, sending, sessionId, typeOutBotMessage]);

  // Send a pre-defined quick message using the same webhook flow
  const sendQuickMessage = useCallback(
    async (quickText, sendText) => {
      const display = String(quickText || "").trim();
      const message = normalizeInput(sendText ?? quickText);
      if (!message || !sessionId || sending) return;
      // Show the display text in UI
      addMessage("user", display);
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
        setSending(false);
        typeOutBotMessage(botReply || "Hi! I'm here to help you.");
      } catch (e) {
        setSending(false);
        addMessage("bot", "Sorry, there was a problem sending your message.");
      } finally {
        // no-op: sending already handled above
      }
    },
    [addMessage, config.webhook.route, normalizeInput, sending, sessionId, typeOutBotMessage]
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
        style={{
          display: open ? "flex" : "none",
          ...(isMobile
            ? {
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                width: "100%",
                height: "100%",
                maxWidth: "100vw",
                maxHeight: "100dvh",
                borderRadius: 0,
                boxShadow: "none",
                overflowY: "auto",
              }
            : null),
        }}
      >
        <div className="chat-shell">
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
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <div
              className="new-conversation"
              style={isMobile ? { padding: "6px 8px", borderRadius: 10 } : undefined}
            >
              <h2
                className="welcome-text"
                style={isMobile ? { fontSize: 13, marginBottom: 2 } : undefined}
              >
                {config.branding.welcomeText}
              </h2>
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
              <p
                className="response-text"
                style={isMobile ? { fontSize: 11 } : undefined}
              >
                {config.branding.responseTimeText}
              </p>
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
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <div className="chat-messages" ref={messagesRef}>
              {messages.map((m, i) => {
                const isTypingMsg = Boolean(typingTimerRef.current) && m.id === typingMessageIdRef.current;
                const isLastBot = i === messages.length - 1 && m.role === "bot";

                // Build CTA(s) attached to this message (after typing completes)
                let cta = null;
                if (
                  m.role === "bot" &&
                  Array.isArray(m.links) &&
                  m.links.length > 0 &&
                  !isTypingMsg
                ) {
                  const createLabel = (lnk) => {
                    const cleanText = (t) => t
                      .replace(/[\)\]\}\>\.,!?:;]+$/g, "") // strip trailing punctuation
                      .replace(/^\s*(the|a|an)\s+/i, "") // drop leading articles
                      .replace(/\b(page|webpage|site)\b/gi, "") // drop generic words
                      .replace(/\s{2,}/g, " ")
                      .trim();

                    const raw = cleanText(String(lnk.label || ""));
                    const looksLikeUrlish = /https?:|:\/\//i.test(raw) || /\//.test(raw) || /\.[a-z]{2,}$/i.test(raw);
                    if (raw && raw !== lnk.url && !looksLikeUrlish) {
                      const title = raw.replace(/\b\w/g, (c) => c.toUpperCase());
                      return `Open ${title}`;
                    }
                    try {
                      const u = new URL(lnk.url);
                      const host = (u.hostname || "").replace(/^www\./, "");
                      const path = (u.pathname || "/");
                      const segs = path.split("/").filter(Boolean);
                      if (segs.length === 0) {
                        // homepage: use site name from host
                        const site = host.split(".")[0] || host;
                        const title = site.charAt(0).toUpperCase() + site.slice(1);
                        return `Open ${title}`;
                      }
                      const last = cleanText(decodeURIComponent(segs[segs.length - 1])
                        .replace(/[\-_]+/g, " ")
                        .replace(/\s+/g, " "));
                      const title = last.replace(/\b\w/g, (c) => c.toUpperCase());
                      return `Open ${title}`;
                    } catch (_) {
                      return "Open Link";
                    }
                  };

                  cta = (
                    <div className="message-actions">
                      {m.links.map((lnk, idx) => (
                        <button
                          key={`cta-${m.id || i}-${idx}`}
                          type="button"
                          className="link-action"
                          onClick={() => window.open(lnk.url, "_blank", "noopener,noreferrer")}
                          aria-label={createLabel(lnk)}
                          title={lnk.url}
                        >
                          {createLabel(lnk)}
                        </button>
                      ))}
                    </div>
                  );
                }

                return (
                  <React.Fragment key={m.id || i}>
                    <div
                      className={`chat-message ${m.role}`}
                      ref={isLastBot ? lastBotRef : null}
                      style={{ whiteSpace: "pre-wrap" }}
                    >
                      {/* While typing: stable, sanitized plain text (no links visible) */}
                      {isTypingMsg
                        ? sanitizeTypingDisplay(m.text)
                        : renderMessageWithLinks(m.text, { isTyping: false })}
                    </div>
                    {cta}
                  </React.Fragment>
                );
              })}
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
          {/* Quick-start options (always available) */}
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
              onClick={() => sendQuickMessage("I Want to know about Spanmor")}
              aria-label="I Want to know about Spanmor"
            >
              I Want to know about Spanmor
            </button>
            <button
              type="button"
              className="quick-reply"
              disabled={sending}
              onClick={() => sendQuickMessage("I need engineering expert assistance")}
              aria-label="I need engineering expert review - Send an Email"
            >
              I need engineering expert review - Send an Email
            </button>
          </div>
          <div className="chat-footer">
            <a href={config.branding.poweredBy.link} target="_blank">
              {config.branding.poweredBy.text}
            </a>
          </div>
          </div>
        )}
        </div>
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
          bottom: isMobile ? 16 : 20,
          right: positionLeft ? "auto" : isMobile ? 16 : 20,
          left: positionLeft ? (isMobile ? 16 : 20) : "auto",
          width: isMobile ? 56 : 60,
          height: isMobile ? 56 : 60,
          borderRadius: isMobile ? 20 : 30,
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
      <style jsx>{`
        .n8n-chat-widget {
          --chat--color-primary: var(--n8n-chat-primary-color, #854fff);
          --chat--color-secondary: var(--n8n-chat-secondary-color, #6b3fd4);
          /* User message bubble color (more subtle, soft black). You can override via --n8n-chat-user-color on the container if needed. */
          --chat--color-user: var(--n8n-chat-user-color, #1A1A1A);
          --chat--color-background: var(--n8n-chat-background-color, #ffffff);
          --chat--color-font: var(--n8n-chat-font-color, #333333);
          font-family: var(--font-geist-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif);
        }

        .n8n-chat-widget .chat-container {
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 1000;
          display: none;
          width: 420px;
          height: 640px;
          background: var(--chat--color-background);
          border-radius: 28px;
          box-shadow: 0 8px 32px rgba(133, 79, 255, 0.15);
          border: 1px solid rgba(133, 79, 255, 0.2);
          overflow-y: auto;
          overflow-x: hidden;
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

        .n8n-chat-widget .chat-shell {
          display: flex;
          flex-direction: column;
          min-height: 100%;
          height: 100%;
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
          padding: 20px;
          text-align: center;
          width: 100%;
          max-width: 300px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          flex: 1;
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
          background: var(--chat--color-user);
          color: #ffffff;
          align-self: flex-end;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
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

        /* Message CTA buttons for links */
        .n8n-chat-widget .message-actions {
          padding: 0 16px 12px 16px;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .n8n-chat-widget .link-action {
          background: linear-gradient(135deg, var(--chat--color-primary) 0%, var(--chat--color-secondary) 100%);
          color: #fff;
          border: none;
          border-radius: 6px;
          padding: 8px 12px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          font-family: inherit;
        }

        .n8n-chat-widget .link-action:hover {
          filter: brightness(1.05);
        }

        @media (max-width: 640px) {
          .n8n-chat-widget .chat-container {
            inset: 0;
            margin: 0;
            width: 100%;
            max-width: 100vw;
            height: 100%;
            max-height: 100dvh;
            border-radius: 0;
            box-shadow: none;
            transform: none;
            overflow-y: auto;
          }

          .n8n-chat-widget .chat-shell {
            min-height: 100%;
            padding: calc(16px + env(safe-area-inset-top))
              calc(16px + env(safe-area-inset-right))
              calc(16px + env(safe-area-inset-bottom))
              calc(16px + env(safe-area-inset-left));
            gap: 12px;
          }

          .n8n-chat-widget .welcome-text {
            font-size: 13px;
            margin-bottom: 2px;
          }

          .n8n-chat-widget .response-text {
            font-size: 11px;
          }

          .n8n-chat-widget .chat-toggle {
            width: 56px;
            height: 56px;
            border-radius: 20px;
            bottom: 16px;
            right: 16px;
          }

        }

        @media (min-width: 641px) and (max-height: 700px) {
          .n8n-chat-widget .chat-container {
            top: 16px;
            bottom: 16px;
            height: auto;
            max-height: calc(100vh - 32px);
          }

          .n8n-chat-widget .chat-shell {
            min-height: max-content;
          }

          .n8n-chat-widget .chat-messages {
            height: clamp(200px, 40vh, 360px);
            flex: 0 0 auto;
          }
        }
      `}</style>
    </div>
  );
}
