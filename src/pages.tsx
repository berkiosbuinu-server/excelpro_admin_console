import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errMsg, fmtDate, fmtSize, money, saveBlob, type Analysis, type Conversation, type Order, type Payment, type ReportRow } from "./api";
import { OrderStudioBlock } from "./studio";
import { Empty, Modal, PAY_STATUS, PLATFORMS, Pill, PROVIDERS, ProofView, PURPOSE, STATUS } from "./ui";

export type Data = { orders: Order[]; convs: Conversation[]; reload: () => Promise<void> };
type Row = Payment & { order: Order };
const flatPayments = (orders: Order[]): Row[] =>
  orders.flatMap((o) => o.payments.map((p) => ({ ...p, order: o }))).sort((a, b) => b.created_at.localeCompare(a.created_at));

/* ---------------- Tableau de bord ---------------- */
export function Dashboard({ data, go }: { data: Data; go: (p: string) => void }) {
  const pays = flatPayments(data.orders);
  const pending = pays.filter((p) => p.status === "pending");
  const revenue = pays.filter((p) => p.status === "succeeded").reduce((s, p) => s + p.amount_cents, 0);
  const unread = data.convs.reduce((n, c) => n + c.unread, 0);
  const files = data.orders.length;
  const kpis: [string, string | number, string, string][] = [
    ["Commandes", data.orders.length, "orders", ""],
    ["Paiements à valider", pending.length, "payments", pending.length ? "alert" : ""],
    ["Messages non lus", unread, "messages", unread ? "alert" : ""],
    ["Revenus confirmés", money(revenue), "payments", ""],
    ["Fichiers reçus", files, "files", ""],
  ];
  const lastMsgs = data.convs.slice(0, 5);
  return (
    <>
      <h1>Tableau de bord</h1>
      <div className="kpis">
        {kpis.map(([l, v, to, cls]) => (
          <button key={l} className={`kpi ${cls}`} onClick={() => go(to)}><span>{l}</span><strong>{v}</strong></button>
        ))}
      </div>
      <div className="two-col">
        <section className="card">
          <h2>Paiements en attente</h2>
          {pending.length === 0 && <Empty>Rien à valider.</Empty>}
          {pending.slice(0, 5).map((p) => (
            <button className="line" key={p.id} onClick={() => go("payments")}>
              <span><strong>{money(p.amount_cents)}</strong> · {PROVIDERS[p.provider] ?? p.provider}<br /><small>{p.order.user_email} · {p.order.app_name}</small></span>
              <small>{fmtDate(p.created_at)}</small>
            </button>
          ))}
        </section>
        <section className="card">
          <h2>Derniers messages</h2>
          {lastMsgs.length === 0 && <Empty>Aucun message.</Empty>}
          {lastMsgs.map((c) => (
            <button className="line" key={c.user_id ?? c.email} onClick={() => go("messages")}>
              <span><strong>{c.name ?? c.email}</strong> {c.unread > 0 && <b className="dot">{c.unread}</b>}<br /><small>{c.messages[c.messages.length - 1]?.body.slice(0, 80)}</small></span>
              <small>{fmtDate(c.last_at)}</small>
            </button>
          ))}
        </section>
      </div>
    </>
  );
}

/* ---------------- Commandes ---------------- */
export function Orders({ data }: { data: Data }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<Order | null>(null);
  const rows = useMemo(() => data.orders.filter((o) =>
    (!status || o.status === status) &&
    `${o.app_name} ${o.user_email} ${o.original_filename} #${o.id}`.toLowerCase().includes(q.toLowerCase())), [data.orders, q, status]);
  const current = open && data.orders.find((o) => o.id === open.id);
  return (
    <>
      <h1>Commandes</h1>
      <div className="filters">
        <input type="search" placeholder="Rechercher (client, application, fichier…)" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous les statuts</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {rows.length === 0 && <Empty>Aucune commande.</Empty>}
      <div className="list">
        {rows.map((o) => (
          <button className="item" key={o.id} onClick={() => setOpen(o)}>
            <div className="item-main">
              <strong>#{o.id} · {o.app_name}</strong>
              <small>{o.user_email} · {o.original_filename}</small>
              <div className="tags">{o.platforms.map((p) => <span className="tag" key={p}>{PLATFORMS[p] ?? p}</span>)}</div>
            </div>
            <div className="item-side">
              <Pill kind={o.status === "ready" ? "ok" : o.status === "submitted" ? "warn" : "info"}>{STATUS[o.status]}</Pill>
              <small>{o.total_usd} $ · {fmtDate(o.created_at)}</small>
            </div>
          </button>
        ))}
      </div>
      {current && <OrderDetail order={current} onClose={() => setOpen(null)} />}
    </>
  );
}

