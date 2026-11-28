/** M3أ/M3ب — path model derived from the existing `previewPath` string.
 *
 * The importer's SVGPathPen emits absolute M/L/C/Q/Z commands. No stable node
 * ids are persisted: they are derived deterministically as `c<contour>-n<node>`
 * every time the path is parsed. M3ب therefore writes only the existing
 * `previewPath`, `bounds`, `contours` and `segments` fields — the `.afsp` schema
 * is unchanged and Phase 0–8 files stay byte-compatible.
 */

export interface PathPoint {
  x: number;
  y: number;
}

export interface PathNode {
  id: string;
  /** Command of the segment that arrives at this node. */
  command: "M" | "L" | "C" | "Q";
  x: number;
  y: number;
  /** Second control point for C segments arriving here. */
  in: PathPoint | null;
  /** First control point for C, or the single control point for Q, leaving here. */
  out: PathPoint | null;
}

export interface PathContour {
  id: string;
  nodes: PathNode[];
  closed: boolean;
}

export interface PathModel {
  contours: PathContour[];
}

export interface Subpath {
  index: number;
  d: string;
  pointCount: number;
  curveCount: number;
  closed: boolean;
}

const COMMAND = /[AaCcHhLlMmQqSsTtVvZz]/g;
const POINTS_PER_COMMAND: Record<string, number> = {
  M: 1, m: 1, L: 1, l: 1, T: 1, t: 1, H: 1, h: 1, V: 1, v: 1, A: 1, a: 1,
  C: 3, c: 3, S: 2, s: 2, Q: 2, q: 2,
};
const FIRST_PAIR = /^\s*(-?\d*\.?\d+(?:e[-+]?\d+)?)[,\s]+(-?\d*\.?\d+(?:e[-+]?\d+)?)/i;
const NUMBER = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;

type Point = PathPoint;

function pairs(token: string, count: number): Point[] {
  const nums = token.slice(1).match(NUMBER)?.map(Number) ?? [];
  const result: Point[] = [];
  for (let i = 0; i + 1 < nums.length && result.length < count; i += 2) {
    result.push({ x: nums[i], y: nums[i + 1] });
  }
  return result.length === count ? result : [];
}

