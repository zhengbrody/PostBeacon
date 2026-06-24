import { NextResponse } from "next/server";
import { availableProviders } from "@/lib/llm";

export async function GET() {
  return NextResponse.json({ providers: availableProviders() });
}
