import { useCallback, useEffect, useState } from "react";
import { api, ApiError, errMsg, hasToken, setToken, type Conversation, type Order } from "./api";
import { Dashboard, Files, Messages, Orders, Payments, Reports, type Data } from "./pages";
import { HostingQuotas, PageGuard } from "./hosting";
import { StudioPage } from "./studio";

const NAV: [string, string, string][] = [
  ["dashboard", "Tableau de bord", "▦"], ["orders", "Commandes", "☰"], ["files", "Fichiers", "📁"],
  ["payments", "Paiements", "＄"], ["hosting", "Hébergement", "☁"], ["studio", "Studio", "🖥"], ["reports", "Rapports", "📄"], ["messages", "Messages", "✉"],
];
const route = () => (window.location.hash.replace(/^#\/?/, "") || "dashboard");

export default function App() {
  const [authed, setAuthed] = useState(hasToken());
  const [page, setPage] = useState(route());
  const [orders, setOrders] = useState<Order[]>([]);
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const h = () => setPage(route());
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);

  const logout = useCallback(() => { setToken(null); setAuthed(false); setLoaded(false); }, []);
  const reload = useCallback(async () => {
    try {
      const [o, c] = await Promise.all([api.orders(), api.conversations()]);
      setOrders(o); setConvs(c); setError(""); setLoaded(true);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) logout();
      else setError(errMsg(e));
    }
  }, [logout]);

  useEffect(() => {
    if (!authed) return;
    reload();
    const t = setInterval(reload, 20000);
    return () => clearInterval(t);
  }, [authed, reload]);

  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  const data: Data = { orders, convs, reload };
  const go = (p: string) => { window.location.hash = `/${p}`; };
  const pending = orders.reduce((n, o) => n + o.payments.filter((p) => p.status === "pending").length, 0);
  const unread = convs.reduce((n, c) => n + c.unread, 0);
  const badge = (k: string) => (k === "payments" ? pending : k === "messages" ? unread : 0);

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span className="logo">X</span><div><strong>ExcelPro</strong><small>Console admin</small></div></div>
        <nav>
          {NAV.map(([k, l, i]) => (
            <button key={k} className={page === k ? "on" : ""} onClick={() => go(k)}>
              <span className="ico" aria-hidden>{i}</span><span className="lbl">{l}</span>
              {badge(k) > 0 && <b className="dot">{badge(k)}</b>}
            </button>
          ))}
        </nav>
        <button className="logout" onClick={logout}>Déconnexion</button>
      </aside>
      <main>
        {error && <div className="banner">Connexion au serveur impossible : {error} <button onClick={reload}>Réessayer</button></div>}
        {!loaded && !error && <p className="muted">Chargement…</p>}
        {loaded && (
          <>
            {page === "dashboard" && <Dashboard data={data} go={go} />}
            {page === "orders" && <Orders data={data} />}
            {page === "files" && <Files data={data} />}
            {page === "payments" && <Payments data={data} />}
            {page === "reports" && <Reports data={data} />}
            {page === "hosting" && <PageGuard><HostingQuotas /></PageGuard>}
            {page === "studio" && <StudioPage />}
            {page === "messages" && <Messages data={data} />}
            {!NAV.some(([k]) => k === page) && <Dashboard data={data} go={go} />}
          </>
        )}
      </main>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [create, setCreate] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try { await api.login(email, password, create); onDone(); } catch (err) { setError(errMsg(err)); }
    setBusy(false);
  };
  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={submit}>
        <div className="brand"><span className="logo">X</span><div><strong>ExcelPro</strong><small>Console d'administration</small></div></div>
        <label>E-mail<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Mot de passe{create ? " (8 caractères min.)" : ""}<input type="password" autoComplete={create ? "new-password" : "current-password"} minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary full" type="submit" disabled={busy}>{busy ? "Patientez…" : create ? "Créer le compte administrateur" : "Se connecter"}</button>
        <button type="button" className="btn full" onClick={() => { setCreate(!create); setError(""); }}>{create ? "J'ai déjà un compte" : "Créer le compte administrateur"}</button>
        <p className="muted">{create ? "Utilisez l'e-mail défini dans ADMIN_EMAIL (fichier .env) : il devient automatiquement administrateur." : "Accès réservé aux administrateurs."}</p>
      </form>
    </div>
  );
}
