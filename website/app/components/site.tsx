 'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, BarChart3, Bot, BrainCircuit, ChevronDown } from 'lucide-react';

export function Navbar() {
  return <header className="sticky top-0 z-50 border-b border-white/10 bg-ink/90 backdrop-blur-xl"><div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8"><Link href="/" className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan text-sm font-black text-ink">TQ</span><span className="text-lg font-bold tracking-tight">TradiQs<span className="text-cyan">AI</span></span></Link><nav className="hidden items-center gap-7 text-sm text-muted md:flex"><Link href="/about" className="hover:text-white">About</Link><Link href="/blog" className="hover:text-white">Insights</Link><Link href="/contact" className="hover:text-white">Contact</Link><Link href="/admin" className="hover:text-white">CMS</Link></nav><Link href="/contact" className="rounded-full bg-cyan px-4 py-2 text-xs font-bold text-ink hover:bg-white">Get early access <ArrowUpRight className="ml-1 inline h-3 w-3" /></Link></div></header>;
}
export function Footer() {
  const [email, setEmail] = useState('');
  const [subscriptionMessage, setSubscriptionMessage] = useState('');

  async function subscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubscriptionMessage('');

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();

      if (!response.ok) {
        setSubscriptionMessage(data.error ?? 'Unable to subscribe right now.');
        return;
      }

      setEmail('');
      setSubscriptionMessage('You’re subscribed to market intelligence updates.');
    } catch {
      setSubscriptionMessage('Unable to subscribe right now.');
    }
  }

  const linkClass =
    'w-fit text-sm text-gray-500 transition-all duration-200 hover:text-[#00F0FF] hover:[text-shadow:0_0_12px_rgba(0,240,255,0.55)]';

  return (
    <footer className="border-t border-white/10 bg-[#070707]">
      <div className="mx-auto grid max-w-7xl gap-x-8 gap-y-12 px-6 py-16 sm:grid-cols-2 lg:grid-cols-[1.7fr_0.8fr_1.15fr_0.8fr_0.65fr] lg:px-8">
        <section className="sm:col-span-2 lg:col-span-1">
          <Link href="/" className="inline-flex items-center gap-3 text-white">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#00F0FF]/30 bg-[#00F0FF]/10 text-xs font-black text-[#00F0FF]">TQ</span>
            <span className="text-lg font-bold tracking-tight">TradiQs<span className="text-[#00F0FF]">AI</span></span>
          </Link>
          <p className="mt-5 max-w-sm text-sm leading-6 text-gray-500">
            Institutional-grade market intelligence for traders who refuse to guess.
          </p>
          <form onSubmit={subscribe} className="mt-6 max-w-sm border-b border-white/15 transition-colors focus-within:border-[#00F0FF]">
            <label className="sr-only" htmlFor="footer-newsletter-email">Email address</label>
            <div className="flex items-center gap-3">
              <input
                id="footer-newsletter-email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Market intelligence, delivered"
                className="min-w-0 flex-1 bg-transparent py-3 text-sm text-white outline-none placeholder:text-gray-600"
              />
              <button type="submit" className="py-3 text-xs font-bold uppercase tracking-[0.16em] text-[#00F0FF] transition hover:[text-shadow:0_0_12px_rgba(0,240,255,0.7)]">
                Subscribe
              </button>
            </div>
          </form>
          {subscriptionMessage && <p role="status" className="mt-3 text-xs text-[#00F0FF]">{subscriptionMessage}</p>}
        </section>

        <FooterColumn title="Platform">
          <Link href="/#features" className={linkClass}>Features</Link>
          <Link href="/#pricing" className={linkClass}>Pricing</Link>
          <Link href="/about" className={linkClass}>About</Link>
        </FooterColumn>
        <FooterColumn title="Brokers">
          {['MetaTrader 4', 'MetaTrader 5', 'cTrader', 'Exness', 'Binance', 'Bybit', 'Interactive Brokers', 'Webull', 'FTMO', 'Topstep'].map((broker) => (
            <span className={linkClass} key={broker}>{broker}</span>
          ))}
        </FooterColumn>
        <FooterColumn title="Resources">
          <Link href="/blog" className={linkClass}>Blog</Link>
          <Link href="/contact" className={linkClass}>Contact</Link>
          <Link href="/#waitlist" className={linkClass}>Waitlist</Link>
        </FooterColumn>
        <FooterColumn title="Legal">
          <Link href="/privacy" className={linkClass}>Privacy</Link>
          <Link href="/terms" className={linkClass}>Terms</Link>
        </FooterColumn>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-5 text-xs text-gray-600 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <span>© 2026 TradiQs AI</span>
          <span className="flex items-center gap-2 text-gray-500">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_9px_rgba(74,222,128,0.9)]" aria-hidden="true" />
            API Status: Operational
          </span>
        </div>
      </div>
      <div className="border-t border-white/5 bg-black/20 px-6 py-4 text-center text-[10px] leading-5 text-gray-600">
        Risk disclaimer: Trading leveraged products and digital assets carries a high level of risk and may not be suitable for all investors. Historical performance is not indicative of future results. TradiQs AI does not provide investment advice.
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="mb-5 text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">{title}</p>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}
export function SectionTitle({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) { return <div className="mb-10 max-w-2xl"><p className="mb-3 text-xs font-bold uppercase tracking-[.25em] text-cyan">{eyebrow}</p><h2 className="text-3xl font-bold tracking-tight md:text-5xl">{title}</h2><p className="mt-4 leading-7 text-muted">{copy}</p></div>; }
export const toolCards = [{ icon: BrainCircuit, title: 'AI Signal Generator', copy: 'Turn a chart into a high-conviction BUY or SELL thesis with clear entries, targets, and invalidation.' }, { icon: Bot, title: 'AutoPilot Bots', copy: 'Deploy disciplined GRID and DCA strategies that keep working while you focus on the bigger picture.' }, { icon: BarChart3, title: 'Risk Management', copy: 'Size every position with institutional discipline. Know your downside before the market moves.' }];
export function Faqs() { const faqs = ['How accurate are the AI Signals?', 'What brokers do you support?', 'Is TradiQs AI suitable for beginners?', 'Does AutoPilot trade with real money?']; return <div className="grid gap-3">{faqs.map((q) => <details key={q} className="glass group rounded-2xl p-5"><summary className="flex cursor-pointer list-none items-center justify-between font-semibold">{q}<ChevronDown className="h-4 w-4 text-cyan transition group-open:rotate-180" /></summary><p className="mt-3 text-sm leading-6 text-muted">TradiQs AI combines market structure, momentum, liquidity, and risk context into a transparent simulated trading workflow. Always validate ideas and manage your own risk.</p></details>)}</div>; }