import { Prisma } from "./index.js";

const json = (value: unknown) => value as Prisma.InputJsonValue;

interface CatalogProduct {
  id: string;
  slug: string;
  sku: string;
  title: string;
  description: string;
  priceCents: number;
  category: "ceramics" | "prints" | "apparel" | "accessories" | "digital" | "legacy";
  digital: boolean;
  featured: boolean;
  capturedAt: string;
}

const FEATURED_PRODUCTS: CatalogProduct[] = [
  {
    id: "product-speckled-bowl",
    slug: "speckled-serving-bowl",
    sku: "FF-CER-BOWL-01",
    title: "Speckled serving bowl",
    description: "A wide stoneware bowl with a satin oat glaze and hand-finished speckles.",
    priceCents: 7450,
    category: "ceramics",
    digital: false,
    featured: true,
    capturedAt: "2026-09-01T09:00:00.000Z",
  },
  {
    id: "product-moss-mug",
    slug: "moss-glaze-mug",
    sku: "FF-CER-MUG-02",
    title: "Moss glaze mug",
    description: "Wheel-thrown stoneware with a soft green glaze and comfortable thumb rest.",
    priceCents: 3600,
    category: "ceramics",
    digital: false,
    featured: true,
    capturedAt: "2026-08-18T09:00:00.000Z",
  },
  {
    id: "product-field-print",
    slug: "field-notes-print",
    sku: "FF-PRT-FIELD-01",
    title: "Field notes print",
    description: "Archival pigment print of pencil studies gathered on an autumn field walk.",
    priceCents: 4200,
    category: "prints",
    digital: false,
    featured: true,
    capturedAt: "2026-08-20T09:00:00.000Z",
  },
  {
    id: "product-tidal-print",
    slug: "tidal-study-print",
    sku: "FF-PRT-TIDE-02",
    title: "Tidal study print",
    description: "A quiet two-colour study printed on warm, uncoated cotton paper.",
    priceCents: 4800,
    category: "prints",
    digital: false,
    featured: true,
    capturedAt: "2026-08-22T09:00:00.000Z",
  },
  {
    id: "product-linen-jacket",
    slug: "linen-field-jacket",
    sku: "FF-APP-JACKET-01",
    title: "Linen field jacket",
    description: "A relaxed work jacket in washed flax linen with four practical pockets.",
    priceCents: 12900,
    category: "apparel",
    digital: false,
    featured: true,
    capturedAt: "2026-08-25T09:00:00.000Z",
  },
  {
    id: "product-market-tote",
    slug: "woven-market-tote",
    sku: "FF-ACC-TOTE-01",
    title: "Woven market tote",
    description: "A sturdy cotton carryall with reinforced handles and an interior key loop.",
    priceCents: 5800,
    category: "accessories",
    digital: false,
    featured: true,
    capturedAt: "2026-08-27T09:00:00.000Z",
  },
  {
    id: "product-indigo-apron",
    slug: "indigo-studio-apron",
    sku: "FF-APP-APRON-01",
    title: "Indigo studio apron",
    description: "Cross-back studio apron in indigo-dyed cotton twill with split pockets.",
    priceCents: 6800,
    category: "apparel",
    digital: false,
    featured: true,
    capturedAt: "2026-08-29T09:00:00.000Z",
  },
  {
    id: "product-quilt-pattern",
    slug: "meadow-quilt-pattern",
    sku: "FF-DIG-PATTERN-01",
    title: "Meadow quilt pattern PDF",
    description: "A printable, illustrated pattern with cutting plans for three quilt sizes.",
    priceCents: 1800,
    category: "digital",
    digital: true,
    featured: true,
    capturedAt: "2026-09-03T09:00:00.000Z",
  },
  {
    id: "product-preset-pack",
    slug: "soft-daylight-presets",
    sku: "FF-DIG-PRESET-01",
    title: "Soft daylight preset pack",
    description: "Eight restrained editing presets for warm daylight and natural materials.",
    priceCents: 2400,
    category: "digital",
    digital: true,
    featured: true,
    capturedAt: "2026-09-05T09:00:00.000Z",
  },
  {
    id: "product-studio-course",
    slug: "slow-studio-course",
    sku: "FF-DIG-COURSE-01",
    title: "Slow studio course",
    description: "A self-paced course on planning, photographing, and publishing a small collection.",
    priceCents: 8900,
    category: "digital",
    digital: true,
    featured: true,
    capturedAt: "2026-09-07T09:00:00.000Z",
  },
];

