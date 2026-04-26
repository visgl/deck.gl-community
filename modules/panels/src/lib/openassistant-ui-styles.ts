// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// Curated importless fallback for @openassistant/ui@0.5.20 classes used by AIAssistPanel.
// Apps that import @openassistant/ui/dist/index.css directly will skip this fallback.
export const OPENASSISTANT_UI_STYLES = `
:root,
[data-theme] {
  --heroui-background: 0 0% 100%;
  --heroui-foreground: 222 47% 11%;
  --heroui-content1: 0 0% 100%;
  --heroui-content1-foreground: 222 47% 11%;
  --heroui-content2: 210 40% 96%;
  --heroui-content2-foreground: 222 47% 11%;
  --heroui-content3: 214 32% 91%;
  --heroui-content3-foreground: 222 47% 11%;
  --heroui-default: 214 32% 91%;
  --heroui-default-50: 210 40% 98%;
  --heroui-default-100: 210 40% 96%;
  --heroui-default-200: 214 32% 91%;
  --heroui-default-300: 213 27% 84%;
  --heroui-default-400: 215 20% 65%;
  --heroui-default-500: 215 16% 47%;
  --heroui-default-foreground: 222 47% 11%;
  --heroui-primary: 217 91% 60%;
  --heroui-primary-50: 214 100% 97%;
  --heroui-primary-100: 214 95% 93%;
  --heroui-primary-500: 217 91% 60%;
  --heroui-primary-foreground: 0 0% 100%;
  --heroui-danger: 0 84% 60%;
  --heroui-danger-50: 0 86% 97%;
  --heroui-danger-100: 0 93% 94%;
  --heroui-danger-500: 0 84% 60%;
  --heroui-danger-foreground: 0 0% 100%;
  --heroui-success: 142 71% 45%;
  --heroui-success-50: 138 76% 97%;
  --heroui-success-100: 141 84% 93%;
  --heroui-success-500: 142 71% 45%;
  --heroui-success-foreground: 0 0% 100%;
  --heroui-warning: 38 92% 50%;
  --heroui-warning-50: 48 100% 96%;
  --heroui-warning-100: 48 96% 89%;
  --heroui-warning-500: 38 92% 50%;
  --heroui-warning-foreground: 24 10% 10%;
  --heroui-border-width-small: 1px;
  --heroui-radius-small: 0.375rem;
  --heroui-radius-medium: 0.5rem;
  --heroui-box-shadow-small: 0 1px 2px rgb(15 23 42 / 0.12), 0 1px 3px rgb(15 23 42 / 0.08);
}

.dark {
  --heroui-background: 224 71% 4%;
  --heroui-foreground: 210 40% 98%;
  --heroui-content1: 222 47% 11%;
  --heroui-content1-foreground: 210 40% 98%;
  --heroui-content2: 217 33% 17%;
  --heroui-content2-foreground: 210 40% 98%;
  --heroui-content3: 215 25% 27%;
  --heroui-content3-foreground: 210 40% 98%;
  --heroui-default: 215 25% 27%;
  --heroui-default-50: 222 47% 11%;
  --heroui-default-100: 217 33% 17%;
  --heroui-default-200: 215 25% 27%;
  --heroui-default-300: 215 20% 35%;
  --heroui-default-400: 215 16% 47%;
  --heroui-default-500: 215 20% 65%;
  --heroui-default-foreground: 210 40% 98%;
  --heroui-primary: 213 94% 68%;
  --heroui-primary-50: 224 64% 12%;
  --heroui-primary-100: 220 55% 18%;
  --heroui-primary-500: 213 94% 68%;
  --heroui-danger: 0 72% 51%;
  --heroui-danger-50: 0 63% 12%;
  --heroui-danger-100: 0 62% 18%;
  --heroui-danger-500: 0 72% 51%;
  --heroui-success: 142 71% 45%;
  --heroui-success-50: 144 61% 10%;
  --heroui-success-100: 143 64% 16%;
  --heroui-success-500: 142 71% 45%;
  --heroui-warning: 38 92% 50%;
  --heroui-warning-50: 31 78% 12%;
  --heroui-warning-100: 32 82% 18%;
  --heroui-warning-500: 38 92% 50%;
}

[data-ai-assist-panel],
[data-ai-assist-panel] * {
  box-sizing: border-box;
}

[data-ai-assist-panel] button,
[data-ai-assist-panel] input,
[data-ai-assist-panel] select,
[data-ai-assist-panel] textarea {
  font: inherit;
}

[data-ai-assist-panel] button,
[data-ai-assist-panel] [role='button'] {
  cursor: pointer;
}

[data-ai-assist-panel] img,
[data-ai-assist-panel] svg {
  display: block;
  max-width: 100%;
}

.relative { position: relative; }
.absolute { position: absolute; }
.fixed { position: fixed; }
.inset-0 { inset: 0; }
.top-0 { top: 0; }
.top-1 { top: 0.25rem; }
.right-0 { right: 0; }
.right-2 { right: 0.5rem; }
.bottom-0 { bottom: 0; }
.left-0 { left: 0; }
.z-10 { z-index: 10; }
.z-\\[2147483645\\] { z-index: 2147483645; }
.order-1 { order: 1; }
.m-0 { margin: 0; }
.m-2 { margin: 0.5rem; }
.my-0 { margin-top: 0; margin-bottom: 0; }
.mt-4 { margin-top: 1rem; }
.mb-2 { margin-bottom: 0.5rem; }
.mb-5 { margin-bottom: 1.25rem; }
.ml-5 { margin-left: 1.25rem; }
.ml-8 { margin-left: 2rem; }
.-mt-5 { margin-top: -1.25rem; }
.-mt-6 { margin-top: -1.5rem; }
.-mb-2 { margin-bottom: -0.5rem; }
.block { display: block; }
.hidden { display: none; }
.flex { display: flex; }
.grid { display: grid; }
.h-4 { height: 1rem; }
.h-6 { height: 1.5rem; }
.h-14 { height: 3.5rem; }
.h-fit { height: fit-content; }
.h-full { height: 100%; }
.w-4 { width: 1rem; }
.w-6 { width: 1.5rem; }
.w-14 { width: 3.5rem; }
.w-full { width: 100%; }
.w-screen { width: 100vw; }
.min-h-0 { min-height: 0; }
.min-h-8 { min-height: 2rem; }
.min-h-\\[40px\\] { min-height: 40px; }
.min-w-4 { min-width: 1rem; }
.max-w-60 { max-width: 15rem; }
.max-w-full { max-width: 100%; }
.flex-none { flex: none; }
.flex-grow { flex-grow: 1; }
.flex-col { flex-direction: column; }
.flex-row { flex-direction: row; }
.flex-nowrap { flex-wrap: nowrap; }
.items-start { align-items: flex-start; }
.items-center { align-items: center; }
.items-end { align-items: flex-end; }
.justify-center { justify-content: center; }
.justify-end { justify-content: flex-end; }
.justify-between { justify-content: space-between; }
.gap-0 { gap: 0; }
.gap-1 { gap: 0.25rem; }
.gap-2 { gap: 0.5rem; }
.gap-3 { gap: 0.75rem; }
.gap-4 { gap: 1rem; }
.overflow-hidden { overflow: hidden; }
.overflow-scroll { overflow: scroll; }
.overflow-x-auto { overflow-x: auto; }
.overflow-x-hidden { overflow-x: hidden; }
.overflow-y-auto { overflow-y: auto; }
.overscroll-behavior-y-auto { overscroll-behavior-y: auto; }
.overflow-anchor-auto { overflow-anchor: auto; }
.touch-action-none { touch-action: none; }
.whitespace-pre-line { white-space: pre-line; }
.whitespace-pre-wrap { white-space: pre-wrap; }
.break-words { overflow-wrap: break-word; }
.rounded-full { border-radius: 9999px; }
.rounded-small { border-radius: var(--heroui-radius-small); }
.rounded-medium { border-radius: var(--heroui-radius-medium); }
.border { border-width: 1px; border-style: solid; }
.border-small { border-width: var(--heroui-border-width-small); border-style: solid; }
.object-cover { object-fit: cover; }
.p-0 { padding: 0; }
.p-2 { padding: 0.5rem; }
.p-4 { padding: 1rem; }
.px-1 { padding-left: 0.25rem; padding-right: 0.25rem; }
.px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }
.px-4 { padding-left: 1rem; padding-right: 1rem; }
.py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
.py-3 { padding-top: 0.75rem; padding-bottom: 0.75rem; }
.pt-0 { padding-top: 0; }
.pt-4 { padding-top: 1rem; }
.pb-4 { padding-bottom: 1rem; }
.pl-4 { padding-left: 1rem; }
.font-medium { font-weight: 500; }
.font-bold { font-weight: 700; }
.font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.text-tiny { font-size: 0.75rem; line-height: 1rem; }
.text-sm { font-size: 0.875rem; line-height: 1.25rem; }
.text-current { color: currentColor; }
.text-background { color: hsl(var(--heroui-background)); }
.text-foreground { color: hsl(var(--heroui-foreground)); }
.text-content3-foreground { color: hsl(var(--heroui-content3-foreground)); }
.text-primary { color: hsl(var(--heroui-primary)); }
.text-danger { color: hsl(var(--heroui-danger)); }
.text-blue-600 { color: rgb(37 99 235); }
.text-red-500 { color: rgb(239 68 68); }
.text-green-500 { color: rgb(34 197 94); }
.text-gray-400 { color: rgb(156 163 175); }
.text-gray-500 { color: rgb(107 114 128); }
.text-gray-600 { color: rgb(75 85 99); }
.bg-transparent { background-color: transparent; }
.bg-content2 { background-color: hsl(var(--heroui-content2)); }
.bg-content3 { background-color: hsl(var(--heroui-content3)); }
.bg-default-100 { background-color: hsl(var(--heroui-default-100)); }
.bg-default-200\\/70 { background-color: hsl(var(--heroui-default-200) / 0.7); }
.bg-default-300 { background-color: hsl(var(--heroui-default-300)); }
.border-default-100 { border-color: hsl(var(--heroui-default-100)); }
.border-default-200\\/50 { border-color: hsl(var(--heroui-default-200) / 0.5); }
.shadow-small { box-shadow: var(--heroui-box-shadow-small); }
.opacity-0 { opacity: 0; }
.opacity-25 { opacity: 0.25; }
.opacity-50 { opacity: 0.5; }
.opacity-75 { opacity: 0.75; }
.opacity-100 { opacity: 1; }
.cursor-pointer { cursor: pointer; }
.cursor-move { cursor: move; }
.cursor-se-resize { cursor: se-resize; }
.transition-colors { transition-property: color, background-color, border-color; transition-duration: 150ms; }
.transition-opacity { transition-property: opacity; transition-duration: 150ms; }
.group:hover .group-hover\\:opacity-100 { opacity: 1; }
.hover\\:bg-default-200\\/70:hover { background-color: hsl(var(--heroui-default-200) / 0.7); }
.hover\\:text-gray-500:hover { color: rgb(107 114 128); }
.dark .dark\\:text-gray-400 { color: rgb(156 163 175); }
.dark .dark\\:text-gray-600 { color: rgb(75 85 99); }
.dark .dark\\:hover\\:text-gray-500:hover { color: rgb(107 114 128); }
.line-\\[0\\.5\\] { line-height: 0.5; }
.\\[\\&\\>p\\]\\:-mb-6 > p { margin-bottom: -1.5rem; }
.\\[\\&\\>p\\]\\:\\!mt-0 > p { margin-top: 0 !important; }
.\\[\\&\\>p\\]\\:-translate-y-5 > p { transform: translateY(-1.25rem); }
.\\[\\&\\>p\\]\\:h-fit > p { height: fit-content; }
.\\[\\&\\>p\\]\\:leading-5 > p { line-height: 1.25rem; }

[data-ai-assist-panel] [data-slot='base'] {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  color: hsl(var(--heroui-foreground));
}

[data-ai-assist-panel] [data-slot='label'] {
  display: block !important;
  position: static !important;
  inset: auto !important;
  transform: none !important;
  margin-bottom: 0.25rem;
  color: hsl(var(--heroui-default-500));
  font-size: 0.8125rem;
  height: auto !important;
  line-height: 1.125rem;
  min-height: 0 !important;
  opacity: 1 !important;
  overflow: visible !important;
  pointer-events: none;
}

[data-ai-assist-panel] [data-slot='input-wrapper'],
[data-ai-assist-panel] [data-slot='trigger'] {
  display: flex !important;
  position: relative;
  min-height: 3.75rem;
  width: 100%;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  gap: 0.125rem;
  border: var(--heroui-border-width-small) solid hsl(var(--heroui-default-200));
  border-radius: var(--heroui-radius-medium);
  background: hsl(var(--heroui-default-100));
  color: hsl(var(--heroui-foreground));
  overflow: visible !important;
  padding: 0.625rem 0.75rem;
}

[data-ai-assist-panel] [data-slot='input-wrapper']:focus-within,
[data-ai-assist-panel] [data-slot='trigger']:focus-visible {
  border-color: hsl(var(--heroui-primary));
  outline: 2px solid hsl(var(--heroui-primary) / 0.25);
  outline-offset: 0;
}

[data-ai-assist-panel] [data-slot='inner-wrapper'],
[data-ai-assist-panel] [data-slot='main-wrapper'],
[data-ai-assist-panel] [data-slot='mainWrapper'] {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 0.5rem;
}

[data-ai-assist-panel] [data-slot='input'],
[data-ai-assist-panel] [data-slot='value'] {
  min-width: 0;
  flex: 1 1 auto;
  border: 0;
  outline: 0;
  background: transparent;
  color: inherit;
  line-height: 1.375rem;
}

[data-ai-assist-panel] [data-slot='value'] {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-ai-assist-panel] textarea[data-slot='input'] {
  resize: vertical;
}

[data-ai-assist-panel] [data-slot='selectorIcon'] {
  flex: none;
  color: hsl(var(--heroui-default-500));
}

[data-ai-assist-panel] [data-slot='helper-wrapper'],
[data-ai-assist-panel] [data-slot='helperWrapper'] {
  margin-top: 0.25rem;
  color: hsl(var(--heroui-default-500));
  font-size: 0.75rem;
}

[data-ai-assist-panel] [data-slot='track'] {
  position: relative;
  height: 0.375rem;
  width: 100%;
  border-radius: 9999px;
  background: hsl(var(--heroui-default-200));
}

[data-ai-assist-panel] [data-slot='filler'] {
  height: 100%;
  border-radius: inherit;
  background: hsl(var(--heroui-primary));
}

[data-ai-assist-panel] [data-slot='thumb'] {
  width: 1rem;
  height: 1rem;
  border: 2px solid hsl(var(--heroui-background));
  border-radius: 9999px;
  background: hsl(var(--heroui-primary));
  box-shadow: var(--heroui-box-shadow-small);
}

[data-ai-assist-panel] button[data-slot='base'],
[data-ai-assist-panel] [role='button'][data-slot='base'] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border: 0;
  border-radius: var(--heroui-radius-medium);
  background: hsl(var(--heroui-primary));
  color: hsl(var(--heroui-primary-foreground));
  padding: 0.5rem 0.75rem;
}

[data-slot='popover'],
[data-slot='content'] {
  border: var(--heroui-border-width-small) solid hsl(var(--heroui-default-200));
  border-radius: var(--heroui-radius-medium);
  background: hsl(var(--heroui-content1));
  color: hsl(var(--heroui-content1-foreground));
  box-shadow: var(--heroui-box-shadow-small);
}

[data-slot='listbox'],
[data-slot='listboxWrapper'] {
  max-height: 18rem;
  overflow: auto;
  padding: 0.25rem;
}

[data-slot='listbox'] [role='option'] {
  border-radius: var(--heroui-radius-small);
  padding: 0.375rem 0.5rem;
}

[data-slot='listbox'] [role='option'][data-hover='true'],
[data-slot='listbox'] [role='option']:hover {
  background: hsl(var(--heroui-default-100));
}

[data-slot='listbox'] [role='option'][data-selected='true'] {
  background: hsl(var(--heroui-primary) / 0.12);
  color: hsl(var(--heroui-primary));
}

@keyframes deck-gl-community-openassistant-spin {
  to { transform: rotate(360deg); }
}

.animate-spin {
  animation: deck-gl-community-openassistant-spin 1s linear infinite;
}

@media (min-width: 768px) {
  .md\\:gap-3 { gap: 0.75rem; }
}
`;
