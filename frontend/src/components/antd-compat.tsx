import React, { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import {
  Alert as AntAlert,
  Button as AntButton,
  Card as AntCard,
  Checkbox as AntCheckbox,
  Dropdown as AntDropdown,
  Flex as AntFlex,
  Input as AntInput,
  Modal as AntModal,
  Pagination as AntPagination,
  Radio as AntRadio,
  Segmented as AntSegmented,
  Select as AntSelect,
  Skeleton as AntSkeleton,
  Spin as AntSpin,
  Switch as AntSwitch,
  Tag as AntTag,
  Tooltip as AntTooltip,
  Typography,
} from "antd";
import type { MenuProps, MenuRef } from "antd";

type CompatProps = Record<string, any> & {
  onChange?: React.ChangeEventHandler<any>;
  onClick?: React.MouseEventHandler<any>;
  onSubmit?: React.FormEventHandler<any>;
  onKeyDown?: React.KeyboardEventHandler<any>;
  onMouseDown?: React.MouseEventHandler<any>;
  onBlur?: React.FocusEventHandler<any>;
  onFocus?: React.FocusEventHandler<any>;
  onInput?: React.FormEventHandler<any>;
};
type SelectCompatProps = Omit<CompatProps, "onChange"> & { onChange?: (value: string | null, option?: any) => void };
type MultiSelectCompatProps = Omit<CompatProps, "onChange"> & { onChange?: (value: string[]) => void };
type NativeSelectCompatProps = Omit<CompatProps, "onChange"> & { onChange?: React.ChangeEventHandler<HTMLSelectElement> };
type PaginationCompatProps = Omit<CompatProps, "onChange"> & { onChange?: (page: number, pageSize: number) => void };
type RadioGroupCompatProps = Omit<CompatProps, "onChange"> & { onChange?: (value: string) => void };
type MenuCompatProps = Omit<CompatProps, "onChange"> & { onChange?: (open: boolean) => void };

const spacing: Record<string, number> = { xs: 8, sm: 12, md: 16, lg: 24, xl: 32 };
const toCssLength = (value: unknown): CSSProperties["margin"] =>
  typeof value === "number" ? `${value}px` : typeof value === "string" && value in spacing ? `${spacing[value]}px` : value as CSSProperties["margin"];

function takeLayout(props: CompatProps): CompatProps {
  const { p, px, py, pt, pr, pb, pl, m, mx, my, mt, mr, mb, ml, w, h, miw, maw, mih, mah, bg, c, ta, fw, fz, lh, ...rest } = props;
  const style: CSSProperties = { ...rest.style };
  if (p != null) style.padding = toCssLength(p);
  if (px != null) { style.paddingInline = toCssLength(px); }
  if (py != null) { style.paddingBlock = toCssLength(py); }
  if (pt != null) style.paddingTop = toCssLength(pt);
  if (pr != null) style.paddingRight = toCssLength(pr);
  if (pb != null) style.paddingBottom = toCssLength(pb);
  if (pl != null) style.paddingLeft = toCssLength(pl);
  if (m != null) style.margin = toCssLength(m);
  if (mx != null) style.marginInline = toCssLength(mx);
  if (my != null) style.marginBlock = toCssLength(my);
  if (mt != null) style.marginTop = toCssLength(mt);
  if (mr != null) style.marginRight = toCssLength(mr);
  if (mb != null) style.marginBottom = toCssLength(mb);
  if (ml != null) style.marginLeft = toCssLength(ml);
  if (w != null) style.width = toCssLength(w) as CSSProperties["width"];
  if (h != null) style.height = toCssLength(h) as CSSProperties["height"];
  if (miw != null) style.minWidth = toCssLength(miw) as CSSProperties["minWidth"];
  if (maw != null) style.maxWidth = toCssLength(maw) as CSSProperties["maxWidth"];
  if (mih != null) style.minHeight = toCssLength(mih) as CSSProperties["minHeight"];
  if (mah != null) style.maxHeight = toCssLength(mah) as CSSProperties["maxHeight"];
  if (bg != null) style.background = colorValue(bg);
  if (c != null) style.color = colorValue(c);
  if (ta != null) style.textAlign = ta;
  if (fw != null) style.fontWeight = fw;
  if (fz != null) style.fontSize = toCssLength(fz) as CSSProperties["fontSize"];
  if (lh != null) style.lineHeight = lh;
  return { ...rest, style };
}

function colorValue(color: unknown) {
  const value = String(color ?? "");
  if (value.startsWith("gray") || value === "dimmed") return "var(--app-muted)";
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value;
  if (value.startsWith("red")) return "var(--app-error)";
  if (value.startsWith("yellow") || value.startsWith("orange")) return "var(--app-warning)";
  if (value.startsWith("green") || value.startsWith("teal")) return "var(--app-success)";
  if (value.startsWith("blue")) return "var(--app-primary-text)";
  return value;
}

function toRadiusLength(value: unknown): CSSProperties["borderRadius"] {
  if (typeof value === "number") return `${Math.max(8, value)}px`;
  if (typeof value !== "string") return "8px";
  const namedRadius: Record<string, string> = { xs: "8px", sm: "8px", md: "8px", lg: "12px", xl: "16px", full: "9999px" };
  if (namedRadius[value]) return namedRadius[value];
  const numeric = value.match(/^(\d+(?:\.\d+)?)(px)?$/);
  if (numeric && Number(numeric[1]) < 8) return "8px";
  return value;
}

export function Box(props: CompatProps) {
  const { component: Component = "div", ...rest } = takeLayout(props);
  return <Component {...rest} />;
}

function SpacingLayout({ direction = "row", gap = "md", justify, align, wrap, grow, children, ...props }: CompatProps & { direction?: "row" | "column" }) {
  const rest = takeLayout(props);
  return <AntFlex {...rest} vertical={direction === "column"} gap={spacing[String(gap)] ?? gap} justify={justify} align={align} wrap={wrap} flex={grow ? "1" : undefined}>{children}</AntFlex>;
}
export function Group(props: CompatProps) { return <SpacingLayout {...props} direction="row" />; }
export function Stack(props: CompatProps) { return <SpacingLayout {...props} direction="column" />; }
export function SimpleGrid({ cols = 2, spacing: gridGap = "md", verticalSpacing, children, ...props }: CompatProps) {
  const responsive = typeof cols === "object" ? cols : null;
  const count = responsive ? responsive.base ?? responsive.sm ?? 1 : cols;
  const rest = takeLayout(props);
  return <div {...rest} style={{ display: "grid", gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`, gap: spacing[String(gridGap)] ?? gridGap, rowGap: spacing[String(verticalSpacing ?? gridGap)] ?? verticalSpacing ?? gridGap, ...rest.style }}>{children}</div>;
}
export function Center({ children, ...props }: CompatProps) { const rest = takeLayout(props); return <AntFlex {...rest} align="center" justify="center">{children}</AntFlex>; }
export function Container({ size = "lg", children, ...props }: CompatProps) {
  const maxWidth = typeof size === "number" ? size : ({ xs: 540, sm: 720, md: 960, lg: 1140, xl: 1320 } as Record<string, number>)[size] ?? 1140;
  const rest = takeLayout(props);
  return <div {...rest} style={{ width: "100%", maxWidth, marginInline: "auto", ...rest.style }}>{children}</div>;
}

export function Text({ component = "span", size, c, fw, ta, lineClamp, truncate, children, ...props }: CompatProps) {
  const rest = takeLayout({ ...props, c, fw, ta, fz: size === "xs" ? 13 : size === "sm" ? 15 : size === "lg" ? 18 : size === "xl" ? 20 : undefined });
  if (lineClamp != null) rest.style = { ...rest.style, display: "-webkit-box", WebkitLineClamp: lineClamp, WebkitBoxOrient: "vertical", overflow: "hidden" };
  if (truncate) rest.style = { ...rest.style, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  return <Typography.Text {...rest} component={component}>{children}</Typography.Text>;
}
export function Title({ order = 1, children, ...props }: CompatProps) {
  const { size, ...restProps } = props;
  const rest = takeLayout(restProps);
  return <Typography.Title {...rest} level={order} style={{ ...rest.style, ...(size ? { fontSize: size } : {}) }}>{children}</Typography.Title>;
}
export function ThemeIcon({ children, color = "blue", variant = "light", size = 32, radius, ...props }: CompatProps) {
  const rest = takeLayout(props);
  const foreground = colorValue(color);
  const background = variant === "light" ? `color-mix(in srgb, ${foreground} 12%, var(--app-surface))` : foreground;
  const side = typeof size === "number" ? size : ({ xs: 24, sm: 28, md: 32, lg: 40, xl: 48 } as Record<string, number>)[size] ?? 32;
  return <span {...rest} aria-hidden="true" style={{ width: side, height: side, display: "inline-flex", alignItems: "center", justifyContent: "center", color: variant === "light" ? foreground : "white", background, flex: "0 0 auto", ...rest.style, borderRadius: toRadiusLength(rest.style?.borderRadius ?? radius ?? 8) }}>{children}</span>;
}

export const Button = React.forwardRef<React.ElementRef<typeof AntButton>, CompatProps>(function Button({ component, to, href, type: htmlType = "button", variant = "filled", color, leftSection, rightSection, fullWidth, size = "sm", children, ...props }, ref) {
  const { mt, mb, ml, mr, ...restProps } = props;
  const rest = takeLayout({ ...restProps, mt, mb, ml, mr });
  const type = variant === "filled" ? "primary" : variant === "subtle" || variant === "transparent" ? "text" : "default";
  const danger = color === "red" || color === "danger";
  const as = component ?? (href ? "a" : null);
  const baseButtonStyle = {
    ...rest.style,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: leftSection || rightSection ? 8 : undefined,
    minHeight: rest.style?.minHeight ?? (size === "lg" ? 40 : size === "xs" ? 32 : 36),
    paddingInline: size === "xs" ? 12 : size === "lg" ? 18 : 14,
    borderRadius: "8px",
    ...(fullWidth ? { width: "100%" } : {}),
    ...(mt != null ? { marginTop: toCssLength(mt) } : {}),
    ...(mb != null ? { marginBottom: toCssLength(mb) } : {}),
    ...(ml != null ? { marginLeft: toCssLength(ml) } : {}),
    ...(mr != null ? { marginRight: toCssLength(mr) } : {}),
  };
  const content = (
    <span className="app-compat-button-content">
      {leftSection ? <span className="app-compat-button-icon" aria-hidden="true">{leftSection}</span> : null}
      {children != null ? <span className="app-compat-button-label">{children}</span> : null}
      {rightSection ? <span className="app-compat-button-icon" aria-hidden="true">{rightSection}</span> : null}
    </span>
  );
  if (as) {
    const classes = [rest.className, "ant-btn", "app-compat-button-link", type === "primary" ? "ant-btn-primary" : "ant-btn-default", danger ? "ant-btn-dangerous" : "", props.disabled ? "ant-btn-disabled" : "", size === "xs" ? "ant-btn-sm" : size === "lg" ? "ant-btn-lg" : ""].filter(Boolean).join(" ");
    const linkSemantics = href != null || to != null || as === "a";
    return React.createElement(as, { ...rest, ref, to, href, className: classes, style: baseButtonStyle, "data-button-variant": variant, "data-button-color": danger ? "danger" : typeof color === "string" ? color : undefined, role: linkSemantics ? undefined : "button", "aria-disabled": props.disabled || undefined, tabIndex: props.disabled ? -1 : undefined, onClick: (event: React.MouseEvent) => { if (props.disabled) { event.preventDefault(); return; } props.onClick?.(event); }, children: content });
  }
  const classes = [rest.className, "app-compat-button"].filter(Boolean).join(" ");
  return <AntButton
    {...rest}
    ref={ref}
    className={classes}
    href={href}
    htmlType={htmlType}
    type={type}
    danger={danger}
    block={fullWidth}
    size={size === "xs" ? "small" : size === "lg" ? "large" : "middle"}
    style={baseButtonStyle}
    aria-label={props["aria-label"] ?? (typeof children === "string" || typeof children === "number" ? String(children) : undefined)}
    data-button-variant={variant}
    data-button-color={danger ? "danger" : typeof color === "string" ? color : undefined}
  >{content}</AntButton>;
});
export function ActionIcon({ children, color, variant = "light", size = "sm", ...props }: CompatProps) {
  const rest = takeLayout(props);
  return <AntButton
    {...rest}
    className={[rest.className, "app-compat-action-icon", "app-compat-button"].filter(Boolean).join(" ")}
    type={variant === "filled" ? "primary" : variant === "subtle" || variant === "transparent" ? "text" : "default"}
    danger={color === "red" || color === "danger"}
    style={{ width: size === "lg" ? 40 : 32, height: size === "lg" ? 40 : 32, borderRadius: 8, ...rest.style }}
    size={size === "xs" ? "small" : size === "lg" ? "large" : "middle"}
    icon={children}
    aria-label={props["aria-label"]}
    data-button-variant={variant ?? "light"}
    data-button-color={color === "red" || color === "danger" ? "danger" : typeof color === "string" ? color : undefined}
  />;
}
export function Card({ children, padding, p, withBorder = true, shadow, radius, ...props }: CompatProps) {
  const rest = takeLayout({ ...props, p: padding ?? p });
  const bodyPadding = rest.style?.padding ?? 16;
  const { padding: _padding, ...rootStyle } = rest.style ?? {};
  const requestedRadius = rootStyle.borderRadius ?? radius;
  const cardStyle = { ...rootStyle, ...(requestedRadius == null ? {} : { borderRadius: toRadiusLength(requestedRadius) }) };
  return <AntCard {...rest} style={cardStyle} variant={withBorder ? "outlined" : "borderless"} styles={{ body: { padding: bodyPadding } }}>{children}</AntCard>;
}
export function Badge({ children, color, variant = "light", ...props }: CompatProps) {
  const rest = takeLayout(props);
  const status = color === "red" ? "error" : color === "green" || color === "teal" ? "success" : color === "yellow" || color === "orange" ? "warning" : color === "blue" || color === "cyan" ? "info" : null;
  const colors = status ? {
    color: `var(--app-${status === "error" ? "error" : status})`,
    backgroundColor: `var(--app-${status}-bg)`,
    borderColor: "transparent",
  } : undefined;
  const mapped = status === "error" ? "error" : status === "success" ? "success" : status === "warning" ? "warning" : status === "info" ? "processing" : "default";
  return <AntTag
    {...rest}
    color={status ? undefined : mapped}
    style={{
      display: "inline-flex",
      width: "fit-content",
      maxWidth: "100%",
      minHeight: 22,
      height: "auto",
      alignItems: "center",
      alignSelf: "center",
      paddingBlock: 2,
      lineHeight: "18px",
      whiteSpace: "nowrap",
      ...rest.style,
      ...colors,
    }}
    bordered={variant !== "dot"}
  >{children}</AntTag>;
}
export function Alert({ title, children, color = "blue", icon, ...props }: CompatProps) {
  const rest = takeLayout(props);
  const type = color === "red" ? "error" : color === "yellow" || color === "orange" ? "warning" : color === "green" || color === "teal" ? "success" : "info";
  return <AntAlert {...rest} type={type} showIcon={Boolean(icon)} title={title} description={children} />;
}
export function Divider(props: CompatProps) { return <div role="separator" {...takeLayout(props)} className={props.className ?? "ant-divider"} />; }
export function Loader({ size = "md", ...props }: CompatProps) { return <AntSpin {...props} size={size === "xs" || size === "sm" ? "small" : size === "lg" ? "large" : "default"} />; }
export function Skeleton(props: CompatProps) { return <AntSkeleton active {...props} />; }
export function Checkbox({ label, children, onChange, ...props }: CompatProps) {
  return <AntCheckbox {...props as any} onChange={(event) => onChange?.({ currentTarget: { checked: event.target.checked }, target: { checked: event.target.checked } } as any)}>{label ?? children}</AntCheckbox>;
}
export function Switch({ label, onChange, ...props }: CompatProps) {
  return <span className="app-switch-field"><AntSwitch {...props as any} onChange={(checked) => onChange?.({ currentTarget: { checked }, target: { checked } } as any)} />{label ? <label>{label}</label> : null}</span>;
}

function Field({ id, label, labelProps, labelStyle, description, error, children, ...props }: CompatProps) {
  const rest = takeLayout(props);
  return <div className={`ant-form-item ${error ? "ant-form-item-has-error" : ""} ${rest.className ?? ""}`.trim()} style={rest.style}>
    {label ? <label htmlFor={id} className="ant-form-item-label" {...labelProps} style={{ ...labelStyle, ...labelProps?.style }}>{label}</label> : null}
    {children}
    {error ? <div className="ant-form-item-explain-error">{error}</div> : description ? <div className="ant-form-item-extra">{description}</div> : null}
  </div>;
}
export const TextInput = React.forwardRef<HTMLInputElement, CompatProps>(function TextInput({ label, labelProps, description, error, size, styles, ...props }, ref) {
  const fieldId = props.id ?? React.useId();
  const setInputRef = (instance: any) => {
    const element = instance?.input ?? null;
    if (typeof ref === "function") ref(element);
    else if (ref) ref.current = element;
  };
  return <Field id={fieldId} label={label} labelProps={labelProps} labelStyle={styles?.label} description={description} error={error} className={props.className} style={props.style}><AntInput {...props as any} id={fieldId} ref={setInputRef} styles={styles?.input ? { input: styles.input } : undefined} status={error ? "error" : undefined} size={size === "xs" || size === "sm" ? "small" : size === "lg" ? "large" : "middle"} /></Field>;
});
export function Textarea({ label, labelProps, description, error, autosize, minRows, maxRows, styles, ...props }: CompatProps) {
  const { className, ...inputProps } = props;
  const fieldId = inputProps.id ?? React.useId();
  const size = inputProps.size;
  const textAreaStyle = { ...styles?.input, ...inputProps.style };
  return <Field id={fieldId} label={label} labelProps={labelProps} labelStyle={styles?.label} description={description} error={error} className={className}><AntInput.TextArea {...inputProps as any} id={fieldId} style={textAreaStyle} status={error ? "error" : undefined} size={size === "xs" || size === "sm" ? "small" : size === "lg" ? "large" : "middle"} autoSize={autosize || minRows ? { minRows, maxRows } : undefined} /></Field>;
}

function convertOptions(data: unknown): Array<{ value: string; label: ReactNode; [key: string]: unknown }> {
  if (!Array.isArray(data)) return [];
  return data.map((entry: any) => typeof entry === "string" ? { value: entry, label: entry } : ({ ...entry, value: String(entry.value), label: entry.label ?? String(entry.value) }));
}
export function Select({ data, searchable, classNames, allowDeselect, clearable, styles: _styles, label, description, error, labelProps, comboboxProps: _comboboxProps, ...props }: SelectCompatProps) {
  const fieldId = props.id ?? React.useId();
  const { input, dropdown } = classNames ?? {};
  const size = props.size;
  const getPopupContainer = props.getPopupContainer ?? ((triggerNode: HTMLElement) =>
    (triggerNode.closest(".ant-modal-wrap") as HTMLElement | null) ?? document.body);
  const optionRender = props.optionRender ?? ((option: { label?: ReactNode }) => option.label);
  const { onChange, ...layoutProps } = props;
  const { className, style, ...controlProps } = takeLayout(layoutProps);
  return <Field id={fieldId} label={label} labelProps={labelProps} description={description} error={error} className={className} style={style}>
    <AntSelect {...controlProps} onChange={onChange} id={fieldId} style={{ width: "100%", minWidth: 0, ..._styles?.input }} getPopupContainer={getPopupContainer} optionLabelProp={props.optionLabelProp ?? "label"} optionFilterProp={props.optionFilterProp ?? "label"} optionRender={optionRender} size={size === "xs" || size === "sm" ? "small" : size === "lg" ? "large" : "middle"} options={convertOptions(data ?? props.options)} showSearch={searchable ?? props.showSearch} allowClear={Boolean(clearable || allowDeselect)} className={[input].filter(Boolean).join(" ")} classNames={{ popup: { root: dropdown } }} />
  </Field>;
}
export function NativeSelect({ onChange, ...props }: NativeSelectCompatProps) {
  return <Select {...props} onChange={(value: string | null) => onChange?.({ currentTarget: { value }, target: { value } } as any)} />;
}
export function MultiSelect({ data, searchable, clearable, styles: _styles, label, description, error, labelProps, ...props }: MultiSelectCompatProps) {
  const fieldId = props.id ?? React.useId();
  const getPopupContainer = props.getPopupContainer ?? ((triggerNode: HTMLElement) =>
    (triggerNode.closest(".ant-modal-wrap") as HTMLElement | null) ?? document.body);
  const optionRender = props.optionRender ?? ((option: { label?: ReactNode }) => option.label);
  const { onChange, ...layoutProps } = props;
  const { className, style, ...controlProps } = takeLayout(layoutProps);
  return <Field id={fieldId} label={label} labelProps={labelProps} description={description} error={error} className={className} style={style}>
    <AntSelect {...controlProps} onChange={onChange} id={fieldId} style={{ width: "100%", minWidth: 0, ..._styles?.input }} mode="multiple" getPopupContainer={getPopupContainer} size={props.size === "xs" || props.size === "sm" ? "small" : props.size === "lg" ? "large" : "middle"} optionLabelProp={props.optionLabelProp ?? "label"} optionFilterProp={props.optionFilterProp ?? "label"} optionRender={optionRender} options={convertOptions(data ?? props.options)} showSearch={searchable ?? props.showSearch} allowClear={clearable} />
  </Field>;
}
export function Pagination({ total = 1, value, current, pageSize = 1, withEdges: _withEdges, siblings: _siblings, boundaries: _boundaries, ...props }: PaginationCompatProps) {
  return <AntPagination {...props as any} total={total * pageSize} pageSize={pageSize} current={current ?? value} showSizeChanger={props.showSizeChanger ?? false} />;
}

export const Radio: any = Object.assign(
  function RadioItem({ label, color: _color, ...props }: CompatProps) { return <AntRadio {...props as any}>{label ?? props.children}</AntRadio>; },
  { Group: function RadioGroup({ label, onChange, styles: radioStyles, ...props }: RadioGroupCompatProps) { const fieldId = props.id ?? React.useId(); return <Field id={fieldId} label={label} labelStyle={radioStyles?.label}><AntRadio.Group {...props as any} id={fieldId} onChange={(event) => onChange?.(event.target.value)} /></Field>; } },
);
export function SegmentedControl({ data, onChange, ...props }: Omit<CompatProps, "onChange"> & { onChange?: (value: string) => void }) { return <AntSegmented {...props} onChange={(value) => onChange?.(String(value))} options={convertOptions(data)} />; }

type MenuContextValue = { withinPortal?: boolean };
const MenuContext = createContext<MenuContextValue>({});
function menuItems(children: ReactNode): NonNullable<MenuProps["items"]> {
  return React.Children.toArray(children).flatMap((child: any) => {
    if (!React.isValidElement(child)) return [];
    const childProps = child.props as CompatProps;
    if (child.type === MenuItem) {
      const { component: Component, to, href, className, "aria-current": ariaCurrent } = childProps;
      const label = Component
        ? React.createElement(Component, { to, href, className, "aria-current": false }, childProps.children)
        : childProps.children;
      const activate = (info: { domEvent: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement> }) => {
        if (childProps.disabled) return;
        const event = info.domEvent;
        // Dropdown autofocus initially targets its menuitem container. Enter
        // must activate the preserved link just as Enter on the link itself.
        if (Component && event.type === "keydown" && "key" in event && event.key === "Enter"
          && !(event.target instanceof Element && event.target.closest("a[href]"))) {
          const link = event.currentTarget.querySelector<HTMLAnchorElement>("a[href]");
          if (link) {
            event.preventDefault();
            link.click();
            return;
          }
        }
        (childProps.onClick as ((event: unknown) => void) | undefined)?.(info);
      };
      return [{ key: childProps.key ?? String(childProps.children), label, disabled: childProps.disabled, danger: childProps.color === "red", onClick: activate, "aria-current": ariaCurrent } as any];
    }
    return menuItems(childProps.children);
  });
}
function selectedMenuKeys(children: ReactNode): string[] {
  return React.Children.toArray(children).flatMap((child: any) => {
    if (!React.isValidElement(child)) return [];
    const childProps = child.props as CompatProps;
    if (child.type === MenuItem) return childProps["aria-current"] === "page" ? [String(childProps.children)] : [];
    return selectedMenuKeys(childProps.children);
  });
}
function MenuRoot({ children, position, opened, onChange, trigger = "click", ...props }: MenuCompatProps) {
  const target = React.Children.toArray(children).find((child: any) => React.isValidElement(child) && child.type === MenuTarget) as any;
  const dropdown = React.Children.toArray(children).find((child: any) => React.isValidElement(child) && child.type === MenuDropdown) as any;
  const ctx = useContext(MenuContext);
  const openerRef = React.useRef<HTMLElement | null>(null);
  const menuRef = React.useRef<MenuRef | null>(null);
  const openedRef = React.useRef(opened);
  const menuGenerationRef = React.useRef(0);
  if (openedRef.current !== opened) menuGenerationRef.current += 1;
  openedRef.current = opened;
  const focusFrameRef = React.useRef<number | null>(null);
  const focusGenerationRef = React.useRef(0);
  const cancelMenuFocus = React.useCallback(() => {
    focusGenerationRef.current += 1;
    if (focusFrameRef.current !== null) window.cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = null;
  }, []);
  const scheduleMenuFocus = React.useCallback(() => {
    cancelMenuFocus();
    const opener = openerRef.current;
    if (!openedRef.current || !opener?.isConnected) return;
    const generation = focusGenerationRef.current;
    const frame = requestAnimationFrame(() => {
      if (focusFrameRef.current === frame) focusFrameRef.current = null;
      if (generation !== focusGenerationRef.current || !openedRef.current ||
          !opener.isConnected || document.activeElement !== opener) return;
      menuRef.current?.focus({ preventScroll: true });
    });
    focusFrameRef.current = frame;
  }, [cancelMenuFocus]);
  const setMenuRef = React.useCallback((menu: MenuRef | null) => {
    menuRef.current = menu;
    if (menu?.menu?.list) menu.menu.list.inert = openedRef.current === false;
    if (menu) scheduleMenuFocus(); else cancelMenuFocus();
  }, [cancelMenuFocus, scheduleMenuFocus]);
  React.useLayoutEffect(() => {
    // Dropdown caches closing content until its exit animation finishes.
    // Native inert blocks retained focus callbacks during that interval.
    if (menuRef.current?.menu?.list) menuRef.current.menu.list.inert = opened === false;
  }, [opened]);
  React.useEffect(() => {
    if (opened) scheduleMenuFocus(); else cancelMenuFocus();
    return cancelMenuFocus;
  }, [opened, cancelMenuFocus, scheduleMenuFocus]);
  if (!target || !dropdown) return <div>{children}</div>;
  const placement = ({ "bottom-end": "bottomRight", "bottom-start": "bottomLeft", "top-end": "topRight" } as Record<string, string>)[position] ?? "bottom";
  const closeMenu = () => {
    cancelMenuFocus();
    openedRef.current = false;
    const opener = openerRef.current, active = document.activeElement;
    onChange?.(false);
    if (opener?.isConnected && (active === opener || menuRef.current?.menu?.list?.contains(active))) {
      opener.focus({ preventScroll: true });
    }
    if (menuRef.current?.menu?.list) menuRef.current.menu.list.inert = true;
  };
  const menu = {
    // A closed native menu must not retain its own pending Arrow/Home/End focus.
    // Remounting also prevents an old callback from targeting an immediate reopen.
    key: opened === undefined ? undefined : menuGenerationRef.current,
    ref: setMenuRef,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu(); }
      // Without upstream autofocus its Tab handler would focus the menu again.
      // Restore the opener synchronously and let native Tab choose the next control.
      if (event.key === "Tab" && opened === true) { event.stopPropagation(); closeMenu(); }
    },
    items: menuItems(dropdown.props.children),
    selectedKeys: selectedMenuKeys(dropdown.props.children),
    ...({ "aria-label": dropdown.props["aria-label"] } as any),
  };
  const sourceTarget = target.props.children;
  const targetNode = React.isValidElement(sourceTarget) ? React.cloneElement(sourceTarget as React.ReactElement<any>, {
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      openerRef.current = event.currentTarget;
      (sourceTarget.props as CompatProps).onKeyDown?.(event);
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") { event.preventDefault(); onChange?.(true); }
      if (event.key === "Escape" && opened) { event.preventDefault(); closeMenu(); }
    },
    onClick: (event: React.MouseEvent<HTMLElement>) => { openerRef.current = event.currentTarget; (sourceTarget.props as CompatProps).onClick?.(event); },
  }) : sourceTarget;
  if (React.isValidElement(targetNode) && targetNode.type === Tooltip) {
    const tooltipProps = targetNode.props as CompatProps;
    return <MenuContext.Provider value={ctx}><AntTooltip title={tooltipProps.label}><AntDropdown autoFocus={opened === undefined} menu={menu} trigger={[trigger]} open={opened} onOpenChange={onChange} placement={placement as any} classNames={{ root: props.className }}>{tooltipProps.children}</AntDropdown></AntTooltip></MenuContext.Provider>;
  }
  return <MenuContext.Provider value={ctx}><AntDropdown autoFocus={opened === undefined} menu={menu} trigger={[trigger]} open={opened} onOpenChange={onChange} placement={placement as any} classNames={{ root: props.className }}>{targetNode}</AntDropdown></MenuContext.Provider>;
}
function MenuTarget({ children }: CompatProps) { return <>{children}</>; }
function MenuDropdown() { return null; }
function MenuItem({ children, ...props }: CompatProps) { return <button type="button" {...props}>{children}</button>; }
export const Menu: any = Object.assign(MenuRoot, { Target: MenuTarget, Dropdown: MenuDropdown, Item: MenuItem });

export function Tooltip({ label, position, withArrow, multiline, w, children, ...props }: CompatProps) {
  const placement = position === "bottom" ? "bottom" : position === "top" ? "top" : position === "right" ? "right" : "left";
  return <AntTooltip {...props} title={label} placement={placement} arrow={withArrow} styles={w ? { ...props.styles, root: { ...props.styles?.root, maxWidth: w } } : props.styles}>{children}</AntTooltip>;
}
export function Modal({ opened, onClose, onCancel, closeOnClickOutside = true, closeOnEscape = true, withCloseButton = true, closeButtonProps, centered, size = "md", classNames, authoring = false, children, ...props }: CompatProps) {
  const contentRef = React.useRef<HTMLDivElement>(null);
  const openerRef = React.useRef<HTMLElement | null>(null);
  const wasOpenedRef = React.useRef(false);
  if (opened && !wasOpenedRef.current) {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpenedRef.current = Boolean(opened);
  React.useEffect(() => () => {
    queueMicrotask(() => {
      const opener = openerRef.current;
      if (!opener?.isConnected || document.activeElement !== document.body) return;
      const anotherDialogIsVisible = Array.from(document.querySelectorAll(".ant-modal-wrap")).some((dialog) => {
        const style = getComputedStyle(dialog);
        return style.display !== "none" && style.visibility !== "hidden" && dialog.getClientRects().length > 0;
      });
      if (!anotherDialogIsVisible) opener.focus({ preventScroll: true });
    });
  }, []);
  const width = typeof size === "number" || (typeof size === "string" && (size.endsWith("%") || size.endsWith("px"))) ? size : ({ xs: 360, sm: 480, md: 640, lg: 800, xl: 960 } as Record<string, number>)[size] ?? 640;
  const handleEscapeCapture = (event: React.KeyboardEvent) => {
    if (!opened || !closeOnEscape || event.key !== "Escape") return;
    const selectIsOpen = document.querySelector(".ant-select-open") !== null;
    const popupSelector = ".ant-picker-dropdown, .ant-dropdown, .ant-popover";
    const popupIsOpen = selectIsOpen || Array.from(document.querySelectorAll(popupSelector)).some((popup) => {
      const style = window.getComputedStyle(popup);
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity) > 0
        && popup.getAttribute("aria-hidden") !== "true";
    });
    if (popupIsOpen) return;
    event.stopPropagation();
    (onCancel ?? onClose)?.(event);
  };
  const closable = withCloseButton ? (closeButtonProps ? { ...closeButtonProps } : true) : false;
  return <AntModal {...props} title={typeof props.title === "string" ? <span role="heading" aria-level={2}>{props.title}</span> : props.title} className={[props.className, authoring ? "app-authoring-modal" : ""].filter(Boolean).join(" ")} open={opened} onCancel={onCancel ?? onClose} mask={props.mask === false ? false : { ...(typeof props.mask === "object" ? props.mask : {}), closable: closeOnClickOutside }} keyboard={closeOnEscape} closable={closable} centered={centered} width={width} footer={null} afterOpenChange={(isOpen) => {
    props.afterOpenChange?.(isOpen);
    if (!isOpen || contentRef.current?.contains(document.activeElement)) return;
    contentRef.current?.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly]), [role="combobox"]:not([disabled])')?.focus({ preventScroll: true });
  }} classNames={classNames ? { body: classNames.body, close: classNames.close, root: classNames.root, header: classNames.header } : undefined}><div ref={contentRef} className={authoring ? "app-authoring-modal-content" : undefined} onKeyDownCapture={handleEscapeCapture}>{children}</div></AntModal>;
}

export const AppShell: any = Object.assign(
  function AppShellRoot({ children, padding, header: _header, ...props }: CompatProps) { return <div {...takeLayout({ ...props, p: padding })}>{children}</div>; },
  {
    Header: (props: CompatProps) => { const rest = takeLayout(props); return <header {...rest} />; },
    Main: (props: CompatProps) => { const rest = takeLayout(props); return <main {...rest} />; },
    Navbar: (props: CompatProps) => <nav {...props} />,
  },
);
