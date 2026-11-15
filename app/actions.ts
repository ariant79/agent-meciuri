"use server";

import { revalidatePath } from "next/cache";
import { azi } from "@/lib/date";
import { executaColectare } from "@/colecteaza";

export async function reimprospateazaAction() {
  await executaColectare(azi());
  revalidatePath("/");
}
