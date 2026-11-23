"use client";
import { useEffect, useRef, useState } from "react";

// Shows the report in a sandboxed frame. Some browsers (including some embedded ones) block
// sandboxed frames but still fire "load", leaving a blank box. So the report itself posts
// "report-ready" when it runs; if that message doesn't arrive, offer the report as a full page.
export default function MapFrame({ src, title }) {
  const [state, setState] = useState("loading"); // loading | ready | blocked
  const frame = useRef(null);
  useEffect(() => {
    setState("loading");
    const onMessage = (e) => {
      if (e.source === frame.current?.contentWindow && e.data?.plainsight === "report-ready") setState("ready");
    };
    window.addEventListener("message", onMessage);
    const t = setTimeout(() => setState((s) => (s === "ready" ? s : "blocked")), 8000);
    return () => { window.removeEventListener("message", onMessage); clearTimeout(t); };
  }, [src]);
  return (
    <div style={{ position: "relative" }}>
      {/* sandboxed without same-origin: the report can't read this site's cookies, even if a scanned repo tried to inject script */}
      <iframe ref={frame} className="frame" title={title} src={src} sandbox="allow-scripts allow-popups allow-downloads" allow="clipboard-write" />
      {state !== "ready" && (
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
