import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { categories, products } from "../commerce.js";
import { storeReady } from "../store.js";

// SCAFFOLD — generated from the bot blueprint BEFORE the agent runs.
// Keep a LIVE registration (.command / .callbackQuery / …) so this feature is
// never an empty stub. Replace the reply body with real logic + copy; if you
// change the user-facing text, update tests/specs to match EXACTLY.
// Do NOT rewrite src/bot.ts — buildBot() already auto-loads this module.
// Menu: wire this into /start via registerMainMenuItem({ label: "Browse Catalog", data: "catalog:featured" }) if the toolkit exposes it.

registerMainMenuItem({ label: "Browse catalog", data: "catalog:featured", order: 10 });
const composer = new Composer<Ctx>();

composer.callbackQuery("catalog:featured", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!storeReady(ctx)) { await ctx.editMessageText("The catalog isn't set up yet. Please try again shortly."); return; }
  const list = await categories(ctx);
  if (list.length === 0) { await ctx.editMessageText("No products are available yet — please check back soon.", { reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]) }); return; }
  await ctx.editMessageText("Choose a category.", { reply_markup: inlineKeyboard([...list.map((name) => [inlineButton(name, `catalog:category:${encodeURIComponent(name)}`)]), [inlineButton("Back to menu", "menu:main")]]) });
});

composer.on("callback_query:data", async (ctx, next) => {
  const data = ctx.callbackQuery.data;
  if (!data.startsWith("catalog:category:")) return next();
  await ctx.answerCallbackQuery();
  const category = decodeURIComponent(data.slice("catalog:category:".length));
  const list = (await products(ctx)).filter((item) => item.category === category);
  if (!list.length) { await ctx.editMessageText("That category has no products yet.", { reply_markup: inlineKeyboard([[inlineButton("Browse catalog", "catalog:featured")]]) }); return; }
  await ctx.editMessageText(`Products in ${category}:`, { reply_markup: inlineKeyboard([...list.map((item) => [inlineButton(item.title, `product:detail:${item.id}`)]), [inlineButton("Browse catalog", "catalog:featured")]]) });
});

export default composer;
