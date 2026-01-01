import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const url = process.env.CONTACT_WEBHOOK_URL;
    if (!url) {
      return NextResponse.json(
        { error: "CONTACT_WEBHOOK_URL is not configured" },
        { status: 500 }
      );
    }

    const bodyText = await req.text();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyText,
      cache: "no-store",
    });

    const contentType = res.headers.get("content-type") || "";
    const text = await res.text();

    if (contentType.includes("application/json")) {
      try {
        const json = JSON.parse(text);
        return NextResponse.json(json, { status: res.status });
      } catch {
        // fallthrough to return text
      }
    }

    return new NextResponse(text, {
      status: res.status,
      headers: { "content-type": contentType || "text/plain" },
    });
  } catch (e) {
    return NextResponse.json({ error: "Proxy error" }, { status: 502 });
  }
}
