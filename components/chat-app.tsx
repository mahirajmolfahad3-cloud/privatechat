"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  ArrowLeft, Check, CheckCheck, Copy, LogOut, MessageCircle, Moon, Plus, Search, Send, Smile, Sun, X,
} from "lucide-react";

type UserProfile = { id: string; chat_id: string; display_name: string; last_seen_at: string };
type Conversation = {
  conversation_id: string;
  other_user_id: string;
  other_chat_id: string;
  other_display_name: string;
  other_last_seen_at: string;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
};
type Message = { id: string; conversation_id: string; sender_id: string; content: string; created_at: string; read_at: string | null };
type FoundUser = Pick<UserProfile, "id" | "chat_id" | "display_name" | "last_seen_at">;

const EMOJIS = ["😀", "😂", "🥲", "😍", "😎", "🤔", "👍", "🙏", "❤️", "🔥", "🎉", "😭", "😮", "😅", "😴", "🤝", "💯", "👀", "🥳", "✨"];

function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map(x => x[0]).join("").toUpperCase() || "?"; }
function formatTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}
function timeOnly(value: string) { return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
function online(lastSeen: string) { return Date.now() - new Date(lastSeen).getTime() < 70_000; }
function dayKey(value: string) { return new Date(value).toDateString(); }
function dayLabel(value: string) {
  const date = new Date(value);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.floor((startOfToday.getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86_400_000);
  if (diff === 0) return "TODAY";
  if (diff === 1) return "YESTERDAY";
  return date.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }).toUpperCase();
}

