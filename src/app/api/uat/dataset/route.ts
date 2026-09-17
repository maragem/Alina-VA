import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireAdminUser } from "@/lib/currentUser";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const user = await requireAdminUser();
  if (user instanceof Response) return user;

  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const file = await readFile(
      path.join(process.cwd(), "scripts", "data", "Golden_DataSet.xlsx"),
    );
    return new Response(file, {
      headers: {
        "Content-Disposition": 'inline; filename="Golden_DataSet.xlsx"',
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      { error: "The golden dataset could not be loaded." },
      { status: 500 },
    );
  }
}