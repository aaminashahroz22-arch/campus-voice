"use client";
// Campus Voice — single-file React/Next.js (App Router) client component.
// Requires: tailwindcss, lucide-react. Set NEXT_PUBLIC_API_URL to talk to the FastAPI backend;
// without it (or if it is unreachable) the app runs fully on local mock state.

import React, { useMemo, useState } from "react";
import {
  ThumbsUp, MapPin, Plus, Shield, LayoutList, CheckCircle2, Clock, Flame,
  Wifi, Wrench, Droplets, Armchair, Zap, ImagePlus, X, AlertTriangle, BarChart3,
} from "lucide-react";

/* ───────────── Types & constants ───────────── */
type Status = "Open" | "In Progress" | "Resolved";
type Priority = "Low" | "Medium" | "Critical";
type Category = "Lab Equipment" | "Network" | "Sanitation" | "Classroom" | "Electrical";

interface Issue {
  id: number;
  title: string;
  category: Category;
  location: string;
  description: string;
  priority: Priority;
  status: Status;
  upvotes: number;
  recentUpvotes: number; // upvotes in the last 24h (drives "velocity")
  createdAt: number;
  resolvedAt?: number;
}

const API = process.env.NEXT_PUBLIC_API_URL;
const CATEGORIES: Category[] = ["Lab Equipment", "Network", "Sanitation", "Classroom", "Electrical"];
const BLOCKS = ["Block A", "Block B", "Block C", "Library"];
const NEXT_STATUS: Record<Status, Status> = { Open: "In Progress", "In Progress": "Resolved", Resolved: "Open" };
const HOUR = 3_600_000;

const catIcon: Record<Category, React.ReactNode> = {
  "Lab Equipment": <Wrench size={14} />, Network: <Wifi size={14} />, Sanitation: <Droplets size={14} />,
  Classroom: <Armchair size={14} />, Electrical: <Zap size={14} />,
};
const statusStyle: Record<Status, string> = {
  Open: "bg-amber-100 text-amber-800 ring-amber-200",
  "In Progress": "bg-indigo-100 text-indigo-800 ring-indigo-200",
  Resolved: "bg-emerald-100 text-emerald-800 ring-emerald-200",
};
const prioStyle: Record<Priority, string> = {
  Low: "text-slate-500", Medium: "text-amber-600", Critical: "text-red-600",
};

const now = Date.now();
const SEED: Issue[] = [
  { id: 1, title: "Oscilloscopes in EE Lab not powering on", category: "Lab Equipment", location: "Block B - Room 302", description: "4 of 10 units are dead since Monday.", priority: "Critical", status: "Open", upvotes: 42, recentUpvotes: 18, createdAt: now - 30 * HOUR },
  { id: 2, title: "Wi-Fi drops every few minutes", category: "Network", location: "Library - Floor 2", description: "Disconnects make online submissions risky.", priority: "Medium", status: "In Progress", upvotes: 87, recentUpvotes: 9, createdAt: now - 70 * HOUR },
  { id: 3, title: "Washroom tap leaking continuously", category: "Sanitation", location: "Block A - Ground Floor", description: "Water pooling in the corridor.", priority: "Medium", status: "Open", upvotes: 15, recentUpvotes: 11, createdAt: now - 6 * HOUR },
  { id: 4, title: "Projector bulb flickering", category: "Classroom", location: "Block C - Room 105", description: "Unusable during afternoon lectures.", priority: "Low", status: "Resolved", upvotes: 23, recentUpvotes: 0, createdAt: now - 120 * HOUR, resolvedAt: now - 3 * HOUR },
];

/* ───────────── Helpers ───────────── */
// Trending score: recent upvote rate, decayed by age so new, fast-rising issues beat old, slow ones.
const velocity = (i: Issue) => (i.recentUpvotes + 1) / Math.pow((now - i.createdAt) / HOUR + 2, 0.5);
const ago = (t: number) => {
  const h = Math.max(1, Math.round((Date.now() - t) / HOUR));
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};
// Fire-and-forget API call; the UI is optimistic and works offline with mock data.
async function api(path: string, init?: RequestInit) {
  if (!API) return;
  try {
    await fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json", "X-Voter-Id": voterId(), ...(init?.headers || {}) } });
  } catch { /* offline: keep local state */ }
}
function voterId() {
  try {
    let v = localStorage.getItem("cv_voter");
    if (!v) { v = crypto.randomUUID(); localStorage.setItem("cv_voter", v); }
    return v;
  } catch { return "anon"; }
}

