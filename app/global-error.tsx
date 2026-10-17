"use client";

// Last-resort boundary for errors thrown in the root layout. Must render its own <html>/<body>.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-IN">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f5f7f8", color: "#13201b" }}>
        <main style={{ display: "grid", minHeight: "100vh", placeItems: "center", padding: 24 }}>
          <div style={{ maxWidth: 420, textAlign: "center" }}>
            <h1 style={{ fontSize: 22, margin: 0 }}>The application failed to load</h1>
            <p style={{ color: "#64706b", fontSize: 14 }}>{error.message || "An unexpected error occurred."}</p>
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: 12,
                height: 44,
                padding: "0 20px",
                border: 0,
                borderRadius: 12,
                background: "#1b3c55",
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
