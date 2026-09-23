/**
 * crumbs.jsx — the header's "Evaluations › Amit Verma › Evaluation 6".
 *
 * The header lives in the shell and the page knows the names, so a page hands
 * its trail up with `useCrumbs()`. A page that sets none gets the plain module
 * title, exactly as before.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const CrumbCtx = createContext({ crumbs: null, setCrumbs: () => {} });

export function CrumbProvider({ children }) {
  const [crumbs, setCrumbs] = useState(null);
  const value = useMemo(() => ({ crumbs, setCrumbs }), [crumbs]);
  return <CrumbCtx.Provider value={value}>{children}</CrumbCtx.Provider>;
}

export const useCrumbTrail = () => useContext(CrumbCtx).crumbs;

/**
 * Set this page's trail. Cleared when the page unmounts, so the next screen
 * never inherits a stale name.
 * @param {Array<{label: string, to?: string}>|null} crumbs
 */
export function useCrumbs(crumbs) {
  const { setCrumbs } = useContext(CrumbCtx);
  const key = JSON.stringify(crumbs);

  useEffect(() => {
    setCrumbs(crumbs);
    return () => setCrumbs(null);
    // `key` stands in for the array, which is a new object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setCrumbs]);
}