export function ChatApp({ currentUser, initialConversations }: { currentUser: UserProfile; initialConversations: Conversation[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [conversations, setConversations] = useState(initialConversations);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [foundUser, setFoundUser] = useState<FoundUser | null>(null);
  const [finding, setFinding] = useState(false);
  const [sending, setSending] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const messageAreaRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const nearBottomRef = useRef(true);
  const prevActiveIdRef = useRef<string | null>(null);
  const activeRef = useRef<Conversation | null>(null);
  const typingChannel = useRef<any>(null);
  const typingResetTimer = useRef<number | undefined>(undefined);
  const lastTypingSent = useRef(0);

  useEffect(() => {
    let saved: "light" | "dark" | null = null;
    try { saved = localStorage.getItem("ping-theme") as "light" | "dark" | null; } catch {}
    const next = saved ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = next;
    setTheme(next);
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("ping-theme", next); } catch {}
    setTheme(next);
  }

  const refreshConversations = useCallback(async () => {
    const { data } = await supabase.rpc("list_my_conversations");
    if (data) setConversations(data as Conversation[]);
  }, [supabase]);

  const openConversation = useCallback(async (conversation: Conversation) => {
    setActive(conversation);
    setMessages([]);
    setPeerTyping(false);
    setShowEmoji(false);
    const { data } = await supabase.from("messages").select("id, conversation_id, sender_id, content, created_at, read_at").eq("conversation_id", conversation.conversation_id).order("created_at", { ascending: true });
    setMessages((data ?? []) as Message[]);
    await supabase.rpc("mark_conversation_read", { p_conversation_id: conversation.conversation_id });
    setConversations(prev => prev.map(x => x.conversation_id === conversation.conversation_id ? { ...x, unread_count: 0 } : x));
  }, [supabase]);

  // Presence heartbeat + periodic list refresh (keeps online dots and last-seen fresh).
  useEffect(() => {
    void supabase.rpc("touch_presence");
    const timer = window.setInterval(() => { void supabase.rpc("touch_presence"); void refreshConversations(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [supabase, refreshConversations]);

  // Keep the composer visible above the on-screen keyboard: iOS/Android don't
  // resize the fixed chat pane when the keyboard opens, so nudge it up using
  // the visual viewport instead of letting it hide behind the keys.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      const offset = Math.max(0, window.innerHeight - vv.height);
      if (mainRef.current) mainRef.current.style.bottom = offset > 2 ? `${offset}px` : "";
    };
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    apply();
    return () => { vv.removeEventListener("resize", apply); vv.removeEventListener("scroll", apply); };
  }, []);

  useEffect(() => { activeRef.current = active; }, [active]);

  // Global inbox channel: one subscription for ALL of the user's conversations.
  // RLS on `messages` means Supabase only pushes rows from conversations this
  // user is a member of, so a new incoming chat shows up live in the sidebar
  // even when it has never been opened before.
  useEffect(() => {
    const channel = supabase.channel("inbox")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, payload => {
        const incoming = payload.new as Message;
        const current = activeRef.current;
        if (current && incoming.conversation_id === current.conversation_id) {
          setMessages(prev => prev.some(m => m.id === incoming.id) ? prev : [...prev, incoming]);
          if (incoming.sender_id !== currentUser.id) {
            void supabase.rpc("mark_conversation_read", { p_conversation_id: current.conversation_id });
          }
        }
        void refreshConversations();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [currentUser.id, refreshConversations, supabase]);

  // Typing indicator via Realtime Broadcast — no schema changes needed.
  useEffect(() => {
    if (!active) return;
    const channel = supabase.channel(`typing:${active.conversation_id}`)
      .on("broadcast", { event: "typing" }, ({ payload }: { payload: any }) => {
        if (payload?.user && payload.user !== currentUser.id) {
          setPeerTyping(true);
          window.clearTimeout(typingResetTimer.current);
          typingResetTimer.current = window.setTimeout(() => setPeerTyping(false), 3000);
        }
      })
      .subscribe();
    typingChannel.current = channel;
    return () => {
      typingChannel.current = null;
      void supabase.removeChannel(channel);
      setPeerTyping(false);
    };
  }, [active?.conversation_id, currentUser.id, supabase]);

  function notifyTyping() {
    const channel = typingChannel.current;
    if (!channel) return;
    const now = Date.now();
    if (now - lastTypingSent.current < 1800) return;
    lastTypingSent.current = now;
    void channel.send({ type: "broadcast", event: "typing", payload: { user: currentUser.id } });
  }

  // Track whether the reader is near the bottom so we only auto-scroll when it
  // won't yank the view away mid-read. Scroll the container directly instead of
  // scrollIntoView, which can steal focus and dismiss the keyboard on mobile.
  useEffect(() => {
    const area = messageAreaRef.current;
    if (!area) return;
    const onScroll = () => {
      nearBottomRef.current = area.scrollHeight - area.scrollTop - area.clientHeight < 140;
    };
    area.addEventListener("scroll", onScroll, { passive: true });
    return () => area.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const area = messageAreaRef.current;
    if (!area) return;
    const openedNewChat = prevActiveIdRef.current !== active?.conversation_id;
    if (active?.conversation_id) prevActiveIdRef.current = active.conversation_id;
    if (openedNewChat || nearBottomRef.current) {
      area.scrollTop = area.scrollHeight;
      nearBottomRef.current = true;
    }
  }, [messages.length, active?.conversation_id]);

  async function findPerson() {
    setFinding(true); setSearchError(""); setFoundUser(null);
    const clean = recipientId.trim().toUpperCase();
    if (!clean || clean === currentUser.chat_id) { setSearchError("Enter someone else’s Ping ID."); setFinding(false); return; }
    const { data, error } = await supabase.rpc("find_user_by_chat_id", { p_chat_id: clean });
    if (error) setSearchError(error.message);
    else if (!data?.length) setSearchError("No user found with that Ping ID.");
    else setFoundUser(data[0] as FoundUser);
    setFinding(false);
  }

  async function startChat() {
    if (!foundUser) return;
    const { data, error } = await supabase.rpc("get_or_create_conversation", { other_user_id: foundUser.id });
    if (error || !data) { setSearchError(error?.message || "Could not create the conversation."); return; }
    const conversation: Conversation = {
      conversation_id: data,
      other_user_id: foundUser.id,
      other_chat_id: foundUser.chat_id,
      other_display_name: foundUser.display_name,
      other_last_seen_at: foundUser.last_seen_at,
      last_message: null,
      last_message_at: null,
      unread_count: 0,
    };
    setShowAdd(false); setRecipientId(""); setFoundUser(null); setSearchError("");
    void refreshConversations();
    await openConversation(conversation);
  }

  async function sendMessage() {
    const content = draft.trim();
    if (!content || !active || sending) return;
    setSending(true); setDraft("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    // Keep the field focused so the mobile keyboard never collapses mid-chat.
    requestAnimationFrame(() => textareaRef.current?.focus());
    const { data, error } = await supabase.from("messages").insert({ conversation_id: active.conversation_id, sender_id: currentUser.id, content }).select("id, conversation_id, sender_id, content, created_at, read_at").single();
    if (error) { setDraft(content); setSearchError(error.message); }
    else if (data) { setMessages(prev => [...prev, data as Message]); void refreshConversations(); }
    requestAnimationFrame(() => textareaRef.current?.focus());
    setSending(false);
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const filtered = conversations.filter(c => `${c.other_display_name} ${c.other_chat_id} ${c.last_message ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const activePerson = active;
  const status = activePerson
    ? peerTyping
      ? "typing…"
      : online(activePerson.other_last_seen_at) ? "online" : `last seen at ${timeOnly(activePerson.other_last_seen_at)}`
    : "";

  return (
    <div className={`chat-app ${active ? "chat-open" : ""}`}>
      <aside className="sidebar">
        <header className="sidebar-top">
          <div className="sidebar-head">
            <div className="sidebar-brand"><div className="brand-mark"><MessageCircle size={20} /></div><span>Ping</span></div>
            <div className="sidebar-actions">
              <button className="icon-button" onClick={toggleTheme} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
                {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
              </button>
              <button className="icon-button" onClick={() => setShowAdd(true)} aria-label="New chat" title="New chat"><Plus size={21} /></button>
            </div>
          </div>
          <div className="search-wrap">
            <Search className="search-icon" size={16} />
            <input className="input search-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search or start a new chat" />
          </div>
          <div className="me-chip">
            <div className="avatar tiny">{initials(currentUser.display_name)}</div>
            <div className="me-name"><strong>{currentUser.display_name}</strong><span>Ping ID · {currentUser.chat_id}</span></div>
            <button className="icon-button" title="Copy my Ping ID" onClick={() => navigator.clipboard?.writeText(currentUser.chat_id)}><Copy size={16} /></button>
          </div>
        </header>
        <div className="conversation-list">
          {filtered.length === 0 ? (
            <div className="empty-list">{conversations.length ? "No conversations match your search." : "No chats yet. Tap the + button and enter someone’s Ping ID to start one."}</div>
          ) : filtered.map(c => (
            <button key={c.conversation_id} className={`chat-item ${active?.conversation_id === c.conversation_id ? "active" : ""}`} onClick={() => void openConversation(c)}>
              <div className="avatar small">{initials(c.other_display_name)}{online(c.other_last_seen_at) && <span className="presence-dot" />}</div>
              <div className="chat-meta">
                <div className="chat-row"><span className="chat-title">{c.other_display_name}</span><span className="chat-time">{formatTime(c.last_message_at)}</span></div>
                <div className="chat-row"><span className="preview">{c.last_message || `Ping ID · ${c.other_chat_id}`}</span>{c.unread_count > 0 && <span className="unread-badge">{c.unread_count > 99 ? "99+" : c.unread_count}</span>}</div>
              </div>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <button className="button button-ghost signout" onClick={logout}><LogOut size={16} /> Sign out</button>
        </div>
      </aside>

      <main className="main" ref={mainRef}>
        {activePerson ? (
          <>
            <header className="chat-header">
              <button className="icon-button mobile-only" onClick={() => setActive(null)} aria-label="Back"><ArrowLeft size={22} /></button>
              <div className="chat-person">
                <div className="avatar">{initials(activePerson.other_display_name)}{online(activePerson.other_last_seen_at) && <span className="presence-dot" />}</div>
                <div className="person-copy"><strong>{activePerson.other_display_name}</strong><span className={`status ${peerTyping ? "typing" : ""}`}>{status}</span></div>
              </div>
              <div className="header-actions">
                <button className="icon-button desktop-only" onClick={() => setActive(null)} title="Close chat"><X size={20} /></button>
              </div>
            </header>
            <section className="message-area" ref={messageAreaRef}>
              <div className="message-inner">
                {messages.map((m, i) => {
                  const mine = m.sender_id === currentUser.id;
                  const prev = messages[i - 1];
                  const next = messages[i + 1];
                  const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
                  const tail = !next || next.sender_id !== m.sender_id || dayKey(next.created_at) !== dayKey(m.created_at);
                  return (
                    <Fragment key={m.id}>
                      {newDay && <div className="day-chip">{dayLabel(m.created_at)}</div>}
                      <div className={`message-row ${mine ? "out" : "in"}`}>
                        <div className={`message-bubble ${tail ? (mine ? "tail-out" : "tail-in") : ""}`}>
                          <div className="message-content">{m.content}</div>
                          <div className="message-meta">
                            {formatTime(m.created_at)}
                            {mine && (m.read_at ? <CheckCheck size={14} className="tick-read" /> : <Check size={14} />)}
                          </div>
                        </div>
                      </div>
                    </Fragment>
                  );
                })}
                {peerTyping && (
                  <div className="message-row in"><div className="message-bubble typing-bubble"><i /><i /><i /></div></div>
                )}
              </div>
            </section>
            <div className="composer">
              {showEmoji && (
                <div className="emoji-pop">
                  {EMOJIS.map(e => <button key={e} type="button" onClick={() => { setDraft(d => d + e); textareaRef.current?.focus(); }}>{e}</button>)}
                </div>
              )}
              <form className="composer-inner" onSubmit={e => { e.preventDefault(); void sendMessage(); }}>
                <button type="button" className="icon-button" onClick={() => setShowEmoji(v => !v)} aria-label="Emoji" title="Emoji"><Smile size={24} /></button>
                <div className="composer-bar">
                  <textarea
                    ref={textareaRef}
                    className="composer-input"
                    rows={1}
                    value={draft}
                    enterKeyHint="send"
                    autoComplete="off"
                    autoCapitalize="sentences"
                    onChange={e => { setDraft(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`; notifyTyping(); }}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }}
                    placeholder="Type a message"
                    maxLength={4000}
                  />
                </div>
                <button className="send" disabled={!draft.trim() || sending} aria-label="Send"><Send size={20} /></button>
              </form>
            </div>
          </>
        ) : (
          <div className="splash">
            <div className="splash-art"><MessageCircle size={54} /></div>
            <h1>Ping Web</h1>
            <p>Select a chat on the left to start talking. Or use the + button to find someone by their unique Ping ID.</p>
            <div className="splash-foot">🔒 Your personal messages stay private and sync in realtime.</div>
          </div>
        )}

      </main>

      {showAdd && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) { setShowAdd(false); setFoundUser(null); setSearchError(""); } }}>
          <div className="modal-card">
            <button className="icon-button modal-close" onClick={() => { setShowAdd(false); setFoundUser(null); setSearchError(""); }} aria-label="Close"><X size={18} /></button>
            <div className="brand"><div className="brand-mark"><Plus size={22} /></div><div className="brand-name">New chat</div></div>
            <p className="subtitle">Enter the other person’s unique Ping ID.</p>
            <div className="form-grid">
              {searchError && <div className="error">{searchError}</div>}
              <label className="field"><span className="label">Ping ID</span><input className="input" value={recipientId} onChange={e => setRecipientId(e.target.value.toUpperCase())} placeholder="A1B2C3D4E5" autoFocus maxLength={10} /></label>
              <button className="button button-primary" onClick={() => void findPerson()} disabled={finding}>{finding ? "Finding…" : "Find person"}</button>
              {foundUser && (
                <div className="found-user">
                  <div className="avatar small">{initials(foundUser.display_name)}{online(foundUser.last_seen_at) && <span className="presence-dot" />}</div>
                  <div className="chat-meta"><div className="chat-title">{foundUser.display_name}</div><div className="preview">Ping ID · {foundUser.chat_id}</div></div>
                </div>
              )}
              {foundUser && <button className="button button-primary" onClick={() => void startChat()}>Open conversation</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}