const LEGACY_PRODUCTS: CatalogProduct[] = [
  {
    id: "product-legacy-headphones",
    slug: "legacy-wireless-headphones",
    sku: "SKU-HEADPHONES-01",
    title: "Wireless headphones",
    description: "Legacy fixture catalog record retained for the existing sandbox purchase.",
    priceCents: 8900,
    category: "legacy",
    digital: false,
    featured: false,
    capturedAt: "2026-09-01T09:00:00.000Z",
  },
  {
    id: "product-legacy-jacket",
    slug: "legacy-waxed-canvas-jacket",
    sku: "SKU-JACKET-M",
    title: "Waxed canvas jacket, size M",
    description: "Olive waxed-canvas jacket with a brass zip and cotton lining.",
    priceCents: 6450,
    category: "legacy",
    digital: false,
    featured: false,
    capturedAt: "2026-10-01T09:00:00.000Z",
  },
  {
    id: "product-legacy-ebook",
    slug: "legacy-digital-recipe-ebook",
    sku: "SKU-EBOOK-07",
    title: "Digital recipe e-book",
    description: "Legacy imported order with no retained purchase-time listing snapshot.",
    priceCents: 850,
    category: "legacy",
    digital: true,
    featured: false,
    capturedAt: "2026-10-12T09:00:00.000Z",
  },
];

const products = [...FEATURED_PRODUCTS, ...LEGACY_PRODUCTS];
const snapshotId = (productId: string, revision = 1) => `snapshot-${productId}-r${revision}`;
const asset = (slug: string) => [
  {
    id: `catalog-v1/${slug}/hero`,
    role: "hero",
    src: `/catalog/v1/${slug}.webp`,
    alt: `Synthetic ${slug.replaceAll("-", " ")} product photograph`,
  },
];

function snapshots() {
  const base = products
    .filter((product) => product.id !== "product-legacy-ebook")
    .map((product) => ({
      id: snapshotId(product.id),
      productId: product.id,
      title: product.title,
      description: product.description,
      priceCents: product.priceCents,
      currency: "USD",
      attributes: json({
        category: product.category,
        digital: product.digital,
        fulfillment: product.digital ? "download" : "shipping",
      }),
      assets: json(asset(product.slug)),
      capturedAt: new Date(product.capturedAt),
      revision: 1,
      rendererVersion: "storefront-v1",
      createdAt: new Date(product.capturedAt),
    }));

  base.push(
    {
      id: snapshotId("product-speckled-bowl", 2),
      productId: "product-speckled-bowl",
      title: "Speckled serving bowl — large",
      description: "A wide, large-format stoneware bowl with a satin oat glaze and hand-finished speckles.",
      priceCents: 7900,
      currency: "USD",
      attributes: json({ category: "ceramics", digital: false, size: "large", fulfillment: "shipping" }),
      assets: json(asset("speckled-serving-bowl-r2")),
      capturedAt: new Date("2026-10-10T09:00:00.000Z"),
      revision: 2,
      rendererVersion: "storefront-v1",
      createdAt: new Date("2026-10-10T09:00:00.000Z"),
    },
    {
      id: snapshotId("product-legacy-jacket", 2),
      productId: "product-legacy-jacket",
      title: "Waxed canvas jacket — deep olive, size M",
      description:
        "Deep-olive waxed-canvas jacket with a brass zip, cotton lining, and natural colour variation.",
      priceCents: 6900,
      currency: "USD",
      attributes: json({ category: "legacy", digital: false, colour: "deep olive", fulfillment: "shipping" }),
      assets: json(asset("legacy-waxed-canvas-jacket-r2")),
      capturedAt: new Date("2026-10-10T09:00:00.000Z"),
      revision: 2,
      rendererVersion: "storefront-v1",
      createdAt: new Date("2026-10-10T09:00:00.000Z"),
    },
  );
  return base;
}

