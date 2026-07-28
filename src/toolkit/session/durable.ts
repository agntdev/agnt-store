/**
 * Durable Object session storage + exact-time reminders for the Cloudflare
 * Workers runtime (docs/cloudflare/new-projects-on-cf.md §1, §10).
 *
 * One ChatDO instance per chat (addressed by idFromName("chat:<chatId>")). It
 * holds:
 *   - the grammY session (strongly consistent, serialized per chat for free);
 *   - that chat's reminders, with a single Durable Object ALARM armed to the
 *     earliest due one. The alarm fires at the wall-clock time even when nothing
 *     is running — this is what replaces per-bot cron + Redis (PoC: 0–1 ms).
 *
 * NONE of this is imported by the Node/long-poll entry or the test harness, so
 * `node:fs`, Redis, and this file's Workers-only globals never load there.
 */

import type { StorageAdapter } from "grammy";
import type { Order, Product } from "../../commerce.js";

// Minimal shapes so this file type-checks without pulling @cloudflare/workers-types
// into the Node build. The real bindings are provided by the Workers runtime.
export interface DOState {
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    put(entries: Record<string, unknown>): Promise<void>;
    put(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<boolean>;
    setAlarm(scheduledTime: number): Promise<void>;
    getAlarm(): Promise<number | null>;
  };
  blockConcurrencyWhile(fn: () => Promise<void>): void;
}
export interface DONamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DOStub;
}
export interface DOStub {
  fetch(input: string, init?: { method?: string; body?: string }): Promise<Response>;
}
export interface WorkerEnv {
  BOT_TOKEN: string;
  WEBHOOK_SECRET?: string;
  CHAT_DO: DONamespace;
  DB?: unknown; // D1 binding (app data); see AGENTS.md
  BOT_TELEMETRY_URL?: string;
  BOT_TELEMETRY_SECRET?: string;
  BOT_TELEMETRY_SALT?: string;
}

interface Reminder {
  at: number; // epoch ms
  chatId: number | string;
  text: string;
}
interface CommerceRequest { action: string; userId?: number; product?: Product; id?: string; category?: string; patch?: Pick<Product, "title" | "description" | "price" | "category">; order?: Order; buyerId?: number; status?: Order["paymentStatus"]; chargeId?: string; }

/**
 * createDurableSessionStorage — a grammY StorageAdapter that routes each session
 * key to its own ChatDO instance. Pass to buildBot({ storage }) in the Worker.
 */
export function createDurableSessionStorage<T>(env: WorkerEnv): StorageAdapter<T> {
  const stub = (key: string): DOStub => {
    // A missing binding otherwise surfaces as the opaque "Cannot read
    // properties of undefined (reading 'get')" — live: canary #2 shipped with
    // the binding misnamed CHATDO and every update threw exactly that.
    if (!env.CHAT_DO) {
      throw new Error(
        "CHAT_DO Durable Object binding is missing — the deploy must bind class ChatDO as CHAT_DO (see cf.meta.json)",
      );
    }
    return env.CHAT_DO.get(env.CHAT_DO.idFromName("chat:" + key));
  };
  return {
    async read(key: string): Promise<T | undefined> {
      const r = await stub(key).fetch("https://do/session", { method: "GET" });
      if (r.status === 204) return undefined;
      return (await r.json()) as T;
    },
    async write(key: string, value: T): Promise<void> {
      await stub(key).fetch("https://do/session", { method: "PUT", body: JSON.stringify(value) });
    },
    async delete(key: string): Promise<void> {
      await stub(key).fetch("https://do/session", { method: "DELETE" });
    },
  };
}

/**
 * remindAt — schedule a one-shot reminder DM for `chatId` at `whenEpochMs`.
 * Backed by the chat's ChatDO alarm; fires within a millisecond of the target
 * even if the Worker was idle. Call from a handler under the Workers runtime
 * (via ctx.env). No-op-safe: a scheduling failure never throws into the update.
 */
export async function remindAt(
  env: WorkerEnv,
  chatId: number | string,
  whenEpochMs: number,
  text: string,
): Promise<void> {
  try {
    const stub = env.CHAT_DO.get(env.CHAT_DO.idFromName("chat:" + chatId));
    await stub.fetch("https://do/remind", {
      method: "POST",
      body: JSON.stringify({ at: whenEpochMs, chatId, text } satisfies Reminder),
    });
  } catch {
    /* best-effort: a reminder we couldn't schedule must not break the reply */
  }
}

async function tg(token: string, method: string, payload: unknown): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/**
 * ChatDO — the per-chat Durable Object. Its class name is referenced in
 * cf.meta.json (new_sqlite_classes) so the deployer registers the migration.
 * Constructed by the runtime with (state, env).
 */
