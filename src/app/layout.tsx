import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "iOS Payments and Reviews Telegram Bot",
  description:
    "Verified iOS payment events and new App Store reviews forwarded to Telegram.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
