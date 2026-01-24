/**
 * Audio Digest synthesis page
 */

import { SynthesisPage } from "@/src/components/synthesis/synthesis-page";

export const metadata = {
  title: "Audio Digest Generator | Code Intelligence Digest",
  description: "Generate audio digests with highlights from articles and research papers",
};

export default function AudioDigestPage() {
  return (
    <div className="min-h-screen bg-white text-black">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <SynthesisPage type="audio-digest" />
      </div>
    </div>
  );
}
