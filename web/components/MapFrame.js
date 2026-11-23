"use client";
import { useEffect, useRef, useState } from "react";

// Shows the report in a sandboxed frame. Some browsers (including some embedded ones) refuse to
// load sandboxed frames and leave a blank box, so if the frame hasn't loaded in a few seconds,
// offer the same report as a full page instead.
export default function MapFrame({ src, title }) {
  const [state, setState] = useState("loading"); // loading | loaded | blocked
  const loaded = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => { if (!loaded.current) setState("blocked"); }, 8000);
    return () => clearTimeout(t);
  }, [src]);
  return (
    <div style={{ position: "relative" }}>
      {/* sandboxed without same-origin: the report can't read this site's cookies, even if a scanned repo tried to inject script */}
      <iframe className="frame" title={title} src={src} sandbox="allow-scripts allow-popups allow-downloads" allow="clipboard-write"
        onLoad={() => { loaded.current = true; setState("loaded"); }} />
      {state !== "loaded" && (
        <div className="frame-overlay" role="status">
          {state === "loading" ? <p className="muted">Drawing the map…</p> : (
            <div className="stack" style={{ justifyItems: "center", textAlign: "center", maxWidth: 420 }}>
              <p style={{ margin: 0 }}>This browser didn't show the map inside the page.</p>
              <a className="btn primary" href={src} target="_blank" rel="noopener">Open the map</a>
              <p className="muted small" style={{ margin: 0 }}>It opens as its own page, with the same protections.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
