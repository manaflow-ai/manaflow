import type { CSSProperties, ReactNode } from "react";

import { ElectronWebContentsView } from "@/components/electron-web-contents-view";
import { isElectron } from "@/lib/electron";
import { PERMISSIVE_IFRAME_ALLOW } from "@/lib/iframePermissions";

import {
  PersistentIframe,
  type PersistentIframeStatus,
} from "./persistent-iframe";

export interface PersistentWebViewProps {
  persistKey: string;
  src: string;
  requestUrl?: string;
  className?: string;
  style?: CSSProperties;
  persistentWrapperClassName?: string;
  persistentWrapperStyle?: CSSProperties;
  preload?: boolean;
  allow?: string;
  sandbox?: string;
  iframeClassName?: string;
  iframeStyle?: CSSProperties;
  suspended?: boolean;
  retainOnUnmount?: boolean;
  backgroundColor?: string;
  borderRadius?: number;
  fallback?: ReactNode;
  fallbackClassName?: string;
  errorFallback?: ReactNode;
  errorFallbackClassName?: string;
  forceWebContentsViewIfElectron?: boolean;
  onLoad?: () => void;
  onError?: (error: Error) => void;
  onStatusChange?: (status: PersistentIframeStatus) => void;
  forcedStatus?: PersistentIframeStatus | null;
  loadTimeoutMs?: number;
  preflight?: boolean;
  onElectronViewReady?: (info: {
    id: number;
    webContentsId: number;
    restored: boolean;
  }) => void;
  onElectronViewDestroyed?: () => void;
  isExpanded?: boolean;
  isAnyPanelExpanded?: boolean;
}

const DISABLE_WEBCONTENTSVIEW = true;

export function PersistentWebView({
  persistKey,
  src,
  requestUrl,
  className,
  style,
  preload,
  allow = PERMISSIVE_IFRAME_ALLOW,
  sandbox,
  iframeClassName,
  iframeStyle,
  persistentWrapperClassName,
  persistentWrapperStyle,
  suspended,
  retainOnUnmount: _retainOnUnmount,
  backgroundColor,
  borderRadius,
  fallback,
  fallbackClassName,
  errorFallback,
  errorFallbackClassName,
  forceWebContentsViewIfElectron,
  onLoad,
  onError,
  onStatusChange,
  forcedStatus,
  loadTimeoutMs,
  preflight,
  onElectronViewReady,
  onElectronViewDestroyed,
  isExpanded,
  isAnyPanelExpanded,
}: PersistentWebViewProps) {
  const resolvedRetain = true;

  if (
    isElectron &&
    (forceWebContentsViewIfElectron || !DISABLE_WEBCONTENTSVIEW)
  ) {
    return (
      <ElectronWebContentsView
        src={src}
        requestUrl={requestUrl}
        className={className}
        style={style}
        backgroundColor={backgroundColor}
        borderRadius={borderRadius}
        suspended={suspended}
        persistKey={persistKey}
        retainOnUnmount={resolvedRetain}
        fallback={fallback}
        onNativeViewReady={onElectronViewReady}
        onNativeViewDestroyed={onElectronViewDestroyed}
      />
    );
  }

  return (
    <PersistentIframe
      persistKey={persistKey}
      src={src}
      className={className}
      style={style}
      preload={preload}
      allow={allow}
      sandbox={sandbox}
      iframeClassName={iframeClassName}
      iframeStyle={iframeStyle}
      persistentWrapperClassName={persistentWrapperClassName}
      persistentWrapperStyle={persistentWrapperStyle}
      onLoad={onLoad}
      onError={onError}
      loadingFallback={fallback}
      loadingClassName={fallbackClassName}
      errorFallback={errorFallback}
      errorClassName={errorFallbackClassName}
      onStatusChange={onStatusChange}
      forcedStatus={forcedStatus}
      loadTimeoutMs={loadTimeoutMs}
      preflight={preflight}
      isExpanded={isExpanded}
      isAnyPanelExpanded={isAnyPanelExpanded}
    />
  );
}
