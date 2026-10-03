import type { Metadata } from "next";
import { EmailUnsubscribe } from "@/components/services/EmailUnsubscribe";
export const metadata: Metadata = { title: "이메일 수신 거부", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  return <EmailUnsubscribe token={(await params).token} />;
}
