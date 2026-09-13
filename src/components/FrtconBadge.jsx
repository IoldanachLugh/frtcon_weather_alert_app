export function FrtconBadge({ level }) {
  const validLevel = [1, 2, 3, 4, 5].includes(level) ? level : 5;

  return <span className={`frtcon-badge frtcon-badge--level-${validLevel}`}>FRTCON {validLevel}</span>;
}
