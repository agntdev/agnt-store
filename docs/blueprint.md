# Digital Store Bot — Bot specification

**Archetype:** commerce

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

A Telegram storefront for selling digital products with categorized browsing, in-chat payments, and instant file delivery. Tracks orders and enables owner-managed refunds.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- public customers
- digital product sellers

## Success criteria

- Completed purchases with instant file delivery
- Order history tracking with re-download capability
- Admin notifications for new orders and payment failures

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open the main menu with featured categories
- **Browse Catalog** (button, actor: user, callback: catalog:featured) — View categorized product listings
  - inputs: category selection
  - outputs: product list
- **View Product** (button, actor: user, callback: product:detail) — Open product page with purchase option
  - inputs: product ID
  - outputs: product details
- **/orders** (command, actor: user, command: /orders) — View purchase history with re-download options
- **/addproduct** (command, actor: admin, command: /addproduct) — Add new product to catalog
- **/editproduct** (command, actor: admin, command: /editproduct) — Edit existing product details

## Flows

### Product Purchase
_Trigger:_ product:detail

1. Display product details
2. Show Buy button
3. Generate Telegram Payment invoice
4. Confirm payment status
5. Send product files

_Data touched:_ Products, Orders

### Order History
_Trigger:_ /orders

1. List past purchases
2. Offer re-download option
3. Resend product files

_Data touched:_ Orders

### Admin Management
_Trigger:_ /addproduct

1. Collect product metadata
2. Upload product files
3. Store in catalog

_Data touched:_ Products, Categories

### Refund Processing
_Trigger:_ /refund

1. Verify admin identity
2. Mark order as refunded
3. Notify buyer

_Data touched:_ Orders

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **Products** _(retention: persistent)_ — Digital products for sale
  - fields: title, description, price, category, thumbnail, file(s), SKU
- **Categories** _(retention: persistent)_ — Product categorization
  - fields: name, display_order
- **Orders** _(retention: persistent)_ — Purchase records
  - fields: buyer_id, product_ids, total_price, payment_status, timestamp
- **Admins** _(retention: persistent)_ — Authorized users
  - fields: telegram_id, permissions

## Integrations

- **Telegram Payments** (required) — Process in-chat payments
- **Telegram Bot API** (required) — Messaging and file delivery
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Add/edit products
- Manage categories
- View order history
- Issue refunds

## Notifications

- Order confirmation to buyer
- Payment failure alerts
- Refund status updates

## Permissions & privacy

- Store user purchase history
- Access Telegram user IDs for order tracking
- Secure payment metadata

## Edge cases

- Payment timeout handling
- File delivery retries
- Invalid category selections

## Required tests

- End-to-end purchase flow with payment and delivery
- Admin product management workflow
- Order history re-download functionality

## Assumptions

- USD as default currency
- Single admin account
- Telegram file size limits respected
