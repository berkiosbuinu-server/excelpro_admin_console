const BASE: string = import.meta.env.VITE_API_URL ?? "https://excelpro-api.berkios.online";
const KEY = "excelpro_admin_token";

export type Payment = {
  id: number; provider: string; purpose: "check" | "conversion"; amount_cents: number;
  status: "pending" | "succeeded" | "failed"; reference: string | null; phone: string | null;
  has_proof?: boolean; created_at: string;
};
export type Delivery = { id: number; platform: string; filename: string };
export type Analysis = {
  sheet_count?: number; formula_count?: number; has_vba?: boolean; vba_procedures?: number;
  vba_forms?: string[]; file_size_bytes?: number; warnings?: string[]; runtime?: RuntimeReport;
};
export type RuntimeReport = {
  available: boolean; error?: string; status?: string; runs_without_excel?: boolean;
  formulas?: { total: number; evaluated: number; matched: number; mismatched: number; unsupported: number; circular: number; coverage_pct: number; fidelity_pct: number };
  unsupported_functions?: string[]; volatile_functions?: string[];
  mismatches?: { sheet: string; cell: string; formula: string; expected: string; computed: string }[];
  macros?: { present: boolean; executed: boolean };
};
export type Order = {
  id: number; app_name: string; original_filename: string; platforms: string[]; total_usd: number;
  status: "submitted" | "checking" | "report_ready" | "in_progress" | "ready"; paid: boolean; created_at: string;
  analysis: Analysis | null; claim_key: string | null; claim_expires_at: string | null; user_email: string | null; deliveries: Delivery[];
  payments: Payment[]; check_fee_cents: number; check_paid: boolean;
  check_report: { verdict: string; summary: string; tested_on: string } | null;
};
export type ReportRow = {
  order_id: number; app_name: string; user_email: string; filename: string; order_status: string; check_paid: boolean;
  generated_at: string | null; level: "ok" | "review" | "risk" | null; level_label: string | null; error: string | null;
  formulas: NonNullable<RuntimeReport["formulas"]> | null; unsupported_functions: string[]; risk_count: number;
  expert_verdict: string | null; expert_summary: string | null;
};
export type Message = { id: number; from_admin: boolean; body: string; created_at: string };
export type Conversation = { user_id: number | null; email: string; name: string | null; unread: number; last_at: string; messages: Message[] };

let token: string | null = null;
try { token = localStorage.getItem(KEY); } catch { /* stockage indisponible */ }
export const hasToken = () => token !== null;
export function setToken(t: string | null) {
  token = t;
  try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch { /* ignoré */ }
}

export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }

async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const res = await fetch(BASE + path, { ...init, headers });
  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    try { const j = await res.json(); msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch { /* corps non JSON */ }
    throw new ApiError(res.status, msg);
  }
  return res;
}
const json = async <T,>(path: string, init?: RequestInit) => (await raw(path, init)).json() as Promise<T>;

export const api = {
  login: async (email: string, password: string, create = false) => {
    const r = await json<{ token: string; role: string }>(create ? "/auth/register" : "/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    if (r.role !== "admin") throw new Error(create
      ? "Compte créé, mais cet e-mail n'est pas l'e-mail administrateur : il doit être identique à ADMIN_EMAIL dans le fichier .env du serveur."
      : "Ce compte n'a pas les droits d'administration");
    setToken(r.token);
  },
  orders: () => json<Order[]>("/admin/orders"),
  conversations: () => json<Conversation[]>("/admin/messages"),
  reply: (userId: number, body: string) => json<Message>(`/admin/messages/${userId}`, { method: "POST", body: JSON.stringify({ body }) }),
  markRead: (userId: number) => json<{ ok: boolean }>(`/admin/messages/${userId}/read`, { method: "POST" }),
  decide: (paymentId: number, action: "confirm" | "reject") => json<Order>(`/admin/payments/${paymentId}/${action}`, { method: "POST" }),
  reports: () => json<ReportRow[]>("/admin/reports"),
  submitExpertReport: (orderId: number, body: { verdict: string; summary: string; tested_on: string; items: { category: string; name: string; status: string; details: string }[] }) =>
    json<Order>(`/admin/orders/${orderId}/check-report`, { method: "POST", body: JSON.stringify(body) }),
  reportPdf: async (orderId: number, regenerate = false) => (await raw(`/admin/orders/${orderId}/auto-report.pdf${regenerate ? "?regenerate=true" : ""}`)).blob(),
  proofBlob: async (paymentId: number) => (await raw(`/admin/payments/${paymentId}/proof`)).blob(),
  sourceBlob: async (orderId: number) => (await raw(`/admin/orders/${orderId}/source`)).blob(),
};

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const money = (cents: number) => `${(cents / 100).toFixed(2)} $`;
export const fmtDate = (iso: string) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
export const fmtSize = (b?: number) => (b == null ? "—" : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} Ko` : `${(b / 1024 / 1024).toFixed(1)} Mo`);
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Erreur inconnue");
