/// <reference types="vite/client" />
interface ImportMetaEnv { readonly VITE_CONTRACT_ADDRESS: string; readonly VITE_CONTRACT_ABI?: string; readonly VITE_RELAYER_BASE_URL: string; readonly VITE_ARC_RPC_URL: string; readonly VITE_DEPLOYMENT_BLOCK?: string; }
interface ImportMeta { readonly env: ImportMetaEnv }
