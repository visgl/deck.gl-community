import type {ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode} from 'react';

type ClassValue = string | number | false | null | undefined;

export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(' ');
}

export function Badge(props: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props}>{props.children}</span>;
}

export function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...props}>
      {props.children}
    </button>
  );
}

export function Checkbox(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} type="checkbox" />;
}

export function Accordion(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props}>{props.children}</div>;
}

export function AccordionItem(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props}>{props.children}</div>;
}

export function AccordionTrigger(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...props}>
      {props.children}
    </button>
  );
}

export function AccordionContent(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props}>{props.children}</div>;
}

export function Tabs(props: HTMLAttributes<HTMLDivElement> & {value?: string}) {
  return <div {...props}>{props.children}</div>;
}

export function TabsList(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props}>{props.children}</div>;
}

export function TabsTrigger(
  props: ButtonHTMLAttributes<HTMLButtonElement> & {value?: string; children?: ReactNode}
) {
  const {value: _value, ...buttonProps} = props;
  return (
    <button type="button" {...buttonProps}>
      {props.children}
    </button>
  );
}

export function TabsContent(props: HTMLAttributes<HTMLDivElement> & {value?: string}) {
  return <div {...props}>{props.children}</div>;
}
