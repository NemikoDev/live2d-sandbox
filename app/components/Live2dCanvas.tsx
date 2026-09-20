"use client";

import { useEffect, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import JSZip from "jszip";

if (typeof window !== "undefined") {
  (window as any).PIXI = PIXI;
  PIXI.settings.PREFER_ENV = PIXI.ENV.WEBGL2;
}

const DEBUG = false;

// Filter out junk and stuff
function isJunk(path: string): boolean {
  const name = path.split("/").pop() ?? "";
  return (
    path.startsWith("__MACOSX/") ||
    name.startsWith("._") ||
    name === ".DS_Store" ||
    name === "Thumbs.db" ||
    name === ""
  );
}

function normalizeKey(path: string): string {
  let p = path.replace(/\\/g, "/").replace(/^\.\//, "");
  try {
    p = decodeURIComponent(p);
  } catch {}
  return p.toLowerCase();
}

export default function Live2DCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const modelRef = useRef<any>(null);
  const objectUrlsRef = useRef<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const max_size = 350 * 1024 * 1024; // 350 MB to prevent zip bombs

  useEffect(() => {
    if (!canvasRef.current) return;

    let app: PIXI.Application | null = null;
    let animationFrameId: number;

    animationFrameId = requestAnimationFrame(() => {
      if (!canvasRef.current) return;

      app = new PIXI.Application({
        view: canvasRef.current,
        resizeTo: window,
        backgroundColor: 0x1f2937,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      });

      appRef.current = app;
    });

    return () => {
      cancelAnimationFrame(animationFrameId);
      objectUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      objectUrlsRef.current = [];
      if (app) {
        app.destroy(true, { children: true });
        appRef.current = null;
      }
    };
  }, []);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !appRef.current) return;

    setIsLoading(true);

    const previousUrls = objectUrlsRef.current;
    const newUrls: string[] = [];

    try {
      const { Live2DModel, Live2DFactory } = await import("pixi-live2d-display-lipsyncpatch");
      if (file.size > max_size) {
        throw new Error(`ZIP file exceeds maximum size of ${max_size / (1024 * 1024)} MB.`);
      }

      const zip = await JSZip.loadAsync(file);

      const entries = Object.entries(zip.files)
        .filter(([, entry]) => !entry.dir)
        .map(([path, entry]) => ({ path: path.replace(/\\/g, "/"), entry }))
        .filter(({ path }) => !isJunk(path));

      const settingsEntry =
        entries.find(({ path }) => path.endsWith(".model3.json")) ??
        entries.find(({ path }) => path.endsWith(".model.json"));

      if (!settingsEntry) {
        throw new Error("No .model3.json or .model.json found in the ZIP file.");
      }

      const slash = settingsEntry.path.lastIndexOf("/");
      const baseFolder = slash !== -1 ? settingsEntry.path.slice(0, slash + 1) : "";

      const urlMap = new Map<string, string>();

      for (const { path, entry } of entries) {
        if (baseFolder && !path.startsWith(baseFolder)) continue;

        const relativePath = baseFolder ? path.slice(baseFolder.length) : path;
        const objectUrl = URL.createObjectURL(await entry.async("blob"));

        newUrls.push(objectUrl);
        urlMap.set(normalizeKey(relativePath), objectUrl);
      }

      const settingsJSON = JSON.parse(await settingsEntry.entry.async("string"));
      settingsJSON.url = new URL(settingsEntry.path, window.location.href).href;

      const runtime = Live2DFactory.findRuntime(settingsJSON);
      if (!runtime) {
        throw new Error("Unrecognized model (neither Cubism 2 nor Cubism 4).");
      }

      const settings = runtime.createModelSettings(settingsJSON);
      const unresolved: string[] = [];

      settings.resolveURL = (target: string): string => {
        if (/^(blob:|data:|https?:)/i.test(target)) return target;

        const objectUrl = urlMap.get(normalizeKey(target));
        if (objectUrl) {
          if (DEBUG) console.log("[live2d] resolve", target, "→", objectUrl);
          return objectUrl;
        }

        unresolved.push(target);
        if (DEBUG) console.warn("[live2d] UNRESOLVED", target);
        return target;
      };

      const essentials = [settings.moc, ...(settings.textures ?? [])].filter(Boolean);
      const missing = essentials.filter((f: string) => !urlMap.get(normalizeKey(f)));

      if (missing.length) {
        throw new Error(
          `Missing from ZIP: ${missing.join(", ")}\n` +
            `Files available: ${[...urlMap.keys()].join(", ")}`
        );
      }

      if (modelRef.current) {
        appRef.current.stage.removeChild(modelRef.current);
        modelRef.current.destroy();
        modelRef.current = null;
      }

      const model = await Live2DModel.from(settings, { ticker: PIXI.Ticker.shared });
      modelRef.current = model;

      model.anchor.set(0.5, 0.5);
      model.x = appRef.current.screen.width / 2;
      model.y = appRef.current.screen.height / 2;
      model.scale.set((appRef.current.screen.height * 0.75) / model.height);

      appRef.current.stage.addChild(model as any);

      if (unresolved.length) {
        console.warn("[live2d] loaded, but these references had no match:", unresolved);
      }

      previousUrls.forEach((u) => URL.revokeObjectURL(u));
      objectUrlsRef.current = newUrls;
    } catch (err) {
      newUrls.forEach((u) => URL.revokeObjectURL(u));
      console.error("Failed to load Live2D model:", err);
      alert(err instanceof Error ? err.message : "Error loading model.");
    } finally {
      setIsLoading(false);
      event.target.value = "";
    }
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        maxWidth: "100%",
        maxHeight: "100%",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 20,
          left: 20,
          zIndex: 10,
          background: "rgba(0, 0, 0, 0.8)",
          padding: "16px",
          borderRadius: "8px",
          color: "#fff",
          fontFamily: "sans-serif",
        }}
      >
        <p style={{ margin: "0 0 8px 0", fontSize: "0.9rem", fontWeight: "bold" }}>
          Select Your Live2D ZIP File
        </p>
        <p style={{ margin: "0 0 8px 0", fontSize: "0.75rem" }}>
          some examples can be found here:{" "}
          <a
            href="https://www.live2d.com/en/learn/sample/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#facc15", textDecoration: "underline" }}
          >
            https://www.live2d.com/en/learn/sample/
          </a>
        </p>
        <input
          type="file"
          accept=".zip"
          onChange={handleFileUpload}
          disabled={isLoading}
          style={{ fontSize: "0.85rem", color: "#ccc" }}
        />
        {isLoading && <p style={{ margin: "8px 0 0 0", color: "#facc15" }}>Loading model...</p>}
      </div>

      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
        }}
      />
    </div>
  );
}