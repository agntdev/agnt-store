import type { Ctx } from "./bot.js";
import { getValue, setValue, type Admin, type Order, type Product } from "./store.js";

const PRODUCTS = "products:index";
const CATEGORIES = "categories:index";
const ADMINS = "admins:index";

export async function products(ctx: Ctx): Promise<Product[]> {
  const ids = (await getValue<string[]>(ctx, PRODUCTS)) ?? [];
  const values = await Promise.all(ids.map((productId) => getValue<Product>(ctx, `product:${productId}`)));
  return values.filter((value): value is Product => Boolean(value));
}
export async function product(ctx: Ctx, productId: string): Promise<Product | undefined> { return getValue(ctx, `product:${productId}`); }
export async function categories(ctx: Ctx): Promise<string[]> { return (await getValue<string[]>(ctx, CATEGORIES)) ?? []; }
export async function saveProduct(ctx: Ctx, value: Product): Promise<void> {
  const ids = (await getValue<string[]>(ctx, PRODUCTS)) ?? [];
  const categoryList = (await getValue<string[]>(ctx, CATEGORIES)) ?? [];
  await setValue(ctx, `product:${value.id}`, value);
  if (!ids.includes(value.id)) await setValue(ctx, PRODUCTS, [...ids, value.id]);
  if (!categoryList.includes(value.category)) await setValue(ctx, CATEGORIES, [...categoryList, value.category]);
}
export async function isAdmin(ctx: Ctx): Promise<boolean> { const admins = (await getValue<Admin[]>(ctx, ADMINS)) ?? []; return admins.some((admin) => admin.telegramId === ctx.from?.id); }
export async function ensureAdmin(ctx: Ctx): Promise<boolean> {
  const admins = (await getValue<Admin[]>(ctx, ADMINS)) ?? [];
  if (admins.length === 0 && ctx.from?.id) { await setValue(ctx, ADMINS, [{ telegramId: ctx.from.id, permissions: ["catalog", "refund"] }]); return true; }
  return admins.some((admin) => admin.telegramId === ctx.from?.id);
}
export async function saveOrder(ctx: Ctx, order: Order): Promise<void> {
  await setValue(ctx, `order:${order.id}`, order);
  const key = `orders:buyer:${order.buyerId}`;
  const ids = (await getValue<string[]>(ctx, key)) ?? [];
  await setValue(ctx, key, [...ids, order.id]);
}
export async function buyerOrders(ctx: Ctx): Promise<Order[]> {
  const key = `orders:buyer:${ctx.from?.id ?? 0}`;
  const ids = (await getValue<string[]>(ctx, key)) ?? [];
  const values = await Promise.all(ids.map((orderId) => getValue<Order>(ctx, `order:${orderId}`)));
  return values.filter((value): value is Order => Boolean(value));
}
export async function order(ctx: Ctx, orderId: string): Promise<Order | undefined> { return getValue(ctx, `order:${orderId}`); }
