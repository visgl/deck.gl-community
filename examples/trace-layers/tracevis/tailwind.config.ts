import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Config} from 'tailwindcss';

const cssColor = (variableName: string) => `hsl(var(--${variableName}) / <alpha-value>)`;
const exampleRoot = dirname(fileURLToPath(import.meta.url));
const traceLayersSource = join(exampleRoot, '../../../modules/trace-layers/src');

const config = {
  content: [
    join(exampleRoot, 'index.html'),
    join(exampleRoot, 'app.tsx'),
    join(exampleRoot, 'index.tsx'),
    join(exampleRoot, 'tracevis-app.tsx'),
    join(exampleRoot, 'tracevis-store.tsx'),
    join(exampleRoot, 'components/**/*.{ts,tsx}'),
    join(exampleRoot, 'examples/**/*.{ts,tsx}'),
    join(exampleRoot, 'lib/**/*.{ts,tsx}'),
    join(exampleRoot, 'widgets/**/*.{ts,tsx}'),
    join(traceLayersSource, '**/*.{ts,tsx}')
  ],
  theme: {
    extend: {
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      },
      colors: {
        accent: cssColor('accent'),
        'accent-foreground': cssColor('accent-foreground'),
        background: cssColor('background'),
        border: cssColor('border'),
        card: cssColor('card'),
        'card-foreground': cssColor('card-foreground'),
        destructive: cssColor('destructive'),
        'destructive-foreground': cssColor('destructive-foreground'),
        foreground: cssColor('foreground'),
        input: cssColor('input'),
        muted: cssColor('muted'),
        'muted-foreground': cssColor('muted-foreground'),
        popover: cssColor('popover'),
        'popover-foreground': cssColor('popover-foreground'),
        primary: cssColor('primary'),
        'primary-foreground': cssColor('primary-foreground'),
        ring: cssColor('ring'),
        secondary: cssColor('secondary'),
        'secondary-foreground': cssColor('secondary-foreground')
      }
    }
  }
} satisfies Config;

export default config;