function RuntimeBlock({ r }: { r: NonNullable<Analysis["runtime"]> }) {
  if (!r.available) return <><h3>Vérification runtime</h3><p className="warnline">⚠ Non réalisée : {r.error ?? "indisponible"}</p></>;
  const f = r.formulas;
  return (
    <>
      <h3>Vérification runtime (sans Excel)</h3>
      {f && (
        <div className="tags">
          <span className="tag">{f.evaluated}/{f.total} formule(s) recalculée(s) ({Math.round(f.coverage_pct)} %)</span>
          <span className="tag">{f.matched} identique(s) à Excel ({Math.round(f.fidelity_pct)} %)</span>
          {f.mismatched > 0 && <span className="tag warn">{f.mismatched} écart(s)</span>}
          {f.circular > 0 && <span className="tag warn">{f.circular} circulaire(s)</span>}
          {r.macros?.present && <span className="tag warn">Macros détectées, non exécutées</span>}
        </div>
      )}
      {(r.unsupported_functions?.length ?? 0) > 0 && <p className="warnline">⚠ Fonctions non gérées : {r.unsupported_functions!.join(", ")}</p>}
      {(r.volatile_functions?.length ?? 0) > 0 && <small>Volatiles : {r.volatile_functions!.join(", ")}</small>}
      {r.mismatches?.slice(0, 5).map((m) => <p className="warnline" key={m.sheet + m.cell}>≠ {m.sheet}!{m.cell} {m.formula} : Excel {m.expected}, runtime {m.computed}</p>)}
    </>
  );
}

function OrderDetail({ order: o, onClose }: { order: Order; onClose: () => void }) {
  const [err, setErr] = useState("");
  const a = o.analysis;
  const download = () => api.sourceBlob(o.id).then((b) => saveBlob(b, o.original_filename)).catch((e) => setErr(errMsg(e)));
  return (
    <Modal title={`Commande #${o.id} — ${o.app_name}`} onClose={onClose} wide>
      <dl className="facts">
        <div><dt>Client</dt><dd>{o.user_email}</dd></div>
        <div><dt>Statut</dt><dd>{STATUS[o.status]}</dd></div>
        <div><dt>Plateformes</dt><dd>{o.platforms.map((p) => PLATFORMS[p] ?? p).join(", ")}</dd></div>
        <div><dt>Conversion</dt><dd>{o.total_usd} $ — {o.paid ? "payée" : "non payée"}</dd></div>
        <div><dt>Vérification</dt><dd>{money(o.check_fee_cents)} — {o.check_paid ? "payée" : "à payer"}</dd></div>
        <div><dt>Reçue le</dt><dd>{fmtDate(o.created_at)}</dd></div>
        {o.claim_key && <div><dt>Clé de récupération</dt><dd><code>{o.claim_key}</code>{o.claim_expires_at ? ` · retrait jusqu’au ${fmtDate(o.claim_expires_at)}` : " · délai non démarré"}</dd></div>}
      </dl>
      <h3>Fichier Excel</h3>
      <div className="line static"><span>{o.original_filename}<br /><small>{fmtSize(a?.file_size_bytes)}</small></span><button className="btn" onClick={download}>Télécharger</button></div>
      {a && (
        <div className="tags">
          <span className="tag">{a.sheet_count ?? 0} feuille(s)</span><span className="tag">{a.formula_count ?? 0} formule(s)</span>
          {a.has_vba && <span className="tag warn">VBA · {a.vba_procedures ?? "?"} procédure(s)</span>}
          {(a.vba_forms?.length ?? 0) > 0 && <span className="tag">{a.vba_forms!.length} UserForm(s)</span>}
        </div>
      )}
      <OrderStudioBlock orderId={o.id} />
      {a?.runtime && <RuntimeBlock r={a.runtime} />}
      {a?.warnings?.map((w) => <p className="warnline" key={w}>⚠ {w}</p>)}
      {o.check_report && <><h3>Rapport final des experts</h3><p>{o.check_report.summary}</p><small>{o.check_report.tested_on}</small></>}
      {o.deliveries.length > 0 && <><h3>Livrables</h3>{o.deliveries.map((d) => <div className="line static" key={d.id}><span>{PLATFORMS[d.platform] ?? d.platform} — {d.filename}</span></div>)}</>}
      <h3>Paiements</h3>
      {o.payments.length === 0 && <small>Aucun paiement.</small>}
      {o.payments.map((p) => (
        <div className="line static" key={p.id}>
          <span>{PURPOSE[p.purpose]} · {money(p.amount_cents)} · {PROVIDERS[p.provider] ?? p.provider}{p.reference ? ` · ${p.reference}` : ""}</span>
          <Pill kind={p.status === "succeeded" ? "ok" : p.status === "failed" ? "bad" : "warn"}>{PAY_STATUS[p.status]}</Pill>
        </div>
      ))}
      {err && <p className="error">{err}</p>}
    </Modal>
  );
}

