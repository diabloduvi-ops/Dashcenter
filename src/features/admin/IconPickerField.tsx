import {
  type ChangeEvent,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Image, RefreshCw, Search, Upload, X } from "lucide-react";
import {
  DASHBOARD_ICON_CATALOG_PATH,
  iconDisplayName,
  normalizeIconReference,
  parseIconCatalog,
  resolveIcon,
  searchIconCatalog,
  type IconCatalogManifest,
} from "../../../shared/icons";
import { ServiceIcon, type IconLoadState } from "../../components/ServiceIcon";
import { apiRequest } from "./api";

let iconCatalogPromise: Promise<IconCatalogManifest> | null = null;
const MAX_ICON_UPLOAD_BYTES = 10 * 1024 * 1024;
const ICON_UPLOAD_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

async function requestIconCatalog() {
  if (!iconCatalogPromise) {
    iconCatalogPromise = fetch(DASHBOARD_ICON_CATALOG_PATH, {
      credentials: "same-origin",
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error("The icon library could not be loaded.");
      }
      return parseIconCatalog(await response.json());
    });
  }
  return iconCatalogPromise;
}

interface IconPickerFieldProps {
  value: string;
  name: string;
  label?: string;
  onChange: (value: string) => void;
  onApply?: (value: string) => void | Promise<void>;
  onUploadingChange?: (uploading: boolean) => void;
}

