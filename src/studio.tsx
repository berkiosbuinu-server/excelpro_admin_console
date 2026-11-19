import { useCallback, useEffect, useRef, useState } from "react";
import { api, errMsg, fmtDate, fmtSize, saveBlob, type OrderStudio, type StudioInstall, type StudioRelease, type StudioStatus } from "./api";
import { Empty, Pill } from "./ui";

/** Page « Studio » : installer le Studio desktop, voir quels postes (Studio + Bridge) sont opérationnels. */
export function StudioPage() {
  const [status, setStatus] = useState<StudioStatus | null>(null);
  const [installs, setInstalls] = useState<StudioInstall[]>([]);
  const [releases, setReleases] = useState<StudioRelease[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [s, i, r] = await Promise.all([api.studioStatus(), api.studioInstalls(), api.studioReleases()]);
      setStatus(s); setInstalls(i); setReleases(r); setErr("");
    } catch (e) { setErr(errMsg(e)); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const upload = async () => {
    const f = file.current?.files?.[0];
    if (!f || !version.trim()) { setErr("Choisissez l'installateur (.exe) et indiquez sa version (ex. 0.7.306)."); return; }
    setBusy(true); setErr("");
    try { await api.addStudioRelease(version.trim(), notes, f); setVersion(""); setNotes(""); if (file.current) file.current.value = ""; await load(); }
    catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  };
  const download = (r: StudioRelease) => api.studioReleaseBlob(r.id).then((b) => saveBlob(b, r.filename)).catch((e) => setErr(errMsg(e)));
  const forget = async (i: StudioInstall) => {
    if (!window.confirm(`Oublier le poste « ${i.machine_name ?? i.machine_id} » ? Il réapparaîtra à sa prochaine connexion.`)) return;
    try { await api.forgetStudio(i.id); await load(); } catch (e) { setErr(errMsg(e)); }
  };
  const latest = status?.latest_release ?? releases[0] ?? null;

  return (
    <>
      <h1>Studio</h1>
      {err && <div className="banner">{err}</div>}
      <p className="muted">
        La conversion des classeurs Excel en projets BERKIOS se fait uniquement dans le Studio desktop installé depuis cette page, connecté avec un compte
        administrateur de ce serveur. Le Studio public ne la contient plus.
      </p>
      <div className="card">
        <h3>État de l'atelier</h3>
        {!status ? <p className="muted">Chargement…</p> : (
          <div className="tags">
            <Pill kind={status.ready ? "ok" : "warn"}>{status.ready ? "Prêt : un Studio et son Bridge sont opérationnels" : "Aucun poste opérationnel"}</Pill>
            <span className="tag">{status.online} en ligne / {status.installed} installé(s)</span>
            <span className="tag">Studio ≥ {status.min_studio_version}</span><span className="tag">Bridge ≥ {status.min_bridge_version}</span>
            <span className="tag">{status.required ? "Obligatoire pour démarrer une conversion" : "Non obligatoire (STUDIO_REQUIRED=false)"}</span>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Installer le Studio</h3>
        {latest ? (
          <div className="line static">
            <span><strong>BERKIOS GRAPHIC Studio {latest.version}</strong> · {latest.filename} · {fmtSize(latest.size_bytes)}<br /><small>SHA-256 {latest.sha256}</small></span>
            <button className="btn primary" onClick={() => download(latest)}>Télécharger</button>
          </div>
        ) : <Empty>Aucun installateur publié. Fabriquez-le avec build-desktop-tauri.bat puis téléversez-le ci-dessous.</Empty>}
        <p className="muted">Après installation : ouvrir le Studio, « Compte » → « Atelier ExcelPro », se connecter avec le compte administrateur.</p>
        <h3>Publier une nouvelle version</h3>
        <div className="filters">
          <input placeholder="Version (ex. 0.7.306)" value={version} onChange={(e) => setVersion(e.target.value)} />
          <input placeholder="Notes (facultatif)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <input ref={file} type="file" accept=".exe,.msi,.zip,.dmg,.pkg,.deb,.rpm,.appimage" />
          <button className="btn" disabled={busy} onClick={upload}>{busy ? "Envoi…" : "Publier"}</button>
        </div>
        {releases.length > 1 && (
          <details><summary>Versions précédentes ({releases.length - 1})</summary>
            {releases.slice(1).map((r) => <div className="line static" key={r.id}><span>{r.version} · {r.filename}<br /><small>{fmtDate(r.created_at)}</small></span><button className="btn" onClick={() => download(r)}>Télécharger</button></div>)}
          </details>
        )}
      </div>

      <div className="card">
        <h3>Postes</h3>
        {installs.length === 0 && <Empty>Aucun Studio ne s'est encore connecté.</Empty>}
        <div className="list">
          {installs.map((i) => (
            <div className="item" key={i.id}>
              <div className="item-main">
                <strong>{i.machine_name ?? i.machine_id}</strong>
                <small>{i.user_email} · {i.platform ?? "?"} · Studio {i.studio_version} · Bridge {i.bridge_ok ? i.bridge_version ?? "actif" : "arrêté"}</small>
                {i.issues.map((m) => <small className="warnline" key={m}>⚠ {m}</small>)}
              </div>
              <div className="item-side">
                <Pill kind={i.ready ? "ok" : i.online ? "warn" : "bad"}>{i.ready ? "Opérationnel" : i.online ? "En ligne, à corriger" : "Hors ligne"}</Pill>
                <small>vu {fmtDate(i.last_seen)}</small>
                <button className="btn" onClick={() => forget(i)}>Oublier</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/** Bloc de la fiche commande : « Ouvrir dans le Studio » + état du projet BERKIOS déjà produit. */
export function OrderStudioBlock({ orderId }: { orderId: number }) {
  const [info, setInfo] = useState<OrderStudio | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.orderStudio(orderId).then(setInfo).catch((e) => setMsg(errMsg(e))), [orderId]);
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);
  const open = async () => {
    setBusy(true); setMsg("");
    try { await api.openInStudio(orderId); setMsg("Demande envoyée : le Studio ouvrira la commande dans les 30 secondes."); await load(); }
    catch (e) { setMsg(errMsg(e)); }
    setBusy(false);
  };
  const job = info?.jobs[0];
  return (
    <>
      <h3>Projet BERKIOS (Studio)</h3>
      <div className="line static">
        <span>
          {info?.project ? <>Projet enregistré · révision {info.project.revision} · {fmtSize(info.project.size_bytes)}<br /><small>mis à jour {fmtDate(info.project.updated_at)}</small></> : "Aucun projet produit pour l'instant."}
          {job && <><br /><small>Dernière demande : {({ queued: "en attente d'un Studio", taken: "prise en charge", done: "terminée", failed: "échouée" })[job.status]}{job.message ? ` — ${job.message}` : ""}</small></>}
        </span>
        <button className="btn primary" disabled={busy} onClick={open}>Ouvrir dans le Studio</button>
      </div>
      {msg && <p className="warnline">{msg}</p>}
    </>
  );
}
