# SourcePickerPanel

![From v9.4](https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square)

`SourcePickerPanel` provides URL entry, named presets, and optional local file selection and dropping. The host owns loading, errors, URL persistence, file validation, and source discovery. The panel does not fetch URLs or read files.

```ts
import {SourcePickerPanel} from '@deck.gl-community/panels';

const panel = new SourcePickerPanel({
  id: 'source',
  title: 'Source',
  presets: [{id: 'earth', label: 'Earth', url: 'https://example.com/catalog.json'}],
  defaultUrl: 'https://example.com/catalog.json',
  onLoadUrl: url => loadSource(url),
  onSelectFiles: files => loadFile(files[0]),
  accept: '.json,.parquet'
});
```

## Props

- `id`, `title`: panel identity and heading.
- `presets`: ordered `{id, label, url}` options. IDs must be unique. Selection changes the URL without submitting it.
- `url`: controlled URL. Update the host value in `onUrlChange` and recreate the panel with that value.
- `defaultUrl`: initial uncontrolled URL; defaults to an empty string.
- `onUrlChange(url)`: field edits and preset changes.
- `onLoadUrl(url)`: submission of a nonempty, trimmed URL. The native URL input validates user submissions.
- `onSelectFiles(files)`: enables file input and dropping. Receives original `File` objects without reading their contents.
- `accept`: file input hint; dropped files still require host validation.
- `multiple`: permits multiple files; defaults to false, selecting only the first file.
- `disabled`: disables submission, file selection, and dropping while the host is busy.
- `theme`: standard panel theme override.

The file input resets after selection so the same file can be selected again. Hosts should replace the panel definition when source props change, as with other leaf panels.
