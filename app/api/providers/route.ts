import { NextResponse } from "next/server";
import { availableProviders } from "@/lib/llm";
import { guestPreviewProviderCapability } from "@/lib/guestPreviewConfig";

export async function GET() {
  const guestPreview = guestPreviewProviderCapability();
  return NextResponse.json({
    providers: availableProviders(),
    guestPreviewEnabled: guestPreview.enabled,
    guestPreview,
  });
}
