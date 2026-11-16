import { useEffect, useState, type ReactNode } from "react";
import { api, errMsg } from "./api";

export const STATUS: Record<string, string> = {
  submitted: "Vérification à payer", checking: "Vérification en cours", report_ready: "Rapport remis",
  in_progress: "Conversion en cours", ready: "Prête",
};
export const PLATFORMS: Record<string, string> = { windows: "Windows", android: "Android", linux: "Linux", ios: "iOS", macos: "macOS", web: "Web" };
export const PROVIDERS: Record<string, string> = { stripe: "Carte (Stripe)", mpesa: "M-PESA", orange: "Orange Money", airtel: "Airtel Money", transfer: "Transfert" };
export const PAY_STATUS: Record<string, string> = { pending: "À valider", succeeded: "Confirmé", failed: "Rejeté" };
export const PURPOSE: Record<string, string> = { check: "Vérification", conversion: "Conversion" };

export function Pill({ kind, children }: { kind: string; children: ReactNode }) {
  return <span className={`pill ${kind}`}>{children}</span>;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button className="icon" onClick={onClose} aria-label="Fermer">✕</button></header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** Capture de transaction : chargée avec le jeton admin (la route est protégée), affichée en miniature puis en grand. */
export function ProofView({ paymentId, big }: { paymentId: number; big?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [type, setType] = useState("");
  const [err, setErr] = useState("");
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    let alive = true, made: string | null = null;
    api.proofBlob(paymentId).then((b) => {
      if (!alive) return;
      made = URL.createObjectURL(b);
      setUrl(made); setType(b.type);
    }).catch((e) => alive && setErr(errMsg(e)));
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [paymentId]);

  if (err) return <div className="proof missing">{err}</div>;
  if (!url) return <div className="proof loading">Chargement de la capture…</div>;
  if (type === "application/pdf") {
    return <a className="proof pdf" href={url} target="_blank" rel="noopener noreferrer">📄 Ouvrir la capture (PDF)</a>;
  }
  return (
    <>
      <button className={`proof img ${big ? "big" : ""}`} onClick={() => setZoom(true)} aria-label="Agrandir la capture">
        <img src={url} alt={`Capture de la transaction ${paymentId}`} />
      </button>
      {zoom && (
        <Modal title="Capture de la transaction" wide onClose={() => setZoom(false)}>
          <img className="zoomed" src={url} alt="Capture agrandie" />
          <div className="actions"><a className="btn" href={url} download={`capture-${paymentId}`}>Télécharger</a></div>
        </Modal>
      )}
    </>
  );
}