/* ───────────── Issue card (also used for live preview) ───────────── */
function IssueCard({ issue, voted, onUpvote, preview }: { issue: Issue; voted?: boolean; onUpvote?: () => void; preview?: boolean }) {
  return (
    <article className="group rounded-2xl border border-white/60 bg-white/80 p-5 shadow-sm shadow-slate-900/5 backdrop-blur-xl transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
          {catIcon[issue.category]} {issue.category}
        </span>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusStyle[issue.status]}`}>{issue.status}</span>
      </div>
      <h3 className="mt-3 text-base font-semibold text-slate-900">{issue.title || "Your issue title…"}</h3>
      {issue.description && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{issue.description}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1"><MapPin size={13} />{issue.location || "Location"}</span>
        <span className={`inline-flex items-center gap-1 font-medium ${prioStyle[issue.priority]}`}>
          {issue.priority === "Critical" && <AlertTriangle size={13} />}{issue.priority}
        </span>
        <span className="inline-flex items-center gap-1"><Clock size={13} />{preview ? "just now" : ago(issue.createdAt)}</span>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <button
          disabled={preview}
          onClick={onUpvote}
          aria-pressed={voted}
          className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition active:scale-95 ${
            voted ? "bg-indigo-600 text-white" : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
          } disabled:opacity-60`}
        >
          <ThumbsUp size={15} /> {voted ? "You're affected" : "I'm also facing this"} · {issue.upvotes}
        </button>
        {!preview && issue.recentUpvotes >= 8 && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600"><Flame size={14} />Trending</span>
        )}
      </div>
    </article>
  );
}

/* ───────────── Report form with live preview ───────────── */
function ReportForm({ onSubmit, onClose }: { onSubmit: (i: Issue) => void; onClose: () => void }) {
  const [f, setF] = useState({ title: "", category: "Lab Equipment" as Category, location: "", description: "", priority: "Medium" as Priority });
  const [fileName, setFileName] = useState("");
  const draft: Issue = { id: 0, ...f, status: "Open", upvotes: 1, recentUpvotes: 1, createdAt: Date.now() };
  const valid = f.title.trim().length >= 5 && f.location.trim();
  const input = "w-full rounded-xl border border-slate-200 bg-white/90 px-3 py-2.5 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Report an issue">
      <div className="grid max-h-[92vh] w-full max-w-4xl gap-6 overflow-y-auto rounded-t-3xl bg-slate-50 p-6 shadow-2xl sm:rounded-3xl md:grid-cols-2">
        <form
          className="space-y-4"
          onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit(draft); }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-900">Report an issue</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200"><X size={18} /></button>
          </div>
          <label className="block text-sm font-medium text-slate-700">Title
            <input className={`${input} mt-1`} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Projector not working" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-slate-700">Category
              <select className={`${input} mt-1`} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as Category })}>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700">Priority
              <select className={`${input} mt-1`} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Priority })}>
                {["Low", "Medium", "Critical"].map((p) => <option key={p}>{p}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-sm font-medium text-slate-700">Location
            <input className={`${input} mt-1`} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Block B - Room 302" />
          </label>
          <label className="block text-sm font-medium text-slate-700">Description
            <textarea rows={3} className={`${input} mt-1`} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What's wrong, and since when?" />
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white/70 px-3 py-3 text-sm text-slate-500 hover:border-indigo-400">
            <ImagePlus size={18} /> {fileName || "Attach a photo (placeholder)"}
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")} />
          </label>
          <button disabled={!valid} className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/30 transition hover:bg-indigo-700 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50">
            Submit report
          </button>
        </form>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Live preview</p>
          <IssueCard issue={draft} preview />
          <p className="mt-3 text-xs text-slate-500">Tip: search the feed first — if it's already reported, upvote instead of creating a duplicate.</p>
        </div>
      </div>
    </div>
  );
}

