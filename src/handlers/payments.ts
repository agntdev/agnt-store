import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { now } from "../commerce.js";
import { commerceStore, notifyAdmins } from "../commerce-handler.js";

const composer = new Composer<Ctx>();

composer.on("message:successful_payment", async (ctx) => {
  const payment = ctx.message.successful_payment;
  const [orderId, productId] = payment.invoice_payload.split(":");
  const store = commerceStore(ctx);
  const product = store ? await store.product(productId) : undefined;
  const order = store ? await store.order(orderId) : undefined;
  if (!store || !product || !order || order.buyerId !== ctx.from?.id || order.paymentStatus !== "pending" || now() - order.timestamp > 30 * 60 * 1000 || payment.currency !== "USD" || payment.total_amount !== product.price || !ctx.from) {
    await notifyAdmins(ctx, "A payment arrived with details that could not be verified. Please review it in Telegram Payments.");
    await ctx.reply("We couldn’t verify that payment. The seller has been notified.");
    return;
  }
  await store.setOrderStatus(order.id, "paid", payment.telegram_payment_charge_id);
  try {
    for (const file of product.files) await ctx.replyWithDocument(file);
    await ctx.reply("Your payment is confirmed. Your files are ready above.");
  } catch {
    await ctx.reply("Your payment is confirmed. We couldn’t send every file yet — open My orders to download them.");
  }
  await notifyAdmins(ctx, `New order received for ${product.title}.`);
});

export default composer;
