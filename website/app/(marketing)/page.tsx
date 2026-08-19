import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  BellRing,
  BrainCircuit,
  Check,
  Copy,
  GraduationCap,
  HelpCircle,
  LineChart,
  Radar,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import WaitlistForm from '../components/waitlist-form';

const stats = [
  ['50,000+', 'Active Traders'],
  ['85%', 'Avg Win Rate'],
  ['Multi-Asset', 'Coverage'],
  ['AutoPilot', 'Enabled'],
];

const steps = [
  ['01', 'Choose your market', 'Follow forex, crypto, and equities with setups organized around the sessions you trade.'],
  ['02', 'Review the thesis', 'See the entry, invalidation, targets, and market context behind every AI signal.'],
  ['03', 'Execute with discipline', 'Use risk-aware tools and broker-ready levels to turn a signal into a structured trade.'],
];

const tools = [
  [BellRing, 'Instant Alerts', 'Get clear trade-ready notifications when an institutional setup forms.'],
  [BrainCircuit, 'AI Chart Analysis', 'Turn Forex, Crypto, and Stocks price action into a clear multi-asset market thesis.'],
  [Radar, 'Volatility Radar', 'Track volatility across Forex, Crypto, and Stocks before it changes your risk profile.'],
  [Copy, 'AutoCopy to MT5', 'Move from insight to execution with levels designed for your trading workflow.'],
  [ShieldCheck, 'Psychology Shield', 'Build a calmer process with guardrails that help prevent emotional decisions.'],
  [GraduationCap, 'Learning Hub', 'Master the setups, vocabulary, and discipline behind better trade decisions.'],
];

const comparisonRows = [
  ['Transparent setup rationale', 'Rarely included', 'Included with every signal'],
  ['Entries, targets & invalidation', 'Often fragmented', 'Unified trade plan'],
  ['Multi-market intelligence', 'Single asset class', 'Forex, crypto & equities'],
  ['Risk-aware trade workflow', 'Manual calculations', 'Built into every idea'],
];

const plans = [
  {
    name: 'Free',
    price: '$0',
    detail: 'For disciplined exploration',
    features: ['Daily market briefing', '3 signals per week', 'Learning Hub preview'],
    cta: 'Start free',
  },
  {
    name: 'Pro',
    price: '$29.99',
    detail: 'For active traders',
    features: ['Daily AI signals', 'All market coverage', 'Volatility Radar'],
    cta: 'Choose Pro',
  },
  {
    name: 'Elite',
    price: '$49.99',
    detail: 'For serious execution',
    features: ['Everything in Pro', 'Priority alerts', 'AI Chart Analysis', 'Psychology Shield'],
    cta: 'Choose Elite',
    featured: true,
  },
];

const closedTrades = [
  ['XAU/USD', 'WON', '+142 pips', 'text-[#00FFFF]'],
  ['SOL/USD', 'WON', '+8.4%', 'text-[#00FFFF]'],
  ['EUR/USD', 'WON', '+61 pips', 'text-[#00FFFF]'],
  ['NAS100', 'WON', '+227 pts', 'text-[#00FFFF]'],
];

const faqs = [
  ['What markets do you cover?', 'TradiQs AI delivers intelligence across forex, crypto, stocks, indices, and commodities — all from one mobile trading desk.'],
  ['How does AutoPilot work?', 'AutoPilot applies your risk limits and selected broker connection to approved signals. You stay in control of every execution setting.'],
  ['Are signals suitable for beginners?', 'Every setup includes entries, targets, invalidation, and clear risk context, so you can learn the process while you trade.'],
  ['Can I connect my broker?', 'Elite members can configure supported broker and exchange connections including MetaTrader, crypto exchanges, equities brokers, and prop firms.'],
  ['Is TradiQs AI financial advice?', 'No. TradiQs AI provides market intelligence and educational tools. Trading involves substantial risk and you make every final decision.'],
];

