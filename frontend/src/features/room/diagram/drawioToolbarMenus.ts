type NativePopup = { div?: HTMLElement };
type NativePopupPrototype = {
  popup(this: NativePopup, x: number, y: number, cell: unknown, event?: Event): unknown;
};

export function installDrawioToolbarMenus(target: Window) {
  const native = target as Window & { mxPopupMenu?: { prototype: NativePopupPrototype } };
  const prototype = native.mxPopupMenu?.prototype;
  if (!prototype?.popup) return;
  const popup = prototype.popup;

  // draw.io fits long menus to the entire iframe. Only toolbar dropdowns
  // reserve the toolbar's height; canvas menus keep their pointer coordinates.
  prototype.popup = function (x, y, cell, event) {
    const trigger = event?.target as Element | null | undefined;
    const toolbar = trigger?.closest?.(".geToolbarContainer");
    this.div?.classList.toggle("interhubToolbarMenu", !!toolbar);
    if (toolbar) this.div?.style.setProperty("--interhub-toolbar-bottom", `${toolbar.getBoundingClientRect().bottom}px`);
    return popup.call(this, x, y, cell, event);
  };
}
