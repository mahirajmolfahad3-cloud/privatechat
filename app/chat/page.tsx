import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ChatApp } from "@/components/chat-app";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("id, chat_id, display_name, last_seen_at").eq("id", user.id).single();
  if (!profile) redirect("/signup");

  const { data: conversations } = await supabase
    .from("conversation_summaries")
    .select("conversation_id, other_user_id, other_chat_id, other_display_name, other_last_seen_at, last_message, last_message_at, unread_count")
    .eq("user_id", user.id)
    .order("last_message_at", { ascending: false, nullsFirst: false });

  return <ChatApp currentUser={profile} initialConversations={conversations ?? []} />;
}