/* ---------------- Fichiers ---------------- */
export function Files({ data }: { data: Data }) {
  const [tab, setTab] = useState<"src" | "out">("src");
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const src = data.orders.filter((o) => `${o.original_filename} ${o.user_email} ${o.app_name}`.toLowerCase().includes(q.toLowerCase()));
  const out = data.orders.flatMap((o) => o.deliveries.map((d) => ({ d, o })));
  const total = data.orders.reduce((s, o) => s + (o.analysis?.file_size_bytes ?? 0), 0);
  return (
    <>
      <h1>Fichiers</h1>
      <div className="tabs">
        <button className={tab === "src" ? "on" : ""} onClick={() => setTab("src")}>Classeurs reçus ({data.orders.length})</button>
        <button className={tab === "out" ? "on" : ""} onClick={() => setTab("out")}>Livrables ({out.length})</button>
      </div>
      {err && <p className="error">{err}</p>}
      {tab === "src" && (
        <>
          <div className="filters"><input type="search" placeholder="Rechercher un fichier ou un client…" value={q} onChange={(e) => setQ(e.target.value)} /><small>Total : {fmtSize(total)}</small></div>
          {src.length === 0 && <Empty>Aucun fichier.</Empty>}
          <div className="list">
            {src.map((o) => (
              <div className="item" key={o.id}>
                <div className="item-main">
                  <strong>📗 {o.original_filename}</strong>
                  <small>{o.user_email} · commande #{o.id} · {o.app_name}</small>
                  <div className="tags">
                    <span className="tag">{fmtSize(o.analysis?.file_size_bytes)}</span>
                    <span className="tag">{o.analysis?.sheet_count ?? 0} feuille(s)</span>
                    <span className="tag">{o.analysis?.formula_count ?? 0} formule(s)</span>
                    {o.analysis?.has_vba && <span className="tag warn">VBA</span>}
                  </div>
                </div>
                <div className="item-side"><small>{fmtDate(o.created_at)}</small>
                  <button className="btn" onClick={() => api.sourceBlob(o.id).then((b) => saveBlob(b, o.original_filename)).catch((e) => setErr(errMsg(e)))}>Télécharger</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {tab === "out" && (
        <div className="list">
          {out.length === 0 && <Empty>Aucun livrable déposé.</Empty>}
          {out.map(({ d, o }) => (
            <div className="item" key={d.id}>
              <div className="item-main"><strong>📦 {d.filename}</strong><small>{PLATFORMS[d.platform] ?? d.platform} · commande #{o.id} · {o.user_email}</small></div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------------- Paiements & captures ---------------- */
export function Payments({ data }: { data: Data }) {
  const [filter, setFilter] = useState<"pending" | "all" | "succeeded" | "failed">("pending");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const all = flatPayments(data.orders);
  const rows = all.filter((p) => filter === "all" || p.status === filter);
  const decide = async (p: Row, action: "confirm" | "reject") => {
    const verb = action === "confirm" ? "CONFIRMER" : "REJETER";
    if (!window.confirm(`${verb} le paiement de ${money(p.amount_cents)} (${p.order.user_email}) ?\nVérifiez que la capture correspond bien au montant et au numéro.`)) return;
    setErr(""); setBusy(p.id);
    try { await api.decide(p.id, action); await data.reload(); } catch (e) { setErr(errMsg(e)); }
    setBusy(null);
  };
  const count = (s: string) => all.filter((p) => p.status === s).length;
  return (
    <>
      <h1>Paiements &amp; captures</h1>
      <div className="tabs">
        {([["pending", `À valider (${count("pending")})`], ["succeeded", "Confirmés"], ["failed", "Rejetés"], ["all", "Tous"]] as const).map(([k, l]) => (
          <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      {err && <p className="error">{err}</p>}
      {rows.length === 0 && <Empty>Aucun paiement dans cette catégorie.</Empty>}
      <div className="pay-grid">
        {rows.map((p) => (
          <article className="card pay" key={p.id}>
            <header>
              <strong className="amount">{money(p.amount_cents)}</strong>
              <Pill kind={p.status === "succeeded" ? "ok" : p.status === "failed" ? "bad" : "warn"}>{PAY_STATUS[p.status]}</Pill>
            </header>
            <dl className="facts compact">
              <div><dt>Client</dt><dd>{p.order.user_email}</dd></div>
              <div><dt>Commande</dt><dd>#{p.order.id} · {p.order.app_name}</dd></div>
              <div><dt>Objet</dt><dd>{PURPOSE[p.purpose]}</dd></div>
              <div><dt>Moyen</dt><dd>{PROVIDERS[p.provider] ?? p.provider}</dd></div>
              {p.phone && <div><dt>Numéro d'envoi</dt><dd>{p.phone}</dd></div>}
              {p.reference && <div><dt>Référence</dt><dd><code>{p.reference}</code></dd></div>}
              <div><dt>Date</dt><dd>{fmtDate(p.created_at)}</dd></div>
            </dl>
            {p.has_proof ? <ProofView paymentId={p.id} /> : p.provider !== "stripe" ? <div className="proof missing">Pas de capture jointe</div> : null}
            {p.status === "pending" && p.provider !== "stripe" && (
              <div className="actions">
                <button className="btn primary" disabled={busy === p.id} onClick={() => decide(p, "confirm")}>Confirmer</button>
                <button className="btn danger" disabled={busy === p.id} onClick={() => decide(p, "reject")}>Rejeter</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </>
  );
}

/* ---------------- Messages ---------------- */
export function Messages({ data }: { data: Data }) {
  const [sel, setSel] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const key = (c: Conversation) => (c.user_id ? `u${c.user_id}` : `e${c.email}`);
  const conv = data.convs.find((c) => key(c) === sel) ?? null;

  const open = async (c: Conversation) => {
    setSel(key(c)); setText(""); setErr("");
    if (c.user_id && c.unread) { try { await api.markRead(c.user_id); await data.reload(); } catch { /* sans gravité */ } }
  };
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!conv?.user_id || !text.trim()) return;
    setErr("");
    try { await api.reply(conv.user_id, text.trim()); setText(""); await data.reload(); } catch (x) { setErr(errMsg(x)); }
  };
  return (
    <>
      <h1>Messages</h1>
      <div className={`split ${conv ? "has-sel" : ""}`}>
        <div className="convlist">
          {data.convs.length === 0 && <Empty>Aucun message.</Empty>}
          {data.convs.map((c) => (
            <button key={key(c)} className={`conv ${sel === key(c) ? "on" : ""}`} onClick={() => open(c)}>
              <span><strong>{c.name ?? c.email}</strong>{c.name && <small> · {c.email}</small>}<br /><small>{c.messages[c.messages.length - 1]?.body.slice(0, 60)}</small></span>
              <span className="conv-meta">{c.unread > 0 && <b className="dot">{c.unread}</b>}<small>{fmtDate(c.last_at)}</small></span>
            </button>
          ))}
        </div>
        <div className="thread">
          {!conv && <Empty>Sélectionnez une conversation.</Empty>}
          {conv && (
            <>
              <div className="thread-head"><button className="icon back" onClick={() => setSel(null)} aria-label="Retour">←</button><strong>{conv.name ?? conv.email}</strong><small>{conv.name ? conv.email : conv.user_id ? "Client" : "Visiteur"}</small></div>
              <div className="bubbles">
                {conv.messages.map((m) => <div key={m.id} className={`bubble ${m.from_admin ? "me" : "them"}`}>{m.body}<small>{fmtDate(m.created_at)}</small></div>)}
              </div>
              {conv.user_id ? (
                <form className="reply" onSubmit={send}>
                  <textarea rows={2} placeholder="Votre réponse…" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} />
                  <button className="btn primary" type="submit">Répondre</button>
                </form>
              ) : <p className="note">Visiteur non connecté : répondez par e-mail à <a href={`mailto:${conv.email}`}>{conv.email}</a>.</p>}
              {err && <p className="error">{err}</p>}
            </>
          )}
        </div>
      </div>
    </>
  );
}


/* ---------------- Rapports du vérificateur automatique ---------------- */
const LEVEL: Record<string, [string, string]> = {
  ok: ["Aucun point bloquant", "ok"], review: ["À vérifier", "warn"], risk: ["Points sensibles", "bad"],
};
const VERDICT: Record<string, string> = {
  convertible: "Convertible", convertible_with_changes: "Convertible après adaptations", not_convertible: "Non convertible",
};
/** Niveau automatique et verdict de l'expert sont-ils cohérents ? (« risk » attend un verdict moins favorable). */
function agreement(level: ReportRow["level"], verdict: string | null): [string, string] | null {
  if (!level || !verdict) return null;
  const expected = level === "ok" ? "convertible" : level === "risk" ? "convertible_with_changes" : null;
  if (level === "ok" && verdict === "convertible") return ["Concordant", "ok"];
  if (level === "risk" && verdict !== "convertible") return ["Concordant", "ok"];
  if (level === "ok") return ["À comparer : l'expert est plus sévère", "warn"];
  if (level === "risk" && verdict === "convertible") return ["À comparer : l'expert est plus indulgent", "warn"];
  return expected === null ? ["Niveau intermédiaire", "warn"] : null;
}

export function Reports({ data }: { data: Data }) {
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const load = useCallback(() => api.reports().then((r) => { setRows(r); setErr(""); }).catch((e) => setErr(errMsg(e))), []);
  useEffect(() => { load(); }, [load, data.orders]);

  const open = async (id: number, regenerate = false) => {
    setBusy(id); setErr("");
    const win = window.open("", "_blank"); // ouvert tout de suite : sinon bloqué par le navigateur après l'attente
    try {
      const blob = await api.reportPdf(id, regenerate);
      const url = URL.createObjectURL(blob);
      if (win) win.location.href = url; else saveBlob(blob, `rapport-automatique-${id}.pdf`);
      if (regenerate) load();
    } catch (e) { win?.close(); setErr(errMsg(e)); }
    setBusy(null);
  };
  const download = async (id: number) => {
    setBusy(id); setErr("");
    try { saveBlob(await api.reportPdf(id), `rapport-automatique-${id}.pdf`); } catch (e) { setErr(errMsg(e)); }
    setBusy(null);
  };

  return (
    <>
      <h1>Rapports</h1>
      <p className="muted">Le rapport automatique est destiné au client dès le paiement des frais. Ici, l'équipe consulte cette analyse, réalise ses propres tests, puis rédige et envoie séparément le rapport final d'expertise.</p>
      {err && <p className="error" role="alert">{err}</p>}
      {rows === null && !err && <p className="muted">Chargement…</p>}
      {rows?.length === 0 && <Empty>Aucun rapport : aucune vérification n'a encore été payée.</Empty>}
      <div className="list">
        {rows?.map((r) => {
          const lv = r.level ? LEVEL[r.level] : null;
          const cmp = agreement(r.level, r.expert_verdict);
          const f = r.formulas;
          return (
            <div className="card report" key={r.order_id}>
              <div className="report-head">
                <div>
                  <strong>#{r.order_id} · {r.app_name}</strong><br />
                  <small>{r.user_email} · {r.filename}{r.generated_at ? ` · généré le ${fmtDate(r.generated_at)}` : ""}</small>
                </div>
                {lv ? <Pill kind={lv[1]}>{lv[0]}</Pill> : <Pill kind="warn">En attente</Pill>}
              </div>
              <div className="tags">
                {f && <span className="tag">{f.evaluated}/{f.total} formule(s) recalculée(s)</span>}
                {f && <span className="tag">{Math.round(f.fidelity_pct)} % identiques à Excel</span>}
                {f && f.mismatched > 0 && <span className="tag warn">{f.mismatched} écart(s)</span>}
                {r.unsupported_functions.length > 0 && <span className="tag warn">Non gérées : {r.unsupported_functions.join(", ")}</span>}
                {r.risk_count > 0 && <span className="tag warn">{r.risk_count} point(s) sensible(s)</span>}
                {r.error && <span className="tag warn">Erreur : {r.error}</span>}
              </div>
              <div className="compare">
                <div><small>Vérificateur automatique</small><br /><strong>{r.level_label ?? "—"}</strong></div>
                <div><small>Rapport final des experts</small><br /><strong>{r.expert_verdict ? VERDICT[r.expert_verdict] ?? r.expert_verdict : "Pas encore rédigé"}</strong></div>
                {cmp && <Pill kind={cmp[1]}>{cmp[0]}</Pill>}
              </div>
              <div className="actions">
                <button className="btn primary" disabled={busy === r.order_id} onClick={() => open(r.order_id)}>{busy === r.order_id ? "Ouverture…" : "Ouvrir le rapport automatique"}</button>
                <button className="btn" disabled={busy === r.order_id} onClick={() => download(r.order_id)}>Télécharger PDF</button>
                <button className="btn" disabled={busy === r.order_id} onClick={() => open(r.order_id, true)} title="Relancer le vérificateur sur le fichier">Relancer l'analyse</button>
              </div>
              <ExpertReportEditor row={r} onSent={() => { load(); data.reload(); }} />
            </div>
          );
        })}
      </div>
    </>
  );
}


function ExpertReportEditor({ row, onSent }: { row: ReportRow; onSent: () => void }) {
  const [verdict, setVerdict] = useState(row.expert_verdict ?? "convertible");
  const [testedOn, setTestedOn] = useState("");
  const [summary, setSummary] = useState(row.expert_summary ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const canSend = ["checking", "report_ready"].includes(row.order_status);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary.trim()) { setError("Rédigez les observations de l'expert avant l'envoi."); return; }
    setBusy(true); setError(""); setSuccess("");
    try {
      await api.submitExpertReport(row.order_id, {
        verdict, summary: summary.trim(), tested_on: testedOn.trim(),
        items: [{ category: "autre", name: "Tests et observations de l'expert", status: "partial", details: summary.trim() }],
      });
      setSuccess("Rapport final envoyé au client.");
      onSent();
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  };
  return (
    <details className="expert-editor">
      <summary><strong>{row.expert_verdict ? "Modifier le rapport final des experts" : "Rédiger le rapport final des experts"}</strong></summary>
      {!canSend && <p className="muted">La rédaction est disponible lorsque les frais de vérification sont payés et avant le paiement de la conversion.</p>}
      <form onSubmit={submit}>
        <label>Verdict de l'expert
          <select value={verdict} onChange={(e) => setVerdict(e.target.value)} disabled={!canSend || busy}>
            <option value="convertible">Convertible en l'état</option>
            <option value="convertible_with_changes">Convertible après adaptations</option>
            <option value="not_convertible">Non convertible en l'état</option>
          </select>
        </label>
        <label>Environnement de test
          <input value={testedOn} onChange={(e) => setTestedOn(e.target.value)} placeholder="Ex. Excel 365 / Windows 11" maxLength={200} disabled={!canSend || busy} />
        </label>
        <label>Rapport et observations de l'expert
          <textarea rows={6} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={4000} placeholder="Décrivez les tests réellement effectués, les résultats, les anomalies constatées et les recommandations…" disabled={!canSend || busy} />
        </label>
        {error && <p className="error">{error}</p>}
        {success && <p className="success">{success}</p>}
        <button className="btn primary" type="submit" disabled={!canSend || busy}>{busy ? "Envoi…" : "Envoyer le rapport final au client"}</button>
      </form>
    </details>
  );
}
