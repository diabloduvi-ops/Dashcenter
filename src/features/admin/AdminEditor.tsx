import { useCallback, useState } from "react";
import {
  ArchiveRestore,
  Blocks,
  Boxes,
  Check,
  ChevronLeft,
  Container,
  Eye,
  LayoutDashboard,
  Palette,
  RefreshCw,
  UsersRound,
  X,
} from "lucide-react";
import type { AuthState, DashboardData } from "../../../shared/types";
import { DASHCENTER_RELEASE } from "../../../shared/version";
import { DashcenterMark } from "../../components/DashcenterMark";
import { AppearanceTab } from "./AppearanceTab";
import { AuthGate } from "./AuthGate";
import { BackupsTab } from "./BackupsTab";
import { DashboardTab } from "./DashboardTab";
import { ConnectionsTab } from "./ConnectionsTab";
import { saveDashboard } from "./api";
import { ServicesTab } from "./ServicesTab";
import { StatusPill } from "./ui";
import { UsersTab } from "./UsersTab";
import { WidgetsTab } from "./WidgetsTab";
import "./admin.css";

export interface AdminEditorProps {
  data: DashboardData;
  auth: AuthState;
  onDataChange: (next: DashboardData) => void;
  onRefresh: () => Promise<void>;
  onExit: () => void;
}

type AdminTab = "dashboard" | "services" | "widgets" | "appearance" | "connections" | "users" | "backups";

const navItems: Array<{ id: AdminTab; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "services", label: "Services", icon: Boxes },
  { id: "widgets", label: "Widgets", icon: Blocks },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "connections", label: "Connections", icon: Container },
  { id: "users", label: "Users", icon: UsersRound },
  { id: "backups", label: "Backups", icon: ArchiveRestore },
];

interface ToastState {
  message: string;
  kind: "success" | "error";
  token: number;
}

export function AdminEditor({ data, auth, onDataChange, onRefresh, onExit }: AdminEditorProps) {
  const [tab, setTab] = useState<AdminTab>("dashboard");
  const [saveState, setSaveState] = useState<"idle" | "busy" | "success" | "error">("idle");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const notify = useCallback((message: string, kind: "success" | "error" = "success") => {
    const next = { message, kind, token: Date.now() };
    setToast(next);
    window.setTimeout(() => {
      setToast((current) => current?.token === next.token ? null : current);
    }, 3200);
  }, []);

  const commit = useCallback(async (next: DashboardData, successMessage = "Changes saved") => {
    const previous = data;
    setSaveState("busy");
    onDataChange(next);
    try {
      const saved = await saveDashboard(next);
      if (saved) onDataChange(saved);
      setSaveState("success");
      notify(successMessage);
      window.setTimeout(() => setSaveState((current) => current === "success" ? "idle" : current), 1800);
      return true;
    } catch (requestError) {
      onDataChange(previous);
      setSaveState("error");
      notify(requestError instanceof Error ? requestError.message : "Could not save changes.", "error");
      return false;
    }
  }, [data, notify, onDataChange]);

  const commitWithoutResult = useCallback(async (next: DashboardData, successMessage?: string) => {
    await commit(next, successMessage);
  }, [commit]);

  async function refresh() {
    setRefreshing(true);
    try {
      await onRefresh();
      notify("Dashboard refreshed");
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : "Could not refresh dashboard.", "error");
    } finally {
      setRefreshing(false);
    }
  }

  if (!auth.authenticated && !auth.devBypass) {
    return <AuthGate auth={auth} onRefresh={onRefresh} />;
  }

  const active = navItems.find((item) => item.id === tab) ?? navItems[0];

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <button className="admin-logo" onClick={() => setTab("dashboard")} aria-label="Dashcenter editor home">
          <DashcenterMark className="admin-brand-mark" size={38} />
          <span><strong>Dashcenter</strong><small>Dashboard {DASHCENTER_RELEASE}</small></span>
        </button>
        <nav className="admin-nav" aria-label="Editor sections">
          <small className="admin-nav__label">Workspace</small>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={tab === item.id ? "admin-nav__active" : ""} onClick={() => setTab(item.id)}>
                <Icon size={17} />
                <span>{item.label}</span>
                {item.id === "connections" && data.connections.length ? <i>{data.connections.length}</i> : null}
              </button>
            );
          })}
        </nav>
        <div className="admin-sidebar__footer">
          <div className="admin-user-mini">
            <span>{(auth.displayName || auth.username || "A").slice(0, 1).toUpperCase()}</span>
            <span><strong>{auth.displayName || auth.username || "Admin"}</strong><small>Administrator</small></span>
          </div>
          <button onClick={onExit}><ChevronLeft size={15} /> Back to dashboard</button>
        </div>
      </aside>

      <section className="admin-workspace">
        {tab === "services" ? (
          <header className="admin-topbar">
            <span className="admin-topbar__title"><active.icon size={18} /><h1>{active.label}</h1><small>Dashboard editor</small></span>
            <div className="admin-topbar__actions">
              <StatusPill state={saveState}>{saveState === "busy" ? "Saving…" : saveState === "error" ? "Save failed" : saveState === "success" ? "Saved" : "Autosaved"}</StatusPill>
              <button className="ui-icon-button" onClick={refresh} disabled={refreshing} aria-label="Refresh dashboard" title="Refresh dashboard"><RefreshCw size={16} className={refreshing ? "ui-spin" : ""} /></button>
              <button className="ui-button ui-button--secondary" onClick={onExit}><Eye size={16} /> Preview</button>
              <button className="ui-button ui-button--primary" onClick={onExit}><Check size={16} /> Done</button>
            </div>
          </header>
        ) : null}

        <nav className="admin-mobile-nav" aria-label="Editor sections">
          {navItems.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={tab === item.id ? "admin-mobile-nav__active" : ""} onClick={() => setTab(item.id)}><Icon size={16} /><span>{item.label}</span></button>;
          })}
        </nav>

        <div className={`admin-content admin-content--${tab}`}>
          {tab === "dashboard" ? (
            <DashboardTab
              data={data}
              onCommit={commit}
              onClose={onExit}
              onOpenServices={() => setTab("services")}
              onOpenWidgets={() => setTab("widgets")}
            />
          ) : null}
          {tab === "services" ? <ServicesTab data={data} onCommit={commitWithoutResult} /> : null}
          {tab === "widgets" ? <WidgetsTab data={data} onCommit={commitWithoutResult} /> : null}
          {tab === "appearance" ? <AppearanceTab data={data} onCommit={commit} /> : null}
          {tab === "connections" ? <ConnectionsTab data={data} onDataChange={onDataChange} onRefresh={onRefresh} notify={notify} /> : null}
          {tab === "users" ? <UsersTab auth={auth} onRefresh={onRefresh} notify={notify} /> : null}
          {tab === "backups" ? <BackupsTab data={data} onDataChange={onDataChange} onRefresh={onRefresh} notify={notify} /> : null}
        </div>
      </section>

      {toast ? (
        <div className={`admin-toast admin-toast--${toast.kind}`} role="status">
          {toast.kind === "success" ? <Check size={16} /> : <X size={16} />}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} aria-label="Dismiss"><X size={14} /></button>
        </div>
      ) : null}
    </main>
  );
}