const customers: Prisma.StoreCustomerCreateManyInput[] = [
  {
    id: "cus_201",
    priorOrders: 3,
    priorDisputes: 0,
    knownIps: json(["203.0.113.24"]),
    knownDevices: json(["dev_a71"]),
    createdAt: new Date("2025-03-14T00:00:00.000Z"),
    updatedAt: new Date("2025-03-14T00:00:00.000Z"),
  },
  {
    id: "cus_202",
    priorOrders: 0,
    priorDisputes: 0,
    knownIps: json([]),
    knownDevices: json([]),
    createdAt: new Date("2026-09-30T00:00:00.000Z"),
    updatedAt: new Date("2026-09-30T00:00:00.000Z"),
  },
  {
    id: "cus_203",
    priorOrders: 2,
    priorDisputes: 0,
    knownIps: json(["192.0.2.55"]),
    knownDevices: json(["dev_c19"]),
    createdAt: new Date("2024-11-02T00:00:00.000Z"),
    updatedAt: new Date("2024-11-02T00:00:00.000Z"),
  },
  {
    id: "customer-demo-bowl",
    priorOrders: 1,
    priorDisputes: 0,
    knownIps: json(["192.0.2.80"]),
    knownDevices: json(["dev_demo_bowl"]),
    createdAt: new Date("2026-04-12T00:00:00.000Z"),
    updatedAt: new Date("2026-04-12T00:00:00.000Z"),
  },
];

const orders: Prisma.StoreOrderCreateManyInput[] = [
  {
    id: "ord_1001",
    customerId: "cus_201",
    invoiceNumber: "INV-1001",
    paypalCaptureId: "3VK13355SM0012345",
    paypalOrderId: "5O190127TN364715T",
    status: "PAID",
    placedAt: new Date("2026-10-02T14:20:31.000Z"),
    totalCents: 8900,
    currency: "USD",
    digital: false,
    checkoutIp: "203.0.113.24",
    checkoutDeviceId: "dev_a71",
    avs: "Y",
    cvv: "M",
    createdAt: new Date("2026-10-02T14:20:31.000Z"),
    updatedAt: new Date("2026-10-02T14:20:31.000Z"),
  },
  {
    id: "ord_1002",
    customerId: "cus_202",
    invoiceNumber: "INV-1002",
    paypalCaptureId: "7MC82044LD0067890",
    paypalOrderId: "8XK40513CD118802B",
    status: "PAID",
    placedAt: new Date("2026-10-05T10:02:10.000Z"),
    totalCents: 6450,
    currency: "USD",
    digital: false,
    checkoutIp: "198.51.100.7",
    checkoutDeviceId: "dev_b02",
    avs: "Y",
    cvv: "M",
    createdAt: new Date("2026-10-05T10:02:10.000Z"),
    updatedAt: new Date("2026-10-05T10:02:10.000Z"),
  },
  {
    id: "ord_1003",
    customerId: "cus_203",
    invoiceNumber: "INV-1003",
    paypalCaptureId: "9PL33012QA0044556",
    paypalOrderId: "2RT77001KK550120M",
    status: "PAID",
    placedAt: new Date("2026-10-11T22:47:02.000Z"),
    totalCents: 850,
    currency: "USD",
    digital: true,
    checkoutIp: "192.0.2.55",
    checkoutDeviceId: "dev_c19",
    avs: "Y",
    cvv: "M",
    createdAt: new Date("2026-10-11T22:47:02.000Z"),
    updatedAt: new Date("2026-10-11T22:47:02.000Z"),
  },
  {
    id: "demo-order-bowl-01",
    customerId: "customer-demo-bowl",
    invoiceNumber: "DEMO-INV-BOWL-01",
    paypalCaptureId: null,
    paypalOrderId: null,
    status: "PAID",
    placedAt: new Date("2026-09-20T12:00:00.000Z"),
    totalCents: 7450,
    currency: "USD",
    digital: false,
    checkoutIp: "192.0.2.80",
    checkoutDeviceId: "dev_demo_bowl",
    avs: "Y",
    cvv: "M",
    createdAt: new Date("2026-09-20T12:00:00.000Z"),
    updatedAt: new Date("2026-09-20T12:00:00.000Z"),
  },
];

