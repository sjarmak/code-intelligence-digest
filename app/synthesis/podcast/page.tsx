/**
 * Podcast synthesis page
 */

import { SynthesisPage } from "@/src/components/synthesis/synthesis-page";

export const metadata = {
  title: "Podcast Generator | Code Intelligence Digest",
  description: "Generate podcast episodes from selected content categories",
};

export default function PodcastPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <SynthesisPage type="podcast" />
      </div>
    </div>
  );
}
