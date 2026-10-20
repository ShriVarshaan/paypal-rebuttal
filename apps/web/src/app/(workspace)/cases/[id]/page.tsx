import type { Metadata } from "next";
import { CaseDetailView } from "@/components/case-detail";

export const metadata: Metadata = { title: "Case detail" };

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CaseDetailView id={id} />;
}
