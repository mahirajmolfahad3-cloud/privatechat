import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { LoginForm } from "@/components/auth-forms";

export default function LoginPage() {
  return (
    <main className="page-shell">
      <section className="auth-card">
        <div className="brand"><div className="brand-mark"><MessageCircle size={22} /></div><div className="brand-name">Ping</div></div>
        <h1>Welcome back.</h1>
        <p className="subtitle">Sign in to your private conversations.</p>
        <LoginForm />
        <div className="auth-footer">New here? <Link href="/signup">Create an account</Link></div>
      </section>
    </main>
  );
}
