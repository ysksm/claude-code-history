import { fmt } from "../format";

// GitHub/GitLab-style diff stat: green +added, red −removed, and a 5-square bar
// showing the add/remove ratio.
export function DiffStat({ added, removed, bar = true }: {
  added: number; removed: number; bar?: boolean;
}) {
  if (!added && !removed) return null;
  const total = added + removed;
  const greens = total ? Math.round((added / total) * 5) : 0;
  return (
    <span className="diffstat">
      {added > 0 && <span className="add">+{fmt(added)}</span>}
      {removed > 0 && <span className="del">−{fmt(removed)}</span>}
      {bar && (
        <span className="diffbar" aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className={i < greens ? "sq sq-add" : "sq sq-del"} />
          ))}
        </span>
      )}
    </span>
  );
}
