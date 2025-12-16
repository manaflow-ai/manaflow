"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import heatmapDemo1 from "@/assets/heatmap-demo-1.png";

// Traditional Chinese (Taiwan, Hong Kong, Macau)
const zhTW = {
  backToCmux: "← 返回",
  title: "用於程式碼審查的熱力圖差異檢視器",
  titleHeatmap: "熱力圖",
  description1: "熱力圖會根據每行/每個 token 可能需要的",
  humanAttention: "人工關注程度",
  description2:
    "進行顏色編碼。與 PR 審查機器人不同，我們不僅嘗試標記「這是 bug 嗎？」，還會標記「這值得再看一眼嗎？」（例如：",
  hardCodedSecret: "硬編碼的金鑰",
  weirdCryptoMode: "奇怪的加密模式",
  gnarlyLogic: "複雜的邏輯",
  description3: "）。",
  tryIt: "要試用，請將任何 GitHub pull request 網址中的 github.com 替換為",
  underTheHood: "。在背後，我們會將儲存庫複製到虛擬機中，為每個差異啟動",
  gpt5Codex: "gpt-5-codex",
  parseInto: "，並要求它輸出 JSON 資料結構，然後我們將其解析為",
  coloredHeatmap: "彩色熱力圖",
  examples: "範例：",
  openSource: "熱力圖是開源的",
  imageAlt: "熱力圖差異檢視器範例，顯示顏色編碼的程式碼變更",
};

// Simplified Chinese (Mainland China)
const zhCN = {
  backToCmux: "← 返回",
  title: "用于代码审查的热力图差异查看器",
  titleHeatmap: "热力图",
  description1: "热力图会根据每行/每个 token 可能需要的",
  humanAttention: "人工关注程度",
  description2:
    "进行颜色编码。与 PR 审查机器人不同，我们不仅尝试标记「这是 bug 吗？」，还会标记「这值得再看一眼吗？」（例如：",
  hardCodedSecret: "硬编码的密钥",
  weirdCryptoMode: "奇怪的加密模式",
  gnarlyLogic: "复杂的逻辑",
  description3: "）。",
  tryIt: "要试用，请将任何 GitHub pull request 网址中的 github.com 替换为",
  underTheHood: "。在后台，我们会将仓库克隆到虚拟机中，为每个差异启动",
  gpt5Codex: "gpt-5-codex",
  parseInto: "，并要求它输出 JSON 数据结构，然后我们将其解析为",
  coloredHeatmap: "彩色热力图",
  examples: "示例：",
  openSource: "热力图是开源的",
  imageAlt: "热力图差异查看器示例，显示颜色编码的代码变更",
};

type Translations = typeof zhTW;

function detectChineseVariant(): "zh-TW" | "zh-CN" {
  if (typeof navigator === "undefined") return "zh-CN";

  // Check navigator.language and navigator.languages
  const languages = [
    navigator.language,
    ...(navigator.languages || []),
  ].map((lang) => lang.toLowerCase());

  // Check for Traditional Chinese indicators
  // zh-TW (Taiwan), zh-HK (Hong Kong), zh-Hant (Traditional Chinese)
  for (const lang of languages) {
    if (
      lang === "zh-tw" ||
      lang === "zh-hk" ||
      lang === "zh-mo" ||
      lang.startsWith("zh-hant")
    ) {
      return "zh-TW";
    }
  }

  // Check for Simplified Chinese indicators
  // zh-CN (China), zh-SG (Singapore), zh-Hans (Simplified Chinese)
  for (const lang of languages) {
    if (
      lang === "zh-cn" ||
      lang === "zh-sg" ||
      lang.startsWith("zh-hans") ||
      lang === "zh"
    ) {
      return "zh-CN";
    }
  }

  // Default to Simplified Chinese for unspecified Chinese
  return "zh-CN";
}