function reflect(around: Point, point: Point): Point {
  return { x: 2 * around.x - point.x, y: 2 * around.y - point.y };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function renderPoint(point: Point): string {
  return `${round(point.x)} ${round(point.y)}`;
}

/** Splits on moveto commands (M3أ display-only behaviour). */
export function splitSubpaths(d: string): Subpath[] {
  const source = d.trim();
  if (!source) return [];
  const tokens = source.match(/[AaCcHhLlMmQqSsTtVvZz][^AaCcHhLlMmQqSsTtVvZz]*/g) ?? [];
  const result: Subpath[] = [];
  let last: [number, number] = [0, 0];
  let current = "";
  let closed = false;
  const flush = () => {
    if (!current.trim()) return;
    const commands = current.match(COMMAND) ?? [];
    result.push({
      index: result.length,
      d: current.trim(),
      pointCount: commands.reduce((sum, key) => sum + (POINTS_PER_COMMAND[key] ?? 0), 0),
      curveCount: commands.filter((key) => "CcSsQqAa".includes(key)).length,
      closed,
    });
    current = "";
    closed = false;
  };
  for (const token of tokens) {
    const command = token[0];
    if (command === "M" || command === "m" || closed) flush();
    let normalised = token;
    if (command === "M" || command === "m") {
      const pair = token.slice(1).match(FIRST_PAIR);
      if (pair) {
        const x = command === "m" ? last[0] + Number(pair[1]) : Number(pair[1]);
        const y = command === "m" ? last[1] + Number(pair[2]) : Number(pair[2]);
        last = [x, y];
        normalised = `M${x} ${y}${token.slice(1 + pair[0].length)}`;
      }
    }
    current += normalised;
    if (command === "Z" || command === "z") closed = true;
  }
  flush();
  return result;
}

/** Display-only offset helper; never written back before DATA-GATE. */
export function subpathTransform(dx: number, dy: number): string {
  return `translate(${dx} ${dy})`;
}

/** Parses an absolute SVG path into contours with stable, derived node ids. */
export function parsePathModel(d: string): PathModel {
  const source = d.trim();
  if (!source) return { contours: [] };
  const tokens = source.match(/[MmLlHhVvCcSsQqTtZz][^MmLlHhVvCcSsQqTtZz]*/g) ?? [];
  const contours: PathContour[] = [];
  let nodes: PathNode[] = [];
  let closed = false;
  let last: Point = { x: 0, y: 0 };
  let lastCtrl: Point | null = null;
  let lastCommand = "";

  const nodeId = (index: number) => `c${contours.length}-n${index}`;
  const flush = () => {
    if (nodes.length > 0) {
      contours.push({ id: `c${contours.length}`, nodes, closed });
    }
    nodes = [];
    closed = false;
    lastCtrl = null;
    lastCommand = "";
  };
  const add = (command: PathNode["command"], point: Point, input: Point | null, output: Point | null = null) => {
    nodes.push({ id: nodeId(nodes.length), command, x: point.x, y: point.y, in: input, out: output });
    last = point;
  };

  for (const token of tokens) {
    const command = token[0];
    const upper = command.toUpperCase();
    // The importer writes absolute coordinates; relative commands are folded
    // into the current point so a pasted path still produces valid geometry.
    if (upper === "M") {
      const values = pairs(token, 1);
      const point = values[0];
      if (!point) continue;
      if (command === "m") {
        point.x += last.x;
        point.y += last.y;
      }
      flush();
      add("M", point, null);
      lastCommand = "M";
      continue;
    }
    if (upper === "Z") {
      closed = true;
      flush();
      continue;
    }
    if (upper === "L" || upper === "H" || upper === "V") {
      const numbers = token.slice(1).match(NUMBER)?.map(Number) ?? [];
      if (numbers.length === 0) continue;
      let target: Point;
      if (upper === "L") {
        if (numbers.length < 2) continue;
        target = { x: numbers[0], y: numbers[1] };
        if (command === "l") target = { x: last.x + target.x, y: last.y + target.y };
      } else if (upper === "H") {
        target = { x: command === "h" ? last.x + numbers[0] : numbers[0], y: last.y };
      } else {
        target = { x: last.x, y: command === "v" ? last.y + numbers[0] : numbers[0] };
      }
      if (nodes.length === 0) add("M", target, null);
      else add("L", target, null);
      lastCtrl = null;
      lastCommand = "L";
      continue;
    }
    if (upper === "C" || upper === "S") {
      const isSmooth = upper === "S";
      const values = pairs(token, isSmooth ? 2 : 3);
      if (values.length === 0) continue;
      const previous = nodes[nodes.length - 1] ?? null;
      const c1 = isSmooth
        ? lastCommand === "C" || lastCommand === "S"
          ? reflect(last, lastCtrl ?? last)
          : { ...last }
        : values[0];
      const c2 = isSmooth ? values[0] : values[1];
      const end = isSmooth ? values[1] : values[2];
      if (command === "c" || command === "s") {
        c1.x += last.x; c1.y += last.y;
        c2.x += last.x; c2.y += last.y;
        end.x += last.x; end.y += last.y;
      }
      if (previous) previous.out = c1;
      if (nodes.length === 0) add("M", end, null);
      else add("C", end, c2);
      lastCtrl = c2;
      lastCommand = "C";
      continue;
    }
    if (upper === "Q" || upper === "T") {
      const isSmooth = upper === "T";
      const values = pairs(token, isSmooth ? 1 : 2);
      if (values.length === 0) continue;
      const ctrl: Point = isSmooth
        ? lastCommand === "Q" || lastCommand === "T"
          ? reflect(last, lastCtrl ?? last)
          : { ...last }
        : values[0];
      const end = isSmooth ? values[0] : values[1];
      if (command === "q" || command === "t") {
        ctrl.x += last.x; ctrl.y += last.y;
        end.x += last.x; end.y += last.y;
      }
      const previous = nodes[nodes.length - 1] ?? null;
      if (previous) previous.out = ctrl;
      if (nodes.length === 0) add("M", end, null);
      else add("Q", end, null);
      lastCtrl = ctrl;
      lastCommand = "Q";
      continue;
    }
  }
  flush();
  return { contours };
}

/** Serializes back to the same absolute command dialect the importer uses. */
export function serializePathModel(model: PathModel): string {
  const chunks: string[] = [];
  for (const contour of model.contours) {
    if (contour.nodes.length === 0) continue;
    const [first, ...rest] = contour.nodes;
    const parts = [`M${renderPoint(first)}`];
    for (const node of rest) {
      const previous = contour.nodes[contour.nodes.indexOf(node) - 1];
      if (node.command === "C") {
        const c1 = previous?.out ?? previous ?? node;
        const c2 = node.in ?? node;
        parts.push(`C${renderPoint(c1)} ${renderPoint(c2)} ${renderPoint(node)}`);
      } else if (node.command === "Q") {
        const ctrl = previous?.out ?? previous ?? node;
        parts.push(`Q${renderPoint(ctrl)} ${renderPoint(node)}`);
      } else {
        parts.push(`L${renderPoint(node)}`);
      }
    }
    if (contour.closed) parts.push("Z");
    chunks.push(parts.join(" "));
  }
  return chunks.join(" ");
}

export function findNode(model: PathModel, id: string): PathNode | null {
  for (const contour of model.contours) {
    const node = contour.nodes.find((item) => item.id === id);
    if (node) return node;
  }
  return null;
}

export function translateNode(model: PathModel, id: string, dx: number, dy: number): PathModel {
  return {
    contours: model.contours.map((contour) => ({
      ...contour,
      nodes: contour.nodes.map((node) => {
        if (node.id !== id) return node;
        return {
          ...node,
          x: node.x + dx,
          y: node.y + dy,
          in: node.in ? { x: node.in.x + dx, y: node.in.y + dy } : null,
          out: node.out ? { x: node.out.x + dx, y: node.out.y + dy } : null,
        };
      }),
    })),
  };
}

/** Moves one Bezier control handle; `-in` and `-out` ids are supported. */
export function translateHandle(model: PathModel, id: string, dx: number, dy: number): PathModel {
  const match = /^(c\d+-n\d+)-(in|out)$/.exec(id);
  if (!match) return model;
  return {
    contours: model.contours.map((contour) => ({
      ...contour,
      nodes: contour.nodes.map((node) => {
        if (node.id !== match[1]) return node;
        const key = match[2] as "in" | "out";
        const point = node[key];
        if (!point) return node;
        return { ...node, [key]: { x: point.x + dx, y: point.y + dy } };
      }),
    })),
  };
}

export function reverseContour(model: PathModel, contourId: string): PathModel {
  return {
    contours: model.contours.map((contour) => {
      if (contour.id !== contourId || contour.nodes.length < 2) return contour;
      const reversed = contour.nodes.slice().reverse().map((node, index) => ({
        ...node,
        id: `${contour.id}-n${index}`,
        command: (index === 0 ? "M" : contour.nodes[contour.nodes.length - 1 - index].command) as PathNode["command"],
        in: node.out,
        out: node.in,
      }));
      return { ...contour, nodes: reversed };
    }),
  };
}

/** Removes redundant collinear/d duplicate line nodes without touching curves. */
export function simplifyPath(model: PathModel, tolerance = 0.5): PathModel {
  return {
    contours: model.contours.map((contour) => {
      if (contour.nodes.length <= 2) return contour;
      const kept: PathNode[] = [];
      contour.nodes.forEach((node, index) => {
        if (index > 0 && node.command === "L") {
          const previous = contour.nodes[index - 1];
          const next = contour.nodes[index + 1] ?? (contour.closed ? contour.nodes[0] : null);
          if (next) {
            const dx = next.x - previous.x;
            const dy = next.y - previous.y;
            const length = Math.hypot(dx, dy);
            const area = Math.abs(dy * node.x - dx * node.y + next.x * previous.y - next.y * previous.x);
            if (length < 1e-6 || area / length <= tolerance) {
              // Preserve an outgoing control point so the next curve keeps its shape.
              if (node.out && kept.length > 0 && !kept[kept.length - 1].out) {
                kept[kept.length - 1] = { ...kept[kept.length - 1], out: node.out };
              }
              return;
            }
          }
        }
        kept.push(node);
      });
      return {
        ...contour,
        nodes: kept.map((node, index) => ({ ...node, id: `${contour.id}-n${index}` })),
      };
    }),
  };
}

export function pathModelBounds(model: PathModel): [number, number, number, number] {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const contour of model.contours) {
    for (const node of contour.nodes) {
      xs.push(node.x, node.in?.x ?? node.x, node.out?.x ?? node.x);
      ys.push(node.y, node.in?.y ?? node.y, node.out?.y ?? node.y);
    }
  }
  if (xs.length === 0) return [0, 0, 0, 0];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function pathModelCounts(model: PathModel): { contours: number; segments: number } {
  return {
    contours: model.contours.length,
    segments: model.contours.reduce(
      (sum, contour) => sum + Math.max(0, contour.nodes.length - 1) + (contour.closed ? 1 : 0),
      0,
    ),
  };
}
