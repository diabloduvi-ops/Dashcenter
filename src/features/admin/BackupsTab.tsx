import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  DatabaseBackup,
  Download,
  FileJson2,
  History,
  RefreshCw,
  RotateCcw,
  Upload,
} from "lucide-react";
import type { DashboardData, RevisionSummary } from "../../../shared/types";
import { apiRequest, loadRevisions, restoreRevision } from "./api";
import { Button, ConfirmDialog, EmptyState, Notice } from "./ui";

interface BackupsTabProps {
  data: DashboardData;
  onDataChange: (next: DashboardData) => void;
  onRefresh: () => Promise<void>;
  notify: (message: string, kind?: "success" | "error") => void;
}

interface RestorePreview {
  fileName: string;
  payload: unknown;
  dashboard: DashboardData;
}

function extractDashboard(payload: unknown): DashboardData | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const possible = (record.dashboard && typeof record.dashboard === "object" ? record.dashboard : payload) as Partial<DashboardData>;
  if (!possible.settings || !Array.isArray(possible.groups) || !Array.isArray(possible.widgets) || !Array.isArray(possible.connections)) return null;
  return possible as DashboardData;
}

function formatRevisionDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function BackupsTab({ data, onDataChange, onRefresh, notify }: BackupsTabProps) {
  const [section, setSection] = useState<"backup" | "history">("backup");
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
  const [loadingRevisions, setLoadingRevisions] = useState(true);
  const [busyRevision, setBusyRevision] = useState<number | null>(null);
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingRestore, setPendingRestore] = useState<{ type: "backup" } | { type: "revision"; revision: RevisionSummary } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshRevisions = useCallback(async () => {
    setLoadingRevisions(true);
    try {
      setRevisions(await loadRevisions());
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load revision history.");
    } finally {
      setLoadingRevisions(false);
    }
  }, []);

  useEffect(() => {
    void refreshRevisions();
  }, [refreshRevisions, data.revision]);

  async function downloadBackup() {
    setBackupBusy(true);
    setError("");
    try {
      const payload = await apiRequest<unknown>("/api/backups");
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `dashcenter-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      notify("Backup downloaded");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not create the backup.");
    } finally {
      setBackupBusy(false);
    }
  }

  async function readBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const payload = JSON.parse(await file.text()) as unknown;
      const dashboard = extractDashboard(payload);
      if (!dashboard) throw new Error("This JSON file is not a valid Dashcenter backup.");
      setRestorePreview({ fileName: file.name, payload, dashboard });
    } catch (readError) {
      setRestorePreview(null);
      setError(readError instanceof Error ? readError.message : "Could not read this backup.");
    } finally {
      event.target.value = "";
    }
  }

  async function restoreBackup() {
    if (!restorePreview) return;
    setBackupBusy(true);
    setError("");
    try {
      const result = await apiRequest<DashboardData | undefined>("/api/backups", {
        method: "POST",
        body: JSON.stringify(restorePreview.payload),
      });
      if (result) onDataChange(result);
      await onRefresh();
      setRestorePreview(null);
      setPendingRestore(null);
      notify("Backup restored");
      await refreshRevisions();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not restore this backup.");
      setPendingRestore(null);
    } finally {
      setBackupBusy(false);
    }
  }

  async function restoreSavedRevision(revision: RevisionSummary) {
    setBusyRevision(revision.id);
    setError("");
    try {
      const next = await restoreRevision(revision.id);
      if (next) onDataChange(next);
      await onRefresh();
      notify(`Revision ${revision.id} restored`);
      setPendingRestore(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not restore this revision.");
      setPendingRestore(null);
    } finally {
      setBusyRevision(null);
    }
  }

  return (
    <div className="admin-backups-workspace">
      <header className="admin-backups-workspace__topbar">
        <span><h1>Backups</h1><small>Export your configuration or restore a saved state.</small></span>
        <span className="admin-revision-badge"><History size={15} /> Revision {data.revision}</span>
      </header>
      <div className="admin-backups-body">
        <nav className="admin-backups-list-pane" aria-label="Backup sections">
          <span className="admin-users-list-pane__eyebrow">Protection & history</span>
          <h2>Recovery options</h2>
          <p>Keep a portable copy and return to an earlier configuration when needed.</p>
          <button type="button" className={`admin-users-list-row${section === "backup" ? " admin-users-list-row--active" : ""}`} aria-pressed={section === "backup"} onClick={() => setSection("backup")}>
            <span className="admin-users-list-row__icon"><DatabaseBackup size={18} /></span><span><strong>Portable backup</strong><small>Export or restore a JSON file</small></span>
          </button>
          <button type="button" className={`admin-users-list-row${section === "history" ? " admin-users-list-row--active" : ""}`} aria-pressed={section === "history"} onClick={() => setSection("history")}>
            <span className="admin-users-list-row__icon"><History size={18} /></span><span><strong>Revision history</strong><small>{revisions.length} saved restore points</small></span>
          </button>
        </nav>

        <section className="admin-backups-detail" aria-label={section === "backup" ? "Portable backup" : "Revision history"}>
          <header className="admin-users-detail__heading">
            <span className="admin-users-detail__icon">{section === "backup" ? <DatabaseBackup size={20} /> : <History size={20} />}</span>
            <span><small>{section === "backup" ? "Portable configuration" : "Automatic restore points"}</small><h2>{section === "backup" ? "Export & restore" : "Revision history"}</h2><span>{section === "backup" ? "Move your dashboard settings between installations." : "Return to a previously saved configuration."}</span></span>
          </header>
          <div className="admin-backups-detail__content">
            {error ? <Notice kind="danger"><AlertTriangle size={15} /> {error}</Notice> : null}
            {section === "backup" ? <>
              <section className="admin-users-section">
                <header><span><strong>Download backup</strong><small>Export settings, services, widgets, and connections as one JSON file.</small></span></header>
                <p className="admin-backups-section__note">Keep the file somewhere safe. A backup may contain private configuration.</p>
                <Button variant="primary" onClick={downloadBackup} disabled={backupBusy}><Download size={16} /> {backupBusy ? "Preparing…" : "Download JSON"}</Button>
              </section>
              <section className="admin-users-section">
                <header><span><strong>Restore from file</strong><small>Choose a Dashcenter backup to review before applying it to this server.</small></span></header>
                <input ref={fileRef} className="admin-file-input" type="file" accept="application/json,.json" onChange={readBackup} aria-label="Dashcenter backup JSON file" />
                <Button onClick={() => fileRef.current?.click()} disabled={backupBusy}><Upload size={16} /> Choose backup</Button>
                {restorePreview ? <div className="admin-backups-preview">
                  <FileJson2 size={20} />
                  <span><strong>{restorePreview.fileName}</strong><small>{restorePreview.dashboard.groups.length} groups · {restorePreview.dashboard.groups.reduce((sum, group) => sum + group.services.length, 0)} services · revision {restorePreview.dashboard.revision}</small></span>
                  <span className="admin-backups-preview__actions"><Button variant="primary" onClick={() => setPendingRestore({ type: "backup" })} disabled={backupBusy}>Restore backup</Button><Button variant="ghost" onClick={() => setRestorePreview(null)} disabled={backupBusy}>Cancel</Button></span>
                </div> : null}
              </section>
            </> : <section className="admin-users-section">
              <header className="admin-backups-history-header"><span><strong>Saved revisions</strong><small>Dashcenter records a restore point whenever configuration changes are saved.</small></span><Button onClick={refreshRevisions} disabled={loadingRevisions}><RefreshCw size={15} /> Refresh</Button></header>
              {revisions.length ? <div className="admin-revision-list">{revisions.map((revision, index) => (
                <div className="admin-revision-row" key={revision.id}>
                  <span className="admin-revision-row__marker"><Clock3 size={15} /></span>
                  <span><strong>{revision.label || `Revision ${revision.id}`}</strong><small>{formatRevisionDate(revision.createdAt)} · Revision {revision.id}</small></span>
                  {index === 0 ? <span className="admin-current-badge"><CheckCircle2 size={13} /> Latest</span> : <Button onClick={() => setPendingRestore({ type: "revision", revision })} disabled={busyRevision !== null}><RotateCcw size={14} /> {busyRevision === revision.id ? "Restoring…" : "Restore"}</Button>}
                </div>
              ))}</div> : loadingRevisions ? <div className="admin-loading-line"><RefreshCw size={16} /> Loading revision history…</div> : <EmptyState icon={<History size={23} />} title="No saved revisions">Your first configuration change will create an automatic restore point.</EmptyState>}
            </section>}
          </div>
        </section>
      </div>
      <ConfirmDialog
        open={pendingRestore !== null}
        title={pendingRestore?.type === "backup" ? "Restore this backup?" : "Restore this revision?"}
        description="The current dashboard configuration will be replaced. Download a backup first if you want to keep it."
        confirmLabel="Restore configuration"
        variant="danger"
        busy={backupBusy || busyRevision !== null}
        onClose={() => setPendingRestore(null)}
        onConfirm={() => { if (pendingRestore?.type === "backup") void restoreBackup(); else if (pendingRestore?.type === "revision") void restoreSavedRevision(pendingRestore.revision); }}
      >{pendingRestore?.type === "backup" && restorePreview ? <p>{restorePreview.fileName}</p> : pendingRestore?.type === "revision" ? <p>Revision {pendingRestore.revision.id} · {formatRevisionDate(pendingRestore.revision.createdAt)}</p> : null}</ConfirmDialog>
    </div>
  );
}
