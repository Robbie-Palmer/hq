import { beforeEach, describe, expect, it, vi } from "vitest";
import TableRoomCanvas from "@/components/wedding-planner/table-room-canvas";
import { seatTooltipAnchor } from "@/lib/wedding-planner/room-layout";
import { act, fireEvent, render, screen } from "@/tests/test-utils";

// Keep Konva's imperative boundary, while rendering without a native canvas in jsdom.
const scene = vi.hoisted(() => ({ nodes: [] as MockNode[] }));
type MockNode = {
  kind: string;
  props: Record<string, unknown>;
  position: (value?: { x: number; y: number }) => { x: number; y: number };
  x: () => number;
  y: () => number;
  rotation: (value?: number) => number;
  name: () => string;
  container: () => HTMLDivElement;
  getStage: () => MockNode;
  getPointerPosition: () => { x: number; y: number };
  find: (kind: string) => MockNode[];
  stopDrag: ReturnType<typeof vi.fn>;
  stopTransform: ReturnType<typeof vi.fn>;
  nodes: ReturnType<typeof vi.fn>;
};
vi.mock("react-konva", async () => {
  const React = await import("react");
  const component = (kind: string) =>
    React.forwardRef<MockNode, Record<string, unknown>>((props, ref) => {
      const element = React.useRef<HTMLDivElement>(null);
      const node = React.useRef<MockNode | null>(null);
      if (!node.current) {
        let position = { x: 0, y: 0 };
        let rotation = 0;
        node.current = {
          kind,
          props,
          position: (value) => {
            if (value) position = value;
            return position;
          },
          x: () => position.x,
          y: () => position.y,
          rotation: (value) => {
            if (value !== undefined) rotation = value;
            return rotation;
          },
          name: () => String(node.current?.props.name ?? ""),
          container: () => element.current as HTMLDivElement,
          getStage: () =>
            scene.nodes.find((item) => item.kind === "Stage") as MockNode,
          getPointerPosition: () => ({ x: 300, y: 180 }),
          find: (type) => scene.nodes.filter((item) => item.kind === type),
          stopDrag: vi.fn(),
          stopTransform: vi.fn(),
          nodes: vi.fn(),
        };
        scene.nodes.push(node.current);
      }
      node.current.props = props;
      node.current.position({
        x: Number(props.x ?? 0),
        y: Number(props.y ?? 0),
      });
      node.current.rotation(Number(props.rotation ?? 0));
      React.useImperativeHandle(ref, () => node.current as MockNode);
      return (
        <div ref={element} data-testid={kind}>
          {props.children as React.ReactNode}
        </div>
      );
    });
  return Object.fromEntries(
    [
      "Stage",
      "Layer",
      "Group",
      "Circle",
      "Path",
      "Rect",
      "Text",
      "Transformer",
    ].map((kind) => [kind, component(kind)]),
  );
});

function event(
  node: MockNode | undefined,
  handler: string,
  extra: Record<string, unknown> = {},
) {
  if (!node) throw new Error("Missing scene node");
  act(() =>
    (node.props[handler] as (event: unknown) => void)({
      target: node,
      cancelBubble: false,
      ...extra,
    }),
  );
}
function setup() {
  const onSelect = vi.fn();
  const onChange = vi.fn();
  const result = render(
    <TableRoomCanvas
      height={600}
      selectedId="top"
      onSelect={onSelect}
      onChange={onChange}
      tables={[
        {
          id: "top",
          capacity: 2,
          occupants: ["Alex"],
          appearance: { name: "", shape: "long", x: 500, y: 110, rotation: 0 },
        },
        {
          id: "table-1",
          capacity: 2,
          occupants: ["Blair"],
          appearance: {
            name: "Dublin",
            shape: "round",
            x: 170,
            y: 330,
            rotation: 90,
          },
        },
      ]}
    />,
  );
  return {
    ...result,
    onSelect,
    onChange,
    stage: scene.nodes.find((node) => node.kind === "Stage") as MockNode,
    table: scene.nodes.find(
      (node) => node.name() === "room-table-top",
    ) as MockNode,
    seats: scene.nodes.filter((node) => node.name() === "room-seat"),
  };
}
beforeEach(() => {
  scene.nodes = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600);
});

