import Link from "next/link";
import { SignupForm } from "@/components/auth-forms";

export default function SignupPage() {
  return (
    <main className="page-shell">
      <section className="auth-card">
        <div className="brand"><div className="brand-mark">✦</div><div className="brand-name">Ping</div></div>
        <h1>Create your account.</h1>
        <p className="subtitle">Get a unique Ping ID and start chatting privately.</p>
        <SignupForm />
        <div className="auth-footer">Already have an account? <Link href="/login">Sign in</Link></div>
      </section>
    </main>
  );
}
