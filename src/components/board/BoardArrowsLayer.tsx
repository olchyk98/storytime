import { useMemo } from "react";
import type { BoardArrowNode, BoardNode } from "../../types";

interface Props {
  nodes: BoardNode[];
  selectedIds: Set<string>;
  onSelect: (id: string, additive: boolean) => void;
  draftArrow: { x1: number; y1: number; x2: number; y2: number } | null;
}

// Given a target point and a rect, return the point on the rect's edge along
// the line from rect-center to the target. Used so arrowheads land on a
// node's edge instead of overlapping its body.
function rectEdgePoint(
  rect: { x: number; y: number; w: number; h: number },
  toX: number,
  toY: number
) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = toX - cx;
  const dy = toY - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const halfW = rect.w / 2;
  const halfH = rect.h / 2;
  const tx = dx === 0 ? Infinity : halfW / Math.abs(dx);
  const ty = dy === 0 ? Infinity : halfH / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}

export function BoardArrowsLayer({
  nodes,
  selectedIds,
  onSelect,
  draftArrow,
}: Props) {
  const nodesById = useMemo(() => {
    const m: Record<string, BoardNode> = {};
    for (const n of nodes) m[n.id] = n;
    return m;
  }, [nodes]);

  const arrows = useMemo(
    () => nodes.filter((n): n is BoardArrowNode => n.kind === "arrow"),
    [nodes]
  );

  // Compute world bounding box for the SVG canvas. We want an enormous canvas
  // so arrows render even if they extend off the visible viewport.
  // A simple, dependable approach: 20k x 20k centered at origin.
  const VIEW = 20000;

  return (
    <svg
      className="absolute pointer-events-none"
      width={VIEW}
      height={VIEW}
      style={{
        left: -VIEW / 2,
        top: -VIEW / 2,
        overflow: "visible",
      }}
      viewBox={`${-VIEW / 2} ${-VIEW / 2} ${VIEW} ${VIEW}`}
    >
      <defs>
        <marker
          id="arrowhead-default"
          markerWidth="12"
          markerHeight="12"
          refX="10"
          refY="6"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0,0 L0,12 L10,6 z" fill="#cbd5e1" />
        </marker>
        <marker
          id="arrowhead-selected"
          markerWidth="12"
          markerHeight="12"
          refX="10"
          refY="6"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0,0 L0,12 L10,6 z" fill="oklch(0.86 0.17 73)" />
        </marker>
        <marker
          id="arrowhead-draft"
          markerWidth="12"
          markerHeight="12"
          refX="10"
          refY="6"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0,0 L0,12 L10,6 z" fill="oklch(0.84 0.16 73)" opacity="0.7" />
        </marker>
      </defs>

      {arrows.map((a) => {
        const fromNode = a.fromNodeId ? nodesById[a.fromNodeId] : undefined;
        const toNode = a.toNodeId ? nodesById[a.toNodeId] : undefined;

        // Choose anchor coordinates: if attached, compute edge point.
        let x1 = a.x1;
        let y1 = a.y1;
        let x2 = a.x2;
        let y2 = a.y2;

        if (fromNode && toNode) {
          const fromCenter = {
            x: fromNode.x + fromNode.w / 2,
            y: fromNode.y + fromNode.h / 2,
          };
          const toCenter = {
            x: toNode.x + toNode.w / 2,
            y: toNode.y + toNode.h / 2,
          };
          const p1 = rectEdgePoint(fromNode, toCenter.x, toCenter.y);
          const p2 = rectEdgePoint(toNode, fromCenter.x, fromCenter.y);
          x1 = p1.x;
          y1 = p1.y;
          x2 = p2.x;
          y2 = p2.y;
        } else if (fromNode) {
          const p = rectEdgePoint(fromNode, a.x2, a.y2);
          x1 = p.x;
          y1 = p.y;
        } else if (toNode) {
          const p = rectEdgePoint(toNode, a.x1, a.y1);
          x2 = p.x;
          y2 = p.y;
        }

        const selected = selectedIds.has(a.id);

        return (
          <g
            key={a.id}
            style={{ pointerEvents: "auto", cursor: "pointer" }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect(a.id, e.shiftKey);
            }}
          >
            {/* Wide invisible hit area */}
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="transparent"
              strokeWidth={16}
            />
            {/* Visible line */}
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={selected ? "oklch(0.86 0.17 73)" : "#cbd5e1"}
              strokeWidth={selected ? 2.5 : 1.75}
              markerEnd={`url(#${selected ? "arrowhead-selected" : "arrowhead-default"})`}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}

      {draftArrow && (
        <line
          x1={draftArrow.x1}
          y1={draftArrow.y1}
          x2={draftArrow.x2}
          y2={draftArrow.y2}
          stroke="oklch(0.84 0.16 73)"
          strokeWidth={1.75}
          strokeDasharray="4 4"
          markerEnd="url(#arrowhead-draft)"
          vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: "none" }}
        />
      )}
    </svg>
  );
}
