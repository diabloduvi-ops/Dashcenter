import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { AuthState, DashboardData } from "../shared/types";
import { DashboardView } from "./components/DashboardView";
import { DashcenterMark } from "./components/DashcenterMark";
import { AdminEditor } from "./features/admin/AdminEditor";
import { getAuthState, getDashboard } from "./lib/api";

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [auth, setAuth] = useState<AuthState>({ needsSetup: false, authenticated: false });
  const [error, setError] = useState<string>("");
  const dashboardRequestRef = useRef<Promise<DashboardData> | null>(null);

  const loadDashboard = useCallback(() => {
    if (dashboardRequestRef.current) return dashboardRequestRef.current;
    const request = getDashboard();
    dashboardRequestRef.current = request;
    const clear = () => {
      if (dashboardRequestRef.current === request) dashboardRequestRef.current = null;
    };
    void request.then(clear, clear);
    return request;
  }, []);

  const refreshDashboard = useCallback(async () => {
    try {
      setData(await loadDashboard());
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Dashcenter could not reach its server.");
    }
  }, [loadDashboard]);

  const refresh = useCallback(async () => {
    try {
      const [, nextAuth] = await Promise.all([refreshDashboard(), getAuthState()]);
      setAuth(nextAuth);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Dashcenter could not reach its server.");
    }
  }, [refreshDashboard]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!data) {
    return (
      <main className="boot-screen">
        <div className="boot-brand"><DashcenterMark className="boot-brand__mark" size={32} /><strong>Dashcenter</strong></div>
        {error ? (
          <div className="boot-error">
            <strong>Dashboard unavailable</strong>
            <p>{error}</p>
            <button type="button" onClick={() => void refresh()}>Try again</button>
          </div>
        ) : <span className="boot-loader" aria-label="Loading dashboard" />}
      </main>
    );
  }

  if (location.pathname.startsWith("/admin")) {
    return (
      <AdminEditor
        data={data}
        auth={auth}
        onDataChange={setData}
        onRefresh={refresh}
        onExit={() => navigate("/")}
      />
    );
  }

  return (
    <DashboardView
      data={data}
      onOpenSettings={() => navigate("/admin")}
      onRefresh={refreshDashboard}
    />
  );
}
