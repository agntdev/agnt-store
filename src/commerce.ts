/** Shared commerce types and small pure helpers. */
export interface Product {
  id: string;
  title: string;
  description: string;
  price: number; // smallest USD unit (cents)
  currency: "USD";
  category: string;
  thumbnail?: string;
  files: string[]; // Telegram document file_ids
  sku: string;
  active: boolean;
}

export interface Order {
  id: string;
  buyerId: number;
  productIds: string[];
  totalPrice: number;
  currency: "USD";
  paymentStatus: "pending" | "paid" | "failed" | "expired" | "refunded";
  paymentChargeId?: string;
  timestamp: number;
}

/** One clock seam for invoice expiry and order timestamps. */
let clock: () => number = () => Date.now();
export const now = () => clock();
export const setClockForTests = (next?: () => number) => {
  clock = next ?? (() => Date.now());
};

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const productText = (product: Product) =>
  `<b>${escapeHtml(product.title)}</b>\n${escapeHtml(product.description)}\n\n${money(product.price)}`;

export function productId(userId: number): string {
  return `p-${userId}-${now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

export function orderId(userId: number): string {
  return `o-${userId}-${now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}
