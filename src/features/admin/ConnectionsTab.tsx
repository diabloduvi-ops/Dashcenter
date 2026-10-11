import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Container,
  Download,
  FileCode2,
  HardDrive,
  Import,
  Link2,
  Network,
  Plus,
  RefreshCw,
  Save,
  Server,
  TestTube2,
  Trash2,
  Upload,
} from "lucide-react";
import type { DashboardData, DockerConnection, ImportPreview } from "../../../shared/types";
import { createClientId } from "../../../shared/id";
import { ServiceIcon } from "../../components/ServiceIcon";
import { apiRequest, commitHomepageImport, previewHomepageImport } from "./api";
import { Button, ConfirmDialog, EmptyState, Field, IconButton, Notice, SelectField, StatusPill, Switch } from "./ui";

interface ConnectionsTabProps {
  data: DashboardData;
  onDataChange: (next: DashboardData) => void;
  onRefresh: () => Promise<void>;
  notify: (message: string, kind?: "success" | "error") => void;
}

interface DockerTestResult {
  ok?: boolean;
  success?: boolean;
  message?: string;
  version?: string;
}

interface DockerContainerInfo {
  id?: string;
  name: string;
  image?: string;
  state?: string;
  status?: string;
}

type ContainerResponse = DockerContainerInfo[] | { containers: DockerContainerInfo[] };

function newConnection(position: number): DockerConnection {
  return {
    id: createClientId("docker"),
    name: `Docker ${position + 1}`,
    type: "socket",
    endpoint: "/var/run/docker.sock",
    enabled: true,
  };
}

