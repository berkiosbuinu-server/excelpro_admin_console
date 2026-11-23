import { Component, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, errMsg, money, type QuotaItem, type QuotaRow, type SubRequest } from "./api";
import { Empty, Modal, Pill } from "./ui";

/** Offres d'hébergement (mêmes limites que le serveur et que la page de tarifs). null = illimité. */
const PLANS: Record<string, { label: string; limits: Record<string, number | null> }> = {
  solo: { label: "Solo (3 $/mois)", limits: { workbooks: 1, rows: 10_000, calls: 30_000, keys: 2, queries: 10 } },
  equipe: { label: "Équipe (15 $/mois)", limits: { workbooks: 3, rows: 200_000, calls: 500_000, keys: 5, queries: 30 } },
  entreprise: { label: "Entreprise (39 $/mois)", limits: { workbooks: 10, rows: 1_000_000, calls: 3_000_000, keys: 20, queries: 60 } },
  editeur10: { label: "Éditeur · 1 à 10 clients (30 $/mois)", limits: { workbooks: 10, rows: 300_000, calls: 1_000_000, keys: 50, queries: 60, clients: 10 } },
  editeur50: { label: "Éditeur · 11 à 50 clients (89 $/mois)", limits: { workbooks: 10, rows: 1_000_000, calls: 3_000_000, keys: 50, queries: 60, clients: 50 } },
  editeur100: { label: "Éditeur · 51 à 100 clients (149 $/mois)", limits: { workbooks: 10, rows: 2_000_000, calls: 6_000_000, keys: 50, queries: 60, clients: 100 } },
  editeur500: { label: "Éditeur · 101 à 500 clients (299 $/mois)", limits: { workbooks: 10, rows: 5_000_000, calls: 15_000_000, keys: 50, queries: 60, clients: 500 } },
  editeur: { label: "Éditeur (ancienne offre, 79 $/mois)", limits: { workbooks: 10, rows: 1_000_000, calls: 3_000_000, keys: 50, queries: 60 } },
  custom: { label: "Sur mesure", limits: {} },
};
const KEYS: [string, string][] = [["workbooks", "Classeurs"], ["rows", "Lignes"], ["calls", "Appels / mois"], ["keys", "Clés d'API"], ["queries", "Requêtes et actions"], ["clients", "Clients finaux (Éditeur)"]];
const BILLING_LABEL: Record<string, string> = { monthly: "Mensuel", quarterly: "3 mois + 1 offert (4 mois)", yearly: "Annuel (−30 %)", upgrade: "Montée de palier (prorata)" };
// Hébergement de sites web : ces demandes arrivent dans la même liste (identifiants « s12 », offres site-starter / site-pro).
const SITE_PLANS: Record<string, string> = { "site-starter": "Site web · Starter (2 $/mois, 1 site)", "site-pro": "Site web · Pro (10 $/mois, 5 sites, domaines)" };
const SITE_BILLING: Record<string, string> = { monthly: "1 mois", start5: "5 mois (premier paiement Starter)", yearly: "12 mois (−20 %)", upgrade: "Montée Starter → Pro (prorata)" };
export const requestPlan = (plan: string) => SITE_PLANS[plan] ?? PLANS[plan]?.label ?? plan;
export const requestBilling = (plan: string, billing: string) => (plan in SITE_PLANS ? SITE_BILLING : BILLING_LABEL)[billing] ?? billing;
const ACCESS_LABEL: Record<string, [string, string]> = { none: ["Aucune offre", "info"], trial: ["Essai", "warn"], active: ["Actif", "ok"], expired: ["Expiré", "bad"] };
const nf = (n: number | null) => (n === null ? "illimité" : n.toLocaleString("fr-FR"));
const levelKind = (l: string) => (l === "full" ? "bad" : l === "warn" ? "warn" : "ok");

/** Complète une ligne reçue (ancien serveur, compte sans classeur…) pour que l'affichage ne plante jamais. */
function clean(r: QuotaRow): QuotaRow {
  const access = { ...(r.access ?? {}), state: r.access?.state ?? ("none" as const), expiresAt: r.access?.expiresAt ?? null, daysLeft: r.access?.daysLeft ?? null, trial: r.access?.trial ?? false };
  if (!ACCESS_LABEL[access.state]) (access as { state: string }).state = "none";
  return { ...r, access, overrides: r.overrides ?? {}, source: r.source ?? null, email: r.email ?? "", usage: r.usage ?? null };
}

function Bar({ label, u }: { label: string; u: QuotaItem }) {
  const pct = Math.min(100, u.percent ?? 0), color = u.level === "full" ? "var(--bad)" : u.level === "warn" ? "var(--warn)" : "var(--ok)";
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}><span>{label}</span><span>{u.used === null ? "?" : nf(u.used)} / {nf(u.limit)}</span></div>
      {u.limit !== null && <div style={{ height: 5, borderRadius: 3, background: "var(--line)" }}><div style={{ height: 5, borderRadius: 3, width: `${pct}%`, background: color }} /></div>}
    </div>
  );
}

