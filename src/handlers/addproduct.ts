import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { productId } from "../commerce.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { commerceStore, isAdmin } from "../commerce-handler.js";

// SCAFFOLD — generated from the bot blueprint BEFORE the agent runs.
// Keep a LIVE registration (.command / .callbackQuery / …) so this feature is
// never an empty stub. Replace the reply body with real logic + copy; if you
// change the user-facing text, update tests/specs to match EXACTLY.
// Do NOT rewrite src/bot.ts — buildBot() already auto-loads this module.

registerMainMenuItem({ label: "Seller tools", data: "seller:tools", order: 40 });
const composer = new Composer<Ctx>();

const cancelKeyboard = inlineKeyboard([[inlineButton("Cancel", "flow:cancel")]]);
async function begin(ctx: Ctx) {
  if (!(await isAdmin(ctx))) { await ctx.reply("You don’t have access to seller tools."); return; }
  ctx.session.addProduct = { step: "title", files: [] };
  await ctx.reply("Send the product title.", { reply_markup: cancelKeyboard });
}

composer.command("addproduct", async (ctx) => {
  await begin(ctx);
});

composer.callbackQuery("seller:tools", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await isAdmin(ctx))) { await ctx.reply("You don’t have access to seller tools."); return; }
  await ctx.reply("Manage your store.", { reply_markup: inlineKeyboard([[inlineButton("Add product", "seller:add")], [inlineButton("Edit product", "seller:edit")], [inlineButton("Back to menu", "menu:main")]]) });
});
composer.callbackQuery("seller:add", async (ctx) => { await ctx.answerCallbackQuery(); await begin(ctx); });
composer.callbackQuery("flow:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  delete ctx.session.addProduct;
  delete ctx.session.editProduct;
  await ctx.reply("Nothing was saved.");
});

composer.on("message", async (ctx, next) => {
  const flow = ctx.session.addProduct;
  if (!flow) return next();
  const text = ctx.message.text?.trim();
  if (flow.step === "file") {
    const fileId = ctx.message.document?.file_id;
    if (!fileId) { await ctx.reply("Attach a document, or tap Save product when you’re done.", { reply_markup: inlineKeyboard([[inlineButton("Save product", "product:save")], [inlineButton("Cancel", "flow:cancel")]]) }); return; }
    flow.files.push(fileId);
    await ctx.reply("File added. Attach another file or save the product.", { reply_markup: inlineKeyboard([[inlineButton("Save product", "product:save")], [inlineButton("Cancel", "flow:cancel")]]) });
    return;
  }
  if (!text) { await ctx.reply("Send the requested text to continue.", { reply_markup: cancelKeyboard }); return; }
  if (flow.step === "title") { flow.title = text.slice(0, 120); flow.step = "description"; await ctx.reply("Send a short product description.", { reply_markup: cancelKeyboard }); return; }
  if (flow.step === "description") { flow.description = text.slice(0, 1000); flow.step = "price"; await ctx.reply("Send the price in USD, for example 19.99.", { reply_markup: cancelKeyboard }); return; }
  if (flow.step === "price") {
    const price = Math.round(Number(text.replace("$", "")) * 100);
    if (!Number.isSafeInteger(price) || price < 1) { await ctx.reply("Send a valid USD price, for example 19.99.", { reply_markup: cancelKeyboard }); return; }
    flow.price = price; flow.step = "category"; await ctx.reply("Send the category name.", { reply_markup: cancelKeyboard }); return;
  }
  flow.category = text.slice(0, 60); flow.step = "file";
  await ctx.reply("Attach the product file. You can attach more than one.", { reply_markup: inlineKeyboard([[inlineButton("Cancel", "flow:cancel")]]) });
});

composer.callbackQuery("product:save", async (ctx) => {
  await ctx.answerCallbackQuery();
  const flow = ctx.session.addProduct;
  const store = commerceStore(ctx);
  if (!flow || flow.step !== "file" || !flow.title || !flow.description || !flow.price || !flow.category || !ctx.from) { await ctx.reply("That product draft is incomplete. Start again from Seller tools."); return; }
  if (!flow.files.length) { await ctx.reply("Attach at least one product file before saving."); return; }
  if (!store) { await ctx.reply("The store isn’t set up yet, so this product wasn’t saved."); return; }
  const id = productId(ctx.from.id);
  await store.addProduct({ id, title: flow.title, description: flow.description, price: flow.price, currency: "USD", category: flow.category, files: flow.files, sku: id.toUpperCase(), active: true });
  delete ctx.session.addProduct;
  await ctx.reply("Your product is live in the catalog.");
});

export default composer;
