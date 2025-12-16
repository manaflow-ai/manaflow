import contextMenu, { type Options as ContextMenuOptions } from "electron-context-menu";
import type {
  BrowserView,
  BrowserWindow,
  WebContents,
  WebContentsView,
} from "electron";

const baseContextMenuOptions: Readonly<ContextMenuOptions> = Object.freeze({
  showCopyImageAddress: true,
  showSaveImage: true,
  showSaveImageAs: true,
  showCopyVideoAddress: true,
  showSaveVideo: true,
  showSaveVideoAs: true,
  showSaveLinkAs: true,
  shouldShowMenu: (_event, parameters) =>
    parameters.isEditable || parameters.linkURL.length === 0,
});

export function registerGlobalContextMenu(): () => void {
  return contextMenu(baseContextMenuOptions);
}

export function registerContextMenuForTarget(
  target: BrowserWindow | BrowserView | WebContents | WebContentsView,
): () => void {
  return contextMenu({ ...baseContextMenuOptions, window: target });
}
