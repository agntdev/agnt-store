import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { buyerOrders, product } from "../commerce.js";
import { storeReady } from "../store.js";

// SCAFFOLD — generated from the bot blueprint BEFORE the agent runs.
// Keep a LIVE registration (.command / .callbackQuery / …) so this feature is
// never an empty stub. Replace the reply body with real logic + copy; if you
// change the user-facing text, update tests/specs to match EXACTLY.
// Do NOT rewrite src/bot.ts — buildBot() already auto-loads this module.

registerMainMenuItem({ label: "My orders", data: "orders:mine", order: 20 });
const composer = new Composer<Ctx>();

async function show(ctx: Ctx, edit = false) {
  if (!storeReady(ctx)) { const text = "Orders aren't available yet. Please try again shortly."; if (edit) await ctx.editMessageText(text); else await ctx.reply(text); return; }
  const list = (await buyerOrders(ctx)).filter((item) => item.paymentStatus === "paid");
  const text = list.length ? "Your purchases are ready to download." : "No purchases yet — browse the catalog when you're ready.";
  const keyboard = inlineKeyboard(list.length ? [...list.map((item) => [inlineButton(`Download order ${item.id.slice(-6)}`, `order:download:${item.id}`)]), [inlineButton("Browse catalog", "catalog:featured")]] : [[inlineButton("Browse catalog", "catalog:featured")], [inlineButton("Back to menu", "menu:main")]]);
  if (edit) await ctx.editMessageText(text, { reply_markup: keyboard }); else await ctx.reply(text, { reply_markup: keyboard });
}

composer.command("orders", async (ctx) => {
  await show(ctx);
});
composer.callbackQuery("orders:mine", async (ctx) => { await ctx.answerCallbackQuery(); await show(ctx, true); });
composer.on("callback_query:data", async (ctx, next) => {
  if (!ctx.callbackQuery.data.startsWith("order:download:")) return next();
  await ctx.answerCallbackQuery();
  if (!storeReady(ctx)) { await ctx.editMessageText("Orders aren't available yet. Please try again shortly."); return; }
  const orderId = ctx.callbackQuery.data.slice("order:download:".length);
  const order = (await buyerOrders(ctx)).find((item) => item.id === orderId && item.paymentStatus === "paid");
  if (!order) { await ctx.editMessageText("That download isn't available."); return; }
  let delivered = 0;
  for (const productId of order.productIds) { const item = await product(ctx, productId); for (const fileId of item?.fileIds ?? []) { try { await ctx.replyWithDocument(fileId); delivered++; } catch { /* continue attempting other files */ } } }
  await ctx.reply(delivered ? "Your files have been sent again." : "We couldn't send those files right now. Please try again later.");
});

export default composer;
