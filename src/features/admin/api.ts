import type { DashboardData, ImportPreview, RevisionSummary } from "../../../shared/types";

type ApiEnvelope<T> = T | { data: T };

function isEnvelope<T>(value: ApiEnvelope<T>): value is { data: T } {
  return Boolean(value && typeof value === "object" && "data" in value);
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string; error?: string } | null;
    throw new Error(body?.message || body?.error || `Request failed (${response.status})`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const result = await response.json() as ApiEnvelope<T>;
  return isEnvelope(result) ? result.data : result;
}

export function saveDashboard(data: DashboardData) {
  return apiRequest<DashboardData>("/api/dashboard", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function previewHomepageImport(yaml: string, settingsYaml?: string, signal?: AbortSignal) {
  return apiRequest<ImportPreview>("/api/import/preview", {
    method: "POST",
    body: JSON.stringify({ yaml, ...(settingsYaml?.trim() ? { settingsYaml } : {}) }),
    signal,
  });
}

export function commitHomepageImport(yaml: string, settingsYaml?: string) {
  return apiRequest<DashboardData>("/api/import/commit", {
    method: "POST",
    body: JSON.stringify({ yaml, ...(settingsYaml?.trim() ? { settingsYaml } : {}) }),
  });
}

export function loadRevisions() {
  return apiRequest<RevisionSummary[]>("/api/revisions");
}

export function restoreRevision(id: number) {
  return apiRequest<DashboardData>(`/api/revisions/${id}/restore`, { method: "POST" });
}
