import type { ReactNode } from "react";

export interface Card { label: string; value: ReactNode; sub?: string; }

export function Cards({ cards }: { cards: Card[] }) {
  return (
    <div className="cards">
      {cards.map((c) => (
        <div className="card" key={c.label}>
          <div className="card-label">{c.label}</div>
          <div className="card-value">{c.value}</div>
          <div className="card-sub">{c.sub ?? " "}</div>
        </div>
      ))}
    </div>
  );
}
