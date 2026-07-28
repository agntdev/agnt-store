import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { product, saveOrder } from "../commerce.js";
import { adminChatId, id, paymentToken, storeReady, type Order } from "../store.js";
import { now } from "../clock.js";

// SCAFFOLD — generated from the bot blueprint BEFORE the agent runs.
// Keep a LIVE registration (.command / .callbackQuery / …) so this feature is
// never an empty stub. Replace the reply body with real logic + copy; if you
// change the user-facing text, update tests/specs to match EXACTLY.
// Do NOT rewrite src/bot.ts — buildBot() already auto-loads this module.
// Menu: wire this into /start via registerMainMenuItem({ label: "View Product", data: "product:detail" }) if the toolkit exposes it.

const composer = new Composer<Ctx>();

async function showProduct(ctx: Ctx, productId?: string): Promise<void> {
  if (!storeReady(ctx)) { await ctx.editMessageText("The catalog isn't set up yet. Please try again shortly."); return; }
  if (!productId) { await ctx.editMessageText("Choose a product from the catalog first.", { reply_markup: inlineKeyboard([[inlineButton("Browse catalog", "catalog:featured")]]) }); return; }
  const item = await product(ctx, productId);
  if (!item) { await ctx.editMessageText("That product is no longer available.", { reply_markup: inlineKeyboard([[inlineButton("Browse catalog", "catalog:featured")]]) }); return; }
  await ctx.editMessageText(`${item.title}\n\n${item.description}\n\nPrice: $${(item.priceCents / 100).toFixed(2)}`, { reply_markup: inlineKeyboard([[inlineButton("Buy now", `product:buy:${item.id}`)], [inlineButton("Browse catalog", "catalog:featured")]]) });
}

async function notifyPaymentProblem(ctx: Ctx, text: string): Promise<void> {
  const adminId = adminChatId(ctx);
  if (adminId) await ctx.api.sendMessage(adminId, text).catch(() => undefined);
}

async function deliverFiles(ctx: Ctx, chatId: number, fileIds: string[]): Promise<number> {
  let delivered = 0;
  for (const fileId of fileIds) {
    let sent = false;
    for (let attempt = 0; attempt < 3 && !sent; attempt++) {
      try { await ctx.api.sendDocument(chatId, fileId); sent = true; delivered++; } catch { /* retry a transient delivery failure */ }
    }
  }
  return delivered;
}

composer.callbackQuery("product:detail", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showProduct(ctx);
});
composer.on("callback_query:data", async (ctx, next) => {
  const data = ctx.callbackQuery.data;
  if (data.startsWith("product:detail:")) { await ctx.answerCallbackQuery(); await showProduct(ctx, data.slice("product:detail:".length)); return; }
  if (!data.startsWith("product:buy:")) return next();
  await ctx.answerCallbackQuery();
  const item = await product(ctx, data.slice("product:buy:".length));
  if (!item) { await ctx.editMessageText("That product is no longer available."); return; }
  const providerToken = paymentToken(ctx);
  if (!providerToken) { await ctx.editMessageText("Payments aren't set up yet. Please try again later.", { reply_markup: inlineKeyboard([[inlineButton("Back to product", `product:detail:${item.id}`)]]) }); return; }
  await ctx.replyWithInvoice(item.title, item.description.slice(0, 255), `product:${item.id}`, "USD", [{ label: item.title.slice(0, 32), amount: item.priceCents }], { provider_token: providerToken });
});

composer.on("pre_checkout_query", async (ctx) => {
  const itemId = ctx.preCheckoutQuery.invoice_payload.startsWith("product:") ? ctx.preCheckoutQuery.invoice_payload.slice(8) : "";
  const item = itemId ? await product(ctx, itemId) : undefined;
  if (!item || ctx.preCheckoutQuery.currency !== "USD" || ctx.preCheckoutQuery.total_amount !== item.priceCents) { await ctx.answerPreCheckoutQuery(false, { error_message: "This product is no longer available. Please try again." }); await notifyPaymentProblem(ctx, "A payment could not be confirmed for a catalog item."); return; }
  await ctx.answerPreCheckoutQuery(true);
});

composer.on("message:successful_payment", async (ctx) => {
  const payment = ctx.message.successful_payment;
  const productId = payment.invoice_payload.startsWith("product:") ? payment.invoice_payload.slice(8) : "";
  const item = productId ? await product(ctx, productId) : undefined;
  if (!item || payment.total_amount !== item.priceCents || !ctx.from || !ctx.chat) { await ctx.reply("We couldn't confirm that payment. Please contact the seller."); return; }
  const order: Order = { id: id("order", ctx), buyerId: ctx.from.id, chatId: ctx.chat.id, productIds: [item.id], totalPrice: payment.total_amount, currency: payment.currency, paymentStatus: "paid", timestamp: now().toISOString(), telegramPaymentChargeId: payment.telegram_payment_charge_id, providerPaymentChargeId: payment.provider_payment_charge_id };
  await saveOrder(ctx, order);
  const delivered = await deliverFiles(ctx, ctx.chat.id, item.fileIds);
  await ctx.reply(delivered === item.fileIds.length ? `Payment received. Your ${item.title} files are ready, and you can download them again from /orders.` : `Payment received, but we couldn't deliver every file. Use /orders to try again.`);
  const adminId = adminChatId(ctx);
  if (adminId) await ctx.api.sendMessage(adminId, `New order for ${item.title}.`).catch(() => undefined);
});

export default composer;
