export const LOCAL_VSCODE_PLACEHOLDER_HOST = "cmux-vscode.local";
// Use HTTPS to match the main app's origin (https://cmux.local) and avoid mixed content issues.
// The Electron main process intercepts this URL and proxies to the local serve-web instance.
export const LOCAL_VSCODE_PLACEHOLDER_ORIGIN = `https://${LOCAL_VSCODE_PLACEHOLDER_HOST}`;
