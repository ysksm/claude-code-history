import { saveModel, type ValueModel } from "../valueModel";

// Inline editor for the value-estimate assumptions. Auto-saves to localStorage.
export function ValueModelEditor({ model, onChange }: {
  model: ValueModel; onChange: (m: ValueModel) => void;
}) {
  const set = (patch: Partial<ValueModel>) => {
    const next = { ...model, ...patch };
    saveModel(next);
    onChange(next);
  };
  return (
    <span className="value-model">
      <span className="muted">効果試算:</span>
      <input type="number" min={1} value={model.linesPerHour}
        onChange={(e) => set({ linesPerHour: Number(e.target.value) })} />
      <span className="muted">行/時 ×</span>
      <input type="text" className="cur" value={model.currency}
        onChange={(e) => set({ currency: e.target.value })} />
      <input type="number" min={0} step={100} value={model.ratePerHour}
        onChange={(e) => set({ ratePerHour: Number(e.target.value) })} />
      <span className="muted">/時</span>
    </span>
  );
}
