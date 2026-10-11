import { useEffect, useMemo, useState } from "react";
import {
  closestCenter,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  pointerWithin,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arraySwap,
  rectSwappingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { Blocks, ChevronLeft, ChevronRight, Gauge, GripVertical, LayoutGrid, RotateCcw, Sparkles } from "lucide-react";
import {
  AUTO_GRID_COLUMN_START,
  AUTO_GRID_ROW_SPAN,
  MAX_GRID_COLUMN_SPAN,
  MAX_GRID_ROW_SPAN,
  normalizeGridColumnSpan,
  normalizeGridColumnStart,
  normalizeGridRowSpan,
  reconcileDashboardGrid,
} from "../../../shared/dashboard-grid";
import { normalizeDashboardColumnCount } from "../../../shared/layout";
import type { DashboardGridItem, DashboardGroup, DashboardSettings, DashboardWidget } from "../../../shared/types";
import { dashboardWidgetPlacement } from "../../../shared/widgets";
import { ServiceIcon } from "../../components/ServiceIcon";
import { Button, SelectField } from "./ui";

const preciseSwapCollision: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

interface DashboardLayoutEditorProps {
  groups: DashboardGroup[];
  widgets: DashboardWidget[];
  layout: DashboardGridItem[] | undefined;
  columnCount: number;
  density: DashboardSettings["density"];
  disabled?: boolean;
  onLayoutChange: (layout: DashboardGridItem[]) => void;
  onColumnCountChange: (columnCount: number) => void;
  onDensityChange: (density: DashboardSettings["density"]) => void;
  onSave: () => void;
}

function widgetName(widget: DashboardWidget): string {
  const label = typeof widget.config.label === "string" ? widget.config.label.trim() : "";
  if (label) return label;
  if (widget.type === "server-health") return "Server health";
  if (widget.type === "service-health") return "Service health";
  if (widget.type === "media-activity") return "Now playing";
  if (widget.type === "network-traffic") return "Network traffic";
  if (widget.type === "docker") return "Docker status";
  if (widget.type === "custom-api") return "Custom API";
  return widget.type;
}

function itemPreviewRows(item: DashboardGridItem, group?: DashboardGroup, widget?: DashboardWidget): number {
  if (item.rowSpan) return item.rowSpan * 68;
  if (group) return 58 + Math.min(group.services.length, 9) * 7;
  return widget?.type === "server-health" || widget?.type === "service-health" || widget?.type === "media-activity" || widget?.type === "network-traffic" ? 118 : 72;
}

function SortableLayoutItem({
  item,
  group,
  widget,
  columnCount,
  selected,
  disabled,
  onSelect,
}: {
  item: DashboardGridItem;
  group?: DashboardGroup;
  widget?: DashboardWidget;
  columnCount: number;
  selected: boolean;
  disabled?: boolean;
  onSelect: (id: string) => void;
}) {
  const sortable = useSortable({ id: item.id, disabled, animateLayoutChanges: () => false });
  const span = normalizeGridColumnSpan(item.columnSpan, columnCount);
  const start = normalizeGridColumnStart(item.columnStart, columnCount, span);
  const rows = normalizeGridRowSpan(item.rowSpan);
  const style = {
    gridColumn: start ? `${start} / span ${span}` : `span ${span}`,
    gridRowEnd: `span ${itemPreviewRows(item, group, widget)}`,
    transform: sortable.isDragging && sortable.transform
      ? `translate3d(${sortable.transform.x}px, ${sortable.transform.y}px, 0)`
      : undefined,
    transition: "none",
  } as React.CSSProperties;
  const label = group?.name ?? (widget ? widgetName(widget) : "Missing item");
  const detail = group
    ? `${group.services.length} ${group.services.length === 1 ? "service" : "services"}`
    : "Dashboard widget";

  return (
    <article
      ref={sortable.setNodeRef}
      className={[
        "admin-layout-item",
        item.kind === "widget" ? "admin-layout-item--widget" : "",
        selected ? "admin-layout-item--selected" : "",
        sortable.isOver && !sortable.isDragging ? "admin-layout-item--drop-target" : "",
        sortable.isDragging ? "admin-layout-item--dragging" : "",
      ].filter(Boolean).join(" ")}
      style={style}
      data-layout-item={item.id}
    >
      <div className="admin-layout-item__card">
        <button
          className="admin-layout-item__select"
          type="button"
          onClick={() => onSelect(item.id)}
          aria-pressed={selected}
          disabled={disabled}
        >
          {group?.icon.trim() ? (
            <ServiceIcon icon={group.icon} name={group.name} className="admin-layout-item__icon" />
          ) : (
            <span className="admin-layout-item__icon">{item.kind === "widget" ? <Gauge size={16} /> : <LayoutGrid size={16} />}</span>
          )}
          <span className="admin-layout-item__copy"><strong>{label}</strong><small>{detail}</small></span>
          <span className="admin-layout-item__meta">
            <em>{start ? `Column ${start}` : "Auto"}</em>
            <i>{span}×{rows || "auto"}</i>
          </span>
        </button>
        <button
          className="admin-layout-item__drag"
          type="button"
          aria-label={`Reorder ${label}`}
          disabled={disabled}
          {...sortable.attributes}
          {...sortable.listeners}
        >
          <GripVertical size={17} />
        </button>
      </div>
    </article>
  );
}

function ChoiceButtons({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  options: Array<{ value: number; label: string }>;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="admin-layout-choice">
      <span className="ui-field__label">{label}</span>
      <div role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={value === option.value ? "admin-layout-choice__active" : ""}
            onClick={() => onChange(option.value)}
            disabled={disabled}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DashboardLayoutEditor({
  groups,
  widgets,
  layout,
  columnCount,
  density,
  disabled,
  onLayoutChange,
  onColumnCountChange,
  onDensityChange,
  onSave,
}: DashboardLayoutEditorProps) {
  const columns = normalizeDashboardColumnCount(columnCount);
  const items = useMemo(
    () => reconcileDashboardGrid(layout, groups, widgets, columns),
    [columns, groups, layout, widgets],
  );
  const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const widgetsById = useMemo(
    () => new Map(widgets.filter((widget) => dashboardWidgetPlacement(widget.type) === "dashboard").map((widget) => [widget.id, widget])),
    [widgets],
  );
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? "");
  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (!items.some((item) => item.id === selectedId)) setSelectedId(items[0]?.id ?? "");
  }, [items, selectedId]);

  function updateItems(next: DashboardGridItem[]) {
    onLayoutChange(next.map((item, position) => ({ ...item, position })));
  }

  function changeColumns(nextValue: number) {
    const nextColumns = normalizeDashboardColumnCount(nextValue);
    onColumnCountChange(nextColumns);
    updateItems(items.map((item) => {
      const columnSpan = normalizeGridColumnSpan(item.columnSpan, nextColumns);
      return {
        ...item,
        columnSpan,
        columnStart: normalizeGridColumnStart(item.columnStart, nextColumns, columnSpan),
      };
    }));
  }

  function changeSelected(changes: Partial<Pick<DashboardGridItem, "columnSpan" | "columnStart" | "rowSpan">>) {
    if (!selected) return;
    updateItems(items.map((item) => item.id === selected.id ? { ...item, ...changes } : item));
  }

  function reorder(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const oldIndex = items.findIndex((item) => item.id === event.active.id);
    const newIndex = items.findIndex((item) => item.id === event.over?.id);
    if (oldIndex < 0 || newIndex < 0) return;
    updateItems(arraySwap(items, oldIndex, newIndex));
  }

  function moveSelected(direction: -1 | 1) {
    if (!selected) return;
    const index = items.findIndex((item) => item.id === selected.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return;
    updateItems(arraySwap(items, index, target));
  }

  function tightPack() {
    updateItems(items.map((item) => ({ ...item, columnStart: AUTO_GRID_COLUMN_START })));
  }

  function reset() {
    if (disabled || !window.confirm("Reset the board order and make every item one column wide with automatic height?")) return;
    updateItems(reconcileDashboardGrid(undefined, groups, widgets, columns).map((item) => ({
      ...item,
      columnSpan: item.kind === "widget" && ["server-health", "service-health", "media-activity", "network-traffic"].includes(widgetsById.get(item.referenceId)?.type ?? "") ? 2 : 1,
      columnStart: AUTO_GRID_COLUMN_START,
      rowSpan: item.kind === "widget" && ["server-health", "service-health", "media-activity", "network-traffic"].includes(widgetsById.get(item.referenceId)?.type ?? "") ? 2 : AUTO_GRID_ROW_SPAN,
    })));
  }

  const selectedWidth = selected ? normalizeGridColumnSpan(selected.columnSpan, columns) : 1;
  const selectedStart = selected ? normalizeGridColumnStart(selected.columnStart, columns, selectedWidth) : 0;
  const selectedHeight = selected ? normalizeGridRowSpan(selected.rowSpan) : 0;
  const selectedGroup = selected?.kind === "group" ? groupsById.get(selected.referenceId) : undefined;
  const selectedWidget = selected?.kind === "widget" ? widgetsById.get(selected.referenceId) : undefined;
  const selectedName = selectedGroup?.name ?? (selectedWidget ? widgetName(selectedWidget) : "Board item");

  return (
    <section className="admin-dashboard-layout-studio" aria-labelledby="dashboard-layout-heading">
      <header className="admin-layout-studio__header">
        <span>
          <small>Board layout</small>
          <h2 id="dashboard-layout-heading">Arrange groups and widgets together</h2>
          <p>Drag a card onto another card to swap their positions. The rest of the board stays still until you drop.</p>
        </span>
        <div>
          <Button variant="ghost" onClick={tightPack} disabled={disabled}><Sparkles size={14} /> Tight pack</Button>
          <Button variant="ghost" onClick={reset} disabled={disabled}><RotateCcw size={14} /> Reset</Button>
          <Button variant="primary" onClick={onSave} disabled={disabled}>{disabled ? "Saving…" : "Save layout"}</Button>
        </div>
      </header>

      <div className="admin-layout-studio__toolbar">
        <ChoiceButtons
          label="Board columns"
          value={columns}
          options={Array.from({ length: 6 }, (_, index) => ({ value: index + 1, label: String(index + 1) }))}
          disabled={disabled}
          onChange={changeColumns}
        />
        <SelectField
          label="Dashboard density"
          value={density}
          onChange={(value) => onDensityChange(value as DashboardSettings["density"])}
          disabled={disabled}
        >
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </SelectField>
      </div>

      <div className="admin-layout-studio__canvas">
        <div className="admin-layout-studio__ruler" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} aria-hidden="true">
          {Array.from({ length: columns }, (_, index) => <span key={index}>Column {index + 1}</span>)}
        </div>
        {items.length ? (
          <DndContext sensors={sensors} collisionDetection={preciseSwapCollision} onDragEnd={reorder}>
            <SortableContext items={items.map((item) => item.id)} strategy={rectSwappingStrategy}>
              <div className="admin-layout-studio__grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                {items.map((item) => (
                  <SortableLayoutItem
                    key={item.id}
                    item={item}
                    group={item.kind === "group" ? groupsById.get(item.referenceId) : undefined}
                    widget={item.kind === "widget" ? widgetsById.get(item.referenceId) : undefined}
                    columnCount={columns}
                    selected={item.id === selected?.id}
                    disabled={disabled}
                    onSelect={setSelectedId}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="admin-layout-studio__empty"><Blocks size={18} /> Add a group or dashboard widget to start arranging the board.</div>
        )}
      </div>

      {selected ? (
        <aside className="admin-layout-inspector" aria-label={`${selectedName} layout`}>
          <header>
            <span className="admin-layout-inspector__icon">{selected.kind === "widget" ? <Gauge size={16} /> : <LayoutGrid size={16} />}</span>
            <span>
              <strong>{selectedName}</strong>
              <small>{selected.kind === "widget" ? "Dashboard widget" : "Service group"}</small>
              <span className="admin-layout-inspector__move">
                <button type="button" onClick={() => moveSelected(-1)} disabled={disabled || selected.position <= 0}><ChevronLeft size={12} /> Earlier</button>
                <button type="button" onClick={() => moveSelected(1)} disabled={disabled || selected.position >= items.length - 1}>Later <ChevronRight size={12} /></button>
              </span>
            </span>
          </header>
          <ChoiceButtons
            label="Width"
            value={selectedWidth}
            options={Array.from({ length: Math.min(columns, MAX_GRID_COLUMN_SPAN) }, (_, index) => ({ value: index + 1, label: `${index + 1} column${index ? "s" : ""}` }))}
            disabled={disabled}
            onChange={(columnSpan) => changeSelected({ columnSpan, columnStart: normalizeGridColumnStart(selectedStart, columns, columnSpan) })}
          />
          <ChoiceButtons
            label="Height"
            value={selectedHeight}
            options={[
              { value: AUTO_GRID_ROW_SPAN, label: "Auto" },
              ...Array.from({ length: MAX_GRID_ROW_SPAN }, (_, index) => ({ value: index + 1, label: `${index + 1} row${index ? "s" : ""}` })),
            ]}
            disabled={disabled}
            onChange={(rowSpan) => changeSelected({ rowSpan })}
          />
          <ChoiceButtons
            label="Start column"
            value={selectedStart}
            options={[
              { value: AUTO_GRID_COLUMN_START, label: "Auto" },
              ...Array.from({ length: Math.max(1, columns - selectedWidth + 1) }, (_, index) => ({ value: index + 1, label: String(index + 1) })),
            ]}
            disabled={disabled}
            onChange={(columnStart) => changeSelected({ columnStart })}
          />
        </aside>
      ) : null}

      <p className="admin-layout-studio__note">Desktop keeps the saved board. Tablet reduces the available columns and mobile follows the same saved order in one column.</p>
    </section>
  );
}
