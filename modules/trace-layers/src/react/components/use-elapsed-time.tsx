import {useCallback, useEffect, useRef, useState} from 'react';

type UseElapsedTimer = {
  /** milliseconds elapsed since last start() call */
  elapsedTimeMs: number;
  /** call this to (re)start the timer at 0 */
  startTimer: () => void;
  /** call this to stop the timer */
  stopTimer: () => void;
};

/**
 * Returns an elapsed‑ms counter that you start on demand.
 * @param intervalMs how often to tick (default 100 ms)
 */
export function useElapsedTime(intervalMs = 100): UseElapsedTimer {
  const [, setElapsedTimeMs] = useState(0);
  const startRef = useRef<number>(0);
  const timerRef = useRef<number | undefined>(undefined);

  // start (or restart) the timer
  const startTimer = useCallback(() => {
    // console.log('Starting timer with interval:', intervalMs);
    // record the “zero” point
    startRef.current = performance.now();
    setElapsedTimeMs(0);

    // clear any existing interval
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    // begin ticking
    timerRef.current = window.setInterval(() => {
      // console.log('Setting elapsed time:', performance.now() - startRef.current);
      setElapsedTimeMs(performance.now() - startRef.current);
    }, intervalMs);
  }, [intervalMs]);

  // stop the timer
  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  // clean up on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // console.log('Returning elapsed time', elapsedTimeMs)
  return {elapsedTimeMs: performance.now() - startRef.current, startTimer, stopTimer};
}
