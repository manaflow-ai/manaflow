const SELECTOR =
  "[data-drag-disable-pointer], [data-drag-disable-pointer] canvas, [data-drag-disable-pointer] iframe";

export function disableDragPointerEvents(): void {
  const elements = Array.from(document.querySelectorAll(SELECTOR));
  for (const el of elements) {
    if (el instanceof HTMLElement) {
      const current = el.style.pointerEvents;
      el.dataset.prevPointerEvents = current ? current : "__unset__";
      el.style.pointerEvents = "none";
    }
  }
}

export function restoreDragPointerEvents(): void {
  const elements = Array.from(document.querySelectorAll(SELECTOR));
  for (const el of elements) {
    if (el instanceof HTMLElement) {
      const prev = el.dataset.prevPointerEvents;
      if (prev !== undefined) {
        if (prev === "__unset__") el.style.removeProperty("pointer-events");
        else el.style.pointerEvents = prev;
        delete el.dataset.prevPointerEvents;
      } else {
        el.style.removeProperty("pointer-events");
      }
    }
  }
}
