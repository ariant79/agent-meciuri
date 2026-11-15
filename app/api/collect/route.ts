import { NextRequest, NextResponse } from "next/server";
import { azi } from "@/lib/date";
import { executaColectare } from "@/colecteaza";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization");
  if (process.env.CRON_SECRET && secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ eroare: "neautorizat" }, { status: 401 });
  }

  const rezultat = await executaColectare(azi());
  return NextResponse.json(rezultat);
}