function StoreButton({ platform }: { platform: 'apple' | 'google' }) {
  const isApple = platform === 'apple';
  return (
    <button className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-700 bg-black px-4 py-3 text-left text-white transition-colors hover:border-gray-500">
      {isApple ? (
        <svg aria-hidden="true" className="h-5 w-5 fill-current" viewBox="0 0 24 24"><path d="M16.37 12.25c-.02-2.2 1.8-3.27 1.88-3.32-1.03-1.5-2.63-1.7-3.2-1.72-1.35-.14-2.65.8-3.34.8-.7 0-1.75-.78-2.9-.76-1.48.02-2.87.88-3.63 2.2-1.57 2.71-.4 6.69 1.1 8.87.75 1.07 1.62 2.27 2.77 2.23 1.12-.05 1.54-.72 2.9-.72 1.35 0 1.73.72 2.9.7 1.2-.02 1.96-1.08 2.68-2.16.86-1.23 1.2-2.44 1.22-2.5-.03-.01-2.32-.89-2.34-3.62ZM14.15 5.77c.6-.75 1.01-1.77.9-2.77-.87.04-1.96.6-2.59 1.34-.56.65-1.06 1.7-.94 2.66.98.07 1.98-.5 2.63-1.23Z" /></svg>
      ) : (
        <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24"><path fill="#4285F4" d="m3 3 10.4 9L3 21z" /><path fill="#34A853" d="m13.4 12 3.45 3-11.42 6L13.4 12z" /><path fill="#FBBC04" d="M5.43 3 16.85 9l-3.45 3z" /><path fill="#EA4335" d="m16.85 9 4.15 2.2a.9.9 0 0 1 0 1.6L16.85 15l-3.45-3z" /></svg>
      )}
      <span className="text-xs font-semibold">{isApple ? 'Download on the App Store' : 'Get it on Google Play'}</span>
    </button>
  );
}

