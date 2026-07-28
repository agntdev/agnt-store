import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { ensureAdmin, saveProduct } from "../commerce.js";
import { id, storeReady, type Product } from "../store.js";

// SCAFFOLD — generated from the bot blueprint BEFORE the agent runs.
// Keep a LIVE registration (.command / .callbackQuery / …) so this feature is
// never an empty stub. Replace the reply body with real logic + copy; if you
// change the user-facing text, update tests/specs to match EXACTLY.
// Do NOT rewrite src/bot.ts — buildBot() already auto-loads this module.

registerMainMenuItem({ label: "Seller tools", data: "seller:tools", order: 30 });
const composer = new Composer<Ctx>();

function prompt() { return { reply_markup: { force_reply: true as const, input_field_placeholder: "Type the details…" } }; }
function clear(ctx: Ctx) { ctx.session.step = undefined; ctx.session.draft = undefined; }
async function begin(ctx: Ctx) {
  if (!storeReady(ctx)) { await ctx.reply("Seller tools aren't set up yet. Please try again shortly."); return; }
  if (!(await ensureAdmin(ctx))) { await ctx.reply("Only the store owner can manage products."); return; }
  clear(ctx); ctx.session.step = "product_title"; ctx.session.draft = { fileIds: [] };
  await ctx.reply("Send the product title.", prompt());
}

composer.command("addproduct", async (ctx) => {
  await begin(ctx);
});

composer.callbackQuery("seller:tools", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!storeReady(ctx)) { await ctx.editMessageText("Seller tools aren't set up yet. Please try again shortly."); return; }
  if (!(await ensureAdmin(ctx))) { await ctx.editMessageText("Only the store owner can manage products."); return; }
  await ctx.editMessageText("Manage your catalog.", { reply_markup: inlineKeyboard([[inlineButton("Add product", "seller:add")], [inlineButton("Edit product", "seller:edit")], [inlineButton("Back to menu", "menu:main")]]) });
});
composer.callbackQuery("seller:add", async (ctx) => { await ctx.answerCallbackQuery(); await begin(ctx); });
composer.callbackQuery("seller:cancel", async (ctx) => { await ctx.answerCallbackQuery(); clear(ctx); await ctx.editMessageText("Product draft cancelled.", { reply_markup: inlineKeyboard([[inlineButton("Seller tools", "seller:tools")]]) }); });
composer.callbackQuery("seller:save", async (ctx) => {
  await ctx.answerCallbackQuery();
  const draft = ctx.session.draft;
  if (!draft?.title || !draft.description || !draft.priceCents || !draft.category || !draft.sku || !draft.fileIds?.length) { await ctx.editMessageText("That product draft is incomplete. Start again and add every detail."); clear(ctx); return; }
  const product: Product = { id: id("product", ctx), title: draft.title, description: draft.description, priceCents: draft.priceCents, category: draft.category, sku: draft.sku, fileIds: draft.fileIds };
  await saveProduct(ctx, product); clear(ctx);
  await ctx.editMessageText(`${product.title} is now in your catalog.`, { reply_markup: inlineKeyboard([[inlineButton("Add another", "seller:add")], [inlineButton("Seller tools", "seller:tools")]]) });
});
composer.on("message:document", async (ctx, next) => {
  if (ctx.session.step !== "product_files") return next();
  if ((ctx.message.document.file_size ?? 0) > 20 * 1024 * 1024) { await ctx.reply("That file is too large to deliver reliably. Upload a file under 20 MB."); return; }
  const draft = ctx.session.draft; if (!draft) return;
  draft.fileIds = [...(draft.fileIds ?? []), ctx.message.document.file_id];
  await ctx.reply("File added. Send another file, or tap Save product.", { reply_markup: inlineKeyboard([[inlineButton("Save product", "seller:save")], [inlineButton("Cancel", "seller:cancel")]]) });
});
composer.on("message:text", async (ctx, next) => {
  const step = ctx.session.step; const draft = ctx.session.draft; if (!step || !draft || !ctx.message.text || ctx.message.text.startsWith("/")) return next();
  const value = ctx.message.text.trim();
  if (!value) { await ctx.reply("That can't be blank. Try again."); return; }
  if (step === "product_title") { draft.title = value; ctx.session.step = "product_description"; await ctx.reply("Send a short product description.", prompt()); return; }
  if (step === "product_description") { draft.description = value; ctx.session.step = "product_price"; await ctx.reply("Send the price in USD, for example 12.50.", prompt()); return; }
  if (step === "product_price") { const cents = Math.round(Number(value) * 100); if (!Number.isInteger(cents) || cents < 1) { await ctx.reply("Send a valid USD price, for example 12.50."); return; } draft.priceCents = cents; ctx.session.step = "product_category"; await ctx.reply("Send the category name.", prompt()); return; }
  if (step === "product_category") { draft.category = value; ctx.session.step = "product_sku"; await ctx.reply("Send the SKU.", prompt()); return; }
  if (step === "product_sku") { draft.sku = value; ctx.session.step = "product_files"; await ctx.reply("Upload the product file. You can add more files before saving."); return; }
  return next();
});

export default composer;
