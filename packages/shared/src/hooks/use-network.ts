"use client";

import { useState, useEffect, useCallback } from "react";

export interface NetworkStatus {
  /** Whether the browser reports being online */
  online: boolean;
  /** Effective connection type (4g, 3g, 2g, slow-2g) if available */
  effectiveType?: "slow-2g" | "2g" | "3g" | "4g";
  /** Estimated round-trip time in milliseconds */
  rtt?: number;
  /** Estimated downlink speed in Mbps */
  downlink?: number;
  /** Whether data saver mode is enabled */
  saveData?: boolean;
}

/**
 * Hook to monitor network connectivity status
 * Uses Navigator.onLine and Network Information API where available
 */
export function useNetwork(): NetworkStatus {
  const getNetworkStatus = useCallback((): NetworkStatus => {
    if (typeof navigator === "undefined") {
      return { online: true };
    }

    const connection =
      (navigator as Navigator & { connection?: NetworkInformation }).connection;

    return {
      online: navigator.onLine,
      effectiveType: connection?.effectiveType,
      rtt: connection?.rtt,
      downlink: connection?.downlink,
      saveData: connection?.saveData,
    };
  }, []);

  const [status, setStatus] = useState<NetworkStatus>(getNetworkStatus);

  useEffect(() => {
    const handleChange = () => {
      setStatus(getNetworkStatus());
    };

    window.addEventListener("online", handleChange);
    window.addEventListener("offline", handleChange);

    const connection =
      (navigator as Navigator & { connection?: NetworkInformation }).connection;
    connection?.addEventListener?.("change", handleChange);

    return () => {
      window.removeEventListener("online", handleChange);
      window.removeEventListener("offline", handleChange);
      connection?.removeEventListener?.("change", handleChange);
    };
  }, [getNetworkStatus]);

  return status;
}

// Network Information API types (not fully standardized)
interface NetworkInformation extends EventTarget {
  effectiveType?: "slow-2g" | "2g" | "3g" | "4g";
  rtt?: number;
  downlink?: number;
  saveData?: boolean;
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
}

export default useNetwork;
