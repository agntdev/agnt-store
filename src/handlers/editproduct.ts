import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { commerceStore, isAdmin } from "../commerce-handler.js";

// SCAFFOLD — generated from the bot blueprint BEFORE the agent runs.
// Keep a LIVE registration (.command / .callbackQuery / …) so this feature is
// never an empty stub. Replace the reply body with real logic + copy; if you
// change the user-facing text, update tests/specs to match EXACTLY.
// Do NOT rewrite src/bot.ts — buildBot() already auto-loads this module.

const composer = new Composer<Ctx>();
async function choose(ctx: Ctx) {
  if (!(await isAdmin(ctx))) { await ctx.reply("You don’t have access to seller tools."); return; }
  const store = commerceStore(ctx);
  if (!store) { await ctx.reply("The store isn’t set up yet. Please try again shortly."); return; }
  const products = await store.products();
  if (!products.length) { await ctx.reply("No products yet — add one first."); return; }
  await ctx.reply("Choose a product to edit.", { reply_markup: inlineKeyboard(products.slice(0, 7).map((p) => [inlineButton(p.title, `edit:${p.id}`)])) });
}

composer.command("editproduct", async (ctx) => {
  await choose(ctx);
});

composer.callbackQuery("seller:edit", async (ctx) => { await ctx.answerCallbackQuery(); await choose(ctx); });
composer.on("callback_query:data", async (ctx, next) => {
  if (!ctx.callbackQuery.data.startsWith("edit:")) return next();
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx))) { await ctx.reply("You don’t have access to seller tools."); return; }
  ctx.session.editProduct = { id: ctx.callbackQuery.data.slice(5), step: "title" };
  await ctx.reply("Send the new product title.", { reply_markup: inlineKeyboard([[inlineButton("Cancel", "flow:cancel")]]) });
});
composer.on("message", async (ctx, next) => {
  const flow = ctx.session.editProduct;
  if (!flow) return next();
  const text = ctx.message.text?.trim();
  if (!text) { await ctx.reply("Send the requested text to continue."); return; }
  if (flow.step === "title") { flow.title = text.slice(0, 120); flow.step = "description"; await ctx.reply("Send the new description."); return; }
  if (flow.step === "description") { flow.description = text.slice(0, 1000); flow.step = "price"; await ctx.reply("Send the new USD price, for example 19.99."); return; }
  if (flow.step === "price") { const price = Math.round(Number(text.replace("$", "")) * 100); if (!Number.isSafeInteger(price) || price < 1) { await ctx.reply("Send a valid USD price, for example 19.99."); return; } flow.price = price; flow.step = "category"; await ctx.reply("Send the new category name."); return; }
  const store = commerceStore(ctx);
  const updated = store && flow.title && flow.description && flow.price ? await store.updateProduct(flow.id, { title: flow.title, description: flow.description, price: flow.price, category: text.slice(0, 60) }) : false;
  delete ctx.session.editProduct;
  await ctx.reply(updated ? "Your product has been updated." : "We couldn’t find that product. Choose it again from Seller tools.");
});

export default composer;
