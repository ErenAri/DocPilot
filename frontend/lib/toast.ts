export type ToastVariant = "success" | "error" | "info";

let container: HTMLDivElement | null = null;

function ensureContainer(): HTMLDivElement {
  if (container && document.body.contains(container)) return container;
  container = document.createElement("div");
  Object.assign(container.style, {
    position: "fixed",
    top: "12px",
    right: "12px",
    zIndex: "99999",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    pointerEvents: "none",
  } as CSSStyleDeclaration);
  document.body.appendChild(container);
  return container;
}

export function toast(message: string, variant: ToastVariant = "info", ms = 3000) {
  if (typeof window === "undefined") return;
  const root = ensureContainer();
  const el = document.createElement("div");
  const bg = variant === "success" ? "#0ea5e9" : variant === "error" ? "#ef4444" : "#334155";
  Object.assign(el.style, {
    background: bg,
    color: "white",
    borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.2)",
    padding: "8px 12px",
    boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
    fontSize: "13px",
    lineHeight: "1.4",
    transform: "translateX(16px)",
    opacity: "0",
    transition: "all .2s ease",
    pointerEvents: "auto",
    maxWidth: "360px",
    whiteSpace: "pre-wrap",
  } as CSSStyleDeclaration);
  el.textContent = message;
  root.appendChild(el);
  requestAnimationFrame(() => {
    el.style.transform = "translateX(0)";
    el.style.opacity = "1";
  });
  const close = () => {
    el.style.opacity = "0";
    el.style.transform = "translateX(16px)";
    setTimeout(() => { try { root.removeChild(el); } catch {} }, 200);
  };
  const id = window.setTimeout(close, ms);
  el.addEventListener("click", () => { window.clearTimeout(id); close(); });
}

export const toastSuccess = (m: string, ms?: number) => toast(m, "success", ms);
export const toastError = (m: string, ms?: number) => toast(m, "error", ms);
export const toastInfo = (m: string, ms?: number) => toast(m, "info", ms);