export default function HeatmapZhPage() {
  const [variant, setVariant] = useState<"zh-TW" | "zh-CN">("zh-CN");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setVariant(detectChineseVariant());
    setMounted(true);
  }, []);

  const t: Translations = variant === "zh-TW" ? zhTW : zhCN;

  // Prevent hydration mismatch by showing nothing until mounted
  if (!mounted) {
    return (
      <div className="flex min-h-screen flex-col items-center bg-white p-4 pb-16 text-black sm:p-8 sm:pb-24">
        <div className="mx-auto mb-0 mt-8 max-w-3xl sm:mt-[70px]">
          <div className="h-6 w-32 animate-pulse rounded bg-neutral-200" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-white p-4 pb-16 text-black sm:p-8 sm:pb-24">
      <div className="mx-auto mb-0 mt-8 max-w-3xl sm:mt-[70px]">
        <div className="mb-6 flex items-center justify-between sm:mb-8">
          <Link
            href="https://cmux.dev"
            className="inline-block text-sm text-neutral-600 hover:text-black"
          >
            {t.backToCmux} <span className="bg-sky-100 px-1">cmux</span>
          </Link>
          <button
            onClick={() => setVariant(variant === "zh-TW" ? "zh-CN" : "zh-TW")}
            className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
          >
            {variant === "zh-TW" ? "简体中文" : "繁體中文"}
          </button>
        </div>
        <h1 className="mb-6 text-2xl font-bold sm:mb-8 sm:text-3xl">
          {variant === "zh-TW" ? "用於程式碼審查的" : "用于代码审查的"}
          <span className="bg-yellow-200 px-1">{t.titleHeatmap}</span>
          {variant === "zh-TW" ? "差異檢視器" : "差异查看器"}
        </h1>

        <div className="mb-6 text-sm leading-[1.6] sm:mb-8 sm:text-base">
          <p className="mb-4">
            {t.description1}
            <span className="bg-yellow-200 px-1">{t.humanAttention}</span>
            {t.description2}
            <span className="bg-red-300 px-1">{t.hardCodedSecret}</span>、
            <span className="bg-orange-300 px-1">{t.weirdCryptoMode}</span>、
            <span className="bg-orange-200 px-1">{t.gnarlyLogic}</span>
            {t.description3}
          </p>

          <p className="mb-4">
            {t.tryIt}
            <span className="bg-yellow-300 px-1">0github.com</span>
            {t.underTheHood}
            <span className="bg-yellow-200 px-1">{t.gpt5Codex}</span>
            {t.parseInto}
            <span className="bg-yellow-200 px-1">{t.coloredHeatmap}</span>。
          </p>
        </div>

        <div className="mt-6 text-sm sm:mt-8 sm:text-base">
          <p className="mb-4">
            <span className="bg-yellow-200 px-1">{t.examples}</span>
          </p>
          <div className="flex flex-col gap-2">
            <a
              href="https://0github.com/tinygrad/tinygrad/pull/12999"
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-black underline"
            >
              https://
              <span className="bg-yellow-300 px-1">0github.com</span>
              /tinygrad/tinygrad/pull/12999
            </a>
            <a
              href="https://0github.com/simonw/datasette/pull/2548"
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-black underline"
            >
              https://
              <span className="bg-yellow-300 px-1">0github.com</span>
              /simonw/datasette/pull/2548
            </a>
            <a
              href="https://0github.com/manaflow-ai/cmux/pull/666"
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-black underline"
            >
              https://<span className="bg-yellow-300 px-1">0github.com</span>
              /manaflow-ai/cmux/pull/666
            </a>
          </div>
        </div>

        <div className="mt-6 text-sm sm:mt-8 sm:text-base">
          <p className="mb-4">
            <span className="bg-yellow-200 px-1">{t.openSource}</span>：
          </p>
          <div className="flex flex-col gap-2">
            <a
              href="https://github.com/manaflow-ai/cmux"
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-black underline"
            >
              https://github.com/manaflow-ai/
              <span className="bg-blue-200 px-1">cmux</span>
            </a>
          </div>
        </div>
      </div>

      <div className="mb-6 mt-6 w-full overflow-hidden rounded-xl sm:mb-8 sm:mt-8 xl:max-w-7xl xl:px-8 2xl:max-w-[1600px]">
        <Image
          src={heatmapDemo1}
          alt={t.imageAlt}
          className="w-full"
          priority
        />
      </div>
    </div>
  );
}
