// Values global-setup.ts provides to tests via vitest's inject().
declare module "vitest" {
  export interface ProvidedContext {
    pgAdminUrl: string;
  }
}

export {};