export function IconPickerField({
  value,
  name,
  label = "Icon",
  onChange,
  onApply,
  onUploadingChange,
}: IconPickerFieldProps) {
  const panelId = useId();
  const browseButtonRef = useRef<HTMLButtonElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const manualDirtyRef = useRef(false);
  const applyingValueRef = useRef("");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [catalog, setCatalog] = useState<IconCatalogManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const [previewState, setPreviewState] = useState<IconLoadState>("empty");

  useEffect(() => () => {
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    onUploadingChange?.(false);
  }, [onUploadingChange]);

  useEffect(() => {
    if (!open || catalog || loading || error) return;
    setLoading(true);
    requestIconCatalog()
      .then(setCatalog)
      .catch(() => {
        setError("Icon library could not be loaded. You can still enter a name or URL.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [catalog, error, open]);

  const results = useMemo(
    () => (catalog ? searchIconCatalog(catalog.icons, deferredQuery, 72) : []),
    [catalog, deferredQuery],
  );

  function closePicker() {
    setOpen(false);
    window.requestAnimationFrame(() => browseButtonRef.current?.focus());
  }

  function retry() {
    iconCatalogPromise = null;
    setCatalog(null);
    setError("");
  }

  function changeValue(next: string) {
    setUploadError("");
    setUploadMessage("");
    manualDirtyRef.current = true;
    onChange(next);
  }

  async function applyValue(next: string) {
    const normalized = normalizeIconReference(next);
    const shouldApply = Boolean(onApply) && (
      manualDirtyRef.current || normalized !== normalizeIconReference(value)
    );
    manualDirtyRef.current = false;
    setUploadError("");
    setUploadMessage("");
    onChange(normalized);
    if (!shouldApply || !onApply || applyingValueRef.current === normalized) return;

    applyingValueRef.current = normalized;
    try {
      await onApply(normalized);
    } finally {
      if (applyingValueRef.current === normalized) applyingValueRef.current = "";
    }
  }

  async function uploadIcon(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setUploadError("");
    setUploadMessage("");
    if (file.type && file.type !== "application/octet-stream" && !ICON_UPLOAD_TYPES.has(file.type)) {
      setUploadError("Use a PNG, JPEG, WebP, or GIF image.");
      input.value = "";
      return;
    }
    if (file.size > MAX_ICON_UPLOAD_BYTES) {
      setUploadError("Image uploads are limited to 10 MB.");
      input.value = "";
      return;
    }

    const controller = new AbortController();
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = controller;
    setUploading(true);
    onUploadingChange?.(true);

    try {
      const body = new FormData();
      body.append("file", file);
      const result = await apiRequest<{ url: string; filename: string }>("/api/icons/upload", {
        method: "POST",
        body,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!result.url?.trim()) throw new Error("The upload completed without an icon URL.");
      await applyValue(result.url);
      setOpen(false);
      setUploadMessage(
        onApply
          ? `Uploaded and saved ${result.filename || file.name}.`
          : `Uploaded ${result.filename || file.name}. Save this item to apply it.`,
      );
    } catch (uploadFailure) {
      if (controller.signal.aborted) return;
      setUploadError(uploadFailure instanceof Error ? uploadFailure.message : "The icon could not be uploaded.");
    } finally {
      input.value = "";
      if (uploadAbortRef.current === controller) {
        uploadAbortRef.current = null;
        setUploading(false);
        onUploadingChange?.(false);
      }
    }
  }

  return (
    <div className="ui-field admin-icon-picker">
      <span className="ui-field__label">{label}</span>
      <div className="admin-icon-picker__control" aria-busy={uploading}>
        <ServiceIcon
          icon={value}
          name={name || "Item"}
          className="admin-icon-picker__preview"
          onLoadStateChange={setPreviewState}
        />
        <input
          className="ui-input"
          value={value}
          onChange={(event) => changeValue(event.target.value)}
          onBlur={(event) => {
            if (onApply) {
              void applyValue(event.currentTarget.value);
            } else {
              changeValue(normalizeIconReference(event.currentTarget.value));
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && onApply) {
              event.preventDefault();
              event.stopPropagation();
              void applyValue(event.currentTarget.value);
            }
          }}
          placeholder="portainer.png, mdi-server or https://…"
          aria-label={`${label} name or URL`}
          disabled={uploading}
        />
        <div className="admin-icon-picker__actions">
          <button
            ref={browseButtonRef}
            className="ui-button"
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((current) => !current)}
            disabled={uploading}
          >
            <Image size={15} />
            Browse
          </button>
          <button
            className="ui-button"
            type="button"
            onClick={() => uploadInputRef.current?.click()}
            disabled={uploading}
          >
            <Upload size={15} />
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
        <input
          ref={uploadInputRef}
          className="admin-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={uploadIcon}
          disabled={uploading}
        />
      </div>
      <div className="admin-icon-picker__meta">
        <small className="ui-field__hint">
          Search the catalog, enter a dashboard name, mdi-* or si-* reference, paste a URL, or upload PNG, JPG, WebP or GIF (max 10 MB).
        </small>
        {value ? (
          <button
            className="admin-icon-picker__clear"
            type="button"
            onClick={() => {
              if (onApply) void applyValue("");
              else changeValue("");
            }}
            disabled={uploading}
          >
            <X size={12} />
            Clear icon
          </button>
        ) : null}
      </div>
      {value.trim() && previewState === "loading" ? (
        <small className="admin-icon-picker__status admin-icon-picker__status--loading" aria-live="polite">
          Checking icon…
        </small>
      ) : null}
      {value.trim() && previewState === "ready" ? (
        <small className="admin-icon-picker__status admin-icon-picker__status--ready" aria-live="polite">
          Icon loaded successfully.
        </small>
      ) : null}
      {value.trim() && previewState === "error" ? (
        <small className="admin-icon-picker__status admin-icon-picker__status--error" role="alert">
          Icon not found or could not be loaded. Check its name or choose one from Browse.
        </small>
      ) : null}
      {uploadError ? <small className="admin-icon-picker__upload-error" role="alert">{uploadError}</small> : null}
      {uploadMessage ? <small className="admin-icon-picker__upload-message" aria-live="polite">{uploadMessage}</small> : null}

      {open ? (
        <section
          id={panelId}
          className="admin-icon-picker__panel"
          aria-label="Icon library"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closePicker();
            }
          }}
        >
          <header className="admin-icon-picker__heading">
            <span>
              <strong>Icon library</strong>
              <small>Choose an icon without editing configuration files.</small>
            </span>
            <button className="ui-icon-button" type="button" onClick={closePicker} aria-label="Close icon library">
              <X size={16} />
            </button>
          </header>

          <label className="admin-icon-picker__search">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
              placeholder="Search 2,798 icons…"
              aria-label="Search icons"
              autoFocus
            />
          </label>

          <div className="admin-icon-picker__status" aria-live="polite">
            {loading ? "Loading icon library…" : null}
            {catalog && !loading
              ? deferredQuery
                ? `Showing up to ${results.length} matches`
                : "Popular icons"
              : null}
          </div>

          {error ? (
            <div className="admin-icon-picker__error">
              <span>{error}</span>
              <button className="ui-button" type="button" onClick={retry}>
                <RefreshCw size={14} />
                Retry
              </button>
            </div>
          ) : null}

          {catalog && results.length > 0 ? (
            <div className="admin-icon-picker__grid">
              {results.map((icon) => {
                const selected = value === icon;
                return (
                  <button
                    key={icon}
                    type="button"
                    className={`admin-icon-option ${selected ? "admin-icon-option--selected" : ""}`}
                    aria-label={`Use ${iconDisplayName(icon)} icon`}
                    aria-pressed={selected}
                    title={icon}
                    onClick={() => {
                      void applyValue(icon);
                      closePicker();
                    }}
                  >
                    <img
                      src={resolveIcon(icon)}
                      alt=""
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.style.visibility = "hidden";
                      }}
                    />
                    <span>{iconDisplayName(icon)}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {catalog && !loading && results.length === 0 ? (
            <div className="admin-icon-picker__empty">
              <Image size={19} />
              <span>No icon matches “{deferredQuery}”. You can still use that name or paste a URL above.</span>
            </div>
          ) : null}

          <footer className="admin-icon-picker__footer">
            <span>Catalog by </span>
            <a href={catalog?.source ?? "https://github.com/homarr-labs/dashboard-icons"} target="_blank" rel="noreferrer">
              homarr-labs/dashboard-icons
            </a>
            <span> · Apache-2.0</span>
          </footer>
        </section>
      ) : null}
    </div>
  );
}
