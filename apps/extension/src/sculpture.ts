/** The Qlyphs film's point sculpture, adapted to a small, local canvas.
 * No video downloads, WebGL, or perpetual animation. The first reveal settles in 1.2s; returning to it stays still,
 * and a `data-sculpture="still"` canvas never replays the reveal its previous screen just showed.
 */
interface Point {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  block?: boolean;
}
function sculpturePoints(): Point[] {
  const points: Point[] = [],
    rings = 96,
    sections = 26,
    major = 1.48,
    tube = 0.43;
  for (let i = 0; i <= rings; i++) {
    const u = Math.PI / 2 + (i / rings) * Math.PI * 1.5;
    for (let j = 0; j < sections; j++) {
      const v = ((j + (i % 2) * 0.5) / sections) * Math.PI * 2,
        r = major + tube * Math.cos(v);
      points.push({
        x: r * Math.cos(u),
        y: r * Math.sin(u),
        z: tube * Math.sin(v),
        nx: Math.cos(v) * Math.cos(u),
        ny: Math.cos(v) * Math.sin(u),
        nz: Math.sin(v),
      });
    }
  }
  for (const u of [Math.PI / 2, Math.PI * 2])
    for (let ring = 0; ring < 7; ring++) {
      const r = (ring / 7) * tube,
        count = Math.max(1, ring * 6);
      for (let j = 0; j < count; j++) {
        const v = (j / count) * Math.PI * 2,
          sign = u === Math.PI / 2 ? -1 : 1;
        points.push({
          x: (major + r * Math.cos(v)) * Math.cos(u),
          y: (major + r * Math.cos(v)) * Math.sin(u),
          z: r * Math.sin(v),
          nx: -Math.sin(u) * sign,
          ny: Math.cos(u) * sign,
          nz: 0,
        });
      }
    }
  const steps = 9;
  for (let axis = 0; axis < 3; axis++)
    for (const sign of [-1, 1])
      for (let i = 0; i < steps; i++)
        for (let j = 0; j < steps; j++) {
          const p = [0, 0, 0];
          p[axis] = sign * 0.36;
          p[(axis + 1) % 3] = ((i + 0.5) / steps - 0.5) * 0.72;
          p[(axis + 2) % 3] = ((j + 0.5) / steps - 0.5) * 0.72;
          const core = p.map((v) => Math.max(-0.25, Math.min(0.25, v))),
            normal = p.map((v, k) => v - core[k]!);
          const length = Math.hypot(...normal),
            n = normal.map((v) => v / length);
          points.push({
            x: 1.29 + core[0]! + n[0]! * 0.11,
            y: 1.29 + core[1]! + n[1]! * 0.11,
            z: core[2]! + n[2]! * 0.11,
            nx: n[0]!,
            ny: n[1]!,
            nz: n[2]!,
            block: true,
          });
        }
  return points;
}

export function mountSculptures() {
  const points = sculpturePoints();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const cleanups: (() => void)[] = [];
  for (const canvas of document.querySelectorAll<HTMLCanvasElement>('canvas[data-sculpture]')) {
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    let frame = 0,
      start = 0,
      visible = false,
      played = false;
    const draw = (time: number) => {
      frame = 0;
      if (!visible || document.hidden) return;
      const width = canvas.clientWidth,
        height = canvas.clientHeight;
      if (!width || !height) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const t = reduced.matches ? 1 : Math.min(1, (time - start) / 1200);
      const ease = 1 - Math.pow(1 - t, 4),
        turn = -0.35 + (1 - ease) * 0.7,
        tilt = 0.32,
        roll = -0.2;
      const cx = Math.cos(tilt),
        sx = Math.sin(tilt),
        cy = Math.cos(turn),
        sy = Math.sin(turn),
        cz = Math.cos(roll),
        sz = Math.sin(roll);
      const m = [
        cy * cz,
        sx * sy * cz - cx * sz,
        cx * sy * cz + sx * sz,
        cy * sz,
        sx * sy * sz + cx * cz,
        cx * sy * sz - sx * cz,
        -sy,
        sx * cy,
        cx * cy,
      ];
      const scale = height / 4.8;
      const projected = points
        .map((p, i) => {
          const x = m[0]! * p.x + m[1]! * p.y + m[2]! * p.z,
            y = m[3]! * p.x + m[4]! * p.y + m[5]! * p.z,
            z = m[6]! * p.x + m[7]! * p.y + m[8]! * p.z;
          const nz = m[6]! * p.nx + m[7]! * p.ny + m[8]! * p.nz;
          const birth = reduced.matches
            ? 1
            : Math.max(0, Math.min(1, (t * 2.9 - (p.block ? 1.2 : i / points.length)) / 0.5));
          return {
            x: width / 2 + (x * scale * 7) / (7 - z),
            y: height / 2 + (y * scale * 7) / (7 - z),
            z,
            nz,
            birth,
          };
        })
        .sort((a, b) => a.z - b.z);
      for (const p of projected) {
        ctx.fillStyle = `rgba(255,${Math.round(115 + Math.max(0, p.nz) * 75)},${Math.round(62 + Math.max(0, p.nz) * 60)},${(0.25 + Math.max(0, p.nz) * 0.6) * p.birth})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 0.65 + Math.max(0, p.nz) * 0.15, 0, Math.PI * 2);
        ctx.fill();
      }
      if (t < 1) frame = requestAnimationFrame(draw);
    };
    const restart = () => {
      cancelAnimationFrame(frame);
      start =
        played || canvas.dataset.sculpture === 'still' ? performance.now() - 1200 : performance.now();
      played = true;
      frame = requestAnimationFrame(draw);
    };
    const observer = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      if (visible) restart();
      else cancelAnimationFrame(frame);
    });
    observer.observe(canvas);
    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(frame);
      else if (visible) restart();
    };
    document.addEventListener('visibilitychange', onVisibility);
    reduced.addEventListener('change', restart);
    cleanups.push(() => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      reduced.removeEventListener('change', restart);
    });
  }
  window.addEventListener('pagehide', () => cleanups.forEach((cleanup) => cleanup()), {
    once: true,
  });
}
