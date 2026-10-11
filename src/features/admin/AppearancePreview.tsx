import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DashboardData, DashboardSettings } from "../../../shared/types";
import { DashboardView, type DashboardPreviewMode } from "../../components/DashboardView";

interface AppearancePreviewProps {
  data: DashboardData;
  settings: DashboardSettings;
  mode: DashboardPreviewMode;
}

const PREVIEW_DIMENSIONS: Record<DashboardPreviewMode, { width: number; minHeight: number }> = {
  desktop: { width: 1200, minHeight: 780 },
  tablet: { width: 768, minHeight: 1024 },
  mobile: { width: 390, minHeight: 844 },
};

export function AppearancePreview({ data, settings, mode }: AppearancePreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [hostWidth, setHostWidth] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const { width, minHeight } = PREVIEW_DIMENSIONS[mode];
  const previewData = useMemo(() => ({ ...data, settings }), [data, settings]);
  const scale = Math.min(1, Math.max(0.72, (hostWidth - 32) / width || 1));

  useLayoutEffect(() => {
    const host = hostRef.current;
    const content = contentRef.current;
    if (!host || !content) return;

    const measure = () => {
      setHostWidth(host.clientWidth);
      setContentHeight(content.scrollHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    observer.observe(content);
    return () => observer.disconnect();
  }, [mode]);

  return (
    <div className="admin-appearance-preview-host" ref={hostRef} aria-label={`${mode} dashboard appearance preview`}>
      <div className="admin-appearance-preview-stage" style={{ width: width * scale, height: Math.max(minHeight, contentHeight) * scale }}>
        <div
          ref={contentRef}
          className="admin-appearance-preview-content"
          style={{ width, transform: `scale(${scale})` }}
          inert
          aria-hidden="true"
        >
          <DashboardView
            data={previewData}
            mode="appearance"
            previewMode={mode}
            onOpenSettings={() => undefined}
            onRefresh={async () => undefined}
          />
        </div>
      </div>
    </div>
  );
}
