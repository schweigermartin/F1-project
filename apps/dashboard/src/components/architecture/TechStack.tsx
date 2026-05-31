import type { ReactNode } from "react";

import { TECH_STACK } from "../../lib/architecture-data";

/** Grouped tech-stack cards with a one-line rationale per choice. */
export function TechStack(): ReactNode {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        gap: "1rem",
      }}
    >
      {TECH_STACK.map((cat) => (
        <section
          key={cat.title}
          style={{
            background: "#0e131b",
            border: "1px solid #1c2230",
            borderRadius: 10,
            padding: "1rem 1.1rem",
            borderTop: `3px solid ${cat.accent}`,
          }}
        >
          <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem" }}>{cat.title}</h3>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.6rem" }}>
            {cat.items.map((it) => (
              <li key={it.name}>
                <div style={{ fontSize: "0.88rem", fontWeight: 600 }}>{it.name}</div>
                <div style={{ fontSize: "0.8rem", color: "var(--muted)", lineHeight: 1.4 }}>
                  {it.why}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
