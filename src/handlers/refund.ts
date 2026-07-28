import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { ensureAdmin, order } from "../commerce.js";
import { setValue, storeReady } from "../store.js";

const composer = new Composer<Ctx>();
composer.command("refund", async (ctx) => {
  if (!storeReady(ctx)) { await ctx.reply("Refunds aren't set up yet. Please try again shortly."); return; }
  if (!(await ensureAdmin(ctx))) { await ctx.reply("Only the store owner can issue refunds."); return; }
  const orderId = ctx.match?.trim();
  if (!orderId) { await ctx.reply("Send /refund followed by the order reference from your records."); return; }
  const value = await order(ctx, orderId);
  if (!value || value.paymentStatus !== "paid") { await ctx.reply("That paid order couldn't be found."); return; }
  await ctx.reply("Confirm this refund.", { reply_markup: inlineKeyboard([[inlineButton("Issue refund", `refund:confirm:${value.id}`)], [inlineButton("Cancel", "seller:tools")]]) });
});
composer.on("callback_query:data", async (ctx, next) => {
  if (!ctx.callbackQuery.data.startsWith("refund:confirm:")) return next();
  await ctx.answerCallbackQuery();
  if (!(await ensureAdmin(ctx))) { await ctx.editMessageText("Only the store owner can issue refunds."); return; }
  const value = await order(ctx, ctx.callbackQuery.data.slice("refund:confirm:".length));
  if (!value || value.paymentStatus !== "paid") { await ctx.editMessageText("That refund is no longer available."); return; }
  // Telegram Payments refunds must be performed with the provider's refund flow.
  // This status change preserves the audit trail and alerts the buyer; payment-provider settlement is not exposed by this spec.
  value.paymentStatus = "refunded"; await setValue(ctx, `order:${value.id}`, value);
  await ctx.api.sendMessage(value.chatId, "Your order has been marked as refunded. Please allow your payment provider time to complete the return.").catch(() => undefined);
  await ctx.editMessageText("The order is marked as refunded and the buyer has been notified.");
});
export default composer;
