import React, { useMemo } from "react";

export const SnowOverlay = React.memo(function SnowOverlay({ count }) {
  // Flake positions/timings only depend on `count`, so recompute them just
  // when the count actually changes rather than on every App re-render.
  const flakes = useMemo(() => {
    return Array.from({ length: count }, (_, index) => ({
      id: index,
      left: `${(index * 9973) % 100}%`,
      size: 8 + ((index * 7) % 12),
      duration: 6 + ((index * 13) % 10),
      delay: -((index * 17) % 12),
      opacity: 0.25 + (((index * 19) % 60) / 100),
    }));
  }, [count]);

  return (
    <div className="snow-overlay" aria-hidden="true">
      {flakes.map((flake) => (
        <span
          key={flake.id}
          style={{
            position: "absolute",
            top: "-10px",
            left: flake.left,
            fontSize: `${flake.size}px`,
            opacity: flake.opacity,
            color: "rgba(255,255,255,0.95)",
            textShadow: "0 0 8px rgba(255,255,255,0.95)",
            animation: `snowFall ${flake.duration}s linear ${flake.delay}s infinite`,
            userSelect: "none",
          }}
        >
          ❄
        </span>
      ))}
    </div>
  );
});
