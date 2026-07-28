import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { ensureAdmin, product, products, saveProduct } from "../commerce.js";
import { storeReady } from "../store.js";

// SCAFFOLD — generated from the bot blueprint BEFORE the agent runs.
// Keep a LIVE registration (.command / .callbackQuery / …) so this feature is
// never an empty stub. Replace the reply body with real logic + copy; if you
// change the user-facing text, update tests/specs to match EXACTLY.
// Do NOT rewrite src/bot.ts — buildBot() already auto-loads this module.

const composer = new Composer<Ctx>();

async function open(ctx: Ctx, edit = false) {
  if (!storeReady(ctx)) { const text = "Seller tools aren't set up yet. Please try again shortly."; if (edit) await ctx.editMessageText(text); else await ctx.reply(text); return; }
  if (!(await ensureAdmin(ctx))) { const text = "Only the store owner can manage products."; if (edit) await ctx.editMessageText(text); else await ctx.reply(text); return; }
  const list = await products(ctx);
  const text = list.length ? "Choose a product to edit." : "No products yet — add one first.";
  const kb = inlineKeyboard(list.length ? [...list.map((item) => [inlineButton(item.title, `edit:product:${item.id}`)]), [inlineButton("Seller tools", "seller:tools")]] : [[inlineButton("Add product", "seller:add")]]);
  if (edit) await ctx.editMessageText(text, { reply_markup: kb }); else await ctx.reply(text, { reply_markup: kb });
}

composer.command("editproduct", async (ctx) => {
  await open(ctx);
});
composer.callbackQuery("seller:edit", async (ctx) => { await ctx.answerCallbackQuery(); await open(ctx, true); });
composer.on("callback_query:data", async (ctx, next) => {
  const data = ctx.callbackQuery.data;
  if (data.startsWith("edit:product:")) { await ctx.answerCallbackQuery(); const item = await product(ctx, data.slice("edit:product:".length)); if (!item) { await ctx.editMessageText("That product is no longer available."); return; } ctx.session.draft = { editProductId: item.id }; await ctx.editMessageText(`Edit ${item.title}.`, { reply_markup: inlineKeyboard([[inlineButton("Title", "edit:field:title"), inlineButton("Description", "edit:field:description")], [inlineButton("Price", "edit:field:price"), inlineButton("Category", "edit:field:category")], [inlineButton("SKU", "edit:field:sku")], [inlineButton("Back", "seller:edit")]]) }); return; }
  if (!data.startsWith("edit:field:")) return next();
  await ctx.answerCallbackQuery(); const field = data.slice("edit:field:".length) as "title" | "description" | "price" | "category" | "sku"; if (!ctx.session.draft?.editProductId) { await ctx.editMessageText("Choose a product to edit first."); return; } ctx.session.draft.editField = field; ctx.session.step = "edit_value"; await ctx.reply(`Send the new ${field === "price" ? "USD price" : field}.`, { reply_markup: { force_reply: true as const, input_field_placeholder: "Type the new value…" } });
});
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "edit_value" || !ctx.session.draft?.editProductId || !ctx.session.draft.editField || ctx.message.text.startsWith("/")) return next();
  const value = ctx.message.text.trim(); const item = await product(ctx, ctx.session.draft.editProductId); if (!item || !value) { await ctx.reply("That value isn't valid. Try again."); return; }
  const field = ctx.session.draft.editField;
  if (field === "price") { const cents = Math.round(Number(value) * 100); if (!Number.isInteger(cents) || cents < 1) { await ctx.reply("Send a valid USD price, for example 12.50."); return; } item.priceCents = cents; } else if (field === "title") item.title = value; else if (field === "description") item.description = value; else if (field === "category") item.category = value; else item.sku = value;
  await saveProduct(ctx, item); ctx.session.step = undefined; ctx.session.draft = undefined; await ctx.reply(`${item.title} has been updated.`);
});

export default composer;