export class ChatDO {
  constructor(
    private readonly state: DOState,
    private readonly env: WorkerEnv,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Session storage (routed here by createDurableSessionStorage).
    if (url.pathname === "/session") {
      if (request.method === "GET") {
        const v = await this.state.storage.get<unknown>("session");
        if (v === undefined) return new Response(null, { status: 204 });
        return Response.json(v);
      }
      if (request.method === "PUT") {
        await this.state.storage.put("session", await request.json());
        return new Response(null, { status: 204 });
      }
      if (request.method === "DELETE") {
        await this.state.storage.delete("session");
        return new Response(null, { status: 204 });
      }
    }

    // Schedule a reminder + (re)arm the alarm to the earliest due one.
    if (url.pathname === "/remind" && request.method === "POST") {
      const rem = (await request.json()) as Reminder;
      const list = (await this.state.storage.get<Reminder[]>("reminders")) ?? [];
      list.push(rem);
      await this.state.storage.put("reminders", list);
      await this.rearm(list);
      return new Response(null, { status: 204 });
    }

    // One named ChatDO instance ("commerce") is the durable catalog fallback.
    // Each collection has a maintained index, so this never enumerates storage.
    if (url.pathname === "/commerce" && request.method === "POST") {
      const req = (await request.json()) as CommerceRequest;
      const get = <T>(key: string, fallback: T) => this.state.storage.get<T>(key).then((v) => v ?? fallback);
      const json = (value: unknown) => Response.json(value);
      if (req.action === "ensureAdmin" && req.userId !== undefined) {
        const admins = await get<number[]>("commerce:admins", []);
        if (admins.length === 0) { admins.push(req.userId); await this.state.storage.put("commerce:admins", admins); }
        return json(admins.includes(req.userId));
      }
      if (req.action === "adminIds") return json(await get<number[]>("commerce:admins", []));
      if (req.action === "categories") return json(await get<string[]>("commerce:categories", []));
      if (req.action === "addProduct" && req.product) {
        const product = req.product; const ids = await get<string[]>("commerce:productIds", []); const categories = await get<string[]>("commerce:categories", []);
        if (!ids.includes(product.id)) { ids.push(product.id); await this.state.storage.put("commerce:productIds", ids); }
        if (!categories.includes(product.category)) { categories.push(product.category); await this.state.storage.put("commerce:categories", categories); }
        await this.state.storage.put(`commerce:product:${product.id}`, product); return json(null);
      }
      if (req.action === "product" && req.id) return json(await this.state.storage.get<Product>(`commerce:product:${req.id}`));
      if (req.action === "products") {
        const ids = await get<string[]>("commerce:productIds", []); const products: Product[] = [];
        for (const id of ids) { const p = await this.state.storage.get<Product>(`commerce:product:${id}`); if (p?.active && (!req.category || p.category === req.category)) products.push(p); }
        return json(products.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title)));
      }
      if (req.action === "updateProduct" && req.id && req.patch) {
        const p = await this.state.storage.get<Product>(`commerce:product:${req.id}`); if (!p) return json(false);
        const next = { ...p, ...req.patch }; const categories = await get<string[]>("commerce:categories", []);
        if (!categories.includes(next.category)) { categories.push(next.category); await this.state.storage.put("commerce:categories", categories); }
        await this.state.storage.put(`commerce:product:${req.id}`, next); return json(true);
      }
      if (req.action === "createOrder" && req.order) {
        const ids = await get<string[]>(`commerce:buyer:${req.order.buyerId}`, []); ids.push(req.order.id);
        await this.state.storage.put({ [`commerce:order:${req.order.id}`]: req.order, [`commerce:buyer:${req.order.buyerId}`]: ids }); return json(null);
      }
      if (req.action === "order" && req.id) return json(await this.state.storage.get<Order>(`commerce:order:${req.id}`));
      if (req.action === "ordersForBuyer" && req.buyerId !== undefined) {
        const ids = await get<string[]>(`commerce:buyer:${req.buyerId}`, []); const orders: Order[] = [];
        for (const id of ids) { const o = await this.state.storage.get<Order>(`commerce:order:${id}`); if (o) orders.push(o); }
        return json(orders.sort((a, b) => b.timestamp - a.timestamp));
      }
      if (req.action === "setOrderStatus" && req.id && req.status) {
        const o = await this.state.storage.get<Order>(`commerce:order:${req.id}`); if (o) await this.state.storage.put(`commerce:order:${req.id}`, { ...o, paymentStatus: req.status, paymentChargeId: req.chargeId ?? o.paymentChargeId }); return json(null);
      }
      return new Response("bad commerce request", { status: 400 });
    }

    return new Response("not found", { status: 404 });
  }

  // Fires at the earliest reminder's wall-clock time. Sends every due reminder,
  // drops them, and re-arms for whatever remains.
  async alarm(): Promise<void> {
    const now = Date.now();
    const list = (await this.state.storage.get<Reminder[]>("reminders")) ?? [];
    const due = list.filter((r) => r.at <= now);
    const rest = list.filter((r) => r.at > now);
    for (const r of due) {
      await tg(this.env.BOT_TOKEN, "sendMessage", { chat_id: r.chatId, text: r.text });
    }
    await this.state.storage.put("reminders", rest);
    await this.rearm(rest);
  }

  private async rearm(list: Reminder[]): Promise<void> {
    if (list.length === 0) return;
    const next = Math.min(...list.map((r) => r.at));
    const current = await this.state.storage.getAlarm();
    if (current === null || next < current) {
      await this.state.storage.setAlarm(next);
    }
  }
}
