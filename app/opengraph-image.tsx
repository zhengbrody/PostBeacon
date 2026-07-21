import { ImageResponse } from "next/og";

// Generated share card — no static asset to maintain; renders the brand in code.
// Node runtime, consistent with the rest of the app.
export const runtime = "nodejs";
export const alt = "PostBeacon — know the next growth move, then learn from it.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "80px",
        background: "radial-gradient(circle at 22% 12%, #1e1b4b 0%, #07070b 55%)",
        color: "#e9e9ee",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", fontSize: 36, fontWeight: 700, letterSpacing: -1 }}>
        <span>Post</span>
        <span style={{ color: "#a78bfa" }}>Beacon</span>
      </div>
      <div
        style={{
          marginTop: 44,
          fontSize: 70,
          fontWeight: 800,
          lineHeight: 1.05,
          letterSpacing: -2,
          maxWidth: 920,
          backgroundImage: "linear-gradient(90deg, #c4b5fd, #8b5cf6)",
          backgroundClip: "text",
          color: "transparent",
        }}
      >
        Know what to do next. Learn from what happens.
      </div>
      <div style={{ marginTop: 34, fontSize: 30, color: "#a1a1aa", maxWidth: 840 }}>
        Verified facts → one focused experiment → a real result → the next move.
      </div>
    </div>,
    { ...size }
  );
}
