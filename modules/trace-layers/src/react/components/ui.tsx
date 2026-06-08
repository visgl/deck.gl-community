import type {ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode} from 'react';

type ClassValue = string | number | false | null | undefined;

/** Joins truthy class name fragments into one class string. */
export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(' ');
}

/** Minimal badge primitive used by Tracevis cards and labels. */
export function Badge({
  children,
  className,
  variant: _variant,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {variant?: 'default' | 'outline' | 'destructive'}) {
  return (
    <span className={className} {...props}>
      {children}
    </span>
  );
}

/** Minimal checkbox primitive with the SQLRooms-compatible change callback shape. */
export function Checkbox({
  checked,
  onCheckedChange,
  onChange,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
  onChange?: InputHTMLAttributes<HTMLInputElement>['onChange'];
  onCheckedChange?: (checked: boolean) => void;
}) {
  return (
    <input
      {...props}
      type="checkbox"
      checked={Boolean(checked)}
      onChange={event => {
        onChange?.(event);
        onCheckedChange?.(event.currentTarget.checked);
      }}
    />
  );
}

/** Minimal uncontrolled accordion container. */
export function Accordion({
  children,
  type: _type,
  defaultValue: _defaultValue,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  type?: 'single' | 'multiple';
  defaultValue?: string | string[];
}) {
  return <div {...props}>{children}</div>;
}

/** Minimal accordion item wrapper. */
export function AccordionItem({
  children,
  value: _value,
  ...props
}: HTMLAttributes<HTMLDivElement> & {value?: string}) {
  return <div {...props}>{children}</div>;
}

/** Minimal accordion trigger that preserves Tracevis panel styling hooks. */
export function AccordionTrigger({
  children,
  type: _type,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...props}>
      {children}
    </button>
  );
}

/** Minimal accordion content wrapper. */
export function AccordionContent(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props}>{props.children}</div>;
}

/** Minimal tabs root wrapper with the SQLRooms-compatible value callback shape. */
export function Tabs({
  children,
  value,
  onValueChange: _onValueChange,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  value?: string;
  onValueChange?: (value: string) => void;
}) {
  return (
    <div data-value={value} {...props}>
      {children}
    </div>
  );
}

/** Minimal tabs list wrapper. */
export function TabsList(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props}>{props.children}</div>;
}

/** Minimal tabs trigger button. */
export function TabsTrigger({
  children,
  value,
  onClick,
  type: _type,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {value?: string; children?: ReactNode}) {
  return (
    <button type="button" data-value={value} onClick={onClick} {...props}>
      {children}
    </button>
  );
}