const orderItems: Prisma.StoreOrderItemCreateManyInput[] = [
  {
    id: "item-ord_1001-1",
    orderId: "ord_1001",
    productId: "product-legacy-headphones",
    listingSnapshotId: snapshotId("product-legacy-headphones"),
    name: "Wireless headphones",
    sku: "SKU-HEADPHONES-01",
    quantity: 1,
    unitPriceCents: 8900,
    currency: "USD",
    digital: false,
    createdAt: new Date("2026-10-02T14:20:31.000Z"),
  },
  {
    id: "item-ord_1002-1",
    orderId: "ord_1002",
    productId: "product-legacy-jacket",
    listingSnapshotId: snapshotId("product-legacy-jacket"),
    name: "Waxed canvas jacket, size M",
    sku: "SKU-JACKET-M",
    quantity: 1,
    unitPriceCents: 6450,
    currency: "USD",
    digital: false,
    createdAt: new Date("2026-10-05T10:02:10.000Z"),
  },
  {
    id: "item-ord_1003-1",
    orderId: "ord_1003",
    productId: "product-legacy-ebook",
    listingSnapshotId: null,
    name: "Digital recipe e-book",
    sku: "SKU-EBOOK-07",
    quantity: 1,
    unitPriceCents: 850,
    currency: "USD",
    digital: true,
    createdAt: new Date("2026-10-11T22:47:02.000Z"),
  },
  {
    id: "item-demo-order-bowl-01",
    orderId: "demo-order-bowl-01",
    productId: "product-speckled-bowl",
    listingSnapshotId: snapshotId("product-speckled-bowl"),
    name: "Speckled serving bowl",
    sku: "FF-CER-BOWL-01",
    quantity: 1,
    unitPriceCents: 7450,
    currency: "USD",
    digital: false,
    createdAt: new Date("2026-09-20T12:00:00.000Z"),
  },
];

const threads: Prisma.StoreMessageThreadCreateManyInput[] = [
  {
    id: "thread-ord_1001",
    orderId: "ord_1001",
    channel: "email",
    subject: "Delivery question",
    createdAt: new Date("2026-10-09T08:15:00.000Z"),
    updatedAt: new Date("2026-10-09T11:40:00.000Z"),
  },
  {
    id: "thread-ord_1002",
    orderId: "ord_1002",
    channel: "email",
    subject: "Jacket colour and zip",
    createdAt: new Date("2026-10-14T19:02:00.000Z"),
    updatedAt: new Date("2026-10-15T09:30:00.000Z"),
  },
];

const messages: Prisma.StoreMessageCreateManyInput[] = [
  {
    id: "message-ord_1001-buyer",
    threadId: "thread-ord_1001",
    dedupeKey: "2026-10-09T08:15:00.000Z:buyer",
    sender: "buyer",
    text: "Hi, my headphones haven't shown up. Can you check?",
    sentAt: new Date("2026-10-09T08:15:00.000Z"),
    createdAt: new Date("2026-10-09T08:15:00.000Z"),
  },
  {
    id: "message-ord_1001-seller",
    threadId: "thread-ord_1001",
    dedupeKey: "2026-10-09T11:40:00.000Z:seller",
    sender: "seller",
    text: "Sorry to hear that! USPS tracking EZ4000000004 shows it was delivered on Oct 5 and signed for. Could you check with neighbours or your building's mail room?",
    sentAt: new Date("2026-10-09T11:40:00.000Z"),
    createdAt: new Date("2026-10-09T11:40:00.000Z"),
  },
  {
    id: "message-ord_1002-buyer",
    threadId: "thread-ord_1002",
    dedupeKey: "2026-10-14T19:02:00.000Z:buyer",
    sender: "buyer",
    text: "The jacket is a lot darker than the photos and the zip keeps sticking.",
    sentAt: new Date("2026-10-14T19:02:00.000Z"),
    createdAt: new Date("2026-10-14T19:02:00.000Z"),
  },
  {
    id: "message-ord_1002-seller",
    threadId: "thread-ord_1002",
    dedupeKey: "2026-10-15T09:30:00.000Z:seller",
    sender: "seller",
    text: "Thanks for letting us know, and sorry about the zip. We can sort this out — would a partial refund or a return work better for you?",
    sentAt: new Date("2026-10-15T09:30:00.000Z"),
    createdAt: new Date("2026-10-15T09:30:00.000Z"),
  },
];

