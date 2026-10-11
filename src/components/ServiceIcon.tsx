import { useEffect, useMemo, useState } from "react";
import { resolveIcon, resolveIconSource, type ResolvedIcon } from "../../shared/icons";

export { resolveIcon };
export type IconLoadState = "empty" | "loading" | "ready" | "error";

const maskSourceCache = new Map<string, Promise<string>>();
const MAX_MASK_SOURCE_LENGTH = 256_000;

function fetchMaskAsDataUri(url: string): Promise<string> {
  const cached = maskSourceCache.get(url);
  if (cached) return cached;

  const request = fetch(url, { cache: "force-cache", credentials: "omit" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Icon request failed with ${response.status}.`);
      const svg = await response.text();
      if (svg.length > MAX_MASK_SOURCE_LENGTH || !/<svg(?:\s|>)/i.test(svg)) {
        throw new Error("Icon response is not a valid SVG.");
      }
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    })
    .catch((error) => {
      maskSourceCache.delete(url);
      throw error;
    });

  maskSourceCache.set(url, request);
  return request;
}

async function loadMaskSource(resolved: Extract<ResolvedIcon, { kind: "mask" }>) {
  let lastError: unknown;
  for (const source of [resolved.src, resolved.fallbackSrc]) {
    try {
      return await fetchMaskAsDataUri(source);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Icon could not be loaded.");
}

interface ServiceIconProps {
  icon: string;
  name: string;
  className?: string;
  onLoadStateChange?: (state: IconLoadState) => void;
}

export function ServiceIcon({
  icon,
  name,
  className = "service-icon",
  onLoadStateChange,
}: ServiceIconProps) {
  const resolved = useMemo(() => resolveIconSource(icon), [icon]);
  const [failedSrc, setFailedSrc] = useState("");
  const [maskSrc, setMaskSrc] = useState("");
  const [maskFailed, setMaskFailed] = useState(false);
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?";

  useEffect(() => {
    setFailedSrc("");
    setMaskSrc("");
    setMaskFailed(false);

    if (resolved.kind === "none") {
      onLoadStateChange?.("empty");
      return;
    }
    if (resolved.kind === "image") {
      onLoadStateChange?.("loading");
      return;
    }

    let cancelled = false;
    onLoadStateChange?.("loading");
    loadMaskSource(resolved)
      .then((source) => {
        if (cancelled) return;
        setMaskSrc(source);
        onLoadStateChange?.("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setMaskFailed(true);
        onLoadStateChange?.("error");
      });
    return () => {
      cancelled = true;
    };
  }, [
    onLoadStateChange,
    resolved.kind,
    resolved.src,
    resolved.kind === "mask" ? resolved.fallbackSrc : "",
  ]);

  const imageFailed = resolved.kind === "image" && resolved.src === failedSrc;
  const effectiveMaskSrc = resolved.kind === "mask" ? maskSrc || resolved.src : "";

  return (
    <span className={className} aria-hidden="true">
      {resolved.kind === "image" && !imageFailed ? (
        <img
          src={resolved.src}
          alt=""
          onLoad={() => onLoadStateChange?.("ready")}
          onError={() => {
            setFailedSrc(resolved.src);
            onLoadStateChange?.("error");
          }}
        />
      ) : resolved.kind === "mask" && !maskFailed ? (
        <span
          className="resolved-icon-mask"
          style={{
            background: resolved.color,
            WebkitMask: `url("${effectiveMaskSrc}") no-repeat center / contain`,
            mask: `url("${effectiveMaskSrc}") no-repeat center / contain`,
          }}
        />
      ) : (
        <span>{initials}</span>
      )}
    </span>
  );
}
