// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** Current browser fullscreen or viewport-filling fallback state. */
export type FullScreenMode = 'none' | 'native' | 'fallback';

/** Options for a framework-independent fullscreen controller. */
export type FullScreenControllerOptions = {
  /** Connected visualization host to expand, without moving or remounting its children. */
  target: HTMLElement;
  /** Accessible dialog name used for the fallback when the host has no label. */
  label?: string;
  /** Called when the actual fullscreen mode changes. */
  onChange?: (mode: FullScreenMode) => void;
  /** Preferred focus target inside the expanded host, for example its exit button. */
  getInitialFocus?: () => HTMLElement | null;
};

const OWNERS = new WeakMap<Document, FullScreenController>();
const MARKER = 'data-deck-panel-fullscreen';
const LOCK = 'data-deck-panel-fullscreen-lock';
const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]';
const FALLBACK_CSS = `
[${LOCK}] { overflow: hidden !important; overscroll-behavior: none !important; }
[${MARKER}="fallback"] {
  position: fixed !important; inset: 0 !important; margin: 0 !important;
  width: 100vw !important; height: 100vh !important; height: 100dvh !important;
  min-width: 0 !important; min-height: 0 !important;
  max-width: none !important; max-height: none !important;
  box-sizing: border-box !important; transform: none !important;
  z-index: 2147483647 !important; overflow: auto !important;
  padding: 0 !important; border: 0 !important; border-radius: 0 !important;
}
`;

/**
 * Expand an existing host using native fullscreen, or an accessible viewport fallback.
 * Importing this class does not access browser globals. Create it after mounting the host.
 * Only one controller owns fullscreen in a document at a time.
 */
export class FullScreenController {
  /** Host whose DOM and canvas instances remain mounted throughout expansion. */
  readonly target: HTMLElement;
  readonly #document: Document;
  readonly #options: FullScreenControllerOptions;
  #mode: FullScreenMode = 'none';
  #disposed = false;
  #generation = 0;
  #entering: Promise<void> | null = null;
  #attributes = new Map<Element, Map<string, string | null>>();
  #style: HTMLStyleElement | null = null;
  #popover = false;
  #focus: HTMLElement | null = null;
  #scroll = {x: 0, y: 0};