describe("room canvas interactions", () => {
  it("shows anchored names on hover and persistent tooltips on tap, dismissible with Escape or the floor", () => {
    const { seats, stage, onSelect } = setup();
    event(seats[0], "onMouseEnter");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Alex");
    expect(screen.getByRole("tooltip").style.left).toBe("259.2px");
    event(seats[0], "onMouseLeave");
    expect(screen.queryByRole("tooltip")).toBeNull();
    event(seats[0], "onTap");
    event(seats[0], "onMouseLeave");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Alex");
    expect(onSelect).toHaveBeenCalledWith("top");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    event(seats[1], "onClick");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Empty seat");
    event(stage, "onTap", {
      target: scene.nodes.find((node) => node.name() === "room-floor"),
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    event(seats[2], "onClick");
    event(stage, "onClick");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("saves bounded table moves and normalized rotations without propagating table drags", () => {
    const { table, onChange, onSelect } = setup();
    event(table, "onClick");
    event(table, "onTap");
    event(table, "onDragStart");
    expect(onSelect).toHaveBeenCalledWith("top");
    table.position({ x: 1200, y: -50 });
    event(table, "onDragMove");
    expect(table.position()).toEqual({ x: 900, y: 100 });
    event(table, "onDragEnd");
    expect(onChange).toHaveBeenLastCalledWith("top", { x: 900, y: 100 });
    table.rotation(-35);
    event(table, "onTransformEnd");
    expect(onChange).toHaveBeenLastCalledWith("top", {
      x: 900,
      y: 100,
      rotation: 325,
    });
    expect(
      scene.nodes.find((node) => node.kind === "Transformer")?.nodes,
    ).toHaveBeenCalledWith([table]);
    event(table, "onMouseEnter");
    expect(scene.nodes[0]?.container().style.cursor).toBe("grab");
    event(table, "onMouseLeave");
    expect(scene.nodes[0]?.container().style.cursor).toBe("default");
  });

  it("zooms with buttons and wheel, pans the background, and fits the room", () => {
    const { stage } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("125%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByText("100%")).toBeInTheDocument();
    event(stage, "onWheel", { evt: { preventDefault: vi.fn(), deltaY: -1 } });
    expect(screen.getByText("110%")).toBeInTheDocument();
    event(stage, "onWheel", { evt: { preventDefault: vi.fn(), deltaY: 1 } });
    stage.position({ x: 20, y: 30 });
    event(stage, "onDragStart");
    event(stage, "onDragEnd");
    expect(stage.props.x).toBe(20);
    expect(stage.props.y).toBe(30);
    fireEvent.click(screen.getByRole("button", { name: "Fit room" }));
    expect(stage.props.x).toBe(0);
    expect(stage.props.y).toBe(15);
  });

  it("pinches around the touch midpoint and suppresses table commits until all fingers lift", () => {
    const { container, stage, table, seats, onChange, onSelect } = setup();
    const canvas = container.querySelector(".room-map-canvas") as HTMLElement;
    event(seats[0], "onTap");
    const touches = (distance: number) => [
      { clientX: 300 - distance / 2, clientY: 180 },
      { clientX: 300 + distance / 2, clientY: 180 },
    ];
    fireEvent.touchStart(canvas, { touches: touches(100) });
    expect(stage.stopDrag).toHaveBeenCalled();
    expect(table.stopDrag).toHaveBeenCalled();
    expect(
      scene.nodes.find((node) => node.kind === "Transformer")?.stopTransform,
    ).toHaveBeenCalled();
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.touchMove(canvas, { touches: touches(200) });
    expect(screen.getByText("200%")).toBeInTheDocument();
    event(table, "onDragEnd");
    event(table, "onTransformEnd");
    event(stage, "onDragEnd");
    event(seats[0], "onTap");
    expect(onChange).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.touchEnd(canvas, { touches: [touches(100)[0]] });
    event(table, "onDragEnd");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.touchEnd(canvas, { touches: [] });
    event(table, "onDragEnd");
    expect(onChange).toHaveBeenCalled();
    fireEvent.touchMove(canvas, { touches: touches(100) });
    fireEvent.touchCancel(canvas, { touches: [] });
    fireEvent.touchStart(canvas, { touches: [touches(100)[0]] });
    fireEvent.touchStart(canvas, { touches: touches(0) });
  });
});

it("anchors tooltips to rotated seats through zoom and pan, bounded by the viewport", () => {
  expect(
    seatTooltipAnchor(
      { x: 500, y: 200, rotation: 90 },
      { x: 20, y: -48 },
      { x: 10, y: 30, scale: 0.5, width: 600, height: 400 },
    ),
  ).toEqual({ x: 284, y: 126 });
  expect(
    seatTooltipAnchor(
      { x: -500, y: -200, rotation: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0, scale: 1, width: 200, height: 360 },
    ),
  ).toEqual({ x: 100, y: 48 });
  expect(
    seatTooltipAnchor(
      { x: 1500, y: 1200, rotation: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0, scale: 1, width: 600, height: 360 },
    ),
  ).toEqual({ x: 480, y: 352 });
});
