import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { money, now, orderId, productText } from "../commerce.js";
import { commerceStore, back, notifyAdmins } from "../commerce-handler.js";

// SCAFFOLD — generated from the bot blueprint BEFORE the agent runs.
// Keep a LIVE registration (.command / .callbackQuery / …) so this feature is
// never an empty stub. Replace the reply body with real logic + copy; if you
// change the user-facing text, update tests/specs to match EXACTLY.
// Do NOT rewrite src/bot.ts — buildBot() already auto-loads this module.
// Menu: wire this into /start via registerMainMenuItem({ label: "View Product", data: "product:detail" }) if the toolkit exposes it.

registerMainMenuItem({ label: "Featured product", data: "product:detail", order: 20 });
const composer = new Composer<Ctx>();

async function showProduct(ctx: Ctx, id?: string) {
  const store = commerceStore(ctx);
  if (!store) {
    await ctx.reply("The catalog isn’t set up yet. Please try again shortly.", { reply_markup: back() });
    return;
  }
  const product = id ? await store.product(id) : (await store.products())[0];
  if (!product) {
    await ctx.reply("No products are available yet — please check back soon.", { reply_markup: back() });
    return;
  }
  await ctx.reply(productText(product), {
    parse_mode: "HTML",
    reply_markup: inlineKeyboard([[inlineButton(`Buy for ${money(product.price)}`, `buy:${product.id}`)], [inlineButton("Back to catalog", "catalog:featured")]]),
  });
}

composer.callbackQuery("product:detail", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showProduct(ctx);
});

composer.on("callback_query:data", async (ctx, next) => {
  const data = ctx.callbackQuery.data;
  if (data.startsWith("prod:")) {
    await ctx.answerCallbackQuery();
    await showProduct(ctx, data.slice(5));
    return;
  }
  if (!data.startsWith("buy:")) return next();
  await ctx.answerCallbackQuery();
  const store = commerceStore(ctx);
  const product = store ? await store.product(data.slice(4)) : undefined;
  const token = typeof process === "undefined" ? undefined : process.env.TELEGRAM_PAYMENT_PROVIDER_TOKEN;
  if (!store || !product) {
    await ctx.reply("That product is no longer available. Choose another one.", { reply_markup: back() });
    return;
  }
  if (!token) {
    await ctx.reply("Payments aren’t set up yet. Please try again later.", { reply_markup: back() });
    return;
  }
  try {
    if (!ctx.from) throw new Error("missing buyer");
    const id = orderId(ctx.from.id);
    await store.createOrder({ id, buyerId: ctx.from.id, productIds: [product.id], totalPrice: product.price, currency: "USD", paymentStatus: "pending", timestamp: now() });
    await ctx.replyWithInvoice(product.title, product.description.slice(0, 255), `${id}:${product.id}`, "USD", [{ label: product.title, amount: product.price }], { provider_token: token });
  } catch {
    await notifyAdmins(ctx, "A customer couldn’t open a payment invoice. Please check the payment setup.");
    await ctx.reply("We couldn’t open payment right now. Please try again shortly.", { reply_markup: back() });
  }
});

composer.on("pre_checkout_query", async (ctx) => {
  const [orderIdValue, id] = ctx.preCheckoutQuery.invoice_payload.split(":");
  const store = commerceStore(ctx);
  const product = store ? await store.product(id) : undefined;
  const order = store ? await store.order(orderIdValue) : undefined;
  const expired = !!order && now() - order.timestamp > 30 * 60 * 1000;
  if (expired && store) await store.setOrderStatus(orderIdValue, "expired");
  if (!order || order.buyerId !== ctx.from?.id || order.paymentStatus !== "pending" || expired || !product || product.price !== ctx.preCheckoutQuery.total_amount || ctx.preCheckoutQuery.currency !== "USD") {
    await ctx.answerPreCheckoutQuery(false, { error_message: "This product is no longer available. Please return to the catalog." });
    await notifyAdmins(ctx, "A payment could not be approved because its product details no longer matched.");
    return;
  }
  await ctx.answerPreCheckoutQuery(true);
});

export default composer;
