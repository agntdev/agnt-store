import type { Ctx } from "./bot.js";

export interface Product { id: string; title: string; description: string; priceCents: number; category: string; thumbnail?: string; fileIds: string[]; sku: string; }
export interface Order { id: string; buyerId: number; chatId: number; productIds: string[]; totalPrice: number; currency: string; paymentStatus: "paid" | "refunded" | "failed"; timestamp: string; telegramPaymentChargeId?: string; providerPaymentChargeId?: string; }
export interface Admin { telegramId: number; permissions: string[]; }

type RuntimeEnv = { CHAT_DO?: { idFromName(name: string): unknown; get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> } }; TELEGRAM_PAYMENT_PROVIDER_TOKEN?: string; ADMIN_CHAT_ID?: string };

function env(ctx: Ctx): RuntimeEnv | undefined { return (ctx as unknown as { env?: RuntimeEnv }).env; }

async function request<T>(ctx: Ctx, path: string, body?: unknown): Promise<T | undefined> {
  const runtime = env(ctx);
  if (!runtime?.CHAT_DO) return undefined;
  const stub = runtime.CHAT_DO.get(runtime.CHAT_DO.idFromName("commerce-store"));
  const response = await stub.fetch(`https://do${path}`, body === undefined ? { method: "GET" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error("store unavailable");
  return (await response.json()) as T;
}

export async function getValue<T>(ctx: Ctx, key: string): Promise<T | undefined> { return request<T>(ctx, `/data/${encodeURIComponent(key)}`); }
export async function setValue(ctx: Ctx, key: string, value: unknown): Promise<boolean> { return (await request<{ ok: boolean }>(ctx, `/data/${encodeURIComponent(key)}`, value))?.ok === true; }
export function storeReady(ctx: Ctx): boolean { return Boolean(env(ctx)?.CHAT_DO); }
export function paymentToken(ctx: Ctx): string | undefined { return env(ctx)?.TELEGRAM_PAYMENT_PROVIDER_TOKEN; }
export function adminChatId(ctx: Ctx): number | undefined { const value = env(ctx)?.ADMIN_CHAT_ID; return value && /^-?\d+$/.test(value) ? Number(value) : undefined; }
export function id(prefix: string, ctx: Ctx): string { return `${prefix}_${ctx.from?.id ?? 0}_${crypto.randomUUID().replaceAll("-", "")}`; }
