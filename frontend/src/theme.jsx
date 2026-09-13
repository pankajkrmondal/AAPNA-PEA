/**
 * theme.jsx — the Ant Design half of the ATS look.
 *
 * app.css owns the bespoke surfaces (sidebar, hero, statistic cards); this file
 * pushes the same palette into every stock antd component so the two never
 * drift. The light/dark choice lives here too because antd needs the algorithm
 * swapped at the provider, not in CSS.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ConfigProvider, App as AntApp, theme as antdTheme } from 'antd';

const STORAGE_KEY = 'pea_theme';

const ThemeCtx = createContext({ mode: 'light', toggle: () => {} });

export const useThemeMode = () => useContext(ThemeCtx);

const read = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};

export default function ThemeProvider({ children }) {
  const [mode, setMode] = useState(read);

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* a locked-down browser should not stop the app rendering */
    }
  }, [mode]);

  const ctx = useMemo(
    () => ({ mode, toggle: () => setMode((m) => (m === 'dark' ? 'light' : 'dark')) }),
    [mode]
  );

  const dark = mode === 'dark';

  const theme = {
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: '#5c8727',
      colorInfo: '#5c8727',
      colorSuccess: '#0d9f6e',
      colorWarning: '#e08113',
      colorError: '#dc2626',
      colorLink: '#5c8727',
      borderRadius: 10,
      borderRadiusLG: 16,
      fontSize: 14,
      fontFamily:
        "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
      colorBgLayout: dark ? '#12170e' : '#f5f8ee',
      colorBgContainer: dark ? '#1a2014' : '#ffffff',
      colorBorderSecondary: dark ? '#2c3722' : '#e6ebdb',
      colorText: dark ? '#e7eddf' : '#1f2a17',
      colorTextSecondary: dark ? '#9aa891' : '#6b7566',
    },
    components: {
      Layout: {
        headerBg: dark ? '#1a2014' : '#ffffff',
        headerHeight: 68,
        headerPadding: '0 22px',
        siderBg: dark ? '#1a2014' : '#ffffff',
        bodyBg: dark ? '#12170e' : '#f5f8ee',
      },
      Menu: {
        itemBg: 'transparent',
        itemBorderRadius: 12,
        itemSelectedBg: dark ? '#2a3a17' : '#e8f1d7',
        itemSelectedColor: dark ? '#a6c974' : '#47691f',
        itemHoverBg: dark ? '#202d13' : '#f2f7e8',
        itemHoverColor: dark ? '#a6c974' : '#47691f',
        itemMarginInline: 0,
      },
      Card: { borderRadiusLG: 16, paddingLG: 18 },
      Button: { controlHeight: 38, controlHeightLG: 44, fontWeight: 500, primaryShadow: 'none' },
      Input: { controlHeight: 38 },
      Select: { controlHeight: 38 },
      Table: { headerSplitColor: 'transparent', cellPaddingBlockSM: 10 },
      Tag: { borderRadiusSM: 999 },
      Modal: { borderRadiusLG: 16 },
      Statistic: { titleFontSize: 12 },
    },
  };

  return (
    <ThemeCtx.Provider value={ctx}>
      <ConfigProvider theme={theme}>
        <AntApp>{children}</AntApp>
      </ConfigProvider>
    </ThemeCtx.Provider>
  );
}
