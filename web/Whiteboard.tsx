import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type Point = { x: number; y: number };
type Stroke = { color: string; size: number; erase: boolean; points: Point[] };
export type WhiteboardHandle = { exportPng: () => Promise<File | null> };
type Props = { disabled?: boolean; label: string };

function drawStrokes(context: CanvasRenderingContext2D, width: number, height: number, strokes: Stroke[]) {
  context.globalCompositeOperation = "source-over";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const stroke of strokes) {
    context.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";
    context.strokeStyle = stroke.color;
    context.lineWidth = Math.max(1, stroke.size * width);
    context.beginPath();
    stroke.points.forEach((point, index) => {
      const x = point.x * width;
      const y = point.y * height;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    if (stroke.points.length === 1) {
      const point = stroke.points[0]!;
      context.lineTo(point.x * width + 0.01, point.y * height);
    }
    context.stroke();
  }
  context.globalCompositeOperation = "destination-over";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.globalCompositeOperation = "source-over";
}

export const Whiteboard = forwardRef<WhiteboardHandle, Props>(function Whiteboard({ disabled = false, label }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const historyRef = useRef<Stroke[][]>([]);
  const drawingRef = useRef(false);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [color, setColor] = useState("#17232b");
  const [, setRevision] = useState(0);
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const ratio = canvas.width / canvas.getBoundingClientRect().width || 1;
    context.save();
    context.scale(ratio, ratio);
    drawStrokes(context, canvas.width / ratio, canvas.height / ratio, strokesRef.current);
    context.restore();
  }, []);
  const changed = () => setRevision((value) => value + 1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      redraw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    return () => observer.disconnect();
  }, [redraw]);

  useImperativeHandle(ref, () => ({
    exportPng: async () => {
      if (!strokesRef.current.length) return null;
      const canvas = canvasRef.current;
      const rect = canvas?.getBoundingClientRect();
      const sourceWidth = rect?.width || 900;
      const sourceHeight = rect?.height || 520;
      const scale = Math.min(1, 1000 / Math.max(sourceWidth, sourceHeight));
      const output = document.createElement("canvas");
      output.width = Math.max(1, Math.round(sourceWidth * scale));
      output.height = Math.max(1, Math.round(sourceHeight * scale));
      const context = output.getContext("2d");
      if (!context) throw new Error("Your browser could not export the whiteboard.");
      drawStrokes(context, output.width, output.height, strokesRef.current);
      const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Your browser could not export the whiteboard.");
      return new File([blob], "whiteboard.png", { type: "image/png" });
    },
  }), []);

  function point(event: ReactPointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }
  function start(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled || event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    historyRef.current.push(strokesRef.current);
    drawingRef.current = true;
    strokesRef.current = [...strokesRef.current, { color, size: tool === "eraser" ? 0.035 : 0.006, erase: tool === "eraser", points: [point(event)] }];
    changed(); redraw();
  }
  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || disabled) return;
    event.preventDefault();
    const current = strokesRef.current;
    const last = current[current.length - 1];
    if (!last) return;
    const updated = { ...last, points: [...last.points, point(event)] };
    strokesRef.current = [...current.slice(0, -1), updated];
    redraw();
  }
  function stop(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    changed();
  }
  function undo() {
    const previous = historyRef.current.pop();
    if (!previous) return;
    strokesRef.current = previous;
    changed(); redraw();
  }
  function clear() {
    if (!strokesRef.current.length) return;
    historyRef.current.push(strokesRef.current);
    strokesRef.current = [];
    changed(); redraw();
  }

  return <div className="whiteboard">
    <div className="whiteboard-toolbar" aria-label="Whiteboard tools">
      <button type="button" className={`button small ${tool === "pen" ? "primary" : "secondary"}`} onClick={() => setTool("pen")} disabled={disabled}>Pen</button>
      <button type="button" className={`button small ${tool === "eraser" ? "primary" : "secondary"}`} onClick={() => setTool("eraser")} disabled={disabled}>Eraser</button>
      {(["#17232b", "#1769aa", "#c43d3d"] as const).map((value, index) => <button key={value} type="button" className={`colour-button ${color === value && tool === "pen" ? "selected" : ""}`} style={{ background: value }} aria-label={`${["Black", "Blue", "Red"][index]} pen`} aria-pressed={color === value && tool === "pen"} onClick={() => { setColor(value); setTool("pen"); }} disabled={disabled} />)}
      <span className="toolbar-spacer" />
      <button type="button" className="button small secondary" onClick={undo} disabled={disabled || !historyRef.current.length}>Undo</button>
      <button type="button" className="button small secondary" onClick={clear} disabled={disabled || !strokesRef.current.length}>Clear</button>
    </div>
    <canvas ref={canvasRef} className="whiteboard-canvas" aria-label={label} onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} />
    <p className="muted whiteboard-hint">Draw with a mouse, finger, or stylus. Your whiteboard starts blank.</p>
  </div>;
});
