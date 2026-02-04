import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const DATA_FILE = path.join(process.cwd(), "data/library.json");

export async function GET() {
  try {
    if (!existsSync(DATA_FILE)) {
      return NextResponse.json({ works: [], editions: [], userCopies: [] });
    }
    const content = await readFile(DATA_FILE, "utf-8");
    const data = JSON.parse(content);
    return NextResponse.json(data);
  } catch (err) {
    console.error("Library load error:", err);
    return NextResponse.json({ works: [], editions: [], userCopies: [] });
  }
}
