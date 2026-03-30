export type ImperativeExampleMount<Props = unknown> = (
  container: HTMLElement,
  props?: Props,
) => void | (() => void) | Promise<void | (() => void)>;

