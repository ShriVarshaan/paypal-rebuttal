import { Policy } from "@rebuttal/core";
import type { Prisma } from "@rebuttal/db";
import { createPayPalClient, SANDBOX_BASE_URL } from "@rebuttal/paypal";
import { POLICY_ID, QUEUES } from "@rebuttal/worker";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { maskId, sealSecret } from "../secrets.js";
import { tokenMatches } from "./cases.js";

const json = (v: unknown) => v as Prisma.InputJsonValue;
const MERCHANT = "default";

export interface ConnectionChecks {
  /** Gets an OAuth token and lists one dispute. Throws with PayPal's message on failure. */
  paypal(creds: { clientId: string; clientSecret: string }): Promise<{ mode: "sandbox" | "simulator" }>;
  /** Reads the store's product list. Throws when the store is unreachable or refuses the token. */
  store(url: string, token: string | null): Promise<{ products: number }>;
}

export function defaultChecks(deps: Pick<AppDeps, "paypal">): ConnectionChecks {
  return {
    async paypal(creds) {
      // In simulator mode the running app never calls PayPal, so neither does this check.
      if (deps.paypal.mode === "simulator") return { mode: "simulator" };
      const client = createPayPalClient({
        simulator: false,
        config: { ...creds, baseUrl: SANDBOX_BASE_URL, webhookId: undefined },
      });
      await client.disputes.list({ page_size: 1 });
      return { mode: "sandbox" };
    },
    async store(url, token) {
      const res = await fetch(`${url.replace(/\/$/, "")}/api/products`, {
        headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        signal: AbortSignal.timeout(5_000),
      });
      if (res.status === 401 || res.status === 403) throw new Error("the store refused the API token");
      if (!res.ok) throw new Error(`the store answered ${res.status}`);
      const body: unknown = await res.json().catch(() => null);
      const list = Array.isArray(body) ? body : (body as { products?: unknown[] } | null)?.products;
      if (!Array.isArray(list)) throw new Error("the store did not return a product list");
      return { products: list.length };
    },
  };
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/**
 * Onboarding (C, Day 16): connect PayPal, connect the store, pick a policy, run the first
 * sync. Secrets are encrypted with CREDENTIALS_KEY before they are stored; the api never
 * returns them. The running worker still reads PAYPAL_* from the environment: stored
 * credentials back the connection test and the multi-merchant path, not the live client.
 */
export function onboardingRoutes(deps: AppDeps): FastifyPluginAsync {
  const checks = deps.connectionChecks ?? defaultChecks(deps);
  return async (app) => {
    app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
      if (deps.config.apiToken && !tokenMatches(req.headers.authorization, deps.config.apiToken)) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    });

    const connection = (kind: string) =>
      deps.db.connection.findUnique({ where: { merchantId_kind: { merchantId: MERCHANT, kind } } });
    const save = (kind: string, data: Omit<Prisma.ConnectionUncheckedCreateInput, "kind" | "merchantId">) =>
      deps.db.connection.upsert({
        where: { merchantId_kind: { merchantId: MERCHANT, kind } },
        create: { merchantId: MERCHANT, kind, ...data },
        update: data,
      });
    const view = (c: Awaited<ReturnType<typeof connection>>) =>
      c
        ? {
            status: c.status,
            config: c.config,
            hasSecret: Boolean(c.secretCiphertext),
            lastError: c.lastError,
            verifiedAt: c.verifiedAt?.toISOString() ?? null,
          }
        : null;

    app.get("/onboarding", async () => {
      const [merchant, paypal, store, policy, cases] = await Promise.all([
        deps.db.merchant.findUnique({ where: { id: MERCHANT } }),
        connection("paypal"),
        connection("store"),
        deps.db.policy.findUnique({ where: { id: POLICY_ID } }),
        deps.db.case.count(),
      ]);
      return {
        merchant: merchant
          ? { name: merchant.name, onboardedAt: merchant.onboardedAt?.toISOString() ?? null }
          : null,
        mode: deps.paypal.mode,
        encryptionReady: Boolean(deps.config.credentialsKey),
        paypal: view(paypal),
        store: view(store),
        policy: { saved: Boolean(policy), updatedAt: policy?.updatedAt.toISOString() ?? null },
        cases,
      };
    });

    app.post("/onboarding/paypal", async (req, reply) => {
      const body = z
        .object({
          clientId: z.string().trim().min(10).max(200),
          clientSecret: z.string().trim().min(10).max(200),
        })
        .safeParse(req.body ?? {});
      if (!body.success) return reply.code(400).send({ error: "enter the sandbox client ID and secret" });
      if (!deps.config.credentialsKey)
        return reply
          .code(503)
          .send({ error: "set CREDENTIALS_KEY on the api so secrets can be stored encrypted" });
      const config = { clientIdHint: maskId(body.data.clientId), baseUrl: SANDBOX_BASE_URL };
      const secretCiphertext = sealSecret(JSON.stringify(body.data), deps.config.credentialsKey);
      try {
        const r = await checks.paypal(body.data);
        await save("paypal", {
          config: json({ ...config, mode: r.mode }),
          secretCiphertext,
          status: r.mode === "simulator" ? "SAVED_UNCHECKED" : "VERIFIED",
          lastError: null,
          verifiedAt: r.mode === "simulator" ? null : new Date(),
        });
        return {
          ok: true,
          mode: r.mode,
          message:
            r.mode === "simulator"
              ? "Saved. Simulator mode is on, so these credentials were not checked against PayPal."
              : "Connected to the PayPal sandbox.",
        };
      } catch (err) {
        await save("paypal", {
          config: json(config),
          secretCiphertext,
          status: "FAILED",
          lastError: errorMessage(err),
        });
        return reply
          .code(422)
          .send({ ok: false, error: `PayPal rejected these credentials: ${errorMessage(err)}` });
      }
    });

    app.post("/onboarding/store", async (req, reply) => {
      const body = z
        .object({
          url: z
            .string()
            .trim()
            .url()
            .refine((u) => /^https?:\/\//.test(u), "use an http(s) URL"),
          token: z.string().trim().max(500).optional(),
        })
        .safeParse(req.body ?? {});
      if (!body.success)
        return reply.code(400).send({ error: "enter the store's URL, e.g. http://127.0.0.1:3002" });
      const token = body.data.token || null;
      if (token && !deps.config.credentialsKey)
        return reply
          .code(503)
          .send({ error: "set CREDENTIALS_KEY on the api so secrets can be stored encrypted" });
      const secretCiphertext =
        token && deps.config.credentialsKey ? sealSecret(token, deps.config.credentialsKey) : null;
      try {
        const r = await checks.store(body.data.url, token);
        await save("store", {
          config: json({ url: body.data.url, products: r.products }),
          secretCiphertext,
          status: "VERIFIED",
          lastError: null,
          verifiedAt: new Date(),
        });
        return {
          ok: true,
          products: r.products,
          message: `Connected. The store lists ${r.products} products.`,
        };
      } catch (err) {
        await save("store", {
          config: json({ url: body.data.url }),
          secretCiphertext,
          status: "FAILED",
          lastError: errorMessage(err),
        });
        return reply.code(422).send({ ok: false, error: `Could not reach the store: ${errorMessage(err)}` });
      }
    });

    app.post("/onboarding/policy", async (req, reply) => {
      const body = z.object({ policy: Policy }).safeParse(req.body ?? {});
      if (!body.success) return reply.code(400).send({ error: "invalid policy", issues: body.error.issues });
      await deps.db.policy.upsert({
        where: { id: POLICY_ID },
        create: { id: POLICY_ID, config: json(body.data.policy), updatedBy: "onboarding" },
        update: { config: json(body.data.policy), updatedBy: "onboarding" },
      });
      return { ok: true };
    });

    /** First sync: count PayPal's open disputes and queue a sync for each; the worker does the rest. */
    app.post("/onboarding/sync", async (_req, reply) => {
      const open: string[] = [];
      try {
        for await (const d of deps.paypal.disputes.listAll()) {
          if (d.status !== "RESOLVED") open.push(d.dispute_id);
          if (open.length >= 200) break;
        }
      } catch (err) {
        return reply
          .code(502)
          .send({ error: `PayPal did not return the dispute list: ${errorMessage(err)}` });
      }
      for (const disputeId of open)
        await deps.queue.send(QUEUES.disputeSync, { disputeId }, { singletonKey: disputeId });
      await deps.db.merchant.update({ where: { id: MERCHANT }, data: { onboardedAt: new Date() } });
      return { found: open.length, queued: open.length };
    });
  };
}
