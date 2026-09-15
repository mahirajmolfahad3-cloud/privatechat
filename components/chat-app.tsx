"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  ArrowLeft, Check, CheckCheck, Copy, LogOut, MessageCircle, Moon, Pencil, Plus, Search, Send, Smile, Sun, X,
} from "lucide-react";

type UserProfile = { id: string; chat_id: string; display_name: string; last_seen_at: string; last_active_at: string };
type Conversation = {
  conversation_id: string;
  other_user_id: string;
  other_chat_id: string;
  other_display_name: string;
  other_last_seen_at: string;
  other_last_active_at: string;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
};
type Message = { id: string; conversation_id: string; sender_id: string; content: string; created_at: string; read_at: string | null; reply_to_id: string | null; edited_at: string | null };
type FoundUser = Pick<UserProfile, "id" | "chat_id" | "display_name" | "last_seen_at" | "last_active_at">;

const EMOJIS = ["😘", "😍", "😏", "🥰", "💋", "😉", "😜", "❤️🔥", "😈", "💘", "💕", "🌹", "😳", "🫦", "🤭", "🥵", "👀", "🤤", "🤗", "😅"];

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
  const [searchError, setSearchError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const mainRef = useRef<HTMLElement>(null);
  const messageAreaRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const prevActiveIdRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const refreshTimer = useRef<number | undefined>(undefined);
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

  // Debounce sidebar refreshes so bulk UPDATE events (e.g. read receipt marks)
  // don't fire one RPC per row.
  const debouncedRefresh = useCallback(() => {
    window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => void refreshConversations(), 400);
  }, [refreshConversations]);

  useEffect(() => () => window.clearTimeout(refreshTimer.current), []);

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const openConversation = useCallback(async (conversation: Conversation) => {
    setActive(conversation);
    setMessages([]);
    setPeerTyping(false);
    setShowEmoji(false);
    setSelectedMessage(null);
    setReplyingTo(null);
    setEditingId(null);
    setEditingText("");
    const { data } = await supabase.from("messages").select("id, conversation_id, sender_id, content, created_at, read_at, reply_to_id, edited_at").eq("conversation_id", conversation.conversation_id).order("created_at", { ascending: true });
    setMessages((data ?? []) as Message[]);
    await supabase.rpc("mark_conversation_read", { p_conversation_id: conversation.conversation_id });
    // Broadcast the read receipt after a short delay so the typing channel has
    // time to subscribe (setActive just ran above, the effect fires next tick).
    setTimeout(() => announceRead(conversation.conversation_id), 400);
    void supabase.rpc("touch_activity");
    setConversations(prev => prev.map(x => x.conversation_id === conversation.conversation_id ? { ...x, unread_count: 0 } : x));
  }, [supabase]);

  // Presence heartbeat + periodic list refresh (keeps online dots and last-seen fresh).
  useEffect(() => {
    void supabase.rpc("touch_presence");
    const timer = window.setInterval(() => { void supabase.rpc("touch_presence"); void refreshConversations(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [supabase, refreshConversations]);

  // Keep the composer visible above the on-screen keyboard. On Android the
  // viewport meta uses interactive-widget=resizes-content so the layout resizes
  // natively (this handler becomes a no-op there). iOS doesn't resize, so nudge
  // the fixed pane up using the visual viewport — and re-pin the document to
  // the top, because iOS scrolls the page itself when the keyboard opens.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      if (mainRef.current) mainRef.current.style.bottom = offset > 2 ? `${offset}px` : "";
      if (offset > 2 && window.scrollY !== 0) window.scrollTo(0, 0);
    };
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    apply();
    return () => { vv.removeEventListener("resize", apply); vv.removeEventListener("scroll", apply); };
  }, []);

  useEffect(() => { activeRef.current = active; }, [active]);

  // Realtime presence: when the other person's heartbeat refreshes their
  // last_seen_at, surface it live in the sidebar and the open chat header
  // instead of waiting for the 30s conversation poll.
  useEffect(() => {
    const channel = supabase.channel("presence-watch")
.on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=neq.${currentUser.id}` }, payload => {
        const profile = payload.new as UserProfile;
        setConversations(prev => prev.map(c => c.other_user_id === profile.id ? { ...c, other_last_seen_at: profile.last_seen_at, other_last_active_at: profile.last_active_at } : c));
        setActive(prev => prev && prev.other_user_id === profile.id ? { ...prev, other_last_seen_at: profile.last_seen_at, other_last_active_at: profile.last_active_at } : prev);
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [supabase, currentUser.id]);

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
            announceRead(current.conversation_id);
          }
        }
        void refreshConversations();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, payload => {
        const updated = payload.new as Message;
        const previous = messagesRef.current.find(m => m.id === updated.id);
        const contentChanged = !previous || previous.content !== updated.content || (previous.edited_at ?? null) !== (updated.edited_at ?? null);
        setMessages(prev => prev.map(m => m.id === updated.id
          ? { ...m, content: updated.content, read_at: updated.read_at ?? null, edited_at: updated.edited_at ?? null }
          : m));
        if (contentChanged) debouncedRefresh();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [currentUser.id, refreshConversations, debouncedRefresh, supabase]);

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
      .on("broadcast", { event: "messages-read" }, ({ payload }: { payload: any }) => {
        if (payload?.user && payload.user !== currentUser.id) {
          // The other person opened or read the chat — flip our sent ticks to
          // blue checkmarks immediately instead of waiting for the next poll.
          const now = new Date().toISOString();
          setMessages(prev => prev.map(m => m.sender_id === currentUser.id && !m.read_at ? { ...m, read_at: now } : m));
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

  // Broadcast that messages have been read in this conversation so the sender
  // sees blue ticks live (the SECURITY DEFINER mark_conversation_read RPC
  // doesn't trigger reliable postgres_changes UPDATE events for the other client).
  function announceRead(conversationId: string) {
    const channel = typingChannel.current;
    if (!channel) return;
    void channel.send({ type: "broadcast", event: "messages-read", payload: { conversation_id: conversationId, user: currentUser.id } });
  }

  function notifyTyping() {
    const channel = typingChannel.current;
    if (!channel) return;
    const now = Date.now();
    if (now - lastTypingSent.current < 1800) return;
    lastTypingSent.current = now;
    void channel.send({ type: "broadcast", event: "typing", payload: { user: currentUser.id } });
    void supabase.rpc("touch_activity");
  }

  // Track whether the reader is pinned to the bottom so we only auto-scroll
  // when it won't yank the view away mid-read. Scroll the container directly
  // instead of scrollIntoView, which can steal focus and dismiss the keyboard.
  const pinnedRef = useRef(true);
  useEffect(() => {
    const area = messageAreaRef.current;
    if (!area) return;
    const onScroll = () => {
      pinnedRef.current = area.scrollHeight - area.scrollTop - area.clientHeight < 140;
    };
    area.addEventListener("scroll", onScroll, { passive: true });
    return () => area.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToBottom = useCallback(() => {
    const area = messageAreaRef.current;
    if (!area) return;
    area.scrollTop = area.scrollHeight;
    pinnedRef.current = true;
  }, []);

  useEffect(() => {
    const openedNewChat = prevActiveIdRef.current !== active?.conversation_id;
    if (active?.conversation_id) prevActiveIdRef.current = active.conversation_id;
    if (openedNewChat || pinnedRef.current) scrollToBottom();
  }, [messages.length, active?.conversation_id, scrollToBottom]);

  // When the keyboard opens/closes the message pane shrinks or grows — re-stick
  // to the bottom so the newest messages stay in view instead of jumping away.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      if (pinnedRef.current) requestAnimationFrame(scrollToBottom);
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, [scrollToBottom]);

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
      other_last_active_at: foundUser.last_active_at,
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
    if (!content || !active) return;
    // Optimistic insert: show the message immediately so fast consecutive
    // sends feel instant and the send button never flickers grey per message.
    const tempId = `temp-${crypto.randomUUID()}`;
    const optimistic: Message = {
      id: tempId,
      conversation_id: active.conversation_id,
      sender_id: currentUser.id,
      content,
      created_at: new Date().toISOString(),
      read_at: null,
      reply_to_id: replyingTo?.id ?? null,
      edited_at: null,
    };
    setMessages(prev => [...prev, optimistic]);
    setReplyingTo(null);
    setDraft("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    // Keep the field focused so the mobile keyboard never collapses mid-chat.
    requestAnimationFrame(() => textareaRef.current?.focus());
    const { data, error } = await supabase.from("messages").insert({
      conversation_id: active.conversation_id,
      sender_id: currentUser.id,
      content,
      reply_to_id: optimistic.reply_to_id,
    }).select("id, conversation_id, sender_id, content, created_at, read_at, reply_to_id, edited_at").single();
    if (error) {
      // Roll back the optimistic bubble and restore the draft.
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setDraft(content);
      setReplyingTo(optimistic.reply_to_id ? messagesRef.current.find(m => m.id === optimistic.reply_to_id) ?? null : null);
      setSearchError(error.message);
    } else if (data) {
      const saved = data as Message;
      // Swap the temp bubble for the real row (or drop it if realtime already
      // delivered the authoritative copy).
      setMessages(prev => prev.some(m => m.id === saved.id)
        ? prev.filter(m => m.id !== tempId)
        : prev.map(m => m.id === tempId ? saved : m));
      void refreshConversations();
      void supabase.rpc("touch_activity");
    }
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function copyMessage() {
    if (!selectedMessage) return;
    void navigator.clipboard?.writeText(selectedMessage.content);
    setSelectedMessage(null);
  }

  function startReply() {
    if (!selectedMessage) return;
    setReplyingTo(selectedMessage);
    setSelectedMessage(null);
    setShowEmoji(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function startEdit() {
    if (!selectedMessage || selectedMessage.sender_id !== currentUser.id) return;
    setEditingId(selectedMessage.id);
    setEditingText(selectedMessage.content);
    setSelectedMessage(null);
    setShowEmoji(false);
    requestAnimationFrame(() => editTextareaRef.current?.focus());
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingText("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function saveEdit() {
    const content = editingText.trim();
    if (!editingId || !content) return;
    const { data, error } = await supabase.from("messages")
      .update({ content, edited_at: new Date().toISOString() })
      .eq("id", editingId)
      .select("id, conversation_id, sender_id, content, created_at, read_at, reply_to_id, edited_at")
      .single();
    if (!error && data) {
      setMessages(prev => prev.map(m => m.id === data.id ? (data as Message) : m));
      void refreshConversations();
    }
    setEditingId(null);
    setEditingText("");
    requestAnimationFrame(() => textareaRef.current?.focus());
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
      : online(activePerson.other_last_seen_at) ? "Active" : `last seen at ${timeOnly(activePerson.other_last_active_at)}`
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
                <div className="person-copy"><strong>{activePerson.other_display_name}</strong><span className={`status ${peerTyping ? "typing" : online(activePerson.other_last_seen_at) ? "active" : ""}`}>{status}</span></div>
              </div>
              <div className="header-actions">
                <button className="icon-button desktop-only" onClick={() => setActive(null)} title="Close chat"><X size={20} /></button>
              </div>
            </header>
            <section className="message-area" ref={messageAreaRef}>
              <div className="message-inner" onClick={e => { if (e.target === e.currentTarget) setSelectedMessage(null); }}>
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
                        <div
                          className={`message-bubble ${tail ? (mine ? "tail-out" : "tail-in") : ""} ${selectedMessage?.id === m.id ? "selected" : ""}`}
                          onClick={() => setSelectedMessage(sel => sel?.id === m.id ? null : m)}
                        >
                          {m.reply_to_id && (() => {
                            const quoted = messages.find(x => x.id === m.reply_to_id);
                            if (!quoted) return null;
                            return (
                              <div className="message-reply">
                                <span className="reply-owner">{quoted.sender_id === currentUser.id ? "You" : activePerson?.other_display_name}</span>
                                <span className="reply-text">{quoted.content}</span>
                              </div>
                            );
                          })()}
                          <div className="message-content">{m.content}</div>
                          <div className="message-meta">
                            {m.edited_at && <span className="edited-mark">edited</span>}
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
            {selectedMessage && (
              <div className="msg-actions">
                <span className="msg-actions-label">{selectedMessage.sender_id === currentUser.id ? "Your message" : activePerson?.other_display_name}</span>
                <button className="msg-action" onClick={copyMessage}><Copy size={15} /> Copy</button>
                <button className="msg-action" onClick={startReply}><MessageCircle size={15} /> Reply</button>
                {selectedMessage.sender_id === currentUser.id && (
                  <button className="msg-action accent" onClick={startEdit}><Pencil size={15} /> Edit</button>
                )}
                <button className="msg-action" onClick={() => setSelectedMessage(null)} aria-label="Close actions"><X size={15} /></button>
              </div>
            )}
            <div className="composer">
              {showEmoji && !editingId && (
                <div className="emoji-pop">
                  {EMOJIS.map(e => <button key={e} type="button" onClick={() => { setDraft(d => d + e); textareaRef.current?.focus(); }}>{e}</button>)}
                </div>
              )}
              <div className={`reply-slot ${!editingId && replyingTo ? "open" : ""}`}>
                {!editingId && replyingTo && (
                  <div className="reply-preview">
                    <div className="reply-preview-copy">
                      <span className="reply-owner">Replying to {replyingTo.sender_id === currentUser.id ? "yourself" : activePerson?.other_display_name}</span>
                      <p>{replyingTo.content}</p>
                    </div>
                    <button type="button" className="icon-button" onPointerDown={e => e.preventDefault()} onClick={() => setReplyingTo(null)} aria-label="Cancel reply"><X size={16} /></button>
                  </div>
                )}
              </div>
              {editingId ? (
                <form className="composer-inner" onSubmit={e => { e.preventDefault(); void saveEdit(); }}>
                  <button type="button" className="icon-button" onPointerDown={e => e.preventDefault()} onClick={cancelEdit} aria-label="Cancel edit" title="Cancel editing"><X size={22} /></button>
                  <div className="composer-bar">
                    <textarea
                      ref={editTextareaRef}
                      className="composer-input"
                      rows={1}
                      value={editingText}
                      enterKeyHint="done"
                      autoCapitalize="sentences"
                      onChange={e => { setEditingText(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`; }}
                      onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void saveEdit(); } }}
                      placeholder="Edit message"
                      maxLength={4000}
                      autoFocus
                    />
                  </div>
                  <button type="submit" className="send" disabled={!editingText.trim()} onPointerDown={e => e.preventDefault()} aria-label="Save edit"><Check size={20} /></button>
                </form>
              ) : (
                <form className="composer-inner" onSubmit={e => { e.preventDefault(); void sendMessage(); }}>
                  <button type="button" className="icon-button" onPointerDown={e => e.preventDefault()} onClick={() => setShowEmoji(v => !v)} aria-label="Emoji" title="Emoji"><Smile size={24} /></button>
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
                  <button className="send" disabled={!draft.trim()} onPointerDown={e => e.preventDefault()} aria-label="Send"><Send size={20} /></button>
                </form>
              )}
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




