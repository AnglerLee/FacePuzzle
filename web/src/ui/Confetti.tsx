// 잭팟 색종이. CSS 애니메이션만 쓴다.
import { useMemo } from "react";

const COLORS = ["#ff6b8b", "#ffd23f", "#3ecf8e", "#3a86ff", "#8b5cf6", "#ff9f1c"];

export function Confetti({ seed }: { seed: number }) {
  const pieces = useMemo(() => {
    // 같은 seed 면 같은 모양 (렌더마다 바뀌지 않게)
    const rand = (i: number, k: number) => {
      const v = Math.sin(seed * 97.13 + i * 12.9898 + k * 78.233) * 43758.5453;
      return v - Math.floor(v);
    };
    return Array.from({ length: 70 }, (_, i) => ({
      id: i,
      left: rand(i, 1) * 100,
      delay: rand(i, 2) * 0.6,
      duration: 1.8 + rand(i, 3) * 1.4,
      rotate: rand(i, 4) * 360,
      color: COLORS[i % COLORS.length],
      size: 8 + rand(i, 5) * 8,
      drift: (rand(i, 6) - 0.5) * 120,
    }));
  }, [seed]);

  return (
    <div className="confetti" aria-hidden>
      {pieces.map((p) => (
        <span
          key={p.id}
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 0.6,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            ["--rot" as string]: `${p.rotate}deg`,
            ["--drift" as string]: `${p.drift}px`,
          }}
        />
      ))}
    </div>
  );
}
