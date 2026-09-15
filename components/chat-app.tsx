"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Check, CheckCheck, Copy, LogOut, Menu, MessageCircle, Plus, Search, Send, X } from "lucide-react";

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

function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map(x => x[0]).join("").toUpperCase() || "?"; }
function formatTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}
function online(lastSeen: string) { return Date.now() - new Date(lastSeen).getTime() < 70_000; }

export function ChatApp({ currentUser, initialConversations }: { currentUser: UserProfile; initialConversations: Conversation[] }) {
  const supabase = useMemo(() => createClient(), []);
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const messageEnd = useRef<HTMLDivElement>(null);

  const refreshConversations = useCallback(async () => {
    const { data } = await supabase.rpc("list_my_conversations");
    if (data) setConversations(data as Conversation[]);
  }, [supabase]);

  const openConversation = useCallback(async (conversation: Conversation) => {
    setActive(conversation);
    setMobileOpen(false);
    setMessages([]);
    const { data } = await supabase.from("messages").select("id, conversation_id, sender_id, content, created_at, read_at").eq("conversation_id", conversation.conversation_id).order("created_at", { ascending: true });
    setMessages((data ?? []) as Message[]);
    await supabase.rpc("mark_conversation_read", { p_conversation_id: conversation.conversation_id });
    setConversations(prev => prev.map(x => x.conversation_id === conversation.conversation_id ? { ...x, unread_count: 0 } : x));
  }, [supabase]);

  useEffect(() => {
    const timer = window.setInterval(() => { void supabase.rpc("touch_presence"); }, 30_000);
    void supabase.rpc("touch_presence");
    return () => window.clearInterval(timer);
  }, [supabase]);

  useEffect(() => {
    if (!active) return;
    const channel = supabase.channel(`conversation:${active.conversation_id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${active.conversation_id}` }, payload => {
        const incoming = payload.new as Message;
        setMessages(prev => prev.some(m => m.id === incoming.id) ? prev : [...prev, incoming]);
        if (incoming.sender_id !== currentUser.id) {
          void supabase.rpc("mark_conversation_read", { p_conversation_id: active.conversation_id });
        }
        void refreshConversations();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [active, currentUser.id, refreshConversations, supabase]);

  useEffect(() => { messageEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length, active?.conversation_id]);

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
    await refreshConversations();
    const latest = conversations.find(c => c.conversation_id === data) ?? conversation;
    setShowAdd(false); setRecipientId(""); setFoundUser(null); setSearchError("");
    await openConversation({ ...latest, ...conversation });
  }

  async function sendMessage() {
    const content = draft.trim();
    if (!content || !active || sending) return;
    setSending(true); setDraft("");
    const { data, error } = await supabase.from("messages").insert({ conversation_id: active.conversation_id, sender_id: currentUser.id, content }).select("id, conversation_id, sender_id, content, created_at, read_at").single();
    if (error) { setDraft(content); setSearchError(error.message); }
    else if (data) { setMessages(prev => [...prev, data as Message]); void refreshConversations(); }
    setSending(false);
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const filtered = conversations.filter(c => `${c.other_display_name} ${c.other_chat_id} ${c.last_message ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const activePerson = active;

  return (
    <div className="chat-app">
      <div className={`drawer-overlay ${mobileOpen ? "open" : ""}`} onClick={() => setMobileOpen(false)} />
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="sidebar-top">
          <div className="sidebar-head">
            <div className="sidebar-brand"><div className="brand-mark">✦</div>Ping</div>
            <button className="icon-button" onClick={() => setShowAdd(true)} aria-label="New chat"><Plus size={18} /></button>
          </div>
          <div className="me-chip">
            <div className="avatar small">{initials(currentUser.display_name)}</div>
            <div className="me-name"><strong>{currentUser.display_name}</strong><span>ID · {currentUser.chat_id}</span></div>
            <button className="icon-button" title="Copy my Ping ID" onClick={() => navigator.clipboard?.writeText(currentUser.chat_id)}><Copy size={15} /></button>
          </div>
          <div style={{ height: 14 }} />
          <div className="search-wrap"><Search className="search-icon" size={16} /><input className="input search-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search conversations" /></div>
        </div>
        <div className="conversation-list">
          {filtered.length === 0 ? <div className="empty-list">{conversations.length ? "No conversations match your search." : "No chats yet. Start one with the + button."}</div> : filtered.map(c => (
            <button key={c.conversation_id} className={`chat-item ${active?.conversation_id === c.conversation_id ? "active" : ""}`} onClick={() => openConversation(c)}>
              <div className="avatar small">{initials(c.other_display_name)}</div>
              <div className="chat-meta">
                <div className="chat-row"><span className="chat-title">{c.other_display_name}</span><span className="chat-time">{formatTime(c.last_message_at)}</span></div>
                <div className="chat-row"><span className="preview">{c.last_message || `Ping ID · ${c.other_chat_id}`}</span>{c.unread_count > 0 && <span className="badge">{c.unread_count > 99 ? "99+" : c.unread_count}</span>}</div>
              </div>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom"><button className="button button-ghost" style={{ width: "100%", display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }} onClick={logout}><LogOut size={16} /> Sign out</button></div>
      </aside>

      <main className="main">
        {activePerson ? <>
          <header className="chat-header">
            <div className="chat-person"><button className="icon-button add-panel" onClick={() => setMobileOpen(true)}><Menu size={18} /></button><div className="avatar">{initials(activePerson.other_display_name)}</div><div className="person-copy"><strong>{activePerson.other_display_name}</strong><span>{online(activePerson.other_last_seen_at) ? "online" : `Ping ID · ${activePerson.other_chat_id}`}</span></div></div>
            <div className="header-actions"><button className="icon-button" onClick={() => setActive(null)} title="Close chat"><X size={17} /></button></div>
          </header>
          <section className="message-area"><div className="message-inner"><div className="day-label">End-to-end private conversation</div>{messages.map(m => {
            const mine = m.sender_id === currentUser.id;
            return <div className={`message-row ${mine ? "out" : "in"}`} key={m.id}><div className="message-bubble"><div className="message-content">{m.content}</div><div className="message-time">{formatTime(m.created_at)} {mine && (m.read_at ? <CheckCheck size={12} /> : <Check size={12} />)}</div></div></div>;
          })}<div ref={messageEnd} /></div></section>
          <div className="composer"><form className="composer-inner" onSubmit={e => { e.preventDefault(); void sendMessage(); }}><textarea className="input composer-input" rows={1} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }} placeholder="Write a message…" maxLength={4000} /><button className="button button-primary send" disabled={!draft.trim() || sending} aria-label="Send"><Send size={18} /></button></form></div>
        </> : <div className="empty-chat"><div className="empty-chat-card"><div className="big-mark"><MessageCircle size={30} /></div><h2>Your private space.</h2><p>Start a one-to-one conversation using someone’s Ping ID. Messages arrive live and stay in your history.</p><div style={{ marginTop: 18 }}><button className="button button-primary" onClick={() => setShowAdd(true)}>Start a chat</button></div></div></div>}
      </main>

      {showAdd && <div className="drawer-overlay open" style={{ display: "grid", placeItems: "center", padding: 20 }}><div className="auth-card" style={{ width: "min(100%, 440px)", position: "relative" }}>
        <button className="icon-button" style={{ position: "absolute", top: 16, right: 16 }} onClick={() => { setShowAdd(false); setFoundUser(null); setSearchError(""); }}><X size={17} /></button>
        <div className="brand"><div className="brand-mark">+</div><div className="brand-name">New chat</div></div>
        <p className="subtitle">Enter the other person’s unique Ping ID.</p>
        <div className="form-grid">
          {searchError && <div className="error">{searchError}</div>}
          <label className="field"><span className="label">Ping ID</span><input className="input" value={recipientId} onChange={e => setRecipientId(e.target.value.toUpperCase())} placeholder="A1B2C3D4E5" autoFocus /></label>
          <button className="button button-primary" onClick={findPerson} disabled={finding}>{finding ? "Finding…" : "Find person"}</button>
          {foundUser && <div className="chat-item active" style={{ border: "1px solid var(--border)" }}><div className="avatar">{initials(foundUser.display_name)}</div><div className="chat-meta"><div className="chat-title">{foundUser.display_name}</div><div className="preview">Ping ID · {foundUser.chat_id}</div></div></div>}
          {foundUser && <button className="button button-primary" onClick={startChat}>Open conversation</button>}
        </div>
      </div></div>}
    </div>
  );
}
