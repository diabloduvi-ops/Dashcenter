import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Monitor,
  Redo2,
  Save,
  Smartphone,
  Tablet,
  Undo2,
  X,
} from "lucide-react";
import type { DashboardData } from "../../../shared/types";
import { DashboardView, type DashboardPreviewMode } from "../../components/DashboardView";

interface DashboardTabProps {
  data: DashboardData;
  onCommit: (next: DashboardData, message?: string) => Promise<boolean>;
  onClose: () => void;
  onOpenServices: () => void;
  onOpenWidgets: () => void;
}

function cloneDashboard(data: DashboardData): DashboardData {
  return structuredClone(data);
}

function dashboardChanged(left: DashboardData, right: DashboardData): boolean {
  return JSON.stringify(left) !== JSON.stringify(right);
}

export function DashboardTab({
  data,
  onCommit,
  onClose,
  onOpenServices,
  onOpenWidgets,
}: DashboardTabProps) {
  const [baseline, setBaseline] = useState(() => cloneDashboard(data));
  const [draft, setDraft] = useState(() => cloneDashboard(data));
  const [past, setPast] = useState<DashboardData[]>([]);
  const [future, setFuture] = useState<DashboardData[]>([]);
  const [previewMode, setPreviewMode] = useState<DashboardPreviewMode>("desktop");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = useMemo(() => dashboardChanged(baseline, draft), [baseline, draft]);

  useEffect(() => {
    setBaseline(cloneDashboard(data));
    setDraft(cloneDashboard(data));
    setPast([]);
    setFuture([]);
    setError("");
  }, [data.revision]);

  function changeDraft(next: DashboardData) {
    setDraft((current) => {
      if (!dashboardChanged(current, next)) return current;
      setPast((history) => [...history, current].slice(-50));
      setFuture([]);
      setError("");
      return cloneDashboard(next);
    });
  }

  function undo() {
    if (!past.length || saving) return;
    const previous = past[past.length - 1];
    setPast((history) => history.slice(0, -1));
    setFuture((history) => [draft, ...history].slice(0, 50));
    setDraft(cloneDashboard(previous));
    setError("");
  }

  function redo() {
    if (!future.length || saving) return;
    const next = future[0];
    setPast((history) => [...history, draft].slice(-50));
    setFuture((history) => history.slice(1));
    setDraft(cloneDashboard(next));
    setError("");
  }

  function cancel() {
    if (saving) return;
    setDraft(cloneDashboard(baseline));
    setPast([]);
    setFuture([]);
    setError("");
  }

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setError("");
    try {
      const saved = await onCommit(draft, "Dashboard layout saved");
      if (!saved) {
        setError("Could not save the dashboard layout.");
        return;
      }
      setBaseline(cloneDashboard(draft));
      setPast([]);
      setFuture([]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not save the dashboard layout.");
    } finally {
      setSaving(false);
    }
  }

  const viewportOptions: Array<{ value: DashboardPreviewMode; label: string; icon: typeof Monitor }> = [
    { value: "desktop", label: "Desktop", icon: Monitor },
    { value: "tablet", label: "Tablet", icon: Tablet },
    { value: "mobile", label: "Mobile", icon: Smartphone },
  ];

  return (
    <section className="admin-dashboard-editor" aria-label="Dashboard layout workspace">
      <header className="admin-dashboard-editor__topbar">
        <span className="admin-dashboard-editor__title">
          <h1>Dashboard</h1>
          <small>Arrange services and widgets</small>
        </span>

        <div className="admin-dashboard-editor__viewports" role="radiogroup" aria-label="Dashboard preview size">
          {viewportOptions.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={previewMode === option.value}
                onClick={() => setPreviewMode(option.value)}
              >
                <Icon size={15} />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>

        <div className="admin-dashboard-editor__actions">
          <button className="ui-button ui-button--secondary" type="button" onClick={onClose} aria-label="Close editor" title="Close editor">
            <X size={16} /> Close editor
          </button>
          <button className="ui-button ui-button--primary" type="button" onClick={() => void save()} disabled={!dirty || saving}>
            <Save size={16} /> {saving ? "Saving…" : "Save layout"}
          </button>
        </div>
      </header>

      <div className="admin-dashboard-editor__body">
        <div className="admin-dashboard-editor__canvas-bar">
          <button type="button" onClick={undo} disabled={!past.length || saving} aria-label="Undo layout change"><Undo2 size={16} /></button>
          <button type="button" onClick={redo} disabled={!future.length || saving} aria-label="Redo layout change"><Redo2 size={16} /></button>
          <span className={dirty ? "is-dirty" : ""}>
            <CheckCircle2 size={14} />
            {saving ? "Saving layout…" : dirty ? "Unsaved changes" : "Layout saved on server"}
          </span>
          {dirty ? <button className="admin-dashboard-editor__cancel" type="button" onClick={cancel} disabled={saving}>Reset changes</button> : null}
        </div>

        <DashboardView
          data={draft}
          mode="workspace"
          previewMode={previewMode}
          onOpenSettings={onOpenWidgets}
          onManageServices={onOpenServices}
          onManageWidgets={onOpenWidgets}
          onRefresh={async () => undefined}
          editor={{
            active: true,
            saving,
            dirty,
            canUndo: past.length > 0,
            canRedo: future.length > 0,
            error,
            onChange: changeDraft,
            onUndo: undo,
            onRedo: redo,
            onCancel: cancel,
            onSave: () => void save(),
          }}
        />
      </div>
    </section>
  );
}
