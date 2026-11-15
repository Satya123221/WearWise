import { spaceQueryClient } from "@hatch/space-sdk/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme.css";

/* Last-resort error boundary: if anything throws while the app renders
   (a blocked-storage webview, a bad persisted value, a runtime quirk),
   the user gets a readable recovery screen with working actions —
   never a silent black page. */
class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    console.error("WearWise failed to render:", error);
  }
  private resetSavedState = () => {
    try { window.localStorage.removeItem("ww-user"); } catch { /* storage may be blocked */ }
    try { window.localStorage.removeItem("ww-theme"); } catch { /* storage may be blocked */ }
    window.location.reload();
  };
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#f6f2ea", color: "#17150f", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <p style={{ fontSize: 28, fontWeight: 700, margin: "0 0 8px" }}>WearWise hit a snag</p>
          <p style={{ fontSize: 15, lineHeight: 1.55, color: "#6d675c", margin: "0 0 24px" }}>
            The app couldn’t finish loading on this device. Reloading usually fixes it — and if it doesn’t, resetting the saved sign-in and theme will.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={() => window.location.reload()}
              style={{ minHeight: 44, padding: "10px 22px", borderRadius: 999, border: "none", background: "#9a7433", color: "#fffaf0", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              Reload WearWise
            </button>
            <button type="button" onClick={this.resetSavedState}
              style={{ minHeight: 44, padding: "10px 22px", borderRadius: 999, border: "1px solid #d8d0ba", background: "transparent", color: "#17150f", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Reset saved sign-in &amp; theme
            </button>
          </div>
        </div>
      </div>
    );
  }
}

const rootEl = document.querySelector<HTMLElement>("[data-generated-space-root]");
if (!rootEl) {
  throw new Error("missing generated space root element");
}

// If you edit this file: keep `<QueryClientProvider client={spaceQueryClient}>`
// wrapping the app (every space shares the SDK's QueryClient), and keep
// BOTH the `hatch-space-root` class AND the `data-hatch-space-root`
// attribute on the outer div. The SDK styles select on
// `.hatch-space-root[data-hatch-space-root]` to apply mobile safe-area
// insets (notches, gesture bars, etc.), correct viewport sizing, and the
// hosting header/chrome offsets — dropping either breaks layout silently.
createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={spaceQueryClient}>
      <div className="hatch-space-root" data-hatch-space-root>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
