import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "library.json");

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { works, editions, userCopies } = body;

    if (!Array.isArray(works) || !Array.isArray(editions) || !Array.isArray(userCopies)) {
      return NextResponse.json({ ok: false, error: "Invalid data format" }, { status: 400 });
    }

    if (!existsSync(DATA_DIR)) {
      await mkdir(DATA_DIR, { recursive: true });
    }

    await writeFile(DATA_FILE, JSON.stringify({ works, editions, userCopies }, null, 2), "utf-8");
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Library save error:", err);
    return NextResponse.json({ ok: false, error: "Save failed" }, { status: 500 });
  }
}
