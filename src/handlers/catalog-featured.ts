import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { escapeHtml } from "../commerce.js";
import { commerceStore, back } from "../commerce-handler.js";

// SCAFFOLD — generated from the bot blueprint BEFORE the agent runs.
// Keep a LIVE registration (.command / .callbackQuery / …) so this feature is
// never an empty stub. Replace the reply body with real logic + copy; if you
// change the user-facing text, update tests/specs to match EXACTLY.
// Do NOT rewrite src/bot.ts — buildBot() already auto-loads this module.
// Menu: wire this into /start via registerMainMenuItem({ label: "Browse Catalog", data: "catalog:featured" }) if the toolkit exposes it.

registerMainMenuItem({ label: "Browse catalog", data: "catalog:featured", order: 10 });
const composer = new Composer<Ctx>();

function categoryKeyboard(categories: string[]) {
  return inlineKeyboard([
    ...categories.slice(0, 7).map((category) => [inlineButton(category, `cat:${category}`)]),
    [inlineButton("Back to menu", "menu:main")],
  ]);
}

composer.callbackQuery("catalog:featured", async (ctx) => {
  await ctx.answerCallbackQuery();
  const store = commerceStore(ctx);
  if (!store) {
    await ctx.reply("The catalog isn’t set up yet. Please try again shortly.", { reply_markup: back() });
    return;
  }
  const categories = await store.categories();
  if (!categories.length) {
    await ctx.reply("No products are available yet — please check back soon.", { reply_markup: back() });
    return;
  }
  await ctx.reply("Choose a category.", { reply_markup: categoryKeyboard(categories) });
});

composer.on("callback_query:data", async (ctx, next) => {
  const category = ctx.callbackQuery.data.startsWith("cat:") ? ctx.callbackQuery.data.slice(4) : undefined;
  if (!category) return next();
  await ctx.answerCallbackQuery();
  const store = commerceStore(ctx);
  if (!store || !(await store.categories()).includes(category)) {
    await ctx.reply("That category isn’t available. Choose another one.", { reply_markup: back() });
    return;
  }
  const products = await store.products(category);
  if (!products.length) {
    await ctx.reply("No products are in this category yet.", { reply_markup: categoryKeyboard(await store.categories()) });
    return;
  }
  await ctx.reply(`Choose a product from ${escapeHtml(category)}.`, {
    parse_mode: "HTML",
    reply_markup: inlineKeyboard([
      ...products.slice(0, 7).map((product) => [inlineButton(product.title, `prod:${product.id}`)]),
      [inlineButton("Back to catalog", "catalog:featured")],
    ]),
  });
});

export default composer;
