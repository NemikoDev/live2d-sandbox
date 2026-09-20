// app/page.tsx
"use client";

import dynamic from "next/dynamic";

const Live2DCanvas = dynamic(() => import("./components/Live2dCanvas"), {
  ssr: false,
});

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <Live2DCanvas />
    </main>
  );
}