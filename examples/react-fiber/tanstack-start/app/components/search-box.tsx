import {useDeferredValue, useTransition} from 'react';
import {useAppStore} from '@/stores/app';

/**
 * Search box with deferred value and transition pending state
 */
export function SearchBox() {
  const search = useAppStore(state => state.search);
  const setSearch = useAppStore(state => state.setSearch);
  const [isPending, startTransition] = useTransition();
  const deferredSearch = useDeferredValue(search);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    startTransition(() => {
      setSearch(e.target.value);
    });
  };

  return (
    <div
      style={{
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        left: 340,
        padding: '12px 16px',
        position: 'absolute',
        top: 20,
        width: 280,
        zIndex: 1
      }}
    >
      <input
        onChange={handleChange}
        placeholder="Search airports..."
        style={{
          border: '1px solid #d0d0d0',
          borderRadius: 4,
          fontSize: '0.95em',
          padding: '8px 12px',
          width: '100%'
        }}
        type="text"
        value={search}
      />
      {isPending && (
        <div style={{color: '#666', fontSize: '0.85em', marginTop: 8}}>Searching...</div>
      )}
      {!isPending && deferredSearch !== search && (
        <div style={{color: '#666', fontSize: '0.85em', marginTop: 8}}>Updating...</div>
      )}
    </div>
  );
}
