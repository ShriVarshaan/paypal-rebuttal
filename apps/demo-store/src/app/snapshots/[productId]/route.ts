import { GET as getSnapshot, OPTIONS } from "@/app/api/products/[id]/snapshots/route";

export async function GET(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  return getSnapshot(request, { params: Promise.resolve({ id: productId }) });
}

export { OPTIONS };
