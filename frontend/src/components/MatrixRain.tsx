import { useEffect, useRef } from "react";

const GLYPHS = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン0123456789ABCDEF<>/\\|=+-*";

const glyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!;

export function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let columns = 0;
    let drops: number[] = [];
    let speeds: number[] = [];
    const fontSize = 14;
    let raf = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      columns = Math.ceil(width / fontSize);
      drops = Array.from({ length: columns }, () => Math.random() * -50);
      speeds = Array.from({ length: columns }, () => 0.4 + Math.random() * 0.9);
      ctx.fillStyle = "#0a0e14";
      ctx.fillRect(0, 0, width, height);
    };

    const draw = () => {
      ctx.fillStyle = "rgba(10, 14, 20, 0.09)";
      ctx.fillRect(0, 0, width, height);
      ctx.font = `${fontSize}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.textBaseline = "top";

      for (let i = 0; i < columns; i++) {
        const char = glyph();
        const x = i * fontSize;
        const y = drops[i]! * fontSize;

        ctx.fillStyle = "rgba(45, 212, 191, 0.95)";
        ctx.shadowColor = "rgba(34, 211, 238, 0.9)";
        ctx.shadowBlur = 10;
        ctx.fillText(char, x, y);

        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(34, 197, 94, 0.55)";
        ctx.fillText(glyph(), x, y - fontSize);
        ctx.fillStyle = "rgba(20, 184, 133, 0.28)";
        ctx.fillText(glyph(), x, y - fontSize * 2);

        drops[i] = drops[i]! + speeds[i]!;
        if (y > height && Math.random() > 0.975) {
          drops[i] = Math.random() * -20;
          speeds[i] = 0.4 + Math.random() * 0.9;
        }
      }
      raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 z-0 block" aria-hidden="true" />;
}
