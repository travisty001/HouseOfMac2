export function makeEdgeMap(imageData) {
  const { width, height, data } = imageData;
  const luma = new Float32Array(width * height);
  for (let i = 0; i < luma.length; i++) {
    luma[i] = .2126 * data[i * 4] + .7152 * data[i * 4 + 1] + .0722 * data[i * 4 + 2];
  }
  const strength = new Float32Array(luma.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      strength[i] = Math.hypot(luma[i + 1] - luma[i - 1], luma[i + width] - luma[i - width]);
    }
  }
  return { width, height, strength };
}

export function snapPoint(point, map, radius) {
  if (!map) return point;
  const { width, height, strength } = map;
  let best = point, bestScore = 12;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = Math.round(point.x + dx), y = Math.round(point.y + dy);
      const distance = Math.hypot(dx, dy);
      if (distance > radius || x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
      const score = strength[y * width + x] - 2.5 * distance;
      if (score > bestScore) { best = { x, y }; bestScore = score; }
    }
  }
  return best;
}

export function traceEdge(a, b, map, radius) {
  if (!map) return [a, b];
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  const steps = Math.ceil(length / 3);
  if (steps < 2) return [a, b];
  const span = Math.min(22, radius), states = span * 2 + 1;
  const position = (step, state) => ({
    x: a.x + dx * step / steps - dy / length * (state - span),
    y: a.y + dy * step / steps + dx / length * (state - span),
  });
  const previous = new Int16Array(steps * states).fill(-1);
  let costs = new Float64Array(states).fill(Infinity);
  costs[span] = 0;
  for (let step = 1; step < steps; step++) {
    const next = new Float64Array(states).fill(Infinity);
    for (let state = 0; state < states; state++) {
      const point = position(step, state), x = Math.round(point.x), y = Math.round(point.y);
      if (x < 1 || y < 1 || x >= map.width - 1 || y >= map.height - 1) continue;
      const strength = map.strength[y * map.width + x];
      const penalty = 2.5 / (1 + strength / 18) + Math.abs(state - span) * .012;
      for (let prior = Math.max(0, state - 3); prior <= Math.min(states - 1, state + 3); prior++) {
        if (steps - step === 1 && Math.abs(state - span) > 3) continue;
        const cost = costs[prior] + penalty + Math.abs(state - prior) * .15;
        if (cost < next[state]) {
          next[state] = cost;
          previous[step * states + state] = prior;
        }
      }
    }
    costs = next;
  }
  let state = costs.indexOf(Math.min(...costs));
  if (!Number.isFinite(costs[state])) return [a, b];
  const path = [b];
  for (let step = steps - 1; step > 0; step--) {
    path.push(position(step, state));
    state = previous[step * states + state];
  }
  path.push(a);
  return path.reverse();
}

export function paintMark(ctx, mark, number) {
  const { points, type, color, width, text, fill } = mark;
  if (!points.length) return;
  const start = points[0], end = points.at(-1);
  ctx.lineJoin = ctx.lineCap = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  if (type === 'outline') {
    if (mark.closed) ctx.closePath();
    if (mark.closed && fill) {
      ctx.globalAlpha = .23;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  ctx.stroke();
  if (type === 'arrow' && points.length > 1) {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const length = Math.max(11, width * 4);
    ctx.beginPath();
    ctx.moveTo(end.x - length * Math.cos(angle - .45), end.y - length * Math.sin(angle - .45));
    ctx.lineTo(end.x, end.y);
    ctx.lineTo(end.x - length * Math.cos(angle + .45), end.y - length * Math.sin(angle + .45));
    ctx.stroke();
  }
  if (type === 'pin') {
    ctx.beginPath();
    ctx.arc(start.x, start.y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111111';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(number), start.x, start.y);
  }
  if (!text) return;
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const x = Math.max(2, Math.min(end.x + 13, ctx.canvas.width - ctx.measureText(text).width - 8));
  const y = Math.max(11, Math.min(end.y - 8, ctx.canvas.height - 11));
  ctx.strokeStyle = '#151515';
  ctx.lineWidth = 4;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x, y);
}

export function validateAnnotationProject(project) {
  const validPoint = p => Number.isFinite(p?.x) && Number.isFinite(p?.y);
  if (project?.version !== 1 || typeof project.specimen !== 'string' ||
      typeof project.image !== 'string' || !/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(project.image) ||
      !Array.isArray(project.marks) || project.marks.length > 1000 ||
      !project.marks.every(mark => ['outline', 'arrow', 'pin'].includes(mark?.type) &&
        ['text', 'notes', 'confidence'].every(key => typeof mark[key] === 'string') &&
        /^#[a-f0-9]{6}$/i.test(mark.color) && mark.width >= 1 && mark.width <= 8 &&
        Array.isArray(mark.points) && mark.points.length && mark.points.every(validPoint))) {
    throw new Error('Choose an annotation project exported by House of Mac.');
  }
  return project;
}
