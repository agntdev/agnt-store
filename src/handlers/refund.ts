import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { commerceStore, isAdmin } from "../commerce-handler.js";

const composer = new Composer<Ctx>();
composer.command("refund", async (ctx) => {
  if (!(await isAdmin(ctx))) { await ctx.reply("You don’t have access to refunds."); return; }
  await ctx.reply("Send the order number from your records to mark it refunded.");
  ctx.session.editProduct = undefined;
  (ctx.session as Ctx["session"] & { refundOrderId?: boolean }).refundOrderId = true;
});
composer.on("message:text", async (ctx, next) => {
  const session = ctx.session as Ctx["session"] & { refundOrderId?: boolean };
  if (!session.refundOrderId) return next();
  session.refundOrderId = undefined;
  if (!(await isAdmin(ctx))) { await ctx.reply("You don’t have access to refunds."); return; }
  const store = commerceStore(ctx);
  const order = store ? await store.order(ctx.message.text.trim()) : undefined;
  if (!order || order.paymentStatus !== "paid") { await ctx.reply("That paid order wasn’t found."); return; }
  await ctx.reply("Mark this order as refunded?", { reply_markup: inlineKeyboard([[inlineButton("Confirm refund", `refund:${order.id}`)], [inlineButton("Cancel", "flow:cancel")]]) });
});
composer.on("callback_query:data", async (ctx, next) => {
  if (!ctx.callbackQuery.data.startsWith("refund:")) return next();
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx))) { await ctx.reply("You don’t have access to refunds."); return; }
  const store = commerceStore(ctx);
  const order = store ? await store.order(ctx.callbackQuery.data.slice(7)) : undefined;
  if (!order || order.paymentStatus !== "paid") { await ctx.reply("That paid order wasn’t found."); return; }
  await store!.setOrderStatus(order.id, "refunded");
  try { await ctx.api.sendMessage(order.buyerId, "Your order has been marked as refunded. Your payment provider will confirm the refund separately."); } catch { /* buyer may have blocked the bot */ }
  await ctx.reply("The order is marked as refunded and the buyer has been notified.");
});
export default composer;
