import type { Order, Product } from "./commerce.js";

/** The subset of Cloudflare D1 used by this repository. */
export interface D1Result<T = Record<string, unknown>> {
  results?: T[];
}
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}
export interface CommerceDatabase {
  prepare(query: string): D1Statement;
}

type ProductRow = Omit<Product, "files" | "active"> & { files: string; active: number };
type OrderRow = Omit<Order, "productIds" | "paymentChargeId"> & {
  productIds: string;
  paymentChargeId: string | null;
};

const productFrom = (row: ProductRow): Product => ({
  ...row,
  files: JSON.parse(row.files) as string[],
  active: row.active === 1,
});
const orderFrom = (row: OrderRow): Order => ({
  ...row,
  productIds: JSON.parse(row.productIds) as string[],
  paymentChargeId: row.paymentChargeId ?? undefined,
});

/**
 * Durable commerce repository. It never scans a keyspace: category and buyer
 * queries use indexed SQL columns, and every record has a stable primary key.
 */
export class CommerceStore {
  private initialized = false;
  constructor(private readonly db: CommerceDatabase) {}

  private async ready(): Promise<void> {
    if (this.initialized) return;
    await this.db.prepare(`CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
      price INTEGER NOT NULL, currency TEXT NOT NULL, category TEXT NOT NULL,
      thumbnail TEXT, files TEXT NOT NULL, sku TEXT NOT NULL UNIQUE, active INTEGER NOT NULL
    )`).run();
    await this.db.prepare("CREATE INDEX IF NOT EXISTS products_category_active ON products(category, active)").run();
    await this.db.prepare(`CREATE TABLE IF NOT EXISTS categories (
      name TEXT PRIMARY KEY, display_order INTEGER NOT NULL
    )`).run();
    await this.db.prepare(`CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, buyer_id INTEGER NOT NULL, product_ids TEXT NOT NULL,
      total_price INTEGER NOT NULL, currency TEXT NOT NULL, payment_status TEXT NOT NULL,
      payment_charge_id TEXT, timestamp INTEGER NOT NULL
    )`).run();
    await this.db.prepare("CREATE INDEX IF NOT EXISTS orders_buyer_time ON orders(buyer_id, timestamp DESC)").run();
    await this.db.prepare(`CREATE TABLE IF NOT EXISTS admins (
      telegram_id INTEGER PRIMARY KEY, permissions TEXT NOT NULL
    )`).run();
    this.initialized = true;
  }

  async ensureAdmin(userId: number): Promise<boolean> {
    await this.ready();
    // With no configured identity, the first owner to open administration
    // establishes the single owner account; later users cannot self-promote.
    await this.db.prepare(
      "INSERT INTO admins (telegram_id, permissions) SELECT ?, 'owner' WHERE NOT EXISTS (SELECT 1 FROM admins)",
    ).bind(userId).run();
    return (await this.db.prepare("SELECT telegram_id FROM admins WHERE telegram_id = ?").bind(userId).first()) !== null;
  }

