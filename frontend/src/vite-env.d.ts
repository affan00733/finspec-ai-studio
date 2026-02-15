/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Django API base URL, e.g. http://localhost:8000/api. Unset = browser Demo/Mock Mode. */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
