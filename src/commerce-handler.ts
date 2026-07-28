import type { Ctx } from "./bot.js";
import { inlineButton, inlineKeyboard } from "./toolkit/index.js";
import { storeFor } from "./store.js";

export const back = () => inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]);

export function commerceStore(ctx: Ctx) {
  return storeFor(ctx as Ctx & { env?: { DB?: unknown; CHAT_DO?: unknown } });
}

export async function requireStore(ctx: Ctx) {
  const store = commerceStore(ctx);
  if (!store) {
    await ctx.reply("The store isn’t set up yet. Please try again shortly.", { reply_markup: back() });
    return undefined;
  }
  return store;
}

export async function isAdmin(ctx: Ctx): Promise<boolean> {
  const store = commerceStore(ctx);
  if (!store || !ctx.from) return false;
  return store.ensureAdmin(ctx.from.id);
}

export async function notifyAdmins(ctx: Ctx, text: string): Promise<void> {
  const store = commerceStore(ctx);
  if (!store) return;
  for (const id of await store.adminIds()) {
    try { await ctx.api.sendMessage(id, text); } catch { /* blocked users do not stop notifications */ }
  }
}
