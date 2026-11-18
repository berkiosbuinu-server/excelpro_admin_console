import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errMsg, type QuotaItem, type QuotaRow } from "./api";
import { Empty, Modal, Pill } from "./ui";

/** Offres d'hébergement (mêmes limites que le serveur et que la page de tarifs). null = illimité. */
const PLANS: Record<string, { label: string; limits: Record<string, number | null> }> = {
  solo: { label: "Solo (3 $/mois)", limits: { workbooks: 1, rows: 10_000, calls: 30_000, keys: 2, queries: 10 } },
  equipe: { label: "Équipe (15 $/mois)", limits: { workbooks: 3, rows: 200_000, calls: 500_000, keys: 5, queries: 30 } },
  entreprise: { label: "Entreprise (39 $/mois)", limits: { workbooks: 10, rows: 1_000_000, calls: 3_000_000, keys: 20, queries: 60 } },
  editeur: { label: "Éditeur SaaS (79 $/mois)", limits: { workbooks: 10, rows: 1_000_000, calls: 3_000_000, keys: 50, queries: 60 } },
  custom: { label: "Sur mesure", limits: {} },
};
const KEYS: [string, string][] = [["workbooks", "Classeurs"], ["rows", "Lignes"], ["calls", "Appels / mois"], ["keys", "Clés d'API"], ["queries", "Requêtes et actions"]];
const nf = (n: number | null) => (n === null ? "illimité" : n.toLocaleString("fr-FR"));
const levelKind = (l: string) => (l === "full" ? "bad" : l === "warn" ? "warn" : "ok");

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
      await api.setQuota(row.user_id, plan, overrides); await onSaved(); onClose();
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
  const load = useCallback(async () => { try { setErr(""); setRows(await api.quotas()); } catch (e) { setErr(errMsg(e)); } }, []);
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
      {rows === null && !err && <p className="muted">Chargement…</p>}
      {rows !== null && shown.length === 0 && <Empty>Aucun compte dans cette catégorie.</Empty>}
      <div className="pay-grid">
        {shown.map((r) => (
          <article className="card pay" key={r.user_id}>
            <header><strong>{r.email}</strong>{r.plan ? <Pill kind={r.usage && Object.values(r.usage).some((u) => u.level === "full") ? "bad" : r.usage && Object.values(r.usage).some((u) => u.level === "warn") ? "warn" : "ok"}>{PLANS[r.plan]?.label.split(" (")[0] ?? r.plan}</Pill> : <Pill kind="info">Illimité</Pill>}</header>
            <p className="muted" style={{ margin: "4px 0 8px" }}><code>{r.tenant}</code>{r.has_workbooks ? "" : " · aucun classeur"}</p>
            {r.usage && KEYS.map(([k, l]) => <Bar key={k} label={l} u={r.usage![k as keyof typeof r.usage]} />)}
            {r.usage && r.usage.rows.used === null && <p className="muted" style={{ fontSize: 12 }}>Le nombre de lignes s'affiche après la première opération de ce compte.</p>}
            <div className="actions"><button className="btn primary" onClick={() => setEdit(r)}>{r.plan ? "Changer l'offre" : "Attribuer une offre"}</button></div>
          </article>
        ))}
      </div>
      {edit && <Editor row={edit} onClose={() => setEdit(null)} onSaved={load} />}
    </>
  );
}