/* ───────────── Admin dashboard ───────────── */
function AdminPanel({ issues, onAdvance }: { issues: Issue[]; onAdvance: (id: number) => void }) {
  const dayAgo = Date.now() - 24 * HOUR;
  const resolved = issues.filter((i) => i.resolvedAt);
  const avgHrs = resolved.length ? resolved.reduce((s, i) => s + (i.resolvedAt! - i.createdAt) / HOUR, 0) / resolved.length : 0;
  const stats = [
    { label: "Total Issues", value: issues.length, icon: <LayoutList size={18} /> },
    { label: "Resolved Today", value: resolved.filter((i) => i.resolvedAt! > dayAgo).length, icon: <CheckCircle2 size={18} /> },
    { label: "Avg. Resolution (hrs)", value: avgHrs.toFixed(1), icon: <BarChart3 size={18} /> },
  ];
  return (
    <section aria-label="Admin dashboard" className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-white/10 bg-slate-800/70 p-5 text-white backdrop-blur-xl">
            <div className="flex items-center gap-2 text-sm text-slate-300">{s.icon}{s.label}</div>
            <div className="mt-2 text-3xl font-bold">{s.value}</div>
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-2xl bg-white/90 shadow-sm backdrop-blur-xl">
        {issues.map((i) => (
          <div key={i.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 last:border-0">
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-900">{i.title}</p>
              <p className="text-xs text-slate-500">{i.location} · {i.upvotes} affected · {i.priority}</p>
            </div>
            <button onClick={() => onAdvance(i.id)} className={`rounded-xl px-3.5 py-2 text-xs font-semibold ring-1 transition active:scale-95 hover:brightness-95 ${statusStyle[i.status]}`}>
              {i.status} → {NEXT_STATUS[i.status]}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ───────────── App ───────────── */
export default function App() {
  const [issues, setIssues] = useState<Issue[]>(SEED);
  const [voted, setVoted] = useState<Set<number>>(new Set());
  const [tab, setTab] = useState<"All" | "Trending" | "Near Me" | "Resolved">("All");
  const [cat, setCat] = useState<"All" | Category>("All");
  const [myBlock, setMyBlock] = useState("Block B");
  const [admin, setAdmin] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const upvote = (id: number) => {
    if (voted.has(id)) return; // one vote per user; server enforces via unique (issue_id, voter_id)
    setVoted(new Set(voted).add(id));
    setIssues((xs) => xs.map((i) => (i.id === id ? { ...i, upvotes: i.upvotes + 1, recentUpvotes: i.recentUpvotes + 1 } : i)));
    api(`/upvote/${id}`, { method: "POST" });
  };
  const advance = (id: number) => {
    const target = NEXT_STATUS[issues.find((i) => i.id === id)!.status];
    setIssues((xs) => xs.map((i) => (i.id === id ? { ...i, status: target, resolvedAt: target === "Resolved" ? Date.now() : undefined } : i)));
    api(`/status/${id}`, { method: "PATCH", body: JSON.stringify({ status: target }), headers: { "X-Admin-Token": "demo" } });
  };
  const create = (draft: Issue) => {
    const issue = { ...draft, id: Date.now() };
    setIssues((xs) => [issue, ...xs]);
    setVoted((v) => new Set(v).add(issue.id));
    setShowForm(false);
    api("/issues", { method: "POST", body: JSON.stringify(draft) });
  };

  const feed = useMemo(() => {
    let xs = issues.filter((i) => cat === "All" || i.category === cat);
    if (tab === "Resolved") xs = xs.filter((i) => i.status === "Resolved");
    else xs = xs.filter((i) => i.status !== "Resolved" || tab === "All");
    if (tab === "Near Me") xs = xs.filter((i) => i.location.startsWith(myBlock));
    return [...xs].sort((a, b) => (tab === "Trending" || tab === "All" ? velocity(b) - velocity(a) : b.createdAt - a.createdAt));
  }, [issues, tab, cat, myBlock]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-900/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <h1 className="text-lg font-bold tracking-tight text-white">Campus<span className="text-indigo-400">Voice</span></h1>
          <div className="flex items-center gap-2">
            <button onClick={() => setAdmin(!admin)} className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition active:scale-95 ${admin ? "bg-white text-slate-900" : "text-slate-200 hover:bg-white/10"}`}>
              <Shield size={15} /> Admin
            </button>
            <button onClick={() => setShowForm(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-600/40 transition hover:bg-indigo-500 active:scale-95">
              <Plus size={16} /> Report
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        {admin ? (
          <AdminPanel issues={issues} onAdvance={advance} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div role="tablist" className="flex rounded-2xl bg-white/10 p-1 backdrop-blur">
                {(["All", "Trending", "Near Me", "Resolved"] as const).map((t) => (
                  <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                    className={`rounded-xl px-3.5 py-1.5 text-sm font-medium transition ${tab === t ? "bg-white text-slate-900 shadow" : "text-slate-200 hover:bg-white/10"}`}>
                    {t}
                  </button>
                ))}
              </div>
              <select aria-label="Filter by category" value={cat} onChange={(e) => setCat(e.target.value as any)} className="rounded-xl border-0 bg-white/90 px-3 py-2 text-sm">
                <option value="All">All categories</option>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
              {tab === "Near Me" && (
                <select aria-label="My block" value={myBlock} onChange={(e) => setMyBlock(e.target.value)} className="rounded-xl border-0 bg-white/90 px-3 py-2 text-sm">
                  {BLOCKS.map((b) => <option key={b}>{b}</option>)}
                </select>
              )}
            </div>
            {feed.length === 0 ? (
              <p className="rounded-2xl bg-white/10 p-10 text-center text-slate-300">Nothing here. Campus is running smoothly — or be the first to report.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {feed.map((i) => <IssueCard key={i.id} issue={i} voted={voted.has(i.id)} onUpvote={() => upvote(i.id)} />)}
              </div>
            )}
          </>
        )}
      </main>
      {showForm && <ReportForm onSubmit={create} onClose={() => setShowForm(false)} />}
    </div>
  );
}
