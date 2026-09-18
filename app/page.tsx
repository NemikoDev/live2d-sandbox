// app/page.tsx
"use client";

import dynamic from "next/dynamic";

const Live2DCanvas = dynamic(() => import("./components/Live2dCanvas"), {
  ssr: false,
});

export default function Home() {
  return (
    <main style={{ width: "100vw", height: "100vh" }}>
      <Live2DCanvas />
    </main>
  );
}