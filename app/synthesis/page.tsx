/**
 * Synthesis hub page - entry point for newsletter and podcast generation
 */

import Link from "next/link";

export const metadata = {
  title: "Content Synthesis | Code Intelligence Digest",
  description: "Generate newsletters and podcasts from curated content",
};

export default function SynthesisHub() {
  return (
    <div className="container max-w-4xl py-12">
      {/* Header */}
      <div className="space-y-4 mb-12">
        <h1 className="text-4xl font-bold text-gray-900">Content Synthesis</h1>
        <p className="text-lg text-gray-600">
          Generate curated newsletters and podcast episodes from your selected content categories.
          Our RAG-powered system synthesizes grounded content using AI.
        </p>
      </div>

      {/* Feature Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
        {/* Newsletter Card */}
        <Link href="/synthesis/newsletter">
          <div className="h-full bg-white rounded-lg border border-gray-200 shadow hover:shadow-lg transition-shadow p-6 space-y-4 cursor-pointer">
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <span>📰</span> Newsletter Generator
            </h2>
            <p className="text-gray-600">
              Create beautifully formatted newsletters with summaries, themes, and full content
            </p>
            <div className="space-y-2 text-sm text-gray-700">
              <p className="font-semibold">Features:</p>
              <ul className="list-disc list-inside space-y-1 ml-2 text-xs">
                <li>Executive summary (100-150 words)</li>
                <li>Category-organized content</li>
                <li>Theme identification</li>
                <li>Markdown & HTML export</li>
                <li>Optional prompt guidance</li>
              </ul>
            </div>
            <div className="pt-4 border-t border-gray-200">
              <button className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded text-sm transition-colors">
                Generate Newsletter →
              </button>
            </div>
          </div>
        </Link>

        {/* Podcast Card */}
        <Link href="/synthesis/podcast">
          <div className="h-full bg-white rounded-lg border border-gray-200 shadow hover:shadow-lg transition-shadow p-6 space-y-4 cursor-pointer">
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <span>🎙️</span> Podcast Generator
            </h2>
            <p className="text-gray-600">
              Generate podcast episode transcripts with segments, timings, and show notes
            </p>
            <div className="space-y-2 text-sm text-gray-700">
              <p className="font-semibold">Features:</p>
              <ul className="list-disc list-inside space-y-1 ml-2 text-xs">
                <li>Full episode transcript</li>
                <li>Segmented by topic</li>
                <li>Estimated duration</li>
                <li>Curated show notes</li>
                <li>Multiple voice styles</li>
                <li>Optional prompt guidance</li>
              </ul>
            </div>
            <div className="pt-4 border-t border-gray-200">
              <button className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded text-sm transition-colors">
                Generate Podcast →
              </button>
            </div>
          </div>
        </Link>
      </div>

      {/* Info Section */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 space-y-4 mb-12">
        <h2 className="text-lg font-semibold text-blue-900">How It Works</h2>
        <ol className="space-y-2 text-sm text-blue-800 list-decimal list-inside">
          <li>
            <strong>Select Categories:</strong> Choose which content categories to include (newsletters, podcasts, tech articles, AI news, product news, community, research)
          </li>
          <li>
            <strong>Set Period:</strong> Choose between a weekly (7 days) or monthly (30 days) digest
          </li>
          <li>
            <strong>Add Guidance (Optional):</strong> Provide a prompt to focus the content on specific topics
          </li>
          <li>
            <strong>Generate:</strong> Our system retrieves, ranks, and synthesizes the content using AI
          </li>
          <li>
            <strong>Export:</strong> Download your newsletter/podcast in multiple formats (markdown, HTML, text)
          </li>
        </ol>
      </div>

      {/* Tech Details */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
          <p className="font-semibold text-gray-900">⚡ Performance</p>
          <p className="text-gray-600 mt-1 text-sm">Typical generation: 4–8 seconds</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
          <p className="font-semibold text-gray-900">🎯 Grounded</p>
          <p className="text-gray-600 mt-1 text-sm">No fabricated content—only from retrieved items</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
          <p className="font-semibold text-gray-900">🔄 Flexible</p>
          <p className="text-gray-600 mt-1 text-sm">Works with or without custom prompts</p>
        </div>
      </div>
    </div>
  );
}