function Editor({ row, onClose, onSaved }: { row: QuotaRow; onClose: () => void; onSaved: () => Promise<void> }) {
  const [plan, setPlan] = useState(row.plan ?? "solo");
  const [ov, setOv] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(row.overrides).map(([k, v]) => [k, v === null ? "" : String(v)])));
  const [expiry, setExpiry] = useState(row.access.expiresAt ? row.access.expiresAt.slice(0, 10) : "");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const defaults = PLANS[plan]?.limits ?? {};
  const save = async () => {
    setErr(""); setBusy(true);
    try {
      const overrides: Record<string, number | null> = {};
      for (const [k] of KEYS) {
        const t = (ov[k] ?? "").trim();
        if (t === "") { if (plan === "custom") overrides[k] = null; continue; } // vide : valeur de l'offre (ou illimité en « sur mesure »)
        const n = Number(t); if (!Number.isInteger(n) || n < 0) throw new Error(`« ${k} » : entier positif attendu (laissez vide pour la valeur de l'offre).`);
        overrides[k] = n;
      }
      if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) throw new Error("Date d'échéance : AAAA-MM-JJ (ou vide = sans échéance).");
      await api.setQuota(row.user_id, plan, overrides, expiry); await onSaved(); onClose();
    } catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Retirer l'offre de ${row.email} ? Il redeviendra illimité.`)) return;
    setBusy(true); try { await api.removeQuota(row.user_id); await onSaved(); onClose(); } catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  return (
    <Modal title={`Offre de ${row.email}`} onClose={onClose}>
      <label>Offre
        <select value={plan} onChange={(e) => setPlan(e.target.value)}>{Object.entries(PLANS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select>
      </label>
      <label>Valable jusqu'au <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></label>
      <p className="muted">Vide = sans échéance. À l'échéance, l'offre passe en lecture seule jusqu'au renouvellement.</p>
      <p className="muted">Limites : laissez une case vide pour appliquer la valeur de l'offre. Pour « Sur mesure », une case vide = illimité.</p>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th style={{ textAlign: "left" }}>Limite</th><th style={{ textAlign: "left" }}>Offre</th><th style={{ textAlign: "left" }}>Valeur imposée</th></tr></thead>
        <tbody>{KEYS.map(([k, l]) => (
          <tr key={k}><td>{l}</td><td className="muted">{plan === "custom" ? "—" : nf(defaults[k] ?? null)}</td>
            <td><input inputMode="numeric" style={{ width: 120 }} value={ov[k] ?? ""} placeholder={plan === "custom" ? "illimité" : "offre"} onChange={(e) => setOv({ ...ov, [k]: e.target.value.replace(/\D/g, "") })} /></td></tr>
        ))}</tbody>
      </table>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="actions" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={busy} onClick={() => void save()}>Enregistrer</button>
        {row.plan && <button className="btn danger" disabled={busy} onClick={() => void remove()}>Retirer l'offre (illimité)</button>}
        <button className="btn" onClick={onClose}>Annuler</button>
      </div>
    </Modal>
  );
}

/** Hébergement : offre et utilisation de chaque compte, modifiables sans ligne de commande. */
export function HostingQuotas() {
  const [rows, setRows] = useState<QuotaRow[] | null>(null);
  const [err, setErr] = useState(""); const [q, setQ] = useState(""); const [only, setOnly] = useState<"all" | "plan" | "alert">("all");
  const [edit, setEdit] = useState<QuotaRow | null>(null);
  const [reqs, setReqs] = useState<SubRequest[]>([]); const [busyReq, setBusyReq] = useState<number | null>(null);
  const load = useCallback(async () => { try { setErr(""); const [r, q2] = await Promise.all([api.quotas(), api.requests()]); setRows(r.map(clean)); setReqs(Array.isArray(q2) ? q2 : []); } catch (e) { setErr(errMsg(e)); } }, []);
  const decide = async (r: SubRequest, action: "approve" | "reject") => {
    const msg = action === "approve" ? `ACTIVER « ${requestPlan(r.plan)} » (${requestBilling(r.plan, r.billing)}) pour ${r.email} ?\nVérifiez d'abord que ${money(r.amountCents)} a bien été reçu${r.reference ? ` (référence ${r.reference})` : ""}.` : `REJETER la demande de ${r.email} ?`;
    if (!window.confirm(msg)) return;
    setBusyReq(r.id); try { await api.decideRequest(r.id, action); await load(); } catch (e) { setErr(errMsg(e)); } setBusyReq(null);
  };
  useEffect(() => { void load(); }, [load]);
  const shown = useMemo(() => (rows ?? []).filter((r) => r.email.toLowerCase().includes(q.trim().toLowerCase()) &&
    (only === "all" || (only === "plan" ? r.plan !== null : r.usage !== null && Object.values(r.usage).some((u) => u.level !== "ok")))), [rows, q, only]);
  return (
    <>
      <h1>Hébergement &amp; offres</h1>
      <p className="muted">Attribuez une offre à un compte : ses limites (classeurs, lignes, appels, clés, requêtes) sont appliquées aussitôt par le serveur. Sans offre, un compte est illimité.</p>
      <div className="tabs">
        {([["all", "Tous"], ["plan", "Avec une offre"], ["alert", "Proches d'une limite"]] as const).map(([k, l]) => <button key={k} className={only === k ? "on" : ""} onClick={() => setOnly(k)}>{l}</button>)}
        <input placeholder="Rechercher un e-mail…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginLeft: "auto" }} />
        <button className="btn" onClick={() => void load()}>Actualiser</button>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      {reqs.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <strong>Demandes d'abonnement à valider ({reqs.length})</strong>
          <p className="muted">Le client a demandé une offre et indiqué sa référence de paiement. Vérifiez la réception du paiement, puis activez.</p>
          {reqs.map((r) => (
            <div key={r.id} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--line)" }}>
              <span style={{ flex: 1, minWidth: 220 }}><b>{r.email}</b><br /><span className="muted">{requestPlan(r.plan)} · {requestBilling(r.plan, r.billing)} · <b>{money(r.amountCents)}</b>{r.reference ? ` · réf. ${r.reference}` : ""}{r.phone ? ` · ${r.phone}` : ""}</span></span>
              <button className="btn primary" disabled={busyReq === r.id} onClick={() => void decide(r, "approve")}>Paiement reçu : activer</button>
              <button className="btn danger" disabled={busyReq === r.id} onClick={() => void decide(r, "reject")}>Rejeter</button>
            </div>
          ))}
        </div>
      )}
      {rows === null && !err && <p className="muted">Chargement…</p>}
      {rows !== null && shown.length === 0 && <Empty>Aucun compte dans cette catégorie.</Empty>}
      <div className="pay-grid">
        {shown.map((r) => (
          <article className="card pay" key={r.user_id}>
            <header><strong>{r.email}</strong>{r.plan && r.access.state !== "active" ? <Pill kind={ACCESS_LABEL[r.access.state][1]}>{ACCESS_LABEL[r.access.state][0]}{r.access.daysLeft !== null && r.access.state === "trial" ? ` · ${r.access.daysLeft} j` : ""}</Pill> : r.plan ? <Pill kind={r.usage && Object.values(r.usage).some((u) => u.level === "full") ? "bad" : r.usage && Object.values(r.usage).some((u) => u.level === "warn") ? "warn" : "ok"}>{(PLANS[r.plan]?.label ?? r.plan).split(" (")[0]}</Pill> : <Pill kind="info">Illimité</Pill>}</header>
            <p className="muted" style={{ margin: "4px 0 8px" }}><code>{r.tenant}</code>{r.has_workbooks ? "" : " · aucun classeur"}{r.access.expiresAt ? ` · échéance ${r.access.expiresAt.slice(0, 10)}${r.access.daysLeft !== null ? ` (${r.access.daysLeft} j)` : ""}` : ""}{r.source === "grandfathered" ? " · ancien client (30 j offerts)" : ""}</p>
            {r.usage && KEYS.map(([k, l]) => r.usage![k as keyof typeof r.usage] ? <Bar key={k} label={l} u={r.usage![k as keyof typeof r.usage]} /> : null)}
            {r.usage && r.usage.rows && r.usage.rows.used === null && <p className="muted" style={{ fontSize: 12 }}>Le nombre de lignes s'affiche après la première opération de ce compte.</p>}
            <div className="actions"><button className="btn primary" onClick={() => setEdit(r)}>{r.plan ? "Changer l'offre" : "Attribuer une offre"}</button></div>
          </article>
        ))}
      </div>
      {edit && <Editor row={edit} onClose={() => setEdit(null)} onSaved={load} />}
    </>
  );
}

/** Filet de sécurité : une erreur d'affichage montre un message et un bouton, au lieu d'une page blanche. */
export class PageGuard extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(e: unknown) { return { error: e instanceof Error ? e.message : String(e) }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card">
        <strong>Cette page a rencontré une erreur.</strong>
        <p className="error" role="alert">{this.state.error}</p>
        <button className="btn primary" onClick={() => this.setState({ error: "" })}>Réessayer</button>
      </div>
    );
  }
}