export function ConnectionsTab({ data, onDataChange, onRefresh, notify }: ConnectionsTabProps) {
  const [section, setSection] = useState<"docker" | "import">("docker");
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [selectedId, setSelectedId] = useState(data.connections[0]?.id ?? "");
  const selected = data.connections.find((connection) => connection.id === selectedId) ?? data.connections[0];
  const [connectionDraft, setConnectionDraft] = useState<DockerConnection>(() => selected ? { ...selected } : newConnection(0));
  const [creating, setCreating] = useState(data.connections.length === 0);
  const [activeTask, setActiveTask] = useState<"saving" | "deleting" | "testing" | "discovering" | null>(null);
  const [testResult, setTestResult] = useState<DockerTestResult | null>(null);
  const [containers, setContainers] = useState<DockerContainerInfo[]>([]);
  const [yaml, setYaml] = useState("");
  const [settingsYaml, setSettingsYaml] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewSources, setPreviewSources] = useState<{ yaml: string; settingsYaml: string } | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [yamlFileBusy, setYamlFileBusy] = useState(false);
  const [settingsFileBusy, setSettingsFileBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const settingsFileRef = useRef<HTMLInputElement>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewRequestRef = useRef(0);
  const yamlFileRequestRef = useRef(0);
  const settingsFileRequestRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const importFileBusy = yamlFileBusy || settingsFileBusy;
  const busy = activeTask !== null;
  const savedConnection = data.connections.find((connection) => connection.id === connectionDraft.id);
  const connectionDirty = creating || JSON.stringify(connectionDraft) !== JSON.stringify(savedConnection);

  const sortedContainers = useMemo(
    () => [...containers].sort((a, b) => a.name.localeCompare(b.name)),
    [containers],
  );

  useEffect(() => () => {
    previewRequestRef.current += 1;
    yamlFileRequestRef.current += 1;
    settingsFileRequestRef.current += 1;
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
  }, []);

  function invalidateImportPreview() {
    previewRequestRef.current += 1;
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    setImportBusy(false);
    setPreview(null);
    setPreviewSources(null);
    setImportError("");
  }

  function chooseConnection(connection: DockerConnection) {
    setSelectedId(connection.id);
    setConnectionDraft({ ...connection });
    setCreating(false);
    setTestResult(null);
    setContainers([]);
    setMobileView("detail");
  }

  function startConnection() {
    const draft = newConnection(data.connections.length);
    setConnectionDraft(draft);
    setCreating(true);
    setSelectedId("");
    setTestResult(null);
    setContainers([]);
    setMobileView("detail");
  }

  async function saveConnection(event: FormEvent) {
    event.preventDefault();
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    setActiveTask("saving");
    const wasCreating = creating;
    try {
      const next = await apiRequest<DashboardData>(
        wasCreating ? "/api/docker/connections" : `/api/docker/connections/${connectionDraft.id}`,
        { method: wasCreating ? "POST" : "PUT", body: JSON.stringify(connectionDraft) },
      );
      onDataChange(next);
      const savedConnection = wasCreating
        ? next.connections.find((connection) => !data.connections.some((existing) => existing.id === connection.id))
        : next.connections.find((connection) => connection.id === connectionDraft.id);
      setCreating(false);
      setSelectedId(savedConnection?.id ?? connectionDraft.id);
      if (savedConnection) setConnectionDraft({ ...savedConnection });
      notify(wasCreating ? "Docker connection added" : "Docker connection saved");
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : "Could not save the connection.", "error");
    } finally {
      saveInFlightRef.current = false;
      setActiveTask(null);
    }
  }

  async function deleteConnection() {
    if (creating) {
      const fallback = data.connections[0];
      setCreating(!fallback);
      if (fallback) chooseConnection(fallback);
      return;
    }
    setActiveTask("deleting");
    try {
      const next = await apiRequest<DashboardData>(`/api/docker/connections/${connectionDraft.id}`, { method: "DELETE" });
      onDataChange(next);
      const fallback = data.connections.find((connection) => connection.id !== connectionDraft.id);
      if (fallback) chooseConnection(fallback);
      else startConnection();
      setDeleteDialogOpen(false);
      setMobileView(fallback ? "detail" : "list");
      notify("Docker connection deleted");
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : "Could not delete the connection.", "error");
    } finally {
      setActiveTask(null);
    }
  }

  async function testConnection() {
    setActiveTask("testing");
    setTestResult(null);
    try {
      const result = await apiRequest<DockerTestResult>(
        connectionDirty ? "/api/docker/connections/test" : `/api/docker/connections/${connectionDraft.id}/test`,
        connectionDirty ? { method: "POST", body: JSON.stringify(connectionDraft) } : { method: "POST" },
      );
      setTestResult(result);
    } catch (requestError) {
      setTestResult({ ok: false, message: requestError instanceof Error ? requestError.message : "Connection failed." });
    } finally {
      setActiveTask(null);
    }
  }

  async function discoverContainers() {
    if (connectionDirty) return;
    setActiveTask("discovering");
    try {
      const result = await apiRequest<ContainerResponse>(`/api/docker/connections/${connectionDraft.id}/containers`);
      setContainers(Array.isArray(result) ? result : result.containers);
      notify("Container list refreshed");
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : "Could not discover containers.", "error");
    } finally {
      setActiveTask(null);
    }
  }

  async function readYamlFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    const requestId = yamlFileRequestRef.current + 1;
    yamlFileRequestRef.current = requestId;
    input.value = "";
    invalidateImportPreview();
    setYamlFileBusy(true);
    try {
      const contents = await file.text();
      if (yamlFileRequestRef.current === requestId) setYaml(contents);
    } catch (readError) {
      if (yamlFileRequestRef.current === requestId) {
        setImportError(readError instanceof Error ? readError.message : "Could not read services.yaml.");
      }
    } finally {
      if (yamlFileRequestRef.current === requestId) setYamlFileBusy(false);
    }
  }

  async function readSettingsYamlFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    const requestId = settingsFileRequestRef.current + 1;
    settingsFileRequestRef.current = requestId;
    input.value = "";
    invalidateImportPreview();
    setSettingsFileBusy(true);
    try {
      const contents = await file.text();
      if (settingsFileRequestRef.current === requestId) setSettingsYaml(contents);
    } catch (readError) {
      if (settingsFileRequestRef.current === requestId) {
        setImportError(readError instanceof Error ? readError.message : "Could not read settings.yaml.");
      }
    } finally {
      if (settingsFileRequestRef.current === requestId) setSettingsFileBusy(false);
    }
  }

  async function createPreview() {
    if (importFileBusy || !yaml.trim()) return;
    const sources = { yaml, settingsYaml };
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    setImportBusy(true);
    setImportError("");
    setPreview(null);
    setPreviewSources(null);

    try {
      const result = await previewHomepageImport(sources.yaml, sources.settingsYaml, controller.signal);
      if (controller.signal.aborted || previewRequestRef.current !== requestId) return;
      setPreview(result);
      setPreviewSources(sources);
    } catch (requestError) {
      if (controller.signal.aborted || previewRequestRef.current !== requestId) return;
      setImportError(requestError instanceof Error ? requestError.message : "Could not parse these YAML files.");
    } finally {
      if (previewAbortRef.current === controller) {
        previewAbortRef.current = null;
        setImportBusy(false);
      }
    }
  }

  async function commitImport() {
    if (importFileBusy || !preview || !previewSources) return;
    const sources = previewSources;
    setImportBusy(true);
    setImportError("");
    try {
      const next = await commitHomepageImport(sources.yaml, sources.settingsYaml);
      onDataChange(next);
      await onRefresh();
      setPreview(null);
      setPreviewSources(null);
      setImportDialogOpen(false);
      notify("Homepage configuration imported");
    } catch (requestError) {
      setImportDialogOpen(false);
      setImportError(requestError instanceof Error ? requestError.message : "Could not import this configuration.");
    } finally {
      setImportBusy(false);
    }
  }

  function discardConnection() {
    if (creating) {
      const fallback = data.connections[0];
      if (fallback) chooseConnection(fallback);
      else {
        setConnectionDraft(newConnection(0));
        setTestResult(null);
        setContainers([]);
        setMobileView("list");
      }
      return;
    }
    if (savedConnection) chooseConnection(savedConnection);
  }

  const testSucceeded = testResult ? Boolean(testResult.ok ?? testResult.success) : null;
  const connectionState = activeTask === "testing"
    ? { state: "busy" as const, label: "Testing" }
    : activeTask === "saving"
      ? { state: "busy" as const, label: "Saving" }
      : creating
        ? { state: "info" as const, label: "New connection" }
        : connectionDirty
          ? { state: "warning" as const, label: "Unsaved changes" }
          : !connectionDraft.enabled
            ? { state: "idle" as const, label: "Disabled" }
            : testSucceeded === true
              ? { state: "success" as const, label: "Connected" }
              : testSucceeded === false
                ? { state: "error" as const, label: "Connection failed" }
                : { state: "success" as const, label: "Saved" };

  return (
    <section className={`admin-connections-workspace admin-connections-workspace--${mobileView}`}>
      <header className="admin-connections-workspace__topbar">
        <span><h1>Connections</h1><small>Manage Docker hosts and migrate an existing Homepage dashboard</small></span>
        <div className="admin-segmented-control" role="tablist" aria-label="Connection workspace">
          <button role="tab" aria-selected={section === "docker"} className={section === "docker" ? "admin-segmented-control--active" : ""} onClick={() => setSection("docker")}><Container size={15} /> Docker</button>
          <button role="tab" aria-selected={section === "import"} className={section === "import" ? "admin-segmented-control--active" : ""} onClick={() => setSection("import")}><Import size={15} /> Homepage migration</button>
        </div>
        <span className="admin-connections-workspace__summary">
          {section === "docker" ? <StatusPill state={connectionState.state}>{connectionState.label}</StatusPill> : <StatusPill state={preview ? "success" : importBusy ? "busy" : "idle"}>{preview ? "Preview ready" : importBusy ? "Reading files" : "Waiting for source"}</StatusPill>}
        </span>
      </header>

      {section === "docker" ? (
        <div className="admin-connections-body">
          <aside className="admin-connections-list-pane" aria-label="Docker connections">
            <header className="admin-pane-heading">
              <span><small>Infrastructure</small><h2>Docker hosts</h2></span>
              <IconButton label="Add connection" onClick={startConnection}><Plus size={17} /></IconButton>
            </header>
            <p className="admin-connections-list-pane__intro">Use a local socket or a reachable read-only Docker API.</p>
            <div className="admin-connection-list">
              {data.connections.map((connection) => (
                <button
                  key={connection.id}
                  className={`admin-connection-row ${!creating && selected?.id === connection.id ? "admin-connection-row--active" : ""}`}
                  onClick={() => chooseConnection(connection)}
                >
                  <span className="admin-connection-row__icon">{connection.type === "socket" ? <HardDrive size={17} /> : <Network size={17} />}</span>
                  <span><strong>{connection.name}</strong><small>{connection.endpoint}</small></span>
                  <span className={`admin-connection-row__state ${connection.enabled ? "is-enabled" : ""}`}><i />{connection.enabled ? "Enabled" : "Disabled"}</span>
                </button>
              ))}
            </div>
            {data.connections.length === 0 ? (
              <EmptyState icon={<Server size={22} />} title="No Docker hosts" action={<Button variant="primary" onClick={startConnection}><Plus size={15} /> Add connection</Button>}>
                Add a host to discover containers and use Docker-backed service status.
              </EmptyState>
            ) : null}
          </aside>

          <section className="admin-connection-detail" aria-label="Connection details">
            <form className="admin-connection-inspector" onSubmit={saveConnection}>
              <header className="admin-connection-inspector__heading">
                <button className="admin-pane-back" type="button" onClick={() => setMobileView("list")} aria-label="Back to Docker hosts"><ArrowLeft size={17} /></button>
                <span className="admin-connection-inspector__icon">{connectionDraft.type === "socket" ? <HardDrive size={20} /> : <Network size={20} />}</span>
                <span className="admin-connection-inspector__identity">
                  <small>{creating ? "New Docker host" : "Connection details"}</small>
                  <h2>{connectionDraft.name || "Untitled connection"}</h2>
                  <span>{connectionDraft.endpoint || "Add a socket path or API endpoint"}</span>
                </span>
                <StatusPill state={connectionState.state}>{connectionState.label}</StatusPill>
              </header>

              <div className="admin-connection-inspector__content">
                <section className="admin-connection-section">
                  <header><span><strong>Connection</strong><small>Reusable infrastructure for discovery and service status.</small></span></header>
                  <div className="admin-form-grid">
                    <Field label="Name" value={connectionDraft.name} onChange={(event) => setConnectionDraft({ ...connectionDraft, name: event.target.value })} required />
                    <SelectField label="Connection type" value={connectionDraft.type} onChange={(type) => setConnectionDraft({
                      ...connectionDraft,
                      type: type as DockerConnection["type"],
                      endpoint: type === "socket" ? "/var/run/docker.sock" : "http://docker-host:2375",
                    })}>
                      <option value="socket">Local Docker socket</option>
                      <option value="http">Remote Docker API</option>
                    </SelectField>
                  </div>
                  <Field
                    label={connectionDraft.type === "socket" ? "Socket path" : "Endpoint"}
                    hint={connectionDraft.type === "socket" ? "The path must be available inside the Dashcenter container." : "Use a trusted read-only gateway when possible."}
                    value={connectionDraft.endpoint}
                    onChange={(event) => setConnectionDraft({ ...connectionDraft, endpoint: event.target.value })}
                    placeholder={connectionDraft.type === "socket" ? "/var/run/docker.sock" : "http://192.168.1.10:2375"}
                    required
                  />
                  <div className="ui-toggle-row">
                    <span><strong>Connection enabled</strong><small>Allow container discovery and live status checks from this host.</small></span>
                    <Switch checked={connectionDraft.enabled} onChange={(enabled) => setConnectionDraft({ ...connectionDraft, enabled })} label="Connection enabled" />
                  </div>
                </section>

                <section className="admin-connection-section">
                  <header>
                    <span><strong>Connection check</strong><small>Verify access before assigning this host to services.</small></span>
                    <Button type="button" onClick={testConnection} disabled={busy || !connectionDraft.endpoint.trim()}><TestTube2 size={15} /> {activeTask === "testing" ? "Testing…" : "Test connection"}</Button>
                  </header>
                  {testResult ? (
                    <Notice kind={testSucceeded ? "success" : "danger"}>
                      {testSucceeded ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                      {testResult.message || (testSucceeded ? `Connected${testResult.version ? ` · Docker ${testResult.version}` : ""}` : "Connection failed")}
                    </Notice>
                  ) : <Notice kind="info"><TestTube2 size={15} /> Testing is read-only and does not start, stop, or modify containers.</Notice>}
                </section>

                <section className="admin-connection-section admin-connection-section--containers">
                  <header>
                    <span><strong>Discovered containers</strong><small>Use the exact container name when assigning Docker status to a service.</small></span>
                    <Button type="button" onClick={discoverContainers} disabled={busy || connectionDirty}><RefreshCw size={15} className={activeTask === "discovering" ? "ui-spin" : ""} /> {activeTask === "discovering" ? "Discovering…" : "Discover"}</Button>
                  </header>
                  {connectionDirty ? (
                    <Notice kind="warning"><AlertTriangle size={15} /> Save or discard these connection changes before discovering containers.</Notice>
                  ) : sortedContainers.length ? (
                    <div className="admin-container-list">
                      {sortedContainers.map((containerInfo) => (
                        <div className="admin-container-row" key={containerInfo.id ?? containerInfo.name}>
                          <Container size={16} />
                          <span><strong>{containerInfo.name}</strong><small>{containerInfo.image ?? "Docker container"}</small></span>
                          <span className={`admin-container-state admin-container-state--${containerInfo.state ?? "unknown"}`}>{containerInfo.status ?? containerInfo.state ?? "unknown"}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState icon={<Container size={22} />} title="No discovery result">
                      Run discovery to inspect containers available through this saved connection.
                    </EmptyState>
                  )}
                </section>
              </div>

              <footer className="admin-connection-inspector__actions">
                <span>
                  {!creating ? <Button variant="danger" type="button" onClick={() => setDeleteDialogOpen(true)} disabled={busy}><Trash2 size={15} /> Delete</Button> : null}
                </span>
                <span>
                  <Button type="button" onClick={discardConnection} disabled={busy || !connectionDirty}>Discard</Button>
                  <Button variant="primary" type="submit" disabled={busy || !connectionDirty || !connectionDraft.name.trim() || !connectionDraft.endpoint.trim()}><Save size={15} /> {activeTask === "saving" ? "Saving…" : "Save connection"}</Button>
                </span>
              </footer>
            </form>
          </section>
        </div>
      ) : (
        <div className="admin-migration-workspace">
          <section className="admin-migration-source" aria-labelledby="homepage-source-title">
            <header className="admin-migration-pane-heading">
              <span><small>Step 1</small><h2 id="homepage-source-title">Homepage source</h2><p>Paste or choose services.yaml. settings.yaml is optional and adds group icons.</p></span>
              <FileCode2 size={20} />
            </header>
            <div className="admin-migration-source__content">
              <label className="ui-field">
                <span className="ui-field__label">services.yaml</span>
                <textarea className="ui-textarea admin-yaml-input" value={yaml} onChange={(event) => { setYaml(event.target.value); invalidateImportPreview(); }} disabled={importBusy || importFileBusy} placeholder={'- Docker Services:\n    - Portainer:\n        icon: portainer.png\n        href: https://portainer.local\n        description: Docker management'} spellCheck={false} />
              </label>
              <input ref={fileRef} className="admin-file-input" type="file" accept=".yaml,.yml,text/yaml,text/plain" onChange={readYamlFile} disabled={importBusy || importFileBusy} />
              <Button onClick={() => fileRef.current?.click()} disabled={importBusy || importFileBusy}><Upload size={15} /> Choose services.yaml</Button>

              <label className="ui-field">
                <span className="ui-field__label">settings.yaml <small>optional · group icons</small></span>
                <textarea className="ui-textarea admin-yaml-input admin-yaml-input--secondary" value={settingsYaml} onChange={(event) => { setSettingsYaml(event.target.value); invalidateImportPreview(); }} disabled={importBusy || importFileBusy} placeholder={'layout:\n  - Docker Services:\n      icon: mdi-docker'} spellCheck={false} />
              </label>
              <input ref={settingsFileRef} className="admin-file-input" type="file" accept=".yaml,.yml,text/yaml,text/plain" onChange={readSettingsYamlFile} disabled={importBusy || importFileBusy} />
              <Button onClick={() => settingsFileRef.current?.click()} disabled={importBusy || importFileBusy}><Upload size={15} /> Choose settings.yaml</Button>
              {importError ? <Notice kind="danger"><AlertTriangle size={15} /> {importError}</Notice> : null}

              <div className="admin-homepage-export">
                <span><strong>Export for Homepage</strong><small>Export current groups and services without copying Dashcenter-local files or unrelated Homepage settings.</small></span>
                <div className="admin-inline-actions">
                  <a className="ui-button" href="/api/export/homepage" download><Download size={15} /> services.yaml</a>
                  <a className="ui-button" href="/api/export/homepage/settings.yaml" download><Download size={15} /> settings.yaml</a>
                </div>
              </div>
            </div>
            <footer className="admin-migration-pane-actions">
              <Button variant="primary" onClick={createPreview} disabled={importBusy || importFileBusy || !yaml.trim()}>{importFileBusy ? "Reading file…" : importBusy ? "Creating preview…" : "Create preview"}</Button>
            </footer>
          </section>

          <section className="admin-migration-preview" aria-labelledby="homepage-preview-title">
            <header className="admin-migration-pane-heading">
              <span><small>Step 2</small><h2 id="homepage-preview-title">Review and import</h2><p>Confirm the parsed dashboard before replacing the current groups and services.</p></span>
              {preview ? <StatusPill state="success">Ready</StatusPill> : <StatusPill state={importBusy ? "busy" : "idle"}>{importBusy ? "Parsing" : "No preview"}</StatusPill>}
            </header>
            <div className="admin-migration-preview__content">
              {preview ? (
                <div className="admin-import-preview">
                  <div className="admin-import-stats">
                    <span><strong>{preview.stats.groups}</strong><small>Groups</small></span>
                    <span><strong>{preview.stats.services}</strong><small>Services</small></span>
                    <span><strong>{preview.stats.preservedFields}</strong><small>Extra fields kept</small></span>
                    <span><strong>{preview.stats.groupIcons}</strong><small>Group icons</small></span>
                  </div>
                  {preview.warnings.length ? (
                    <Notice kind="warning"><AlertTriangle size={15} /><span><strong>{preview.warnings.length} import note{preview.warnings.length === 1 ? "" : "s"}</strong>{preview.warnings.slice(0, 3).map((warning) => <small key={warning}>{warning}</small>)}</span></Notice>
                  ) : <Notice kind="success"><CheckCircle2 size={15} /> YAML looks ready to import.</Notice>}
                  <div className="admin-import-groups">
                    {preview.groups.map((group) => (
                      <div className="admin-import-group" key={group.id}>
                        <div className="admin-import-group__heading">
                          {group.icon ? <ServiceIcon icon={group.icon} name={group.name} className="admin-import-group__icon" /> : <span className="admin-import-group__fallback"><Server size={14} /></span>}
                          <span><strong>{group.name}</strong><small>{group.services.length} services</small></span>
                        </div>
                        <div className="admin-import-group__services">{group.services.slice(0, 5).map((service) => <span key={service.id}><Link2 size={13} />{service.name}</span>)}</div>
                      </div>
                    ))}
                  </div>
                  <Notice kind="warning"><AlertTriangle size={15} /> Import replaces existing groups and services. Appearance, widgets, users, backups, and connections are preserved.</Notice>
                </div>
              ) : (
                <EmptyState icon={<FileCode2 size={24} />} title="Preview before importing">
                  Parsed groups, services, category icons, and compatibility notes will appear here.
                </EmptyState>
              )}
            </div>
            <footer className="admin-migration-pane-actions admin-migration-pane-actions--end">
              <Button variant="primary" onClick={() => setImportDialogOpen(true)} disabled={importBusy || importFileBusy || !preview}><Import size={16} /> Import configuration</Button>
            </footer>
          </section>
        </div>
      )}

      <ConfirmDialog
        open={deleteDialogOpen}
        title={`Delete ${connectionDraft.name || "this connection"}?`}
        description="Services assigned to this Docker host will keep their configuration, but their Docker status cannot update until another connection is selected."
        confirmLabel="Delete connection"
        variant="danger"
        busy={activeTask === "deleting"}
        onConfirm={() => void deleteConnection()}
        onClose={() => setDeleteDialogOpen(false)}
      />
      <ConfirmDialog
        open={importDialogOpen}
        title="Replace current groups and services?"
        description="This import uses the preview you just reviewed. Existing service groups and services will be replaced."
        confirmLabel="Import configuration"
        variant="danger"
        busy={importBusy}
        onConfirm={() => void commitImport()}
        onClose={() => setImportDialogOpen(false)}
      >
        <Notice kind="warning"><AlertTriangle size={15} /> Appearance, widgets, users, backups, and Docker connections will remain unchanged.</Notice>
      </ConfirmDialog>
    </section>
  );
}