const shipments: Prisma.StoreShipmentCreateManyInput[] = [
  {
    id: "shipment-ord_1001",
    orderId: "ord_1001",
    carrier: "USPS",
    trackingNumber: "EZ4000000004",
    status: "delivered",
    address: json({ city: "Demo City", region: "CA", postalCode: "94107", country: "US" }),
    history: json([
      { at: "2026-10-03T09:00:00.000Z", status: "in_transit" },
      { at: "2026-10-05T16:20:00.000Z", status: "delivered" },
    ]),
    shippedAt: new Date("2026-10-03T09:00:00.000Z"),
    deliveredAt: new Date("2026-10-05T16:20:00.000Z"),
    createdAt: new Date("2026-10-03T09:00:00.000Z"),
    updatedAt: new Date("2026-10-05T16:20:00.000Z"),
  },
  {
    id: "shipment-ord_1002",
    orderId: "ord_1002",
    carrier: "USPS",
    trackingNumber: "EZ3000000003",
    status: "delivered",
    address: json({ city: "Demo City", region: "NY", postalCode: "10001", country: "US" }),
    history: json([
      { at: "2026-10-06T09:00:00.000Z", status: "in_transit" },
      { at: "2026-10-08T15:10:00.000Z", status: "delivered" },
    ]),
    shippedAt: new Date("2026-10-06T09:00:00.000Z"),
    deliveredAt: new Date("2026-10-08T15:10:00.000Z"),
    createdAt: new Date("2026-10-06T09:00:00.000Z"),
    updatedAt: new Date("2026-10-08T15:10:00.000Z"),
  },
];

const downloads: Prisma.StoreDownloadEventCreateManyInput[] = [
  {
    id: "download-ord_1003-1",
    orderId: "ord_1003",
    orderItemId: "item-ord_1003-1",
    action: "download",
    ip: "192.0.2.55",
    deviceId: "dev_c19",
    occurredAt: new Date("2026-10-11T22:49:41.000Z"),
    createdAt: new Date("2026-10-11T22:49:41.000Z"),
  },
  {
    id: "download-ord_1003-2",
    orderId: "ord_1003",
    orderItemId: "item-ord_1003-1",
    action: "download",
    ip: "192.0.2.55",
    deviceId: "dev_c19",
    occurredAt: new Date("2026-10-13T07:12:09.000Z"),
    createdAt: new Date("2026-10-13T07:12:09.000Z"),
  },
];

export interface StoreSeedResult {
  storeProductsAdded: number;
  storeSnapshotsAdded: number;
  storeCustomersAdded: number;
  storeOrdersAdded: number;
  storeOrderItemsAdded: number;
  storeShipmentsAdded: number;
  storeThreadsAdded: number;
  storeMessagesAdded: number;
  storeDownloadsAdded: number;
}

export async function seedStoreData(tx: Prisma.TransactionClient): Promise<StoreSeedResult> {
  const productRows = products.map((product) => ({
    id: product.id,
    slug: product.slug,
    sku: product.sku,
    active: true,
    featured: product.featured,
    createdAt: new Date(product.capturedAt),
    updatedAt: new Date(product.capturedAt),
  }));
  const createdProducts = await tx.storeProduct.createMany({ data: productRows, skipDuplicates: true });
  const createdSnapshots = await tx.listingSnapshot.createMany({ data: snapshots(), skipDuplicates: true });
  const createdCustomers = await tx.storeCustomer.createMany({ data: customers, skipDuplicates: true });
  const createdOrders = await tx.storeOrder.createMany({ data: orders, skipDuplicates: true });
  const createdItems = await tx.storeOrderItem.createMany({ data: orderItems, skipDuplicates: true });
  const createdShipments = await tx.storeShipment.createMany({ data: shipments, skipDuplicates: true });
  const createdThreads = await tx.storeMessageThread.createMany({ data: threads, skipDuplicates: true });
  const createdMessages = await tx.storeMessage.createMany({ data: messages, skipDuplicates: true });
  const createdDownloads = await tx.storeDownloadEvent.createMany({ data: downloads, skipDuplicates: true });

  return {
    storeProductsAdded: createdProducts.count,
    storeSnapshotsAdded: createdSnapshots.count,
    storeCustomersAdded: createdCustomers.count,
    storeOrdersAdded: createdOrders.count,
    storeOrderItemsAdded: createdItems.count,
    storeShipmentsAdded: createdShipments.count,
    storeThreadsAdded: createdThreads.count,
    storeMessagesAdded: createdMessages.count,
    storeDownloadsAdded: createdDownloads.count,
  };
}
