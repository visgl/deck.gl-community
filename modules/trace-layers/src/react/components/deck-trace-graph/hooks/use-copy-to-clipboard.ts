import {useCallback, useEffect} from 'react';

/** Hook that copies text to clipboard on Command-C */
export function useCopyToClipboard(textToCopy: string) {
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        navigator.clipboard.writeText(textToCopy);
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [textToCopy]
  );

  useEffect(() => {
    const abortController = new AbortController();
    // Targeting document instead of window seems to help avoid issues with focus not being on the deck canvas
    const target = document;
    target.addEventListener('keydown', onKeyDown, {signal: abortController.signal});
    return () => {
      abortController.abort();
    };
  }, [onKeyDown]);
}
