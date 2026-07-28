import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { money } from "../commerce.js";
import { commerceStore, back } from "../commerce-handler.js";

// SCAFFOLD — generated from the bot blueprint BEFORE the agent runs.
// Keep a LIVE registration (.command / .callbackQuery / …) so this feature is
// never an empty stub. Replace the reply body with real logic + copy; if you
// change the user-facing text, update tests/specs to match EXACTLY.
// Do NOT rewrite src/bot.ts — buildBot() already auto-loads this module.

registerMainMenuItem({ label: "My orders", data: "orders:mine", order: 30 });
const composer = new Composer<Ctx>();
async function showOrders(ctx: Ctx) {
  const store = commerceStore(ctx);
  if (!store || !ctx.from) { await ctx.reply("Your order history isn’t available yet. Please try again shortly.", { reply_markup: back() }); return; }
  const orders = (await store.ordersForBuyer(ctx.from.id)).filter((order) => order.paymentStatus === "paid" || order.paymentStatus === "refunded");
  if (!orders.length) { await ctx.reply("No purchases yet — browse the catalog to get started.", { reply_markup: inlineKeyboard([[inlineButton("Browse catalog", "catalog:featured")], [inlineButton("Back to menu", "menu:main")]]) }); return; }
  await ctx.reply("Here are your purchases.", { reply_markup: inlineKeyboard([...orders.slice(0, 7).map((order) => [inlineButton(`${order.paymentStatus === "refunded" ? "Refunded" : money(order.totalPrice)}`, `order:${order.id}`)]), [inlineButton("Back to menu", "menu:main")]]) });
}

composer.command("orders", async (ctx) => {
  await showOrders(ctx);
});
composer.callbackQuery("orders:mine", async (ctx) => { await ctx.answerCallbackQuery(); await showOrders(ctx); });
composer.on("callback_query:data", async (ctx, next) => {
  if (!ctx.callbackQuery.data.startsWith("order:")) return next();
  await ctx.answerCallbackQuery();
  const store = commerceStore(ctx);
  const order = store ? await store.order(ctx.callbackQuery.data.slice(6)) : undefined;
  if (!order || order.buyerId !== ctx.from?.id || order.paymentStatus !== "paid") { await ctx.reply("That download isn’t available. Open My orders and try again."); return; }
  await ctx.reply("Your files are ready to download.", { reply_markup: inlineKeyboard([[inlineButton("Download files", `download:${order.id}`)]]) });
});
composer.on("callback_query:data", async (ctx, next) => {
  if (!ctx.callbackQuery.data.startsWith("download:")) return next();
  await ctx.answerCallbackQuery();
  const store = commerceStore(ctx);
  const order = store ? await store.order(ctx.callbackQuery.data.slice(9)) : undefined;
  if (!order || order.buyerId !== ctx.from?.id || order.paymentStatus !== "paid") { await ctx.reply("That download isn’t available. Open My orders and try again."); return; }
  const product = await store!.product(order.productIds[0]);
  if (!product) { await ctx.reply("Those files are no longer available. Please contact the seller."); return; }
  try { for (const file of product.files) await ctx.replyWithDocument(file); await ctx.reply("Your download is complete."); }
  catch { await ctx.reply("We couldn’t send every file. Tap Download files to try again.", { reply_markup: inlineKeyboard([[inlineButton("Download files", `download:${order.id}`)]]) }); }
});

export default composer;
