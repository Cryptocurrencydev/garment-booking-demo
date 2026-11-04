import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookingFlow } from "@/components/booking-flow";
import { SandboxBanner, SiteHeader } from "@/components/chrome";
import { loadMe, squarePublic } from "@/lib/me";
import { availableWindows } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/book/[kind]">): Promise<Metadata> {
  const { kind } = await params;
  return { title: kind === "delivery" ? "Schedule a delivery" : "Schedule a pickup" };
}

export default async function BookPage({ params }: PageProps<"/book/[kind]">) {
  const { kind } = await params;
  if (kind !== "pickup" && kind !== "delivery") notFound();
  const me = await loadMe();
  return (
    <>
      <SandboxBanner />
      <SiteHeader back={{ href: "/", label: "Home" }} />
      <main>
        <BookingFlow kind={kind} windows={availableWindows()} square={squarePublic()} me={me && { name: me.name, email: me.email, phone: me.phone, card: me.card, member: me.member }} />
      </main>
    </>
  );
}
