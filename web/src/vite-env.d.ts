/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MOCK?: string;
}

interface Navigator {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}