function SignalPhone() {
  return (
    <div className="relative mx-auto flex h-[600px] w-[300px] flex-col overflow-hidden rounded-[3rem] border-[8px] border-[#1A1A1A] bg-[#0A0A0A] shadow-[0_0_50px_rgba(0,240,255,0.1)]">
      <div className="mx-auto mt-3 h-5 w-24 rounded-full bg-[#1A1A1A]" />
      <div className="flex items-center justify-between px-5 pb-4 pt-6">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-[#00F0FF]">Live signal</p>
          <p className="mt-1 text-sm font-bold text-white">Good morning, trader</p>
        </div>
        <div className="rounded-full border border-[#00F0FF]/30 bg-[#00F0FF]/10 px-2 py-1 text-[9px] font-bold text-[#00F0FF]">
          LIVE
        </div>
      </div>
      <div className="mx-4 rounded-2xl border border-[#00F0FF]/30 bg-[#00F0FF]/5 p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-bold text-white">XAU/USD</p>
            <p className="mt-1 text-[10px] text-white/45">Gold · London Session</p>
          </div>
          <span className="rounded-full bg-[#00F0FF] px-2 py-1 text-[10px] font-extrabold text-black">BUY</span>
        </div>
        <p className="mt-5 font-mono text-2xl font-bold tracking-tight text-white">2,348.60</p>
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-4 text-[9px]">
          <div><p className="text-white/40">ENTRY</p><p className="mt-1 font-semibold text-white">2345.80</p></div>
          <div><p className="text-white/40">TARGET</p><p className="mt-1 font-semibold text-[#00F0FF]">2362.00</p></div>
          <div><p className="text-white/40">RISK</p><p className="mt-1 font-semibold text-white">0.50%</p></div>
        </div>
      </div>
      <div className="mx-4 mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-center gap-2 text-[10px] font-semibold text-white">
          <Activity className="h-3.5 w-3.5 text-[#00F0FF]" /> AI MARKET THESIS
        </div>
        <p className="mt-3 text-[10px] leading-5 text-white/50">
          Liquidity sweep confirmed beneath Asia low. Momentum reclaims the opening range with a clean risk-defined invalidation.
        </p>
      </div>
      <div className="mt-auto border-t border-white/10 bg-[#0C0C0C] px-5 py-4">
        <div className="flex items-center justify-between text-[10px]">
          <span className="font-semibold text-[#00F0FF]">Signals</span>
          <span className="text-white/35">Markets</span>
          <span className="text-white/35">Journal</span>
          <span className="text-white/35">Profile</span>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="overflow-hidden bg-[#0A0A0A]">
      <section className="mx-auto grid min-h-[90vh] max-w-7xl grid-cols-1 items-center gap-12 px-6 pb-16 pt-32 lg:grid-cols-2">
        <div>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#00F0FF]/20 bg-[#00F0FF]/5 px-3 py-1.5 text-xs font-semibold text-[#00F0FF]">
            <Sparkles className="h-3.5 w-3.5" /> AI market intelligence
          </div>
          <h1 className="mb-6 text-5xl font-extrabold tracking-tight text-white md:text-7xl">
            Professional market intelligence, <span className="text-[#00FFFF]">delivered in real time.</span>
          </h1>
          <p className="mb-8 max-w-xl text-lg leading-8 text-gray-400">
            AI-driven signals for Forex, Crypto, and Stocks — built for disciplined traders who want institutional context without the noise.
          </p>
          <div className="flex flex-wrap gap-3">
            <StoreButton platform="apple" />
            <StoreButton platform="google" />
          </div>
        </div>
        <div className="flex justify-center py-6 lg:py-0">
          <SignalPhone />
        </div>
      </section>

      <section id="performance" className="border-y border-white/5 bg-[#0A0A0A] py-12">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-8 px-6 md:grid-cols-4">
          {stats.map(([value, label]) => (
            <div className="text-center" key={label}>
              <p className="text-3xl font-extrabold tracking-tight text-white md:text-4xl">{value}</p>
              <p className="mt-2 text-sm text-gray-500">{label}</p>
            </div>
          ))}
        </div>
        <div className="mx-auto mt-12 max-w-7xl border-t border-white/5 px-6 pt-10 text-center">
          <p className="text-xs font-semibold tracking-[0.16em] text-gray-600">
            USED BY TRADERS ON THE WORLD&apos;S LEADING BROKERS
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-x-12 gap-y-4 text-lg font-bold tracking-tight text-white/35">
            <span>Exness</span><span>IC Markets</span><span>XM</span>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-24">
        <div className="mb-12 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-[#00FFFF]">Live performance</p>
            <h2 className="text-4xl font-extrabold tracking-tight text-white">A trading desk that stays in motion.</h2>
          </div>
          <div className="inline-flex items-center gap-2 text-sm text-gray-400"><span className="h-2 w-2 rounded-full bg-[#00FFFF] shadow-[0_0_12px_#00FFFF]" /> Updated in real time</div>
        </div>
        <div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
          <article className="rounded-2xl border border-white/10 bg-[#111111] p-6 md:p-8">
            <div className="mb-6 flex items-center justify-between"><div><p className="text-lg font-bold text-white">Recently Closed</p><p className="mt-1 text-sm text-gray-500">Verified trade outcomes</p></div><LineChart className="h-5 w-5 text-[#00FFFF]" /></div>
            <div className="grid gap-3">{closedTrades.map(([pair, status, result, color])=><div key={pair} className="flex items-center justify-between rounded-xl border border-white/5 bg-black/30 px-4 py-4"><div className="flex items-center gap-3"><span className="h-2 w-2 rounded-full bg-[#00FFFF]" /><div><p className="font-bold text-white">{pair}</p><p className="text-xs text-gray-500">AI signal closed</p></div></div><div className="text-right"><p className={`text-xs font-extrabold tracking-wider ${color}`}>{status}</p><p className="mt-1 font-mono text-sm text-white">{result}</p></div></div>)}</div>
          </article>
          <article className="rounded-2xl border border-[#00FFFF]/20 bg-gradient-to-b from-[#00FFFF]/10 to-[#111111] p-6 md:p-8">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#00FFFF]">This week</p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-1"><div className="rounded-xl border border-white/10 bg-black/25 p-5"><p className="text-sm text-gray-400">Win Rate</p><p className="mt-3 text-4xl font-extrabold text-white">85<span className="text-[#00FFFF]">%</span></p><p className="mt-2 text-xs text-[#00FFFF]">↑ 4.2% vs last week</p></div><div className="rounded-xl border border-white/10 bg-black/25 p-5"><p className="text-sm text-gray-400">Pips Captured</p><p className="mt-3 text-4xl font-extrabold text-white">1,842</p><p className="mt-2 text-xs text-[#00FFFF]">Across 27 closed setups</p></div></div>
          </article>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-24">
        <div className="mb-12 max-w-2xl">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-[#00F0FF]">A simpler process</p>
          <h2 className="text-4xl font-extrabold tracking-tight text-white">Three steps to your first trade.</h2>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {steps.map(([number, title, description]) => (
            <article className="rounded-2xl border border-white/5 bg-[#0A0A0A] p-8" key={number}>
              <span className="text-sm font-bold text-[#00F0FF]">{number}</span>
              <h3 className="mt-10 text-xl font-bold text-white">{title}</h3>
              <p className="mt-3 leading-7 text-gray-500">{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="features" className="mx-auto max-w-7xl px-6 pb-24">
        <div className="mb-12 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-[#00F0FF]">Your trading stack</p>
            <h2 className="text-4xl font-extrabold tracking-tight text-white">Every tool a serious trader actually uses.</h2>
          </div>
          <Link href="/about" className="inline-flex cursor-pointer items-center gap-2 text-sm font-bold text-[#00F0FF] transition-colors hover:text-white">
            Explore the platform <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {tools.map(([Icon, title, description]) => {
            const ToolIcon = Icon as typeof BellRing;
            return (
              <article className="rounded-2xl border border-white/5 bg-[#0A0A0A] p-8 transition-all hover:border-[#00F0FF]/50" key={title as string}>
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#00F0FF]/20 bg-[#00F0FF]/10">
                  <ToolIcon className="h-5 w-5 text-[#00F0FF]" />
                </div>
                <h3 className="mt-7 text-lg font-bold text-white">{title as string}</h3>
                <p className="mt-3 text-sm leading-6 text-gray-500">{description as string}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-24">
        <div className="mb-12 text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-[#00F0FF]">The TradiQs difference</p>
          <h2 className="text-4xl font-extrabold tracking-tight text-white">Built for traders, not marketing decks.</h2>
        </div>
        <div className="overflow-hidden rounded-2xl border border-white/5 bg-[#0A0A0A]">
          <div className="grid grid-cols-3 border-b border-white/5 bg-white/[0.02] px-5 py-4 text-xs font-bold uppercase tracking-wide text-gray-500 md:px-7">
            <span>Capability</span><span>Typical Provider</span><span className="text-[#00F0FF]">TradiQs AI</span>
          </div>
          {comparisonRows.map(([capability, typical, tradiqs]) => (
            <div className="grid grid-cols-3 gap-3 border-b border-white/5 px-5 py-5 text-xs last:border-b-0 md:px-7 md:text-sm" key={capability}>
              <span className="font-medium text-white">{capability}</span>
              <span className="text-gray-500">{typical}</span>
              <span className="font-semibold text-[#00F0FF]">{tradiqs}</span>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-6 py-24">
        <div className="mb-12 text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-[#00F0FF]">Plans for every stage</p>
          <h2 className="text-4xl font-extrabold tracking-tight text-white">Choose your edge.</h2>
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {plans.map((plan) => (
            <article className={`flex min-h-[390px] flex-col rounded-2xl border bg-[#0A0A0A] p-8 ${plan.featured ? 'border-[#FFD700] shadow-[0_0_32px_rgba(255,215,0,0.1)]' : 'border-white/5'}`} key={plan.name}>
              {plan.featured && <span className="mb-5 w-fit rounded-full bg-[#FFD700] px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-black">Most popular</span>}
              <h3 className="text-xl font-bold text-white">{plan.name}</h3>
              <p className="mt-2 text-sm text-gray-500">{plan.detail}</p>
              <div className="mt-7 flex items-end gap-1">
                <span className="text-4xl font-extrabold tracking-tight text-white">{plan.price}</span>
                <span className="mb-1 text-sm text-gray-500">/ mo</span>
              </div>
              <ul className="mt-8 grid gap-3">
                {plan.features.map((feature) => (
                  <li className="flex items-start gap-2 text-sm text-gray-400" key={feature}>
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#00FFFF]" />{feature}
                  </li>
                ))}
              </ul>
              <button className={`mt-auto cursor-pointer rounded-lg px-4 py-3 text-sm font-bold transition-colors ${plan.featured ? 'bg-[#FFD700] text-black hover:bg-[#ffe147]' : 'border border-white/10 bg-white/5 text-white hover:border-[#00FFFF] hover:text-[#00FFFF]'}`}>
                {plan.cta}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-24">
        <div className="mb-12 text-center"><p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-[#00FFFF]">Questions, answered</p><h2 className="text-4xl font-extrabold tracking-tight text-white">Frequently asked questions.</h2></div>
        <div className="grid gap-3">{faqs.map(([question, answer])=><details key={question} className="group rounded-xl border border-white/10 bg-[#111111] p-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-bold text-white">{question}<HelpCircle className="h-5 w-5 shrink-0 text-[#00FFFF] transition-transform group-open:rotate-180" /></summary><p className="max-w-2xl pt-4 text-sm leading-7 text-gray-400">{answer}</p></details>)}</div>
      </section>

      <section id="waitlist" className="border-y border-[#FFD700]/20 bg-[#111111] px-6 py-16">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#00FFFF]">Early access</p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-white md:text-4xl">Don&apos;t miss the launch.</h2>
          <p className="mx-auto mt-4 max-w-2xl text-gray-400">Join the waitlist for launch updates and early access to TradiQs AI.</p>
          <div className="mx-auto mt-8 max-w-3xl text-left">
            <WaitlistForm />
          </div>
        </div>
      </section>

    </main>
  );
}