  /** Bind a controller to a visualization host. No fullscreen request is made yet. */
  constructor(options: FullScreenControllerOptions) {
    this.target = options.target;
    this.#document = options.target.ownerDocument;
    this.#options = options;
    this.#document.addEventListener('fullscreenchange', this.#nativeChanged);
    this.#document.addEventListener('keydown', this.#keyDown);
    this.#document.addEventListener('focusin', this.#focusChanged);
    this.target.addEventListener('toggle', this.#popoverChanged);
  }

  /** Whether the host is currently expanded, natively or with the viewport fallback. */
  get active(): boolean {
    return this.#mode !== 'none';
  }

  /** Actual presentation mode; fallback does not hide browser chrome. */
  get mode(): FullScreenMode {
    return this.#mode;
  }

  /** Enter from a user gesture; use the viewport fallback if native fullscreen is unavailable or rejects. */
  enter(): Promise<void> {
    if (this.#disposed) return Promise.reject(new Error('Fullscreen controller is destroyed'));
    if (this.active) return Promise.resolve();
    if (this.#entering) return this.#entering;
    const generation = ++this.#generation;
    const flight = this.#enter(generation).finally(() => {
      if (this.#entering === flight) this.#entering = null;
    });
    this.#entering = flight;
    return flight;
  }

  /** Exit owned fullscreen, restoring focus, document scrolling, and fallback attributes. */
  async exit(): Promise<void> {
    ++this.#generation;
    if (OWNERS.get(this.#document) === this) OWNERS.delete(this.#document);
    try {
      if (this.#document.fullscreenElement === this.target) {
        await this.#document.exitFullscreen();
      }
    } finally {
      this.#finish();
    }
  }

  /** Toggle fullscreen; a second request during native startup cancels that startup. */
  toggle(): Promise<void> {
    return this.active || this.#entering ? this.exit() : this.enter();
  }

  /** Release listeners and fallback state. Pending native entry is cancelled and exited if it completes late. */
  destroy(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#document.removeEventListener('fullscreenchange', this.#nativeChanged);
    this.#document.removeEventListener('keydown', this.#keyDown);
    this.#document.removeEventListener('focusin', this.#focusChanged);
    this.target.removeEventListener('toggle', this.#popoverChanged);
    // The host may be removed before native fullscreen exit settles.
    void this.exit().catch(() => {});
  }

  async #enter(generation: number): Promise<void> {
    if (!this.target.isConnected) throw new Error('Fullscreen target must be connected');
    const previous = OWNERS.get(this.#document);
    if (previous && previous !== this) await previous.exit();
    if (this.#disposed || generation !== this.#generation) return;
    const view = this.#document.defaultView;
    this.#focus = this.#document.activeElement as HTMLElement | null;
    this.#scroll = {x: view?.scrollX ?? 0, y: view?.scrollY ?? 0};
    OWNERS.set(this.#document, this);
    if (typeof this.target.requestFullscreen === 'function') {
      try {
        await this.target.requestFullscreen();
      } catch {
        // Missing permission and unsupported element fullscreen use the same fallback.
      }
      if (this.#disposed || generation !== this.#generation) {
        if (this.#document.fullscreenElement === this.target) {
          await this.#document.exitFullscreen().catch(() => {});
        }
        return;
      }
      if (this.#document.fullscreenElement === this.target) {
        this.#setMode('native');
        return;
      }
    }
    this.#showFallback();
  }

  #rememberAttribute(element: Element, name: string, value: string): void {
    let attributes = this.#attributes.get(element);
    if (!attributes) {
      attributes = new Map();
      this.#attributes.set(element, attributes);
    }
    if (!attributes.has(name)) attributes.set(name, element.getAttribute(name));
    element.setAttribute(name, value);
  }

  #showFallback(): void {
    const document = this.#document;
    this.#style = document.createElement('style');
    this.#style.textContent = FALLBACK_CSS;
    document.head.append(this.#style);
    this.#rememberAttribute(document.documentElement, LOCK, '');
    this.#rememberAttribute(document.body, LOCK, '');
    this.#rememberAttribute(this.target, MARKER, 'fallback');
    this.#rememberAttribute(this.target, 'role', 'dialog');
    this.#rememberAttribute(this.target, 'aria-modal', 'true');
    if (
      this.#options.label ||
      (!this.target.hasAttribute('aria-label') && !this.target.hasAttribute('aria-labelledby'))
    ) {
      this.#rememberAttribute(this.target, 'aria-label', this.#options.label || 'Fullscreen view');
    }
    this.#rememberAttribute(this.target, 'tabindex', '-1');
    // Top-layer promotion avoids clipping by transformed/paint-contained ancestors,
    // without reparenting framework-owned DOM. Older browsers still use fixed positioning.
    if (typeof this.target.showPopover === 'function' && !this.target.hasAttribute('popover')) {
      this.#rememberAttribute(this.target, 'popover', 'manual');
      try {
        this.target.showPopover();
        this.#popover = true;
      } catch {
        const previous = this.#attributes.get(this.target)?.get('popover');
        if (previous == null) this.target.removeAttribute('popover');
      }
    }
    this.#setMode('fallback');
    if (!this.#disposed && this.#mode === 'fallback') this.#focusFirst();
  }

  #setMode(mode: FullScreenMode): void {
    if (mode === this.#mode) return;
    this.#mode = mode;
    if (!this.#disposed) this.#options.onChange?.(mode);
  }

  #finish(): void {
    ++this.#generation;
    const changed = this.#mode !== 'none';
    this.#mode = 'none';
    if (this.#popover) {
      this.#popover = false;
      try {
        this.target.hidePopover();
      } catch {
        /* Already closed or detached. */
      }
    }
    for (const [element, attributes] of this.#attributes) {
      for (const [name, value] of attributes) {
        if (value === null) element.removeAttribute(name);
        else element.setAttribute(name, value);
      }
    }
    this.#attributes.clear();
    this.#style?.remove();
    this.#style = null;
    if (OWNERS.get(this.#document) === this) OWNERS.delete(this.#document);
    if (changed && !this.#disposed) this.#options.onChange?.('none');
    if (this.target.isConnected && this.#focus?.isConnected) {
      this.#document.defaultView?.scrollTo({
        left: this.#scroll.x,
        top: this.#scroll.y,
        behavior: 'instant'
      });
      if (typeof this.#focus.focus === 'function') this.#focus.focus({preventScroll: true});
    }
    this.#focus = null;
  }

  #focusable(): HTMLElement[] {
    return [...this.target.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      element =>
        element.tabIndex >= 0 &&
        !element.matches(':disabled') &&
        !element.closest('[inert]') &&
        element.getClientRects().length > 0 &&
        this.#document.defaultView?.getComputedStyle(element).visibility !== 'hidden'
    );
  }

  #focusFirst(): void {
    const preferred = this.#options.getInitialFocus?.();
    const target = preferred && this.target.contains(preferred) ? preferred : this.#focusable()[0];
    (target ?? this.target).focus({preventScroll: true});
  }

  #nativeChanged = (): void => {
    if (this.#document.fullscreenElement === this.target && OWNERS.get(this.#document) === this) {
      this.#setMode('native');
    } else if (this.#mode === 'native') this.#finish();
    else if (this.#mode === 'fallback' && this.#document.fullscreenElement) void this.exit();
  };

  #popoverChanged = (event: Event): void => {
    if (
      this.#popover &&
      this.#mode === 'fallback' &&
      (event as ToggleEvent).newState === 'closed'
    ) {
      void this.exit();
    }
  };

  #focusChanged = (event: FocusEvent): void => {
    if (this.#mode === 'fallback' && !this.target.contains(event.target as Node))
      this.#focusFirst();
  };

  #keyDown = (event: KeyboardEvent): void => {
    if (this.#mode !== 'fallback' || event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      void this.exit();
    } else if (event.key === 'Tab') {
      const elements = this.#focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first) {
        event.preventDefault();
        this.target.focus();
      } else if (
        event.shiftKey &&
        (this.#document.activeElement === first || this.#document.activeElement === this.target)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && this.#document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };
}