  async addProduct(product: Product): Promise<void> {
    await this.ready();
    await this.db.prepare("INSERT OR IGNORE INTO categories (name, display_order) VALUES (?, COALESCE((SELECT MAX(display_order) + 1 FROM categories), 1))")
      .bind(product.category).run();
    await this.db.prepare(`INSERT INTO products
      (id,title,description,price,currency,category,thumbnail,files,sku,active)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(product.id, product.title, product.description, product.price, product.currency,
        product.category, product.thumbnail ?? null, JSON.stringify(product.files), product.sku, product.active ? 1 : 0).run();
  }

  async categories(): Promise<string[]> {
    await this.ready();
    const r = await this.db.prepare("SELECT name FROM categories ORDER BY display_order, name").all<{ name: string }>();
    return (r.results ?? []).map((row) => row.name);
  }
  async products(category?: string): Promise<Product[]> {
    await this.ready();
    const statement = category
      ? this.db.prepare("SELECT * FROM products WHERE active = 1 AND category = ? ORDER BY title").bind(category)
      : this.db.prepare("SELECT * FROM products WHERE active = 1 ORDER BY category, title");
    const r = await statement.all<ProductRow>();
    return (r.results ?? []).map(productFrom);
  }
  async product(id: string): Promise<Product | undefined> {
    await this.ready();
    const row = await this.db.prepare("SELECT * FROM products WHERE id = ? AND active = 1").bind(id).first<ProductRow>();
    return row ? productFrom(row) : undefined;
  }
  async updateProduct(id: string, patch: Pick<Product, "title" | "description" | "price" | "category">): Promise<boolean> {
    await this.ready();
    const existing = await this.product(id);
    if (!existing) return false;
    await this.db.prepare("INSERT OR IGNORE INTO categories (name, display_order) VALUES (?, COALESCE((SELECT MAX(display_order) + 1 FROM categories), 1))").bind(patch.category).run();
    await this.db.prepare("UPDATE products SET title=?, description=?, price=?, category=? WHERE id=?")
      .bind(patch.title, patch.description, patch.price, patch.category, id).run();
    return true;
  }
  async createOrder(order: Order): Promise<void> {
    await this.ready();
    await this.db.prepare(`INSERT INTO orders
      (id,buyer_id,product_ids,total_price,currency,payment_status,payment_charge_id,timestamp)
      VALUES (?,?,?,?,?,?,?,?)`).bind(order.id, order.buyerId, JSON.stringify(order.productIds),
        order.totalPrice, order.currency, order.paymentStatus, order.paymentChargeId ?? null, order.timestamp).run();
  }
  async order(id: string): Promise<Order | undefined> {
    await this.ready();
    const row = await this.db.prepare("SELECT * FROM orders WHERE id=?").bind(id).first<OrderRow>();
    return row ? orderFrom(row) : undefined;
  }
  async ordersForBuyer(buyerId: number): Promise<Order[]> {
    await this.ready();
    const r = await this.db.prepare("SELECT * FROM orders WHERE buyer_id=? ORDER BY timestamp DESC").bind(buyerId).all<OrderRow>();
    return (r.results ?? []).map(orderFrom);
  }
  async setOrderStatus(id: string, status: Order["paymentStatus"], chargeId?: string): Promise<void> {
    await this.ready();
    await this.db.prepare("UPDATE orders SET payment_status=?, payment_charge_id=COALESCE(?, payment_charge_id) WHERE id=?")
      .bind(status, chargeId ?? null, id).run();
  }
  async adminIds(): Promise<number[]> {
    await this.ready();
    const r = await this.db.prepare("SELECT telegram_id FROM admins").all<{ telegram_id: number }>();
    return (r.results ?? []).map((row) => row.telegram_id);
  }
}

export interface CommerceRepository {
  ensureAdmin(userId: number): Promise<boolean>; addProduct(product: Product): Promise<void>;
  categories(): Promise<string[]>; products(category?: string): Promise<Product[]>; product(id: string): Promise<Product | undefined>;
  updateProduct(id: string, patch: Pick<Product, "title" | "description" | "price" | "category">): Promise<boolean>;
  createOrder(order: Order): Promise<void>; order(id: string): Promise<Order | undefined>;
  ordersForBuyer(buyerId: number): Promise<Order[]>; setOrderStatus(id: string, status: Order["paymentStatus"], chargeId?: string): Promise<void>;
  adminIds(): Promise<number[]>;
}

interface CommerceStub { fetch(input: string, init?: { method?: string; body?: string }): Promise<Response>; }
interface CommerceNamespace { idFromName(name: string): unknown; get(id: unknown): CommerceStub; }

/** Durable Object fallback used when a deployment has no D1 binding. */
class DurableCommerceStore implements CommerceRepository {
  constructor(private readonly stub: CommerceStub) {}
  private async call<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
    const response = await this.stub.fetch("https://do/commerce", { method: "POST", body: JSON.stringify({ action, ...data }) });
    if (!response.ok) throw new Error("commerce storage unavailable");
    return (await response.json()) as T;
  }
  ensureAdmin(userId: number) { return this.call<boolean>("ensureAdmin", { userId }); }
  addProduct(product: Product) { return this.call<void>("addProduct", { product }); }
  categories() { return this.call<string[]>("categories"); }
  products(category?: string) { return this.call<Product[]>("products", { category }); }
  product(id: string) { return this.call<Product | undefined>("product", { id }); }
  updateProduct(id: string, patch: Pick<Product, "title" | "description" | "price" | "category">) { return this.call<boolean>("updateProduct", { id, patch }); }
  createOrder(order: Order) { return this.call<void>("createOrder", { order }); }
  order(id: string) { return this.call<Order | undefined>("order", { id }); }
  ordersForBuyer(buyerId: number) { return this.call<Order[]>("ordersForBuyer", { buyerId }); }
  setOrderStatus(id: string, status: Order["paymentStatus"], chargeId?: string) { return this.call<void>("setOrderStatus", { id, status, chargeId }); }
  adminIds() { return this.call<number[]>("adminIds"); }
}

export function storeFor(ctx: { env?: { DB?: unknown; CHAT_DO?: unknown } }): CommerceRepository | undefined {
  const db = ctx.env?.DB as CommerceDatabase | undefined;
  if (db && typeof db.prepare === "function") return new CommerceStore(db);
  const ns = ctx.env?.CHAT_DO as CommerceNamespace | undefined;
  return ns && typeof ns.get === "function" ? new DurableCommerceStore(ns.get(ns.idFromName("commerce"))) : undefined;
}
