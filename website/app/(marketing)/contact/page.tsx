'use client';
import { useState } from 'react';

export default function Contact() {
  const [form, setForm] = useState({ name: '', email: '', message: '' });
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus('Sending…');
    setError('');
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to send message.');
      setForm({ name: '', email: '', message: '' });
      setStatus('Message received. Our team will be in touch.');
    } catch (error) {
      setStatus('');
      setError(error instanceof Error ? error.message : 'Unable to send message.');
    }
  }

  return <main className="mx-auto grid max-w-7xl gap-16 px-5 py-24 lg:grid-cols-2 lg:px-8"><div><p className="text-xs font-bold uppercase tracking-[.25em] text-cyan">Start a conversation</p><h1 className="mt-4 text-5xl font-black tracking-tight">Let’s build a sharper trading future.</h1><p className="mt-6 max-w-md leading-7 text-muted">Questions about the app, partnerships, or the TradiQs ecosystem? Our team is ready.</p><p className="mt-8 font-semibold text-cyan">support@trediqsAI.com</p></div><form onSubmit={submit} className="glass grid gap-5 rounded-3xl p-7"><label className="grid gap-2 text-sm font-semibold">Name<input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="rounded-xl border border-white/10 bg-ink p-3 font-normal outline-none focus:border-cyan" placeholder="Your name" /></label><label className="grid gap-2 text-sm font-semibold">Email<input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="rounded-xl border border-white/10 bg-ink p-3 font-normal outline-none focus:border-cyan" placeholder="you@company.com" /></label><label className="grid gap-2 text-sm font-semibold">Message<textarea required value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} className="min-h-32 rounded-xl border border-white/10 bg-ink p-3 font-normal outline-none focus:border-cyan" placeholder="How can we help?" /></label><button className="rounded-xl bg-cyan py-3 font-bold text-ink">Send message</button>{status && <p className="text-sm text-cyan">{status}</p>}{error && <p role="alert" className="text-sm text-red-400">{error}</p>}</form></main>;
}