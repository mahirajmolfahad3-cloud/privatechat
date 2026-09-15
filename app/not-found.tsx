import Link from "next/link";
export default function NotFound() { return <main className="page-shell"><section className="auth-card"><h1>Not found</h1><p className="subtitle">That page does not exist.</p><Link className="button button-primary" href="/chat" style={{display:"inline-block"}}>Back to chat</Link></section></main>; }
