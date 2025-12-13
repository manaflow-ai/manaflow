// Type declarations for @novnc/novnc
// Based on https://github.com/novnc/noVNC/blob/master/docs/API.md

// noVNC 1.7.0-beta exports RFB directly from the package
declare module "@novnc/novnc" {
  export { default, RFBOptions, RFBCapabilities, RFBEventMap } from "@novnc/novnc/core/rfb";
}

declare module "@novnc/novnc/core/rfb" {
  export interface RFBOptions {
    /** Object specifying credentials to provide to the server */
    credentials?: {
      username?: string;
      password?: string;
      target?: string;
    };
    /** An Array of strings specifying WebSocket subprotocols */
    wsProtocols?: string[];
  }

  export interface RFBCapabilities {
    power?: boolean;
  }

  export default class RFB {
    constructor(
      target: HTMLElement,
      urlOrChannel: string | WebSocket,
      options?: RFBOptions
    );

    // Properties (settable)
    /** Scale the remote framebuffer to fit in the container element */
    scaleViewport: boolean;
    /** Limit the remote framebuffer to the container element bounds */
    clipViewport: boolean;
    /** Move the remote framebuffer within the container element by dragging */
    dragViewport: boolean;
    /** Request the remote session to resize to the container element bounds */
    resizeSession: boolean;
    /** Disable keyboard and mouse input */
    viewOnly: boolean;
    /** Request a dot cursor when the server sets invisible cursor */
    showDotCursor: boolean;
    /** Set the background of the noVNC canvas element */
    background: string;
    /** JPEG quality level (0-9) */
    qualityLevel: number;
    /** Compression level (0-9) */
    compressionLevel: number;

    // Properties (read-only)
    /** Object with server capabilities */
    readonly capabilities: RFBCapabilities;

    // Methods
    /** Disconnect from the server */
    disconnect(): void;
    /** Send credentials to the server */
    sendCredentials(credentials: { username?: string; password?: string; target?: string }): void;
    /** Send a key event */
    sendKey(keysym: number, code: string | null, down?: boolean): void;
    /** Send Ctrl+Alt+Del key sequence */
    sendCtrlAltDel(): void;
    /** Shift keyboard focus to the canvas element */
    focus(options?: FocusOptions): void;
    /** Move keyboard focus away from the canvas element */
    blur(): void;
    /** Send the clipboard text to the server */
    clipboardPasteFrom(text: string): void;
    /** Request graceful shutdown */
    machineShutdown(): void;
    /** Request reboot */
    machineReboot(): void;
    /** Request hard reset */
    machineReset(): void;

    // Event handling
    addEventListener<K extends keyof RFBEventMap>(
      type: K,
      listener: (event: RFBEventMap[K]) => void,
      options?: boolean | AddEventListenerOptions
    ): void;
    removeEventListener<K extends keyof RFBEventMap>(
      type: K,
      listener: (event: RFBEventMap[K]) => void,
      options?: boolean | EventListenerOptions
    ): void;
  }

  export interface RFBEventMap {
    connect: CustomEvent<void>;
    disconnect: CustomEvent<{ clean: boolean }>;
    credentialsrequired: CustomEvent<void>;
    securityfailure: CustomEvent<{ status: number; reason: string }>;
    clipboard: CustomEvent<{ text: string }>;
    bell: CustomEvent<void>;
    desktopname: CustomEvent<{ name: string }>;
    capabilities: CustomEvent<{ capabilities: RFBCapabilities }>;
  }
}
